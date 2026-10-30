import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { ErrorCatalog } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * The machine-readable error catalogue (roadmap §3 remainder) must MIRROR the
 * server's real mappings — so every probe here compares a live response
 * against the published entry. If a mapping drifts without the catalogue, this
 * suite goes red; if a known asymmetry is fixed, the catalogue entry moves in
 * the same PR and these tests follow.
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
    port: 8787,
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

const LOOPBACK = '127.0.0.1:8787';
const TOKEN = 'catalog-probe-secret-0123456789';

describe('machine-readable error catalogue (GET /api/errors)', () => {
  it('publishes a versioned catalogue with well-formed, unique entries per group', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/errors',
      headers: { host: LOOPBACK },
    });
    expect(response.statusCode).toBe(200);
    const catalog = response.json().data as ErrorCatalog;
    expect(catalog.catalog_version).toBe(1);
    const groups = Object.entries(catalog.groups);
    expect(groups.length).toBe(5);
    for (const [name, entries] of groups) {
      expect(entries.length, name).toBeGreaterThan(0);
      const codes = entries.map((entry) => entry.code);
      expect(new Set(codes).size, `duplicate codes in ${name}`).toBe(codes.length);
      for (const entry of entries) {
        expect(entry.http_status).toBeGreaterThanOrEqual(400);
        expect(entry.when.length).toBeGreaterThan(10);
      }
    }
  });

  it('live responses match their published entries: code AND status (drift gate)', async () => {
    const app = await appWith();
    const catalog = (
      await app.inject({ method: 'GET', url: '/api/errors', headers: { host: LOOPBACK } })
    ).json().data as ErrorCatalog;
    const entryFor = (code: string) =>
      Object.values(catalog.groups)
        .flatMap((entries) => entries)
        .find((e) => e.code === code);

    const probes: Array<{
      code: string;
      run: () => Promise<{ statusCode: number; body: { error?: { code?: string } } }>;
    }> = [
      {
        code: 'invalid_host',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: 'evil.example' },
            payload: { type: 'contextual_fact', scope: 'global', content: 'x' },
          }),
      },
      {
        code: 'forbidden_origin',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: LOOPBACK, origin: 'http://evil.example' },
            payload: { type: 'contextual_fact', scope: 'global', content: 'x' },
          }),
      },
      {
        code: 'not_found',
        run: () => app.inject({ method: 'GET', url: '/api/nope', headers: { host: LOOPBACK } }),
      },
      {
        code: 'validation_failed',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: LOOPBACK },
            payload: { nope: true },
          }),
      },
    ];
    for (const probe of probes) {
      const response = await probe.run();
      const entry = entryFor(probe.code);
      expect(entry, `catalogue is missing ${probe.code}`).toBeDefined();
      expect(response.json().error?.code, probe.code).toBe(probe.code);
      expect(response.statusCode, probe.code).toBe(entry?.http_status);
    }
  });

  it('unauthorized in token mode matches its entry too', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const catalog = (
      await app.inject({
        method: 'GET',
        url: '/api/errors',
        headers: { host: LOOPBACK, authorization: `Bearer ${TOKEN}` },
      })
    ).json().data as ErrorCatalog;
    const live = await app.inject({
      method: 'GET',
      url: '/api/memories',
      headers: { host: LOOPBACK },
    });
    expect(live.statusCode).toBe(401);
    expect(live.json().error.code).toBe('unauthorized');
    const entry = Object.values(catalog.groups)
      .flatMap((entries) => entries)
      .find((e) => e.code === 'unauthorized');
    expect(entry?.http_status).toBe(401);
  });

  it('meta points at the catalogue so discovery needs no docs', async () => {
    const app = await appWith();
    const meta = await app.inject({ method: 'GET', url: '/api/meta', headers: { host: LOOPBACK } });
    expect(meta.json().data.errors).toEqual({ catalog_version: 1, endpoint: '/api/errors' });
  });
});
