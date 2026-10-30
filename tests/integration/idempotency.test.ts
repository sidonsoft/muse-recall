import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { ErrorCatalog } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Idempotency-Key replay (roadmap §3 remainder, D049). The headline case is
 * a retried Forge generation: the client pays model quota once, not twice.
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown().catch(() => undefined);
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const managers: ForgeJobManager[] = [];

function testConfig(workspaceRoot: string, databasePath = ':memory:'): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8787,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath,
    wal: false,
    workspaceRoot,
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
      maxOutputTokens: 1_200,
      tools: { enabled: false, approvalPolicy: 'always', maxCallsPerTurn: 3, decisionMode: 'off' },
    },
    serviceVersion: SERVICE_VERSION,
  };
}

const HOST = { host: '127.0.0.1:8787' };
const KEY = 'retry-window-key-0001';

async function memoryApp(databasePath = ':memory:') {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'idem-web-'));
  roots.push(workspaceDir);
  const database = openDatabase({ path: databasePath, wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config: testConfig(workspaceDir, databasePath),
    db: database.db,
    dbPath: databasePath,
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  return app;
}

const payload = (content: string) => ({
  type: 'contextual_fact',
  scope: 'global',
  content,
});

describe('Idempotency-Key replay (D049)', () => {
  it('replays the recorded response for POST /api/memories instead of writing twice', async () => {
    const app = await memoryApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': KEY },
      payload: payload('recorded exactly once'),
    });
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const retry = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': KEY },
      payload: payload('recorded exactly once'),
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('1');
    expect(retry.json()).toEqual(first.json());

    // First-wins semantics: the key already produced its response; a
    // different body under the same key replays the ORIGINAL response.
    const diverged = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': KEY },
      payload: payload('a DIFFERENT body under the same key'),
    });
    expect(diverged.headers['idempotent-replayed']).toBe('1');
    expect(diverged.json()).toEqual(first.json());

    const list = await app.inject({ method: 'GET', url: '/api/memories', headers: HOST });
    expect(list.json().data.total).toBe(1);

    const otherKey = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': 'separate-key-0002' },
      payload: payload('second memory, different key'),
    });
    expect(otherKey.statusCode).toBe(201);
    const list2 = await app.inject({ method: 'GET', url: '/api/memories', headers: HOST });
    expect(list2.json().data.total).toBe(2);
  });

  it('replay records are durable: they survive an app restart on the same file', async () => {
    const fileDir = await mkdtemp(join(tmpdir(), 'idem-file-'));
    roots.push(fileDir);
    const dbFile = join(fileDir, 'app.db');
    const app1 = await memoryApp(dbFile);
    const first = await app1.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': KEY },
      payload: payload('durable replay window'),
    });
    expect(first.statusCode).toBe(201);
    await app1.close();
    openApps.splice(
      openApps.findIndex((candidate) => candidate === app1),
      1,
    );

    const app2 = await memoryApp(dbFile);
    const retry = await app2.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': KEY },
      payload: payload('durable replay window'),
    });
    expect(retry.headers['idempotent-replayed']).toBe('1');
    expect(retry.json()).toEqual(first.json());
    const list = await app2.inject({ method: 'GET', url: '/api/memories', headers: HOST });
    expect(list.json().data.total).toBe(1);
  });

  it('rejects malformed keys and never replays across different routes', async () => {
    const app = await memoryApp();
    const short = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': 'short12' },
      payload: payload('bad key probe'),
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('bad_request');

    const arrayed = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': ['duplicate-header-one', 'duplicate-header-two'] },
      payload: payload('bad key probe'),
    });
    expect(arrayed.statusCode).toBe(400);
    expect(arrayed.json().error.code).toBe('bad_request');

    // Scope is per path: the same key on a different route is a fresh run.
    const onMemories = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'idempotency-key': 'cross-route-key-01' },
      payload: payload('scoped to this route'),
    });
    expect(onMemories.statusCode).toBe(201);
    const session = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { ...HOST, 'idempotency-key': 'cross-route-key-01' },
      payload: { title: 'sessions ignore memory keys' },
    });
    expect(session.statusCode).toBe(201);
  });

  it('a retried Forge generate replays the same job and spends no second quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idem-forge-'));
    roots.push(root);
    const fileDir = await mkdtemp(join(tmpdir(), 'idem-forge-db-'));
    roots.push(fileDir);
    const dbFile = join(fileDir, 'forge.db');
    const database = openDatabase({ path: dbFile, wal: false });
    openDatabases.push(database);
    const engine = new MemoryEngine(database.db);
    const workspace = new ForgeWorkspace(root);
    const fixture = new URL('../fixtures/fake-muse.mjs', import.meta.url);
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: fileURLToPathSafe(fixture),
      env: { FAKE_MUSE_MODE: 'auto' },
      maxRuntimeMs: 10_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      reasoningEffort: 'low',
      runtimeCheck: async () => ({ ok: true, errors: [] }),
    });
    managers.push(manager);
    const provider = new EchoProvider();
    const app = await buildApp({
      config: testConfig(root, dbFile),
      db: database.db,
      dbPath: dbFile,
      provider,
      engine,
      forgeWorkspace: workspace,
      forgeManager: manager,
      providerHealth: new ProviderHealthTracker(provider, 0),
    });
    openApps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      headers: HOST,
      payload: { project_id: 'idem-probe', name: 'Idempotency Probe' },
    });
    expect([200, 201]).toContain(created.statusCode);
    const projectId = 'idem-probe';

    const first = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${projectId}/generate`,
      headers: { ...HOST, 'idempotency-key': 'generate-retry-0001' },
      payload: { prompt: 'A small probe page.' },
    });
    expect(first.statusCode).toBe(202);

    const retry = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${projectId}/generate`,
      headers: { ...HOST, 'idempotency-key': 'generate-retry-0001' },
      payload: { prompt: 'A small probe page.' },
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBe('1');
    expect(retry.json()).toEqual(first.json());
    expect(manager.list(projectId)).toHaveLength(1);
  });

  it('the catalogue publishes the idempotency codes', async () => {
    const app = await memoryApp();
    const response = await app.inject({ method: 'GET', url: '/api/errors', headers: HOST });
    const catalog = response.json().data as ErrorCatalog;
    const codes = catalog.groups.transport.map((entry) => entry.code);
    expect(codes).toContain('idempotency_in_progress');
    const badRequest = catalog.groups.transport.find((entry) => entry.code === 'bad_request');
    expect(badRequest?.when).toContain('Idempotency-Key');
  });
});

function fileURLToPathSafe(url: URL): string {
  return url.pathname;
}
