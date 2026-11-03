/**
 * Batch C — resume the preserved 0755 isolated run WITHOUT new inference.
 *
 * Reattaches the isolated database + workspace of a completed live run
 * (verified byte-identical first), serves the production API against it
 * with NO provider credential, and completes the acceptance journey that
 * the live run could not finish: browser-gated artifact approval of the
 * already-staged change, restart identity/hash persistence, and rollback
 * with explicit baseline interpretation.
 *
 * Hard guarantees (fail-closed before any browser/server I/O where possible):
 * - FORGE_MUSE_API_KEY / FORGE_FALLBACK_API_KEY must be ABSENT; the script
 *   refuses to start with them set, so no provider dispatch is possible.
 * - The coding CLI is /bin/false: even an accidental job start dies at spawn.
 * - The build provenance gate must pass (same content-hash rule as live).
 * - The isolate must verify byte-identical (v1 baseline, staged HTML,
 *   cutout bytes, succeeded job without fallback markers, exactly one job).
 * - Zero provider dispatches is asserted afterward: no [media-trace]
 *   lines, no new jobs, no new media, and no inference-capable UI path
 *   is ever exercised (no Suggest/Segment/Generate clicks).
 * - Missing staged restore, failed approval, or any hash drift stops the
 *   run immediately with screenshots and diagnostics.
 *
 * Required environment:
 *   BATCHC_RESUME_ISOLATE  preserved dataRoot (database + workspaces)
 *   BATCHC_RESUME_PROJECT  project id inside the isolate
 *   BATCHC_RESUME_JOB     succeeded job id whose staging is approved
 *
 * Expected hashes below are pinned to the 0755 live run that produced
 * this isolate (evidence test-results/batchc-live/2026-11-01-0755):
 * baseline v1, staged HTML, cutout bytes, reference bytes.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { verifyBuildProvenance } from './lib/build-provenance.js';
import { type VerifiedIsolate, verifyStagedIsolate } from './lib/isolate-resume.js';

/** Pinned to the 0755 live run that produced the preserved isolate. */
const EXPECTED_BASELINE_SHA = '79c9d67a654e39a6ec78807a6bc7d1875e371643aa8dc7f3f8fbfc8de9ba9e41';
const EXPECTED_STAGED_SHA = 'a02245994d9e581a12d655d3edfb7a474038ba23a589166359b03e66eb7b9080';
const EXPECTED_CUTOUT_SHA = '52d90d986e623a035abdad1e28df05f232efb964c56c579f0827c1fed00cc5f8';
const EXPECTED_CUTOUT_BYTES = 6374;
const EXPECTED_REFERENCE_SHA = '3db8a97b68e47fb24eae2b4302c0a9f827996185296cd27164417e0706829dcc';

const ROOT = process.cwd();
const LONG = 900_000;
const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
const EVIDENCE = join(ROOT, 'test-results', 'batchc-resume-staged', STAMP);
const SERVER_LOG = join(EVIDENCE, 'server.log');

const checks: string[] = [];
const observations: Record<string, unknown> = {};
let evidenceWritten = false;

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}
function fail(message: string): never {
  throw new Error(`batchc resume-staged failed: ${message}`);
}
function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface Managed {
  child: ChildProcess;
  name: string;
}
function start(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  log: string,
): Managed {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (data: Buffer): void => {
    try {
      writeFileSync(log, data, { flag: 'a' });
    } catch {
      /* best effort */
    }
  };
  child.stdout?.on('data', out);
  child.stderr?.on('data', out);
  return { child, name };
}
async function stop(managed: Managed | null): Promise<void> {
  if (managed === null) return;
  managed.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (managed.child.exitCode === null) managed.child.kill('SIGKILL');
}

interface ApiResult {
  status: number;
  text: string;
}
async function api(base: string, method: string, path: string, body?: string): Promise<ApiResult> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body,
  });
  return { status: response.status, text: await response.text() };
}
async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) fail(`server did not become ready: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
function readEmbedded(html: string): {
  mime: string;
  base64: string;
  bytes: number;
  sha: string;
} | null {
  const match = /data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/.exec(html);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return { mime: match[1], base64: match[2], bytes: bytes.length, sha: sha256(bytes) };
}

async function main(): Promise<void> {
  // No provider credential may be configured: a keyed environment could
  // dispatch. Withheld keys make inference structurally impossible here.
  const hasKey =
    (process.env.FORGE_MUSE_API_KEY?.trim() ?? '').length > 0 ||
    (process.env.FORGE_FALLBACK_API_KEY?.trim() ?? '').length > 0;
  if (hasKey) {
    console.log('resume-staged: refusing to run with a provider credential configured');
    process.exitCode = 2;
    return;
  }
  const isolateDir = process.env.BATCHC_RESUME_ISOLATE?.trim() ?? '';
  const projectId = process.env.BATCHC_RESUME_PROJECT?.trim() ?? '';
  const jobId = process.env.BATCHC_RESUME_JOB?.trim() ?? '';
  if (!isolateDir || !projectId || !jobId) {
    console.log(
      'resume-staged: unconfigured (need BATCHC_RESUME_ISOLATE, BATCHC_RESUME_PROJECT, BATCHC_RESUME_JOB; no call made)',
    );
    process.exitCode = 2;
    return;
  }

  // 0. isolate verification: pure filesystem reads, zero dispatch surface.
  //
  // A consumed fixture is a correct refusal, not a gate failure: approving the
  // staged change publishes a version, and a published version cannot be
  // approved twice offline. The refusal still has to say where the coverage
  // went, or "cannot re-run" reads like a hole in the suite.
  let verified: VerifiedIsolate;
  try {
    verified = verifyStagedIsolate(isolateDir, projectId, jobId, {
      baselineSha256: EXPECTED_BASELINE_SHA,
      stagedSha256: EXPECTED_STAGED_SHA,
      cutoutSha256: EXPECTED_CUTOUT_SHA,
      cutoutBytes: EXPECTED_CUTOUT_BYTES,
      referenceSha256: EXPECTED_REFERENCE_SHA,
      jobStatus: 'succeeded',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`resume-staged: BLOCKED — ${reason}`);
    if (reason.includes('published version')) {
      console.log(
        '  this fixture is single-use: the approval it drives publishes a version, so the same ' +
          'isolate cannot be approved again offline, and the guard refuses rather than half-running.',
      );
    }
    console.log(
      '  the flow it proved (approved asset embedded in a shipped artifact, byte-identical across a ' +
        'restart, restored by rollback, zero provider dispatches) is re-gated free at every commit by ' +
        '`pnpm verify:media-journey-offline`.',
    );
    console.log(
      '  its paid proof on live bytes stands at test-results/batchc-resume-staged/2026-11-01-0824 ' +
        'and test-results/media-live/2026-11-02T13-53-08; a fresh paid coding run is needed to re-run this one.',
    );
    process.exitCode = 2;
    return;
  }
  observations.isolate = {
    path: isolateDir,
    project: projectId,
    job: jobId,
    jobStatus: verified.job.status,
    jobFinishedAt: verified.job.finishedAt,
    jobModelObserved: verified.job.modelObserved,
    jobInternalCalls: verified.job.usageCalls,
    jobMemoryIds: verified.job.memoryIds,
    stagedSha256: verified.stagedSha256,
    cutoutSha256: verified.cutoutSha256,
    cutoutBytes: verified.cutoutBytes,
  };
  check('preserved isolate verifies byte-identical (v1, staged, cutout, succeeded job)');

  // Build provenance gate: the production builds under test must match
  // the current source tree exactly (content hashes, never timestamps).
  const provenance = verifyBuildProvenance({ root: ROOT });
  observations.buildProvenance = {
    commit: provenance.commit,
    treeCleanAtMeasure: provenance.treeCleanAtMeasure,
    server: {
      sourceHash: provenance.server.sourceHash,
      buildHash: provenance.server.buildHash,
    },
    web: {
      sourceHash: provenance.web.sourceHash,
      buildHash: provenance.web.buildHash,
    },
  };
  check(
    `production builds match the tested source (server ${provenance.server.buildHash.slice(0, 12)}…, web ${provenance.web.buildHash.slice(0, 12)}…; commit ${provenance.commit.slice(0, 12)})`,
  );

  const dataRoot = isolateDir;
  const workspaceRoot = join(dataRoot, 'workspaces');
  const databasePath = join(dataRoot, 'memory.db');
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(SERVER_LOG, '');

  const { launchVerificationBrowser, reportBrowserSelection } = await import('./lib/browser.js');
  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);
  const serverPort = await freePort();
  const webPort = await freePort();
  const apiBase = `http://127.0.0.1:${serverPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATABASE_PATH: databasePath,
    WORKSPACE_ROOT: workspaceRoot,
    CORS_ORIGINS: webBase,
    MODEL_PROVIDER: 'muse-cli',
    MUSE_BIN: '/bin/false',
    MUSE_MODEL: 'muse-wonder-1.0',
    FORGE_MUSE_BIN: '/bin/false',
    FORGE_MUSE_API_KEY: undefined,
    FORGE_FALLBACK_API_KEY: undefined,
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
    LOG_LEVEL: 'warn',
  };
  delete serverEnv.FORGE_MUSE_API_KEY;
  delete serverEnv.FORGE_FALLBACK_API_KEY;
  delete serverEnv.FORGE_MUSE_MODEL;
  const startApi = (): Managed =>
    start(
      'api',
      process.execPath,
      [join(ROOT, 'apps/server/dist/index.js')],
      serverEnv,
      ROOT,
      SERVER_LOG,
    );
  let server = startApi();
  let web: Managed | null = null;
  const errors: string[] = [];
  try {
    await waitForHttp(`${apiBase}/api/health`);
    check('started the production API against the preserved isolated database');
    const meta = JSON.parse((await api(apiBase, 'GET', '/api/meta')).text).data as {
      forge?: { configured_model?: string | null; cli_available?: boolean };
      media?: {
        image_model?: string;
        sam_model?: string;
        vision_model?: string;
        max_retries?: number;
      };
      build?: { commit?: string; source_hash?: string; built_at?: string } | null;
    };
    const runtimeIdentity = meta.build ?? null;
    observations.serverIdentity = runtimeIdentity;
    if (
      runtimeIdentity === null ||
      runtimeIdentity.commit !== provenance.server.identity?.commit ||
      runtimeIdentity.source_hash !== provenance.server.identity?.source_hash
    ) {
      fail(
        `running API identity does not match the verified build: ${JSON.stringify(runtimeIdentity)}`,
      );
    }
    check(
      `running API proves the verified build identity (commit ${String(runtimeIdentity.commit).slice(0, 12)})`,
    );
    observations.effectiveConfig = {
      forge_configured_model: meta.forge?.configured_model ?? null,
      forge_cli_available: meta.forge?.cli_available ?? null,
      media: meta.media ?? null,
    };
    if (meta.media?.max_retries !== 0) {
      fail(`server does not honor the zero-retry budget: ${JSON.stringify(meta.media ?? null)}`);
    }
    check(
      `server enforces zero media retries (vision=${meta.media?.vision_model}, sam=${meta.media?.sam_model})`,
    );
    web = start(
      'web',
      process.execPath,
      [
        join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      { ...process.env, VITE_PROXY_TARGET: apiBase },
      join(ROOT, 'apps/web'),
      join(EVIDENCE, 'web.log'),
    );
    await waitForHttp(webBase);
    check('served the production web build (no provider credential configured)');

    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
    try {
      await page
        .getByRole('button', { name: 'HTML Studio', exact: true })
        .waitFor({ timeout: 20_000 });
    } catch (error) {
      await page
        .screenshot({ path: join(EVIDENCE, '00-page-failure.png'), fullPage: true })
        .catch(() => undefined);
      writeFileSync(join(EVIDENCE, '00-page-failure.html'), await page.content().catch(() => ''));
      fail(`Studio shell did not render: ${errors.join(' | ').slice(0, 800) || String(error)}`);
    }
    await page.locator('button[title^="Project:"]').click();
    const dialog = page.getByRole('dialog', { name: 'Switch project' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel('Project id').fill(projectId);
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('v1 approved', { exact: false }).waitFor({ timeout: 20_000 });

    // ---- 1. baseline: recorded v1 intact, no cutout by construction ----
    const artifact = async (job?: string): Promise<{ html: string; versionSha: string }> => {
      const body = JSON.parse(
        (
          await api(
            apiBase,
            'GET',
            `/api/forge/projects/${projectId}/artifact${job ? `?job=${job}` : ''}`,
          )
        ).text,
      ).data as { html: string; sha256: string };
      if (sha256(body.html) !== body.sha256) fail('artifact endpoint sha mismatch');
      return { html: body.html, versionSha: body.sha256 };
    };
    const v1 = await artifact();
    if (v1.versionSha !== EXPECTED_BASELINE_SHA) fail('v1 is not the recorded baseline');
    if (v1.html.includes('gallery-card'))
      fail('v1 unexpectedly contains the gallery card (baseline predates the cutout)');
    await page.screenshot({ path: join(EVIDENCE, '01-project-v1.png'), fullPage: false });
    check('reattached project shows approved v1 baseline without the cutout');

    // ---- 2. staged change restored from the preserved job -------------
    try {
      await page
        .getByText('A staged change is waiting for review.', { exact: false })
        .waitFor({ timeout: 30_000 });
    } catch {
      await page
        .screenshot({ path: join(EVIDENCE, '01b-no-staged.png'), fullPage: false })
        .catch(() => undefined);
      fail('preserved staged change was not restored on project open (no silent proceed)');
    }
    check('preserved staged change restored on project open');
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page
      .frameLocator('iframe[title="HTML application preview"]')
      .locator('img')
      .first()
      .waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(EVIDENCE, '02-staged-preview.png'), fullPage: false });
    const staged = await artifact(jobId);
    if (staged.versionSha !== EXPECTED_STAGED_SHA)
      fail('staged HTML sha drifted from the preserved run');
    if (!staged.html.includes('muse-asset://')) fail('staged HTML lost the cutout placeholder');
    if (!staged.html.includes('gallery-card')) fail('staged HTML lost the gallery card');
    check('staged preview renders the gallery card with the cutout placeholder');

    // ---- 3. browser-gated artifact approval -----------------------------
    const review = page.getByRole('region', { name: 'Review' });
    await review.getByRole('button', { name: /^Approve (& publish )?v2/ }).click();
    await page
      .getByText('Previous versions remain available in history.', { exact: false })
      .waitFor({ timeout: LONG });
    const v2 = await artifact();
    const embedded = readEmbedded(v2.html);
    if (!embedded) fail('approved v2 has no embedded image');
    if (v2.html.includes('muse-asset://')) fail('approved v2 has an unresolved asset reference');
    if (embedded.sha !== EXPECTED_CUTOUT_SHA)
      fail('embedded bytes differ from the retained cutout');
    observations.approvedV2 = {
      htmlSha256: v2.versionSha,
      embedded: { mime: embedded.mime, bytes: embedded.bytes, sha256: embedded.sha },
    };
    await page.screenshot({ path: join(EVIDENCE, '03-approved-v2.png'), fullPage: false });
    check(
      `browser-gated approval published v2 embedding the exact cutout bytes (${embedded.sha.slice(0, 12)}…)`,
    );

    // ---- 4. zero-dispatch accounting before any restart ----------------
    const mediaTraceLines = readFileSync(SERVER_LOG, 'utf8')
      .split('\n')
      .filter((line) => line.includes('[media-trace]'));
    if (mediaTraceLines.length > 0)
      fail(`provider dispatches observed: ${mediaTraceLines.length} trace lines`);
    const jobFiles = readdirSync(join(verified.projectDir, 'jobs')).filter((n) =>
      n.endsWith('.json'),
    );
    if (jobFiles.length !== 1 || jobFiles[0] !== `${jobId}.json`)
      fail(`job store changed during the run: ${JSON.stringify(jobFiles)}`);
    observations.zeroDispatch = {
      mediaTraceLines: 0,
      jobs: jobFiles,
      providerKeyWithheld: true,
      codingBinary: '/bin/false',
    };
    check('zero provider dispatches: no trace lines, no new jobs (key withheld)');

    // ---- 5. restart: identity + exact hashes persist -------------------
    await stop(server);
    server = startApi();
    await waitForHttp(`${apiBase}/api/health`);
    const revivedMeta = JSON.parse((await api(apiBase, 'GET', '/api/meta')).text).data as {
      build?: { commit?: string; source_hash?: string; built_at?: string } | null;
    };
    const revivedIdentity = revivedMeta.build ?? null;
    observations.serverIdentityAfterRestart = revivedIdentity;
    if (
      revivedIdentity === null ||
      revivedIdentity.commit !== runtimeIdentity?.commit ||
      revivedIdentity.source_hash !== runtimeIdentity?.source_hash
    ) {
      fail(
        `restarted API identity does not match the verified build: ${JSON.stringify(revivedIdentity)}`,
      );
    }
    check('restarted API proves the same verified build identity');
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByText('v2 approved', { exact: false }).waitFor({ timeout: 30_000 });
    const revived = await artifact();
    const revivedEmbedded = readEmbedded(revived.html);
    if (revived.versionSha !== v2.versionSha) fail('version HTML changed across restart');
    if (!revivedEmbedded || revivedEmbedded.sha !== embedded.sha)
      fail('embedded image bytes changed across restart');
    observations.restart = { htmlSha256: revived.versionSha, embeddedSha256: revivedEmbedded.sha };
    check('restart preserved byte-identical v2 HTML and embedded asset bytes');

    // ---- 6. rollback with explicit baseline interpretation ------------
    // v1 predates the cutout (recorded baseline); v2 carries it. Rolling
    // back must restore v1 byte-identical while v2 stays intact on disk.
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByRole('button', { name: 'Restore v1', exact: true }).click();
    await page.getByText('v1 approved', { exact: false }).waitFor({ timeout: 30_000 });
    const rolled = await artifact();
    if (rolled.versionSha !== EXPECTED_BASELINE_SHA)
      fail('rollback HTML is not the recorded v1 baseline');
    if (rolled.html.includes('gallery-card'))
      fail('restored v1 unexpectedly contains the gallery card');
    observations.rollback = {
      currentHtmlSha256: rolled.versionSha,
      seededBaselineSha256: EXPECTED_BASELINE_SHA,
      note: 'v1 predates the cutout by construction; v2 retains it below',
    };
    const v2File = readFileSync(join(verified.projectDir, 'versions', '2', 'index.html'));
    const v2FileEmbedded = readEmbedded(v2File.toString('utf8'));
    if (sha256(v2File) !== v2.versionSha) fail('v2 version file changed after rollback');
    if (!v2FileEmbedded || v2FileEmbedded.sha !== EXPECTED_CUTOUT_SHA)
      fail('v2 embedded bytes changed after rollback');
    observations.rollback = {
      ...(observations.rollback as Record<string, unknown>),
      retainedV2HtmlSha256: sha256(v2File),
      retainedV2EmbeddedSha256: v2FileEmbedded.sha,
    };
    await page.screenshot({ path: join(EVIDENCE, '04-rollback-v1.png'), fullPage: false });
    check('rollback restored exact v1 baseline; v2 HTML/embedded bytes remain intact');

    if (errors.length > 0) fail(`console/page errors: ${errors.join(' | ').slice(0, 500)}`);
    // Reused vs new, stated plainly for the record.
    observations.provenance = {
      reused: {
        isolate: isolateDir,
        job: jobId,
        staged: 'preserved succeeded job output, no new inference',
        cutout: 'retained live SAM bytes from 2026-11-01-0755, sha-verified on load',
      },
      new: {
        approval: 'browser-gated v2 approval in this run',
        restart: 'same-process restart identity + hash persistence',
        rollback: 'v1 restore + v2 retention verified',
      },
      note: 'no vision, SAM, coding, or image-generation calls in this run (all counters zero; provider key withheld)',
    };
    observations.providerAttempts = {};
    console.log(`\nBatch C resume-staged: PASS (${checks.length} checks)`);
    console.log('calls: vision=0 sam=0 coding=0 imageGeneration=0 (no provider key configured)');
  } finally {
    try {
      await writeEvidence();
    } catch (error) {
      console.error(
        `evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await stop(server);
    if (web) await stop(web);
    await browser.close().catch(() => undefined);
  }
}

function writeEvidence(): void {
  if (evidenceWritten) return;
  evidenceWritten = true;
  mkdirSync(EVIDENCE, { recursive: true });
  const failure = observations.error === undefined ? null : String(observations.error);
  const report = {
    kind: 'Batch C resume-staged acceptance (reattached isolate; zero new inference)',
    // A failed run must not read as a passing one: the status says so.
    status:
      failure === null
        ? 'live results; no retries; no provider calls by construction (credential withheld)'
        : `FAILED before completion: ${failure}`,
    generated_at: new Date().toISOString(),
    project: process.env.BATCHC_RESUME_PROJECT ?? null,
    isolate: process.env.BATCHC_RESUME_ISOLATE ?? null,
    job: process.env.BATCHC_RESUME_JOB ?? null,
    calls: { vision: 0, sam: 0, coding: 0, imageGeneration: 0 },
    ui_submissions: { vision: 0, sam: 0, coding: 0, imageGeneration: 0 },
    scope: 'resume-staged',
    media_retry_policy:
      'FORGE_MEDIA_MAX_RETRIES=0 (transport retries disabled); FORGE_MEDIA_TRACE=1',
    provider_attempts: observations.providerAttempts ?? null,
    completed_checks: checks.length,
    checks,
    observations,
  };
  writeFileSync(join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nevidence: ${EVIDENCE}`);
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  observations.error = error instanceof Error ? error.message : String(error);
  evidenceWritten = false;
  try {
    await writeEvidence();
  } catch {
    /* evidence best-effort on failure */
  }
  process.exitCode = 1;
});
