import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MemoryConflictError,
  MemoryNotFoundError,
} from '../../packages/memory-engine/src/errors.js';
import { MIGRATIONS } from '../../packages/memory-engine/src/migrations.js';

/**
 * Roadmap §6 record contract: every memory carries an explicit `revision`
 * and an `actor`, and `proposed` is a real lifecycle state. Migration v7 is
 * the risky half — it rebuilds `memories` under CHECK constraints and must
 * leave audit, supersession edges and the FTS index intact.
 */

function applyThrough(targetVersion: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of MIGRATIONS) {
    if (migration.version > targetVersion) break;
    db.exec('BEGIN');
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      migration.version,
      migration.name,
      new Date().toISOString(),
    );
    db.exec('COMMIT');
  }
  return db;
}

const PROJECT_ID = 'contract-project';

/** Seed a pre-contract database: one memory, its audit trail, an edge. */
function legacyDatabase(): DatabaseSync {
  const db = applyThrough(6);
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO projects (id, name, description, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)`,
  ).run(PROJECT_ID, 'contract', now, now);
  db.prepare(
    `INSERT INTO memories
       (id, type, scope, project_id, content, source_session_id, source_reference,
        confidence, validation_status, status, created_at, updated_at, expires_at,
        content_hash, tags)
     VALUES ('11111111-1111-4111-8111-111111111111', 'constraint', 'project', ?, ?,
             NULL, NULL, 0.8, 'verified', 'active', ?, ?, NULL, 'hash-1', '[]')`,
  ).run(PROJECT_ID, 'Use the ocean palette everywhere.', now, now);
  db.prepare(
    `INSERT INTO memories
       (id, type, scope, project_id, content, source_session_id, source_reference,
        confidence, validation_status, status, created_at, updated_at, expires_at,
        content_hash, tags)
     VALUES ('22222222-2222-4222-8222-222222222222', 'preference', 'project', ?, ?,
             NULL, NULL, 0.5, 'unverified', 'active', ?, ?, NULL, 'hash-2', '[]')`,
  ).run(PROJECT_ID, 'Prefers keyboard shortcuts.', now, now);
  db.prepare(
    `INSERT INTO memory_history
       (id, memory_id, action, previous_status, next_status, reason, actor, at)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'created', NULL, 'active', NULL, 'agent', ?),
            ('aaaaaaaa-0000-4000-8000-000000000002',
             '11111111-1111-4111-8111-111111111111', 'updated', 'active', 'active', 'tone', 'agent', ?)`,
  ).run(now, '2026-01-02T00:00:00.000Z');
  db.prepare(
    `INSERT INTO memory_supersessions (new_id, old_id, created_at)
     VALUES ('11111111-1111-4111-8111-111111111111',
             '22222222-2222-4222-8222-222222222222', ?)`,
  ).run(now);
  return db;
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map(
    (row) => row.name,
  );
}

describe('migration v7 — record contract columns', () => {
  it('adds revision and actor and backfills both from the audit trail', () => {
    const db = legacyDatabase();
    expect(columns(db, 'memories')).not.toContain('revision');

    const migration = MIGRATIONS.find((entry) => entry.version === 7);
    expect(migration).toBeDefined();
    db.exec('BEGIN');
    migration!.up(db);
    db.exec('COMMIT');

    expect(columns(db, 'memories')).toEqual(expect.arrayContaining(['revision', 'actor']));
    const rows = db
      .prepare('SELECT id, revision, actor FROM memories ORDER BY id')
      .all() as unknown as Array<{ id: string; revision: number; actor: string }>;
    expect(rows).toHaveLength(2);
    // Audited record: the latest transition was performed by an agent.
    expect(rows[0]).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      actor: 'agent',
    });
    // No audit trail: only the pre-contract HTTP user could have written it.
    expect(rows[1]).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      revision: 1,
      actor: 'user',
    });
  });

  it('keeps audit rows, supersession edges and the FTS index usable', () => {
    const db = legacyDatabase();
    const migration = MIGRATIONS.find((entry) => entry.version === 7)!;
    db.exec('BEGIN');
    migration.up(db);
    db.exec('COMMIT');

    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM memory_history
           WHERE memory_id = '11111111-1111-4111-8111-111111111111'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_supersessions').get()).toEqual({
      count: 1,
    });

    // The rebuilt table and the untouched FTS copy must agree: the pre-existing
    // memory is still findable by keyword.
    const hits = db
      .prepare(`SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'ocean'`)
      .all() as unknown as { memory_id: string }[];
    expect(hits.map((hit) => hit.memory_id)).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('accepts the new actions and lifecycle state, and keeps rejecting invalid ones', () => {
    const db = legacyDatabase();
    const migration = MIGRATIONS.find((entry) => entry.version === 7)!;
    db.exec('BEGIN');
    migration.up(db);
    db.exec('COMMIT');

    expect(() =>
      db
        .prepare(
          `INSERT INTO memories
             (id, type, scope, project_id, content, source_session_id, source_reference,
              confidence, validation_status, status, created_at, updated_at, expires_at,
              content_hash, tags)
           VALUES ('33333333-3333-4333-8333-333333333333', 'goal', 'project', ?, ?,
                   NULL, NULL, 0.7, 'unverified', 'proposed', '2026-01-03T00:00:00.000Z',
                   '2026-01-03T00:00:00.000Z', NULL, 'hash-3', '[]')`,
        )
        .run(PROJECT_ID, 'Awaiting review'),
    ).not.toThrow();

    // FTS triggers were reattached by the rebuild.
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM memory_fts WHERE memory_fts MATCH 'review'`).get(),
    ).toEqual({ count: 1 });

    // The widened action CHECK accepts the new transitions...
    expect(() =>
      db
        .prepare(
          `INSERT INTO memory_history
             (id, memory_id, action, previous_status, next_status, reason, actor, at)
           VALUES ('bbbbbbbb-0000-4000-8000-000000000001',
                   '33333333-3333-4333-8333-333333333333', 'accepted', 'proposed', 'active',
                   NULL, 'user', '2026-01-03T00:00:00.000Z')`,
        )
        .run(),
    ).not.toThrow();

    // ...while the lifecycle CHECK stays strict about unknown states, and a
    // revision can never go backwards.
    expect(() =>
      db
        .prepare(
          `INSERT INTO memories
             (id, type, scope, project_id, content, source_session_id, source_reference,
              confidence, validation_status, status, created_at, updated_at, expires_at,
              content_hash, tags)
           VALUES ('44444444-4444-4444-8444-444444444444', 'goal', 'project', ?, ?,
                   NULL, NULL, 0.7, 'unverified', 'drafted', '2026-01-03T00:00:00.000Z',
                   '2026-01-03T00:00:00.000Z', NULL, 'hash-4', '[]')`,
        )
        .run(PROJECT_ID, 'Not a real state'),
    ).toThrow(/CHECK constraint/i);
    expect(() =>
      db
        .prepare(`UPDATE memories SET revision = 0 WHERE id = ?`)
        .run('33333333-3333-4333-8333-333333333333'),
    ).toThrow(/CHECK constraint/i);
  });
});

describe('engine — record contract and proposals', () => {
  it('reuses the migration path and reports contract fields on every write', async () => {
    const { MemoryEngine } = await import('../../packages/memory-engine/src/engine.js');
    const { openDatabase } = await import('../../packages/memory-engine/src/db.js');
    const { db } = openDatabase({ path: ':memory:' });
    const engine = new MemoryEngine(db);

    const created = engine.create({
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'Ship with accessible focus states.',
      tags: ['a11y'],
    });
    expect(created.memory.revision).toBe(1);
    expect(created.memory.actor).toBe('user');

    const updated = engine.update(
      created.memory.id,
      { confidence: 0.9 },
      'agent', // agent-driven refinement
    );
    expect(updated.revision).toBe(2);
    expect(updated.actor).toBe('agent');

    // A stale read must fail loudly rather than overwrite.
    let conflict: MemoryConflictError | null = null;
    try {
      engine.update(created.memory.id, { confidence: 0.4, expected_revision: 1 }, 'user');
    } catch (error) {
      conflict = error as MemoryConflictError;
    }
    expect(conflict).toBeInstanceOf(MemoryConflictError);
    expect(conflict?.details).toMatchObject({
      expected_revision: 1,
      current_revision: 2,
    });

    const fresh = engine.get(created.memory.id);
    expect(fresh?.confidence).toBe(0.9);
    expect(fresh?.revision).toBe(2);
    db.close();
  });

  it('keeps proposals out of retrieval until a user accepts them', async () => {
    const { MemoryEngine } = await import('../../packages/memory-engine/src/engine.js');
    const { openDatabase } = await import('../../packages/memory-engine/src/db.js');
    const { retrieveMemories } = await import('../../packages/memory-engine/src/retrieval.js');
    const { db } = openDatabase({ path: ':memory:' });
    const engine = new MemoryEngine(db);

    const proposal = engine.propose({
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'Every screen must pass contrast checks.',
    });
    expect(proposal.created).toBe(true);
    expect(proposal.memory.status).toBe('proposed');
    expect(proposal.memory.actor).toBe('agent'); // default proposer is the agent

    // Invisible to retrieval and to the default inspector query...
    const before = retrieveMemories(db, {
      query: 'contrast checks',
      project_id: PROJECT_ID,
    });
    expect(before.results.map((hit) => hit.memory.id)).not.toContain(proposal.memory.id);
    expect(engine.list({ project_id: PROJECT_ID }).items).toHaveLength(0);
    // ...but explicitly listable, and it counts separately in stats.
    expect(
      engine.list({ project_id: PROJECT_ID, status: ['proposed'] }).items.map((m) => m.id),
    ).toContain(proposal.memory.id);
    expect(engine.stats().proposed).toBe(1);

    // Idempotency both ways: same content twice does not stack up...
    const replay = engine.propose({
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'Every screen must pass contrast checks.',
    });
    expect(replay.created).toBe(false);
    expect(replay.memory.id).toBe(proposal.memory.id);

    const accepted = engine.acceptProposal(proposal.memory.id, { reason: 'user review' });
    expect(accepted.status).toBe('active');
    expect(accepted.revision).toBe(2);
    expect(accepted.actor).toBe('user');
    const after = retrieveMemories(db, { query: 'contrast checks', project_id: PROJECT_ID });
    expect(after.results.map((hit) => hit.memory.id)).toContain(proposal.memory.id);

    const actions = engine.history(proposal.memory.id).map((entry) => entry.action);
    expect(actions).toEqual(['created', 'accepted']);
    db.close();
  });

  it('rejects a proposal as a tombstone with its own audit action', async () => {
    const { MemoryEngine } = await import('../../packages/memory-engine/src/engine.js');
    const { openDatabase } = await import('../../packages/memory-engine/src/db.js');
    const { db } = openDatabase({ path: ':memory:' });
    const engine = new MemoryEngine(db);

    const proposal = engine.propose({
      type: 'preference',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'Always log to stderr instead of stdout.',
    });
    engine.rejectProposal(proposal.memory.id, { reason: 'conflicts with the CLI contract' });

    expect(engine.get(proposal.memory.id)).toBeNull(); // deleted rows are not addressable
    const tombstone = engine.get(proposal.memory.id, { includeDeleted: true });
    expect(tombstone?.status).toBe('deleted');
    expect(tombstone?.revision).toBe(2);

    // `history()` deliberately refuses tombstones (deleted records are not
    // addressable), so the audit action is verified from the trail itself.
    const entries = db
      .prepare(
        `SELECT action, previous_status, next_status, reason FROM memory_history
         WHERE memory_id = ? ORDER BY at ASC, rowid ASC`,
      )
      .all(proposal.memory.id) as unknown as Array<{
      action: string;
      previous_status: string | null;
      next_status: string;
      reason: string | null;
    }>;
    expect(entries.map((entry) => entry.action)).toEqual(['created', 'rejected']);
    expect(entries[1]).toMatchObject({
      previous_status: 'proposed',
      next_status: 'deleted',
      reason: 'conflicts with the CLI contract',
    });

    // A rejected proposal is a tombstone: not addressable at all, like any
    // deleted record. Established facts are not candidates: deciding them is
    // a conflict, not a silent transition.
    expect(() => engine.acceptProposal(proposal.memory.id)).toThrow(MemoryNotFoundError);
    const established = engine.create({
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'An established project decision.',
    });
    expect(() => engine.acceptProposal(established.memory.id)).toThrow(MemoryConflictError);
    expect(() => engine.rejectProposal(established.memory.id)).toThrow(MemoryConflictError);
    db.close();
  });

  it('bumps revision and actor on correction, expiry and deletion', async () => {
    const { MemoryEngine } = await import('../../packages/memory-engine/src/engine.js');
    const { openDatabase } = await import('../../packages/memory-engine/src/db.js');
    const { db } = openDatabase({ path: ':memory:' });
    const engine = new MemoryEngine(db);

    const old = engine.create({
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'Use the sunset palette.',
      expires_at: '2020-01-01T00:00:00.000Z',
    });
    const correction = engine.correct(
      {
        type: 'constraint',
        scope: 'project',
        project_id: PROJECT_ID,
        content: 'Use the ocean palette instead.',
        supersedes: [old.memory.id],
        reason: 'user changed direction',
      },
      'user',
    );
    expect(correction.memory.revision).toBe(1);
    expect(correction.memory.actor).toBe('user');
    const flipped = engine.get(old.memory.id);
    // Supersession is a change to the record: the counter and actor move.
    expect(flipped?.status).toBe('superseded');
    expect(flipped?.revision).toBe(2);
    expect(flipped?.actor).toBe('user');

    // Expiry is a system change, recorded as such on the row and in history.
    const expiring = engine.create({
      type: 'contextual_fact',
      scope: 'project',
      project_id: PROJECT_ID,
      content: 'The trial ran against build 42.',
      expires_at: '2020-06-01T00:00:00.000Z',
    });
    expect(engine.expireStale()).toBeGreaterThanOrEqual(1);
    const expired = engine.get(expiring.memory.id, { includeDeleted: true });
    expect(expired?.status).toBe('expired');
    expect(expired?.revision).toBe(2);
    expect(expired?.actor).toBe('system');

    engine.softDelete(correction.memory.id, { reason: 'cleanup', actor: 'agent' });
    const gone = engine.get(correction.memory.id, { includeDeleted: true });
    expect(gone?.status).toBe('deleted');
    expect(gone?.revision).toBe(2);
    expect(gone?.actor).toBe('agent');
    db.close();
  });
});
