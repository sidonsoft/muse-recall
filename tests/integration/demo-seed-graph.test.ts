/**
 * The seeded judge demo (project `forge-demo`) is what judges load with
 * `pnpm demo:seed`; the timeline stream and relationship map they see are
 * driven by MemoryEngine.graph. Until now that pairing was only proven via
 * the browser workflow's fake-provider dataset — this pins the ACTUAL demo
 * data feeding the graph surface: the palette supersession chain exists as
 * a timestamped edge, both generations are nodes, and the seeded decision
 * shows up as a created event. (Cadence evidence, 31 Oct 2026.)
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_PROJECT_ID,
  DEMO_SEED_TIMESTAMP,
  seedForgeDemo,
} from '../../scripts/lib/demo-seed.js';

describe('seeded judge demo feeds the graph surface (D052) end to end', () => {
  let dir: string;
  let seeded: Awaited<ReturnType<typeof seedForgeDemo>>;
  let engine: MemoryEngine;
  let close: (() => void) | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'demo-graph-'));
    seeded = await seedForgeDemo({
      workspaceRoot: join(dir, 'workspaces'),
      databasePath: join(dir, 'data', 'demo.db'),
    });
    const database = openDatabase({ path: join(dir, 'data', 'demo.db'), wal: false });
    close = database.close;
    engine = new MemoryEngine(database.db);
  });

  afterAll(async () => {
    close?.();
    await rm(dir, { recursive: true, force: true });
  });

  it('the palette supersession chain in the demo is a timestamped graph edge', () => {
    const graph = engine.graph({ projectId: DEMO_PROJECT_ID, limit: 100 });
    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toContain(seeded.activePalette.id);
    expect(ids).toContain(seeded.supersededPalette.id);
    expect(ids).toContain(seeded.constraint.id);

    const edge = graph.edges.find(
      (candidate) =>
        candidate.new_id === seeded.activePalette.id &&
        candidate.old_id === seeded.supersededPalette.id,
    );
    expect(edge, 'active palette must supersede the recorded palette').toBeDefined();
    // The seed's pinned clock makes the edge stamp deterministic across runs.
    expect(edge?.at).toBe(DEMO_SEED_TIMESTAMP);
    expect(graph.truncated).toBe(false);
  });

  it('the seeded decisions surface as created events for the timeline', () => {
    const graph = engine.graph({ projectId: DEMO_PROJECT_ID, limit: 100 });
    const created = graph.events.filter((event) => event.kind === 'created');
    const createdIds = created.map((event) => event.memory_id);
    expect(createdIds).toContain(seeded.constraint.id);
    expect(createdIds).toContain(seeded.activePalette.id);
  });

  it('re-running the seed is a no-op (judges may seed twice without corrupting the story)', async () => {
    const again = await seedForgeDemo({
      workspaceRoot: join(dir, 'workspaces'),
      databasePath: join(dir, 'data', 'demo.db'),
    });
    expect(again.created.constraint).toBe(false);
    expect(again.created.palette).toBe(false);
    const graph = engine.graph({ projectId: DEMO_PROJECT_ID, limit: 100 });
    // Still exactly one supersession edge; the second seed did not re-chain.
    expect(graph.edges).toHaveLength(1);
  });
});
