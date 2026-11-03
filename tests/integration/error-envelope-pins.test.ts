// Characterization pins for the three error-envelope behaviors that the
// catalogue lockstep (KI-43 + KI-45 + KI-48, D042-style lockstep per the action
// register) intentionally changed. They were written against TODAY's wire at
// the time of pinning; the beta lockstep PR (catalogue v3) flipped the two
// documented lies in the SAME bump as the catalogue entries and the mappings —
// exactly what the original "do not fix this test alone" note demanded.
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

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

const HOST = { host: '127.0.0.1:8787' };

describe('error envelope pins (lockstep baseline: KI-43 / KI-45 / KI-48)', () => {
  it('KI-45 pin: malformed JSON answers 400 with bad_request, matching the catalogue', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'content-type': 'application/json' },
      payload: '{"content": "this line is not valid JSON',
    });
    expect(response.statusCode).toBe(400);
    // Flipped by the catalogue v3 lockstep (KI-45): the parse failure now
    // carries its published code instead of internal_error. Status was
    // always right; the code was the lie.
    expect(response.json().error.code).toBe('bad_request');
  });

  it('KI-48 pin: an oversized body answers 413 with payload_too_large (v3 class)', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ content: 'x'.repeat(1_048_576 + 64), type: 'project' }),
    });
    expect(response.statusCode).toBe(413);
    // Flipped by the catalogue v3 lockstep (KI-48): Fastify's bodyLimit
    // refusal now answers the published payload_too_large class instead of
    // internal_error.
    expect(response.json().error.code).toBe('payload_too_large');
  });

  it('stable pin: unknown routes keep the clean not_found envelope naming method and path', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/definitely/not/routed',
      headers: HOST,
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('GET /api/definitely/not/routed');
  });
});
