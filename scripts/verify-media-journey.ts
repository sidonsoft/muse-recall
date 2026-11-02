/**
 * Media Studio journey: asset -> embedded artifact -> restart -> rollback.
 *
 *   approved image asset -> reference it in staged HTML -> approve application
 *   (v1, image embedded) -> restart the server -> confirm the artifact is
 *   byte-identical -> modify -> approve (v2) -> roll back -> confirm v1 bytes
 *   and the exact embedded image return together.
 *
 * Code generation always uses the deterministic fake Muse CLI, so this gate
 * never pays for a text-model call. The **image asset** arrives on one of two
 * rails, named by `MEDIA_JOURNEY_ASSET_SOURCE`:
 *
 *   live    (default, paid) one `/v1/images/generations` + one `/v1/images/edits`
 *   upload  (free)          local PNG bytes POSTed to `/media/upload`
 *
 * `upload` exists so the journey stays gated at every commit instead of once
 * per paid run: it refuses to start when a provider credential is configured,
 * pins `FORGE_MEDIA_MAX_RETRIES=0`, turns on `FORGE_MEDIA_TRACE`, and requires
 * the resulting ledger to be **empty**. `live` requires the same ledger to show
 * exactly one generate and one edit, answered, with no other path. An unknown
 * mode name is refused rather than defaulted, because defaulting once meant
 * quietly paying for two image calls.
 *
 * `upload` proves the flow on bytes the harness supplied; it does not prove
 * provider-returned bytes flow through it. The report labels which is which.
 *
 * Usage:
 *   pnpm verify:media-journey-offline                    # no credential, no call
 *   FORGE_MUSE_API_KEY=... pnpm verify:media-journey     # paid image rail
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  assetProvenance,
  type JourneyAssetSource,
  journeyLedgerIssues,
  parseAssetSource,
} from './lib/media-journey.js';
import { accountDispatches, ledgerEvidence, readMediaTrace } from './lib/media-trace.js';

const ROOT = process.cwd();
const PROJECT = 'media-journey';
const POLL_MS = 2_000;
const FORGE_TIMEOUT_MS = 120_000;
const MEDIA_TIMEOUT_MS = 360_000;

const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 19);
const EVIDENCE = join(ROOT, 'test-results', 'media-journey', STAMP);
const SERVER_LOG = join(EVIDENCE, 'server.log');

const checks: string[] = [];
const observations: Record<string, unknown> = {};

function check(label: string): void {
  checks.push(label);
  console.log(`  \u2713 ${label}`);
}

function fail(message: string): never {
  throw new Error(`media journey failed: ${message}`);
}

/** A deterministic PNG the offline rail uploads: a blue disc on a white field. */
function fixturePng(): Buffer {
  const size = 256;
  const png = new PNG({ width: size, height: size });
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (size * y + x) << 2;
      const inside = (x - centre) ** 2 + (y - centre) ** 2 < (size / 6) ** 2;
      png.data[offset] = inside ? 30 : 255;
      png.data[offset + 1] = inside ? 90 : 255;
      png.data[offset + 2] = inside ? 220 : 255;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function step(label: string): void {
  console.log(`\n== ${label}`);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Read the artifact endpoint and separate its two hashes: the sha256 of the
 * raw API response bytes (envelope included) and the sha256 of the version's
 * raw HTML inside the envelope. The server computes the latter over the
 * stored bytes and refuses to serve drifted versions, so it is the
 * version-identity hash; the former only proves the response was stable.
 */
async function artifactHtml(
  base: string,
  what: string,
): Promise<{ html: string; versionSha: string; responseSha: string }> {
  const result = await api(base, 'GET', `/api/forge/projects/${PROJECT}/artifact`);
  if (result.status !== 200) fail(`could not read artifact (${what})`);
  const responseSha = sha256Hex(result.bytes.toString('utf8'));
  const body = result.json as {
    ok: boolean;
    data: { html?: unknown; sha256?: unknown; version?: unknown };
  };
  if (typeof body?.data?.html !== 'string' || typeof body?.data?.sha256 !== 'string') {
    fail(`artifact response has no html/sha256 envelope (${what})`);
  }
  const html = body.data.html;
  const versionSha = sha256Hex(html);
  if (versionSha !== body.data.sha256) {
    fail(`server artifact sha256 does not match the served HTML (${what})`);
  }
  return { html, versionSha, responseSha };
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
    // The full log, not the tail, is what a zero-dispatch claim is read from.
    try {
      writeFileSync(SERVER_LOG, chunk, { flag: 'a' });
    } catch {
      /* best effort */
    }
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
  // Mode first: a name this gate does not know must be refused before any
  // prerequisite, credential read, port reservation or dispatch. Defaulting an
  // unknown value to the paid rail once meant paying for two image calls that
  // nobody asked for.
  const parsed = parseAssetSource(process.env.MEDIA_JOURNEY_ASSET_SOURCE);
  if (parsed.issues.length > 0) {
    console.log(`media journey: BLOCKED before anything ran — ${parsed.issues.join('; ')}`);
    process.exitCode = 2;
    return;
  }
  const assetSource: JourneyAssetSource = parsed.source;
  mkdirSync(EVIDENCE, { recursive: true });
  observations.asset_source = assetSource;
  observations.asset_source_requested = parsed.requested;
  observations.asset_source_from = parsed.source_of_truth;
  Object.assign(observations, assetProvenance(assetSource));

  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  observations.provider_credential_present = key.length > 0;
  if (assetSource === 'upload' && key.length > 0) {
    console.log(
      'media journey: the uploaded-asset rail refuses to run with FORGE_MUSE_API_KEY configured, ' +
        'because a keyed run could dispatch — unset it to run this for free',
    );
    process.exitCode = 2;
    return;
  }
  if (assetSource === 'live' && key.length === 0) {
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
    ...(assetSource === 'live' ? { FORGE_MUSE_API_KEY: key } : {}),
    // Both rails are accountable: the transport may never retry, and every
    // dispatch is written to the captured server log where the claim is read.
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
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

    let asset: { asset_id: string; version: number };
    if (assetSource === 'upload') {
      step('asset from local bytes the harness uploads (no provider call)');
      const png = fixturePng();
      const uploaded = dataOf(
        await api(base, 'POST', `/api/forge/projects/${PROJECT}/media/upload`, {
          mime: 'image/png',
          data_base64: png.toString('base64'),
          source_text: 'offline journey fixture: a blue disc on a white field',
        }),
        'upload image bytes',
      );
      if (typeof uploaded.asset_id !== 'string' || typeof uploaded.version !== 'number') {
        fail(`upload response had no asset id/version: ${JSON.stringify(uploaded).slice(0, 300)}`);
      }
      asset = { asset_id: uploaded.asset_id, version: uploaded.version };
      observations.uploaded_sha256 = uploaded.sha256;
      observations.uploaded_byte_size = uploaded.byte_size;
      // The stored record must describe the bytes actually sent, or the embedded
      // artifact cannot later be traced back to anything.
      const localSha = createHash('sha256').update(png).digest('hex');
      if (uploaded.sha256 !== localSha) {
        fail(
          `the stored asset sha256 ${String(uploaded.sha256).slice(0, 12)}… is not the uploaded ` +
            `bytes ${localSha.slice(0, 12)}…`,
        );
      }
      if (uploaded.byte_size !== png.length) {
        fail(`the stored asset is ${String(uploaded.byte_size)} bytes, not ${png.length}`);
      }
      check('uploaded bytes stored with the sha256 and size of what was sent');
    } else {
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
      asset = edited;
    }

    step('approve the asset version that will be embedded');
    const approved = dataOf(
      await api(
        base,
        'POST',
        `/api/forge/projects/${PROJECT}/media/${asset.asset_id}/versions/${asset.version}/approve`,
      ),
      'approve asset',
    );
    if (approved.status !== 'approved') fail(`asset not approved: ${JSON.stringify(approved)}`);
    console.log(`asset ${asset.asset_id} v${asset.version} approved`);
    check(`asset ${assetSource === 'upload' ? 'uploaded' : 'generated'} version approved`);

    step('reference the approved image from staged HTML and approve v1');
    const staged = join(workspaceRoot, 'forge', PROJECT, 'staging', genId, 'index.html');
    await writeFile(
      staged,
      `<html><body><h1>Media journey</h1><img alt="the circle" src="muse-asset://${asset.asset_id}/v${asset.version}"></body></html>\n`,
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
    const v1 = await artifactHtml(base, 'v1');
    const v1Html = v1.html;
    if (v1Html.includes('muse-asset://'))
      fail('v1 artifact still contains an unresolved asset reference');
    if (!v1Html.includes('data:image/')) fail('v1 artifact has no embedded image');
    const v1Sha = v1.versionSha;
    console.log(`v1 approved, version-HTML sha256 ${v1Sha}, embedded image present`);
    check('approved v1 embeds the approved asset bytes with no unresolved reference');

    step('restart the server and confirm the artifact is byte-identical');
    await stopServer(server);
    server = startServer(env);
    await waitForHttp(`${base}/api/health`);
    const revived = await artifactHtml(base, 'after restart');
    if (revived.versionSha !== v1Sha) fail('version HTML changed across restart');
    if (revived.responseSha !== v1.responseSha) fail('artifact response changed across restart');
    const stateAfterRestart = dataOf(
      await api(base, 'GET', `/api/forge/projects/${PROJECT}`),
      'read state after restart',
    ).state as { current_version: unknown };
    if (stateAfterRestart.current_version !== 1) fail('current_version is not 1 after restart');
    console.log(`after restart: version-HTML sha256 matches v1, current_version 1`);
    check('restart returned a byte-identical artifact including the embedded asset');

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
    const v2 = await artifactHtml(base, 'v2');
    if (v2.versionSha === v1Sha) fail('v2 version HTML is identical to v1; expected a change');
    console.log(`v2 approved, version-HTML sha256 ${v2.versionSha} (differs from v1)`);

    dataOf(await api(base, 'POST', `/api/forge/projects/${PROJECT}/rollback`), 'rollback');
    const rolled = await artifactHtml(base, 'after rollback');
    if (rolled.versionSha !== v1Sha) fail('version HTML after rollback is not v1');
    const rolledHtml = rolled.html;
    if (!rolledHtml.includes('data:image/')) fail('rolled-back artifact lost the embedded image');
    const embeddedV1 = /data:image\/[^"']+/.exec(v1Html)?.[0] ?? '';
    const embeddedRolled = /data:image\/[^"']+/.exec(rolledHtml)?.[0] ?? '';
    if (embeddedV1.length === 0 || embeddedV1 !== embeddedRolled) {
      fail('the exact embedded image did not return with the rollback');
    }
    console.log('rollback returned byte-identical v1 with the exact embedded image');
    check('rollback restored v1 bytes and the exact embedded image bytes');

    // Every paid-call claim is read from the captured log, never asserted.
    const evidence = ledgerEvidence(SERVER_LOG);
    observations.ledger_evidence = evidence;
    if (!evidence.logPresent) {
      fail('no media trace log was written, so this run can claim nothing about dispatches');
    }
    const ledger = accountDispatches(readMediaTrace(SERVER_LOG));
    observations.dispatch_ledger = ledger.dispatches;
    observations.dispatch_paths = ledger.paths;
    const ledgerIssues = journeyLedgerIssues(ledger, assetSource);
    observations.ledger_issues = ledgerIssues;
    if (ledgerIssues.length > 0) {
      fail(`the ledger does not support this run's paid-call claim: ${ledgerIssues.join('; ')}`);
    }
    check(
      assetSource === 'upload'
        ? `the offline journey dispatched nothing (${String(evidence.logBytes)} bytes of trace read, 0 dispatch lines)`
        : 'the live journey paid for exactly one generate and one edit, answered, no other path',
    );

    observations.v1_version_sha256 = v1Sha;
    observations.v2_version_sha256 = v2.versionSha;
    observations.embedded_data_url_chars = embeddedV1.length;
    observations.embedded_sha256 = sha256Hex(embeddedV1);

    console.log('\nmedia journey: ok');
    console.log(`v1 version-HTML sha256: ${v1Sha} (server-recorded, recomputed match)`);
    console.log(`v1 API-response sha256: ${v1.responseSha} (envelope stability only)`);
    console.log(
      `embedded image bytes: ${embeddedV1.length} chars of data URL, identical after rollback`,
    );
    writeReport('PASS');
    console.log(
      `\nmedia journey (${assetSource}): ${String(checks.length)} checks — evidence in ${EVIDENCE}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    observations.failure = reason;
    writeReport('FAILED before completion');
    console.error(server.tail());
    console.error(`FAILED before completion: ${reason}`);
    console.error(`evidence: ${EVIDENCE}`);
    process.exitCode = 1;
  } finally {
    await stopServer(server);
  }
}

function writeReport(status: string): void {
  try {
    writeFileSync(
      join(EVIDENCE, 'report.json'),
      `${JSON.stringify(
        {
          ok: status === 'PASS',
          status,
          stamp: STAMP,
          project: PROJECT,
          completed_checks: checks.length,
          checks,
          observations,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    if (status !== 'PASS') {
      writeFileSync(
        join(EVIDENCE, 'FAILED.md'),
        `# media journey: ${status}\n\n${String(observations.failure ?? 'no reason recorded')}\n\ncompleted checks: ${String(checks.length)}\n`,
        'utf8',
      );
    }
  } catch {
    /* evidence writing must not mask the failure */
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
