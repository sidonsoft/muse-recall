import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { type HealthResponse, HealthResponseSchema } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';

/**
 * The setup readiness block inside GET /api/health.
 *
 * The unit tests cover the probe's decisions; this covers the wiring, because a
 * panel that exists only in a script would drift from what the System screen
 * renders. It also pins the promise the panel makes to a judge: the health route
 * answers the prerequisite question without a model call, so it stays usable on
 * a machine that has no credentials configured at all — which is the state a
 * first-time reader is in.
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function testConfig(workspaceRoot: string, databasePath: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8787,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath,
    wal: false,
    workspaceRoot,
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo', museBin: 'muse' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    alertBackupMaxAgeHours: 24,
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

async function appOnFreshWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'setup-readiness-health-'));
  roots.push(dir);
  const dbFile = join(dir, 'app.db');
  const database = openDatabase({ path: dbFile, wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config: testConfig(join(dir, 'workspaces'), dbFile),
    db: database.db,
    dbPath: dbFile,
    provider,
    engine: new MemoryEngine(database.db),
  });
  openApps.push(app);
  return app;
}

describe('setup readiness in GET /api/health', () => {
  it('reports the prerequisite states for an unseeded, credential-free test instance', async () => {
    const app = await appOnFreshWorkspace();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:8787' },
    });
    expect(response.statusCode).toBe(200);

    const payload = response.json().data as HealthResponse;
    expect(() => HealthResponseSchema.parse(payload)).not.toThrow();

    const setup = payload.setup;
    expect(setup).toBeTruthy();
    // The environment is whatever runs the suite; both are honest answers.
    expect(['local', 'codespaces']).toContain(setup?.environment);
    expect(setup?.provider).toBe('echo');
    // Offline provider on purpose: generation is off by design, not broken.
    expect(setup?.cli.state).toBe('not_available');
    // No media key in this instance's configuration, and nothing was probed live.
    expect(setup?.media_api.state).toBe('missing');
    expect(setup?.media_api.fix).toContain('FORGE_MUSE_API_KEY');
    // A fresh temp workspace has no seeded demo, which is the most common reason
    // a first Studio session looks empty.
    expect(setup?.offline_seed.state).toBe('missing');
    expect(setup?.offline_seed.fix).toContain('pnpm demo:seed');
    // The browser row is machine-dependent, so only its shape is pinned: whatever
    // it says, it says what to do about it.
    expect(['ready', 'missing', 'not_available', 'not_probed']).toContain(setup?.browser.state);
    expect((setup?.browser.detail ?? '').length).toBeGreaterThan(10);
    if (setup?.browser.state === 'missing') {
      expect(setup.browser.fix).toContain('playwright-core install chromium');
    }
  });

  it('does not let the setup block change the liveness verdict', async () => {
    const app = await appOnFreshWorkspace();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:8787' },
    });
    const payload = response.json().data as HealthResponse;
    // Missing prerequisites are onboarding facts, not a sick server.
    expect(payload.setup?.offline_seed.state).toBe('missing');
    expect(payload.status).toBe('ok');
  });
});
