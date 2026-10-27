import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHILD_SAFETY_DECISION,
  DEMO_PROJECT_ID,
  OCEAN_DECISION,
  SUNSET_DECISION,
  seedDemoMemories,
  seedForgeDemo,
} from '../../scripts/lib/demo-seed.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'demo-seed-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('demo memory seed', () => {
  it('creates the constraint and a superseding palette correction, then is idempotent', async () => {
    const database = openDatabase({ path: join(root, 'demo.db'), wal: false });
    try {
      const engine = new MemoryEngine(database.db);
      const first = seedDemoMemories(engine);
      expect(first.created).toEqual({ constraint: true, palette: true });

      const sunset = engine.get(first.supersededPalette.id);
      const ocean = engine.get(first.activePalette.id);
      expect(sunset?.status).toBe('superseded');
      expect(ocean?.status).toBe('active');
      expect(sunset?.superseded_by).toBe(ocean?.id);
      expect(sunset?.content).toBe(SUNSET_DECISION);
      expect(ocean?.content).toBe(OCEAN_DECISION);
      expect(engine.get(first.constraint.id)?.content).toBe(CHILD_SAFETY_DECISION);

      // The superseded decision keeps its auditable reason.
      const detail = engine.getDetail(first.supersededPalette.id);
      expect(detail.history.some((entry) => entry.action === 'superseded')).toBe(true);

      // Repeated seeding adds nothing, in any status bucket.
      const second = seedDemoMemories(engine);
      expect(second.created).toEqual({ constraint: false, palette: false });
      expect(second.constraint.id).toBe(first.constraint.id);
      expect(second.activePalette.id).toBe(first.activePalette.id);
      expect(second.supersededPalette.id).toBe(first.supersededPalette.id);

      const all = engine.list({
        project_id: DEMO_PROJECT_ID,
        status: ['active', 'superseded'],
        limit: 200,
      });
      expect(all.total).toBe(3);
      const active = engine.list({
        project_id: DEMO_PROJECT_ID,
        status: ['active'],
        limit: 200,
      });
      expect(active.total).toBe(2);
      for (const memory of all.items) {
        expect(memory.project_id).toBe(DEMO_PROJECT_ID);
        expect(memory.scope).toBe('project');
      }

      // Retrieval returns the corrected palette, never the superseded one.
      const retrieved = engine.retrieve({
        project_id: DEMO_PROJECT_ID,
        query: 'palette accent art direction',
        budget: { max_memories: 6, max_characters: 3_000 },
      });
      const ids = retrieved.results.map((result) => result.memory.id);
      expect(ids).toContain(first.activePalette.id);
      expect(ids).not.toContain(first.supersededPalette.id);
      expect(ids).toContain(first.constraint.id);
    } finally {
      database.close();
    }
  });

  it('seeds the workspace deterministically and records no credentials', async () => {
    const databasePath = join(root, 'demo.db');
    const first = await seedForgeDemo({ workspaceRoot: root, databasePath });
    const statePath = join(first.workspaceDir, 'state.json');
    const stateAfterFirst = await readFile(statePath, 'utf8');
    const htmlAfterFirst = await readFile(
      join(first.workspaceDir, 'versions', '1', 'index.html'),
      'utf8',
    );

    const second = await seedForgeDemo({ workspaceRoot: root, databasePath });
    const stateAfterSecond = await readFile(statePath, 'utf8');
    const htmlAfterSecond = await readFile(
      join(second.workspaceDir, 'versions', '1', 'index.html'),
      'utf8',
    );

    expect(first.version).toBe(1);
    expect(first.baselineSha256).toBe(createHash('sha256').update(htmlAfterFirst).digest('hex'));
    expect(stateAfterSecond).toBe(stateAfterFirst);
    expect(htmlAfterSecond).toBe(htmlAfterFirst);
    expect(second.constraint.id).toBe(first.constraint.id);
    expect(stateAfterFirst).not.toMatch(/api[_-]?key|bearer|secret/i);

    const database = openDatabase({ path: databasePath, wal: false });
    try {
      const total = new MemoryEngine(database.db).list({
        project_id: DEMO_PROJECT_ID,
        status: ['active', 'superseded'],
        limit: 200,
      }).total;
      expect(total).toBe(3);
    } finally {
      database.close();
    }
  });
});
