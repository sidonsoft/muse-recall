/**
 * Muse Recall — UX evidence capture.
 *
 * Runs the real Fastify API and Vite client against a seeded `forge-demo`
 * project, then captures the surfaces used in the UX audit at the three target
 * viewports. Generation uses the repository's fake-Muse transport so no model
 * inference is required; validation, staging, runtime verification, approval,
 * rejection and rollback are the production code paths.
 *
 * Uses Playwright-managed Chromium by default; FORGE_RUNTIME_BROWSER=chrome is the
 * explicit system-Chrome opt-in. There is no automatic fallback.
 *
 *   pnpm evidence:ux
 *
 * Writes to `docs/ux-evidence/final/`. It never touches the recorded Phase 11–15
 * evidence or the demonstration video.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { seedForgeDemo } from './lib/demo-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/ux-evidence/final');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const MUTATION = join(ROOT, 'docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html');
const AUTHENTIC = join(ROOT, 'docs/hackathon-evidence/phase12/C-v2.html');
const API_PORT = 8908;
const WEB_PORT = 5218;
const PROJECT = 'forge-demo';
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;

const children: ChildProcess[] = [];

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (/error|failed/i.test(text)) process.stdout.write(`[${command}] ${text}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not start at ${url}`);
}

async function waitForApiDown(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(`${API}/api/live`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('API did not stop');
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(resolve, 4_000);
  });
}

async function apiJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`);
  const body = (await response.json()) as { data?: unknown };
  return body.data;
}

async function state(): Promise<{ current_version: number | null; can_rollback: boolean }> {
  const data = (await apiJson(`/api/forge/projects/${PROJECT}`)) as {
    state: { current_version: number | null; can_rollback: boolean };
  };
  return data.state;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  captured ${relative(ROOT, join(OUT, name))}`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), 'muse-recall-ux-'));
  const databasePath = join(root, 'ux.db');
  const workspaceRoot = join(root, 'workspaces');
  await seedForgeDemo({ workspaceRoot, databasePath });

  const startApi = (htmlPath: string) =>
    start(
      process.execPath,
      [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'],
      ROOT,
      {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        DATABASE_PATH: databasePath,
        WORKSPACE_ROOT: workspaceRoot,
        SQLITE_WAL: 'false',
        MODEL_PROVIDER: 'echo',
        TOOLS_ENABLED: 'false',
        FORGE_MUSE_BIN: FIXTURE,
        FAKE_MUSE_MODE: 'copy',
        FAKE_MUSE_HTML: htmlPath,
        CORS_ORIGINS: WEB,
      },
    );

  let api: ChildProcess | null = startApi(MUTATION);
  start(
    process.execPath,
    [
      join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    join(ROOT, 'apps/web'),
    { VITE_PROXY_TARGET: API },
  );

  let browser: Browser | null = null;
  try {
    await waitFor(`${API}/api/health`, 'API');
    await waitFor(WEB, 'web client');

    const launched = await launchVerificationBrowser();
    browser = launched.browser;
    reportBrowserSelection(launched.selection);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    let offlineExpected = false;
    page.on('pageerror', (error) => {
      if (!offlineExpected) errors.push(error.message);
    });
    page.on('console', (message) => {
      if (offlineExpected) return;
      if (message.type() === 'error' && !/favicon/i.test(message.text())) {
        errors.push(message.text());
      }
    });

    const openStudio = async () => {
      await page.getByRole('button', { name: 'HTML Studio' }).click();
      await page
        .getByRole('heading', { name: 'Farmyard Memory Match' })
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(900);
    };

    const waitForPreview = async () => {
      await page.waitForTimeout(2_000);
      const iframeCount = await page.locator('iframe').count();
      if (iframeCount === 0) {
        console.error('no preview iframe', {
          text: ((await page.locator('body').textContent()) ?? '').slice(0, 1_500),
          frames: page.frames().map((entry) => entry.url()),
          state: await state(),
        });
        await page.screenshot({ path: join(OUT, 'debug-preview-failure.png') });
        throw new Error('no preview iframe rendered');
      }
      await page.frameLocator('iframe').locator('canvas').waitFor({
        timeout: 45_000,
      });
      await page.waitForTimeout(700);
    };

    console.log('approved state');
    await page.goto(WEB, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.getByRole('heading', { name: 'Farmyard Memory Match' }).waitFor({ timeout: 20_000 });
    await waitForPreview();
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await shot(page, `studio-approved-${viewport.width}x${viewport.height}.png`);
    }

    console.log('source inspection');
    await page.getByRole('tab', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'Copy source' }).waitFor({ timeout: 20_000 });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await shot(page, `studio-source-${viewport.width}x${viewport.height}.png`);
    }

    console.log('memory');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Memory', exact: true }).click();
      await page.locator('section[aria-label="Memory detail"]').waitFor({ timeout: 20_000 });
      await shot(page, `memory-${viewport.width}x${viewport.height}.png`);
    }

    console.log('system');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await page.getByText('API service').waitFor({ timeout: 20_000 });
      await shot(page, `system-${viewport.width}x${viewport.height}.png`);
    }

    console.log('staged review with a Decision Guard finding');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStudio();
    await page.getByLabel('Change request').fill('Add a countdown timer and a Next Level button.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Proposed v/).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1_000);
    const guard = page.getByTestId('decision-guard');
    await guard.waitFor({ timeout: 20_000 });
    const guardText = (await guard.textContent()) ?? '';
    if (!guardText.includes('VIOLATION DETECTED')) throw new Error('expected a guard finding');
    if (!guardText.includes('countdown-mechanics')) throw new Error('expected the countdown rule');
    if (!guardText.includes('Findings do not block approval in this version.')) {
      throw new Error('the advisory disclaimer is missing');
    }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await shot(page, `studio-staged-${viewport.width}x${viewport.height}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('tab', { name: /Changes/ }).click();
    await page.getByText('large rewrite').first().waitFor({ timeout: 10_000 });
    await shot(page, 'studio-diff-1440x900.png');
    await page.setViewportSize({ width: 1280, height: 720 });
    await shot(page, 'studio-diff-1280x720.png');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByText('Change rejected').waitFor({ timeout: 30_000 });
    const afterReject = await state();
    if (afterReject.current_version !== 1) {
      throw new Error(
        `rejecting the staged change altered the approved version: ${afterReject.current_version}`,
      );
    }
    await shot(page, 'studio-rejected-1440x900.png');

    console.log('authentic modification: approve, then roll back');
    if (!api) throw new Error('API child missing');
    await stop(api);
    await waitForApiDown();
    api = startApi(AUTHENTIC);
    await waitFor(`${API}/api/health`, 'API (authentic)');
    await page.reload({ waitUntil: 'networkidle', timeout: 45_000 });
    await openStudio();
    await waitForPreview();
    await page
      .getByLabel('Change request')
      .fill('Add a Next Level button beneath the Restart button.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Proposed v/).waitFor({ timeout: 120_000 });
    const cleanGuard = (await page.getByTestId('decision-guard').textContent()) ?? '';
    if (!cleanGuard.includes('NO VIOLATION DETECTED')) {
      throw new Error(`the authentic change was not clean: ${cleanGuard.slice(0, 300)}`);
    }
    await shot(page, 'studio-staged-clean-1440x900.png');

    await page.getByRole('checkbox', { name: /Remember this decision/ }).check();
    await page
      .getByLabel('Decision note')
      .fill('Keep the ocean palette and the Next Level button.');
    await page.getByRole('button', { name: /Approve & publish v/ }).click();
    await page.getByText('Approved v2').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1_200);
    const afterApprove = await state();
    if (afterApprove.current_version !== 2) {
      throw new Error(`expected v2 after approval, got ${afterApprove.current_version}`);
    }
    await shot(page, 'studio-approved-v2-1440x900.png');

    console.log('download');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download HTML' }).click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('the browser did not produce a download');
    const downloaded = await readFile(downloadPath, 'utf8');
    if (!downloaded.includes('<!DOCTYPE html>') && !downloaded.includes('<!doctype html>')) {
      throw new Error('the exported HTML is not a document');
    }
    if (!downloaded.includes('Next Level')) throw new Error('the export is not the approved v2');

    console.log('rollback');
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByText('Restore v1 as the current version?').waitFor({ timeout: 10_000 });
    await shot(page, 'studio-rollback-confirm-1440x900.png');
    await page.getByRole('button', { name: 'Restore v1' }).click();
    await page.getByText('Restored v1').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const afterRollback = await state();
    if (afterRollback.current_version !== 1) {
      throw new Error(`rollback did not restore v1: ${afterRollback.current_version}`);
    }
    await shot(page, 'studio-rolled-back-1440x900.png');

    console.log('memory after approval');
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await page.locator('section[aria-label="Memory detail"]').waitFor({ timeout: 20_000 });
    await shot(page, 'memory-after-approval-1440x900.png');

    console.log('offline error state');
    offlineExpected = true;
    if (!api) throw new Error('API child missing');
    await stop(api);
    api = null;
    await waitForApiDown();
    await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Muse Recall cannot reach its local API').waitFor({ timeout: 20_000 });
    await shot(page, 'error-offline-1440x900.png');

    if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log('UX evidence written to', relative(ROOT, OUT));
  } finally {
    if (browser) await browser.close();
    for (const child of children.splice(0)) {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
