import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import type { ToolContext } from '@mml/tool-runtime';
import { createDefaultToolRegistry } from '@mml/tool-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const open: { close: () => void }[] = [];

afterEach(() => {
  for (const database of open.splice(0)) database.close();
});

function setup(projectId: string | null = 'demo-game') {
  const opened = openDatabase({ path: ':memory:' });
  open.push(opened);
  const memory = new MemoryEngine(opened.db);
  const registry = createDefaultToolRegistry();
  const context: ToolContext = {
    db: opened.db,
    memory,
    sessionId: '00000000-0000-4000-8000-000000000001',
    projectId,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
  };
  return { registry, context, memory, db: opened.db };
}

describe('registry', () => {
  it('advertises the seven contract tools with schemas', () => {
    const { registry } = setup();
    const ids = registry.list().map((tool) => tool.id);
    expect(ids).toEqual([
      'memory.create',
      'memory.graph',
      'memory.search',
      'project.get',
      'project.update',
      'task.create',
      'task.list',
    ]);
    for (const tool of registry.list()) {
      expect(tool.input_schema).toMatchObject({ type: 'object' });
    }
  });

  it('marks writes as requiring confirmation and reads as not', () => {
    const { registry } = setup();
    const writes = registry.list().filter((tool) => tool.side_effect === 'write');
    expect(writes.map((tool) => tool.id).sort()).toEqual([
      'memory.create',
      'project.update',
      'task.create',
    ]);
    expect(writes.every((tool) => tool.requires_confirmation)).toBe(true);
  });

  it('rejects an unknown tool', async () => {
    const { registry, context } = setup();
    const result = await registry.invoke('shell.exec', { command: 'rm -rf /' }, context);
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/Unknown tool/);
  });

  it('rejects malformed arguments', async () => {
    const { registry, context } = setup();
    const result = await registry.invoke('task.create', { title: '' }, context);
    expect(result.status).toBe('invalid');
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it('rejects a second registration of the same id', () => {
    const { registry } = setup();
    const duplicate = {
      id: 'task.list',
      description: 'duplicate',
      sideEffect: 'read' as const,
      requiresConfirmation: false,
      input: z.object({}),
      output: z.object({}),
      execute: () => ({}),
    };
    expect(() => registry.register(duplicate)).toThrow(/duplicate tool id/);
  });

  it('fails a tool whose output does not match its schema', async () => {
    const { registry, context } = setup();
    registry.register({
      id: 'broken.output',
      description: 'returns the wrong shape',
      sideEffect: 'read',
      requiresConfirmation: false,
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      execute: () => ({ wrong: true }) as unknown as { ok: boolean },
    });
    const result = await registry.invoke('broken.output', {}, context);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/output schema/);
  });
});

describe('project tools', () => {
  it('reads project metadata and task counts', async () => {
    const { registry, context } = setup();
    context.memory.ensureProject('demo-game', 'Demo Game');
    const created = await registry.invoke('task.create', { title: 'Ship the demo' }, context);
    expect(created.status).toBe('executed');

    const result = await registry.invoke('project.get', {}, context);
    expect(result.status).toBe('executed');
    expect(result.output).toMatchObject({
      project: { id: 'demo-game', name: 'Demo Game' },
      tasks: { todo: 1, in_progress: 0, done: 0 },
    });
  });

  it('updates project metadata', async () => {
    const { registry, context } = setup();
    context.memory.ensureProject('demo-game');
    const result = await registry.invoke(
      'project.update',
      { name: 'Monty’s Memory Meadow', description: 'A farming memory game' },
      context,
    );
    expect(result.status).toBe('executed');
    expect(result.output).toMatchObject({
      name: 'Monty’s Memory Meadow',
      description: 'A farming memory game',
    });
  });

  it('refuses project tools without a project scope', async () => {
    const { registry, context } = setup(null);
    for (const [tool, args] of [
      ['task.list', {}],
      ['task.create', { title: 'No project' }],
      ['project.get', {}],
      ['project.update', { name: 'x' }],
    ] as const) {
      const result = await registry.invoke(tool, args, context);
      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/project-scoped/);
    }
  });
});

describe('memory.graph tool (D052 surface parity)', () => {
  it('exposes supersession edges and events, scoped to the session project', async () => {
    const { registry, context, memory } = setup();
    memory.ensureProject('demo-game');
    const a = memory.create({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'demo-game',
      content: 'Use SQLite for storage',
    }).memory;
    const b = memory.correct({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'demo-game',
      content: 'Use SQLite with WAL and fsync-before-rename',
      supersedes: [a.id],
    }).memory;
    memory.create({
      type: 'goal',
      scope: 'project',
      project_id: 'other-project',
      content: 'Other project private goal',
    });

    const result = await registry.invoke('memory.graph', {}, context);
    expect(result.status).toBe('executed');
    const graph = result.output as {
      nodes: { id: string }[];
      edges: { new_id: string; old_id: string }[];
      events: { kind: string }[];
    };
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ new_id: b.id, old_id: a.id });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([a.id, b.id].sort());
    expect(graph.events.length).toBeGreaterThanOrEqual(3);
  });

  it('is a read tool: never gated by the write policy', async () => {
    const { registry } = setup();
    const info = registry.list().find((tool) => tool.id === 'memory.graph');
    expect(info?.side_effect).toBe('read');
    expect(info?.requires_confirmation).toBe(false);
  });
});

describe('task tools', () => {
  it('creates and lists tasks newest first, with status filtering', async () => {
    const { registry, context } = setup();
    context.memory.ensureProject('demo-game');

    await registry.invoke('task.create', { title: 'First task', status: 'todo' }, context);
    await registry.invoke(
      'task.create',
      { title: 'Second task', status: 'in_progress', description: 'detail' },
      context,
    );

    const all = await registry.invoke('task.list', {}, context);
    expect(all.status).toBe('executed');
    const tasks = (all.output as { tasks: { title: string }[] }).tasks;
    expect(tasks.map((task) => task.title)).toContain('First task');
    expect(tasks.map((task) => task.title)).toContain('Second task');

    const filtered = await registry.invoke('task.list', { status: 'todo' }, context);
    const filteredTasks = (filtered.output as { tasks: { title: string }[] }).tasks;
    expect(filteredTasks.every((task) => task.title === 'First task')).toBe(true);
  });
});

describe('memory tools', () => {
  it('searches only the current project', async () => {
    const { registry, context, memory } = setup();
    memory.create({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'demo-game',
      content: 'The game uses Phaser for rendering',
    });
    memory.create({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'other-project',
      content: 'The other project uses Unity',
    });

    const result = await registry.invoke(
      'memory.search',
      { query: 'game engine rendering' },
      context,
    );
    expect(result.status).toBe('executed');
    const output = result.output as { memories: { content: string }[] };
    expect(output.memories.map((entry) => entry.content).join(' ')).toContain('Phaser');
    expect(output.memories.map((entry) => entry.content).join(' ')).not.toContain('Unity');
  });

  it('creates a memory with provenance and deduplicates', async () => {
    const { registry, context } = setup();
    const first = await registry.invoke(
      'memory.create',
      { content: 'The game must run offline', type: 'constraint' },
      context,
    );
    expect(first.status).toBe('executed');
    expect(first.output).toMatchObject({ content: 'The game must run offline', created: true });

    const second = await registry.invoke(
      'memory.create',
      { content: 'the game must run offline', type: 'constraint' },
      context,
    );
    expect(second.output).toMatchObject({ created: false });

    const stored = context.memory.list({ project_id: 'demo-game', status: ['active'] });
    expect(stored.total).toBe(1);
    expect(stored.items[0]?.source.reference).toBe('tool:memory.create');
  });
});
