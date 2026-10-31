/**
 * Scoped live UI smoke for Batch B acceptance (paid calls: 2 image + 2 code).
 *
 * Drives the real Studio in managed Chromium against the live providers:
 *
 *   Media prompt -> Generate (live image) -> approve -> Edit (live) ->
 *   approve v2 -> Insert into the change draft -> real-model modify that
 *   uses the asset -> inspect preview + diff -> approve v1 (real browser
 *   gate, image embedded) -> restart -> second real-model modify -> v2 ->
 *   UI rollback -> v1 bytes and embedded image return together.
 *
 * Code generation runs the real `muse` CLI in Meta API-key mode; image calls
 * reach the live images endpoints. Requires FORGE_MUSE_API_KEY and
 * FORGE_MUSE_BIN (a real CLI) in the environment, plus a Playwright
 * Chromium build. NOT a CI gate: run it when cutting a media release.
 *
 * Usage: FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(which muse) pnpm verify:media-live-smoke
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';

const ROOT = process.cwd();
const PROJECT = `media-smoke-${Date.now().toString(36).slice(-6)}`;
const LONG = 600_000;

const checks: string[] = [];

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function fail(message: string): never {
  throw new Error(`live smoke failed: ${message}`);
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
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Managed {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
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
  if (key.length === 0 || bin.length === 0) {
    console.log('live smoke: unconfigured (need FORGE_MUSE_API_KEY and FORGE_MUSE_BIN)');
    process.exitCode = 2;
    return;
  }
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
  };
  const startApi = (): Managed =>
    start('api', process.execPath, [join(ROOT, 'apps/server/dist/index.js')], {
      cwd: ROOT,
      env: serverEnv,
    });

  let server = startApi();
  let web: Managed | null = null;
  const errors: string[] = [];
  try {
    await waitForHttp(`${apiBase}/api/health`);
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
      { cwd: join(ROOT, 'apps/web'), env: { ...process.env, VITE_PROXY_TARGET: apiBase } },
    );
    await waitForHttp(webBase);
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

    await stepMediaGenerate(page, media);
    await media.getByTitle('Approve this version').click();
    await media.getByText('Approved: v1').waitFor({ timeout: 30_000 });
    check('live-generated image approved as v1');
    await media.getByTitle('Edit this version into a new candidate').click();
    await fillStable(page, 'Image edit prompt', 'change the background to pale yellow');
    await media.getByRole('button', { name: 'Edit', exact: true }).click();
    await media.getByTitle('Approve this version').waitFor({ timeout: LONG });
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
    await waitForHttp(`${apiBase}/api/health`);
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
    console.log(`\nlive smoke: ok (${String(checks.length)} checks)`);
    console.log(`v2 version-HTML sha256: ${v2.versionSha}`);
  } finally {
    await stop(server);
    if (web) await stop(web);
    await browser.close().catch(() => undefined);
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
