import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { DEFAULT_SAM_MODEL, DEFAULT_VISION_MODEL } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAdapter } from '../../apps/server/src/media/adapter.js';
import { MediaOperations } from '../../apps/server/src/media/operations.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PROJECT = 'media-http';

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

async function harness(operations: MediaOperations | null): Promise<Harness> {
  return buildHarness({ mediaOperations: operations });
}

interface HarnessOptions {
  mediaOperations?: MediaOperations | null;
  mediaFetch?: typeof fetch;
  mediaModel?: string;
  forgeModel?: string | null;
}

async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'media-api-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const base = config(root);
  const appConfig: AppConfig = {
    ...base,
    ...(options.mediaModel !== undefined
      ? {
          media: {
            model: options.mediaModel,
            samModel: DEFAULT_SAM_MODEL,
            visionModel: DEFAULT_VISION_MODEL,
          },
        }
      : {}),
    forge: {
      maxRuntimeMs: 600_000,
      maxCalls: 25,
      maxInputTokens: 1_500_000,
      museBin: null,
      apiKey: 'test-key',
      model: options.forgeModel ?? null,
      fallbackApiKey: null,
      fallbackModel: null,
      reasoningEffort: 'low',
    },
  };
  const app = await buildApp({
    config: appConfig,
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: new ForgeWorkspace(root),
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
    ...(options.mediaOperations !== undefined ? { mediaOperations: options.mediaOperations } : {}),
    ...(options.mediaFetch !== undefined ? { mediaFetch: options.mediaFetch } : {}),
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

function imageOperations(): MediaOperations {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  return new MediaOperations(
    new MediaAdapter({ apiKey: 'test-key', fetchImpl: fetchImpl as unknown as typeof fetch }),
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  );
}

async function upload(app: FastifyInstance): Promise<{ asset_id: string; version: number }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/media/upload`,
    payload: { mime: 'image/png', data_base64: PNG.toString('base64'), source_text: 'fixture' },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

describe('media HTTP surface (Batch B4)', () => {
  it('uploads candidates, serves hash-verified bytes, and curates them', async () => {
    const { app } = await harness(imageOperations());
    const created = await upload(app);
    expect(created.version).toBe(1);

    const list = await app.inject({ method: 'GET', url: `/api/forge/projects/${PROJECT}/media` });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items[0]).toMatchObject({
      asset_id: created.asset_id,
      approved_versions: [],
    });

    const bytes = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${created.asset_id}/versions/1/bytes`,
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/png');
    expect(bytes.headers['cache-control']).toBe('no-store');
    expect(bytes.rawPayload.equals(PNG)).toBe(true);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/${created.asset_id}/versions/1/approve`,
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data.status).toBe('approved');

    const versions = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${created.asset_id}`,
    });
    expect(versions.json().data.items[0].status).toBe('approved');
  });

  it('refuses mismatched magic bytes and malformed base64', async () => {
    const { app } = await harness(imageOperations());
    const jpeg = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/upload`,
      payload: { mime: 'image/jpeg', data_base64: PNG.toString('base64') },
    });
    expect(jpeg.statusCode).toBe(400);
    const malformed = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/upload`,
      payload: { mime: 'image/png', data_base64: '***' },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('runs generation as a job and publishes the candidate version last', async () => {
    const { app } = await harness(imageOperations());
    const queued = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/generate`,
      payload: { prompt: 'a small dot', size: '512x512' },
    });
    expect(queued.statusCode).toBe(202);
    const job = queued.json().data;
    expect(job.status).toBe('queued');

    let finished = job;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const poll = await app.inject({
        method: 'GET',
        url: `/api/forge/projects/${PROJECT}/media/jobs/${job.id}`,
      });
      finished = poll.json().data;
      if (finished.status === 'succeeded' || finished.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(finished.status).toBe('succeeded');
    expect(finished.result?.asset_id).toBeTruthy();
    const versions = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${finished.result?.asset_id}`,
    });
    expect(versions.json().data.items[0]).toMatchObject({ version: 1, status: 'candidate' });
  });

  it('reports unconfigured generation honestly instead of queueing', async () => {
    const { app } = await harness(null);
    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/generate`,
      payload: { prompt: 'x' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
  });

  it('lists media jobs in the items contract the Studio panel consumes', async () => {
    const { app } = await harness(imageOperations());
    const empty = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/jobs`,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toMatchObject({ items: [] });

    const queued = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/generate`,
      payload: { prompt: 'a small dot', size: '512x512' },
    });
    expect(queued.statusCode).toBe(202);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/jobs`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items.map((job: { id: string }) => job.id)).toContain(
      queued.json().data.id,
    );
  });

  it('constructs media with the image model even when Forge has a coding model', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { app } = await buildHarness({
      mediaFetch: fetchImpl as unknown as typeof fetch,
      forgeModel: 'muse-spark-1.3-contributor',
    });

    const queued = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/generate`,
      payload: { prompt: 'a dot' },
    });
    const job = queued.json().data;
    const finished = await waitForJob(app, job.id);
    expect(finished.status).toBe('succeeded');

    const generate = calls.find((call) => call.url.endsWith('/v1/images/generations'));
    expect(generate).toBeDefined();
    expect(JSON.parse(String(generate?.body))).toMatchObject({
      model: 'muse-image-1.0',
    });

    const versions = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${finished.result?.asset_id}`,
    });
    expect(versions.json().data.items[0].model).toMatchObject({
      provider: 'meta',
      model: 'muse-image-1.0',
    });

    const created = await upload(app);
    const edit = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/edit`,
      payload: { prompt: 'make it red', parent: { asset_id: created.asset_id } },
    });
    const edited = await waitForJob(app, edit.json().data.id);
    expect(edited.status).toBe('succeeded');
    const editCall = calls.find((call) => call.url.endsWith('/v1/images/edits'));
    expect(editCall).toBeDefined();
    expect(editCall?.body).toBeInstanceOf(FormData);
    if (editCall?.body instanceof FormData) {
      expect(editCall.body.get('model')).toBe('muse-image-1.0');
    }
  });

  it('uses an explicitly configured media model in both requests', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return new Response(
        JSON.stringify({
          model: 'image-provider-reported',
          data: [{ b64_json: PNG.toString('base64') }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const { app } = await buildHarness({
      mediaFetch: fetchImpl as unknown as typeof fetch,
      mediaModel: 'muse-image-9',
      forgeModel: 'muse-spark-1.3-contributor',
    });

    const queued = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/generate`,
      payload: { prompt: 'a dot' },
    });
    const finished = await waitForJob(app, queued.json().data.id);
    expect(finished.status).toBe('succeeded');

    const generate = calls.find((call) => call.url.endsWith('/v1/images/generations'));
    expect(JSON.parse(String(generate?.body))).toMatchObject({ model: 'muse-image-9' });

    const versions = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${finished.result?.asset_id}`,
    });
    expect(versions.json().data.items[0].model).toMatchObject({
      provider: 'meta',
      model: 'muse-image-9',
      observed: 'image-provider-reported',
    });
  });
});

interface MediaJobView {
  id: string;
  status: string;
  result?: { asset_id?: string };
}

async function waitForJob(app: FastifyInstance, jobId: string): Promise<MediaJobView> {
  let finished: MediaJobView = { id: jobId, status: 'unknown' };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const poll = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/jobs/${jobId}`,
    });
    finished = poll.json().data;
    if (finished.status === 'succeeded' || finished.status === 'failed') return finished;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return finished;
}
