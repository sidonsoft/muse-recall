/**
 * Live media Studio journey for Batch B acceptance.
 *
 * Drives the real server end to end against the live image provider:
 *
 *   image generate -> image edit -> approve asset -> reference it in staged
 *   HTML -> approve application (v1, images embedded) -> restart the server
 *   -> confirm the artifact is byte-identical -> modify -> approve (v2) ->
 *   roll back -> confirm v1 bytes and embedded image return together.
 *
 * Code generation uses the deterministic fake Muse CLI (no text-model cost);
 * only the two image calls reach the paid provider. Requires
 * FORGE_MUSE_API_KEY in the environment and a Playwright Chromium build
 * (`pnpm exec playwright-core install chromium`) for the approval gate.
 *
 * Usage: FORGE_MUSE_API_KEY=... pnpm verify:media-journey
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const PROJECT = 'media-journey';
const POLL_MS = 2_000;
const FORGE_TIMEOUT_MS = 120_000;
const MEDIA_TIMEOUT_MS = 360_000;

function fail(message: string): never {
  throw new Error(`media journey failed: ${message}`);
}

function step(label: string): void {
  console.log(`\n== ${label}`);
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') fail('could not allocate a port');
  return (address as { port: number }).port;
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`timed out waiting for ${url}: ${last}`);
}

interface ApiResult {
  status: number;
  json: unknown;
  bytes: Buffer;
}

async function api(
  base: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<ApiResult> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: payload !== undefined ? { 'content-type': 'application/json' } : {},
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json: unknown = null;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    // Artifact and preview endpoints return raw HTML, not envelopes.
  }
  return { status: response.status, json, bytes };
}

function dataOf(result: ApiResult, what: string): Record<string, unknown> {
  if (result.status >= 300)
    fail(`${what}: HTTP ${result.status}: ${result.bytes.toString('utf8').slice(0, 300)}`);
  const body = result.json as { ok: boolean; data: Record<string, unknown> };
  if (!body?.ok) fail(`${what}: not ok: ${result.bytes.toString('utf8').slice(0, 300)}`);
  return body.data;
}

interface Managed {
  child: ChildProcess;
  tail: () => string;
}

function startServer(env: NodeJS.ProcessEnv): Managed {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'apps/server/src/index.ts')],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let tail = '';
  const append = (chunk: Buffer): void => {
    tail = `${tail}${chunk.toString('utf8')}`.slice(-4_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error) => {
    console.error(`server spawn error: ${error.message}`);
  });
  return { child, tail: () => tail };
}

async function stopServer(server: Managed): Promise<void> {
  const pid = server.child.pid;
  if (server.child.exitCode !== null || pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        server.child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      resolve();
    }, 10_000);
    server.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      server.child.kill('SIGTERM');
    } catch {
      resolve();
    }
  });
}

async function waitMediaJob(
  base: string,
  jobId: string,
): Promise<{ asset_id: string; version: number }> {
  const deadline = Date.now() + MEDIA_TIMEOUT_MS;
  for (;;) {
    const data = dataOf(
      await api(base, 'GET', `/api/forge/projects/${PROJECT}/media/jobs/${jobId}`),
      'poll media job',
    );
    if (data.status === 'succeeded') {
      const result = data.result as { asset_id?: unknown; version?: unknown } | null;
      if (typeof result?.asset_id !== 'string') fail('media job has no asset_id');
      return {
        asset_id: result.asset_id as string,
        version: typeof result.version === 'number' ? result.version : 1,
      };
    }
    if (data.status === 'failed' || data.status === 'cancelled') {
      fail(`media job ${data.status}: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    }
    if (Date.now() > deadline) fail(`media job ${jobId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function waitForgeJob(base: string, jobId: string): Promise<void> {
  const deadline = Date.now() + FORGE_TIMEOUT_MS;
  for (;;) {
    const data = dataOf(await api(base, 'GET', `/api/forge/jobs/${jobId}`), 'poll forge job');
    if (data.status === 'succeeded') return;
    if (
      data.status === 'failed' ||
      data.status === 'budget_exceeded' ||
      data.status === 'cancelled' ||
      data.status === 'rejected'
    ) {
      fail(`forge job ${data.status}: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    }
    if (Date.now() > deadline) fail(`forge job ${jobId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main(): Promise<void> {
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  if (key.length === 0) {
    console.log('media journey: unconfigured (FORGE_MUSE_API_KEY is not set)');
    process.exitCode = 2;
    return;
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataRoot = mkdtempSync(join(tmpdir(), 'media-journey-'));
  const workspaceRoot = join(dataRoot, 'workspaces');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: join(dataRoot, 'memory.db'),
    WORKSPACE_ROOT: workspaceRoot,
    MODEL_PROVIDER: 'echo',
    LOG_LEVEL: 'warn',
    FORGE_MUSE_BIN: join(ROOT, 'tests/fixtures/fake-muse.mjs'),
    FORGE_MUSE_MODEL: 'fake-muse',
    FORGE_MUSE_API_KEY: key,
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_RUNTIME_MS: '60000',
    FAKE_MUSE_MODE: 'app',
    FAKE_MUSE_APP: join(ROOT, 'tests/fixtures/general-app-form.html'),
    FORGE_RUNTIME_BROWSER: 'managed',
  };

  let server = startServer(env);
  try {
    await waitForHttp(`${base}/api/health`);
    console.log(`server up on ${base} (data ${dataRoot})`);

    step('create project and generate the application shell');
    dataOf(
      await api(base, 'POST', '/api/forge/projects', {
        project_id: PROJECT,
        name: 'Media Journey',
      }),
      'create project',
    );
    const genId = dataOf(
      await api(base, 'POST', `/api/forge/projects/${PROJECT}/generate`, {
        prompt: 'A small accessible task list with add, delete and a task count.',
      }),
      'start generate',
    ).id as string;
    await waitForgeJob(base, genId);
    console.log(`generate job ${genId} succeeded`);

    step('generate an image with the live provider');
    const genJob = dataOf(
      await api(base, 'POST', `/api/forge/projects/${PROJECT}/media/generate`, {
        prompt: 'a single small blue circle centered on a plain white background',
        size: '512x512',
      }),
      'enqueue image generate',
    ).id as string;
    const generated = await waitMediaJob(base, genJob);
    console.log(`image generated: asset ${generated.asset_id} v${generated.version}`);

    step('edit the image with the live provider');
    const editJob = dataOf(
      await api(base, 'POST', `/api/forge/projects/${PROJECT}/media/edit`, {
        prompt: 'change the circle to green, keep everything else the same',
        size: '512x512',
        parent: { asset_id: generated.asset_id },
      }),
      'enqueue image edit',
    ).id as string;
    const edited = await waitMediaJob(base, editJob);
    console.log(`image edited: asset ${edited.asset_id} v${edited.version}`);

    step('approve the edited asset version');
    const approved = dataOf(
      await api(
        base,
        'POST',
        `/api/forge/projects/${PROJECT}/media/${edited.asset_id}/versions/${edited.version}/approve`,
      ),
      'approve asset',
    );
    if (approved.status !== 'approved') fail(`asset not approved: ${JSON.stringify(approved)}`);
    console.log(`asset ${edited.asset_id} v${edited.version} approved`);

    step('reference the approved image from staged HTML and approve v1');
    const staged = join(workspaceRoot, 'forge', PROJECT, 'staging', genId, 'index.html');
    await writeFile(
      staged,
      `<html><body><h1>Media journey</h1><img alt="edited circle" src="muse-asset://${edited.asset_id}/v${edited.version}"></body></html>\n`,
      'utf8',
    );
    const approveV1 = await api(base, 'POST', `/api/forge/jobs/${genId}/approve`, {
      capture_memory: false,
    });
    if (approveV1.status !== 200) {
      fail(
        `approve v1: HTTP ${approveV1.status}: ${approveV1.bytes.toString('utf8').slice(0, 500)}`,
      );
    }
    const v1 = await api(base, 'GET', `/api/forge/projects/${PROJECT}/artifact`);
    if (v1.status !== 200) fail('could not read v1 artifact');
    const v1Html = v1.bytes.toString('utf8');
    if (v1Html.includes('muse-asset://'))
      fail('v1 artifact still contains an unresolved asset reference');
    if (!v1Html.includes('data:image/')) fail('v1 artifact has no embedded image');
    const v1Sha = sha256Hex(v1.bytes);
    console.log(`v1 approved, sha256 ${v1Sha}, embedded image present`);

    step('restart the server and confirm the artifact is byte-identical');
    await stopServer(server);
    server = startServer(env);
    await waitForHttp(`${base}/api/health`);
    const revived = await api(base, 'GET', `/api/forge/projects/${PROJECT}/artifact`);
    if (revived.status !== 200) fail('could not read artifact after restart');
    if (sha256Hex(revived.bytes) !== v1Sha) fail('artifact changed across restart');
    const stateAfterRestart = dataOf(
      await api(base, 'GET', `/api/forge/projects/${PROJECT}`),
      'read state after restart',
    ).state as { current_version: unknown };
    if (stateAfterRestart.current_version !== 1) fail('current_version is not 1 after restart');
    console.log(`after restart: artifact sha256 matches v1, current_version 1`);

    step('modify, approve v2, then roll back to v1');
    const modId = dataOf(
      await api(base, 'POST', `/api/forge/projects/${PROJECT}/modify`, {
        request: 'Add a short footer line under the task count.',
      }),
      'start modify',
    ).id as string;
    await waitForgeJob(base, modId);
    const approveV2 = await api(base, 'POST', `/api/forge/jobs/${modId}/approve`, {
      capture_memory: false,
    });
    if (approveV2.status !== 200) {
      fail(
        `approve v2: HTTP ${approveV2.status}: ${approveV2.bytes.toString('utf8').slice(0, 500)}`,
      );
    }
    const v2 = await api(base, 'GET', `/api/forge/projects/${PROJECT}/artifact`);
    if (sha256Hex(v2.bytes) === v1Sha) fail('v2 artifact is identical to v1; expected a change');
    console.log(`v2 approved, sha256 ${sha256Hex(v2.bytes)} (differs from v1)`);

    dataOf(await api(base, 'POST', `/api/forge/projects/${PROJECT}/rollback`), 'rollback');
    const rolled = await api(base, 'GET', `/api/forge/projects/${PROJECT}/artifact`);
    if (rolled.status !== 200) fail('could not read artifact after rollback');
    if (sha256Hex(rolled.bytes) !== v1Sha) fail('artifact after rollback is not v1');
    const rolledHtml = rolled.bytes.toString('utf8');
    if (!rolledHtml.includes('data:image/')) fail('rolled-back artifact lost the embedded image');
    const embeddedV1 = /data:image\/[^"']+/.exec(v1Html)?.[0] ?? '';
    const embeddedRolled = /data:image\/[^"']+/.exec(rolledHtml)?.[0] ?? '';
    if (embeddedV1.length === 0 || embeddedV1 !== embeddedRolled) {
      fail('the exact embedded image did not return with the rollback');
    }
    console.log('rollback returned byte-identical v1 with the exact embedded image');

    console.log('\nmedia journey: ok');
    console.log(`v1 sha256: ${v1Sha}`);
    console.log(
      `embedded image bytes: ${embeddedV1.length} chars of data URL, identical after rollback`,
    );
  } catch (error) {
    console.error(server.tail());
    throw error;
  } finally {
    await stopServer(server);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
