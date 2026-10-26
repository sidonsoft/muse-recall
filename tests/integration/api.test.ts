import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * HTTP contract tests.
 *
 * The app is assembled exactly as production assembles it — real Fastify, real
 * SQLite schema, real route handlers — with the deterministic provider in
 * place of Muse. Fastify's `inject` drives requests without binding a port.
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
    corsOrigins: ['http://127.0.0.1:5173'],
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

async function createTestApp(
  options: { provider?: EchoProvider; config?: Partial<AppConfig> } = {},
): Promise<FastifyInstance> {
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const provider = options.provider ?? new EchoProvider();
  const app = await buildApp({
    config: testConfig(options.config),
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
    startedAt: Date.now() - 5_000,
  });
  openApps.push(app);
  return app;
}

describe('GET /api/live', () => {
  it('reports liveness without touching the database', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/live' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.data.timestamp))).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('verifies the database with a real write round-trip', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);

    const { data } = response.json();
    expect(data.service).toBe('muse-memory-lab');
    expect(data.version).toBe(SERVICE_VERSION);
    expect(data.database.status).toBe('ok');
    expect(data.database.write_verified).toBe(true);
    expect(data.database.schema_version).toBeGreaterThanOrEqual(1);
    expect(data.database.engine).toMatch(/^sqlite/);
    expect(data.uptime_seconds).toBeGreaterThan(0);
  });

  it('reports the provider as unverified until a live check runs', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const { data } = response.json();
    expect(data.provider.status).toBe('skipped');
    expect(data.provider.verified_with_live_call).toBe(false);
    expect(data.provider.provider_id).toBe('echo');
    expect(data.provider.capabilities.streaming).toBe(true);
  });

  it('verifies the provider on demand with ?probe=live', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health?probe=live' });
    const { data } = response.json();
    expect(data.provider.verified_with_live_call).toBe(true);
    expect(data.provider.status).toBe('ok');
    expect(data.provider.model).toBe('echo-1');
    expect(data.status).toBe('ok');
  });

  it('rejects an unknown probe value with a validation error', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health?probe=everything' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });
});

describe('POST /api/health/muse', () => {
  it('runs a live probe and reports latency', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/health/muse' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.ok).toBe(true);
    expect(data.verified_with_live_call).toBe(true);
    expect(typeof data.latency_ms).toBe('number');
    expect(data.message).toMatch(/live reply received/);
  });

  it('accepts a bodyless POST that announces JSON content-type', async () => {
    // Regression: this combination previously produced a Fastify 400.
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/health/muse',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(response.statusCode).toBe(200);
  });

  it('reports a provider failure instead of crashing', async () => {
    const failing = new EchoProvider({
      respond: () => {
        throw new Error('upstream exploded');
      },
    });
    const app = await createTestApp({ provider: failing });
    const response = await app.inject({ method: 'POST', url: '/api/health/muse' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.ok).toBe(false);
    expect(data.message).toMatch(/upstream exploded/);
  });
});

describe('GET /api/meta', () => {
  it('describes the provider and reports honest module status', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.phase).toBe(5);
    expect(data.provider.id).toBe('echo');
    expect(data.modules.memory_engine).toBe('complete');
    expect(data.modules.ui_protocol).toBe('complete');
    expect(data.safety.generated_code_execution).toBe(false);
  });
});

describe('POST /api/provider/generate', () => {
  it('returns a model response for a valid prompt', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      payload: { prompt: 'ping' },
    });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.text).toBe('echo: ping');
    expect(data.provider).toBe('echo');
    expect(data.usage.input_tokens).toBeGreaterThan(0);
  });

  it('rejects an empty prompt', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      payload: { prompt: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('rejects an oversized prompt rather than spending quota on it', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      payload: { prompt: 'x'.repeat(4_001) },
    });
    expect(response.statusCode).toBe(400);
  });

  it('caps max_output_tokens at the server limit', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      payload: { prompt: 'ping', max_output_tokens: 50_000 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('maps a provider failure to 503 with a stable code', async () => {
    const failing = new EchoProvider({
      respond: () => {
        throw new Error('no capacity');
      },
    });
    const app = await createTestApp({ provider: failing });
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      payload: { prompt: 'ping' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('provider_unavailable');
  });
});

describe('error handling', () => {
  it('returns the shared envelope for unknown routes', async () => {
    const app = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
  });

  it('refuses a malformed JSON body without leaking internals', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/provider/generate',
      headers: { 'content-type': 'application/json' },
      payload: '{ this is not json',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).not.toMatch(/at Object|node_modules/);
  });
});
