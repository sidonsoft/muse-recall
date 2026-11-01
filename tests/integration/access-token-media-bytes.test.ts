import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import { MediaJobStore } from '../../apps/server/src/media/jobs.js';
import { MediaService } from '../../apps/server/src/media/service.js';
import { MediaSourceStore } from '../../apps/server/src/media/sources.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * The premise of the Batch D playback fix, proven at the HTTP boundary: the
 * source-bytes route is bearer-gated, so a browser `<audio src>` or download
 * `href` — which cannot attach the header — gets 401 under ACCESS_TOKEN, while
 * a request that does send the header gets the real bytes. This is why the web
 * client fetches bytes through the API client and hands the element a blob URL.
 */

const TOKEN = 'a-sufficiently-long-test-secret';
const PROJECT = 'bytetest';
/** A valid mono 16-bit PCM WAV (2 samples) so server-side validation passes. */
function wavBytes(samples: number): Buffer {
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(24_000, 24); // sample rate
  buffer.writeUInt32LE(48_000, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index === 0 ? 1_000 : -1_000, 44 + index * 2);
  }
  return buffer;
}

const WAV = wavBytes(2_400); // 100 ms at 24 kHz, above the 1 ms measurability floor

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function config(workspaceRoot: string, overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  };
}

async function harness(
  overrides: Partial<AppConfig> = {},
): Promise<{ app: FastifyInstance; sourceId: string }> {
  const root = mkdtempSync(join(tmpdir(), 'media-bytes-auth-'));
  roots.push(root);
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const assets = new MediaAssetStore(workspace);
  const jobs = new MediaJobStore(workspace);
  const sources = new MediaSourceStore(workspace);
  const service = new MediaService(assets, jobs, null, {}, { sources, engine });
  const provider = new EchoProvider();
  const app = await buildApp({
    config: config(root, overrides),
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine,
    forgeWorkspace: workspace,
    mediaAssets: assets,
    mediaJobs: jobs,
    mediaSources: sources,
    mediaService: service,
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  const configuredToken = overrides.accessToken;
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/media/sources`,
    ...(configuredToken === undefined || configuredToken === null
      ? {}
      : { headers: { authorization: `Bearer ${configuredToken}` } }),
    payload: {
      mime: 'audio/wav',
      data_base64: WAV.toString('base64'),
      origin: 'upload',
      original_name: 'note.wav',
    },
  });
  if (uploaded.statusCode !== 201) {
    throw new Error(`upload failed: ${uploaded.statusCode} ${uploaded.body.slice(0, 200)}`);
  }
  return { app, sourceId: (uploaded.json().data as { source_id: string }).source_id };
}

describe('source bytes under a shared bearer token', () => {
  it('401s a bare byte URL request, exactly as a browser media element would', async () => {
    const { app, sourceId } = await harness({ accessToken: TOKEN });
    const bare = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources/${sourceId}/bytes`,
    });
    expect(bare.statusCode).toBe(401);
    expect(bare.json().error.code).toBe('unauthorized');
    const authed = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources/${sourceId}/bytes`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.headers['content-type']).toBe('audio/wav');
    expect(authed.rawPayload.equals(WAV)).toBe(true);
  });

  it('stays tokenless when ACCESS_TOKEN is not configured', async () => {
    const { app, sourceId } = await harness();
    const plain = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/${PROJECT}/media/sources/${sourceId}/bytes`,
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-type']).toBe('audio/wav');
    expect(plain.headers['content-security-policy']).toContain("default-src 'none'");
    expect(plain.rawPayload.equals(WAV)).toBe(true);
  });

  it('does not leak another project bytes for the same source id', async () => {
    const { app, sourceId } = await harness({ accessToken: TOKEN });
    const other = await app.inject({
      method: 'GET',
      url: `/api/forge/projects/some-other-project/media/sources/${sourceId}/bytes`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(other.statusCode).toBe(404);
  });
});
