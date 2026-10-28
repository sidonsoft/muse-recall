import { randomUUID } from 'node:crypto';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * HTTP contract tests for the memory API.
 *
 * These exercise the real Fastify routes over an in-memory SQLite database —
 * the same code path the inspector uses — and assert status codes, envelopes,
 * and the integrity guarantees the engine promises.
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    forwardedOrigins: [],
    databasePath: ':memory:',
    wal: false,
    workspaceRoot: '/tmp/mml-workspaces',
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    agent: {
      budgets: {
        max_history_messages: 8,
        max_history_characters: 6_000,
        max_memory_characters: 4_000,
        max_prompt_characters: 24_000,
        max_message_characters: 8_000,
        max_correction_history: 3,
      },
      autoCapture: 'suggest',
      includeCorrectionHistory: true,
      tools: {
        enabled: false,
        approvalPolicy: 'always',
        maxCallsPerTurn: 3,
        decisionMode: 'off',
      },
      maxOutputTokens: 1_200,
    },
    serviceVersion: SERVICE_VERSION,
    ...overrides,
  };
}

async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config: testConfig(overrides),
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  return app;
}

async function createMemory(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; content: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/memories',
    payload: {
      type: 'technical_decision',
      scope: 'project',
      project_id: 'demo-game',
      content: 'Use SQLite for persistent storage',
      ...overrides,
    },
  });
  expect(response.statusCode).toBeLessThan(300);
  const body = response.json();
  return body.data.memory;
}

describe('POST /api/memories', () => {
  it('creates a memory and returns 201', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: {
        type: 'constraint',
        scope: 'project',
        project_id: 'demo-game',
        content: 'Must run offline',
        confidence: 1,
        validation_status: 'verified',
        tags: ['offline'],
        source: { session_id: 'session-1', reference: 'kickoff' },
      },
    });

    expect(response.statusCode).toBe(201);
    const { data } = response.json();
    expect(data.created).toBe(true);
    expect(data.memory).toMatchObject({
      type: 'constraint',
      status: 'active',
      project_id: 'demo-game',
      content: 'Must run offline',
      tags: ['offline'],
    });
    expect(data.memory.source.reference).toBe('kickoff');
  });

  it('returns 200 and the existing memory for a duplicate', async () => {
    const app = await createTestApp();
    const first = await createMemory(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: {
        type: 'technical_decision',
        scope: 'project',
        project_id: 'demo-game',
        content: '  use SQLITE for persistent storage  ',
      },
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.created).toBe(false);
    expect(data.memory.id).toBe(first.id);
  });

  it('rejects a project memory with no project', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { type: 'goal', scope: 'project', content: 'Ship it' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('rejects an unknown memory type', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      payload: { type: 'hunch', scope: 'global', content: 'Nope' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/memories', () => {
  it('lists memories with pagination metadata', async () => {
    const app = await createTestApp();
    await createMemory(app, { content: 'Use SQLite for storage' });
    await createMemory(app, { content: 'Use Postgres for storage' });

    const response = await app.inject({ method: 'GET', url: '/api/memories?project_id=demo-game' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.total).toBe(2);
    expect(data.items).toHaveLength(2);
    expect(data.limit).toBe(50);
    expect(data.offset).toBe(0);
  });

  it('filters by text, type and status', async () => {
    const app = await createTestApp();
    await createMemory(app, { content: 'Use SQLite for storage' });
    await createMemory(app, { type: 'constraint', content: 'Must run offline' });

    const text = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=demo-game&q=sqlite',
    });
    expect(text.json().data.total).toBe(1);

    const typed = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=demo-game&type=constraint',
    });
    expect(typed.json().data.total).toBe(1);
    expect(typed.json().data.items[0].type).toBe('constraint');

    const active = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=demo-game&status=active',
    });
    expect(active.json().data.total).toBe(2);
  });

  it('isolates projects and supports an explicit cross-project view', async () => {
    const app = await createTestApp();
    await createMemory(app, { project_id: 'project-a', content: 'Alpha decision' });
    await createMemory(app, { project_id: 'project-b', content: 'Beta decision' });

    const scoped = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=project-a',
    });
    expect(scoped.json().data.total).toBe(1);
    expect(scoped.json().data.items[0].content).toBe('Alpha decision');

    const all = await app.inject({ method: 'GET', url: '/api/memories?all_projects=true' });
    expect(all.json().data.total).toBe(2);
  });

  it('never returns deleted memories, even when asked for them', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    const deletion = await app.inject({ method: 'DELETE', url: `/api/memories/${memory.id}` });
    expect(deletion.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=demo-game&status=deleted',
    });
    expect(response.json().data).toMatchObject({ items: [], total: 0 });
  });

  it('rejects an invalid page size', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/memories?limit=5000' });
    expect(response.statusCode).toBe(400);
  });

  it('survives hostile search input', async () => {
    const app = await createTestApp();
    await createMemory(app);
    const response = await app.inject({
      method: 'GET',
      url: `/api/memories?project_id=demo-game&q=${encodeURIComponent('" OR 1=1 --')}`,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/memories/:id', () => {
  it('returns the record with provenance and history', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app, {
      source: { session_id: 'session-7', reference: 'design-review' },
    });

    const response = await app.inject({ method: 'GET', url: `/api/memories/${memory.id}` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.memory.source).toEqual({ session_id: 'session-7', reference: 'design-review' });
    expect(data.history).toHaveLength(1);
    expect(data.history[0].action).toBe('created');
    expect(data.supersedes).toEqual([]);
    expect(data.superseded_by).toBeNull();
  });

  it('404s for an unknown id', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: `/api/memories/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('memory_not_found');
  });

  it('404s for a malformed id', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/memories/not-a-uuid' });
    expect(response.statusCode).toBe(400);
  });

  it('404s for a deleted memory', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    await app.inject({ method: 'DELETE', url: `/api/memories/${memory.id}` });
    const response = await app.inject({ method: 'GET', url: `/api/memories/${memory.id}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /api/memories/:id', () => {
  it('updates content and confidence', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/memories/${memory.id}`,
      payload: { content: 'Use SQLite in WAL mode', confidence: 0.8 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      content: 'Use SQLite in WAL mode',
      confidence: 0.8,
    });
  });

  it('409s when the edit would duplicate another active memory', async () => {
    const app = await createTestApp();
    const first = await createMemory(app, { content: 'Use SQLite for storage' });
    await createMemory(app, { content: 'Use Postgres for storage' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/memories/${first.id}`,
      payload: { content: 'Use Postgres for storage' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('memory_conflict');
  });
});

describe('POST /api/memories/:id/correct', () => {
  it('supersedes the addressed memory and records history', async () => {
    const app = await createTestApp();
    const original = await createMemory(app, { content: 'Use SQLite for storage' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/memories/${original.id}/correct`,
      payload: {
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'Use Postgres for storage',
        confidence: 0.95,
        validation_status: 'verified',
      },
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.created).toBe(true);
    expect(data.superseded.map((memory: { id: string }) => memory.id)).toEqual([original.id]);

    const detail = await app.inject({ method: 'GET', url: `/api/memories/${original.id}` });
    const detailBody = detail.json().data;
    expect(detailBody.memory.status).toBe('superseded');
    expect(detailBody.superseded_by.id).toBe(data.memory.id);
    expect(detailBody.history.map((entry: { action: string }) => entry.action)).toEqual([
      'created',
      'superseded',
    ]);
  });

  it('can supersede additional memories in one request', async () => {
    const app = await createTestApp();
    const first = await createMemory(app, { content: 'Use SQLite for storage' });
    const second = await createMemory(app, { content: 'Store data in SQLite' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/memories/${first.id}/correct`,
      payload: {
        supersedes: [second.id],
        type: 'technical_decision',
        project_id: 'demo-game',
        content: 'Use Postgres for all storage',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.superseded).toHaveLength(2);
  });

  it('is idempotent when replayed', async () => {
    const app = await createTestApp();
    const original = await createMemory(app, { content: 'Use SQLite for storage' });
    const payload = {
      type: 'technical_decision',
      project_id: 'demo-game',
      content: 'Use Postgres for storage',
    };

    const first = await app.inject({
      method: 'POST',
      url: `/api/memories/${original.id}/correct`,
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/memories/${original.id}/correct`,
      payload,
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.created).toBe(false);
    expect(replay.json().data.memory.id).toBe(first.json().data.memory.id);
  });

  it('404s when the correction targets an unknown memory', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/memories/${randomUUID()}/correct`,
      payload: { type: 'goal', project_id: 'demo-game', content: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('409s when the target is already superseded by a different fact', async () => {
    const app = await createTestApp();
    const original = await createMemory(app, { content: 'Use SQLite for storage' });
    await app.inject({
      method: 'POST',
      url: `/api/memories/${original.id}/correct`,
      payload: { type: 'technical_decision', project_id: 'demo-game', content: 'Use Postgres' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/memories/${original.id}/correct`,
      payload: { type: 'technical_decision', project_id: 'demo-game', content: 'Use MySQL' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('memory_conflict');
  });
});

describe('DELETE /api/memories/:id', () => {
  it('soft deletes and removes the memory from search', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app, { content: 'Use SQLite for persistent storage' });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/memories/${memory.id}`,
      payload: { reason: 'user retracted' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ id: memory.id, deleted: true });

    const search = await app.inject({
      method: 'GET',
      url: '/api/memories?project_id=demo-game&q=sqlite',
    });
    expect(search.json().data.total).toBe(0);

    const retrieval = await app.inject({
      method: 'POST',
      url: '/api/retrieval/preview',
      payload: { project_id: 'demo-game', query: 'sqlite' },
    });
    expect(retrieval.json().data.retrieval.results).toHaveLength(0);
  });

  it('404s for an unknown memory', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/memories/${randomUUID()}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('404s when deleting twice', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    await app.inject({ method: 'DELETE', url: `/api/memories/${memory.id}` });
    const second = await app.inject({ method: 'DELETE', url: `/api/memories/${memory.id}` });
    expect(second.statusCode).toBe(404);
  });
});

describe('GET /api/memories/:id/history', () => {
  it('returns the audit trail in order', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    await app.inject({
      method: 'PATCH',
      url: `/api/memories/${memory.id}`,
      payload: { confidence: 0.9 },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/memories/${memory.id}/history`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.entries.map((entry: { action: string }) => entry.action)).toEqual([
      'created',
      'updated',
    ]);
  });
});

describe('GET /api/memories/stats', () => {
  it('reports lifecycle counts', async () => {
    const app = await createTestApp();
    const memory = await createMemory(app);
    await createMemory(app, { type: 'goal', content: 'Ship by Friday' });
    await app.inject({ method: 'DELETE', url: `/api/memories/${memory.id}` });

    const response = await app.inject({ method: 'GET', url: '/api/memories/stats' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data).toMatchObject({ active: 1, deleted: 1, superseded: 0, expired: 0 });
    expect(data.by_type.goal).toBe(1);
  });
});

describe('POST /api/retrieval/preview', () => {
  it('returns ranked results with evidence and budget metadata', async () => {
    const app = await createTestApp();
    await createMemory(app, { content: 'Use SQLite for persistent storage' });
    await createMemory(app, { type: 'constraint', content: 'Must run offline' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/retrieval/preview',
      payload: { project_id: 'demo-game', query: 'sqlite storage' },
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.retrieval.results.length).toBeGreaterThan(0);
    expect(data.retrieval.metadata).toMatchObject({
      project_id: 'demo-game',
      character_budget: 4_000,
      memory_budget: 8,
    });
    expect(data.retrieval.metadata.characters_used).toBeLessThanOrEqual(4_000);
    expect(data.retrieval.results[0].evidence.length).toBeGreaterThan(0);

    // Constraints are pinned, so both memories are present even though only
    // one matches the query.
    expect(data.retrieval.results).toHaveLength(2);
    expect(data.context.characters).toBeGreaterThan(0);
    expect(data.context.text).toContain('<retrieved_memories>');
  });

  it('honours a caller-supplied budget', async () => {
    const app = await createTestApp();
    for (let index = 0; index < 6; index += 1) {
      await createMemory(app, { type: 'contextual_fact', content: `Storage note ${index}` });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/retrieval/preview',
      payload: { project_id: 'demo-game', query: 'storage note', budget: { max_memories: 2 } },
    });

    const { data } = response.json();
    expect(data.retrieval.results).toHaveLength(2);
    expect(data.retrieval.metadata.memory_budget).toBe(2);
  });

  it('uses installation defaults when no budget is supplied', async () => {
    const app = await createTestApp({
      memoryBudget: { max_memories: 3, max_characters: 500, max_memory_characters: 200 },
    });
    await createMemory(app, { content: 'Use SQLite for storage' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/retrieval/preview',
      payload: { project_id: 'demo-game', query: 'sqlite' },
    });
    const { data } = response.json();
    expect(data.retrieval.metadata.memory_budget).toBe(3);
    expect(data.retrieval.metadata.character_budget).toBe(500);
  });

  it('rejects an oversized query', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/retrieval/preview',
      payload: { project_id: 'demo-game', query: 'x'.repeat(20_000) },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/projects', () => {
  it('lists project scope anchors created by memory writes', async () => {
    const app = await createTestApp();
    await createMemory(app, { project_id: 'project-a' });
    await createMemory(app, { project_id: 'project-b' });

    const response = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(200);
    const ids = response.json().data.items.map((project: { id: string }) => project.id);
    expect(ids).toEqual(['project-a', 'project-b']);
  });
});

describe('meta', () => {
  it('reports the memory engine as complete with its retrieval config', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/meta' });
    const { data } = response.json();
    expect(data.phase).toBe(5);
    expect(data.modules.memory_engine).toBe('complete');
    expect(data.memory.default_budget).toMatchObject({ max_memories: 8, max_characters: 4_000 });
    expect(data.memory.weights.relevance).toBe(0.4);
  });
});
