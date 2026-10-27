/**
 * Phase 12E — review-UI evidence.
 *
 * Starts the real Fastify API and the Vite web client, seeds an authentic
 * decision, generates the controlled violation source through the production
 * Forge pipeline, and captures the advisory review panel and the approval.
 * Asserts the v1.2.0 assessment wording and that the panel never claims PASS
 * or complete compliance while findings/unverified entries exist.
 *
 *   pnpm evidence:guard-ui
 *
 * Requires Google Chrome (playwright-core). No model call: the fake-Muse
 * fixture only transports the labelled Phase 12C mutation into staging.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/hackathon-evidence/phase12e');
const SHOTS = join(EVIDENCE, 'screenshots');
const SOURCE = join(EVIDENCE, 'sources/A-violation-mutation.html');
const FIXTURE = join(ROOT, 'tests/fixtures/fake-muse.mjs');
const API_PORT = 8899;
const WEB_PORT = 5199;
const PROJECT = 'phase12e-ui';
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

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

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const source = await readFile(SOURCE, 'utf8');
  if (!source.includes('PHASE 12C TEST MUTATION')) {
    throw new Error('the violation source is not labelled as a test mutation');
  }

  const root = await mkdtemp(join(tmpdir(), 'phase12e-ui-'));
  start(
    process.execPath,
    [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'],
    ROOT,
    {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(API_PORT),
      LOG_LEVEL: 'warn',
      DATABASE_PATH: join(root, 'ui.db'),
      WORKSPACE_ROOT: join(root, 'workspaces'),
      SQLITE_WAL: 'false',
      MODEL_PROVIDER: 'echo',
      TOOLS_ENABLED: 'false',
      FORGE_MUSE_BIN: FIXTURE,
      FAKE_MUSE_MODE: 'copy',
      FAKE_MUSE_HTML: SOURCE,
      CORS_ORIGINS: WEB,
    },
  );
  start(
    process.execPath,
    [
      join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    join(ROOT, 'apps/web'),
    {
      VITE_PROXY_TARGET: API,
    },
  );

  try {
    await waitFor(`${API}/api/health`, 'API');
    await waitFor(WEB, 'web client');

    const created = await postJson(`${API}/api/memories`, {
      type: 'constraint',
      scope: 'project',
      project_id: PROJECT,
      content:
        'This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.',
      confidence: 0.95,
      validation_status: 'verified',
      tags: ['phase12e'],
      source: { session_id: null, reference: 'phase12e-ui-evidence' },
    });
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`seeding decision failed: ${created.status} ${await created.text()}`);
    }

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(WEB, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.getByRole('button', { name: /Forge/ }).first().click();
      await page.getByLabel('Forge project id').fill(PROJECT);
      await page.getByRole('button', { name: 'Open project' }).click();
      await page.getByText('approved:').waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Generate game' }).click();
      await page.getByText('Review change').waitFor({ timeout: 90_000 });

      const panel = page.getByTestId('decision-guard');
      await panel.waitFor({ timeout: 30_000 });
      const text = (await panel.textContent()) ?? '';
      if (!text.includes('Decision Guard — Advisory')) {
        throw new Error('review panel is missing the advisory heading');
      }
      if (!text.includes('Findings do not block approval in this version.')) {
        throw new Error('review panel is missing the advisory disclaimer');
      }
      if (!text.includes('countdown-mechanics')) {
        throw new Error('review panel did not render the expected finding');
      }
      if (!text.includes('VIOLATION DETECTED')) {
        throw new Error('review panel did not render the detected-violation assessment');
      }
      if (!text.includes('Supported checks only')) {
        throw new Error('review panel is missing the supported-checks scope note');
      }
      if (text.includes('PASS')) {
        throw new Error('review panel claimed PASS while findings/unverified entries exist');
      }
      if (text.includes('compliant')) {
        throw new Error('review panel claimed compliance while findings/unverified entries exist');
      }
      await panel.screenshot({ path: join(SHOTS, 'ui-decision-guard-advisory.png') });
      await page.screenshot({ path: join(SHOTS, 'ui-review-page.png'), fullPage: true });

      // Approval must still work while advisory findings are present.
      await page.getByRole('button', { name: 'Approve' }).click();
      await page.getByText('Change approved').waitFor({ timeout: 90_000 });
      await page.screenshot({ path: join(SHOTS, 'ui-approved-with-findings.png'), fullPage: true });

      const state = await fetch(`${API}/api/forge/projects/${PROJECT}`).then((response) =>
        response.json(),
      );
      if (state.data?.state?.current_version !== 1) {
        throw new Error(`expected approved version 1, got ${JSON.stringify(state.data?.state)}`);
      }
      if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
      console.log('UI evidence written to', relative(ROOT, SHOTS));
    } finally {
      await browser.close();
    }
  } finally {
    for (const child of children.splice(0)) {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

await main();
