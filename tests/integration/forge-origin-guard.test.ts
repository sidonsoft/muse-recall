import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));
const DEV_ORIGIN = 'http://localhost:5173';
const SAME_ORIGIN = 'http://127.0.0.1:8787';
const SAME_HOST = '127.0.0.1:8787';
const CODESPACE_HOST = 'judge-demo-x7q9-5173.app.github.dev';
const CODESPACE_ORIGIN = `https://${CODESPACE_HOST}`;

interface Harness {
  app: FastifyInstance;
  root: string;
  close: () => Promise<void>;
}

const open: Harness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) {
    await harness.close();
    await rm(harness.root, { recursive: true, force: true });
  }
});

function config(workspaceRoot: string, forwardedOrigins: string[] = []): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [DEV_ORIGIN],
    forwardedOrigins,
    databasePath: ':memory:',
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

async function harness(mode = 'auto', forwardedOrigins: string[] = []): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'forge-origin-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: mode },
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
  });
  const app = await buildApp({
    config: config(root, forwardedOrigins),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    forgeManager: manager,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  const instance: Harness = {
    app,
    root,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

function headers(origin: string | undefined, host = SAME_HOST): Record<string, string> {
  const out: Record<string, string> = { host };
  if (origin !== undefined) out.origin = origin;
  return out;
}

async function createProject(
  app: FastifyInstance,
  origin: string | undefined = SAME_ORIGIN,
  host = SAME_HOST,
) {
  return app.inject({
    method: 'POST',
    url: '/api/forge/projects',
    headers: headers(origin, host),
    payload: { project_id: 'demo-game', name: 'Demo Game' },
  });
}

async function startGenerate(app: FastifyInstance, origin: string | undefined = SAME_ORIGIN) {
  return app.inject({
    method: 'POST',
    url: '/api/forge/projects/demo-game/generate',
    headers: headers(origin),
    payload: { prompt: 'A colourful farmyard memory game for children with twelve cards.' },
  });
}

async function startModify(app: FastifyInstance, origin: string | undefined = SAME_ORIGIN) {
  return app.inject({
    method: 'POST',
    url: '/api/forge/projects/demo-game/modify',
    headers: headers(origin),
    payload: { request: 'Make the cards larger and add a sunset background.' },
  });
}

async function job(app: FastifyInstance, jobId: string) {
  const response = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
  expect(response.statusCode).toBe(200);
  return response.json().data as { status: string; version: number | null };
}

async function waitForFinish(app: FastifyInstance, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const current = await job(app, jobId);
    if (
      ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'].includes(current.status)
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('job did not finish');
}

async function version(app: FastifyInstance): Promise<number | null> {
  const state = await app.inject({
    method: 'GET',
    url: '/api/forge/projects/demo-game',
    headers: headers(SAME_ORIGIN),
  });
  expect(state.statusCode).toBe(200);
  return state.json().data.state.current_version as number | null;
}

async function approvedV1(app: FastifyInstance) {
  expect((await createProject(app)).statusCode).toBe(200);
  const generated = (await startGenerate(app)).json().data.id as string;
  expect((await waitForFinish(app, generated)).status).toBe('succeeded');
  const approved = await app.inject({
    method: 'POST',
    url: `/api/forge/jobs/${generated}/approve`,
    headers: headers(SAME_ORIGIN),
    payload: {},
  });
  expect(approved.statusCode).toBe(200);
  expect(await version(app)).toBe(1);
  return generated;
}

describe('cross-origin mutation guard', () => {
  it('allows a trusted same-origin POST', async () => {
    const h = await harness();
    expect((await createProject(h.app, SAME_ORIGIN)).statusCode).toBe(200);
  });

  it('allows a configured development origin', async () => {
    const h = await harness();
    expect((await createProject(h.app, DEV_ORIGIN)).statusCode).toBe(200);
  });

  it('rejects a foreign HTTPS origin', async () => {
    const h = await harness();
    const response = await createProject(h.app, 'https://evil.example');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden_origin');
  });

  it('rejects Origin: null', async () => {
    const h = await harness();
    const response = await createProject(h.app, 'null');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden_origin');
  });

  it('rejects a malformed Origin', async () => {
    const h = await harness();
    for (const origin of ['', 'http://', 'not-an-origin', 'http://localhost:5173/']) {
      const response = await createProject(h.app, origin);
      expect(response.statusCode, origin).toBe(403);
    }
  });

  it('rejects a deceptive hostname', async () => {
    const h = await harness();
    for (const origin of [
      'http://127.0.0.1.evil.example:8787',
      'http://localhost.evil.example:5173',
      'http://localhost:5173.evil.example',
    ]) {
      const response = await createProject(h.app, origin);
      expect(response.statusCode, origin).toBe(403);
    }
  });

  it('rejects a deceptive port', async () => {
    const h = await harness();
    const response = await createProject(h.app, 'http://127.0.0.1:8788');
    expect(response.statusCode).toBe(403);
  });

  it('allows a legitimate approval with a trusted origin', async () => {
    const h = await harness();
    const generated = await approvedV1(h.app);
    expect(generated).toBeTruthy();
    expect(await version(h.app)).toBe(1);
  });

  it('allows a legitimate rejection with a trusted origin', async () => {
    const h = await harness();
    await approvedV1(h.app);
    const modified = (await startModify(h.app)).json().data.id as string;
    expect((await waitForFinish(h.app, modified)).status).toBe('succeeded');
    const rejected = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${modified}/reject`,
      headers: headers(SAME_ORIGIN),
      payload: {},
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('rejected');
    expect(await version(h.app)).toBe(1);
  });

  it('allows a legitimate rollback with a trusted origin', async () => {
    const h = await harness();
    await approvedV1(h.app);
    const modified = (await startModify(h.app)).json().data.id as string;
    await waitForFinish(h.app, modified);
    const approved = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${modified}/approve`,
      headers: headers(SAME_ORIGIN),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(await version(h.app)).toBe(2);
    const rollback = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects/demo-game/rollback',
      headers: headers(SAME_ORIGIN),
      payload: {},
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data.current_version).toBe(1);
  });

  it('allows a legitimate cancellation with a trusted origin', async () => {
    const h = await harness('sleep');
    expect((await createProject(h.app)).statusCode).toBe(200);
    const generated = (await startGenerate(h.app)).json().data.id as string;
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/cancel`,
      headers: headers(SAME_ORIGIN),
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await waitForFinish(h.app, generated)).status).toBe('cancelled');
  });

  it('leaves state unchanged after foreign-origin attempts on every mutating route', async () => {
    const h = await harness();
    await approvedV1(h.app);
    const modified = (await startModify(h.app)).json().data.id as string;
    expect((await waitForFinish(h.app, modified)).status).toBe('succeeded');

    const foreign = 'https://evil.example';
    const attempts = [
      { url: `/api/forge/jobs/${modified}/approve`, payload: {} },
      { url: `/api/forge/jobs/${modified}/reject`, payload: {} },
      { url: `/api/forge/jobs/${modified}/cancel`, payload: {} },
      { url: '/api/forge/projects/demo-game/rollback', payload: {} },
    ];
    for (const attempt of attempts) {
      const response = await h.app.inject({
        method: 'POST',
        url: attempt.url,
        headers: headers(foreign),
        payload: attempt.payload,
      });
      expect(response.statusCode, attempt.url).toBe(403);
      expect(response.json().error.code, attempt.url).toBe('forbidden_origin');
    }

    expect(await version(h.app)).toBe(1);
    expect((await job(h.app, modified)).status).toBe('succeeded');
    expect((await job(h.app, modified)).version).toBeNull();
  });

  it('rejects a no-Origin mutation that a browser marks cross-site', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      headers: { host: SAME_HOST, 'sec-fetch-site': 'cross-site' },
      payload: { project_id: 'demo-game' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('still allows non-browser clients that send no Origin', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      headers: { host: SAME_HOST },
      payload: { project_id: 'demo-game' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('opt-in forwarded origins (GitHub Codespaces)', () => {
  it('rejects the forwarded host and origin by default', async () => {
    const h = await harness();
    const viaHost = await createProject(h.app, CODESPACE_ORIGIN, CODESPACE_HOST);
    expect(viaHost.statusCode).toBe(400);
    expect(viaHost.json().error.code).toBe('invalid_host');

    // A proxy that rewrites Host to loopback still cannot smuggle the origin in.
    const viaLoopback = await createProject(h.app, CODESPACE_ORIGIN, '127.0.0.1:8787');
    expect(viaLoopback.statusCode).toBe(403);
    expect(viaLoopback.json().error.code).toBe('forbidden_origin');
  });

  it('accepts a configured forwarded origin whether or not the proxy rewrites Host', async () => {
    const h = await harness('auto', [CODESPACE_ORIGIN]);
    expect((await createProject(h.app, CODESPACE_ORIGIN, CODESPACE_HOST)).statusCode).toBe(200);

    const h2 = await harness('auto', [CODESPACE_ORIGIN]);
    expect((await createProject(h2.app, CODESPACE_ORIGIN, '127.0.0.1:5173')).statusCode).toBe(200);
  });

  it('returns CORS headers for a configured forwarded origin only', async () => {
    const h = await harness('auto', [CODESPACE_ORIGIN]);
    const trusted = await h.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: CODESPACE_HOST, origin: CODESPACE_ORIGIN },
    });
    expect(trusted.headers['access-control-allow-origin']).toBe(CODESPACE_ORIGIN);

    const foreign = await h.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: CODESPACE_HOST, origin: 'https://other-5173.app.github.dev' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still rejects other codespaces, foreign origins and plain HTTP when configured', async () => {
    const h = await harness('auto', [CODESPACE_ORIGIN]);
    for (const origin of [
      'https://someone-else-5173.app.github.dev',
      'https://evil.example',
      `http://${CODESPACE_HOST}`,
      'null',
    ]) {
      const response = await createProject(h.app, origin, CODESPACE_HOST);
      expect(response.statusCode, origin).toBe(403);
    }
    for (const host of ['someone-else-5173.app.github.dev', `${CODESPACE_HOST}.evil.example`]) {
      const response = await createProject(h.app, CODESPACE_ORIGIN, host);
      expect(response.statusCode, host).toBe(400);
    }
  });
});
