import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type FieldValue,
  parseStoredSurface,
  type UiEvent,
  type UiSurface,
  type UiSurfaceRecord,
  UiSurfaceRecordSchema,
} from '@mml/ui-protocol';

/**
 * Storage for generated interfaces and their submissions.
 *
 * Specs are re-validated on read: a row corrupted at rest can never reach the
 * renderer.
 */

interface SurfaceRow {
  id: string;
  session_id: string;
  message_id: string | null;
  title: string;
  spec_json: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
}

interface EventRow {
  id: string;
  surface_id: string;
  action_id: string;
  values_json: string;
  created_at: string;
}

export class UiSurfaceStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { sessionId: string; messageId: string | null; spec: UiSurface }): UiSurfaceRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ui_surfaces (id, session_id, message_id, title, spec_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(id, input.sessionId, input.messageId, input.spec.title, JSON.stringify(input.spec), now);

    const record = this.get(id);
    if (!record) throw new Error('failed to store ui surface');
    return record;
  }

  get(id: string): UiSurfaceRecord | null {
    const row = this.db.prepare('SELECT * FROM ui_surfaces WHERE id = ?').get(id) as unknown as
      | SurfaceRow
      | undefined;
    return row ? this.map(row) : null;
  }

  listBySession(sessionId: string): UiSurfaceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM ui_surfaces WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as unknown as SurfaceRow[];
    return rows.map((row) => this.map(row));
  }

  recordEvent(surfaceId: string, actionId: string, values: Record<string, FieldValue>): UiEvent {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO ui_events (id, surface_id, action_id, values_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, surfaceId, actionId, JSON.stringify(values), now);
    return { id, surface_id: surfaceId, action_id: actionId, values, created_at: now };
  }

  markSubmitted(surfaceId: string): void {
    this.db
      .prepare("UPDATE ui_surfaces SET status = 'submitted', submitted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), surfaceId);
  }

  private map(row: SurfaceRow): UiSurfaceRecord {
    const events = (
      this.db
        .prepare('SELECT * FROM ui_events WHERE surface_id = ? ORDER BY created_at ASC')
        .all(row.id) as unknown as EventRow[]
    ).map((event) => ({
      id: event.id,
      surface_id: event.surface_id,
      action_id: event.action_id,
      values: JSON.parse(event.values_json) as Record<string, FieldValue>,
      created_at: event.created_at,
    }));

    return UiSurfaceRecordSchema.parse({
      id: row.id,
      session_id: row.session_id,
      message_id: row.message_id,
      title: row.title,
      spec: parseStoredSurface(JSON.parse(row.spec_json)),
      status: row.status,
      created_at: row.created_at,
      submitted_at: row.submitted_at,
      events,
    });
  }
}
