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
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface Harness {
  app: FastifyInstance;
  engine: MemoryEngine;
  manager: ForgeJobManager;
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

function config(workspaceRoot: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
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

async function harness(
  mode = 'auto',
  limits: { maxRuntimeMs?: number; maxCalls?: number } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'forge-api-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: mode },
    maxRuntimeMs: limits.maxRuntimeMs ?? 10_000,
    maxCalls: limits.maxCalls ?? 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
  });
  const app = await buildApp({
    config: config(root),
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
    engine,
    manager,
    root,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

async function createProject(app: FastifyInstance, id = 'demo-game') {
  return app.inject({
    method: 'POST',
    url: '/api/forge/projects',
    payload: { project_id: id, name: 'Demo Game' },
  });
}

async function startGenerate(app: FastifyInstance, id = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${id}/generate`,
    payload: { prompt: 'A colourful farmyard memory game for children with twelve cards.' },
  });
  expect(response.statusCode).toBe(202);
  return response.json().data.id as string;
}

async function startModify(app: FastifyInstance, id = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${id}/modify`,
    payload: {
      request: 'Make the cards larger and add a sunset background.',
      screenshot_data_url: PNG,
    },
  });
  expect(response.statusCode).toBe(202);
  return response.json().data.id as string;
}

async function job(app: FastifyInstance, jobId: string) {
  const response = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    status: string;
    version: number | null;
    validation: { ok: boolean; issues: string[] } | null;
    usage: { calls: number } | null;
  };
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

async function preview(app: FastifyInstance, id = 'demo-game', jobId?: string) {
  const suffix = jobId ? `?job=${jobId}` : '';
  return app.inject({ method: 'GET', url: `/api/forge/projects/${id}/preview${suffix}` });
}

describe('forge workflow', () => {
  it('generates, previews, approves, modifies, and rolls back', async () => {
    const h = await harness();
    expect((await createProject(h.app)).statusCode).toBe(200);

    const generated = await startGenerate(h.app);
    const genJob = await waitForFinish(h.app, generated);
    expect(genJob.status).toBe('succeeded');
    expect(genJob.validation?.ok).toBe(true);

    const staged = await preview(h.app, 'demo-game', generated);
    expect(staged.statusCode).toBe(200);
    expect(staged.body).toContain("MARKER = 'v1'");

    expect(staged.headers['content-security-policy']).toContain('sandbox allow-scripts');

    const diffResponse = await h.app.inject({
      method: 'GET',
      url: `/api/forge/jobs/${generated}/diff`,
    });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.json().data.validation.ok).toBe(true);
    expect(diffResponse.json().data.files[0].diff).toContain('+');

    const approved = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/approve`,
      payload: {
        capture_memory: true,
        decision: 'The first milestone is a 12-card farmyard memory game.',
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.state.current_version).toBe(1);
    expect((await preview(h.app)).statusCode).toBe(200);
    expect(h.engine.list({ project_id: 'demo-game', status: ['active'] }).total).toBe(1);

    const modified = await startModify(h.app);
    const modJob = await waitForFinish(h.app, modified);
    expect(modJob.status).toBe('succeeded');
    expect(modJob.base_version).toBe(1);

    const approveMod = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${modified}/approve`,
      payload: { capture_memory: false },
    });
    expect(approveMod.statusCode).toBe(200);
    expect(approveMod.json().data.state.current_version).toBe(2);
    const v2 = await preview(h.app);
    expect(v2.body).toContain("CHANGE_MARKER = 'v2'");
    expect(v2.body).toContain("FARM_MARKER = 'keep-me'");

    const rollback = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects/demo-game/rollback',
      payload: {},
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data.current_version).toBe(1);
    expect((await preview(h.app)).body).toContain("MARKER = 'v1'");
  });

  it('starts a modification from the approved source, preserving unrelated code', async () => {
    const h = await harness();
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);
    await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/approve`,
      payload: { capture_memory: false },
    });

    const modified = await startModify(h.app);
    const finished = await waitForFinish(h.app, modified);
    expect(finished.status).toBe('succeeded');
    expect(finished.base_version).toBe(1);

    const diffResponse = await h.app.inject({
      method: 'GET',
      url: `/api/forge/jobs/${modified}/diff`,
    });
    const file = diffResponse.json().data.files[0] as { before: string; after: string };
    expect(file.before).toContain("FARM_MARKER = 'keep-me'");
    expect(file.after).toContain("FARM_MARKER = 'keep-me'");
    expect(file.after).toContain("CHANGE_MARKER = 'v2'");
  });

  it('refuses to modify a project without an approved version', async () => {
    const h = await harness();
    await createProject(h.app);
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects/demo-game/modify',
      payload: { request: 'Make the cards larger.', screenshot_data_url: PNG },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no_current_version');
  });

  it('rejects a staged change without touching the approved game', async () => {
    const h = await harness();
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);
    await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/approve`,
      payload: { capture_memory: false },
    });

    const modified = await startModify(h.app);
    await waitForFinish(h.app, modified);
    const rejected = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${modified}/reject`,
      payload: {},
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('rejected');

    const state = await h.app.inject({ method: 'GET', url: '/api/forge/projects/demo-game' });
    expect(state.json().data.state.current_version).toBe(1);
    expect((await preview(h.app)).body).toContain("MARKER = 'v1'");
  });

  it('fails a symlinked output and refuses approval', async () => {
    const h = await harness('symlink');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('failed');
    expect(finished.validation?.issues.join(' ')).toMatch(/symlink/);

    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/approve`,
      payload: { capture_memory: false },
    });
    expect(approve.statusCode).toBe(409);
  });

  it('marks a job that exceeded its call budget', async () => {
    const h = await harness('budget', { maxCalls: 10 });
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('budget_exceeded');
    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/approve`,
      payload: { capture_memory: false },
    });
    expect(approve.statusCode).toBe(409);
  });

  it('cancels a running job without creating a version', async () => {
    const h = await harness('sleep', { maxRuntimeMs: 60_000 });
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generated}/cancel`,
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('cancelled');
    expect(finished.version).toBeNull();
  });

  it('times out a slow job', async () => {
    const h = await harness('sleep', { maxRuntimeMs: 300 });
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('failed');
  });

  it('fails cleanly when the CLI exits non-zero', async () => {
    const h = await harness('fail');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('failed');
    expect((finished as { error: string }).error).toMatch(/fake failure|exited/);
  });

  it('rejects malformed generated HTML', async () => {
    const h = await harness('invalid');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);
    expect(finished.status).toBe('failed');
    expect(finished.validation?.issues.join(' ')).toMatch(/canvas|Phaser/);
  });

  it('records the project memories that influenced a job', async () => {
    const h = await harness();
    await createProject(h.app);
    const memory = h.engine.create({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'demo-game',
      content: 'The game is a colourful farmyard memory game for children with twelve cards.',
      confidence: 0.9,
      validation_status: 'verified',
    });
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);
    const detail = await job(h.app, generated);
    expect((detail as { memory_ids: string[] }).memory_ids).toContain(memory.memory.id);
  });

  it("does not serve another project's staged file", async () => {
    const h = await harness();
    await createProject(h.app, 'project-a');
    await createProject(h.app, 'project-b');
    const generated = await startGenerate(h.app, 'project-a');
    await waitForFinish(h.app, generated);
    const response = await preview(h.app, 'project-b', generated);
    expect(response.statusCode).toBe(404);
  });

  it('rejects an invalid project id before touching the filesystem', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      payload: { project_id: '../escape' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('runs two jobs concurrently without mixing their staging output', async () => {
    const h = await harness();
    await createProject(h.app);
    const first = await startGenerate(h.app);
    const second = await startGenerate(h.app);
    const [a, b] = await Promise.all([waitForFinish(h.app, first), waitForFinish(h.app, second)]);
    expect([a.status, b.status]).toEqual(['succeeded', 'succeeded']);
  });
});
