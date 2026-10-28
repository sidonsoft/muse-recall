/**
 * Cross-origin state-mutation regression check.
 *
 * Reproduces the audit's browser chain in isolation:
 *
 *   1. a project with an approved v1 and a staged v2,
 *   2. a hostile page served from a *different* loopback origin,
 *   3. that page sends a `no-cors` POST to the rollback route,
 *   4. the server must refuse it and the approved version must stay at v2,
 *   5. a legitimate same-origin browser POST must still roll back to v1.
 *
 * Everything runs on isolated ephemeral ports with the deterministic fake-Muse
 * fixture and the echo provider. No live model, no network, no keys.
 *
 * Uses Playwright-managed Chromium by default; FORGE_RUNTIME_BROWSER=chrome is the
 * explicit system-Chrome opt-in. There is no automatic fallback.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../apps/server/src/config.js';
import { ForgeJobManager } from '../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../apps/server/src/provider-health.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { EchoProvider } from '../packages/muse-provider/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/fake-muse.mjs', import.meta.url));
const PROJECT = 'origin-guard-demo';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function config(workspaceRoot: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: ['http://localhost:5173'],
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

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'origin-guard-'));
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'auto' },
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
  });
  const app = await buildApp({
    config: config(root),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    forgeManager: manager,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });

  const hostile = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Hostile page</title><p>Not the application.</p>');
  });

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => hostile.listen(0, '127.0.0.1', resolve));
    const apiAddress = app.server.address();
    const hostileAddress = hostile.address();
    assert(apiAddress && typeof apiAddress === 'object', 'API address unavailable');
    assert(hostileAddress && typeof hostileAddress === 'object', 'Hostile address unavailable');
    const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;
    const hostileOrigin = `http://127.0.0.1:${hostileAddress.port}`;

    // Approved v1, then a staged v2.
    await app.inject({
      method: 'POST',
      url: '/api/forge/projects',
      payload: { project_id: PROJECT, name: 'Origin guard demo' },
    });
    const generated = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/generate`,
      payload: { prompt: 'A colourful farmyard memory game for children with twelve cards.' },
    });
    const generatedId = generated.json().data.id as string;
    await waitForJob(app, generatedId);
    const firstApprove = await app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${generatedId}/approve`,
      payload: {},
    });
    assert(firstApprove.statusCode === 200, 'v1 approval failed');

    const modified = await app.inject({
      method: 'POST',
      url: `/api/forge/projects/${PROJECT}/modify`,
      payload: { request: 'Make the cards larger and add a sunset background.' },
    });
    const modifiedId = modified.json().data.id as string;
    await waitForJob(app, modifiedId);
    const secondApprove = await app.inject({
      method: 'POST',
      url: `/api/forge/jobs/${modifiedId}/approve`,
      payload: {},
    });
    assert(secondApprove.statusCode === 200, 'v2 approval failed');
    assert((await currentVersion(app)) === 2, 'expected approved v2 before attack');

    const { browser, selection } = await launchVerificationBrowser();
    reportBrowserSelection(selection);
    try {
      // Cross-origin attempt, exactly the audit's step 3 shape.
      const attacker = await browser.newPage();
      const statuses: number[] = [];
      attacker.on('response', (response) => {
        if (response.url().includes('/rollback')) statuses.push(response.status());
      });
      await attacker.goto(hostileOrigin, { waitUntil: 'load' });
      await attacker.evaluate(
        async ({ origin, project }) => {
          try {
            await fetch(`${origin}/api/forge/projects/${project}/rollback`, {
              method: 'POST',
              mode: 'no-cors',
              credentials: 'omit',
            });
          } catch {
            // A refusal is the expected outcome.
          }
        },
        { origin: apiOrigin, project: PROJECT },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      assert(statuses.includes(403), `expected 403 from hostile origin, saw ${statuses}`);
      assert(
        (await currentVersion(app)) === 2,
        'approved version changed after a foreign-origin rollback',
      );
      console.log('PASS foreign-origin rollback rejected (403); state still v2');

      // Legitimate same-origin browser POST.
      const legitimate = await browser.newPage();
      await legitimate.goto(`${apiOrigin}/api/health`, { waitUntil: 'load' });
      const sameOriginStatus = await legitimate.evaluate(
        async ({ origin, project }) => {
          const response = await fetch(`${origin}/api/forge/projects/${project}/rollback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          return response.status;
        },
        { origin: apiOrigin, project: PROJECT },
      );
      assert(
        sameOriginStatus === 200,
        `expected same-origin rollback 200, saw ${sameOriginStatus}`,
      );
      assert((await currentVersion(app)) === 1, 'same-origin rollback did not restore v1');
      console.log('PASS same-origin rollback accepted (200); state rolled back to v1');
      console.log(`hostile origin: ${hostileOrigin}`);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await new Promise<void>((resolve) => hostile.close(() => resolve()));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function waitForJob(app: Awaited<ReturnType<typeof buildApp>>, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
    const status = response.json().data.status as string;
    if (['succeeded', 'failed', 'cancelled', 'budget_exceeded'].includes(status)) {
      assert(status === 'succeeded', `job ${jobId} ended ${status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${jobId} did not finish`);
}

async function currentVersion(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: 'GET', url: `/api/forge/projects/${PROJECT}` });
  return response.json().data.state.current_version as number | null;
}

await main();
