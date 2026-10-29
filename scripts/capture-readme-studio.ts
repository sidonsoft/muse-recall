/**
 * README hero — current merged HTML Studio.
 *
 * Captures the approved Studio surface at 1600x1000 for the README. The exact
 * bytes of the recorded Phase 12 condition-C v2 game are transported through
 * the repository's fake-Muse fixture; validation, Decision Guard, the managed
 * Chromium load check, approval and version persistence are the production
 * API/UI path. No live model call is made.
 *
 * The screenshot is the real merged web client talking to the real Fastify API
 * against a disposable database and workspace. It is not a mockup.
 *
 *   pnpm exec tsx scripts/capture-readme-studio.ts
 *
 * Writes only:
 *   docs/assets/readme-2026-10-29/studio-approved.png
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { MemoryEngine, openDatabase } from '../packages/memory-engine/src/index.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import {
  CHILD_SAFETY_DECISION,
  DEMO_PROJECT_ID,
  OCEAN_DECISION,
  SUNSET_DECISION,
  seedForgeDemo,
} from './lib/demo-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'docs/assets/readme-2026-10-29/studio-approved.png');
const AUTHENTIC_V2 = join(ROOT, 'docs/hackathon-evidence/phase12/C-v2.html');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const PROJECT = DEMO_PROJECT_ID;
const PROJECT_NAME = 'Farmyard Memory Match';
const CHANGE_REQUEST = "Apply the project's cool ocean palette to the memory game.";
const VIEWPORT = { width: 1600, height: 1000 } as const;
const RESERVED_PORTS = new Set([4173, 5173, 5201, 5218, 8787, 8798, 8901, 8908]);

interface ChildHandle {
  label: string;
  child: ChildProcess;
  lines: string[];
}

const children: ChildHandle[] = [];

function remember(handle: ChildHandle, chunk: Buffer): void {
  for (const line of chunk.toString().split('\n')) {
    if (line.trim().length === 0) continue;
    handle.lines.push(line.slice(0, 500));
    if (handle.lines.length > 120) handle.lines.shift();
  }
}

function start(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildHandle {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const handle: ChildHandle = { label, child, lines: [] };
  child.stdout?.on('data', (chunk: Buffer) => remember(handle, chunk));
  child.stderr?.on('data', (chunk: Buffer) => remember(handle, chunk));
  children.push(handle);
  return handle;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address !== 'object') {
          server.close();
          reject(new Error('could not read an ephemeral port'));
          return;
        }
        const chosen = address.port;
        server.close(() => resolve(chosen));
      });
    });
    if (!RESERVED_PORTS.has(port)) return port;
  }
  throw new Error('could not allocate a non-reserved free port');
}

function tailOf(handle: ChildHandle): string {
  return handle.lines.slice(-20).join('\n');
}

async function waitFor(
  url: string,
  label: string,
  handles: ChildHandle[],
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const handle of handles) {
      if (handle.child.exitCode !== null) {
        throw new Error(
          `${label} did not start: ${handle.label} exited ${handle.child.exitCode}.\n${tailOf(handle)}`,
        );
      }
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await delay(200);
  }
  const details = handles.map((handle) => `${handle.label}:\n${tailOf(handle)}`).join('\n');
  throw new Error(`${label} did not start at ${url}.\n${details}`);
}

async function stop(handle: ChildHandle): Promise<void> {
  const { child } = handle;
  const index = children.indexOf(handle);
  if (index >= 0) children.splice(index, 1);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  const exited = new Promise<boolean>((resolve) => {
    child.once('exit', () => resolve(true));
    setTimeout(() => resolve(false), 4_000);
  });
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
  if (await exited) return;

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(2_000),
  ]);
}

async function stopAll(): Promise<void> {
  for (const handle of children.splice(0)) {
    await stop(handle);
  }
}

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

async function verifyUi(page: Page): Promise<void> {
  await page.getByRole('heading', { name: PROJECT_NAME }).first().waitFor({ timeout: 20_000 });
  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  const bodyLower = body.toLowerCase();
  assertIncludes(body, `${PROJECT} · index.html`, 'Studio header');
  assertIncludes(body, 'v2 approved', 'approval chip');
  assertIncludes(body, 'No staged change', 'review state');
  assertIncludes(body, 'Decision Guard — Advisory', 'Guard panel');
  assertIncludes(body, 'NOT EVALUATED', 'Guard state');
  assertIncludes(bodyLower, 'version history', 'version history');
  assertIncludes(body, 'Demo baseline', 'v1 history');
  assertIncludes(body, "Apply the project's cool ocean palette", 'v2 history');
  assertIncludes(body, 'Project memory', 'project memory');
  assertIncludes(body, CHILD_SAFETY_DECISION.slice(0, 40), 'child-safety decision');
  assertIncludes(body, OCEAN_DECISION.slice(0, 40), 'ocean decision');
  assertIncludes(bodyLower, 'superseded', 'superseded palette');

  if ((await page.locator('.spinner:visible').count()) > 0) {
    throw new Error('a transient spinner is still visible');
  }
  if ((await page.getByRole('button', { name: 'Dismiss message' }).count()) > 0) {
    throw new Error('a transient notice is still visible');
  }
}

async function main(): Promise<void> {
  await mkdir(dirname(OUTPUT), { recursive: true });
  const authentic = await readFile(AUTHENTIC_V2);
  const authenticSha256 = createHash('sha256').update(authentic).digest('hex');
  const authenticText = authentic.toString('utf8');

  const root = await mkdtemp(join(tmpdir(), 'readme-studio-'));
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
  let webPort = await freePort();
  while (webPort === apiPort) webPort = await freePort();
  const API = `http://127.0.0.1:${apiPort}`;
  const WEB = `http://127.0.0.1:${webPort}`;

  const apiChild = start(
    'api',
    process.execPath,
    [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'],
    ROOT,
    {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      LOG_LEVEL: 'warn',
      DATABASE_PATH: databasePath,
      WORKSPACE_ROOT: workspaceRoot,
      SQLITE_WAL: 'false',
      // The chat provider is configured for the normal Muse CLI install but is
      // never invoked: this capture only exercises Forge, whose transport is
      // the repository fake below. No live model process is started.
      MODEL_PROVIDER: 'muse-cli',
      MUSE_MODEL: 'muse-spark-1.3',
      TOOLS_ENABLED: 'false',
      FORGE_MUSE_BIN: FIXTURE,
      FAKE_MUSE_MODE: 'copy',
      FAKE_MUSE_HTML: AUTHENTIC_V2,
      CORS_ORIGINS: WEB,
    },
  );
  const webChild = start(
    'web',
    process.execPath,
    [
      join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
      '--port',
      String(webPort),
      '--strictPort',
    ],
    join(ROOT, 'apps/web'),
    { VITE_PROXY_TARGET: API },
  );

  let browser: Browser | null = null;
  try {
    await waitFor(`${API}/api/health`, 'API', [apiChild]);
    await waitFor(WEB, 'web client', [webChild]);

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

    // Stage the recorded v2 through the production modify path.
    console.log('staging recorded v2 through the fake-Muse transport');
    await page.getByLabel('Change request').fill(CHANGE_REQUEST);
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText('Proposed v2').waitFor({ timeout: 120_000 });
    const guard = page.getByTestId('decision-guard');
    await guard.waitFor({ timeout: 20_000 });
    const guardText = ((await guard.textContent()) ?? '').replace(/\s+/g, ' ');
    // The current Guard abstains on C-v2's warm sun accent (0xFFE08A) even
    // though the recorded change is ocean-led. Record what the merged engine
    // actually says rather than manufacturing a clean pass.
    if (!guardText.includes('NO VIOLATION DETECTED') && !guardText.includes('NOT VERIFIED')) {
      throw new Error(`unexpected staged Guard result: ${guardText.slice(0, 500)}`);
    }
    assertIncludes(guardText, 'Applicable checks', 'staged Guard scope');
    assertIncludes(guardText, 'superseded palette', 'staged Guard palette check');
    if ((await page.getByText('Syntax/structure passed').count()) === 0) {
      throw new Error('the staged v2 did not pass syntax/structure validation');
    }

    // Approve through the real UI: managed Chromium loads the staged bytes
    // before the version becomes current.
    console.log('approving v2 through the real UI and managed browser check');
    await page.getByRole('button', { name: 'Approve & publish v2' }).click();
    await page.getByText(/Approved v2\./).waitFor({ timeout: 120_000 });
    await dismissNotice(page);
    await page.waitForTimeout(500);
    await page.getByText('No staged change').waitFor({ timeout: 30_000 });
    await waitForPreview(page);
    await startGame(page);

    const verified = await verifyApi(API, authenticSha256, authentic.length);
    const html = verified.artifact.html;
    const expectedTitle = /<title>([^<]*)<\/title>/i.exec(authenticText)?.[1];
    if (!expectedTitle || !html.includes(`<title>${expectedTitle}</title>`)) {
      throw new Error('the served artifact lost the recorded title');
    }

    await page.evaluate(() => document.fonts.ready);
    await verifyUi(page);

    await page.screenshot({
      path: OUTPUT,
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
    });

    if (browserErrors.length > 0) {
      throw new Error(`browser errors: ${browserErrors.join(' | ')}`);
    }

    const bytes = await readFile(OUTPUT);
    const signature = bytes.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') throw new Error('output is not a PNG');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
      throw new Error(`screenshot is ${width}x${height}, expected 1600x1000`);
    }
    const info = await stat(OUTPUT);
    if (info.size < 100_000) throw new Error(`screenshot is suspiciously small: ${info.size}`);

    console.log(`wrote ${relative(ROOT, OUTPUT)} (${width}x${height}, ${info.size} bytes)`);
    console.log(`  source: ${relative(ROOT, AUTHENTIC_V2)} sha256 ${authenticSha256}`);
    console.log(
      `  approved v2: sha256 ${verified.artifact.sha256} · versions ${verified.project.state.versions.length} · runtime check passed`,
    );
    console.log(
      `  memories: ${verified.memories.length} (${verified.memories.filter((m) => m.status === 'active').length} active, ${verified.memories.filter((m) => m.status === 'superseded').length} superseded)`,
    );
  } finally {
    if (browser) await browser.close();
    await stopAll();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
