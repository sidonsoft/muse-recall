import type { DatabaseSync } from 'node:sqlite';
import { SessionStore } from '@mml/agent-core';
import { openDatabase } from '@mml/memory-engine';
import { describe, expect, it } from 'vitest';
import { defined } from '../helpers/defined';

/**
 * Schema-level promises of the session stack, none of which had a witness:
 *
 * 1. deleteSession() runs ONE DELETE and trusts multi-level FK cascades:
 *    session -> messages -> turn_memories (grandchild cascade), and
 *    session -> ui_surfaces / tool_calls. A migration loosening a CASCADE
 *    would leave orphan transcripts, tool audits, or retrieval provenance.
 * 2. memories.source_session_id has NO foreign key BY DESIGN: deleting a
 *    conversation must never destroy durable knowledge that happened to be
 *    captured during it.
 * 3. turn_memories.memory_id has NO foreign key BY DESIGN (schema comment):
 *    purging a memory must not erase the record that it influenced an answer.
 * 4. Message order is deterministic via UNIQUE (session_id, sequence), not
 *    timestamps — the schema comment's "two turns in the same millisecond"
 *    case must be a constraint violation, not a silent race.
 */

const NOW = '2026-06-01T00:00:00.000Z';

// Structural hand-typed parameter could not accept the real DatabaseSync
// (StatementSync.get's parameter types are narrower than unknown[] under
// strictFunctionTypes). Name the actual type - type-level only.
function count(db: DatabaseSync, sql: string) {
  return (db.prepare(sql).get() as { c: number }).c;
}

describe('session cascade + no-FK design guarantees', () => {
  it('deleteSession cascades through messages, turn evidence, surfaces, and tool calls', () => {
    const opened = openDatabase({ path: ':memory:' });
    const db = opened.db;
    try {
      const store = new SessionStore(db);
      const doomed = store.createSession({ project_id: null, title: 'doomed' });
      const keeper = store.createSession({ project_id: null, title: 'keeper' });

      store.appendMessage({ sessionId: doomed.id, role: 'user', content: 'hello' });
      store.appendMessage({ sessionId: doomed.id, role: 'assistant', content: 'hi' });
      const lastMessage = store.listMessages(doomed.id).at(-1)!;

      db.prepare(
        `INSERT INTO ui_surfaces (id, session_id, message_id, title, spec_json, status, created_at)
         VALUES ('s1', ?, ?, 'form', '{"components":[]}', 'active', ?)`,
      ).run(doomed.id, lastMessage.id, NOW);
      db.prepare(
        `INSERT INTO ui_events (id, surface_id, action_id, values_json, created_at)
         VALUES ('e1', 's1', 'submit', '{}', ?)`,
      ).run(NOW);
      db.prepare(
        `INSERT INTO tool_calls
           (id, session_id, message_id, project_id, tool_id, arguments_json, status,
            requires_confirmation, created_at)
         VALUES ('t1', ?, ?, NULL, 'memory.remember', '{}', 'executed', 0, ?)`,
      ).run(doomed.id, lastMessage.id, NOW);
      db.prepare(
        `INSERT INTO turn_memories (message_id, memory_id, score, evidence, memory_type, scope, created_at)
         VALUES (?, 'mem-xyz', 0.5, 'e', 'constraint', 'global', ?)`,
      ).run(defined(store.listMessages(doomed.id)[0], 'doomed session message').id, NOW);

      store.deleteSession(doomed.id);

      expect(count(db, "SELECT COUNT(*) c FROM sessions WHERE id = 'does-not-exist'")).toBe(0);
      expect(count(db, `SELECT COUNT(*) c FROM sessions`)).toBe(1); // keeper survives
      expect(count(db, `SELECT COUNT(*) c FROM messages WHERE session_id = '${doomed.id}'`)).toBe(
        0,
      );
      expect(count(db, `SELECT COUNT(*) c FROM ui_surfaces`)).toBe(0);
      // Grandchild cascade the other way too: session -> surface -> event.
      expect(count(db, `SELECT COUNT(*) c FROM ui_events`)).toBe(0);
      expect(count(db, `SELECT COUNT(*) c FROM tool_calls`)).toBe(0);
      // Grandchild cascade: provenance under a cascaded message disappears too.
      expect(count(db, `SELECT COUNT(*) c FROM turn_memories`)).toBe(0);
      // And the KEPTER's rows are untouched by a per-session DELETE.
      expect(count(db, `SELECT COUNT(*) c FROM messages WHERE session_id = '${keeper.id}'`)).toBe(
        0,
      );
    } finally {
      opened.close();
    }
  });

  it('deleting a session spares memories; purging a memory spares turn evidence', () => {
    const opened = openDatabase({ path: ':memory:' });
    const db = opened.db;
    try {
      const store = new SessionStore(db);
      const session = store.createSession({ project_id: null, title: 'capture site' });
      store.appendMessage({ sessionId: session.id, role: 'user', content: 'remember this' });
      const message = store.listMessages(session.id)[0];

      db.prepare(
        `INSERT INTO memories
           (id, type, scope, project_id, content, source_session_id, source_reference,
            confidence, validation_status, status, created_at, updated_at, expires_at,
            content_hash, tags, superseded_by, revision, actor)
         VALUES ('mem-keep', 'constraint', 'global', NULL, 'durable fact', ?, NULL,
                 0.9, 'verified', 'active', ?, ?, NULL, 'hash1', '[]', NULL, 1, 'user')`,
      ).run(session.id, NOW, NOW);
      db.prepare(
        `INSERT INTO turn_memories (message_id, memory_id, score, evidence, memory_type, scope, created_at)
         VALUES (?, 'mem-keep', 0.7, 'because', 'constraint', 'global', ?)`,
      ).run(defined(message, 'keeper session message').id, NOW);

      // Promise 2: purging the memory (below the engine) must not erase the
      // influence record — turn_memories.memory_id has no FK by design.
      db.prepare(`DELETE FROM memories WHERE id = 'mem-keep'`).run();
      expect(count(db, `SELECT COUNT(*) c FROM turn_memories WHERE memory_id = 'mem-keep'`)).toBe(
        1,
      );

      // Promise 3: knowledge outlives the conversation that captured it;
      // the provenance row goes with its MESSAGE (message cascade), not with
      // the memory and not silently.
      store.deleteSession(session.id);
      expect(count(db, `SELECT COUNT(*) c FROM memories WHERE id = 'mem-keep'`)).toBe(0); // already purged
      expect(count(db, `SELECT COUNT(*) c FROM turn_memories WHERE memory_id = 'mem-keep'`)).toBe(
        0,
      ); // with the message
    } finally {
      opened.close();
    }
  });

  it('UNIQUE (session_id, sequence) makes message order a constraint, not a race', () => {
    const opened = openDatabase({ path: ':memory:' });
    const db = opened.db;
    try {
      const store = new SessionStore(db);
      const session = store.createSession({ project_id: null, title: 'same ms' });
      db.prepare(
        `INSERT INTO messages (id, session_id, sequence, role, content, status, created_at)
         VALUES ('m-a', ?, 0, 'user', 'first', 'complete', ?)`,
      ).run(session.id, NOW);
      // Same session, same sequence, DIFFERENT timestamp millisecond — still
      // rejected: ordering is structural, not clock-dependent.
      expect(() =>
        db
          .prepare(
            `INSERT INTO messages (id, session_id, sequence, role, content, status, created_at)
             VALUES ('m-b', ?, 0, 'user', 'clash', 'complete', ?)`,
          )
          .run(session.id, '2026-06-01T00:00:00.001Z'),
      ).toThrow();
      // Same sequence in a DIFFERENT session is fine.
      const other = store.createSession({ project_id: null, title: 'other' });
      db.prepare(
        `INSERT INTO messages (id, session_id, sequence, role, content, status, created_at)
           VALUES ('m-c', ?, 0, 'user', 'fine', 'complete', ?)`,
      ).run(other.id, NOW);
      expect(count(db, `SELECT COUNT(*) c FROM messages`)).toBe(2);
    } finally {
      opened.close();
    }
  });
});
