/**
 * Separate-process regression for Forge completion failures.
 *
 * The reviewed bug was an unhandled rejection in the child's `close` handler:
 * a quota fallback called `resetStaging()`, which read a corrupted state.json
 * and rejected without a handler, terminating the server process. Running this
 * scenario in its own process makes that failure mode observable instead of
 * being masked by Vitest's own rejection handling.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MemoryEngine, openDatabase } from '../../packages/memory-engine/src/index.js';
import { EchoProvider } from '../../packages/muse-provider/src/index.js';

const FAKE_MUSE = join(process.cwd(), 'tests/fixtures/fake-muse.mjs');
const RESULT_PATH = process.env.FORGE_COMPLETION_RESULT;
if (!RESULT_PATH) throw new Error('FORGE_COMPLETION_RESULT is not set');

const VALID_HTML = `<!doctype html>
<html><head><title>Seed application</title></head>
<body><main><h1>Seed application</h1><button type="button">Start</button></main>
<script>document.body.dataset.ready = 'yes';</script></body></html>`;

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

const root = await mkdtemp(join(tmpdir(), 'forge-completion-process-'));
const database = openDatabase({ path: ':memory:', wal: false });
const engine = new MemoryEngine(database.db);
const workspace = new ForgeWorkspace(root);
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let manager: ForgeJobManager | null = null;

try {
  await workspace.ensureProject('demo');
  const seedJob = randomUUID();
  const seedStaging = await workspace.createStaging('demo', seedJob);
  await writeFile(join(seedStaging, 'index.html'), VALID_HTML, 'utf8');
  await workspace.promote('demo', seedJob, 'Seed', { baseVersion: null, jobId: seedJob });

  const statePath = join(workspace.projectDir('demo'), 'state.json');
  const invocationLog = join(root, 'muse-invocations.log');
  const wrapper = join(root, 'muse-wrapper.mjs');
  await writeFile(
    wrapper,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const fake = ${JSON.stringify(FAKE_MUSE)};
const log = ${JSON.stringify(invocationLog)};
const state = ${JSON.stringify(statePath)};
appendFileSync(log, 'run\\n');
const run = spawnSync(process.execPath, [fake, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, FAKE_MUSE_MODE: 'quota-corrupt' },
});
if (run.error) {
  process.stderr.write(String(run.error) + '\\n');
  process.exit(1);
}
// Simulate an operator/tool corrupting state between the primary run and the
// quota fallback. The next completion step must fail closed.
writeFileSync(state, '{ "current_version": 1, "versions": [', 'utf8');
process.exit(run.status ?? 1);
`,
    { encoding: 'utf8', mode: 0o700 },
  );
  await chmod(wrapper, 0o700);

  manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: wrapper,
    env: { FAKE_MUSE_MODE: 'quota-corrupt' },
    fallbackApiKey: 'test-fallback-key',
    fallbackModel: 'test-fallback-model',
    maxRuntimeMs: 30_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    shutdownGraceMs: 2_000,
    runtimeCheck: async () => ({ ok: true, errors: [] }),
  });
  app = await buildApp({
    config: config(root),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    forgeManager: manager,
  });

  const created = await manager.start({
    projectId: 'demo',
    kind: 'modify',
    prompt: 'Make the button label clearer.',
    request: 'Make the button label clearer.',
  });

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const status = manager.get(created.id)?.status;
    if (status !== 'queued' && status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const job = manager.get(created.id);
  if (!job) throw new Error('job disappeared');
  if (job.status === 'queued' || job.status === 'running') {
    throw new Error(`job did not terminalize: ${job.status}`);
  }

  const persisted = JSON.parse(
    await readFile(join(workspace.projectDir('demo'), 'jobs', `${created.id}.json`), 'utf8'),
  ) as { status: string };
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  const invocations = (await readFile(invocationLog, 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0).length;

  const shutdownStarted = Date.now();
  await manager.shutdown();
  const shutdownMs = Date.now() - shutdownStarted;

  await writeFile(
    RESULT_PATH,
    `${JSON.stringify({
      alive: health.statusCode === 200,
      status: job.status,
      error: job.error,
      errorLength: job.error?.length ?? 0,
      persistedStatus: persisted.status,
      invocations,
      shutdownMs,
      completed: true,
    })}\n`,
    'utf8',
  );
} finally {
  await manager?.shutdown().catch(() => undefined);
  await app?.close().catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
}
