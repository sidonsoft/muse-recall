import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  MemoryConflictError,
  MemoryEngine,
  MemoryNotFoundError,
  openDatabase,
  retrieveMemories,
} from '@mml/memory-engine';
import type { Memory, MemoryCreateInput } from '@mml/shared';
import { afterAll, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function baseInput(overrides: Partial<MemoryCreateInput> = {}): MemoryCreateInput {
  return {
    type: 'technical_decision',
    scope: 'project',
    project_id: 'demo-game',
    content: 'Use SQLite for persistent storage',
    ...overrides,
  };
}

function seeded(): { engine: MemoryEngine; db: DatabaseSync; close: () => void } {
  const opened = openDatabase({ path: ':memory:' });
  return { engine: new MemoryEngine(opened.db), db: opened.db, close: opened.close };
}

describe('persistence', () => {
  it('survives a close and reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mml-memory-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'memory.db');

    const first = openDatabase({ path });
    const engineA = new MemoryEngine(first.db);
    const created = engineA.create(baseInput());
    first.close();

    const second = openDatabase({ path });
    const engineB = new MemoryEngine(second.db);
    try {
      const loaded = engineB.get(created.memory.id);
      expect(loaded?.content).toBe('Use SQLite for persistent storage');
      expect(loaded?.source).toEqual({ session_id: null, reference: null });
      expect(loaded?.status).toBe('active');
      expect(engineB.list({ project_id: 'demo-game' }).total).toBe(1);
    } finally {
      second.close();
    }
  });

  it('records provenance exactly as supplied', () => {
    const { engine, close } = seeded();
    try {
      const created = engine.create(
        baseInput({
          source: { session_id: 'session-42', reference: 'architecture-decision' },
          confidence: 0.95,
          validation_status: 'verified',
          tags: ['database', 'architecture'],
        }),
      );
      expect(created.memory.source).toEqual({
        session_id: 'session-42',
        reference: 'architecture-decision',
      });
      expect(created.memory.confidence).toBe(0.95);
      expect(created.memory.tags).toEqual(['database', 'architecture']);
    } finally {
      close();
    }
  });
});

describe('deduplication', () => {
  it('returns the existing memory instead of inserting a duplicate', () => {
    const { engine, close } = seeded();
    try {
      const first = engine.create(baseInput());
      const second = engine.create(baseInput());

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.memory.id).toBe(first.memory.id);
      expect(engine.stats().active).toBe(1);
    } finally {
      close();
    }
  });

  it('treats casing and whitespace variants as the same claim', () => {
    const { engine, close } = seeded();
    try {
      const first = engine.create(baseInput({ content: 'Use SQLite for persistent storage' }));
      const second = engine.create(
        baseInput({ content: '  use   SQLITE for  persistent storage ' }),
      );
      expect(second.memory.id).toBe(first.memory.id);
      expect(engine.stats().active).toBe(1);
    } finally {
      close();
    }
  });

  it('does not deduplicate across different types or projects', () => {
    const { engine, close } = seeded();
    try {
      engine.create(baseInput());
      engine.create(baseInput({ type: 'constraint' }));
      engine.create(baseInput({ project_id: 'other-project' }));
      expect(engine.stats().active).toBe(3);
    } finally {
      close();
    }
  });
});

describe('corrections', () => {
  it('supersedes atomically and keeps the old record as history', () => {
    const { engine, close } = seeded();
    try {
      const original = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const corrected = engine.correct({
        supersedes: [original.memory.id],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'Use Postgres for storage',
        confidence: 0.95,
        validation_status: 'verified',
      });

      expect(corrected.created).toBe(true);
      expect(corrected.superseded.map((memory) => memory.id)).toEqual([original.memory.id]);

      const old = engine.get(original.memory.id);
      expect(old?.status).toBe('superseded');
      expect(old?.superseded_by).toBe(corrected.memory.id);
      expect(old?.content).toBe('Use SQLite for storage'); // history is immutable

      const detail = engine.getDetail(original.memory.id);
      expect(detail.superseded_by?.id).toBe(corrected.memory.id);
      expect(detail.history.map((entry) => entry.action)).toEqual(['created', 'superseded']);

      const newDetail = engine.getDetail(corrected.memory.id);
      expect(newDetail.supersedes.map((memory) => memory.id)).toEqual([original.memory.id]);
    } finally {
      close();
    }
  });

  it('excludes superseded memories from active retrieval', () => {
    const { engine, close, db } = seeded();
    try {
      const original = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const corrected = engine.correct({
        supersedes: [original.memory.id],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'Use Postgres for storage',
      });

      const result = retrieveMemories(db, { project_id: 'demo-game', query: 'storage' });
      const ids = result.results.map((entry) => entry.memory.id);
      expect(ids).toContain(corrected.memory.id);
      expect(ids).not.toContain(original.memory.id);
    } finally {
      close();
    }
  });

  it('is idempotent — replaying the same correction does not fork the chain', () => {
    const { engine, close } = seeded();
    try {
      const original = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const input = {
        supersedes: [original.memory.id],
        type: 'technical_decision' as const,
        project_id: 'demo-game',
        content: 'Use Postgres for storage',
      };

      const first = engine.correct(input);
      const replay = engine.correct(input);

      expect(replay.created).toBe(false);
      expect(replay.memory.id).toBe(first.memory.id);
      expect(engine.stats().active).toBe(1);
      expect(engine.stats().superseded).toBe(1);
    } finally {
      close();
    }
  });

  it('can supersede several memories with one replacement', () => {
    const { engine, close } = seeded();
    try {
      const a = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const b = engine.create(baseInput({ content: 'Store data in SQLite' }));
      const corrected = engine.correct({
        supersedes: [a.memory.id, b.memory.id],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'Use Postgres for all storage',
      });

      expect(corrected.superseded).toHaveLength(2);
      expect(engine.get(a.memory.id)?.status).toBe('superseded');
      expect(engine.get(b.memory.id)?.status).toBe('superseded');
      expect(engine.getDetail(corrected.memory.id).supersedes).toHaveLength(2);
    } finally {
      close();
    }
  });

  it('rejects a correction whose target does not exist', () => {
    const { engine, close } = seeded();
    try {
      expect(() =>
        engine.correct({
          supersedes: [randomUUID()],
          type: 'technical_decision',
          project_id: 'demo-game',
          content: 'Anything',
        }),
      ).toThrow(MemoryNotFoundError);
    } finally {
      close();
    }
  });

  it('rolls back the whole correction when a later step fails', () => {
    const { engine, db, close } = seeded();
    try {
      const original = engine.create(baseInput({ content: 'Use SQLite for storage' }));

      // Force a failure after the replacement row has been inserted but before
      // the supersession completes.
      db.exec(`
        CREATE TRIGGER force_supersede_failure
        BEFORE UPDATE OF status ON memories
        WHEN NEW.status = 'superseded'
        BEGIN
          SELECT RAISE(ABORT, 'forced failure');
        END;
      `);

      expect(() =>
        engine.correct({
          supersedes: [original.memory.id],
          type: 'technical_decision',
          project_id: 'demo-game',
          content: 'Use Postgres for storage',
        }),
      ).toThrow(/forced failure/);

      // Nothing from the failed attempt survives.
      const rows = db.prepare('SELECT content, status FROM memories').all() as unknown as {
        content: string;
        status: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ content: 'Use SQLite for storage', status: 'active' });
      expect(engine.getDetail(original.memory.id).history).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('reuses an existing active memory instead of duplicating the new fact', () => {
    const { engine, close } = seeded();
    try {
      const existing = engine.create(baseInput({ content: 'Use Postgres for storage' }));
      const original = engine.create(baseInput({ content: 'Use MySQL for storage' }));

      const corrected = engine.correct({
        supersedes: [original.memory.id],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'use postgres FOR storage',
      });

      expect(corrected.created).toBe(false);
      expect(corrected.memory.id).toBe(existing.memory.id);
      expect(engine.stats().active).toBe(1);
      expect(engine.get(original.memory.id)?.superseded_by).toBe(existing.memory.id);
    } finally {
      close();
    }
  });
});

describe('deletion', () => {
  it('removes content from every read path and from the FTS index', () => {
    const { engine, db, close } = seeded();
    try {
      const created = engine.create(baseInput({ content: 'Use SQLite for persistent storage' }));
      engine.softDelete(created.memory.id, { reason: 'user retracted it' });

      expect(engine.get(created.memory.id)).toBeNull();
      expect(engine.list({ project_id: 'demo-game' }).total).toBe(0);
      expect(() => engine.getDetail(created.memory.id)).toThrow(MemoryNotFoundError);
      expect(() => engine.history(created.memory.id)).toThrow(MemoryNotFoundError);

      const ftsMatches = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('sqlite');
      expect(ftsMatches).toHaveLength(0);

      const result = retrieveMemories(db, { project_id: 'demo-game', query: 'sqlite' });
      expect(result.results).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('keeps a tombstone internally while refusing to serve it', () => {
    const { engine, db, close } = seeded();
    try {
      const created = engine.create(baseInput());
      engine.softDelete(created.memory.id);

      const row = db
        .prepare('SELECT status, content FROM memories WHERE id = ?')
        .get(created.memory.id) as unknown as { status: string; content: string };
      expect(row.status).toBe('deleted');
      expect(row.content).toBe('Use SQLite for persistent storage');

      expect(engine.get(created.memory.id, { includeDeleted: true })?.status).toBe('deleted');
      expect(engine.stats()).toMatchObject({ active: 0, deleted: 1 });
    } finally {
      close();
    }
  });

  it('never returns deleted rows even when explicitly requested', () => {
    const { engine, close } = seeded();
    try {
      const created = engine.create(baseInput());
      engine.softDelete(created.memory.id);
      expect(engine.list({ status: ['deleted'], all_projects: true })).toMatchObject({
        items: [],
        total: 0,
      });
    } finally {
      close();
    }
  });

  it('records the deletion in history with the reason', () => {
    const { engine, db, close } = seeded();
    try {
      const created = engine.create(baseInput());
      engine.softDelete(created.memory.id, { reason: 'wrong project', actor: 'user' });

      const history = db
        .prepare(
          'SELECT action, reason, previous_status, next_status FROM memory_history WHERE memory_id = ?',
        )
        .all(created.memory.id) as unknown as {
        action: string;
        reason: string | null;
        previous_status: string | null;
        next_status: string;
      }[];

      expect(history.map((entry) => entry.action)).toEqual(['created', 'deleted']);
      expect(history[1]).toMatchObject({
        reason: 'wrong project',
        previous_status: 'active',
        next_status: 'deleted',
      });
    } finally {
      close();
    }
  });

  it('only purges deleted or expired records', () => {
    const { engine, close } = seeded();
    try {
      const active = engine.create(baseInput());
      expect(() => engine.purge(active.memory.id)).toThrow(MemoryConflictError);

      engine.softDelete(active.memory.id);
      engine.purge(active.memory.id);
      expect(engine.get(active.memory.id, { includeDeleted: true })).toBeNull();
    } finally {
      close();
    }
  });
});

describe('project isolation', () => {
  it('never leaks one project memory into another project', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(
        baseInput({ project_id: 'project-a', content: 'Alpha uses SQLite for storage' }),
      );
      engine.create(
        baseInput({ project_id: 'project-b', content: 'Beta uses Postgres for storage' }),
      );
      engine.create(
        baseInput({
          scope: 'global',
          project_id: null,
          content: 'User prefers TypeScript for storage',
        }),
      );

      const resultB = retrieveMemories(db, { project_id: 'project-b', query: 'storage' });
      const contents = resultB.results.map((entry) => entry.memory.content);

      expect(contents).toContain('Beta uses Postgres for storage');
      expect(contents).not.toContain('Alpha uses SQLite for storage');
      expect(contents).toContain('User prefers TypeScript for storage');
    } finally {
      close();
    }
  });

  it('returns only global memories when no project is supplied', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(baseInput({ project_id: 'project-a', content: 'Alpha uses SQLite' }));
      engine.create(
        baseInput({ scope: 'global', project_id: null, content: 'User prefers TypeScript' }),
      );

      const result = retrieveMemories(db, { query: 'typescript' });
      expect(result.results.map((entry) => entry.memory.content)).toEqual([
        'User prefers TypeScript',
      ]);
    } finally {
      close();
    }
  });

  it('isolates lists by project but supports an explicit cross-project view', () => {
    const { engine, close } = seeded();
    try {
      engine.create(baseInput({ project_id: 'project-a' }));
      engine.create(baseInput({ project_id: 'project-b' }));

      expect(engine.list({ project_id: 'project-a' }).total).toBe(1);
      expect(engine.list({ project_id: 'project-a', include_global: false }).total).toBe(1);
      expect(engine.list({ all_projects: true }).total).toBe(2);
    } finally {
      close();
    }
  });
});

describe('retrieval budgets and evidence', () => {
  it('enforces the memory count budget and reports what was excluded', () => {
    const { engine, db, close } = seeded();
    try {
      for (let index = 0; index < 12; index += 1) {
        engine.create(
          baseInput({
            type: 'contextual_fact',
            content: `Storage fact number ${index} about databases`,
          }),
        );
      }

      const result = retrieveMemories(db, {
        project_id: 'demo-game',
        query: 'storage databases',
        budget: { max_memories: 3 },
      });

      expect(result.results).toHaveLength(3);
      expect(result.metadata.memory_budget).toBe(3);
      expect(result.metadata.selected_count).toBe(3);
      expect(result.metadata.candidate_count).toBeGreaterThanOrEqual(12);
      expect(result.metadata.excluded_count).toBe(
        result.metadata.candidate_count - result.metadata.selected_count,
      );
      expect(result.metadata.excluded_by.count_budget).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it('enforces the character budget', () => {
    const { engine, db, close } = seeded();
    try {
      for (let index = 0; index < 10; index += 1) {
        engine.create(
          baseInput({
            type: 'contextual_fact',
            content: `Storage note ${index}: ${'x'.repeat(200)}`,
          }),
        );
      }

      const result = retrieveMemories(db, {
        project_id: 'demo-game',
        query: 'storage note',
        budget: { max_memories: 10, max_characters: 500, max_memory_characters: 1_000 },
      });

      expect(result.metadata.characters_used).toBeLessThanOrEqual(500);
      expect(result.metadata.excluded_by.character_budget).toBeGreaterThan(0);
      const totalChars = result.results.reduce(
        (sum, entry) => sum + entry.injected_content.length,
        0,
      );
      expect(totalChars).toBe(result.metadata.characters_used);
    } finally {
      close();
    }
  });

  it('truncates long memories rather than dropping them', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(baseInput({ content: `SQLite ${'y'.repeat(2_000)}` }));

      const result = retrieveMemories(db, {
        project_id: 'demo-game',
        query: 'sqlite',
        budget: { max_memory_characters: 120 },
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.truncated).toBe(true);
      expect(result.results[0]?.injected_content.length).toBe(120);
      expect(result.metadata.truncated_count).toBe(1);
      expect(result.results[0]?.evidence).toContain('truncated');
    } finally {
      close();
    }
  });

  it('always includes active constraints even without a keyword match', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(
        baseInput({
          type: 'constraint',
          content: 'The game must run offline on a 2015 laptop',
          confidence: 1,
          validation_status: 'verified',
        }),
      );
      engine.create(baseInput({ content: 'Use SQLite for storage' }));

      const result = retrieveMemories(db, { project_id: 'demo-game', query: 'storage' });
      const constraint = result.results.find((entry) => entry.memory.type === 'constraint');

      expect(constraint).toBeDefined();
      expect(constraint?.pinned).toBe(true);
      expect(constraint?.evidence).toContain('pinned');
    } finally {
      close();
    }
  });

  it('produces components whose weighted sum equals the score', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(
        baseInput({ content: 'Use SQLite for storage', validation_status: 'verified' }),
      );

      const result = retrieveMemories(db, { project_id: 'demo-game', query: 'sqlite' });
      const entry = result.results[0];
      expect(entry).toBeDefined();
      if (!entry) return;

      const weights = result.metadata.weights;
      const componentSum =
        entry.rank_components.relevance * weights.relevance +
        entry.rank_components.scope * weights.scope +
        entry.rank_components.confidence * weights.confidence +
        entry.rank_components.validation * weights.validation +
        entry.rank_components.recency * weights.recency +
        entry.rank_components.type_priority * weights.type_priority;

      expect(entry.score).toBeCloseTo(componentSum, 5);
      expect(entry.evidence.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it('is deterministic across repeated identical retrievals', () => {
    const { engine, db, close } = seeded();
    try {
      for (let index = 0; index < 6; index += 1) {
        engine.create(baseInput({ content: `Storage decision ${index}` }));
      }
      const now = new Date('2026-10-27T00:00:00.000Z');
      const first = retrieveMemories(
        db,
        { project_id: 'demo-game', query: 'storage decision' },
        { now },
      );
      const second = retrieveMemories(
        db,
        { project_id: 'demo-game', query: 'storage decision' },
        { now },
      );

      expect(second.results.map((entry) => entry.memory.id)).toEqual(
        first.results.map((entry) => entry.memory.id),
      );
      expect(second.results.map((entry) => entry.score)).toEqual(
        first.results.map((entry) => entry.score),
      );
    } finally {
      close();
    }
  });

  it('excludes expired memories from retrieval', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(
        baseInput({
          content: 'Use SQLite for storage',
          expires_at: '2026-01-01T00:00:00.000Z',
        }),
      );

      const result = retrieveMemories(
        db,
        { project_id: 'demo-game', query: 'storage' },
        { now: new Date('2026-06-01T00:00:00.000Z') },
      );
      expect(result.results).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('treats hostile search text as literal terms', () => {
    const { engine, db, close } = seeded();
    try {
      engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const hostile = ['" OR 1=1 --', 'NEAR(', '*', 'sqlite OR postgres', '()"'];

      for (const query of hostile) {
        expect(() => retrieveMemories(db, { project_id: 'demo-game', query })).not.toThrow();
        expect(() => engine.list({ project_id: 'demo-game', text: query })).not.toThrow();
      }
    } finally {
      close();
    }
  });

  it('reports an empty result set without inventing metadata', () => {
    const { db, close } = seeded();
    try {
      const result = retrieveMemories(db, { project_id: 'empty', query: 'anything' });
      expect(result.results).toEqual([]);
      expect(result.metadata).toMatchObject({
        candidate_count: 0,
        selected_count: 0,
        excluded_count: 0,
        characters_used: 0,
        memory_ids: [],
      });
    } finally {
      close();
    }
  });
});

describe('lifecycle and retention', () => {
  it('expires stale memories with history', () => {
    const { engine, db, close } = seeded();
    try {
      const created = engine.create(
        baseInput({ content: 'Temporary constraint', expires_at: '2020-01-01T00:00:00.000Z' }),
      );
      expect(engine.expireStale()).toBe(1);
      expect(engine.get(created.memory.id)?.status).toBe('expired');

      const result = retrieveMemories(db, { project_id: 'demo-game', query: 'constraint' });
      expect(result.results).toHaveLength(0);

      const history = db
        .prepare("SELECT action FROM memory_history WHERE memory_id = ? AND action = 'expired'")
        .all(created.memory.id);
      expect(history).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('updates memory content and records the change', () => {
    const { engine, close } = seeded();
    try {
      const created = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      const updated = engine.update(created.memory.id, {
        content: 'Use SQLite with WAL for storage',
        confidence: 0.9,
      });

      expect(updated.content).toBe('Use SQLite with WAL for storage');
      expect(updated.confidence).toBe(0.9);
      expect(engine.getDetail(created.memory.id).history.map((entry) => entry.action)).toEqual([
        'created',
        'updated',
      ]);
    } finally {
      close();
    }
  });

  it('refuses to edit a memory into a duplicate of another active memory', () => {
    const { engine, close } = seeded();
    try {
      const first = engine.create(baseInput({ content: 'Use SQLite for storage' }));
      engine.create(baseInput({ content: 'Use Postgres for storage' }));

      expect(() => engine.update(first.memory.id, { content: 'Use Postgres for storage' })).toThrow(
        MemoryConflictError,
      );
    } finally {
      close();
    }
  });
});

describe('invalid input', () => {
  const { engine, close } = seeded();

  afterAll(() => close());

  it('rejects an unknown memory type', () => {
    expect(() =>
      engine.create(baseInput({ type: 'vibes' as unknown as MemoryCreateInput['type'] })),
    ).toThrow();
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(() => engine.create(baseInput({ confidence: 1.4 }))).toThrow();
  });

  it('rejects a project-scoped memory without a project', () => {
    expect(() => engine.create(baseInput({ project_id: null }))).toThrow();
  });

  it('rejects a correction with no targets', () => {
    expect(() =>
      engine.correct({
        supersedes: [],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'x',
      }),
    ).toThrow();
  });

  it('rejects an oversized list page', () => {
    expect(() => engine.list({ limit: 10_000 })).toThrow();
  });

  it('rejects an unknown id', () => {
    expect(() => engine.getDetail(randomUUID())).toThrow(MemoryNotFoundError);
  });
});

describe('concurrent writers', () => {
  it('serialises duplicate creates across two connections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mml-concurrent-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'memory.db');

    const a = openDatabase({ path });
    const b = openDatabase({ path });
    const engineA = new MemoryEngine(a.db);
    const engineB = new MemoryEngine(b.db);

    try {
      const results = await Promise.all([
        Promise.resolve().then(() => engineA.create(baseInput())),
        Promise.resolve().then(() => engineB.create(baseInput())),
      ]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(engineA.stats().active).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('keeps distinct concurrent writes consistent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mml-concurrent-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'memory.db');

    const a = openDatabase({ path });
    const b = openDatabase({ path });
    const engineA = new MemoryEngine(a.db);
    const engineB = new MemoryEngine(b.db);

    try {
      const [first, second] = await Promise.all([
        Promise.resolve().then(() => engineA.create(baseInput({ content: 'Alpha decision' }))),
        Promise.resolve().then(() => engineB.create(baseInput({ content: 'Beta decision' }))),
      ]);

      expect(first.created).toBe(true);
      expect(second.created).toBe(true);
      expect(engineA.stats().active).toBe(2);
      expect(engineA.get(first.memory.id)?.content).toBe('Alpha decision');
      expect(engineA.get(second.memory.id)?.content).toBe('Beta decision');
    } finally {
      a.close();
      b.close();
    }
  });
});

describe('stats', () => {
  it('counts lifecycle states and types', () => {
    const { engine, close } = seeded();
    try {
      const a = engine.create(baseInput());
      engine.create(baseInput({ type: 'constraint', content: 'Stay offline' }));
      engine.softDelete(a.memory.id);

      const stats = engine.stats();
      expect(stats).toMatchObject({ active: 1, deleted: 1, superseded: 0, expired: 0 });
      expect(stats.by_type.constraint).toBe(1);
      expect(stats.by_type.technical_decision).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe('memory shape guarantees', () => {
  it('returns full records that satisfy the shared contract', () => {
    const { engine, close } = seeded();
    try {
      const created: Memory = engine.create(baseInput()).memory;
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.supersedes).toEqual([]);
      expect(created.superseded_by).toBeNull();
      expect(created.created_at).toBe(created.updated_at);
    } finally {
      close();
    }
  });
});
