import type { MemoryEngine } from '@mml/memory-engine';
import { ProviderError } from '@mml/muse-provider';
import {
  type CapturedMemory,
  type MemoryType,
  type ModelEvent,
  type ModelProvider,
  type RetrievalResult,
  type SendMessageInput,
  SendMessageInputSchema,
  type Session,
  type TokenUsage,
  type ToolCall,
  type TurnResult,
} from '@mml/shared';
import type { ToolCallStore, ToolRegistry } from '@mml/tool-runtime';
import { z } from 'zod';
import type { AgentConfig } from './config.js';
import {
  type AssembledContext,
  assembleContext,
  type CorrectionContext,
} from './context-assembler.js';
import { AgentError } from './errors.js';
import {
  extractCandidates,
  inferMemoryType,
  isAnnouncementOnly,
  parseMemoryCommand,
  selectSupersessionCandidate,
} from './memory-capture.js';
import type { SessionStore } from './session-store.js';
import type { StreamingEventHandler } from './streaming.js';

/**
 * One turn, from user message to persisted answer.
 *
 * The runtime owns conversation state; the provider remains a stateless text
 * oracle. Everything a turn needs — history, retrieved memory, budget — is
 * assembled here and handed over as a single prompt.
 */

export interface TurnProcessorDependencies {
  store: SessionStore;
  engine: MemoryEngine;
  provider: ModelProvider;
  config: AgentConfig;
  tools?: { registry: ToolRegistry; store: ToolCallStore };
  now?: () => Date;
}

export interface TurnOptions {
  signal?: AbortSignal;
  /** `force` decides tools even for a message the heuristic would skip. */
  tools?: 'auto' | 'force' | 'off';
}

interface RequestedCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Strict decision schema. `arguments_json` is a string because structured output
 * cannot express per-tool argument shapes; it is parsed and validated against
 * the chosen tool's schema immediately afterwards.
 */
const TOOL_DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    calls: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          arguments_json: { type: 'string' },
        },
        required: ['tool', 'arguments_json'],
        additionalProperties: false,
      },
    },
  },
  required: ['calls'],
  additionalProperties: false,
} as const;

const ToolDecisionSchema = z.object({
  calls: z.array(z.object({ tool: z.string(), arguments_json: z.string() })).max(5),
});

const EMPTY_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  reasoning_tokens: 0,
};

export class TurnProcessor {
  private readonly store: SessionStore;
  private readonly engine: MemoryEngine;
  private readonly provider: ModelProvider;
  private readonly config: AgentConfig;
  private readonly tools: { registry: ToolRegistry; store: ToolCallStore } | undefined;
  private readonly clock: () => Date;

  constructor(dependencies: TurnProcessorDependencies) {
    this.store = dependencies.store;
    this.engine = dependencies.engine;
    this.provider = dependencies.provider;
    this.config = dependencies.config;
    this.tools = dependencies.tools;
    this.clock = dependencies.now ?? (() => new Date());
  }

  async process(
    sessionId: string,
    input: SendMessageInput,
    handler: StreamingEventHandler,
    options: TurnOptions = {},
  ): Promise<TurnResult> {
    const session = this.store.requireSession(sessionId);
    if (session.status === 'archived') {
      throw new AgentError('session_archived', 'This session is archived and read-only.', {
        session_id: sessionId,
      });
    }

    const parsed = SendMessageInputSchema.parse(input);
    const content = parsed.content.trim();
    this.assertNotAborted(options.signal);

    // 1. Explicit memory capture, before retrieval, so a fact the user just
    //    stated can ground the answer in the same turn.
    const captures =
      parsed.capture_memories && this.config.autoCapture !== 'off'
        ? this.captureMemories(session, content)
        : [];
    if (captures.length > 0) await handler.memoryCaptured(captures);

    // 2. Persist the user message. If anything later fails, this remains — the
    //    user did say it, and pretending otherwise would lose their words.
    const userMessage = this.store.appendMessage({
      sessionId,
      role: 'user',
      content,
      status: 'complete',
    });

    // 3. Retrieve active memories for this project (globals included).
    const retrieval = this.engine.retrieve(
      {
        project_id: session.project_id,
        query: content,
        budget: this.config.memoryBudget,
      },
      { now: this.clock() },
    );
    await handler.retrieval(retrieval.metadata, retrieval.results);

    // 3b. Tool planning and execution. Reads run immediately; writes become
    // pending approvals. Either way the model sees only validated results.
    const toolOutcome = await this.runTools({
      session,
      content,
      handler,
      options,
      toolHint: options.tools ?? 'auto',
    });

    // 4. Assemble a bounded prompt from history, memory, constraints, and the
    //    request. The current message is the request, so it is excluded from
    //    the history section.
    const history = this.store
      .recentMessages(sessionId, this.config.budgets.max_history_messages * 2 + 2)
      .filter((message) => message.id !== userMessage.id)
      .slice(-this.config.budgets.max_history_messages);

    const correctionHistory = this.collectCorrectionHistory(retrieval);
    const assembled = assembleContext(
      {
        systemInstructions: this.config.systemInstructions,
        request: content,
        history,
        retrieval,
        correctionHistory,
        toolResults: toolOutcome.promptSection,
      },
      this.config.budgets,
    );

    // 5. Call the provider and stream the answer.
    const startedAt = performance.now();
    let text = '';
    let usage = { ...EMPTY_USAGE };
    let providerCompleted = false;

    try {
      for await (const event of this.streamProvider(assembled.prompt)) {
        this.assertNotAborted(options.signal);

        switch (event.type) {
          case 'text_delta':
            text += event.text;
            await handler.delta(event.text);
            break;
          case 'usage':
            usage = event.usage;
            break;
          case 'completed':
            text = event.text;
            providerCompleted = true;
            break;
          case 'error':
            throw new AgentError('provider_failure', event.message, {
              provider_code: event.code,
              session_id: sessionId,
            });
          default:
            break;
        }
      }
    } catch (error) {
      const agentError = toAgentError(error, sessionId);
      const latencyMs = Math.round(performance.now() - startedAt);

      // Persist what actually arrived, clearly labelled. A cancelled or failed
      // turn never becomes a "complete" answer.
      if (text.trim().length > 0) {
        const partial = this.store.appendMessage({
          sessionId,
          role: 'assistant',
          content: text,
          status: agentError.code === 'turn_cancelled' ? 'interrupted' : 'failed',
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          latencyMs,
          context: assembled.report,
        });
        this.store.recordTurnMemories(partial.id, this.turnMemoryRows(retrieval));
        this.tools?.store.attachMessage(
          toolOutcome.calls.map((call) => call.id),
          partial.id,
        );
      }

      throw agentError;
    }

    const latencyMs = Math.round(performance.now() - startedAt);

    if (!providerCompleted) {
      throw new AgentError('provider_failure', 'The provider ended without completing.', {
        session_id: sessionId,
      });
    }

    // 6. Persist the completed answer and its retrieval evidence. A provider
    //    that finished has produced a real answer, so it is stored even if the
    //    client disconnected in the final milliseconds.
    const assistantMessage = this.store.appendMessage({
      sessionId,
      role: 'assistant',
      content: text,
      status: 'complete',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      latencyMs,
      context: assembled.report,
    });
    this.store.recordTurnMemories(assistantMessage.id, this.turnMemoryRows(retrieval));
    this.tools?.store.attachMessage(
      toolOutcome.calls.map((call) => call.id),
      assistantMessage.id,
    );

    const assistantWithEvidence = {
      ...assistantMessage,
      memories: this.store.getTurnMemories(assistantMessage.id),
    };

    await handler.usage(usage);

    const candidates =
      this.config.autoCapture === 'suggest' && captures.length === 0
        ? extractCandidates(content)
        : [];

    const turn: TurnResult = {
      session_id: sessionId,
      user_message: userMessage,
      assistant_message: assistantWithEvidence,
      retrieval: retrieval.metadata,
      context: assembled.report,
      usage,
      captures,
      candidates,
    };

    await handler.completed(turn);
    return turn;
  }

  // -------------------------------------------------------------------------
  // Provider
  // -------------------------------------------------------------------------

  private async *streamProvider(prompt: string): AsyncGenerator<ModelEvent> {
    const request = {
      messages: [{ role: 'user' as const, content: prompt }],
      max_output_tokens: this.config.maxOutputTokens,
    };

    if (this.provider.stream) {
      yield* this.provider.stream(request);
      return;
    }

    // A provider without streaming still produces a valid turn; it simply
    // arrives as one event.
    const response = await this.provider.generate(request);
    yield { type: 'text_delta', text: response.text };
    yield { type: 'usage', usage: response.usage };
    yield {
      type: 'completed',
      text: response.text,
      model: response.model,
      stop_reason: response.stop_reason,
      latency_ms: response.latency_ms,
    };
  }

  private assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new AgentError('turn_cancelled', 'The turn was cancelled.', { aborted: true });
    }
  }

  // -------------------------------------------------------------------------
  // Memory capture
  // -------------------------------------------------------------------------

  /**
   * Store facts the user explicitly asked to remember.
   *
   * Corrections supersede the most likely prior record using deterministic
   * lexical overlap; everything else is created as a new memory. Nothing is
   * captured unless the user used an explicit instruction.
   */
  private captureMemories(session: Session, text: string): CapturedMemory[] {
    const command = parseMemoryCommand(text);
    if (!command) return [];

    const captures: CapturedMemory[] = [];
    const activeMemories = command.correction
      ? this.engine.list({
          project_id: session.project_id,
          include_global: true,
          status: ['active'],
          limit: 200,
        }).items
      : [];

    const scope = session.project_id ? ('project' as const) : ('global' as const);

    for (const fact of command.facts.slice(0, 6)) {
      if (command.correction && isAnnouncementOnly(fact)) continue;

      const type: MemoryType = inferMemoryType(fact);
      const source = { session_id: session.id, reference: 'explicit-command' };
      const candidate = command.correction
        ? selectSupersessionCandidate(activeMemories, fact)
        : null;

      if (candidate) {
        const result = this.engine.correct({
          supersedes: [candidate.id],
          type,
          scope,
          project_id: session.project_id,
          content: fact,
          source,
          confidence: 0.9,
          validation_status: 'verified',
          tags: [],
          reason: 'explicit user correction',
        });

        captures.push({
          memory_id: result.memory.id,
          content: fact,
          type,
          reason: `superseded an earlier ${candidate.type.replace(/_/g, ' ')}`,
          superseded_ids: [candidate.id],
          created: result.created,
        });

        // Keep the working set current so a second fact in the same message
        // cannot supersede the record we just replaced.
        const index = activeMemories.findIndex((memory) => memory.id === candidate.id);
        if (index >= 0) activeMemories.splice(index, 1);
        activeMemories.push(result.memory);
        continue;
      }

      const created = this.engine.create({
        type,
        scope,
        project_id: session.project_id,
        content: fact,
        source,
        confidence: 0.9,
        validation_status: 'verified',
        tags: [],
        expires_at: null,
      });

      captures.push({
        memory_id: created.memory.id,
        content: fact,
        type,
        reason: created.created ? 'explicit user request' : 'already stored as memory',
        superseded_ids: [],
        created: created.created,
      });
    }

    return captures;
  }

  /**
   * Superseded records attached to the memories that *were* retrieved.
   *
   * This is deliberately not a second retrieval pass: the active memory is the
   * only entry point, and its replacement chain is rendered as labelled
   * history. Stale records never enter ordinary active retrieval.
   */
  private collectCorrectionHistory(retrieval: RetrievalResult): CorrectionContext[] {
    if (!this.config.includeCorrectionHistory) return [];

    const entries: CorrectionContext[] = [];
    const seen = new Set<string>();

    for (const result of retrieval.results) {
      for (const supersededId of result.memory.supersedes) {
        if (seen.has(supersededId)) continue;
        const superseded = this.engine.get(supersededId);
        if (superseded?.status !== 'superseded') continue;
        seen.add(supersededId);
        entries.push({
          memory_id: superseded.id,
          content: superseded.content,
          replaced_at: superseded.updated_at,
          type: superseded.type,
        });
      }
    }

    return entries
      .sort((a, b) => b.replaced_at.localeCompare(a.replaced_at))
      .slice(0, this.config.budgets.max_correction_history);
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  private toolContext(session: Session) {
    return {
      db: this.engine.connection,
      memory: this.engine,
      sessionId: session.id,
      projectId: session.project_id,
      now: this.clock,
    };
  }

  /** Conservative heuristic so an unrelated chat message does not spend a call. */
  private shouldConsiderTools(content: string): boolean {
    return /\b(create|add|make|update|rename|save|store|remember|list|show|find|search|task|tasks|project|milestone|plan)\b/i.test(
      content,
    );
  }

  private async decideTools(content: string, session: Session): Promise<RequestedCall[]> {
    if (!this.tools) return [];
    const catalog = this.tools.registry.list();
    if (catalog.length === 0) return [];

    const recent = this.store
      .recentMessages(session.id, 8)
      .map(
        (message) =>
          `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content.slice(0, 400)}`,
      )
      .join('\n');

    const prompt = [
      'You are the tool-planning step for a project memory companion.',
      'Available tools:',
      JSON.stringify(catalog),
      `Recent conversation:\n${recent}`,
      `Current request: ${content}`,
      'Return JSON: {"calls":[{"tool":"<id>","arguments_json":"<json object string>"}]}',
      'Rules: 0-3 calls; only listed tools; arguments must match that tool input schema;',
      'do not repeat a call; prefer reads before writes; never invent project ids.',
    ].join('\n\n');

    try {
      const response = await this.provider.generate({
        messages: [{ role: 'user', content: prompt }],
        response_schema: TOOL_DECISION_JSON_SCHEMA as unknown as Record<string, unknown>,
        max_output_tokens: 600,
      });
      const parsed = ToolDecisionSchema.safeParse(JSON.parse(response.text));
      if (!parsed.success) return [];

      const requests: RequestedCall[] = [];
      for (const call of parsed.data.calls) {
        try {
          const args: unknown = JSON.parse(call.arguments_json);
          requests.push({
            tool: call.tool,
            arguments:
              args && typeof args === 'object' && !Array.isArray(args)
                ? (args as Record<string, unknown>)
                : {},
          });
        } catch {
          // Invalid JSON becomes an invalid-arguments audit record, not a crash.
          requests.push({ tool: call.tool, arguments: {} });
        }
      }
      return requests.slice(0, this.config.tools.maxCallsPerTurn);
    } catch {
      // Tool planning is best-effort: a provider hiccup must not fail the turn.
      return [];
    }
  }

  private async runTools(args: {
    session: Session;
    content: string;
    handler: StreamingEventHandler;
    options: TurnOptions;
    toolHint: 'auto' | 'force' | 'off';
  }): Promise<{ calls: ToolCall[]; promptSection: string }> {
    const settings = this.config.tools;
    if (!this.tools || !settings.enabled) return { calls: [], promptSection: '' };
    if (args.toolHint === 'off' || settings.decisionMode === 'off') {
      return { calls: [], promptSection: '' };
    }
    if (
      args.toolHint !== 'force' &&
      settings.decisionMode === 'auto' &&
      !this.shouldConsiderTools(args.content)
    ) {
      return { calls: [], promptSection: '' };
    }

    const requests = await this.decideTools(args.content, args.session);
    if (requests.length === 0) return { calls: [], promptSection: '' };

    const { registry, store } = this.tools;
    const calls: ToolCall[] = [];
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const request of requests) {
      const key = `${request.tool}:${JSON.stringify(request.arguments)}`;
      if (seen.has(key)) {
        lines.push(`Duplicate tool call ignored: ${request.tool}.`);
        continue;
      }
      seen.add(key);

      const tool = registry.get(request.tool);
      if (!tool) {
        calls.push(
          store.create({
            sessionId: args.session.id,
            projectId: args.session.project_id,
            toolId: request.tool,
            arguments: request.arguments,
            status: 'invalid',
            requiresConfirmation: false,
            error: 'Unknown tool.',
          }),
        );
        lines.push(`Tool "${request.tool}" was rejected: unknown tool.`);
        continue;
      }

      const parsedArgs = tool.input.safeParse(request.arguments);
      if (!parsedArgs.success) {
        calls.push(
          store.create({
            sessionId: args.session.id,
            projectId: args.session.project_id,
            toolId: tool.id,
            arguments: request.arguments,
            status: 'invalid',
            requiresConfirmation: tool.requiresConfirmation,
            error: 'Arguments did not match the tool schema.',
          }),
        );
        lines.push(`Tool "${tool.id}" was rejected: invalid arguments.`);
        continue;
      }

      const needsApproval = tool.requiresConfirmation && settings.approvalPolicy === 'always';
      if (needsApproval) {
        calls.push(
          store.create({
            sessionId: args.session.id,
            projectId: args.session.project_id,
            toolId: tool.id,
            arguments: parsedArgs.data,
            status: 'pending',
            requiresConfirmation: true,
          }),
        );
        lines.push(
          `Tool "${tool.id}" is awaiting user approval and has NOT run. Arguments: ${JSON.stringify(parsedArgs.data)}`,
        );
        continue;
      }

      const invocation = await registry.invoke(
        tool.id,
        parsedArgs.data,
        this.toolContext(args.session),
      );
      const status =
        invocation.status === 'executed'
          ? 'executed'
          : invocation.status === 'invalid'
            ? 'invalid'
            : 'failed';

      calls.push(
        store.create({
          sessionId: args.session.id,
          projectId: args.session.project_id,
          toolId: tool.id,
          arguments: parsedArgs.data,
          status,
          requiresConfirmation: tool.requiresConfirmation,
          ...(invocation.status === 'executed' ? { result: invocation.output } : {}),
          ...(invocation.error ? { error: invocation.error } : {}),
          durationMs: invocation.durationMs,
        }),
      );

      lines.push(
        invocation.status === 'executed'
          ? `Tool "${tool.id}" executed successfully. Result: ${safeStringify(invocation.output)}`
          : `Tool "${tool.id}" failed: ${invocation.error ?? 'unknown error'}`,
      );
    }

    if (calls.length > 0) await args.handler.toolCall?.(calls);
    return { calls, promptSection: lines.join('\n') };
  }

  private turnMemoryRows(retrieval: RetrievalResult) {
    return retrieval.results.map((result) => ({
      memoryId: result.memory.id,
      score: result.score,
      evidence: result.evidence,
      memoryType: result.memory.type,
      scope: result.memory.scope,
      pinned: result.pinned,
      truncated: result.truncated,
      characters: result.injected_content.length,
    }));
  }
}

/**
 * Convert any thrown value into a runtime error.
 *
 * Provider failures keep their original code in `details` so the UI can say
 * "the model timed out" rather than "something went wrong".
 */
export function toAgentError(error: unknown, sessionId?: string): AgentError {
  if (AgentError.isAgentError(error)) return error;

  if (ProviderError.isProviderError(error)) {
    return new AgentError('provider_failure', error.message, {
      provider_code: error.code,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  if (error instanceof SyntaxError) {
    return new AgentError('invalid_request', 'The request could not be validated.', {
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  return new AgentError(
    'provider_failure',
    error instanceof Error ? error.message : String(error),
    { ...(sessionId ? { session_id: sessionId } : {}) },
  );
}

export type { AssembledContext };

/** Compact, bounded rendering of a tool result for the model prompt. */
function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return 'undefined';
    return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
  } catch {
    return 'unserialisable result';
  }
}
