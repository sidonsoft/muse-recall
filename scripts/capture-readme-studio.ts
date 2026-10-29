/**
 * README hero — current merged HTML Studio reviewing a staged change.
 *
 * Captures the Studio review surface at 1600x1000 while v2 is staged, so the
 * Decision Guard panel shows the advisory the merged engine actually recorded
 * for that change. The exact bytes of the recorded Phase 12 condition-C v2
 * game are transported through the repository's fake-Muse fixture;
 * validation, Decision Guard, the managed Chromium load check, approval and
 * version persistence are the production API/UI path. After the capture the
 * script approves v2 through the UI and checks the published bytes. No live
 * model call is made, and the chat provider is the offline echo provider.
 *
 * The screenshot is the real merged web client talking to the real Fastify API
 * against a disposable database and workspace. It is not a mockup. The API
 * runs from the disposable directory with a minimal environment, so neither a
 * local `.env` nor exported Muse Recall settings change the capture.
 *
 *   pnpm exec tsx scripts/capture-readme-studio.ts
 *
 * Writes only, and only after every check passes:
 *   docs/assets/readme-2026-10-29/studio-review.png
 *   docs/assets/readme-2026-10-29/SHA256SUMS
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import {
  type ChildHandle,
  captureEnv,
  disposeOnInterrupt,
  freePort,
  once,
  onInterrupt,
  publishCaptures,
  startChild,
  stopChild,
  waitForHttp,
} from './lib/capture.js';
import {
  CHILD_SAFETY_DECISION,
  DEMO_PROJECT_ID,
  OCEAN_DECISION,
  SUNSET_DECISION,
  seedForgeDemo,
} from './lib/demo-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'docs/assets/readme-2026-10-29');
const OUTPUT_NAME = 'studio-review.png';
const AUTHENTIC_V2 = join(ROOT, 'docs/hackathon-evidence/phase12/C-v2.html');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const PROJECT = DEMO_PROJECT_ID;
const PROJECT_NAME = 'Farmyard Memory Match';
const CHANGE_REQUEST = "Apply the project's cool ocean palette to the memory game.";
const VIEWPORT = { width: 1600, height: 1000 } as const;
const GUARD_STATES = ['NO VIOLATION DETECTED', 'NOT VERIFIED'] as const;

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function api<T>(apiBase: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.ok || body.data === undefined) {
    throw new Error(
      `API ${path} failed (${response.status}): ${body.error?.message ?? 'no error detail'}`,
    );
  }
  return body.data;
}

interface ProjectView {
  state: {
    current_version: number | null;
    versions: Array<{
      version: number;
      summary: string;
      base_version?: number | null;
      sha256?: string;
      approval_verification?: { runtime?: { ok: boolean } };
    }>;
    can_rollback: boolean;
  };
}

interface ArtifactView {
  job_id: string | null;
  version: number | null;
  staged: boolean;
  title: string;
  sha256: string;
  html: string;
}

interface MemoryRow {
  id: string;
  status: string;
  content: string;
}

async function verifyApi(apiBase: string, authenticSha256: string, authenticBytes: number) {
  const project = await api<ProjectView>(apiBase, `/api/forge/projects/${PROJECT}`);
  if (project.state.current_version !== 2) {
    throw new Error(`expected approved v2, got ${String(project.state.current_version)}`);
  }
  if (project.state.versions.length !== 2) {
    throw new Error(`expected two versions, got ${project.state.versions.length}`);
  }
  const latest = project.state.versions.find((entry) => entry.version === 2);
  if (!latest) throw new Error('approved v2 is missing from version history');
  if (latest.base_version !== 1) throw new Error(`v2 parent is ${String(latest.base_version)}`);
  if (latest.sha256 !== authenticSha256) {
    throw new Error('approved v2 does not match the authentic recorded source hash');
  }
  if (latest.approval_verification?.runtime?.ok !== true) {
    throw new Error('v2 does not record a passing approval-time runtime check');
  }

  const artifact = await api<ArtifactView>(apiBase, `/api/forge/projects/${PROJECT}/artifact`);
  if (artifact.staged || artifact.version !== 2 || artifact.job_id) {
    throw new Error('the current artifact is not the approved v2');
  }
  if (
    artifact.sha256 !== authenticSha256 ||
    Buffer.byteLength(artifact.html, 'utf8') !== authenticBytes
  ) {
    throw new Error('the served approved artifact drifted from the authentic source');
  }
  if (artifact.title !== 'Farmyard Memory Match') {
    throw new Error(`unexpected artifact title: ${artifact.title}`);
  }

  const memories = await api<{ items: MemoryRow[] }>(
    apiBase,
    `/api/memories?project_id=${PROJECT}&include_global=true&status=active,superseded&limit=50`,
  );
  const byContent = new Map(memories.items.map((memory) => [memory.content, memory.status]));
  if (byContent.get(CHILD_SAFETY_DECISION) !== 'active') {
    throw new Error('the child-safety decision is not active');
  }
  if (byContent.get(OCEAN_DECISION) !== 'active') {
    throw new Error('the ocean-palette decision is not active');
  }
  if (byContent.get(SUNSET_DECISION) !== 'superseded') {
    throw new Error('the sunset-palette decision is not superseded');
  }

  return { project, artifact, memories: memories.items };
}

async function dismissNotice(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss message' });
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    await page.waitForTimeout(200);
  }
}

async function waitForPreview(page: Page): Promise<void> {
  const frame = page.frameLocator('iframe[title="HTML application preview"]');
  await frame.locator('canvas').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(900);
}

async function startGame(page: Page): Promise<void> {
  const canvas = page.frameLocator('iframe[title="HTML application preview"]').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the preview canvas has no layout box');
  // The recorded game's Start control sits at game (450, 465) in a 900x700 canvas.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * (465 / 700));
  await page.waitForTimeout(500);
}

function assertIncludes(text: string, needle: string, label: string): void {
  if (!text.includes(needle)) {
    throw new Error(`${label} is missing ${JSON.stringify(needle)}`);
  }
}

function normalisedText(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ');
}

/** The header must credit the offline chat provider, never a Muse model that did not run. */
async function verifyProviderHeader(page: Page): Promise<void> {
  const header = normalisedText(await page.locator('header').first().textContent());
  assertIncludes(header, 'echo (offline)', 'chat provider label');
  if (/muse-(spark|wonder)/i.test(header)) {
    throw new Error(`the header credits a Muse chat model that never ran: ${header.slice(0, 200)}`);
  }
}

/** Check the staged review state that the README hero shows. */
async function verifyStagedUi(page: Page): Promise<string> {
  await page.getByRole('heading', { name: PROJECT_NAME }).first().waitFor({ timeout: 20_000 });
  const body = normalisedText(await page.locator('body').textContent());
  const bodyLower = body.toLowerCase();
  assertIncludes(body, `${PROJECT} · index.html`, 'Studio header');
  assertIncludes(body, 'v1 approved', 'current version chip');
  assertIncludes(body, 'Proposed v2', 'staged change');
  assertIncludes(body, 'Approve & publish v2', 'approval control');
  assertIncludes(body, 'Decision Guard — Advisory', 'Guard panel');
  assertIncludes(bodyLower, 'version history', 'version history');
  assertIncludes(body, 'Demo baseline', 'v1 history');
  assertIncludes(body, 'Project memory', 'project memory');
  assertIncludes(body, CHILD_SAFETY_DECISION.slice(0, 40), 'child-safety decision');
  assertIncludes(body, OCEAN_DECISION.slice(0, 40), 'ocean decision');
  assertIncludes(bodyLower, 'superseded', 'superseded palette');

  const guardText = normalisedText(await page.getByTestId('decision-guard').textContent());
  const state = GUARD_STATES.find((candidate) => guardText.includes(candidate));
  if (!state) throw new Error(`unexpected staged Guard result: ${guardText.slice(0, 500)}`);
  if (guardText.includes('No advisory snapshot was recorded')) {
    throw new Error('the staged Guard panel shows no recorded advisory');
  }
  assertIncludes(guardText, 'Applicable checks', 'staged Guard scope');
  assertIncludes(guardText, 'superseded palette', 'staged Guard palette check');
  if ((await page.getByText('Syntax/structure passed').count()) === 0) {
    throw new Error('the staged v2 did not pass syntax/structure validation');
  }

  if ((await page.locator('.spinner:visible').count()) > 0) {
    throw new Error('a transient spinner is still visible');
  }
  if ((await page.getByRole('button', { name: 'Dismiss message' }).count()) > 0) {
    throw new Error('a transient notice is still visible');
  }
  return state;
}

async function main(): Promise<void> {
  const children: ChildHandle[] = [];
  let browser: Browser | null = null;
  let root: string | null = null;
  const cleanup = once(async (): Promise<void> => {
    if (browser) await browser.close().catch(() => undefined);
    for (const handle of children.splice(0)) await stopChild(handle);
    if (root) await rm(root, { recursive: true, force: true });
  });
  const removeInterruptHandler = onInterrupt(cleanup);

  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const authentic = await readFile(AUTHENTIC_V2);
    const authenticSha256 = createHash('sha256').update(authentic).digest('hex');
    const authenticText = authentic.toString('utf8');

    root = await mkdtemp(join(tmpdir(), 'readme-studio-'));
    disposeOnInterrupt(root);
    const stagingDir = join(root, 'captures');
    await mkdir(stagingDir);
    const databasePath = join(root, 'studio.db');
    const workspaceRoot = join(root, 'workspaces');

    // The seed helper names the demo project generically. Give this disposable
    // instance the artifact's own name before the seed inserts the project row;
    // ensureProject is insert-only, so the seed then preserves it.
    const database = openDatabase({ path: databasePath, wal: false });
    try {
      new MemoryEngine(database.db).ensureProject(PROJECT, PROJECT_NAME);
    } finally {
      database.close();
    }
    const seed = await seedForgeDemo({ workspaceRoot, databasePath });
    if (seed.version !== 1) throw new Error('the demo seed did not create v1');

    const apiPort = await freePort();
    const webPort = await freePort([apiPort]);
    const API = `http://127.0.0.1:${apiPort}`;
    const WEB = `http://127.0.0.1:${webPort}`;

    // The API runs from the disposable directory, which has no `.env`, with a
    // minimal environment: local settings cannot leak into the capture.
    const apiChild = startChild(
      'api',
      process.execPath,
      [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'apps/server/src/index.ts')],
      {
        cwd: root,
        env: captureEnv({
          NODE_ENV: 'development',
          HOST: '127.0.0.1',
          PORT: String(apiPort),
          LOG_LEVEL: 'warn',
          DATABASE_PATH: databasePath,
          WORKSPACE_ROOT: workspaceRoot,
          SQLITE_WAL: 'false',
          // Chat is never used here. The offline provider keeps the header
          // from crediting a Muse model that did not run.
          MODEL_PROVIDER: 'echo',
          MUSE_MODEL: 'echo-1',
          TOOLS_ENABLED: 'false',
          FORGE_RUNTIME_BROWSER: 'managed',
          FORGE_MUSE_BIN: FIXTURE,
          FAKE_MUSE_MODE: 'copy',
          FAKE_MUSE_HTML: AUTHENTIC_V2,
          CORS_ORIGINS: WEB,
        }),
      },
    );
    children.push(apiChild);
    const webChild = startChild(
      'web',
      process.execPath,
      [
        join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      { cwd: join(ROOT, 'apps/web'), env: captureEnv({ VITE_PROXY_TARGET: API }) },
    );
    children.push(webChild);

    await waitForHttp(`${API}/api/health`, { children: [apiChild] });
    await waitForHttp(WEB, { children: [webChild] });

    const launched = await launchVerificationBrowser();
    browser = launched.browser;
    reportBrowserSelection(launched.selection);
    if (launched.selection.policy !== 'managed') {
      throw new Error(
        'this capture requires managed Playwright Chromium; unset FORGE_RUNTIME_BROWSER=chrome',
      );
    }

    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon/i.test(message.text())) {
        browserErrors.push(`console: ${message.text()}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/')) {
        browserErrors.push(`http ${response.status()}: ${response.url()}`);
      }
    });

    console.log(`opening ${WEB}`);
    await page.goto(WEB, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.getByRole('heading', { name: PROJECT_NAME }).first().waitFor({ timeout: 20_000 });
    await waitForPreview(page);
    if ((await page.getByText('v1 approved').count()) === 0) {
      throw new Error('the seeded v1 is not shown as approved');
    }
    await verifyProviderHeader(page);

    // Stage the recorded v2 through the production modify path.
    console.log('staging recorded v2 through the fake-Muse transport');
    await page.getByLabel('Change request').fill(CHANGE_REQUEST);
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText('Proposed v2').waitFor({ timeout: 120_000 });
    await page.getByTestId('decision-guard').waitFor({ timeout: 20_000 });
    await dismissNotice(page);
    await waitForPreview(page);
    await startGame(page);
    await page.evaluate(() => document.fonts.ready);

    // Capture the review state: this is where the Guard advisory for the
    // change is shown. Once nothing is staged the panel has no advisory.
    const guardState = await verifyStagedUi(page);
    const staged = join(stagingDir, OUTPUT_NAME);
    await page.screenshot({ path: staged, type: 'png', animations: 'disabled', caret: 'hide' });

    // Approve through the real UI: managed Chromium loads the staged bytes
    // before the version becomes current.
    console.log('approving v2 through the real UI and managed browser check');
    await page.getByRole('button', { name: 'Approve & publish v2' }).click();
    await page.getByText(/Approved v2\./).waitFor({ timeout: 120_000 });
    await dismissNotice(page);
    await page.getByText('No staged change').waitFor({ timeout: 30_000 });
    await page.getByText('v2 approved').first().waitFor({ timeout: 30_000 });

    const verified = await verifyApi(API, authenticSha256, authentic.length);
    const expectedTitle = /<title>([^<]*)<\/title>/i.exec(authenticText)?.[1];
    if (!expectedTitle || !verified.artifact.html.includes(`<title>${expectedTitle}</title>`)) {
      throw new Error('the served artifact lost the recorded title');
    }

    if (browserErrors.length > 0) {
      throw new Error(`browser errors: ${browserErrors.join(' | ')}`);
    }

    const hashes = await publishCaptures({
      stagingDir,
      outputDir: OUTPUT_DIR,
      names: [OUTPUT_NAME],
      viewport: VIEWPORT,
      minBytes: 100_000,
    });

    console.log(
      `wrote ${relative(ROOT, join(OUTPUT_DIR, OUTPUT_NAME))} (sha256 ${hashes.get(OUTPUT_NAME)})`,
    );
    console.log(`  staged Guard result: ${guardState}`);
    console.log(`  source: ${relative(ROOT, AUTHENTIC_V2)} sha256 ${authenticSha256}`);
    console.log(
      `  approved v2: sha256 ${verified.artifact.sha256} · versions ${verified.project.state.versions.length} · runtime check passed`,
    );
    console.log(
      `  memories: ${verified.memories.length} (${verified.memories.filter((m) => m.status === 'active').length} active, ${verified.memories.filter((m) => m.status === 'superseded').length} superseded)`,
    );
  } finally {
    removeInterruptHandler();
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
