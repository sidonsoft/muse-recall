/**
 * `verify:beta-journey` — the beta user journey, end to end, through the real product.
 *
 * This is not another unit test and not another artifact probe. It boots the **production** bundles
 * (the server bundle the release would ship, and `vite preview` over the built web assets) and drives
 * the real Studio UI with a real browser, in the order a beta user would: open a project, describe an
 * application, read the change, approve it, look at it, take it away, come back tomorrow, change it,
 * go back to the earlier version.
 *
 * It spends nothing. The coding CLI is a scripted fixture, so **no provider call of any kind is made**,
 * and the gate refuses to start at all if a provider credential is exported. That has a consequence the
 * report states in its own words: this gate measures the product's plumbing around a generation, not
 * the quality of what a model would generate. Application quality is a human judgement, and this gate
 * ends by saying so.
 *
 * Why some checks exist at all:
 *
 * - **Copy and Download hand over bytes, and a handover can go stale.** The human review of Palette
 *   Bench found a generated application whose Copy control handed over colours it was no longer
 *   displaying (KI-88). The product has the same class of control — Copy source, Download HTML — so the
 *   journey compares what those controls produce, byte for byte, with what the artifact endpoint serves
 *   for the version the UI calls current. Reading the code was not enough; the comparison is measured.
 * - **The release's identity claims need a measurement attached to them.** The bundle hashes, the commit
 *   they were built at, and whether the tree was clean at that build are recorded here, in this gate's
 *   own report, next to the journey that ran against those exact bundles.
 * - **"No provider call" must be evidenced, not asserted.** The server's `[media-trace]` log is read,
 *   checked for damage, and required to be empty.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Locator } from 'playwright-core';
import {
  BrowserUnavailableError,
  launchVerificationBrowser,
  reportBrowserSelection,
} from './lib/browser.js';
import { describeBundleIdentity, verifyBuildProvenance } from './lib/build-provenance.js';
import { evidenceStamp, uniqueEvidenceDir } from './lib/evidence-dir.js';
import { checkCountIssues, duplicateCheckNames } from './lib/gate-check-count.js';
import { PrerequisiteRefusal } from './lib/gate-outcome.js';
import { ledgerEvidence, parseMediaTrace } from './lib/media-trace.js';

const ROOT = process.cwd();
const API_PORT = 8790;
const WEB_PORT = 6175;
const PROJECT = 'beta-journey';
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const LONG = 90_000;

/** The release-critical claims. If one of these names disappears, the count alone must not pass. */
const REQUIRED_CHECK_NAMES = [
  'the prompt form disables an empty prompt and starts no job, and the API names the reason out loud',
  'an empty change request is refused by the form and by the API, and stages nothing new',
  'Copy source hands over exactly the bytes the artifact endpoint serves',
  'Download HTML hands over the bytes of the version the UI calls current',
  'rolling back from the version history changes the bytes the browser is served',
  'at 390px the document fits the viewport and the journey controls are usable',
  'at 390px switching panels changes what is displayed, and the published application is reachable',
  'no provider media dispatch and the scripted CLI answered every coding request',
] as const;

class Refusal extends PrerequisiteRefusal {}

const checks: string[] = [];
function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

const observations: Record<string, unknown> = {};

const managed: Managed[] = [];
interface Managed {
  name: string;
  child: ChildProcess;
  lines: string[];
}

function start(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Managed {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry: Managed = { name, child, lines: [] };
  managed.push(entry);
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim()) entry.lines.push(line);
    });
  }
  return entry;
}

async function stopAll(): Promise<void> {
  for (const entry of managed) {
    try {
      process.kill(-((entry.child.pid as number) ?? 0), 'SIGTERM');
    } catch {
      entry.child.kill('SIGTERM');
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 401) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} never answered (${last})`);
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Refusal(
          `port ${port} is already in use; this gate needs it free and will not kill the listener`,
        ),
      ),
    );
    probe.listen({ port, host: '127.0.0.1' }, () => {
      probe.close(() => resolve());
    });
  });
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * The Forge routes answer `{ ok: true, data }`. Reading the envelope directly produced `undefined`
 * fields that looked like missing data rather than a wrong read, so the unwrap is explicit.
 */
async function data<T>(url: string, init?: RequestInit): Promise<T> {
  const body = (await json(url, init)) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (body.ok !== true || body.data === undefined) {
    throw new Error(
      `${url} did not answer with data (${body.error?.message ?? 'no error message'})`,
    );
  }
  return body.data;
}

/** Refusals come back as `{ error: { code, message } }` or `{ error: "..." }`; read both without guessing. */
function reasonOf(body: unknown): string {
  const record = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const inner = record.error as { code?: string; message?: string; details?: unknown };
    const headline = [inner.code, inner.message]
      .filter((part) => typeof part === 'string' && part !== '')
      .join(': ');
    // "The request did not match the expected schema" is not actionable by itself. The `details` array
    // is what tells a client which field broke which rule, so the recorded reason carries it.
    const details = Array.isArray(inner.details)
      ? inner.details
          .map((detail) => {
            const item = (detail ?? {}) as { path?: unknown; message?: string };
            // This API has answered with `path: "prompt"` and zod answers with `path: ["prompt"]`.
            // Reading only the array form turned a named field into "(root)" and hid the fault.
            const path =
              typeof item.path === 'string' && item.path !== ''
                ? item.path
                : Array.isArray(item.path) && item.path.length > 0
                  ? item.path.join('.')
                  : '(root)';
            return `${path}: ${item.message ?? 'no message'}`;
          })
          .join('; ')
      : '';
    return details === '' ? headline : `${headline} — ${details}`;
  }
  return typeof record.message === 'string' ? record.message : '';
}

const jobCount = async (): Promise<number> =>
  (await data<{ items: unknown[] }>(`${API_BASE}/api/forge/projects/${PROJECT}/generations`)).items
    .length;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function text(locator: Locator): Promise<string> {
  return (await locator.textContent()) ?? '';
}

async function main(): Promise<number> {
  // Refuse before touching anything if a credential is present: this journey must spend nothing, and a
  // run that could spend is not the run the release packet describes.
  const keys = [
    'FORGE_MUSE_API_KEY',
    'FORGE_FALLBACK_API_KEY',
    'META_API_KEY',
    'BASETEN_API_KEY',
  ].filter((name) => (process.env[name] ?? '').trim() !== '');
  if (keys.length > 0) {
    throw new Refusal(
      `refusing to run the beta journey while provider credentials are exported (${keys.join(', ')}); this gate must make no provider call`,
    );
  }
  observations.provider_credentials_exported = 0;

  for (const port of [API_PORT, WEB_PORT]) await assertPortFree(port);

  const serverDist = join(ROOT, 'apps/server/dist/index.js');
  const webDist = join(ROOT, 'apps/web/dist/index.html');
  if (!existsSync(serverDist) || !existsSync(webDist)) {
    throw new Refusal(
      'production bundles are missing; run `pnpm exec tsx scripts/build-production-bundles.ts` before this gate',
    );
  }
  // A stale or missing bundle is a prerequisite, not a measurement: the journey must run against the
  // bytes the release would ship, and saying "rebuild" is more actionable than reporting a failure.
  let provenance: ReturnType<typeof verifyBuildProvenance>;
  try {
    provenance = verifyBuildProvenance({ root: ROOT });
  } catch (error) {
    throw new Refusal(
      `${error instanceof Error ? error.message : String(error)}; then run \`pnpm exec tsx scripts/build-production-bundles.ts\` (or \`pnpm run verify:release-gate\`, which builds and checks them) and re-run this gate`,
    );
  }
  const identity = describeBundleIdentity(provenance);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  observations.build_provenance = {
    commit: provenance.commit,
    head_ref: head,
    treeCleanAtMeasure: provenance.treeCleanAtMeasure,
    serverBuildHash: provenance.server.buildHash,
    webBuildHash: provenance.web.buildHash,
    bundlesBuiltAtHead: identity.builtAtHead,
    bundlesBuiltAtCommit: identity.builtAtCommit,
    bundlesBuiltFromCleanTree: identity.builtFromCleanTree,
    supportsCommitIdentity: identity.supportsCommitIdentity,
    identity_note: identity.note,
  };

  const stamp = evidenceStamp();
  const evidence = uniqueEvidenceDir(join(ROOT, 'test-results', 'beta-journey'), stamp);
  const out = evidence.path;
  mkdirSync(out, { recursive: true });

  const dataRoot = await mkdtemp(join(tmpdir(), 'beta-journey-'));
  // The scripted CLI reads this file at job time, so rewriting it between jobs produces different
  // artifact bytes with still no provider anywhere. It is a scripted answer, and the report says so.
  const scriptedApp = join(dataRoot, 'scripted-app.html');
  const writeScriptedApp = (marker: string) =>
    writeFile(
      scriptedApp,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scripted ${marker}</title></head>` +
        `<body><main><h1>Scripted application ${marker}</h1><p>Marker ${marker}. ` +
        `<button type="button" onclick="this.textContent='used ${marker}'">Use me</button></p></main></body></html>\n`,
      'utf8',
    );
  await writeScriptedApp('one');

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    DATABASE_PATH: join(dataRoot, 'memory.db'),
    WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
    CORS_ORIGINS: WEB_BASE,
    MODEL_PROVIDER: 'echo',
    LOG_LEVEL: 'warn',
    FORGE_MUSE_BIN: join(ROOT, 'tests/fixtures/fake-muse.mjs'),
    FORGE_MUSE_MODEL: 'scripted-muse',
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_RUNTIME_MS: '60000',
    FAKE_MUSE_MODE: 'app',
    FAKE_MUSE_APP: scriptedApp,
    FORGE_RUNTIME_BROWSER: 'managed',
  };
  // Belt and braces: the environment the server actually runs with has no provider credential.
  for (const name of [
    'FORGE_MUSE_API_KEY',
    'FORGE_FALLBACK_API_KEY',
    'META_API_KEY',
    'BASETEN_API_KEY',
  ]) {
    delete serverEnv[name];
  }

  let browser: Browser | null = null;
  let failures: string[] = [];
  const remoteRequests: string[] = [];

  try {
    const launched = await launchVerificationBrowser();
    browser = launched.browser;
    reportBrowserSelection(launched.selection);
    check(
      `browser available: ${launched.selection.selected ?? launched.selection.attempted} (${launched.selection.policy})`,
    );

    const server = start('api', process.execPath, [serverDist], ROOT, serverEnv);
    await waitForHttp(`${API_BASE}/api/health`);
    start(
      'web',
      process.execPath,
      [
        join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(WEB_PORT),
        '--strictPort',
      ],
      join(ROOT, 'apps/web'),
      {
        ...process.env,
        VITE_PROXY_TARGET: API_BASE,
      },
    );
    await waitForHttp(WEB_BASE);
    void server;
    check(
      `the production API and the production web build boot with no provider credential in their environment (bundles built at ${String(provenance.commit).slice(0, 7)}, identity claim supported: ${identity.supportsCommitIdentity})`,
    );

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_BASE });
    // Every request the page makes to a non-loopback origin is recorded, so "no remote origin" is a
    // measurement rather than an assumption.
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) remoteRequests.push(url.origin);
    });
    const page = await context.newPage();

    // --- open a project, as a first-time user would ---------------------------------------------
    await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: 'HTML Studio', exact: true })
      .first()
      .waitFor({ timeout: 20_000 });
    if (
      (await page
        .getByRole('button', { name: 'HTML Studio', exact: true })
        .getAttribute('aria-current')) !== 'page'
    ) {
      throw new Error('the Studio is not the surface a first-time visitor lands on');
    }
    await data(`${API_BASE}/api/forge/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: PROJECT, name: 'Beta Journey Project' }),
    });
    await page.locator('button[title^="Project:"]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Switch project' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel('Project id').fill(PROJECT);
    await dialog.getByRole('button', { name: 'Open', exact: true }).press('Enter');
    await page
      .getByRole('heading', { name: 'Beta Journey Project', level: 1 })
      .waitFor({ timeout: 20_000 });
    check('a visitor opens a project by id and the Studio names the project they are in');

    // --- an empty prompt must be refused, and must start nothing --------------------------------
    // The form disables the control, which is a refusal with no reason in words. So the reason is
    // measured where it is actually stated: the API's own rejection of the same submission. The label
    // says which half was measured where, instead of claiming the UI explained it.
    const jobCountBefore = await jobCount();
    await page.getByLabel('Application description').fill('');
    const generateButton = page.getByRole('button', { name: 'Generate HTML' });
    const disabledBefore = await generateButton.isDisabled();
    if (!disabledBefore) {
      await generateButton.click();
      await page.waitForTimeout(1_500);
    }
    const emptyRejection = await fetch(`${API_BASE}/api/forge/projects/${PROJECT}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '', decisions: [] }),
    });
    if (emptyRejection.ok) throw new Error('the API accepted an empty prompt');
    const emptyBody = (await emptyRejection.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    observations.empty_prompt_api_status = emptyRejection.status;
    const emptyReason = reasonOf(emptyBody);
    observations.empty_prompt_api_reason = emptyReason.slice(0, 300);
    if (!/\bprompt\b/.test(emptyReason)) {
      throw new Error(`the empty-prompt refusal never names the field at fault: ${emptyReason}`);
    }
    if (emptyReason === '') {
      throw new Error(
        'the empty-prompt refusal gave no reason, so the user is left with a dead button',
      );
    }
    const jobCountAfterEmpty = await jobCount();
    if (jobCountAfterEmpty !== jobCountBefore) {
      throw new Error(`an empty prompt started ${jobCountAfterEmpty - jobCountBefore} job(s)`);
    }
    observations.empty_prompt_button_disabled = disabledBefore;
    check(
      'the prompt form disables an empty prompt and starts no job, and the API names the reason out loud',
    );

    // --- generate, read, approve -----------------------------------------------------------------
    await page
      .getByLabel('Application description')
      .fill('A small page with one obvious action and a line of text that says what happened.');
    await page.getByRole('button', { name: 'Generate HTML' }).click();
    await page.getByText(/staged an HTML version/).waitFor({ timeout: LONG });
    await page
      .getByText('reported model scripted-muse')
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 });
    check(
      'a coding job runs through the real form and the Studio reports the model identity the CLI reported',
    );

    await page.getByRole('tab', { name: 'Changes' }).click();
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await review.waitFor({ timeout: 20_000 });
    // The disclosure is a component with a test hook, not a sentence to guess at: it must be present
    // *before* anyone can approve, and it must describe these bytes rather than the model's claims.
    const disclosure = review.locator('[data-testid="dependency-disclosure"]').first();
    await disclosure.waitFor({ timeout: 20_000 });
    const disclosureText = (await text(disclosure)).replace(/\s+/g, ' ').trim();
    if (!/dependency|dependencies|no remote|bundled|fetch/i.test(disclosureText)) {
      throw new Error(
        `the approval rail's dependency block says nothing about dependencies (got "${disclosureText.slice(0, 160)}")`,
      );
    }
    observations.dependency_disclosure_excerpt = disclosureText.slice(0, 300);
    observations.dependency_rows_before_approval = await disclosure
      .locator('[data-dependency-kind]')
      .count();
    check('the approval rail discloses what these bytes fetch before anyone can approve them');

    await review.getByRole('button', { name: 'Approve v1', exact: true }).click();
    await page
      .getByText(/First version approved\.|v1 approved/)
      .first()
      .waitFor({ timeout: LONG });
    const versionList = page.locator('section[aria-label="Review"]');
    await versionList.getByText(/v1/).first().waitFor({ timeout: 20_000 });
    check('approving publishes version 1 and the version history names it');

    // --- look at it: preview must ask nothing remote ---------------------------------------------
    await page.getByRole('tab', { name: 'Preview' }).click();
    const previewFrame = page
      .frameLocator('iframe[title*="preview" i], iframe[title*="Preview" i]')
      .first();
    await previewFrame.locator('h1').first().waitFor({ timeout: 20_000 });
    const previewText = await text(previewFrame.locator('h1').first());
    if (!/Scripted application one/.test(previewText)) {
      throw new Error(`the preview shows "${previewText}", not the published bytes`);
    }
    check('the preview loads the published bytes and shows the application the approver approved');

    // --- take it away: both handovers must match the served bytes ---------------------------------
    const served = await data<{ html: string; sha256: string; version: number | null }>(
      `${API_BASE}/api/forge/projects/${PROJECT}/artifact`,
    );
    const servedSha = sha256(served.html);
    if (served.sha256 !== servedSha) {
      throw new Error(
        `the endpoint's own recorded hash ${served.sha256.slice(0, 12)} does not match the bytes it served (${servedSha.slice(0, 12)})`,
      );
    }
    observations.served_artifact_sha256 = servedSha;
    observations.served_artifact_version = served.version;

    await page.getByRole('tab', { name: 'Source' }).click();
    const sourcePanel = page.locator('#studio-panel-source');
    await sourcePanel.getByRole('button', { name: /Copy source/ }).click();
    await page
      .getByText(/Copied/)
      .first()
      .waitFor({ timeout: 10_000 });
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    if (sha256(clipboard) !== servedSha) {
      throw new Error(
        `the Copy control handed over ${clipboard.length} characters whose sha256 is ${sha256(clipboard).slice(0, 12)}, while the artifact endpoint serves sha256 ${servedSha.slice(0, 12)} (KI-88's class of defect, in the product)`,
      );
    }
    check('Copy source hands over exactly the bytes the artifact endpoint serves');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: /Download HTML/ }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('the download produced no file to read');
    const downloaded = await readFile(downloadPath);
    if (sha256(downloaded) !== servedSha) {
      throw new Error(
        `the download handed over ${downloaded.byteLength} bytes whose sha256 is ${sha256(downloaded).slice(0, 12)}, not the ${servedSha.slice(0, 12)} the endpoint serves for the current version`,
      );
    }
    observations.downloaded_bytes = downloaded.byteLength;
    check('Download HTML hands over the bytes of the version the UI calls current');

    // --- come back: reload keeps the project reachable -------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Beta Journey Project', level: 1 })
      .waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 20_000 });
    observations.reload_restored_project_view = true;
    check('a reload keeps the project and its published version reachable');

    // --- an empty change request must be refused too, in both places -----------------------------
    const jobsBeforeEmptyChange = await jobCount();
    await page.getByRole('tab', { name: 'Change this app' }).click();
    const changeField = page.getByLabel('Change request');
    await changeField.fill('');
    const changeButton = page.getByRole('button', { name: 'Generate change' });
    const changeDisabled = await changeButton.isDisabled();
    if (!changeDisabled) {
      await changeButton.click();
      await page.waitForTimeout(1_500);
    }
    // The modify route names its field `request`, which is what the web client sends; probing a field
    // name the UI never uses would measure a contract no user can violate.
    const changeRejection = await fetch(`${API_BASE}/api/forge/projects/${PROJECT}/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: '', decisions: [] }),
    });
    if (changeRejection.ok) throw new Error('the API accepted an empty change request');
    const changeBody = await changeRejection.json().catch(() => ({}));
    observations.empty_change_api_status = changeRejection.status;
    const changeReason = reasonOf(changeBody);
    observations.empty_change_api_reason = changeReason.slice(0, 300);
    if (!/\brequest\b/.test(changeReason)) {
      throw new Error(
        `the empty change-request refusal never names the field at fault: ${changeReason}`,
      );
    }
    if (changeReason === '') {
      throw new Error('the empty change-request refusal gave no reason');
    }
    const jobsAfterEmptyChange = await jobCount();
    if (jobsAfterEmptyChange !== jobsBeforeEmptyChange) {
      throw new Error(
        `an empty change request started ${jobsAfterEmptyChange - jobsBeforeEmptyChange} job(s)`,
      );
    }
    check('an empty change request is refused by the form and by the API, and stages nothing new');

    // --- change it, then go back -----------------------------------------------------------------
    await writeScriptedApp('two');
    await changeField.fill('Change the heading text and keep one obvious action.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    // A change request is signed by the review rail offering the next version, not by a toast: the
    // approval control names the version it would publish, which is the claim a user can act on.
    const reviewAfterChange = page.getByRole('region', { name: 'Review', exact: true });
    await reviewAfterChange
      .getByRole('button', { name: /^Approve (& publish )?v2/ })
      .waitFor({ timeout: LONG });
    await page.getByRole('tab', { name: 'Changes' }).click();
    await reviewAfterChange.getByRole('button', { name: /^Approve (& publish )?v2/ }).click();
    await page
      .getByText(/v2 approved|Approved v2\./)
      .first()
      .waitFor({ timeout: LONG });
    const servedAfterSecond = await data<{ html: string; version: number | null }>(
      `${API_BASE}/api/forge/projects/${PROJECT}/artifact`,
    );
    if (servedAfterSecond.version !== 2) {
      throw new Error(
        `the endpoint calls version ${String(servedAfterSecond.version)} current after the second approval, expected 2`,
      );
    }
    if (sha256(servedAfterSecond.html) === servedSha)
      throw new Error('the second approval did not change the served bytes');
    check(
      'a second coding job stages a new version, approval makes it current, and the served bytes change',
    );

    const history = page.locator('section[aria-label="Review"]');
    await history.getByRole('button', { name: /Undo last change/ }).click();
    // The confirmation is two lines: the question and the warning. Reading only the first produced a
    // check that "passed" on a dialog that never mentioned irreversibility, so the block is read whole.
    const confirmLine = (
      await text(
        history
          .locator('div')
          .filter({ has: page.getByText(/as the current version\?/) })
          // Preorder puts every ancestor before the block that asks the question, so `last()` is that
          // block; `first()` recorded the whole Review panel as "confirmation wording".
          .last(),
      )
    ).replace(/\s+/g, ' ');
    if (!/cannot be undone/i.test(confirmLine)) {
      throw new Error(
        `the rollback confirmation does not say the restore itself cannot be undone (got "${confirmLine}")`,
      );
    }
    await history.getByRole('button', { name: /^Restore v1/ }).click();
    await page
      .getByText(/Rolled back|Restored/i)
      .first()
      .waitFor({ timeout: LONG });
    const servedAfterRollback = await data<{ html: string; version: number | null }>(
      `${API_BASE}/api/forge/projects/${PROJECT}/artifact`,
    );
    if (servedAfterRollback.version !== 1) {
      throw new Error(
        `after the rollback the endpoint calls version ${String(servedAfterRollback.version)} current, expected 1`,
      );
    }
    if (sha256(servedAfterRollback.html) !== servedSha) {
      throw new Error(
        `after the rollback the endpoint serves sha256 ${sha256(servedAfterRollback.html).slice(0, 12)}, expected the v1 bytes ${servedSha.slice(0, 12)}`,
      );
    }
    observations.rollback_confirmation_wording = confirmLine.trim().slice(0, 220);
    check('rolling back from the version history changes the bytes the browser is served');
    check(
      'the rollback confirmation names the version it restores and says the restore itself cannot be undone',
    );

    // --- the phone: the journey has to be completable there ---------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    // The controls measured are the ones the current stage of the journey actually offers: the prompt
    // panel is in "change" mode after the change request, so the new-app button only appears once the
    // mode tab is opened. Asking for a control the stage does not offer would fail the measurement
    // rather than report it.
    await page.getByRole('tab', { name: 'New app' }).click();
    // The primary action's words change once a version exists ("Generate HTML" becomes "Stage new
    // version"), so the measurement finds controls by their role in the panel and records the words it
    // found, rather than matching a label the product is free to reword.
    const phone = await page.evaluate(() => {
      // No named helpers inside: the toolchain wraps a named function in a `__name` call, and the page
      // has no such helper, so a helper-driven measurement fails at runtime and reports nothing.
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const development = document.querySelector('section[aria-label="Development"]');
      const pairs: [string, Element | undefined][] = [
        [
          'tab: Preview',
          Array.from(document.querySelectorAll('[role="tab"]')).find(
            (element) => (element.textContent ?? '').trim() === 'Preview',
          ),
        ],
        [
          'tab: Source',
          Array.from(document.querySelectorAll('[role="tab"]')).find(
            (element) => (element.textContent ?? '').trim() === 'Source',
          ),
        ],
        ['prompt field', development?.querySelector('textarea') ?? undefined],
        ['primary action', development?.querySelector('button.btn-primary') ?? undefined],
        [
          'Download HTML',
          Array.from(document.querySelectorAll('button')).find((element) =>
            (element.textContent ?? '').trim().startsWith('Download HTML'),
          ),
        ],
      ];
      return {
        overflow,
        controls: pairs.map(([name, element]) => {
          if (!element) return { name, found: false, inside: false, words: '' };
          const box = element.getBoundingClientRect();
          return {
            name,
            found: true,
            inside:
              box.width > 0 &&
              box.height > 0 &&
              box.left >= -1 &&
              box.right <= window.innerWidth + 1,
            words: (element.textContent ?? '').trim().slice(0, 60),
          };
        }),
      };
    });
    observations.phone_width = phone;
    const unusable = phone.controls.filter((entry) => !entry.found || !entry.inside);
    if (phone.overflow > 0 || unusable.length > 0) {
      throw new Error(
        `at 390px the document overflows by ${phone.overflow}px and these controls are missing or outside the viewport: ${
          unusable
            .map((entry) => `${entry.name}${entry.found ? ' (clipped)' : ' (absent)'}`)
            .join(', ') || 'none'
        }`,
      );
    }
    check('at 390px the document fits the viewport and the journey controls are usable');

    // A phone that fits is not a phone you can use: the interaction itself has to work there.
    await page.getByRole('tab', { name: 'Source' }).click();
    const sourcePanelShown = page.locator('#studio-panel-source');
    await sourcePanelShown
      .getByRole('button', { name: /Copy source/ })
      .waitFor({ timeout: 10_000 });
    const sourceWords = (await text(sourcePanelShown)).replace(/\s+/g, ' ').trim().slice(0, 120);
    await page.getByRole('tab', { name: 'Preview' }).click();
    // The published application lives inside the preview iframe, so the assertion reaches through the
    // frame: the panel's own text is panel chrome, never the application.
    const phoneFrame = page.locator('#studio-panel-preview').frameLocator('iframe').first();
    await phoneFrame.locator('h1').first().waitFor({ timeout: 20_000 });
    // biome-ignore lint/performance/useDomNodeTextContent: the heading must be one the user can see, and hidden text is not that
    const previewWords = (await phoneFrame.locator('h1').first().innerText()).trim();
    observations.phone_source_panel_words = sourceWords;
    observations.phone_preview_heading = previewWords;
    if (!/Scripted application/.test(previewWords)) {
      throw new Error(
        `at 390px the preview shows "${previewWords}", not the published application`,
      );
    }
    check(
      'at 390px switching panels changes what is displayed, and the published application is reachable',
    );

    // --- the accounting: nothing was spent --------------------------------------------------------
    const serverLog = server.lines.join('\n');
    const logFile = join(out, 'server.log');
    writeFileSync(logFile, serverLog, 'utf8');
    const evidenceOfLog = ledgerEvidence(logFile);
    const entries = parseMediaTrace(serverLog);
    const damaged = entries.filter((entry) => entry.malformed !== undefined);
    const starts = entries.filter((entry) => entry.outcome === undefined);
    observations.ledger = {
      log_present: evidenceOfLog.logPresent,
      log_bytes: evidenceOfLog.logBytes,
      trace_lines: entries.length,
      damaged_trace_lines: damaged.map((entry) => entry.malformed),
      dispatch_starts: starts.length,
      paths: [...new Set(starts.map((entry) => entry.path ?? '(unattributed)'))],
    };
    if (!evidenceOfLog.logPresent) {
      throw new Error(
        'the zero-provider-call claim has no log behind it: nothing was captured to read',
      );
    }
    if (damaged.length > 0) {
      throw new Error(
        `the provider ledger could not be read: ${damaged.map((entry) => entry.malformed).join('; ')}`,
      );
    }
    if (starts.length > 0) {
      throw new Error(
        `the journey dispatched provider work: ${starts.map((entry) => `${String(entry.path)} model=${String(entry.model)}`).join(', ')}`,
      );
    }
    if (remoteRequests.length > 0) {
      throw new Error(
        `the journey contacted ${[...new Set(remoteRequests)].join(', ')}; it was expected to stay on the loopback interface`,
      );
    }
    observations.remote_origins_requested = [];
    observations.scripted_coding_cli = 'tests/fixtures/fake-muse.mjs';
    check('no provider media dispatch and the scripted CLI answered every coding request');
  } catch (error) {
    // A failure that leaves no logs behind cannot be diagnosed without paying for a re-run, so the
    // captured process output and the page's own text are written no matter how the run ended.
    for (const entry of managed) {
      writeFileSync(join(out, `${entry.name}.log`), entry.lines.join('\n'), 'utf8');
    }
    if (error instanceof BrowserUnavailableError) throw error;
    failures = [error instanceof Error ? error.message : String(error)];
    for (const entry of managed) {
      const tail = entry.lines.slice(-25).join('\n');
      if (tail.trim()) failures.push(`${entry.name} log tail:\n${tail}`);
    }
    const live = browser?.contexts()?.[0]?.pages?.()?.[0];
    if (live) {
      writeFileSync(
        join(out, 'failure-page-text.txt'),
        // biome-ignore lint/performance/useDomNodeTextContent: the dump exists to show what a person would have read
        await live.evaluate(() => document.body.innerText),
        'utf8',
      );
      const shot = await live.screenshot({ fullPage: true });
      writeFileSync(join(out, 'failure.png'), shot);
    }
  } finally {
    await stopAll();
  }

  const passed = failures.length === 0;
  const report = {
    gate: 'verify:beta-journey',
    status: passed ? 'pass' : 'fail',
    checks,
    observations,
    failures,
    human_review_status: 'required_not_performed',
    coding_cli: 'fixture:tests/fixtures/fake-muse.mjs',
    provider_calls: 0,
    evidence_dir: out,
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!passed) {
    writeFileSync(
      join(out, 'FAILED.md'),
      `# verify:beta-journey failed\n\n${failures.join('\n')}\n`,
      'utf8',
    );
  }

  // This gate is itself a claim with a count in its headline, so the floor and the names are pinned.
  const issues = checkCountIssues({
    measured: checks,
    min: 12,
    required: REQUIRED_CHECK_NAMES,
    duplicates: duplicateCheckNames(checks),
  });

  console.log(`\n${passed ? 'PASS' : 'FAILED'} (${checks.length} checks) — evidence: ${out}`);
  if (!passed) console.log(failures.join('\n'));
  console.log(
    'HUMAN REVIEW REQUIRED: the coding CLI here is scripted, so nothing in this run measures what a model would generate; application quality is a human judgement.',
  );
  if (issues.length > 0) {
    console.error(issues.join('\n'));
    return 1;
  }
  return passed ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    await stopAll();
    if (error instanceof Refusal) {
      console.error(`BLOCKED: ${error.message}`);
      process.exit(2);
    }
    if (error instanceof BrowserUnavailableError) {
      console.error(`BLOCKED: ${error.message}`);
      process.exit(2);
    }
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
