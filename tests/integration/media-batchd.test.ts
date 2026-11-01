import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { DEFAULT_SAM_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VISION_MODEL } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';
import { base64, mp4Bytes, wavBytes } from '../helpers/media-fixtures.js';

const PROJECT = 'media-batchd';

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
    media: {
      model: 'muse-image-1.0',
      samModel: DEFAULT_SAM_MODEL,
      visionModel: DEFAULT_VISION_MODEL,
      transcribeModel: 'muse-voice-transcribe-1.0',
      videoModel: DEFAULT_VIDEO_MODEL,
      maxRetries: 0,
    },
    forge: {
      maxRuntimeMs: 600_000,
      maxCalls: 25,
      maxInputTokens: 1_500_000,
      museBin: null,
      apiKey: 'test-key',
      model: null,
      fallbackApiKey: null,
      fallbackModel: null,
      reasoningEffort: 'low',
    },
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
  calls: Array<{ url: string; request: unknown; form: FormData | null }>;
  close: () => Promise<void>;
}

const open: Harness[] = [];
afterEach(async () => {
  for (const harness of open.splice(0)) {
    await harness.close();
    await rm(harness.root, { recursive: true, force: true });
  }
});

async function buildHarness(options: { configured?: boolean } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'media-batchd-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const calls: Harness['calls'] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const form = init?.body instanceof FormData ? init.body : null;
    let request: unknown = null;
    if (form !== null) request = form.get('request');
    else if (typeof init?.body === 'string') request = JSON.parse(init.body) as unknown;
    calls.push({ url, request, form });
    if (url.endsWith('/v1/asr/transcribe')) {
      return new Response(
        JSON.stringify({
          transcript: 'Make the header sticky on scroll.',
          audioDurationMs: 1_000,
          turns: [
            {
              turnId: 0,
              startMs: 0,
              endMs: 1_000,
              transcript: 'Make the header sticky on scroll.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/v1/files')) {
      return new Response(JSON.stringify({ id: 'file-batchd', object: 'file' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/v1/responses')) {
      return new Response(
        JSON.stringify({
          status: 'completed',
          model: 'muse-spark-observed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    observations: [
                      {
                        observation: 'A two-column card layout is visible.',
                        startMs: 0,
                        endMs: 4_000,
                        confidence: 0.82,
                      },
                      {
                        observation: 'The primary action sits bottom-right.',
                        startMs: 4_000,
                        endMs: 9_000,
                        confidence: 0.7,
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: { message: 'unexpected route' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  });
  const appConfig = config(root);
  if (options.configured === false && appConfig.forge) {
    appConfig.forge = { ...appConfig.forge, apiKey: null };
  }
  const app = await buildApp({
    config: appConfig,
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: new ForgeWorkspace(root),
    mediaFetch: fetchImpl as unknown as typeof fetch,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  const harness: Harness = {
    app,
    engine,
    root,
    calls,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(harness);
  return harness;
}

async function upload(
  app: FastifyInstance,
  mime: 'audio/wav' | 'video/mp4',
  bytes: Buffer,
  origin: 'upload' | 'recording' = 'upload',
): Promise<{ source_id: string; duration_ms: number }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/media/sources`,
    payload: { mime, data_base64: base64(bytes), origin, original_name: 'fixture' },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

describe('voice and video HTTP surface (Batch D)', () => {
  it('uploads bounded sources, serves verified bytes, and lists metadata', async () => {
    const { app } = await buildHarness();
    const wav = wavBytes({ durationMs: 1_500 });
    const record = await upload(app, 'audio/wav', wav, 'recording');
    expect(record.duration_ms).toBe(1_500);

    const list = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toHaveLength(1);
    expect(list.json().data.items[0]).toMatchObject({
      source_id: record.source_id,
      kind: 'audio',
      origin: 'recording',
    });

    const bytes = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/bytes`,
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('audio/wav');
    expect(bytes.headers['cache-control']).toBe('no-store');
    expect(bytes.rawPayload).toEqual(wav);
  });

  it('refuses mismatched containers and out-of-bound durations before storage', async () => {
    const { app } = await buildHarness();
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources`,
      payload: { mime: 'audio/wav', data_base64: base64(mp4Bytes()) },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('malformed_media');

    const longVideo = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources`,
      payload: { mime: 'video/mp4', data_base64: base64(mp4Bytes({ durationMs: 30_001 })) },
    });
    expect(longVideo.statusCode).toBe(400);
    expect(longVideo.json().error.code).toBe('duration_exceeded');

    const audioOnly = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources`,
      payload: { mime: 'video/mp4', data_base64: base64(mp4Bytes({ tracks: ['soun'] })) },
    });
    expect(audioOnly.statusCode).toBe(400);
    expect(audioOnly.json().error.code).toBe('unsupported_format');

    const list = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources`,
    });
    expect(list.json().data.items).toEqual([]);
  });

  it('transcribes with the documented multipart contract and validates turns', async () => {
    const harness = await buildHarness();
    const record = await upload(harness.app, 'audio/wav', wavBytes({ durationMs: 1_000 }));
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/transcribe`,
      payload: { mode: 'PUSH_TO_TALK', language_bias: ['en'], keywords: ['header'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      source_id: record.source_id,
      transcript: 'Make the header sticky on scroll.',
      duration_ms: 1_000,
      audio_duration_ms: 1_000,
      provider_attempts: 1,
    });

    const call = harness.calls.find((entry) => entry.url.endsWith('/v1/asr/transcribe'));
    expect(call?.form?.get('audio')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(call?.request))).toMatchObject({
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'PUSH_TO_TALK',
      languageBias: ['en'],
      keywords: ['header'],
    });
  });

  it('understands a clip through Files + Responses and validates timestamps', async () => {
    const harness = await buildHarness();
    const record = await upload(harness.app, 'video/mp4', mp4Bytes({ durationMs: 10_000 }));
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/clip`,
      payload: { prompt: 'layout' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      source_id: record.source_id,
      duration_ms: 10_000,
      file_id: 'file-batchd',
      model: 'muse-spark-1.3',
      observed_model: 'muse-spark-observed',
      provider_attempts: 2,
    });
    expect(response.json().data.observations).toHaveLength(2);

    const uploadCall = harness.calls.find((entry) => entry.url.endsWith('/v1/files'));
    expect(uploadCall?.form?.get('purpose')).toBe('user_data');
    expect(uploadCall?.form?.get('file')).toBeInstanceOf(Blob);

    const responseCall = harness.calls.find((entry) => entry.url.endsWith('/v1/responses'));
    const payload = responseCall?.request as {
      input: Array<{ content: Array<{ type: string; file_id?: string }> }>;
      text: { format: { type: string; strict: boolean } };
    };
    expect(payload.input[0]?.content[1]).toEqual({ type: 'input_file', file_id: 'file-batchd' });
    expect(payload.text.format).toMatchObject({ type: 'json_schema', strict: true });
  });

  it('records only selected proposals, as proposed memories invisible to default retrieval', async () => {
    const harness = await buildHarness();
    const record = await upload(harness.app, 'audio/wav', wavBytes({ durationMs: 1_000 }));

    const invalid = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/proposals`,
      payload: {
        proposals: [
          { kind: 'transcript', memory_type: 'technical_decision', content: 'Valid one.' },
          {
            kind: 'clip_observation',
            memory_type: 'preference',
            content: 'Beyond the file.',
            start_ms: 0,
            end_ms: 9_000,
          },
        ],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('media_source_invalid');

    const wrongKind = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/proposals`,
      payload: {
        proposals: [
          {
            kind: 'clip_observation',
            memory_type: 'preference',
            content: 'Audio has no visual observation.',
            start_ms: 0,
            end_ms: 500,
          },
        ],
      },
    });
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.json().error.code).toBe('media_source_invalid');

    const proposed = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/proposals`,
      payload: {
        proposals: [
          {
            kind: 'transcript',
            memory_type: 'technical_decision',
            content: '  Keep the header sticky on scroll.  ',
          },
        ],
      },
    });
    expect(proposed.statusCode).toBe(201);
    const body = proposed.json().data;
    expect(body.proposed).toHaveLength(1);
    expect(body.proposed[0]).toMatchObject({
      content: 'Keep the header sticky on scroll.',
      memory_type: 'technical_decision',
      reference: `muse-source://${record.source_id}/transcript`,
      created: true,
    });

    const proposedList = await harness.app.inject({
      method: 'GET',
      url: `/api/memories?project_id=${PROJECT}&status=proposed`,
    });
    expect(proposedList.json().data.items.map((item: { id: string }) => item.id)).toContain(
      body.proposed[0].memory_id,
    );

    const defaultList = await harness.app.inject({
      method: 'GET',
      url: `/api/memories?project_id=${PROJECT}`,
    });
    expect(defaultList.json().data.items).toEqual([]);
    expect(harness.engine.stats().proposed).toBe(1);
  });

  it('reports unconfigured provider operations without touching storage', async () => {
    const harness = await buildHarness({ configured: false });
    const record = await upload(harness.app, 'audio/wav', wavBytes());
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/media/sources/${record.source_id}/transcribe`,
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
    expect(harness.calls).toEqual([]);
  });
});
