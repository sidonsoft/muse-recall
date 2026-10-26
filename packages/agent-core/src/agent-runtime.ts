import type { MemoryEngine } from '@mml/memory-engine';
import {
  type CreateSessionInput,
  CreateSessionInputSchema,
  type ModelProvider,
  type SendMessageInput,
  type Session,
  type SessionDetail,
  type SessionStatus,
  type TurnResult,
  UpdateSessionInputSchema,
} from '@mml/shared';
import type { ToolCallStore, ToolRegistry } from '@mml/tool-runtime';
import { type AgentConfig, DEFAULT_AGENT_CONFIG, DEFAULT_CONTEXT_BUDGETS } from './config.js';
import { AgentError } from './errors.js';
import { SessionStore } from './session-store.js';
import type { StreamingEventHandler } from './streaming.js';
import { TurnProcessor } from './turn-processor.js';

/**
 * Agent runtime.
 *
 * Owns sessions, the active-turn registry, and cancellation. The model provider
 * stays stateless: it receives one prompt and returns one stream.
 *
 * Concurrency rule: at most one turn per session at a time. Two simultaneous
 * turns would interleave assistant output and make message ordering ambiguous
 * even though the database itself is transactional, so the second request is
 * rejected with `session_busy` rather than queued.
 */

export interface AgentRuntimeDependencies {
  engine: MemoryEngine;
  provider: ModelProvider;
  config?: Partial<AgentConfig>;
  tools?: { registry: ToolRegistry; store: ToolCallStore };
  now?: () => Date;
}

export class AgentRuntime {
  readonly store: SessionStore;
  readonly config: AgentConfig;

  private readonly engine: MemoryEngine;
  private readonly processor: TurnProcessor;
  private readonly activeTurns = new Map<string, AbortController>();

  constructor(dependencies: AgentRuntimeDependencies) {
    this.engine = dependencies.engine;
    this.config = {
      ...DEFAULT_AGENT_CONFIG,
      ...dependencies.config,
      budgets: {
        ...DEFAULT_CONTEXT_BUDGETS,
        ...(dependencies.config?.budgets ?? {}),
      },
      tools: {
        ...DEFAULT_AGENT_CONFIG.tools,
        ...(dependencies.config?.tools ?? {}),
      },
    };

    this.store = new SessionStore(dependencies.engine.connection, {
      now: dependencies.now,
      resolveMemory: (id) => this.engine.get(id),
    });

    this.processor = new TurnProcessor({
      store: this.store,
      engine: this.engine,
      provider: dependencies.provider,
      config: this.config,
      tools: dependencies.tools,
      now: dependencies.now,
    });
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  createSession(input: CreateSessionInput): Session {
    const parsed = CreateSessionInputSchema.parse(input);

    // The session's project is the memory scope for every turn, so the scope
    // anchor must exist before the foreign key is written.
    if (parsed.project_id) this.engine.ensureProject(parsed.project_id);

    return this.store.createSession({
      project_id: parsed.project_id,
      title: parsed.title,
    });
  }

  listSessions(options: { status?: SessionStatus; limit?: number } = {}): Session[] {
    return this.store.listSessions(options);
  }

  getSession(id: string): Session {
    return this.store.requireSession(id);
  }

  getSessionDetail(id: string): SessionDetail {
    return this.store.getSessionDetail(id);
  }

  updateSession(id: string, patch: unknown): Session {
    return this.store.updateSession(id, UpdateSessionInputSchema.parse(patch));
  }

  deleteSession(id: string): void {
    this.cancel(id);
    this.store.deleteSession(id);
  }

  // -------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------

  isBusy(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  async runTurn(
    sessionId: string,
    input: SendMessageInput,
    handler: StreamingEventHandler,
    options: { signal?: AbortSignal; tools?: 'auto' | 'force' | 'off' } = {},
  ): Promise<TurnResult> {
    if (this.activeTurns.has(sessionId)) {
      throw new AgentError(
        'session_busy',
        'This session is already processing a turn. Wait for it to finish.',
        { session_id: sessionId },
      );
    }

    const controller = new AbortController();
    this.activeTurns.set(sessionId, controller);

    const forwardAbort = () => controller.abort();
    // An already-aborted signal will not fire another event, so check first.
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener('abort', forwardAbort);

    try {
      return await this.processor.process(sessionId, input, handler, {
        signal: controller.signal,
        ...(options.tools ? { tools: options.tools } : {}),
      });
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort);
      this.activeTurns.delete(sessionId);
    }
  }

  /** Cancel the in-flight turn for a session, if any. Returns true if cancelled. */
  cancel(sessionId: string): boolean {
    const controller = this.activeTurns.get(sessionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
