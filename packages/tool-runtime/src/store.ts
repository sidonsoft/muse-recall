import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { type ToolCall, ToolCallSchema, type ToolCallStatus } from '@mml/shared';

/**
 * Tool-call audit store.
 *
 * Every requested call is written before it runs, and updated with its outcome.
 * Invalid and denied calls are recorded too — an audit log that only contains
 * successes cannot answer "did the agent try something it should not have?".
 */

interface ToolCallRow {
  id: string;
  session_id: string;
  message_id: string | null;
  project_id: string | null;
  tool_id: string;
  arguments_json: string;
  status: string;
  requires_confirmation: number;
  result_json: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
}

export interface CreateToolCallInput {
  sessionId: string;
  projectId: string | null;
  toolId: string;
  arguments: unknown;
  status: ToolCallStatus;
  requiresConfirmation: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export class ToolCallStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: CreateToolCallInput): ToolCall {
    const id = randomUUID();
    const at = this.now().toISOString();
    const executed = input.status === 'executed' || input.status === 'failed';

    this.db
      .prepare(
        `INSERT INTO tool_calls
           (id, session_id, message_id, project_id, tool_id, arguments_json, status,
            requires_confirmation, result_json, error, duration_ms, created_at,
            decided_at, executed_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.projectId,
        input.toolId,
        JSON.stringify(input.arguments ?? {}),
        input.status,
        input.requiresConfirmation ? 1 : 0,
        input.result === undefined ? null : JSON.stringify(input.result),
        input.error ?? null,
        input.durationMs ?? null,
        at,
        input.status === 'pending' ? null : at,
        executed ? at : null,
      );

    const call = this.get(id);
    if (!call) throw new Error('failed to store tool call');
    return call;
  }

  get(id: string): ToolCall | null {
    const row = this.db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as unknown as
      | ToolCallRow
      | undefined;
    return row ? mapCall(row) : null;
  }

  listBySession(sessionId: string): ToolCall[] {
    const rows = this.db
      .prepare('SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC, id ASC')
      .all(sessionId) as unknown as ToolCallRow[];
    return rows.map(mapCall);
  }

  attachMessage(callIds: string[], messageId: string): void {
    if (callIds.length === 0) return;
    const statement = this.db.prepare('UPDATE tool_calls SET message_id = ? WHERE id = ?');
    for (const id of callIds) statement.run(messageId, id);
  }

  complete(
    id: string,
    update: {
      status: Extract<ToolCallStatus, 'executed' | 'failed'>;
      result?: unknown;
      error?: string;
      durationMs?: number;
    },
  ): ToolCall {
    const at = this.now().toISOString();
    this.db
      .prepare(
        `UPDATE tool_calls SET status = ?, result_json = ?, error = ?, duration_ms = ?,
           decided_at = COALESCE(decided_at, ?), executed_at = ? WHERE id = ?`,
      )
      .run(
        update.status,
        update.result === undefined ? null : JSON.stringify(update.result),
        update.error ?? null,
        update.durationMs ?? null,
        at,
        at,
        id,
      );
    const call = this.get(id);
    if (!call) throw new Error(`tool call ${id} disappeared`);
    return call;
  }

  decide(id: string, status: Extract<ToolCallStatus, 'denied' | 'executed' | 'failed'>): ToolCall {
    const at = this.now().toISOString();
    this.db
      .prepare('UPDATE tool_calls SET status = ?, decided_at = ? WHERE id = ?')
      .run(status, at, id);
    const call = this.get(id);
    if (!call) throw new Error(`tool call ${id} disappeared`);
    return call;
  }
}

function mapCall(row: ToolCallRow): ToolCall {
  return ToolCallSchema.parse({
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id,
    tool: row.tool_id,
    arguments: JSON.parse(row.arguments_json) as Record<string, unknown>,
    status: row.status,
    requires_confirmation: row.requires_confirmation === 1,
    result: row.result_json === null ? null : (JSON.parse(row.result_json) as unknown),
    error: row.error,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
    decided_at: row.decided_at,
    executed_at: row.executed_at,
  });
}
