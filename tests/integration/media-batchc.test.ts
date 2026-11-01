import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import { MediaJobStore } from '../../apps/server/src/media/jobs.js';
import { MediaAdapter } from '../../apps/server/src/media/adapter.js';
import {
  MediaSegmentation,
  type MediaUnderstand,
} from '../../apps/server/src/media/segment.js';
import { MediaService } from '../../apps/server/src/media/service.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PROJECT = 'media-batchc';

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
  engine: MemoryEngine;
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

interface VisionStubs {
  /** Real operation with stubbed transport: exercises the API envelope. */
  realSegmentation?: MediaSegmentation;
  segmentation?: {
    matches: Array<{
      objectId: string;
      box: { x1: number; y1: number; x2: number; y2: number };
      confidence?: number;
      maskWidth: number;
      maskHeight: number;
      raster: Uint8Array;
    }>;
  };
  suggestions?: Array<{
    type: 'preference' | 'constraint' | 'technical_decision';
    content: string;
    confidence: number;
  }>;
}

async function buildHarness(
  stubs: VisionStubs = {},
  options: { unconfigured?: boolean; withForge?: boolean } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'media-batchc-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const assets = new MediaAssetStore(workspace);
  const jobs = new MediaJobStore(workspace);
  const segmentation =
    options.unconfigured === true
      ? null
      : stubs.realSegmentation !== undefined
        ? stubs.realSegmentation
        : {
          targetedModel: 'sam-3.1',
          segment: async () => ({
            lane: '<stub>',
            matches: stubs.segmentation?.matches ?? [
              {
                objectId: '0',
                box: { x1: 0, y1: 0, x2: 1, y2: 1 },
                maskWidth: 1,
                maskHeight: 1,
                raster: Uint8Array.from([1]),
              },
            ],
            skipped: 0,
            diagnostics: [],
            model: 'sam-3.1',
            observedModel: null,
            latencyMs: 1,
            attempts: 1,
          }),
        };
  const understand =
    options.unconfigured === true
      ? null
      : {
          targetedModel: 'muse-spark-1.3',
          suggest: async () => ({
            suggestions: stubs.suggestions ?? [
              { type: 'preference', content: 'Prefer rounded cards.', confidence: 0.8 },
              { type: 'constraint', content: 'Keep palette under six colors.', confidence: 0.6 },
            ],
            model: 'muse-spark-1.3',
            observedModel: null,
            attempts: 1,
          }),
        };
  const service = new MediaService(assets, jobs, null, {
    ...(segmentation === null
      ? {}
      : { segmentation: segmentation as unknown as MediaSegmentation }),
    ...(understand === null ? {} : { understand: understand as unknown as MediaUnderstand }),
  });
  const forgeManager =
    options.withForge === true
      ? new ForgeJobManager({
          workspace,
          engine,
          museBin: FIXTURE,
          maxRuntimeMs: 10_000,
          maxCalls: 10,
          maxInputTokens: 10_000_000,
          mediaAssets: assets,
          reasoningEffort: 'low',
          runtimeCheck: async () => ({ ok: true, errors: [] }),
        })
      : undefined;
  const app = await buildApp({
    config: config(root),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    ...(forgeManager !== undefined ? { forgeManager } : {}),
    mediaAssets: assets,
    mediaJobs: jobs,
    mediaService: service,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  const instance: Harness = {
    app,
    engine,
    root,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

async function upload(app: FastifyInstance): Promise<{ asset_id: string; version: number }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/media/upload`,
    payload: { mime: 'image/png', data_base64: PNG.toString('base64'), source_text: 'batchc' },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

async function memories(
  app: FastifyInstance,
): Promise<Array<{ id: string; status: string; content: string }>> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/memories?project_id=${PROJECT}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.items;
}

describe('Batch C visual references (suggest)', () => {
  it('returns drafts without writing anything to memory', async () => {
    const { app } = await buildHarness();
    const created = await upload(app);
    const before = await memories(app);
    expect(before).toHaveLength(0);

    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/suggest`,
      payload: { asset_id: created.asset_id, guidance: 'palette' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.asset_id).toBe(created.asset_id);
    expect(body.version).toBe(1);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0]).toMatchObject({ type: 'preference' });

    // Inference only: the drafts changed nothing in the store.
    expect(await memories(app)).toHaveLength(0);
  });

  it('links proposed decisions to the source image; rejections never enter memory', async () => {
    const { app } = await buildHarness();
    const created = await upload(app);
    const suggested = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/suggest`,
      payload: { asset_id: created.asset_id },
    });
    const drafts = suggested.json().data.suggestions as Array<{
      type: string;
      content: string;
      confidence: number;
    }>;
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    const link = `muse-asset://${created.asset_id}/v1`;

    const proposed: string[] = [];
    for (const draft of drafts) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories/proposals',
        payload: {
          type: draft.type,
          scope: 'project',
          project_id: PROJECT,
          content: draft.content,
          source: { session_id: null, reference: link },
          confidence: draft.confidence,
          actor: 'agent',
        },
      });
      expect(response.statusCode).toBe(201);
      const record = response.json().data.memory;
      expect(record.source.reference).toBe(link);
      proposed.push(record.id as string);
    }

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/memories/${proposed[0]}/accept`,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/memories/${proposed[1]}/reject`,
      payload: { reason: 'not a fit' },
    });
    expect(rejected.statusCode).toBe(200);

    const listed = await memories(app);
    expect(listed.map((entry) => entry.content)).toContain(drafts[0]?.content);
    expect(listed.map((entry) => entry.content)).not.toContain(drafts[1]?.content);

    // The rejected suggestion survives only as an unaddressable tombstone:
    // its id is gone from the API, while the accepted one keeps an audit
    // trail. A rejected draft is never retrievable as a fact.
    const gone = await app.inject({
      method: 'GET',
      url: `/api/memories/${proposed[1]}/history`,
    });
    expect(gone.statusCode).toBe(404);
    const kept = await app.inject({
      method: 'GET',
      url: `/api/memories/${proposed[0]}/history`,
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().data.entries.map((entry: { action: string }) => entry.action)).toContain(
      'accepted',
    );
  });

  it('reports unconfigured understanding honestly instead of inferring', async () => {
    const { app } = await buildHarness({}, { unconfigured: true });
    const created = await upload(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/suggest`,
      payload: { asset_id: created.asset_id },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
  });
});

describe('Batch C SAM cutouts (segment)', () => {
  it('treats zero matches as valid and refuses cutouts from the empty session', async () => {
    const { app } = await buildHarness({ segmentation: { matches: [] } });
    const created = await upload(app);
    const segmented = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'red bicycle' },
    });
    expect(segmented.statusCode).toBe(200);
    expect(segmented.json().data.matches).toEqual([]);
    const segmentId = segmented.json().data.segment_id as string;

    const cutout = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segments/${segmentId}/cutout`,
      payload: { match_index: 0 },
    });
    expect(cutout.statusCode).toBe(400);
    expect(cutout.json().error.code).toBe('match_not_found');
  });

  it('saves the chosen match as a provenance-carrying transparent PNG', async () => {
    const { app } = await buildHarness({
      segmentation: {
        matches: [
          {
            objectId: '0',
            box: { x1: 0, y1: 0, x2: 1, y2: 1 },
            confidence: 0.9,
            maskWidth: 1,
            maskHeight: 1,
            raster: Uint8Array.from([1]),
          },
          {
            objectId: '1',
            box: { x1: 0, y1: 0, x2: 1, y2: 1 },
            maskWidth: 1,
            maskHeight: 1,
            raster: Uint8Array.from([0]),
          },
        ],
      },
    });
    const created = await upload(app);
    const segmented = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'dot' },
    });
    expect(segmented.statusCode).toBe(200);
    const body = segmented.json().data;
    expect(body.matches).toHaveLength(2);
    expect(body.matches[0].preview_data_url.startsWith('data:image/png;base64,')).toBe(true);

    const saved = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segments/${body.segment_id}/cutout`,
      payload: { match_index: 0 },
    });
    expect(saved.statusCode).toBe(200);
    const record = saved.json().data;
    expect(record.mime).toBe('image/png');
    expect(record.parent).toMatchObject({ asset_id: created.asset_id, version: 1 });
    expect(record.source).toMatchObject({
      kind: 'segment',
      segment: { concept: 'dot', mask_width: 1, mask_height: 1 },
    });

    // RGBA color type: transparency survived compositing.
    const bytes = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/${record.asset_id}/versions/${record.version}/bytes`,
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/png');
    expect(bytes.rawPayload[25]).toBe(6);
  });

  it('carries stream evidence on success and dispatch accounting on stream failures', async () => {
    // Real streaming transport (stubbed fetch): the error envelope must
    // surface dispatch counts and bounded stream evidence, not bare codes.
    const stream = (raw: string): Response =>
      new Response(raw, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const completed = (response: unknown): string =>
      `event: response.completed\ndata: ${JSON.stringify({ response })}`;
    const real = (fetchImpl: unknown): MediaSegmentation =>
      new MediaSegmentation(
        new MediaAdapter({ apiKey: 'test', fetchImpl: fetchImpl as never, maxRetries: 0 }),
      );
    const segment = async (app: FastifyInstance, asset_id: string): Promise<{
      statusCode: number;
      json: () => { ok: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> };
    }> =>
      app.inject({
        method: 'POST',
        url: `/api/forge/projects/${PROJECT}/media/segment`,
        payload: { asset_id, concept: 'dot' },
      });

    // Genuine zero match: completed terminal with explicit empty text.
    const emptyTerminal = completed({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
    });
    const zeroFetch = async (): Promise<Response> => stream(`${emptyTerminal}\n\n`);
    const zeroHarness = await buildHarness({ realSegmentation: real(zeroFetch) });
    const zeroAsset = await upload(zeroHarness.app);
    const zero = await segment(zeroHarness.app, zeroAsset.asset_id);
    expect(zero.statusCode).toBe(200);
    const zeroData = zero.json().data ?? {};
    expect(zeroData.matches).toEqual([]);
    expect(zeroData.provider_attempts).toBe(1);
    expect(zeroData.stream_events).toBe(1);
    expect(zeroData.stream_bytes).toBeGreaterThan(0);
    expect(zeroData.response_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Interrupted stream: one dispatch, no terminal event.
    const cutFetch = async (): Promise<Response> =>
      stream(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: 'x' })}\n\n`);
    const cutHarness = await buildHarness({ realSegmentation: real(cutFetch) });
    const cutAsset = await upload(cutHarness.app);
    const cut = await segment(cutHarness.app, cutAsset.asset_id);
    expect(cut.statusCode).toBe(502);
    const cutError = (cut.json().error ?? {}) as { code?: unknown; details?: Record<string, unknown> };
    expect(cutError.code).toBe('provider_invalid_output');
    expect(cutError.details?.attempts).toBe(1);
    expect(cutError.details?.stream_events).toBe(1);
    expect(cutError.details?.stream_bytes).toBeGreaterThan(0);
    expect(cutError.details?.response_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Malformed terminal: completed status but no text output.
    const badFetch = async (): Promise<Response> =>
      stream(`${completed({ status: 'completed', output: [] })}\n\n`);
    const badHarness = await buildHarness({ realSegmentation: real(badFetch) });
    const badAsset = await upload(badHarness.app);
    const bad = await segment(badHarness.app, badAsset.asset_id);
    expect(bad.statusCode).toBe(502);
    const badError = (bad.json().error ?? {}) as { code?: unknown; details?: Record<string, unknown> };
    expect(badError.code).toBe('provider_invalid_output');
    expect(badError.details?.attempts).toBe(1);
  });

  it('fails closed on unknown, expired-scope, and out-of-range sessions', async () => {
    const { app } = await buildHarness();
    const created = await upload(app);
    const segmented = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'dot' },
    });
    const segmentId = segmented.json().data.segment_id as string;

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segments/00000000-0000-0000-0000-000000000000/cutout`,
      payload: { match_index: 0 },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('segment_not_found');

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/other-project/media/segments/${segmentId}/cutout`,
      payload: { match_index: 0 },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('segment_not_found');

    // Cross-project access consumes the session fail-closed, so re-segment
    // for the out-of-range check.
    const resegmented = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'dot' },
    });
    const freshId = resegmented.json().data.segment_id as string;
    const outOfRange = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segments/${freshId}/cutout`,
      payload: { match_index: 7 },
    });
    expect(outOfRange.statusCode).toBe(400);
    expect(outOfRange.json().error.code).toBe('match_not_found');
  });

  it('reports unconfigured segmentation honestly', async () => {
    const { app } = await buildHarness({}, { unconfigured: true });
    const created = await upload(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'dot' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
  });
});

describe('Batch C cutout through Batch B approval (track 3)', () => {
  async function startGenerate(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/generate`,
      payload: { prompt: 'A tiny gallery page for the cutout sticker.' },
    });
    expect(response.statusCode).toBe(202);
    return response.json().data.id as string;
  }

  async function startModify(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/modify`,
      payload: { request: 'Remove the image and retitle the page.' },
    });
    expect(response.statusCode).toBe(202);
    return response.json().data.id as string;
  }

  async function waitForFinish(app: FastifyInstance, jobId: string): Promise<{ status: string }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
      const status = current.json().data.status as string;
      if (status !== 'running' && status !== 'queued') return { status };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('forge job did not finish');
  }

  async function artifactHtml(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/artifact`,
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  it('approves a cutout, embeds it at approval, and restores it on rollback', async () => {
    const { app, root } = await buildHarness({}, { withForge: true });
    await app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      payload: { project_id: PROJECT, name: 'Batch C' },
    });

    // Track 2: cutout of the full-frame match.
    const created = await upload(app);
    const segmented = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segment`,
      payload: { asset_id: created.asset_id, concept: 'dot' },
    });
    const segmentId = segmented.json().data.segment_id as string;
    const saved = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/segments/${segmentId}/cutout`,
      payload: { match_index: 0 },
    });
    const cutout = saved.json().data as { asset_id: string; version: number };
    const approved = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/${cutout.asset_id}/versions/${cutout.version}/approve`,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    // Track 3: the staged application uses the approved cutout.
    const jobId = await startGenerate(app);
    expect((await waitForFinish(app, jobId)).status).toBe('succeeded');
    await writeFile(
      join(root, 'forge', PROJECT, 'staging', jobId, 'index.html'),
      `<html><head><title>Fake Game</title></head><body><h1>Cutout</h1><!-- FARM_MARKER --><img alt="cutout" src="muse-asset://${cutout.asset_id}/v${String(cutout.version)}"></body></html>`,
    );
    const approvedV1 = await app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${jobId}/approve`,
      payload: { capture_memory: false },
    });
    expect(approvedV1.statusCode).toBe(200);

    const v1 = await artifactHtml(app);
    expect(v1).not.toContain('muse-asset://');
    expect(v1).toContain('data:image/png;base64,');
    const verification = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/artifact/verification`,
    });
    expect(verification.json().data.ok).toBe(true);

    // A second version via modify (based on v1), then rollback returns the
    // exact v1 bytes with the same embedded cutout.
    const job2 = await startModify(app);
    expect((await waitForFinish(app, job2)).status).toBe('succeeded');
    await writeFile(
      join(root, 'forge', PROJECT, 'staging', job2, 'index.html'),
      '<html><body><h1>Cutout v2 without images</h1><!-- a second approved version with enough bytes to pass structural validation --></body></html>',
    );
    const approvedV2 = await app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${job2}/approve`,
      payload: { capture_memory: false },
    });
    expect(approvedV2.statusCode).toBe(200);
    expect(await artifactHtml(app)).not.toBe(v1);

    const rolled = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/rollback`,
      payload: {},
    });
    expect(rolled.statusCode).toBe(200);
    const revived = await artifactHtml(app);
    expect(revived).toBe(v1);
    expect(revived).toContain('data:image/png;base64,');
  });
});
