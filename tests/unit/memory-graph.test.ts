import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Relationship graph + timeline over supersession edges (gap G-9 remainder,
 * D052): excerpt nodes, edges only between kept nodes, scoping parity with
 * list(), deletion unreachable through the graph, truncation flag honest.
 */

const engines: { close: () => void }[] = [];
afterEach(() => {
  for (const database of engines.splice(0)) database.close();
});

function newEngine(): MemoryEngine {
  const database = openDatabase({ path: ':memory:', wal: false });
  engines.push(database);
  return new MemoryEngine(database.db);
}

function buildChain(engine: MemoryEngine, projectId: string) {
  const a = engine.create({
    type: 'technical_decision',
    scope: 'project',
    project_id: projectId,
    content: 'Use SQLite for storage',
    confidence: 0.8,
  }).memory;
  const result = engine.correct({
    type: 'technical_decision',
    scope: 'project',
    project_id: projectId,
    content: 'Use SQLite with WAL and fsync-before-rename for durability',
    confidence: 0.9,
    supersedes: [a.id],
  });
  return { a, b: result.memory };
}

describe('MemoryEngine.graph (D052)', () => {
  it('chains supersession edges and timeline events for a corrected memory', () => {
    const engine = newEngine();
    const { a, b } = buildChain(engine, 'graph-project');

    const graph = engine.graph({ projectId: 'graph-project' });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([a.id, b.id].sort());
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ new_id: b.id, old_id: a.id });
    expect(graph.truncated).toBe(false);
    const kinds = graph.events.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === 'created')).toHaveLength(2);
    expect(kinds).toContain('corrected');
    const supersededNode = graph.nodes.find((node) => node.id === a.id);
    expect(supersededNode?.status).toBe('superseded');
    expect(graph.nodes.every((node) => node.excerpt.length <= 140)).toBe(true);
  });

  it('project scoping includes global nodes but never other projects', () => {
    const engine = newEngine();
    buildChain(engine, 'p-a');
    engine.create({
      type: 'preference',
      scope: 'global',
      content: 'Prefer explicit fail-fast over silent fallback',
      confidence: 0.7,
    }).memory;
    engine.create({
      type: 'goal',
      scope: 'project',
      project_id: 'p-b',
      content: 'other project content',
      confidence: 0.5,
    });
    const scoped = engine.graph({ projectId: 'p-a' });
    expect(scoped.nodes).toHaveLength(3); // two from p-a + the global one
    expect(scoped.nodes.some((node) => node.project_id === 'p-b')).toBe(false);
    const unscoped = engine.graph();
    expect(unscoped.nodes).toHaveLength(4);
  });

  it('deleted memories never appear, even as edge endpoints', () => {
    const engine = newEngine();
    const { a, b } = buildChain(engine, 'del-project');
    engine.softDelete(a.id, { reason: 'graph probe' });
    const graph = engine.graph({ projectId: 'del-project' });
    expect(graph.nodes.map((node) => node.id)).toEqual([b.id]);
    expect(graph.edges).toHaveLength(0);
  });

  it('truncation is reported, not silently dropped', () => {
    const engine = newEngine();
    for (let i = 0; i < 5; i += 1) {
      engine.create({
        type: 'goal',
        scope: 'global',
        content: `goal number ${String(i)}`,
        confidence: 0.5,
      });
    }
    const graph = engine.graph({ limit: 3 });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.truncated).toBe(true);
  });
});
