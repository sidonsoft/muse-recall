import { escapeMemoryText, renderMemoryBlock, renderMemoryLayout } from '@mml/memory-engine';
import type { ContextReport, Message, RetrievalResult, RetrievedMemory } from '@mml/shared';
import type { ContextBudgets } from './config.js';
import { AgentError } from './errors.js';

/**
 * Context assembly.
 *
 * The prompt is built from explicitly delimited sections, in a fixed order,
 * under a hard character budget:
 *
 *   system instructions → project constraints → retrieved memories → tool
 *   results → recent corrections (history) → conversation history → current
 *   request
 *
 * Prioritisation when the budget is tight (documented, not implicit):
 *   1. the current request and the system instructions are never trimmed;
 *   2. constraints and memories are already bounded by the retrieval budget;
 *   3. tool results are truncated (or dropped) to the space that remains;
 *   4. correction history is dropped next;
 *   5. then oldest conversation history;
 *   6. if request + system still exceed the budget, the turn fails with a clear
 *      `context_overflow` error rather than truncating the user's words.
 */

export interface CorrectionContext {
  memory_id: string;
  content: string;
  replaced_at: string;
  type: string;
}

export interface AssembleInput {
  systemInstructions: string;
  request: string;
  history: Message[];
  retrieval: RetrievalResult;
  correctionHistory?: CorrectionContext[];
  /** Results of tool calls executed for this turn, already formatted. */
  toolResults?: string;
}

export interface AssembledContext {
  prompt: string;
  report: ContextReport;
}

/** Types treated as project constraints, rendered in their own section. */
const CONSTRAINT_TYPES = new Set(['constraint', 'goal']);

export function assembleContext(input: AssembleInput, budgets: ContextBudgets): AssembledContext {
  const request = input.request.trim();

  if (request.length === 0) {
    throw new AgentError('invalid_request', 'The message is empty.');
  }
  if (request.length > budgets.max_message_characters) {
    throw new AgentError(
      'message_too_long',
      `The message is ${request.length} characters; the limit is ${budgets.max_message_characters}.`,
      { length: request.length, limit: budgets.max_message_characters },
    );
  }

  const warnings: string[] = [];

  const systemSection = `<system_instructions>\n${input.systemInstructions.trim()}\n</system_instructions>`;
  const requestSection = `<current_request>\n${request}\n</current_request>`;

  const constraints = input.retrieval.results.filter((entry) =>
    CONSTRAINT_TYPES.has(entry.memory.type),
  );
  const otherMemories = input.retrieval.results.filter(
    (entry) => !CONSTRAINT_TYPES.has(entry.memory.type),
  );

  const constraintsSection = renderConstraints(constraints);
  const memoriesSection = renderMemories(otherMemories);

  const toolSection = renderToolResults(input.toolResults);

  let correctionsSection = renderCorrections(input.correctionHistory ?? [], budgets);
  if (correctionsSection.length > 0 && input.correctionHistory?.length) {
    warnings.push(
      `included ${input.correctionHistory.length} superseded record(s) as labelled history`,
    );
  }

  // Everything that is not optional history counts against the hard budget,
  // including tool results and the blank lines that join the sections: they are
  // prompt text like any other part of the prompt.
  const requiredSections = [
    systemSection,
    constraintsSection,
    memoriesSection,
    requestSection,
  ].filter((section) => section.length > 0);
  const requiredCharacters = requiredSections.reduce((sum, section) => sum + section.length, 0);
  const requiredOverhead = joinOverhead(requiredSections.length);

  let finalToolSection = toolSection;
  let fixedCharacters =
    requiredCharacters +
    requiredOverhead +
    (finalToolSection.length > 0 ? finalToolSection.length + SECTION_SEPARATOR.length : 0);

  // Tool output is unbounded in principle (a tool may return a large JSON
  // document), so it is trimmed rather than allowed to blow the budget. The
  // marker tells the model the payload was cut, instead of implying silence.
  if (fixedCharacters > budgets.max_prompt_characters && finalToolSection.length > 0) {
    // Reserve the blank line that joins the tool block to the prompt, so
    // trimming to the exact budget cannot push the assembled prompt over it.
    const available =
      budgets.max_prompt_characters -
      requiredCharacters -
      requiredOverhead -
      SECTION_SEPARATOR.length;
    const fitted = fitToolResults(input.toolResults ?? '', available);
    if (fitted.length > 0) {
      finalToolSection = fitted;
      warnings.push('tool results truncated to fit the prompt budget');
    } else {
      finalToolSection = '';
      warnings.push('tool results dropped to fit the prompt budget');
    }
    fixedCharacters =
      requiredCharacters +
      requiredOverhead +
      (finalToolSection.length > 0 ? finalToolSection.length + SECTION_SEPARATOR.length : 0);
  }

  if (fixedCharacters > budgets.max_prompt_characters) {
    throw new AgentError(
      'context_overflow',
      'The request and its required context exceed the prompt budget. Shorten the message or raise the context budget.',
      {
        required_characters: fixedCharacters,
        budget: budgets.max_prompt_characters,
        sections: {
          system: systemSection.length,
          request: requestSection.length,
          constraints: constraintsSection.length,
          memories: memoriesSection.length,
          tools: finalToolSection.length,
        },
      },
    );
  }

  // Corrections are the lowest-value section: they exist to explain change, so
  // they are dropped before anything the answer depends on. Adding the block
  // costs its own text plus the blank line joining it to the prompt.
  let usedCharacters =
    fixedCharacters +
    (correctionsSection.length > 0 ? correctionsSection.length + SECTION_SEPARATOR.length : 0);
  if (usedCharacters > budgets.max_prompt_characters && correctionsSection.length > 0) {
    warnings.push('correction history dropped to fit the prompt budget');
    correctionsSection = '';
    usedCharacters = fixedCharacters;
  }

  if (usedCharacters > budgets.max_prompt_characters) {
    throw new AgentError('context_overflow', 'Context assembly exceeded the prompt budget.', {
      required_characters: usedCharacters,
      budget: budgets.max_prompt_characters,
    });
  }

  const historyBudget = Math.min(
    budgets.max_history_characters,
    budgets.max_prompt_characters - usedCharacters - 64, // section wrapper overhead
  );

  const history = selectHistory(input.history, budgets, historyBudget);
  let historyMessages = history.messages;
  let historySection = renderHistory(historyMessages);

  // selectHistory bounds the message text, while the rendered block also spends
  // wrapper and join characters. Re-check the exact section so tool results that
  // consumed the budget cannot let history push the prompt over the hard cap.
  while (
    historySection.length > 0 &&
    usedCharacters + SECTION_SEPARATOR.length + historySection.length >
      budgets.max_prompt_characters
  ) {
    historyMessages = historyMessages.slice(1);
    historySection = renderHistory(historyMessages);
  }

  const dropped = history.dropped + (history.messages.length - historyMessages.length);
  if (dropped > 0) {
    warnings.push(
      `${dropped} older message(s) omitted to stay inside the conversation-history budget`,
    );
  }

  const sections = [
    systemSection,
    constraintsSection,
    memoriesSection,
    finalToolSection,
    correctionsSection,
    historySection,
    requestSection,
  ].filter((section) => section.length > 0);

  const prompt = sections.join(SECTION_SEPARATOR);

  const report: ContextReport = {
    prompt_characters: prompt.length,
    // Count the rendered memory text, including escaping, provenance headers,
    // delimiters, safety wording, and the blank line joining the two blocks —
    // exactly what is put in the prompt.
    memory_characters: renderMemoryLayout(input.retrieval.results, 'chat').length,
    history_messages: historyMessages.length,
    history_messages_dropped: dropped,
    sections: {
      system: systemSection.length,
      constraints: constraintsSection.length,
      memories: memoriesSection.length,
      corrections: correctionsSection.length,
      history: historySection.length,
      request: requestSection.length,
      tools: finalToolSection.length,
    },
    memory_ids: input.retrieval.results.map((entry) => entry.memory.id),
    estimated_tokens: Math.ceil(prompt.length / 4),
    warnings,
  };

  return { prompt, report };
}

function renderConstraints(constraints: RetrievedMemory[]): string {
  if (constraints.length === 0) return '';
  return renderMemoryBlock(constraints, 'project_constraints');
}

function renderMemories(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return '';
  return renderMemoryBlock(memories, 'retrieved_memories');
}

const TOOL_RESULTS_OPEN = '<tool_results>\n';
const TOOL_RESULTS_CLOSE = '\n</tool_results>';
const TOOL_TRUNCATION_MARKER = '\n… [tool results truncated to fit the prompt budget]';
const SECTION_SEPARATOR = '\n\n';

/** Characters spent on the blank lines between `count` prompt sections. */
function joinOverhead(count: number): number {
  return count > 1 ? SECTION_SEPARATOR.length * (count - 1) : 0;
}

function renderToolResults(text: string | undefined): string {
  const body = text?.trim() ?? '';
  if (body.length === 0) return '';
  return `${TOOL_RESULTS_OPEN}${body}${TOOL_RESULTS_CLOSE}`;
}

/**
 * Fit tool output into `availableCharacters`, keeping the delimiters intact and
 * marking the cut so the model knows the payload is incomplete.
 *
 * Returns an empty string when even the marker does not fit; the caller drops
 * the section and records a warning.
 */
function fitToolResults(text: string, availableCharacters: number): string {
  const body = text.trim();
  const wrapper = TOOL_RESULTS_OPEN.length + TOOL_RESULTS_CLOSE.length;
  const inner = availableCharacters - wrapper - TOOL_TRUNCATION_MARKER.length;
  if (body.length <= inner) return renderToolResults(body);
  if (inner <= 0) return '';
  return `${TOOL_RESULTS_OPEN}${body.slice(0, inner)}${TOOL_TRUNCATION_MARKER}${TOOL_RESULTS_CLOSE}`;
}

/** C0 controls (except tab/newline) have no place in a prompt block. */
function stripControlCharacters(text: string): string {
  let output = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
    if (!isControl) output += character;
  }
  return output;
}

function renderCorrections(corrections: CorrectionContext[], budgets: ContextBudgets): string {
  const included = corrections.slice(0, budgets.max_correction_history);
  if (included.length === 0) return '';

  const entries = included.map((correction, index) => {
    const content = renderCorrectionField(correction.content, budgets.max_memory_characters);
    const replacedAt = renderCorrectionField(correction.replaced_at, budgets.max_memory_characters);
    const type = renderCorrectionField(correction.type, budgets.max_memory_characters);
    return `[${index + 1}] replaced on ${replacedAt} · ${type}\n${content}`;
  });

  return [
    '<recent_corrections>',
    'These records were REPLACED by a current memory. They are historical and must',
    'not be treated as current facts. Use them only to explain what changed.',
    '',
    entries.join('\n\n'),
    '</recent_corrections>',
  ].join('\n');
}

/**
 * Every field of a superseded record is model-visible database text, exactly
 * like a retrieved memory. Escape it so it cannot close the
 * `<recent_corrections>` block or masquerade as markup, and bound it so one
 * record cannot crowd out the sections the answer depends on.
 */
function renderCorrectionField(text: string, maxCharacters: number): string {
  const withoutControls = stripControlCharacters(text);
  if (withoutControls.length <= maxCharacters) return escapeMemoryText(withoutControls);

  let end = Math.max(0, maxCharacters - 1);
  // Do not split a surrogate pair when the cap lands between its halves.
  const code = withoutControls.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return escapeMemoryText(`${withoutControls.slice(0, end)}…`);
}

interface HistorySelection {
  messages: Message[];
  dropped: number;
}

/**
 * Select the newest conversation messages that fit the history budget.
 *
 * Iteration is newest-first so a truncation always removes the oldest turns,
 * and the result is reversed back to chronological order for the prompt.
 */
function selectHistory(
  history: Message[],
  budgets: ContextBudgets,
  characterBudget: number,
): HistorySelection {
  if (history.length === 0 || budgets.max_history_messages <= 0 || characterBudget <= 0) {
    return { messages: [], dropped: history.length };
  }

  const selected: Message[] = [];
  let characters = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    if (selected.length >= budgets.max_history_messages) break;

    const cost = message.content.length + message.role.length + 3; // "ROLE: " prefix
    if (characters + cost > characterBudget) break;

    selected.push(message);
    characters += cost;
  }

  selected.reverse();
  return { messages: selected, dropped: history.length - selected.length };
}

function renderHistory(messages: Message[]): string {
  if (messages.length === 0) return '';
  const lines = messages.map(
    (message) => `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content.trim()}`,
  );
  return ['<conversation_history>', lines.join('\n\n'), '</conversation_history>'].join('\n');
}
