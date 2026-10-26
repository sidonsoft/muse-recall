import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ContextReport,
  Message,
  MessageWithEvidence,
  Session,
  SessionDetail,
  SessionStatus,
  TurnMemoryEvidence,
} from '@mml/shared';
import { ContextReportSchema, MessageStatusSchema } from '@mml/shared';
import { AgentError } from './errors.js';

/**
 * Persistent session storage.
 *
 * Message order is a database guarantee, not a convention: `(session_id,
 * sequence)` is unique and the sequence is assigned under `BEGIN IMMEDIATE`, so
 * two concurrent writers cannot produce duplicate or interleaved sequences.
 */

interface SessionRow {
  id: string;
  project_id: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  sequence: number;
  role: string;
  content: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  context_json: string | null;
  created_at: string;
}

interface TurnMemoryRow {
  memory_id: string;
  score: number;
  evidence: string;
  memory_type: string;
  scope: string;
  pinned: number;
  truncated: number;
  characters: number;
}

const SESSION_SELECT = `
  SELECT s.id, s.project_id, s.title, s.status, s.created_at, s.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id) AS last_message_at
  FROM sessions s
`;

const MESSAGE_SELECT = `
  SELECT id, session_id, sequence, role, content, status, input_tokens,
         output_tokens, latency_ms, context_json, created_at
  FROM messages
`;

export interface SessionStoreOptions {
  now?: () => Date;
  /** Resolves a memory for provenance display; null when it no longer exists. */
  resolveMemory?: (id: string) => import('@mml/shared').Memory | null;
}

export interface AppendMessageInput {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'complete' | 'interrupted' | 'failed';
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number | null;
  context?: ContextReport | null;
}

export interface TurnMemoryInput {
  memoryId: string;
  score: number;
  evidence: string;
  memoryType: string;
  scope: 'global' | 'project';
  pinned: boolean;
  truncated: boolean;
  characters: number;
}

export class SessionStore {
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;
  private readonly resolveMemory: (id: string) => import('@mml/shared').Memory | null;

  constructor(db: DatabaseSync, options: SessionStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => new Date());
    this.resolveMemory = options.resolveMemory ?? (() => null);
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Never mask the original failure with a rollback error.
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  createSession(input: { project_id: string | null; title?: string | undefined }): Session {
    const id = randomUUID();
    const now = this.nowIso();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      )
      .run(id, input.project_id, input.title ?? null, now, now);

    return this.requireSession(id);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as unknown as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : null;
  }

  requireSession(id: string): Session {
    const session = this.getSession(id);
    if (!session) throw new AgentError('session_not_found', `No session with id ${id}.`, { id });
    return session;
  }

  listSessions(options: { status?: SessionStatus; limit?: number } = {}): Session[] {
    const limit = options.limit ?? 100;
    const rows = options.status
      ? (this.db
          .prepare(
            `${SESSION_SELECT} WHERE s.status = ? ORDER BY s.updated_at DESC, s.id ASC LIMIT ?`,
          )
          .all(options.status, limit) as unknown as SessionRow[])
      : (this.db
          .prepare(`${SESSION_SELECT} ORDER BY s.updated_at DESC, s.id ASC LIMIT ?`)
          .all(limit) as unknown as SessionRow[]);
    return rows.map(mapSession);
  }

  updateSession(
    id: string,
    patch: { title?: string | undefined; status?: SessionStatus | undefined },
  ): Session {
    this.requireSession(id);
    const now = this.nowIso();
    if (patch.title !== undefined) {
      this.db
        .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(patch.title, now, id);
    }
    if (patch.status !== undefined) {
      this.db
        .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
        .run(patch.status, now, id);
    }
    return this.requireSession(id);
  }

  /** Hard delete: messages and turn evidence cascade. */
  deleteSession(id: string): void {
    this.requireSession(id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  appendMessage(input: AppendMessageInput): Message {
    return this.transaction(() => {
      const session = this.requireSession(input.sessionId);
      const sequence = this.nextSequence(input.sessionId);
      const id = randomUUID();
      const now = this.nowIso();
      const status = MessageStatusSchema.parse(input.status ?? 'complete');

      this.db
        .prepare(
          `INSERT INTO messages
             (id, session_id, sequence, role, content, status, input_tokens,
              output_tokens, latency_ms, context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          sequence,
          input.role,
          input.content,
          status,
          input.inputTokens ?? 0,
          input.outputTokens ?? 0,
          input.latencyMs ?? null,
          input.context ? JSON.stringify(input.context) : null,
          now,
        );

      // First user message becomes the session title, so the sidebar is useful
      // without asking the user to name a conversation.
      const title =
        session.title === null && input.role === 'user'
          ? deriveTitle(input.content)
          : session.title;

      this.db
        .prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?')
        .run(now, title, input.sessionId);

      return this.requireMessage(id);
    });
  }

  private nextSequence(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM messages WHERE session_id = ?')
      .get(sessionId) as { next: number } | undefined;
    return row?.next ?? 0;
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare(`${MESSAGE_SELECT} WHERE id = ?`).get(id) as unknown as
      | MessageRow
      | undefined;
    return row ? mapMessage(row) : null;
  }

  requireMessage(id: string): Message {
    const message = this.getMessage(id);
    if (!message) throw new AgentError('invalid_request', `No message with id ${id}.`, { id });
    return message;
  }

  /**
   * Most recent messages, oldest first. `limit` counts messages, not turns.
   * Callers assembling context should exclude the message they just persisted.
   */
  recentMessages(sessionId: string, limit: number): Message[] {
    const rows = this.db
      .prepare(`${MESSAGE_SELECT} WHERE session_id = ? ORDER BY sequence DESC LIMIT ?`)
      .all(sessionId, limit) as unknown as MessageRow[];
    return rows.reverse().map(mapMessage);
  }

  listMessages(sessionId: string): MessageWithEvidence[] {
    const rows = this.db
      .prepare(`${MESSAGE_SELECT} WHERE session_id = ? ORDER BY sequence ASC`)
      .all(sessionId) as unknown as MessageRow[];

    return rows.map((row) => ({
      ...mapMessage(row),
      memories: this.getTurnMemories(row.id),
    }));
  }

  // -------------------------------------------------------------------------
  // Turn evidence
  // -------------------------------------------------------------------------

  /**
   * Persist immutable retrieval provenance for a completed turn.
   *
   * Only ranking evidence is stored — never memory content. Content is
   * resolved at read time, so a deleted memory disappears from display while
   * the record that it once influenced an answer survives.
   */
  recordTurnMemories(messageId: string, entries: TurnMemoryInput[]): void {
    if (entries.length === 0) return;
    const now = this.nowIso();
    this.transaction(() => {
      const statement = this.db.prepare(
        `INSERT INTO turn_memories
           (message_id, memory_id, score, evidence, memory_type, scope,
            pinned, truncated, characters, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id, memory_id) DO NOTHING`,
      );
      for (const entry of entries) {
        statement.run(
          messageId,
          entry.memoryId,
          entry.score,
          entry.evidence,
          entry.memoryType,
          entry.scope,
          entry.pinned ? 1 : 0,
          entry.truncated ? 1 : 0,
          entry.characters,
          now,
        );
      }
    });
  }

  getTurnMemories(messageId: string): TurnMemoryEvidence[] {
    const rows = this.db
      .prepare(
        `SELECT memory_id, score, evidence, memory_type, scope, pinned, truncated, characters
         FROM turn_memories WHERE message_id = ? ORDER BY score DESC, memory_id ASC`,
      )
      .all(messageId) as unknown as TurnMemoryRow[];

    return rows.map((row) => {
      const memory = this.resolveMemory(row.memory_id);
      return {
        memory_id: row.memory_id,
        score: row.score,
        evidence: row.evidence,
        memory_type: row.memory_type as TurnMemoryEvidence['memory_type'],
        scope: row.scope === 'global' ? 'global' : 'project',
        pinned: row.pinned === 1,
        truncated: row.truncated === 1,
        characters: row.characters,
        memory,
        memory_available: memory !== null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Aggregate
  // -------------------------------------------------------------------------

  getSessionDetail(id: string): SessionDetail {
    const session = this.requireSession(id);
    return { ...session, messages: this.listMessages(id) };
  }
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status === 'archived' ? 'archived' : 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
    message_count: row.message_count,
    last_message_at: row.last_message_at,
  };
}

function mapMessage(row: MessageRow): Message {
  let context: ContextReport | null = null;
  if (row.context_json) {
    try {
      const parsed = ContextReportSchema.safeParse(JSON.parse(row.context_json));
      context = parsed.success ? parsed.data : null;
    } catch {
      context = null;
    }
  }

  return {
    id: row.id,
    session_id: row.session_id,
    sequence: row.sequence,
    role: row.role === 'assistant' || row.role === 'system' ? row.role : 'user',
    content: row.content,
    status:
      row.status === 'interrupted' || row.status === 'failed' ? row.status : ('complete' as const),
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    latency_ms: row.latency_ms,
    context,
    created_at: row.created_at,
  };
}

/** First line of the first user message, trimmed to a sidebar-friendly length. */
function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? content;
  const trimmed = firstLine.trim();
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}…`;
}
