/**
 * Phase 14A — review-UI evidence for the demo.
 *
 * Starts the real Fastify API and the Vite web client against the seeded demo
 * project, then captures the screens the demonstration uses:
 *
 *   - the approved v1 game preview,
 *   - the remembered decisions and the superseded palette history,
 *   - the advisory Decision Guard on a labelled mutation (then rejects it),
 *   - the authentic Phase 12A condition-C modification (approve v2, rollback),
 *   - the authentic A/B/C memory-influence figure.
 *
 *   pnpm evidence:phase14a-ui
 *
 * Requires Google Chrome. No model call: the fake-Muse fixture transports
 * recorded bytes; every validation, runtime check, advisory and promotion is
 * the production code path.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { seedForgeDemo } from './lib/demo-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence/phase14a');
const SHOTS = join(EVIDENCE, 'screenshots');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const MUTATION = join(ROOT, 'docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html');
const AUTHENTIC_C = join(ROOT, 'docs/hackathon-evidence/phase12/C-v2.html');
const API_PORT = 8901;
const WEB_PORT = 5201;
const PROJECT = 'forge-demo';
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const REQUEST = 'Add a Next Level button beneath the Restart button.';

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not start at ${url}`);
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
    setTimeout(resolve, 5_000);
  });
}

async function waitForApiDown(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetch(`${API}/api/live`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API did not stop');
}

async function apiState(): Promise<{ current_version: number | null; can_rollback: boolean }> {
  const response = await fetch(`${API}/api/forge/projects/${PROJECT}`);
  const body = (await response.json()) as {
    data?: { state?: { current_version: number | null; can_rollback: boolean } };
  };
  if (!body.data?.state) throw new Error('project state missing from the API');
  return body.data.state;
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), 'phase14a-ui-'));
  const databasePath = join(root, 'ui.db');
  const workspaceRoot = join(root, 'workspaces');
  const seed = await seedForgeDemo({ workspaceRoot, databasePath });

  let api: ChildProcess | null = null;
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

  api = startApi(MUTATION);
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

  try {
    await waitFor(`${API}/api/health`, 'API');
    await waitFor(WEB, 'web client');

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      const openForge = async () => {
        await page.getByRole('button', { name: /Forge/ }).first().click();
        await page.getByLabel('Forge project id').fill(PROJECT);
        await page.getByRole('button', { name: 'Open project' }).click();
        await page.getByText('approved:').waitFor({ timeout: 20_000 });
      };

      await page.goto(WEB, { waitUntil: 'networkidle', timeout: 45_000 });
      await openForge();
      const frame = page.frameLocator('iframe[title="Game preview"]');
      await frame.locator('canvas').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(SHOTS, '01-forge-v1-preview.png'), fullPage: true });

      // -- Remembered decisions ---------------------------------------
      await page
        .getByRole('button', { name: /Memories/ })
        .first()
        .click();
      await page.getByText('This children’s game must avoid').first().waitFor({ timeout: 20_000 });
      await page.screenshot({ path: join(SHOTS, '02-memories-list.png'), fullPage: true });

      await page.getByText('This children’s game must avoid').first().click();
      await page
        .getByText('Superseded by')
        .first()
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(SHOTS, '03-constraint-detail.png'), fullPage: true });

      await page.getByText('Art direction: maintain a warm sunset palette').first().click();
      await page.getByText('Superseded by').first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const paletteDetail = await page.locator('section[aria-label="Memory detail"]').textContent();
      if (!paletteDetail?.includes('superseded')) {
        throw new Error('the sunset decision is not shown as superseded');
      }
      await page.screenshot({ path: join(SHOTS, '04-palette-supersession.png'), fullPage: true });

      // -- Labelled mutation: advisory finding, then reject -----------
      await openForge();
      await page.getByRole('button', { name: 'Capture preview' }).click();
      await page.locator('img[alt="Captured preview"]').waitFor({ timeout: 30_000 });
      await page.getByLabel('Visual change request').fill(REQUEST);
      await page.getByRole('button', { name: 'Generate change' }).click();
      await page.getByText('Review change').waitFor({ timeout: 120_000 });

      const panel = page.getByTestId('decision-guard');
      await panel.waitFor({ timeout: 30_000 });
      const mutationText = (await panel.textContent()) ?? '';
      if (!mutationText.includes('Decision Guard — Advisory')) {
        throw new Error('advisory heading missing');
      }
      if (!mutationText.includes('Findings do not block approval in this version.')) {
        throw new Error('advisory disclaimer missing');
      }
      if (!mutationText.includes('VIOLATION DETECTED')) {
        throw new Error('the labelled mutation was not flagged');
      }
      if (!mutationText.includes('countdown-mechanics')) {
        throw new Error('the countdown finding is missing');
      }
      if (!mutationText.includes(seed.constraint.id)) {
        throw new Error('the finding does not cite the remembered child-safety decision');
      }
      await panel.screenshot({ path: join(SHOTS, '05-guard-advisory-mutation.png') });
      await page.screenshot({ path: join(SHOTS, '06-review-mutation.png'), fullPage: true });

      await page.getByRole('button', { name: 'Reject' }).click();
      await page.getByText('Change rejected').waitFor({ timeout: 30_000 });
      await page.screenshot({ path: join(SHOTS, '07-rejected-mutation.png'), fullPage: true });
      const afterReject = await apiState();
      if (afterReject.current_version !== 1) {
        throw new Error(
          `rejecting the mutation changed the approved version: ${afterReject.current_version}`,
        );
      }

      // -- Authentic modification: approve, then roll back ------------
      if (!api) throw new Error('API child missing');
      await stop(api);
      await waitForApiDown();
      api = startApi(AUTHENTIC_C);
      children.push(api);
      await waitFor(`${API}/api/health`, 'API (authentic)');

      await page.reload({ waitUntil: 'networkidle', timeout: 45_000 });
      await openForge();
      await frame.locator('canvas').waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Capture preview' }).click();
      await page.locator('img[alt="Captured preview"]').waitFor({ timeout: 30_000 });
      await page.getByLabel('Visual change request').fill(REQUEST);
      await page.getByRole('button', { name: 'Generate change' }).click();
      await page.getByText('Review change').waitFor({ timeout: 120_000 });

      const compliantPanel = page.getByTestId('decision-guard');
      await compliantPanel.waitFor({ timeout: 30_000 });
      const compliantText = (await compliantPanel.textContent()) ?? '';
      if (!compliantText.includes('NO VIOLATION DETECTED')) {
        throw new Error(`the authentic modification was not clean: ${compliantText.slice(0, 400)}`);
      }
      await compliantPanel.screenshot({ path: join(SHOTS, '08-guard-compliant.png') });
      await page.screenshot({ path: join(SHOTS, '08-review-compliant.png'), fullPage: true });

      await page.getByRole('button', { name: 'Approve' }).click();
      await page.getByText('Change approved').waitFor({ timeout: 120_000 });
      const afterApprove = await apiState();
      if (afterApprove.current_version !== 2) {
        throw new Error(`expected v2 after approval, got ${afterApprove.current_version}`);
      }
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, '09-approved-v2.png'), fullPage: true });

      await page.getByRole('button', { name: 'Undo last change' }).click();
      await page.getByText('Restored the previous approved version.').waitFor({ timeout: 30_000 });
      const afterUndo = await apiState();
      if (afterUndo.current_version !== 1 || afterUndo.can_rollback) {
        throw new Error(`rollback did not restore v1: ${JSON.stringify(afterUndo)}`);
      }
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, '10-rolled-back-v1.png'), fullPage: true });

      // -- Authentic A/B/C memory-influence figure --------------------
      await page.goto(`file://${join(EVIDENCE, 'memory-influence.html')}`, {
        waitUntil: 'networkidle',
        timeout: 45_000,
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SHOTS, '11-memory-influence.png'), fullPage: true });

      if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
      const current = await readFile(join(EVIDENCE, 'memory-influence.html'), 'utf8');
      if (!current.includes('authentic model output')) {
        throw new Error('memory-influence figure lost its authenticity label');
      }
      console.log('UI evidence written to', relative(ROOT, SHOTS));
    } finally {
      await browser.close();
    }
  } finally {
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
