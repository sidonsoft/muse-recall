import { renderMemoryBlock } from '@mml/memory-engine';
import type { ContextReport, Message, RetrievalResult, RetrievedMemory } from '@mml/shared';
import type { ContextBudgets } from './config.js';
import { AgentError } from './errors.js';

/**
 * Context assembly.
 *
 * The prompt is built from five explicitly delimited sections, in a fixed
 * order, under a hard character budget:
 *
 *   system instructions → project constraints → retrieved memories →
 *   recent corrections (history) → conversation history → current request
 *
 * Prioritisation when the budget is tight (documented, not implicit):
 *   1. the current request and the system instructions are never trimmed;
 *   2. constraints and memories are already bounded by the retrieval budget;
 *   3. correction history is dropped first;
 *   4. then oldest conversation history;
 *   5. if request + system still exceed the budget, the turn fails with a clear
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

  let correctionsSection = renderCorrections(input.correctionHistory ?? [], budgets);
  if (correctionsSection.length > 0 && input.correctionHistory?.length) {
    warnings.push(
      `included ${input.correctionHistory.length} superseded record(s) as labelled history`,
    );
  }

  const fixedCharacters =
    systemSection.length +
    requestSection.length +
    constraintsSection.length +
    memoriesSection.length;

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
        },
      },
    );
  }

  // Corrections are the lowest-value section: they exist to explain change, so
  // they are dropped before anything the answer depends on.
  let usedCharacters = fixedCharacters + correctionsSection.length;
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
  const historySection = renderHistory(history.messages);
  const dropped = history.dropped;
  if (dropped > 0) {
    warnings.push(
      `${dropped} older message(s) omitted to stay inside the conversation-history budget`,
    );
  }

  const sections = [
    systemSection,
    constraintsSection,
    memoriesSection,
    correctionsSection,
    historySection,
    requestSection,
  ].filter((section) => section.length > 0);

  const prompt = sections.join('\n\n');

  const report: ContextReport = {
    prompt_characters: prompt.length,
    memory_characters:
      constraints.reduce((sum, entry) => sum + entry.injected_content.length, 0) +
      otherMemories.reduce((sum, entry) => sum + entry.injected_content.length, 0),
    history_messages: history.messages.length,
    history_messages_dropped: dropped,
    sections: {
      system: systemSection.length,
      constraints: constraintsSection.length,
      memories: memoriesSection.length,
      corrections: correctionsSection.length,
      history: historySection.length,
      request: requestSection.length,
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

function renderCorrections(corrections: CorrectionContext[], budgets: ContextBudgets): string {
  const included = corrections.slice(0, budgets.max_correction_history);
  if (included.length === 0) return '';

  const entries = included.map((correction, index) => {
    return `[${index + 1}] replaced on ${correction.replaced_at} · ${correction.type}\n${correction.content}`;
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
