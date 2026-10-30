import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { MEMORY_EXPORT_FORMAT, MEMORY_EXPORT_FORMAT_VERSION } from '@mml/shared';
import { describe, expect, it } from 'vitest';

/**
 * Export/import contract (roadmap §6 "Make changes safe", gap G-4):
 * a portable envelope with format and schema versions, referential
 * integrity, idempotent replay, atomic conflict handling and dry runs.
 */

function seededEngine(): { engine: MemoryEngine; close: () => void } {
  const { db, close } = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(db);
  engine.ensureProject('demo-game', 'Demo Game');
  engine.ensureProject('other-game', 'Other Game');

  const first = engine.create({
    type: 'technical_decision',
    scope: 'project',
    project_id: 'demo-game',
    content: 'Use SQLite for persistent storage',
  });
  // A correction chain leaves superseded + active records and an edge behind.
  engine.correct({
    type: 'constraint',
    scope: 'project',
    project_id: 'demo-game',
    content: 'Always ship the export envelope with schema versions',
    supersedes: [first.memory.id],
  });
  engine.propose({
    type: 'preference',
    scope: 'project',
    project_id: 'other-game',
    content: 'A candidate nobody has reviewed yet',
  });
  const doomed = engine.create({
    type: 'contextual_fact',
    scope: 'global',
    content: 'A fact that was later removed',
  });
  engine.softDelete(doomed.memory.id);
  return { engine, close };
}

describe('exportMemories', () => {
  it('produces a versioned, referentially complete snapshot', () => {
    const { engine, close } = seededEngine();
    try {
      const envelope = engine.exportMemories();
      expect(envelope).toMatchObject({
        format: MEMORY_EXPORT_FORMAT,
        format_version: MEMORY_EXPORT_FORMAT_VERSION,
      });
      expect(envelope.schema_version).toBeGreaterThanOrEqual(7);
      expect(envelope.projects.map((p) => p.id)).toEqual(['demo-game', 'other-game']);
      // Tombstones and proposals are part of the snapshot.
      const statuses = envelope.records.map((record) => record.status);
      expect(statuses).toContain('deleted');
      expect(statuses).toContain('proposed');
      expect(statuses).toContain('superseded');
      // Every history entry audits a record that is in the envelope.
      const ids = new Set(envelope.records.map((record) => record.id));
      for (const entry of envelope.history) expect(ids.has(entry.memory_id)).toBe(true);
      for (const edge of envelope.supersessions) {
        expect(ids.has(edge.new_id)).toBe(true);
        expect(ids.has(edge.old_id)).toBe(true);
      }
      // Audit and edge content is non-trivial: the correction chain exists.
      expect(envelope.supersessions.length).toBe(1);
      expect(envelope.history.some((entry) => entry.action === 'superseded')).toBe(true);
    } finally {
      close();
    }
  });
});

describe('importExport', () => {
  it('round-trips: importing into a fresh engine re-exports identical data', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const targetEngine = new MemoryEngine(target.db);
      const result = targetEngine.importExport(envelope);
      expect(result).toMatchObject({
        records_imported: envelope.records.length,
        records_replayed: 0,
        history_imported: envelope.history.length,
        edges_imported: 1,
        projects_ensured: 2,
        dry_run: false,
      });

      const reimported = targetEngine.exportMemories();
      expect(reimported.projects).toEqual(envelope.projects);
      expect(reimported.records).toEqual(envelope.records);
      expect(reimported.history).toEqual(envelope.history);
      expect(reimported.supersessions).toEqual(envelope.supersessions);

      // Retrieval behaves identically on the rebuilt side: tombstones and
      // proposals are still invisible, superseded content is still ranked out.
      expect(targetEngine.stats()).toMatchObject(source.engine.stats());
      const found = targetEngine.retrieve({ query: 'removed fact', project_id: 'demo-game' });
      expect(found.results.map((item) => item.memory.id)).not.toContain(
        envelope.records.find((record) => record.status === 'deleted')?.id,
      );
    } finally {
      source.close();
      target.close();
    }
  });

  it('replaying the same envelope is a no-op', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const targetEngine = new MemoryEngine(target.db);
      targetEngine.importExport(envelope);
      const replay = targetEngine.importExport(envelope);
      expect(replay).toMatchObject({
        records_imported: 0,
        records_replayed: envelope.records.length,
        history_imported: 0,
        edges_imported: 0,
        projects_ensured: 0,
      });
    } finally {
      source.close();
      target.close();
    }
  });

  it('rolls back completely when a foreign id holds different content', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const targetEngine = new MemoryEngine(target.db);
      const contested = envelope.records.find((record) => record.status === 'active');
      targetEngine.importExport(envelope);
      const tampered = {
        ...envelope,
        records: envelope.records.map((record) =>
          record.id === contested?.id ? { ...record, content: 'rewritten elsewhere' } : record,
        ),
      };

      expect(() => targetEngine.importExport(tampered)).toThrowError(
        expect.objectContaining({ code: 'memory_conflict' }),
      );
      // Atomicity: the rejected import changed nothing from the good pass.
      expect(targetEngine.stats().total).toBe(envelope.records.length);
      const unharmed = targetEngine.get(contested?.id as string);
      expect(unharmed?.content).toBe(contested?.content);
    } finally {
      source.close();
      target.close();
    }
  });

  it('refuses newer formats and structurally broken envelopes', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const targetEngine = new MemoryEngine(target.db);

      expect(() =>
        targetEngine.importExport({
          ...envelope,
          format_version: MEMORY_EXPORT_FORMAT_VERSION + 1,
        }),
      ).toThrowError(expect.objectContaining({ code: 'memory_invalid' }));

      expect(() =>
        targetEngine.importExport({
          ...envelope,
          history: [
            ...envelope.history,
            {
              id: envelope.history[0].id,
              memory_id: '00000000-0000-4000-8000-000000000000',
              action: 'created',
              previous_status: null,
              next_status: 'active',
              reason: null,
              actor: 'user',
              at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ).toThrowError(expect.objectContaining({ code: 'memory_invalid' }));
    } finally {
      source.close();
      target.close();
    }
  });

  it('dry runs report the plan without writing anything', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const targetEngine = new MemoryEngine(target.db);
      const plan = targetEngine.importExport(envelope, { dryRun: true });
      expect(plan).toMatchObject({
        dry_run: true,
        records_imported: envelope.records.length,
      });
      expect(targetEngine.stats().total).toBe(0);
      expect(targetEngine.listProjects()).toEqual([]);
    } finally {
      source.close();
      target.close();
    }
  });

  it('keeps imported tombstones out of retrieval and the search index', () => {
    const source = seededEngine();
    const target = openDatabase({ path: ':memory:', wal: false });
    try {
      const envelope = source.engine.exportMemories();
      const deleted = envelope.records.find((record) => record.status === 'deleted');
      if (!deleted) throw new Error('seed must include a tombstone');
      const targetEngine = new MemoryEngine(target.db);
      targetEngine.importExport(envelope);

      const indexed = target.db
        .prepare('SELECT COUNT(*) AS count FROM memory_fts WHERE memory_id = ?')
        .get(deleted.id) as unknown as { count: number };
      expect(Number(indexed.count)).toBe(0);
      expect(targetEngine.get(deleted.id)).toBeNull();
    } finally {
      source.close();
      target.close();
    }
  });
});
