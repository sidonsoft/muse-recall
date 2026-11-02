/**
 * Live chain smoke: a real image, inserted into a real application, approved through
 * a real browser, and kept byte-identical across restart and rollback.
 *
 *   shell generate (coding) -> approve v1 -> image Generate (paid) -> approve asset v1
 *   -> image Edit (paid) -> approve asset v2 -> Insert the approved reference
 *   -> modify (coding) that embeds the asset -> preview + diff show the placeholder
 *   -> approve v2 -> restart keeps v2 bytes -> third modify -> v3 -> UI rollback
 *   restores byte-identical v2 with the image still embedded.
 *
 * Two paid rails, two separate accounts (KI-55):
 * - image calls go through the media adapter and leave `[media-trace]` lines, so
 *   their count is measured, not inferred;
 * - coding jobs run inside the real `muse` CLI child process, which the adapter
 *   never sees — their cost is only in each job record's `usage.calls`.
 *
 * Budget: exactly one `/v1/images/generations` and one `/v1/images/edits` dispatch,
 * zero transport retries (`FORGE_MEDIA_MAX_RETRIES=0`), no other media path, and
 * `FORGE_MAX_CALLS` capped per coding job (`MEDIA_LIVE_MAX_CALLS_PER_JOB`, default 15).
 * Every exit path reads both accounts and writes them to
 * `test-results/media-live/<stamp>/report.json`, including failures, because a paid
 * run that fails has still spent the calls.
 *
 * Requires FORGE_MUSE_API_KEY and FORGE_MUSE_BIN (a real CLI) plus a Playwright
 * Chromium build. Not a CI gate. `MEDIA_LIVE_BOOT_ONLY=1` runs every step that costs
 * nothing — boot, build provenance, media config, project open — and makes no call.
 *
 * Usage: FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(which muse) pnpm verify:media-live-smoke
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { mediaMetaIssues } from './lib/batchd-live.js';
import { describeBundleIdentity, verifyBuildProvenance } from './lib/build-provenance.js';
import {
  codingJobIssues,
  MEDIA_LIVE_ALLOWED_PATHS,
  mediaLiveLedgerIssues,
  readCodingJobs,
  totalCodingCalls,
} from './lib/media-live.js';
import {
  accountDispatches,
  ledgerEvidence,
  parseMediaTrace,
  type TracedDispatch,
} from './lib/media-trace.js';
import { startupFailureExcerpt } from './lib/server-startup.js';

/** Raised by boot-only mode so the finally block still writes the report. */
class EarlyExit extends Error {}

const ROOT = process.cwd();
const PROJECT = `media-smoke-${Date.now().toString(36).slice(-6)}`;
const LONG = 600_000;
const MAX_CALLS_PER_JOB = Number(process.env.MEDIA_LIVE_MAX_CALLS_PER_JOB ?? '15');
// Name the coding model explicitly: a run that cannot say which model its coding
// jobs paid for cannot account for them, and `FORGE_MUSE_MODEL` unset means the
// server reports `configured_model: null`.
const CODING_MODEL = process.env.MEDIA_LIVE_CODING_MODEL ?? 'muse-wonder-1.0';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const EVIDENCE_DIR = join(ROOT, 'test-results', 'media-live', STAMP);
const SERVER_LOG = join(EVIDENCE_DIR, 'server.log');
const WEB_LOG = join(EVIDENCE_DIR, 'web.log');
mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(SERVER_LOG, '');
writeFileSync(WEB_LOG, '');

const checks: string[] = [];
const observations: Record<string, unknown> = {};
const calls = {
  imageGeneration: 0,
  imageEdit: 0,
  otherMediaPaths: 0,
  codingJobs: 0,
  codingCallsKnown: 0,
  codingCallsUnknownJobs: 0,
};
const blockedAt: string | null = null;
let configuredCodingModel: string | null = null;
let failureReason: string | null = null;

/** The whole-run media ledger, read fresh so a failure cannot lose paid calls. */
function mediaLedger(): { dispatches: TracedDispatch[]; issues: string[] } {
  const evidence = ledgerEvidence(SERVER_LOG);
  observations.ledger_evidence = evidence;
  if (!evidence.logPresent) {
    return {
      dispatches: [],
      issues: ['no media trace log was readable, so zero-call claims cannot be supported'],
    };
  }
  const ledger = accountDispatches(parseMediaTrace(readFileSync(SERVER_LOG, 'utf8')));
  return { dispatches: ledger.dispatches, issues: mediaLiveLedgerIssues(ledger) };
}

/** Parsed trace entries so far, used to slice the ledger per paid step. */
function parsedTraceCount(): number {
  const evidence = ledgerEvidence(SERVER_LOG);
  if (!evidence.logPresent) return 0;
  return parseMediaTrace(readFileSync(SERVER_LOG, 'utf8')).length;
}

function ledgerSlice(from: number) {
  const evidence = ledgerEvidence(SERVER_LOG);
  return accountDispatches(
    parseMediaTrace(evidence.logPresent ? readFileSync(SERVER_LOG, 'utf8') : '').slice(from),
  );
}

function describeDispatches(ledger: { dispatches: TracedDispatch[] }): unknown[] {
  return ledger.dispatches.map((dispatch) => ({
    path: dispatch.path,
    attempt: dispatch.attempt,
    ...(dispatch.model === undefined ? {} : { model: dispatch.model }),
    ...(dispatch.outcome === undefined ? {} : { outcome: dispatch.outcome }),
    ...(dispatch.status === undefined ? {} : { status: dispatch.status }),
  }));
}

function copyTree(source: string, destination: string): void {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(destination, entry);
    if (lstatSync(from).isDirectory()) copyTree(from, to);
    else copyFileSync(from, to);
  }
}

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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

async function waitForHttp(url: string, timeoutMs = 30_000, logFile?: string): Promise<void> {
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
  // Name the process's own cause line rather than the last characters of its stack
  // (KI-59): "did not become ready" is a symptom, not a reason.
  const cause =
    logFile !== undefined && existsSync(logFile)
      ? startupFailureExcerpt(readFileSync(logFile, 'utf8'))
      : last;
  fail(`timed out waiting for ${url}: ${cause}`);
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) fail(`${url} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface Managed {
  child: ChildProcess;
}

function start(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logFile: string },
): Managed {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer | string): void => {
    try {
      appendFileSync(options.logFile, chunk.toString());
    } catch {
      // A log that cannot be written must not kill the run it is describing.
    }
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('error', (error) => console.error(`${name} spawn error: ${error.message}`));
  return { child };
}

async function stop(item: Managed): Promise<void> {
  const pid = item.child.pid;
  if (item.child.exitCode !== null || pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        item.child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      resolve();
    }, 10_000);
    item.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      item.child.kill('SIGTERM');
    } catch {
      resolve();
    }
  });
}

async function waitInputContains(
  page: Page,
  label: string,
  needle: string,
  timeoutMs = 15_000,
): Promise<string> {
  const field = page.getByLabel(label);
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen = await field.inputValue().catch(() => '');
    if (seen.includes(needle)) return seen;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`field ${label} never contained ${needle}; saw: ${seen.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  const bin = process.env.FORGE_MUSE_BIN?.trim() ?? '';
  const bootOnly = process.env.MEDIA_LIVE_BOOT_ONLY === '1';
  if (key.length === 0 || bin.length === 0) {
    console.log(
      'live chain smoke: unconfigured (need FORGE_MUSE_API_KEY and FORGE_MUSE_BIN; no call made)',
    );
    process.exitCode = 2;
    return;
  }
  if (!existsSync(bin)) {
    console.log(`live chain smoke: unconfigured (FORGE_MUSE_BIN is not a file: ${bin})`);
    process.exitCode = 2;
    return;
  }
  observations.credential = {
    api_key_present: true,
    api_key_length: key.length,
    coding_cli: bin,
    boot_only: bootOnly,
    max_calls_per_coding_job: MAX_CALLS_PER_JOB,
    coding_model_configured: CODING_MODEL,
  };
  const { launchVerificationBrowser, reportBrowserSelection } = await import('./lib/browser.js');
  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  if (!browser) fail('no verification browser available');
  reportBrowserSelection(launched.selection);

  const serverPort = await freePort();
  const webPort = await freePort();
  const dataRoot = mkdtempSync(join(tmpdir(), 'media-live-smoke-'));
  const apiBase = `http://127.0.0.1:${serverPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATABASE_PATH: join(dataRoot, 'memory.db'),
    WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
    CORS_ORIGINS: webBase,
    MODEL_PROVIDER: 'echo',
    LOG_LEVEL: 'warn',
    FORGE_MUSE_BIN: bin,
    FORGE_MUSE_API_KEY: key,
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_RUNTIME_MS: '600000',
    FORGE_RUNTIME_BROWSER: 'managed',
    // Zero transport retries: one dispatch either works or the run stops. Anything
    // else makes the paid-call budget a guess (KI-55).
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
    // The coding CLI burns internal calls per job; cap them so the run cannot
    // silently spend more than this gate was authorized for.
    FORGE_MAX_CALLS: String(MAX_CALLS_PER_JOB),
    FORGE_MUSE_MODEL: CODING_MODEL,
  };
  const startApi = (): Managed =>
    start('api', process.execPath, [join(ROOT, 'apps/server/dist/index.js')], {
      cwd: ROOT,
      env: serverEnv,
      logFile: SERVER_LOG,
    });

  // Prove what the bundles were built from before spending a call or opening a
  // browser: the identity this run stands behind has to be the tested commit's.
  const provenance = verifyBuildProvenance({ root: ROOT });
  const identity = describeBundleIdentity(provenance);
  observations.buildProvenance = provenance;
  observations.bundleIdentity = identity;
  console.log(
    `  bundles: tested ${provenance.commit.slice(0, 7)}; built at ${identity.builtAtCommit.slice(0, 7)} cleanTree=${String(identity.builtFromCleanTree)}; treeNowClean=${String(provenance.treeClean)}; supportsCommitIdentity=${String(identity.supportsCommitIdentity)}`,
  );
  if (!identity.supportsCommitIdentity) {
    console.log(`  note: ${identity.note}`);
  }

  let server = startApi();
  let web: Managed | null = null;
  const errors: string[] = [];
  try {
    await waitForHttp(`${apiBase}/api/health`, 30_000, SERVER_LOG);
    check('started the production API on an isolated database');
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
      {
        cwd: join(ROOT, 'apps/web'),
        env: { ...process.env, VITE_PROXY_TARGET: apiBase },
        logFile: WEB_LOG,
      },
    );
    await waitForHttp(webBase, 30_000, WEB_LOG);
    check('served the production web build');

    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() !== 'error') return;
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().toLowerCase().includes('favicon')) return;
      if (response.status() === 404) return;
      if (response.status() >= 400) {
        errors.push(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 20_000 });
    await page.locator('button[title^="Project:"]').click();
    const dialog = page.getByRole('dialog', { name: 'Switch project' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel('Project id').fill(PROJECT);
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('no approved version', { exact: true }).waitFor({ timeout: 20_000 });
    check(`opened project ${PROJECT} in the Studio`);

    const meta = await json<{ ok: boolean; data: Record<string, unknown> }>(`${apiBase}/api/meta`);
    const metaIssues = mediaMetaIssues(meta.data.media);
    if (metaIssues.length > 0) fail(metaIssues.join(' | '));
    const mediaMeta = meta.data.media as Record<string, string | number>;
    observations.media_config = mediaMeta;
    check(
      `the running server retries nothing and names every paid media model (image ${String(mediaMeta.image_model)}, max_retries 0)`,
    );

    // The coding rail leaves no media-trace line, so it has to be nameable from the
    // server's own configuration; otherwise a coding job cannot be attributed.
    const forgeMeta = meta.data.forge as Record<string, unknown> | undefined;
    observations.coding_config = forgeMeta ?? null;
    if (forgeMeta?.cli_available !== true) {
      fail('the running server reports the generation CLI as unavailable, so coding cannot run');
    }
    if (
      typeof forgeMeta?.configured_model !== 'string' ||
      forgeMeta.configured_model.length === 0
    ) {
      fail(
        '/api/meta does not name a configured coding model, so coding calls cannot be attributed',
      );
    }
    configuredCodingModel = forgeMeta.configured_model;
    if (forgeMeta.configured_model !== CODING_MODEL) {
      fail(
        `the running server was configured for coding model ${CODING_MODEL} but reports ${forgeMeta.configured_model}`,
      );
    }
    check(
      `the running server names its coding CLI model (${configuredCodingModel}) and reports it installed`,
    );

    if (bootOnly) {
      const boot = ledgerEvidence(SERVER_LOG);
      observations.ledger_evidence = boot;
      const bootLedger = accountDispatches(
        parseMediaTrace(boot.logPresent ? readFileSync(SERVER_LOG, 'utf8') : ''),
      );
      if (bootLedger.dispatches.length > 0) {
        fail(`boot-only mode dispatched ${String(bootLedger.dispatches.length)} time(s)`);
      }
      check(
        `boot-only mode booted the chain and made zero provider calls (${String(boot.logBytes)} bytes of server log read, ${String(bootLedger.dispatches.length)} [media-trace] dispatch lines)`,
      );
      throw new EarlyExit('boot-only');
    }
    const media = page.getByRole('region', { name: 'Media assets' });
    // No explicit scroll: every fill/click below scrolls into view on its
    // own, and an early scroll races the project-open re-renders.
    await media.getByLabel('Image prompt').waitFor({ timeout: 20_000 });

    // The change draft only exists once a version is approved, so the shell
    // application is generated first with the real coding model.
    await fillStable(
      page,
      'Application description',
      'A small accessible task list with add, delete and a task count.',
    );
    await page.getByRole('button', { name: 'Generate HTML' }).click();
    await page.getByText(/Studio generation staged an HTML version/).waitFor({ timeout: LONG });
    check('real-model generate staged the application shell');
    const review = page.getByRole('region', { name: 'Review' });
    await review.getByRole('button', { name: /^Approve v1/ }).click();
    await page.getByText('First version approved.').waitFor({ timeout: LONG });
    check('shell approved as v1 through the real browser gate');

    const beforeGenerate = parsedTraceCount();
    await stepMediaGenerate(page, media);
    const generateLedger = ledgerSlice(beforeGenerate);
    calls.imageGeneration = generateLedger.dispatches.length;
    observations.generate_dispatches = describeDispatches(generateLedger);
    if (generateLedger.dispatches.length !== 1) {
      fail(
        `the image Generate step dispatched ${String(generateLedger.dispatches.length)} time(s); exactly one was budgeted`,
      );
    }
    await media.getByTitle('Approve this version').click();
    await media.getByText('Approved: v1').waitFor({ timeout: 30_000 });
    check('live-generated image approved as v1');
    await media.getByTitle('Edit this version into a new candidate').click();
    await fillStable(page, 'Image edit prompt', 'change the background to pale yellow');
    const beforeEdit = parsedTraceCount();
    await media.getByRole('button', { name: 'Edit', exact: true }).click();
    await media.getByTitle('Approve this version').waitFor({ timeout: LONG });
    const editLedger = ledgerSlice(beforeEdit);
    calls.imageEdit = editLedger.dispatches.length;
    observations.edit_dispatches = describeDispatches(editLedger);
    if (editLedger.dispatches.length !== 1) {
      fail(
        `the image Edit step dispatched ${String(editLedger.dispatches.length)} time(s); exactly one was budgeted`,
      );
    }
    await media.getByTitle('Approve this version').click();
    await media.getByText('Approved: v1, v2').waitFor({ timeout: 30_000 });
    check('live edit produced and approved v2');

    await media.getByTitle('Insert this reference into the instruction').last().click();
    const draft = await waitInputContains(page, 'Change request', 'muse-asset://');
    const placeholder = /muse-asset:\/\/[^\s"'<>`]+/.exec(draft)?.[0] ?? '';
    if (!placeholder) fail('no well-formed placeholder in the change draft');
    check('Insert placed the approved reference into the change draft');
    await fillStable(
      page,
      'Change request',
      `${placeholder}\nRebuild the page as a small gallery that shows this exact image with an <img> tag using the placeholder above verbatim as its src, plus a short caption.`,
    );
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText('Change staged.').waitFor({ timeout: LONG });
    check('real-model modify staged an application using the asset');

    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByText('staged — not approved').waitFor({ timeout: 20_000 });
    const frame = page.frameLocator('iframe[title="HTML application preview"]');
    await frame.locator('img').first().waitFor({ timeout: 30_000 });
    check('staged preview renders the image');
    await page.getByRole('tab', { name: 'Changes' }).click();
    await page
      .locator('#studio-panel-diff')
      .getByText(/muse-asset:\/\//)
      .first()
      .waitFor({
        timeout: 10_000,
      });
    check('staged diff shows the asset placeholder the model used');

    await review.getByRole('button', { name: /^Approve (& publish )?v2/ }).click();
    await page
      .getByText('Previous versions remain available in history.')
      .waitFor({ timeout: LONG });
    check('approved v2 through the real browser gate with the image embedded');
    const v2 = await artifactEnvelope(apiBase);
    if (!v2.html.includes('data:image/')) fail('v2 has no embedded image');
    if (v2.html.includes('muse-asset://')) fail('v2 has an unresolved reference');
    console.log(`  v2 version-HTML sha256 ${v2.versionSha}`);

    await stop(server);
    server = startApi();
    await waitForHttp(`${apiBase}/api/health`, 30_000, SERVER_LOG);
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByText('v2 approved').waitFor({ timeout: 20_000 });
    const revived = await artifactEnvelope(apiBase);
    if (revived.versionSha !== v2.versionSha) fail('version HTML changed across restart');
    check('restart kept byte-identical v2');

    await fillStable(page, 'Change request', 'Add an HTML comment at the top of the body.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText('Change staged.').waitFor({ timeout: LONG });
    await review.getByRole('button', { name: /^Approve (& publish )?v3/ }).click();
    await page
      .getByText('Previous versions remain available in history.')
      .waitFor({ timeout: LONG });
    const v3 = await artifactEnvelope(apiBase);
    if (v3.versionSha === v2.versionSha) fail('v3 is identical to v2');
    check('third real-model change approved as v3');

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByRole('button', { name: 'Restore v2' }).click();
    await page.getByText('v2 approved').waitFor({ timeout: 20_000 });
    const rolled = await artifactEnvelope(apiBase);
    if (rolled.versionSha !== v2.versionSha) fail('rollback did not restore v2 bytes');
    if (!rolled.html.includes('data:image/')) fail('rollback lost the embedded image');
    check('UI rollback restored byte-identical v2 with the embedded image');

    if (errors.length > 0) fail(`console/page errors: ${errors.join(' | ').slice(0, 500)}`);

    // Account for both rails. The media ledger is the whole-run one, so a paid call
    // made before an earlier failure still appears (KI-55).
    const wholeRun = mediaLedger();
    calls.otherMediaPaths = wholeRun.dispatches.filter(
      (dispatch) => !MEDIA_LIVE_ALLOWED_PATHS.includes(dispatch.path),
    ).length;
    observations.dispatch_ledger = describeDispatches(wholeRun);
    observations.ledger_issues = wholeRun.issues;
    if (wholeRun.issues.length > 0) fail(`media call budget: ${wholeRun.issues.join(' | ')}`);
    check(
      `the media ledger shows exactly ${String(calls.imageGeneration)} generation(s) and ${String(calls.imageEdit)} edit(s), on no other path, with no retry`,
    );

    const jobs = readCodingJobs(join(dataRoot, 'workspaces', 'forge', PROJECT));
    const jobIssues = codingJobIssues(jobs, {
      expectedKinds: ['generate', 'modify', 'modify'],
      maxCallsPerJob: MAX_CALLS_PER_JOB,
      configuredModel: configuredCodingModel,
    });
    const totals = totalCodingCalls(jobs);
    calls.codingJobs = jobs.length;
    calls.codingCallsKnown = totals.known;
    calls.codingCallsUnknownJobs = totals.unknownJobs;
    observations.coding_jobs = jobs;
    observations.coding_call_cap = MAX_CALLS_PER_JOB;
    if (jobIssues.length > 0) fail(`coding account: ${jobIssues.join(' | ')}`);
    check(
      `three coding jobs recorded, all succeeded, ${String(totals.known)} internal call(s) in total (cap ${String(MAX_CALLS_PER_JOB)} per job)`,
    );

    const logBody = readFileSync(SERVER_LOG, 'utf8');
    if (logBody.includes(key)) fail('the API token appears in the server log contents');
    check(
      `the API token does not appear in the ${String(logBody.length)} bytes of server log this run wrote`,
    );

    console.log(`\nlive chain smoke: ok (${String(checks.length)} checks)`);
    console.log(`v2 version-HTML sha256: ${v2.versionSha}`);
  } finally {
    await stop(server);
    if (web) await stop(web);
    await browser.close().catch(() => undefined);
    writeReport(dataRoot);
  }
}

/** Every exit path lands here, including boot-only and mid-run failures. */
function writeReport(dataRoot: string): void {
  const ledger = mediaLedger();
  observations.dispatch_ledger ??= describeDispatches(ledger);
  observations.ledger_issues ??= ledger.issues;
  const ok = failureReason === null && blockedAt === null;
  const summary = {
    ok,
    gate: 'media-live-smoke',
    stamp: STAMP,
    commit: readHeadCommit(),
    status: ok ? 'PASS' : (blockedAt ?? `FAILED before completion: ${failureReason ?? 'unknown'}`),
    project: PROJECT,
    checks,
    failed: failureReason === null ? [] : [failureReason],
    blocked_at: blockedAt,
    calls,
    budget: {
      media_allowed_paths: MEDIA_LIVE_ALLOWED_PATHS,
      image_generation: 1,
      image_edit: 1,
      coding_jobs: 3,
      coding_calls_per_job: MAX_CALLS_PER_JOB,
      transport_retries: 0,
    },
    observations,
    evidence_dir: EVIDENCE_DIR,
  };
  writeFileSync(join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (!ok && failureReason !== null) {
    writeFileSync(
      join(EVIDENCE_DIR, 'FAILED.md'),
      `# live chain smoke failed before completion\n\n${failureReason}\n\n` +
        `checks completed: ${String(checks.length)}\ncalls recorded so far: ${JSON.stringify(calls)}\n`,
    );
  }
  // A paid run has spent its calls even when the harness then fails: keep the
  // isolate so the evidence shows what the providers actually produced.
  copyTree(dataRoot, join(EVIDENCE_DIR, 'isolate'));
  if (!ok && failureReason !== null) {
    process.stdout.write(`FAILED before completion: ${failureReason}\n`);
  }
  process.stdout.write(`evidence: ${EVIDENCE_DIR}\n`);
}

function readHeadCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Fill a controlled field and confirm React kept the value: a fill that
 * lands mid-rerender can detach without sticking, leaving the submit
 * button disabled.
 */
async function fillStable(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await field.fill(value).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if ((await field.inputValue().catch(() => '')) === value) return;
  }
  fail(`field ${label} never held its value`);
}

async function stepMediaGenerate(page: Page, media: ReturnType<Page['getByRole']>): Promise<void> {
  await fillStable(page, 'Image prompt', 'a single small blue circle on plain white');
  await media.getByRole('button', { name: 'Generate', exact: true }).click();
  await media.getByTitle('Approve this version').waitFor({ timeout: LONG });
  check('live image generation produced an approvable candidate');
}

async function artifactEnvelope(
  apiBase: string,
): Promise<{ html: string; versionSha: string; version: unknown }> {
  const body = await json<{
    ok: boolean;
    data: { html: string; sha256: string; version: unknown };
  }>(`${apiBase}/api/forge/projects/${PROJECT}/artifact`);
  if (sha256Hex(body.data.html) !== body.data.sha256) fail('artifact sha mismatch');
  return { html: body.data.html, versionSha: body.data.sha256, version: body.data.version };
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof EarlyExit) {
      process.exitCode = 0;
      return;
    }
    failureReason = error instanceof Error ? error.message : String(error);
    console.error(`live smoke failed: ${failureReason}`);
    process.exitCode = 1;
  });
