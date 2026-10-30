import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Gap G-6 groundwork: an optional shared bearer token. Two trust models,
 * one server: no ACCESS_TOKEN leaves the loopback beta untouched; setting it
 * gates every /api route (liveness excepted) on the secret.
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
      maxOutputTokens: 1_200,
      tools: { enabled: false, approvalPolicy: 'always', maxCallsPerTurn: 3, decisionMode: 'off' },
    },
    serviceVersion: SERVICE_VERSION,
    ...overrides,
  };
}

async function appWith(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
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

const TOKEN = 'a-sufficiently-long-test-secret';

describe('shared bearer token (G-6 groundwork)', () => {
  it('without ACCESS_TOKEN the loopback beta is untouched: no header needed', async () => {
    const app = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/memories' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects missing, wrong, same-length-wrong, and malformed headers with 401 + challenge', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const missing = await app.inject({ method: 'GET', url: '/api/memories' });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect(missing.json().error.code).toBe('unauthorized');

    for (const presented of [
      `Bearer ${'x'.repeat(TOKEN.length)}`,
      `Bearer ${TOKEN}x`,
      TOKEN,
      `Basic ${TOKEN}`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { authorization: presented },
      });
      expect(response.statusCode, presented).toBe(401);
    }
  });

  it('accepts the exact bearer on reads and state-changing routes', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const list = await app.inject({
      method: 'GET',
      url: '/api/memories',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(list.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { project_id: 'alpha', title: 'tokened session' },
    });
    expect(created.statusCode).toBeLessThan(300);
  });

  it('auth is checked before origin/CSRF guards: POST without token is 401, not 403', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { origin: 'https://evil.example' },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/health stays open for liveness probes', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const meta = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(meta.statusCode).toBe(401); // introspection carries config: gated
  });

  it('/api/meta states which trust model is active', async () => {
    const open = await appWith();
    expect(open.json).toBeUndefined(); // sanity: inject only
    const metaOpen = await open.inject({ method: 'GET', url: '/api/meta' });
    expect(metaOpen.json().data.safety.authentication).toBe('loopback-only');

    const gated = await appWith({ accessToken: TOKEN });
    const metaGated = await gated.inject({
      method: 'GET',
      url: '/api/meta',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(metaGated.json().data.safety.authentication).toBe('shared-token');
  });
});
