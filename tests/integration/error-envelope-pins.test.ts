// Characterization pins for the three error-envelope behaviors that the post-judging
// catalogue lockstep (KI-43 + KI-45 + KI-48, D042 lockstep per the action register)
// will intentionally change. These tests pin TODAY's wire, not the desired wire: when
// the lockstep PR lands, it must update code + catalogue + these pins together, in one
// contract version bump. Until then, they guarantee nothing drifts further.
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
  it('KI-45 pin: malformed JSON today answers 400 with internal_error, not bad_request', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'content-type': 'application/json' },
      payload: '{"content": "this line is not valid JSON',
    });
    expect(response.statusCode).toBe(400);
    // Pinned deliberately wrong-but-current: KI-45 documents that Fastify's parse
    // failure re-maps to internal_error while the catalogue promises bad_request.
    // The lockstep PR changes this assertion to bad_request WITH the catalogue
    // entry and the mapping, in one contract bump. Do not "fix" this test alone.
    expect(response.json().error.code).toBe('internal_error');
  });

  it('KI-48 pin: an oversized body today answers 413 with internal_error, no catalogue class', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { ...HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ content: 'x'.repeat(1_048_576 + 64), type: 'project' }),
    });
    expect(response.statusCode).toBe(413);
    // Pinned current behavior (KI-48): Fastify's bodyLimit refusal re-maps to
    // internal_error and the published catalogue has no 413 class at all. The
    // lockstep PR adds payload_too_large and flips this pin in the same bump.
    expect(response.json().error.code).toBe('internal_error');
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
