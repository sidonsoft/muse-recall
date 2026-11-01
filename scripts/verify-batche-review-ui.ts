/**
 * Batch E deterministic browser coverage for decision review and generation
 * history, against the production Studio build.
 *
 * Like the Batch C UI gate this runs the real API application (`buildApp`, real
 * SQLite + memory engine, real Forge pipeline with the deterministic fake Muse
 * CLI) with an injected *stub* visual-review operation. No provider key is
 * configured, no model call is made, and no request leaves the machine.
 *
 * What it verifies in a real browser:
 *
 *  A) Generations history. The approved generation is listed with the decision
 *     reference it was created with. After an in-place decision edit the label
 *     becomes "Received previous decision" with the drift line "decision edited
 *     in place"; after a decision is deleted it becomes "decision retired
 *     (deleted)" and the retired wording is never shown as current guidance. The
 *     non-causal limits render on the same screen as the labels. The panel
 *     exposes no approve/restore/regenerate control.
 *
 *  B) Screenshot review. Capture preview → select decisions → click Review. The
 *     request pins each decision to the revision the row displayed and carries
 *     no decision text; the reviewed frame is exactly the captured canvas
 *     (sha256 of the intercepted body equals the echoed `screenshot_sha256`);
 *     findings render with evidence, uncertainty, and the model's self-reported
 *     confidence, while an unreported decision is "not assessed" and an invented
 *     entry is counted as dropped. The artifact bytes, version count, job count,
 *     and memory rows are byte-for-byte identical afterwards, and the review is
 *     attached to the approved generation it was reviewed beside.
 *
 *  C) Stale selection. A decision edited after the screen loaded is refused with
 *     "edited after this screen loaded" and the stub review is never called.
 *
 *  D) Update proposal. Proposing from the prompt panel sends the pinned
 *     decisions; rejecting the staged change leaves the approved version and its
 *     bytes untouched, proving review feedback never approves anything.
 *
 * Usage (repo root):
 *   pnpm --filter @mml/web build
 *   pnpm exec tsx scripts/verify-batche-review-ui.ts
 *
 * Evidence goes to `test-results/batche-review-ui/` (gitignored). Requires a
 * managed Playwright Chromium build.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Browser, Page } from 'playwright-core';
import { buildApp } from '../apps/server/src/app.js';
import { type AppConfig, loadConfig } from '../apps/server/src/config.js';
import { ForgeWorkspace } from '../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../apps/server/src/media/assets.js';
import { MediaJobStore } from '../apps/server/src/media/jobs.js';
import type {
  MediaSegmentation,
  MediaUnderstand,
  MediaVisualReview,
} from '../apps/server/src/media/segment.js';
import { MediaService } from '../apps/server/src/media/service.js';
import { MediaSourceStore } from '../apps/server/src/media/sources.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { EchoProvider } from '../packages/muse-provider/src/index.js';
import {
  ForgeGenerationListSchema,
  type MediaVisualReviewRequest,
  MediaVisualReviewRequestSchema,
  type Memory,
} from '../packages/shared/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'test-results', 'batche-review-ui');
const PROJECT = 'batche-ui-verify';
const LONG = 120_000;
const POLL = 250;

const DECISION_ONE = 'Never use countdown timers.';
const DECISION_TWO = 'Theme: ocean only for the background.';
const EDITED_ONE = 'Never use countdown timers, including in the results view.';
const CHANGE_REQUEST = 'Move the score readout into the header and keep the palette cool.';

/** A distinctive canvas frame, so the reviewed bytes are unmistakably real. */
const CANVAS_SNIPPET = `<canvas id="frame" width="320" height="200"></canvas>
<script>
(function(){
  var ctx=document.getElementById('frame').getContext('2d');
  ctx.fillStyle='#123a63';ctx.fillRect(0,0,320,200);
  ctx.fillStyle='#c8452f';ctx.beginPath();ctx.arc(96,100,44,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#f3e6c4';ctx.fillRect(208,64,72,72);
})();
</script>`;

const checks: string[] = [];
const errors: string[] = [];

interface Managed {
  child: ChildProcess;
  name: string;
  log: string;
}

let vite: Managed | null = null;
let browser: Browser | null = null;
let app: FastifyInstance | null = null;
let database: ReturnType<typeof openDatabase> | null = null;

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function fail(message: string): never {
  errors.push(message);
  throw new Error(`Batch E review UI verification failed: ${message}`);
}

function logPath(name: string): string {
  return join(OUT, `${name}.log`);
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
  return address.port;
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

async function waitUntil(predicate: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL));
  }
  fail(`timed out waiting for ${what}`);
}

async function jsonApi<T>(
  base: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: payload !== undefined ? { 'content-type': 'application/json' } : {},
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  type Envelope = { ok?: boolean; data?: T };
  let body: Envelope | null = null;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    body = null;
  }
  if (!response.ok || body?.ok !== true) {
    fail(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return body.data as T;
}

function startManaged(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Managed {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const managed: Managed = { child, name, log: logPath(name) };
  const append = (chunk: Buffer) => {
    try {
      writeFileSync(managed.log, chunk, { flag: 'a' });
    } catch {
      // Evidence must never mask the result.
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error) => append(Buffer.from(`spawn error: ${error.message}\n`)));
  return managed;
}

async function stopManaged(item: Managed | null): Promise<void> {
  if (!item) return;
  const pid = item.child.pid;
  if (item.child.exitCode !== null || pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          item.child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }
      resolve();
    }, 8_000);
    item.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        item.child.kill('SIGTERM');
      } catch {
        resolve();
      }
    }
  });
}

async function openProject(page: Page, expected: string): Promise<void> {
  await page.locator('button[title^="Project:"]').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Project id').fill(PROJECT);
  await dialog.getByRole('button', { name: 'Open', exact: true }).press('Enter');
  await page.getByText(expected, { exact: true }).waitFor({ timeout: 20_000 });
}

/** PNG width/height straight out of the IHDR chunk. */
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    fail('the reviewed frame is not a PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function artifactState(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'screenshots'), { recursive: true });
  for (const stale of ['failure.txt', 'console-errors.txt', 'requests.log']) {
    await rm(join(OUT, stale), { force: true });
  }

  // ---- Preconditions -----------------------------------------------------
  try {
    await stat(join(ROOT, 'apps/web/dist/index.html'));
  } catch {
    fail('apps/web/dist/index.html is missing — run `pnpm --filter @mml/web build` first.');
  }
  const distMtime = (await stat(join(ROOT, 'apps/web/dist/index.html'))).mtimeMs;
  let newestSource = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        newestSource = Math.max(newestSource, (await stat(full)).mtimeMs);
      }
    }
  };
  await walk(join(ROOT, 'apps/web/src'));
  if (newestSource > distMtime + 1_000) {
    fail('the web build is older than apps/web/src — run `pnpm --filter @mml/web build`.');
  }
  if (process.env.FORGE_MUSE_API_KEY || process.env.FORGE_FALLBACK_API_KEY) {
    fail('paid provider keys are set in the environment; this gate must run with stubs only.');
  }

  const serverPort = await freePort();
  const webPort = await freePort();
  const dataRoot = await mkdtemp(join(tmpdir(), 'batche-ui-'));
  const apiBase = `http://127.0.0.1:${serverPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const requestLog: string[] = [];
  const screenshot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: join(OUT, 'screenshots', `${name}.png`), fullPage: true });
  };

  const launched = await launchVerificationBrowser();
  browser = launched.browser;
  reportBrowserSelection(launched.selection);
  check(
    `browser available: ${launched.selection.selected ?? launched.selection.attempted} (${launched.selection.policy})`,
  );

  try {
    // ---- Real API application with a stub visual review -------------------
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(serverPort),
      DATABASE_PATH: join(dataRoot, 'memory.db'),
      WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
      CORS_ORIGINS: webBase,
      MODEL_PROVIDER: 'echo',
      LOG_LEVEL: 'silent',
      FORGE_MUSE_BIN: join(ROOT, 'tests/fixtures/fake-muse.mjs'),
      FORGE_MUSE_MODEL: 'fake-muse',
      FORGE_REASONING_EFFORT: 'low',
      FORGE_MAX_RUNTIME_MS: '60000',
      FORGE_RUNTIME_BROWSER: 'managed',
    };
    const config: AppConfig = loadConfig(serverEnv, ROOT);
    if (config.forge?.apiKey) fail('a forge API key is configured; this gate must stay offline.');

    // A canvas-bearing app so "Capture preview" produces a real frame without
    // any external script: the fixture is the proven-validating general app plus
    // a locally drawn canvas.
    const baseApp = await readFile(join(ROOT, 'tests/fixtures/general-app-form.html'), 'utf8');
    const canvasApp = baseApp.includes('</body>')
      ? baseApp.replace('</body>', `${CANVAS_SNIPPET}\n</body>`)
      : `${baseApp}\n${CANVAS_SNIPPET}`;
    const appPath = join(dataRoot, 'canvas-app.html');
    await writeFile(appPath, canvasApp, 'utf8');

    let reviewCalls = 0;
    const reviewPrompts: string[][] = [];
    const visualReview = {
      targetedModel: 'muse-spark-1.3',
      review: async (_image: unknown, decisions: Array<{ id: string; text: string }>) => {
        reviewCalls += 1;
        reviewPrompts.push(decisions.map((entry) => `${entry.id}:${entry.text}`));
        return {
          findings: decisions.slice(0, 1).map((entry) => ({
            decision_id: entry.id,
            decision_excerpt: entry.text.slice(0, 120),
            decision_revision: 1,
            verdict: 'possible_conflict',
            evidence: 'a red disc sits in the lower left of the frame',
            uncertainty: 'a single frame cannot show whether the disc moves',
            confidence: 0.6,
          })),
          unverified: decisions.slice(1).map((entry) => ({
            decision_id: entry.id,
            decision_excerpt: entry.text.slice(0, 120),
            decision_revision: 1,
            reason: 'the answer said nothing about this decision',
            uncertainty: 'nothing was reported about this decision',
          })),
          ignored: 1,
          model: 'muse-spark-1.3',
          observedModel: 'muse-spark-1.3-observed',
          attempts: 1,
        };
      },
    };
    const understand = {
      targetedModel: 'muse-spark-1.3',
      suggest: async () => fail('the Batch E gate must not call vision suggest'),
    };
    const segmentation = {
      targetedModel: 'sam-3.1',
      segment: async () => fail('the Batch E gate must not call SAM'),
    };

    database = openDatabase({ path: config.databasePath, wal: false });
    const engine = new MemoryEngine(database.db);
    const workspace = new ForgeWorkspace(config.workspaceRoot);
    const assets = new MediaAssetStore(workspace);
    const jobs = new MediaJobStore(workspace);
    const mediaSources = new MediaSourceStore(workspace);
    const mediaService = new MediaService(
      assets,
      jobs,
      null,
      {
        understand: understand as unknown as MediaUnderstand,
        segmentation: segmentation as unknown as MediaSegmentation,
        visualReview: visualReview as unknown as MediaVisualReview,
      },
      { sources: mediaSources },
    );
    app = await buildApp({
      config,
      db: database.db,
      dbPath: config.databasePath,
      provider: new EchoProvider(),
      engine,
      forgeWorkspace: workspace,
      mediaAssets: assets,
      mediaJobs: jobs,
      mediaSources,
      mediaService,
      startedAt: Date.now(),
    });
    await app.listen({ host: '127.0.0.1', port: serverPort });
    check('started the real API application with a deterministic stub visual review');

    // ---- Seed: two decisions, then one approved generation ----------------
    process.env.FAKE_MUSE_MODE = 'copy';
    process.env.FAKE_MUSE_HTML = appPath;
    process.env.FORGE_RUNTIME_BROWSER = 'managed';

    await jsonApi(apiBase, 'POST', '/api/forge/projects', {
      project_id: PROJECT,
      name: 'Batch E review verification',
    });
    const first = await jsonApi<{ memory: Memory }>(apiBase, 'POST', '/api/memories', {
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT,
      content: DECISION_ONE,
      confidence: 0.9,
      validation_status: 'verified',
      source: { session_id: null, reference: 'gate:batche' },
    });
    const second = await jsonApi<{ memory: Memory }>(apiBase, 'POST', '/api/memories', {
      type: 'preference',
      scope: 'project',
      project_id: PROJECT,
      content: DECISION_TWO,
      confidence: 0.9,
      validation_status: 'verified',
      source: { session_id: null, reference: 'gate:batche' },
    });

    const generation = await jsonApi<{ id: string }>(
      apiBase,
      'POST',
      `/api/forge/projects/${PROJECT}/generate`,
      { prompt: 'A small deterministic page with a drawn canvas used to exercise review.' },
    );
    let jobStatus = '';
    await waitUntil(
      async () => {
        const job = await jsonApi<{ status: string }>(
          apiBase,
          'GET',
          `/api/forge/jobs/${generation.id}`,
        );
        jobStatus = job.status;
        return job.status !== 'queued' && job.status !== 'running';
      },
      'the seeded generation to finish',
      LONG,
    );
    if (jobStatus !== 'succeeded') fail(`seeded generation ended ${jobStatus}`);
    await jsonApi(apiBase, 'POST', `/api/forge/jobs/${generation.id}/approve`, {
      capture_memory: false,
    });
    const seededArtifact = await jsonApi<{ html: string; sha256: string }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/artifact`,
    );
    const seededSha = seededArtifact.sha256;
    if (artifactState(seededArtifact.html) !== seededSha) {
      fail('the seeded artifact sha256 does not describe its own bytes');
    }

    // Which decisions the approved generation was actually given: the gate
    // asserts what the record says, rather than assuming Recall picked both.
    const seededGenerations = ForgeGenerationListSchema.parse(
      await jsonApi<unknown>(apiBase, 'GET', `/api/forge/projects/${PROJECT}/generations`),
    );
    const seeded = seededGenerations.items.find((item) => item.version === 1);
    if (!seeded) fail('the approved generation is missing from the generations listing');
    const suppliedIds = (seeded?.memory_reference ?? []).map((entry) => entry.memory_id);
    if (suppliedIds.length === 0) {
      fail('the seeded generation recorded no decision reference; the gate cannot show drift');
    }
    check(
      `seeded one approved generation carrying ${String(suppliedIds.length)} stored decision reference(s)`,
    );

    // ---- Production Studio build ----------------------------------------
    vite = startManaged(
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
      { cwd: join(ROOT, 'apps/web'), env: { ...process.env, VITE_PROXY_TARGET: apiBase } },
    );
    await waitForHttp(webBase);
    if (browser === null) fail('the verification browser closed before the page opened');
    const activeBrowser = browser;
    const context = await activeBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const expectedConsoleErrors: string[] = [];
    const httpFailures: string[] = [];
    const nonLocal: string[] = [];
    const reviewRequests: MediaVisualReviewRequest[] = [];
    const reviewKeys: Array<string | undefined> = [];
    const modifyBodies: Array<{
      decisions?: Array<{ memory_id: string; expected_revision: number }>;
    }> = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Chromium logs a refused request as a console error. The deliberate
      // stale-selection refusals are recorded separately rather than dropped,
      // and every other error still fails the gate.
      if (text.startsWith('Failed to load resource') && /\b409\b/.test(text)) {
        expectedConsoleErrors.push(text);
        return;
      }
      if (text.includes('favicon')) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      consoleErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });
    page.on('response', (response) => {
      if (response.url().startsWith(webBase) || response.url().startsWith(apiBase)) {
        if (response.status() >= 400) {
          const line = `HTTP ${String(response.status())} ${response.request().method()} ${response.url()}`;
          httpFailures.push(line);
        }
        return;
      }
      nonLocal.push(response.url());
    });
    page.on('request', (request) => {
      requestLog.push(`${request.method()} ${request.url()}`);
      if (request.url().endsWith('/visual-review')) {
        const body = request.postData();
        if (body) {
          reviewRequests.push(MediaVisualReviewRequestSchema.parse(JSON.parse(body)));
          reviewKeys.push(request.headers()['idempotency-key']);
        }
      }
      if (request.url().endsWith('/modify')) {
        const body = request.postData();
        if (body) modifyBodies.push(JSON.parse(body));
      }
    });

    await page.goto(webBase, { waitUntil: 'domcontentloaded' });
    await openProject(page, 'v1 approved');
    await screenshot(page, '01-project-open');
    check('the production Studio build opened the seeded project at v1 approved');

    const reviewPanel = page.getByRole('region', { name: 'Decision review' });
    const generationsPanel = page.getByRole('region', { name: 'Generations and decisions' });
    await reviewPanel.waitFor({ timeout: 15_000 });
    await generationsPanel.waitFor({ timeout: 15_000 });
    await reviewPanel.getByText(DECISION_ONE).first().waitFor({ timeout: 15_000 });
    await reviewPanel.getByText('rev 1').first().waitFor({ timeout: 15_000 });
    const reviewButton = reviewPanel.getByRole('button', { name: 'Review this screenshot' });
    if (!(await reviewButton.isDisabled())) fail('Review is enabled before any frame or selection');
    await reviewPanel
      .getByText('Capture a screenshot from the preview')
      .waitFor({ timeout: 5_000 });
    check('Decision review offers the accepted decisions pinned to the revision on screen');

    await generationsPanel
      .getByText('Matched current decision')
      .first()
      .waitFor({ timeout: 15_000 });
    await generationsPanel
      .getByText('not evidence that the model followed')
      .first()
      .waitFor({ timeout: 5_000 });
    const generationButtons = await generationsPanel
      .getByRole('button')
      .allInnerTexts()
      .then((labels) => labels.map((label) => label.trim()).filter((label) => label.length > 0));
    for (const label of generationButtons) {
      if (/approve|restore|regenerate|rollback|apply|accept/i.test(label)) {
        fail(`the generations panel exposes a mutating control: ${label}`);
      }
    }
    check('generations history renders the label, the limits, and no mutating control');

    // ---- Capture a real frame and review it -------------------------------
    await page.getByRole('button', { name: 'Capture preview' }).click();
    await page.getByText('Preview captured.').waitFor({ timeout: 30_000 });
    await screenshot(page, '02-frame-captured');
    check('Capture preview produced a frame in the production build');

    await reviewPanel.getByRole('checkbox').first().check();
    await reviewPanel.getByRole('checkbox').last().check();
    if (await reviewButton.isDisabled())
      fail('Review stayed disabled with a frame and a selection');
    await reviewPanel
      .getByText('again returns the stored answer rather than asking the model twice')
      .waitFor({ timeout: 5_000 });

    type ProjectView = {
      state: { versions: unknown[]; current_version: number | null };
      jobs: unknown[];
    };
    const before = await jsonApi<ProjectView>(apiBase, 'GET', `/api/forge/projects/${PROJECT}`);
    const memoriesBefore = await jsonApi<{ items: unknown[] }>(
      apiBase,
      'GET',
      `/api/memories?project_id=${PROJECT}&include_global=true&limit=50`,
    );

    await reviewButton.click();
    await reviewPanel.getByText('the frame may conflict').first().waitFor({ timeout: 30_000 });
    await screenshot(page, '03-review-findings');

    if (reviewRequests.length !== 1)
      fail(`expected one visual-review request, saw ${reviewRequests.length}`);
    const sent = reviewRequests[0] as MediaVisualReviewRequest;
    if (sent.decisions.length !== 2)
      fail(`expected two pinned selections, saw ${sent.decisions.length}`);
    for (const entry of sent.decisions) {
      if (entry.expected_revision !== 1) {
        fail(`selection was pinned to revision ${String(entry.expected_revision)}, expected 1`);
      }
    }
    const serialised = JSON.stringify(sent);
    if (serialised.includes('countdown') || serialised.includes('ocean')) {
      fail('the review request carried decision text, not just ids and revisions');
    }
    check('the review request pinned both selections to the revision the rows displayed');

    const frameBytes = Buffer.from(sent.screenshot_data_url.split(',')[1] ?? '', 'base64');
    const frameSha = createHash('sha256').update(frameBytes).digest('hex');
    const dimensions = pngDimensions(frameBytes);
    if (dimensions.width !== 320 || dimensions.height !== 200) {
      fail(
        `reviewed frame is ${String(dimensions.width)}x${String(dimensions.height)}, expected 320x200`,
      );
    }
    const echoedSha = await reviewPanel
      .getByText(`Frame ${frameSha.slice(0, 12)}`)
      .first()
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!echoedSha)
      fail(`the panel does not show the reviewed frame fingerprint ${frameSha.slice(0, 12)}`);
    check('the reviewed frame is the captured canvas: PNG 320x200, sha256 echoed in the panel');

    await reviewPanel
      .getByText('a red disc sits in the lower left of the frame')
      .waitFor({ timeout: 5_000 });
    await reviewPanel.getByText('Still uncertain:').first().waitFor({ timeout: 5_000 });
    await reviewPanel.getByText('not assessed').first().waitFor({ timeout: 5_000 });
    await reviewPanel
      .getByText('the answer said nothing about this decision')
      .waitFor({ timeout: 5_000 });
    await reviewPanel.getByText('model self-report 60%').first().waitFor({ timeout: 5_000 });
    await reviewPanel
      .getByText('1 entry in the model answer described a decision')
      .waitFor({ timeout: 5_000 });
    await reviewPanel.getByText('artifact unchanged: yes').waitFor({ timeout: 5_000 });
    await reviewPanel.getByText('generation v1 (generate)').waitFor({ timeout: 5_000 });
    await reviewPanel
      .getByText('These findings are advisory. They never approve, reject, or change an artifact')
      .first()
      .waitFor({ timeout: 5_000 });
    await reviewPanel
      .getByText('A screenshot is one still frame: it cannot show behaviour over time')
      .first()
      .waitFor({ timeout: 5_000 });
    check(
      'findings show evidence, uncertainty and self-reported confidence; gaps read as not assessed',
    );

    const afterReviewArtifact = await jsonApi<{ sha256: string }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/artifact`,
    );
    const afterReviewState = await jsonApi<ProjectView>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}`,
    );
    const memoriesAfter = await jsonApi<{ items: unknown[] }>(
      apiBase,
      'GET',
      `/api/memories?project_id=${PROJECT}&include_global=true&limit=50`,
    );
    if (afterReviewArtifact.sha256 !== seededSha)
      fail('the review changed the approved artifact bytes');
    if (afterReviewState.state.versions.length !== before.state.versions.length) {
      fail('the review created a version');
    }
    if (memoriesAfter.items.length !== memoriesBefore.items.length) {
      fail('the review created or removed a memory record');
    }
    if (afterReviewState.jobs.length !== before.jobs.length) {
      fail('the review started a Forge job');
    }
    if (reviewCalls !== 1)
      fail(`the stub review ran ${String(reviewCalls)} times, expected exactly 1`);
    check('the review wrote nothing: identical artifact sha, version count, and memory rows');

    // ---- One question, one paid call: asking again replays the answer -------
    const keysBeforeReplay = reviewKeys.length;
    await reviewButton.click();
    await waitUntil(
      async () => reviewKeys.length === keysBeforeReplay + 1,
      'the replayed review request',
    );
    const replayKey = reviewKeys[keysBeforeReplay];
    if (reviewKeys[0] === undefined || reviewKeys[0].length < 8) {
      fail('the review request carried no usable Idempotency-Key');
    }
    if (replayKey !== reviewKeys[0]) {
      fail(
        `re-asking the same question sent key ${String(replayKey)}, expected ${String(reviewKeys[0])}`,
      );
    }
    await reviewPanel.getByText('the frame may conflict').first().waitFor({ timeout: 10_000 });
    if (reviewCalls !== 1) {
      fail(
        `the same frame and selection cost ${String(reviewCalls)} dispatches, expected exactly 1`,
      );
    }
    await screenshot(page, '03b-replayed-review');
    check('re-asking the same question replays the answer: one dispatch per frame and selection');

    // ---- A decision moves under the screen: refuse before the stub -------
    await jsonApi(apiBase, 'PATCH', `/api/memories/${first.memory.id}`, {
      content: EDITED_ONE,
      expected_revision: 1,
    });
    await generationsPanel.getByRole('button', { name: 'Reload' }).click();
    await generationsPanel
      .getByText('Received previous decision')
      .first()
      .waitFor({ timeout: 15_000 });
    await generationsPanel
      .getByText('decision edited in place')
      .first()
      .waitFor({ timeout: 5_000 });
    await generationsPanel
      .getByText('only a new job can use current guidance')
      .first()
      .waitFor({ timeout: 5_000 });
    await screenshot(page, '04-generation-stale');
    check(
      'an in-place decision edit labels the generation Received previous decision, not at fault',
    );

    // The panel still shows the row at rev 1: reviewing now must be refused.
    await reviewButton.click();
    await reviewPanel
      .getByText('A selected decision was edited after this screen loaded')
      .first()
      .waitFor({ timeout: 15_000 });
    if (reviewCalls !== 1)
      fail(`a stale selection reached the provider (${String(reviewCalls)} calls)`);
    const refusals = httpFailures.filter((line) => line.includes(' 409 '));
    if (refusals.length !== 1) {
      fail(`the stale selection produced ${refusals.length} refusals, expected exactly one 409`);
    }
    await screenshot(page, '05-stale-refusal');
    check('a stale selection is refused with a repair instruction and no provider call');

    // Reopen the project so the panel shows the current revision, then review.
    await openProject(page, 'v1 approved');
    await page.getByRole('button', { name: /Capture preview|Recapture/ }).click();
    await page.getByText('Preview captured.').waitFor({ timeout: 30_000 });
    await reviewPanel.getByText('rev 2').first().waitFor({ timeout: 15_000 });
    // Select by row so the assertion is about the decision that moved, not
    // about whichever row happens to be listed first.
    await reviewPanel.locator('label', { hasText: EDITED_ONE }).getByRole('checkbox').check();
    await reviewPanel.getByRole('button', { name: 'Review this screenshot' }).click();
    await reviewPanel.getByText('the frame may conflict').first().waitFor({ timeout: 30_000 });
    const latest = reviewRequests[reviewRequests.length - 1] as MediaVisualReviewRequest;
    const pinned = latest.decisions.find((entry) => entry.memory_id === first.memory.id);
    if (pinned?.expected_revision !== 2) {
      fail(
        `reopened selection pinned ${JSON.stringify(pinned ?? latest.decisions)}, expected revision 2`,
      );
    }
    if (reviewCalls !== 2)
      fail(`expected two stub review calls in total, saw ${String(reviewCalls)}`);
    check('after reopening, the selection pins the current revision and the review runs once');

    // ---- Retire a decision: history must call it retired -----------------
    await jsonApi(apiBase, 'DELETE', `/api/memories/${second.memory.id}`, {
      reason: 'gate:retire',
    });
    await generationsPanel.getByRole('button', { name: 'Reload' }).click();
    const retiredGenerations = ForgeGenerationListSchema.parse(
      await jsonApi<unknown>(apiBase, 'GET', `/api/forge/projects/${PROJECT}/generations`),
    );
    const retired = retiredGenerations.items.find((item) => item.version === 1);
    if (!retired) fail('the approved generation disappeared from the listing after a deletion');
    const driftHeads = retired.comparison.drift.map((drift) =>
      drift.change === 'withdrawn' && drift.current_status !== null
        ? `decision retired (${drift.current_status})`
        : drift.change === 'revised_in_place'
          ? 'decision edited in place'
          : 'decision corrected by a newer decision',
    );
    if (driftHeads.length === 0)
      fail('deleting a supplied decision produced no drift in the record');
    for (const head of driftHeads) {
      await generationsPanel.getByText(head).first().waitFor({ timeout: 10_000 });
    }
    for (const drift of retired.comparison.drift) {
      if (drift.current_excerpt !== null && drift.change === 'withdrawn') {
        fail('a retired decision still reports current wording in the record');
      }
    }
    await screenshot(page, '06-retired-decision');
    check(`retired decisions read as retired (${driftHeads.join(', ')})`);

    // Reopen so the review selection reflects the store, then propose an update.
    await openProject(page, 'v1 approved');
    // Only the selectable rows matter here: the earlier review's feedback keeps
    // naming the decision it was about, which is history, not current guidance.
    await reviewPanel
      .locator('label', { hasText: DECISION_TWO })
      .waitFor({ state: 'hidden', timeout: 10_000 });
    await reviewPanel.locator('label', { hasText: EDITED_ONE }).waitFor({ timeout: 10_000 });
    check('a retired decision is no longer offered as review guidance');

    // ---- An update proposal carries the pinned decisions, and rejecting it
    //      leaves the approved version exactly as it was.
    await reviewPanel.locator('label', { hasText: EDITED_ONE }).getByRole('checkbox').check();
    await page.getByRole('textbox', { name: 'Change request' }).fill(CHANGE_REQUEST);
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText('Change staged. Review the diff, then approve or reject it.').waitFor({
      timeout: LONG,
    });
    if (modifyBodies.length !== 1) fail(`expected one modify request, saw ${modifyBodies.length}`);
    const proposed = modifyBodies[0]?.decisions ?? [];
    const proposedPin = proposed.find((entry) => entry.memory_id === first.memory.id);
    if (proposed.length !== 1 || proposedPin?.expected_revision !== 2) {
      fail(
        `the proposal carried ${JSON.stringify(proposed)}, expected the edited decision at revision 2`,
      );
    }
    await screenshot(page, '07-staged-change');
    check('the update proposal carried the decision pinned to the revision the screen displayed');

    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByText('Change rejected. The approved application is untouched.').waitFor({
      timeout: 15_000,
    });
    const finalArtifact = await jsonApi<{ sha256: string }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/artifact`,
    );
    const finalState = await jsonApi<ProjectView>(apiBase, 'GET', `/api/forge/projects/${PROJECT}`);
    if (finalArtifact.sha256 !== seededSha) fail('rejecting the change altered the approved bytes');
    if (finalState.state.versions.length !== before.state.versions.length) {
      fail('the staged proposal became a version without approval');
    }
    if (finalState.jobs.length <= before.jobs.length) {
      fail('the rejected proposal left no job record behind for the reader');
    }
    await screenshot(page, '08-rejected-unchanged');
    check('rejecting the staged proposal leaves v1 and its bytes untouched');

    // ---- Provider and network hygiene ------------------------------------
    if (reviewCalls !== 2) fail(`stub review calls: ${String(reviewCalls)}, expected exactly 2`);
    writeFileSync(join(OUT, 'requests.log'), `${requestLog.join('\n')}\n`);
    const unexplained = httpFailures.filter((line) => !line.includes(' 409 '));
    if (unexplained.length > 0) {
      fail(`unexpected HTTP failures:\n${unexplained.join('\n')}`);
    }
    writeFileSync(
      join(OUT, 'console-errors.txt'),
      `${consoleErrors.join('\n')}\n\n# deliberate 409 resource lines (${expectedConsoleErrors.length}):\n${expectedConsoleErrors.join('\n')}\n`,
    );
    if (consoleErrors.length > 0) {
      fail(`console errors:\n${consoleErrors.slice(0, 8).join('\n')}`);
    }
    if (nonLocal.length > 0) {
      fail(`non-local requests: ${Array.from(new Set(nonLocal)).slice(0, 5).join(', ')}`);
    }
    check(
      `clean console, ${String(httpFailures.length)} deliberate 409 refusal${httpFailures.length === 1 ? '' : 's'}, zero non-local requests, zero provider calls`,
    );

    writeFileSync(
      join(OUT, 'report.json'),
      JSON.stringify(
        {
          ok: true,
          checks,
          observations: {
            project: PROJECT,
            artifact_sha256: finalArtifact.sha256,
            versions: finalState.state.versions.length,
            review_calls: reviewCalls,
            review_request_count: reviewRequests.length,
            review_pinned_revisions: reviewRequests.map((entry) =>
              entry.decisions.map((decision) => decision.expected_revision),
            ),
            suggest_calls: 0,
            segment_calls: 0,
            decisions: [first.memory.id, second.memory.id],
            generation_reference: (seeded.memory_reference ?? []).map((entry) => ({
              memory_id: entry.memory_id,
              revision: entry.revision,
            })),
          },
        },
        null,
        2,
      ),
    );

    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    browser = null;
    await stopManaged(vite);
    vite = null;
    if (app) await app.close().catch(() => undefined);
    app = null;
    database?.close();
    database = null;
  }

  console.log(`\nBatch E review UI: PASS (${checks.length} checks)`);
  console.log(`evidence: ${OUT}`);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    writeFileSync(
      join(OUT, 'failure.txt'),
      `${message}\n\nchecks completed:\n${checks.join('\n')}\n`,
    );
  } catch {
    // evidence is best effort
  }
  console.error(`\nFAIL: ${message}`);
  console.error(`evidence: ${OUT}`);
  process.exitCode = 1;
});
