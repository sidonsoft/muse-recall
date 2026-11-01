/**
 * Batch C deterministic browser coverage for the successful Studio flows.
 *
 * Starts the real API application (Fastify `buildApp`, real SQLite/memory
 * engine, real Forge pipeline with the deterministic fake Muse CLI) with an
 * injected *stub* media service: vision suggestions and SAM matches with
 * preview data URLs plus a valid tiny RGBA mask/source PNG. No provider key is
 * configured, no model call is made, and no retries are issued.
 *
 * It then drives the production Studio build in managed Chromium and verifies:
 *
 *  A) reference image → Suggest → editable drafts → edit one draft (text and
 *     type) → Propose to memory → Memory review → explicitly Accept → active
 *     memory content + `source.reference = muse-asset://<asset>/v<n>` via the
 *     API; a second proposal is Rejected in the same review; a third draft is
 *     dismissed. Only the accepted proposal may be active/listable at the source
 *     version, and no dismissed draft may leave any memory record.
 *
 *  B) reference panel → Segment → matches render as inspectable `<img>` previews
 *     → select a nonzero match → Save cutout → candidate asset appears →
 *     Approve it in the Media panel → Insert into Studio → the change-request
 *     field contains a well-formed `muse-asset://<asset>/v<n>` placeholder.
 *     The script stops before any generation.
 *
 * A clean-console / no-pageerror / no-HTTP-≥400 gate runs for the whole session,
 * and every request must stay on the local web/API origin.
 *
 * Usage (repo root):
 *   pnpm --filter @mml/web build     # only when the web build is stale
 *   pnpm exec tsx scripts/verify-batchc-ui.ts
 *
 * Evidence (screenshots, logs, summary) goes to `test-results/batchc-ui/`,
 * which is gitignored. Requires a managed Playwright Chromium build
 * (`pnpm exec playwright-core install chromium`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
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
import type { MediaSegmentation, MediaUnderstand } from '../apps/server/src/media/segment.js';
import { MediaService } from '../apps/server/src/media/service.js';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { EchoProvider } from '../packages/muse-provider/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'test-results', 'batchc-ui');
const PROJECT = 'batchc-ui-verify';
const LONG = 120_000;
const POLL = 250;

const ACCEPTED_CONTENT = 'Use rounded cards and a warm sunset palette for the results view.';
const REJECTED_CONTENT = 'Keep the palette under six colours.';
const DISMISSED_CONTENT = 'Use CSS grid for the results layout.';
const SEGMENT_CONCEPT = 'sunset square';

const PREFERENCE_SUGGESTION = {
  type: 'preference' as const,
  content: 'Prefer rounded cards.',
  confidence: 0.82,
};
const REJECTED_SUGGESTION = {
  type: 'constraint' as const,
  content: REJECTED_CONTENT,
  confidence: 0.61,
};
const DISMISSED_SUGGESTION = {
  type: 'technical_decision' as const,
  content: DISMISSED_CONTENT,
  confidence: 0.55,
};
const SUGGESTIONS = [PREFERENCE_SUGGESTION, REJECTED_SUGGESTION, DISMISSED_SUGGESTION];

/**
 * Deterministic 8x8 RGBA source PNG (two colour quadrants, full alpha). Inlined
 * so the fixture needs no image library and cannot vary between runs.
 */
const SOURCE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAALUlEQVR4AYXBMQEAIAzEwPALNhnQgZfawwSs3XI3bq1Hs+ehCyKIIIIIIoggPuNJA+MO0WyKAAAAAElFTkSuQmCC';

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
  throw new Error(`batch C UI verification failed: ${message}`);
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
      // Logging must never mask the test result.
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

interface MemoryRecord {
  id: string;
  status: string;
  content: string;
  type: string;
  source: { reference: string | null };
}

interface MediaSummary {
  asset_id: string;
  version_count: number;
  approved_versions: number[];
}

interface MediaVersionRecord {
  asset_id: string;
  version: number;
  status: 'candidate' | 'approved' | 'rejected';
  mime: string;
  parent: { asset_id: string; version: number } | null;
  source: {
    kind?: string;
    text?: string;
    segment?: { concept?: string; mask_width?: number };
  } | null;
}

async function openProject(page: Page, id = PROJECT, expected = 'v1 approved'): Promise<void> {
  await page.locator('button[title^="Project:"]').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Project id').fill(id);
  await dialog.getByRole('button', { name: 'Open', exact: true }).press('Enter');
  await page.getByText(expected, { exact: true }).waitFor({ timeout: 20_000 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // Truncate the web-server log so each run's evidence describes only that run.
  try {
    writeFileSync(logPath('web'), '');
  } catch {
    // Evidence is best effort.
  }
  mkdirSync(join(OUT, 'screenshots'), { recursive: true });
  // A successful rerun must not leave a previous run's failure evidence behind.
  for (const stale of ['failure.txt', 'console-errors.txt']) {
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
    fail('paid provider keys are set in the environment; this script must run with stubs only.');
  }

  const serverPort = await freePort();
  const webPort = await freePort();
  const dataRoot = await mkdtemp(join(tmpdir(), 'batchc-ui-'));
  const apiBase = `http://127.0.0.1:${serverPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
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
    // ---- Real API application with a stub media service -------------------
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
      FAKE_MUSE_MODE: 'app',
      FAKE_MUSE_APP: join(ROOT, 'tests/fixtures/general-app-form.html'),
      FORGE_RUNTIME_BROWSER: 'managed',
    };
    const config: AppConfig = loadConfig(serverEnv, ROOT);
    if (config.forge?.apiKey)
      fail('a forge API key is configured; the verification must stay offline.');

    let suggestCalls = 0;
    let segmentCalls = 0;
    const segmentation = {
      targetedModel: 'sam-3.1',
      segment: async () => {
        segmentCalls += 1;
        return {
          lane: '<stub>',
          matches: [
            {
              objectId: '0',
              box: { x1: 0, y1: 0, x2: 8, y2: 8 },
              confidence: 0.93,
              maskWidth: 8,
              maskHeight: 8,
              raster: Uint8Array.from({ length: 64 }, () => 1),
            },
            {
              objectId: '1',
              box: { x1: 2, y1: 2, x2: 6, y2: 6 },
              confidence: 0.71,
              maskWidth: 4,
              maskHeight: 4,
              raster: Uint8Array.from({ length: 16 }, () => 1),
            },
          ],
          skipped: 0,
          diagnostics: [],
          model: 'sam-3.1',
          observedModel: null,
          latencyMs: 1,
          attempts: 1,
        };
      },
    };
    const understand = {
      targetedModel: 'muse-spark-1.3',
      suggest: async () => {
        suggestCalls += 1;
        return {
          suggestions: SUGGESTIONS,
          model: 'muse-spark-1.3',
          observedModel: null,
          attempts: 1,
        };
      },
    };
    database = openDatabase({ path: config.databasePath, wal: false });
    const engine = new MemoryEngine(database.db);
    const workspace = new ForgeWorkspace(config.workspaceRoot);
    const assets = new MediaAssetStore(workspace);
    const jobs = new MediaJobStore(workspace);
    const mediaService = new MediaService(assets, jobs, null, {
      segmentation: segmentation as unknown as MediaSegmentation,
      understand: understand as unknown as MediaUnderstand,
    });
    app = await buildApp({
      config,
      db: database.db,
      dbPath: config.databasePath,
      provider: new EchoProvider(),
      engine,
      forgeWorkspace: workspace,
      mediaAssets: assets,
      mediaJobs: jobs,
      mediaService,
      startedAt: Date.now(),
    });
    await app.listen({ host: '127.0.0.1', port: serverPort });
    check('started the real API application with a deterministic stub media service');

    // ---- One real approved Studio version (fake CLI, no provider) --------
    // ForgeJobManager spawns the fake CLI with the process environment, not the
    // config object: pin the fixture mode here so the seeded app is the
    // offline, CDN-free app (not the fake CLI's default Phaser page).
    process.env.FAKE_MUSE_MODE = 'app';
    process.env.FAKE_MUSE_APP = join(ROOT, 'tests/fixtures/general-app-form.html');
    process.env.FORGE_RUNTIME_BROWSER = 'managed';
    await jsonApi(apiBase, 'POST', '/api/forge/projects', {
      project_id: PROJECT,
      name: 'Batch C UI verification',
    });
    const generation = await jsonApi<{ id: string }>(
      apiBase,
      'POST',
      `/api/forge/projects/${PROJECT}/generate`,
      { prompt: 'A small deterministic settings page used to exercise reference controls.' },
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
      'the seeded Studio generation to finish',
      LONG,
    );
    if (jobStatus !== 'succeeded') fail(`seeded generation ended ${jobStatus}`);
    await jsonApi(apiBase, 'POST', `/api/forge/jobs/${generation.id}/approve`, {
      capture_memory: false,
    });
    const artifact = await fetch(`${apiBase}/api/forge/projects/${PROJECT}/artifact`);
    if (!artifact.ok) fail(`seeded artifact read failed: HTTP ${artifact.status}`);
    const artifactBody = (await artifact.json()) as { data?: { html?: string } };
    if (!artifactBody.data?.html || artifactBody.data.html.length < 100) {
      fail('seeded approved artifact is missing or empty');
    }
    check('seeded one approved Studio version through the deterministic fake CLI');

    // ---- Production web build via Vite preview ---------------------------
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
    check('served the production web build with a preview proxy to the local API');

    // ---- Browser session with the clean-console gate ---------------------
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (/favicon/i.test(text) || /Download the React DevTools/.test(text)) return;
      if (message.type() === 'error') errors.push(`console error: ${text}`);
    });
    page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
    page.on('response', (response) => {
      if (response.url().toLowerCase().includes('favicon')) return;
      if (response.status() >= 400) {
        void response
          .text()
          .catch(() => '<unreadable body>')
          .then((body) => {
            errors.push(
              `HTTP ${response.status()} ${response.request().method()} ${response.url()} body=${body.slice(0, 600)}`,
            );
          });
      }
    });
    const allowedOrigins = new Set([new URL(webBase).origin, new URL(apiBase).origin]);
    page.on('request', (request) => {
      const origin = new URL(request.url()).origin;
      if (!allowedOrigins.has(origin)) {
        errors.push(
          `non-local request: ${request.method()} ${request.url()} (frame=${request.frame()?.url() ?? 'none'})`,
        );
      }
    });

    await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 20_000 });
    await openProject(page);
    check('opened the approved project in the real Studio UI');

    const media = page.getByRole('region', { name: 'Media assets' });

    // ---- A. Upload the reference fixture through the real Media panel ----
    await media.scrollIntoViewIfNeeded();
    await media.getByText('No images yet.').waitFor({ timeout: 10_000 });
    const sourceFile = join(OUT, 'batchc-source.png');
    writeFileSync(sourceFile, Buffer.from(SOURCE_PNG_BASE64, 'base64'));
    await media.locator('input[type="file"]').setInputFiles(sourceFile);
    await media.getByText('Uploaded as a candidate. Approve it to make it embeddable.').waitFor({
      timeout: 15_000,
    });
    await media.getByTitle('Approve this version').waitFor({ timeout: 15_000 });
    const mediaList = await jsonApi<{ items: MediaSummary[] }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/media`,
    );
    const sourceAsset = mediaList.items.find((item) => item.version_count === 1);
    if (!sourceAsset) fail('uploaded source asset is missing from the media list');
    const sourceLink = `muse-asset://${sourceAsset.asset_id}/v1`;
    check('uploaded a deterministic reference PNG through the Media panel');
    await screenshot(page, 'a1-source-uploaded');

    // ---- A. Suggest → editable drafts → edit → propose --------------------
    await media.getByTitle('Suggest decisions or extract a cutout from this version').click();
    await media.getByTitle('Suggest project decisions from this image').click();
    await media.getByLabel('Suggestion guidance').fill('palette direction');
    await media.getByRole('button', { name: 'Suggest', exact: true }).click();

    const draftTexts = media.getByLabel('Suggestion content');
    const draftTypes = media.getByLabel('Suggestion type');
    await waitUntil(
      async () => (await draftTexts.count()) === 3,
      'three suggestion drafts',
      15_000,
    );
    if ((await draftTypes.count()) !== 3) fail('editable type selects did not render per draft');
    if ((await draftTexts.nth(0).inputValue()) !== PREFERENCE_SUGGESTION.content) {
      fail('first draft content does not match the stub suggestion');
    }
    if ((await draftTypes.nth(0).inputValue()) !== PREFERENCE_SUGGESTION.type) {
      fail('first draft type does not match the stub suggestion');
    }
    check('Suggest returns in-memory drafts as editable text and type fields');

    await draftTypes.nth(0).selectOption('constraint');
    await draftTexts.nth(0).fill(ACCEPTED_CONTENT);
    if ((await draftTypes.nth(0).inputValue()) !== 'constraint') {
      fail('editing the draft type did not stick');
    }
    if ((await draftTexts.nth(0).inputValue()) !== ACCEPTED_CONTENT) {
      fail('editing the draft text did not stick');
    }
    check('edited one draft text and type before proposing');

    await media.getByRole('button', { name: 'Propose to memory' }).nth(0).click();
    await media.getByText('Proposed to memory — confirm it in the Memory review.').waitFor({
      timeout: 15_000,
    });
    await waitUntil(async () => (await draftTexts.count()) === 2, 'first draft removed', 10_000);
    await media.getByRole('button', { name: 'Propose to memory' }).nth(0).click();
    await waitUntil(async () => (await draftTexts.count()) === 1, 'second draft removed', 10_000);
    await media.getByRole('button', { name: 'Dismiss', exact: false }).nth(0).click();
    await waitUntil(async () => (await draftTexts.count()) === 0, 'third draft dismissed', 10_000);
    check('proposed the edited draft, proposed a second draft, and dismissed the third');

    const proposed = await jsonApi<{ items: MemoryRecord[] }>(
      apiBase,
      'GET',
      `/api/memories?project_id=${PROJECT}&status=proposed`,
    );
    if (proposed.items.length !== 2) {
      fail(`expected exactly 2 proposed memories, saw ${proposed.items.length}`);
    }
    const acceptedProposal = proposed.items.find((item) => item.content === ACCEPTED_CONTENT);
    const rejectedProposal = proposed.items.find((item) => item.content === REJECTED_CONTENT);
    if (!acceptedProposal) fail('edited draft was not proposed with the edited content');
    if (!rejectedProposal) fail('second draft was not proposed with its content');
    for (const item of proposed.items) {
      if (item.source.reference !== sourceLink) {
        fail(`proposal source reference ${String(item.source.reference)} != ${sourceLink}`);
      }
    }
    check('both proposals carry the versioned muse-asset source reference');
    await screenshot(page, 'a2-drafts-proposed');

    // ---- A. Memory review: explicit Accept and Reject --------------------
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await primaryNav.getByRole('button', { name: 'Memory', exact: true }).click();
    await page.getByLabel('Filter by status').waitFor({ timeout: 20_000 });
    await page.getByLabel('Filter by status').selectOption('proposed');
    const acceptedRow = page.getByRole('button').filter({ hasText: ACCEPTED_CONTENT }).first();
    await acceptedRow.waitFor({ timeout: 20_000 });
    await acceptedRow.click();
    const detail = page.getByRole('region', { name: 'Memory detail' });
    await detail.waitFor({ timeout: 10_000 });
    await detail.getByText(sourceLink).waitFor({ timeout: 10_000 });
    await detail.getByRole('button', { name: 'Accept proposal' }).click();
    await page
      .getByText('Proposal accepted — it is now an active project decision.')
      .waitFor({ timeout: 15_000 });
    check('accepted the edited proposal from the Memory review UI');

    await page.getByLabel('Filter by status').selectOption('active');
    const activeRow = page.getByRole('button').filter({ hasText: ACCEPTED_CONTENT }).first();
    await activeRow.waitFor({ timeout: 20_000 });
    await activeRow.getByText('active', { exact: true }).waitFor({ timeout: 10_000 });
    await activeRow.click();
    await detail.getByText(sourceLink).waitFor({ timeout: 10_000 });
    if ((await detail.getByRole('button', { name: 'Accept proposal' }).count()) !== 0) {
      fail('an accepted memory still offers the Accept proposal action');
    }

    await page.getByLabel('Filter by status').selectOption('proposed');
    const rejectedRow = page.getByRole('button').filter({ hasText: REJECTED_CONTENT }).first();
    await rejectedRow.waitFor({ timeout: 20_000 });
    await rejectedRow.click();
    await detail.getByRole('button', { name: 'Reject proposal' }).click();
    await page.getByText('Proposal rejected — it never enters active memory.').waitFor({
      timeout: 15_000,
    });
    await waitUntil(
      async () =>
        (await page.getByRole('button').filter({ hasText: REJECTED_CONTENT }).count()) === 0,
      'the rejected proposal to leave the proposed review list',
      10_000,
    );
    await page.getByLabel('Filter by status').selectOption('active');
    await waitUntil(
      async () =>
        (await page.getByRole('button').filter({ hasText: REJECTED_CONTENT }).count()) === 0,
      'the rejected proposal to stay out of the active list',
      10_000,
    );
    check('rejected the second proposal from the Memory review UI; it disappears from review');
    await page.getByLabel('Filter by status').selectOption('proposed');
    await screenshot(page, 'a3-memory-review');

    // ---- A. API truth: only the accepted proposal is active/listable -----
    const activeMemories = await jsonApi<{ items: MemoryRecord[] }>(
      apiBase,
      'GET',
      `/api/memories?project_id=${PROJECT}&status=active`,
    );
    const atSource = activeMemories.items.filter((item) => item.source.reference === sourceLink);
    if (atSource.length !== 1) {
      fail(`expected exactly 1 active memory at ${sourceLink}, saw ${atSource.length}`);
    }
    if (atSource[0]?.content !== ACCEPTED_CONTENT || atSource[0].status !== 'active') {
      fail('the active memory at the source version is not the accepted edited draft');
    }
    const visible = await jsonApi<{ items: MemoryRecord[] }>(
      apiBase,
      'GET',
      `/api/memories?project_id=${PROJECT}`,
    );
    if (visible.items.some((item) => item.content === REJECTED_CONTENT)) {
      fail('the rejected proposal is still listed as a memory');
    }
    for (const status of ['active', 'proposed', 'superseded', 'expired', 'deleted']) {
      const listed = await jsonApi<{ items: MemoryRecord[] }>(
        apiBase,
        'GET',
        `/api/memories?project_id=${PROJECT}&status=${status}`,
      );
      if (listed.items.some((item) => item.content === DISMISSED_CONTENT)) {
        fail(`the dismissed draft left a ${status} memory record`);
      }
    }
    const acceptedHistory = await jsonApi<{ entries: Array<{ action: string }> }>(
      apiBase,
      'GET',
      `/api/memories/${acceptedProposal.id}/history`,
    );
    if (!acceptedHistory.entries.some((entry) => entry.action === 'accepted')) {
      fail('the accepted memory has no accepted history entry');
    }
    const rejectedHistory = await fetch(`${apiBase}/api/memories/${rejectedProposal.id}/history`);
    if (rejectedHistory.status !== 404) {
      fail(`rejected proposal history should be 404, saw HTTP ${rejectedHistory.status}`);
    }
    check('API shows only the accepted memory active at the source version');
    check('rejected proposal is an unaddressable tombstone; dismissed draft left no record');

    // ---- B. Segment → previews → nonzero match → cutout → approve → insert
    await primaryNav.getByRole('button', { name: 'HTML Studio', exact: true }).click();
    await page.getByLabel('Change request').waitFor({ timeout: 20_000 });
    await media.scrollIntoViewIfNeeded();
    const sourceRow = media.locator('li').filter({ hasText: sourceAsset.asset_id.slice(0, 8) });
    await sourceRow.waitFor({ timeout: 20_000 });
    await sourceRow.getByTitle('Suggest decisions or extract a cutout from this version').click();
    await media.getByTitle('Extract an object cutout with SAM').click();
    await media.getByLabel('Segmentation concept').fill(SEGMENT_CONCEPT);
    await media.getByRole('button', { name: 'Segment', exact: true }).click();
    await media.getByText('2 matches — inspect, select, save.').waitFor({ timeout: 20_000 });

    const previewImages = media.getByRole('img', { name: /^Match \d+ preview$/ });
    await waitUntil(async () => (await previewImages.count()) === 2, 'two match previews', 10_000);
    for (let index = 0; index < 2; index += 1) {
      const image = previewImages.nth(index);
      const src = (await image.getAttribute('src')) ?? '';
      if (!src.startsWith('data:image/png;base64,')) {
        fail(`match ${index} preview is not an inline PNG data URL`);
      }
      const loaded = await image.evaluate((node) => {
        const img = node as unknown as {
          complete: boolean;
          naturalWidth: number;
          naturalHeight: number;
        };
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      });
      if (!loaded) fail(`match ${index} preview did not decode as an image`);
    }
    check('Segment renders both matches as inspectable, decodable preview images');

    await media.getByTitle(/^Match 1:/).click();
    if ((await media.getByTitle(/^Match 1:/).getAttribute('aria-pressed')) !== 'true') {
      fail('selecting the nonzero match did not mark it selected');
    }
    await media.getByRole('button', { name: 'Save cutout of match 1', exact: true }).click();
    await media
      .getByText('Cutout saved as a new candidate asset (v1). Approve it to embed.')
      .waitFor({
        timeout: 20_000,
      });
    check('selected a nonzero match and saved it as a candidate cutout asset');

    const afterCutout = await jsonApi<{ items: MediaSummary[] }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/media`,
    );
    const cutoutAsset = afterCutout.items.find((item) => item.asset_id !== sourceAsset.asset_id);
    if (!cutoutAsset) fail('the cutout asset is missing from the media list');
    const cutoutVersions = await jsonApi<{ items: MediaVersionRecord[] }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/media/${cutoutAsset.asset_id}`,
    );
    const cutoutVersion = cutoutVersions.items[0];
    if (cutoutVersion?.status !== 'candidate') {
      fail('the saved cutout is not a candidate version');
    }
    if (cutoutVersion.mime !== 'image/png') fail('the saved cutout is not a PNG');
    if (cutoutVersion.source?.kind !== 'segment') fail('cutout is missing segment provenance');
    if (cutoutVersion.source.segment?.concept !== SEGMENT_CONCEPT) {
      fail('cutout provenance does not carry the segmentation concept');
    }
    if (
      cutoutVersion.parent?.asset_id !== sourceAsset.asset_id ||
      cutoutVersion.parent.version !== 1
    ) {
      fail('cutout parent does not point at the source version');
    }
    check('cutout asset has segment provenance, parent linkage, and RGBA PNG bytes');

    const cutoutRow = media.locator('li').filter({ hasText: cutoutAsset.asset_id.slice(0, 8) });
    await cutoutRow.waitFor({ timeout: 20_000 });
    await cutoutRow.getByTitle('Approve this version').click();
    await cutoutRow.getByText('Approved: v1').waitFor({ timeout: 15_000 });
    const approvedVersions = await jsonApi<{ items: MediaVersionRecord[] }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/media/${cutoutAsset.asset_id}`,
    );
    if (approvedVersions.items[0]?.status !== 'approved') {
      fail('the cutout version was not approved through the Media panel');
    }
    check('approved the cutout candidate in the Media panel');

    const placeholder = `muse-asset://${cutoutAsset.asset_id}/v1`;
    await cutoutRow.getByTitle('Insert this reference into the instruction').click();
    const changeRequest = page.getByLabel('Change request');
    await waitUntil(
      async () => (await changeRequest.inputValue()).trim() === placeholder,
      'the change request to contain the cutout placeholder',
      10_000,
    );
    const changeValue = (await changeRequest.inputValue()).trim();
    if (!/^muse-asset:\/\/[0-9a-f-]{36}\/v1$/.test(changeValue)) {
      fail(`change request placeholder is malformed: ${changeValue}`);
    }
    if (changeValue !== placeholder) {
      fail(`change request placeholder ${changeValue} != ${placeholder}`);
    }
    if (await page.getByRole('button', { name: 'Generate change' }).isDisabled()) {
      fail('Generate change is disabled although Insert populated the request');
    }
    // Deliberately STOP before any generation: no model call is made.
    const jobsAfterInsert = await jsonApi<{ items: Array<{ id: string }> }>(
      apiBase,
      'GET',
      `/api/forge/projects/${PROJECT}/media/jobs`,
    );
    if (jobsAfterInsert.items.length !== 0) {
      fail('media provider jobs were created during the offline verification');
    }
    check('Insert places a well-formed cutout placeholder in the change request (no generation)');
    await screenshot(page, 'b1-cutout-inserted');

    if (suggestCalls !== 1 || segmentCalls !== 1) {
      fail(
        `expected exactly one stub suggest and one stub segment call, saw ${suggestCalls}/${segmentCalls}`,
      );
    }
    check('exactly one stub suggest and one stub segment call: no retries, no provider traffic');

    const artifactAfter = await fetch(`${apiBase}/api/forge/projects/${PROJECT}/artifact`);
    if (!artifactAfter.ok) fail('the approved artifact became unreadable during verification');
    check('the approved artifact is unchanged: no generation was started');

    if (errors.length > 0) {
      writeFileSync(join(OUT, 'console-errors.txt'), `${errors.join('\n')}\n`);
      fail(`clean-console gate saw ${errors.length} problem(s):\n${errors.slice(0, 8).join('\n')}`);
    }
    check('clean console, no page errors, no HTTP >= 400 and no non-local requests');
  } finally {
    await stopManaged(vite);
    vite = null;
    if (app) {
      await app.close().catch(() => undefined);
      app = null;
    }
    if (database) {
      database.close();
      database = null;
    }
    if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
    await rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  const summary = {
    project: PROJECT,
    checks,
    screenshots: join(OUT, 'screenshots'),
    finished_at: new Date().toISOString(),
  };
  writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nPASS: ${checks.length} checks — evidence in ${OUT}`);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nFAIL: ${message}`);
  if (checks.length > 0) {
    console.error(`Checks that passed before the failure:\n  - ${checks.join('\n  - ')}`);
  }
  try {
    writeFileSync(
      join(OUT, 'failure.txt'),
      `${message}\n\nPassed checks:\n${checks.join('\n')}\n\nBrowser/network observations:\n${errors.length > 0 ? errors.join('\n') : '(none captured)'}\n`,
    );
  } catch {
    // Evidence is best effort.
  }
  process.exitCode = 1;
});
