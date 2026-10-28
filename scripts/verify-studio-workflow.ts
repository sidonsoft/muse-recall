/**
 * Managed browser workflow for the local beta.
 *
 * Starts a disposable API (deterministic fake Muse CLI, no paid calls), serves
 * the production web build with Vite preview, and drives the real Studio:
 *
 *   generation → staged review → approval → modification → rejection →
 *   second approval → rollback → staged change survives a server restart →
 *   approval after restart
 *
 * Form entry and keyboard activation (Enter / Ctrl+Enter) are exercised.
 * Screenshots and logs go to `test-results/`, never to historical evidence.
 *
 * Requirements: `pnpm build` first, and a Playwright Chromium build
 * (`pnpm exec playwright-core install chromium`). Playwright-managed Chromium
 * is the default; set FORGE_RUNTIME_BROWSER=chrome only for an explicit
 * system-Chrome run. There is no automatic fallback.
 *
 * Verification levels are printed at the end. This is automated interaction
 * coverage, not human design review.
 *
 *   pnpm verify:studio-workflow
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright-core';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'test-results', 'studio-after');
const PROJECT = `studio-workflow-${Date.now().toString(36).slice(-6)}`;
const LONG = 120_000;

interface Managed {
  child: ChildProcess;
  name: string;
  log: string;
  tail: string;
}

const managed: Managed[] = [];
const checks: string[] = [];

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function logPath(name: string): string {
  return join(OUT, `${name}.log`);
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
    // A process group lets us stop Vite and its child processes together.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const item: Managed = { child, name, log: logPath(name), tail: '' };
  const append = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    item.tail = `${item.tail}${text}`.slice(-8_000);
    try {
      writeFileSync(item.log, text, { flag: 'a' });
    } catch {
      // Logging must never mask the test result.
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error) => append(Buffer.from(`spawn error: ${error.message}\n`)));
  managed.push(item);
  return item;
}

async function stop(item: Managed): Promise<void> {
  const pid = item.child.pid;
  if (item.child.exitCode !== null || pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        item.child.kill('SIGKILL');
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
      item.child.kill('SIGTERM');
    }
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('could not allocate a port');
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
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const body = (await response.json()) as { ok: true; data: T };
  return body.data;
}

async function waitForValue(locator: Locator, expected: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.inputValue().catch(() => null)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `expected input value ${JSON.stringify(expected)}, got ${JSON.stringify(await locator.inputValue().catch(() => null))}`,
  );
}

async function assertStudio(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 20_000 });
  const studio = page.getByRole('button', { name: 'HTML Studio', exact: true });
  if ((await studio.count()) === 0) throw new Error('HTML Studio surface is missing');
  if ((await studio.first().getAttribute('aria-current')) !== 'page') {
    throw new Error('HTML Studio is not the selected surface');
  }
}

async function openProject(
  page: Page,
  id = PROJECT,
  expected = 'no approved version',
): Promise<void> {
  await page.locator('button[title^="Project:"]').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Project id').fill(id);
  await dialog.getByRole('button', { name: 'Open', exact: true }).press('Enter');
  await page.getByText(expected, { exact: true }).waitFor({ timeout: 20_000 });
  check(`opened project ${id} with the keyboard`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(join(ROOT, 'apps/server/dist/index.js'))) {
    throw new Error('apps/server/dist/index.js is missing — run `pnpm build` first.');
  }
  if (!existsSync(join(ROOT, 'apps/web/dist/index.html'))) {
    throw new Error('apps/web/dist/index.html is missing — run `pnpm build` first.');
  }

  const serverPort = await freePort();
  const webPort = await freePort();
  const dataRoot = await mkdtemp(join(tmpdir(), 'studio-workflow-'));
  const interruptedJobId = randomUUID();
  const seededJobs = join(dataRoot, 'workspaces', 'forge', PROJECT, 'jobs');
  await mkdir(seededJobs, { recursive: true });
  await writeFile(
    join(seededJobs, `${interruptedJobId}.json`),
    `${JSON.stringify(
      {
        id: interruptedJobId,
        project_id: PROJECT,
        kind: 'generate',
        status: 'running',
        prompt: 'A recovered interrupted job used for the banner check.',
        request: null,
        summary: null,
        error: null,
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        logs: ['interrupted regression fixture'],
        usage: null,
        memory_ids: [],
        base_version: null,
        validation: null,
        decision_guard: null,
        version: null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
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
    FORGE_MUSE_BIN: join(ROOT, 'tests/fixtures/fake-muse.mjs'),
    FORGE_MUSE_MODEL: 'fake-muse',
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_RUNTIME_MS: '60000',
    FAKE_MUSE_MODE: 'app',
    FAKE_MUSE_APP: join(ROOT, 'tests/fixtures/general-app-form.html'),
  };
  const webEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_PROXY_TARGET: apiBase,
  };

  let browser: Browser | null = null;
  let server: Managed | null = null;
  try {
    // Fail early and actionably if the selected browser is missing; do not
    // silently fall back to a different browser.
    const launched = await launchVerificationBrowser();
    browser = launched.browser;
    reportBrowserSelection(launched.selection);
    check(
      `browser available: ${launched.selection.selected ?? launched.selection.attempted} (${launched.selection.policy})`,
    );

    server = start('api', process.execPath, [join(ROOT, 'apps/server/dist/index.js')], {
      cwd: ROOT,
      env: serverEnv,
    });
    await waitForHttp(`${apiBase}/api/health`);
    // Name the project through the existing project API. Opening it later must
    // not overwrite this name.
    const created = await fetch(`${apiBase}/api/forge/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: PROJECT, name: 'Studio Workflow Project' }),
    });
    if (!created.ok) throw new Error(`could not pre-create the project: HTTP ${created.status}`);
    check('started the production API on an isolated port and database');

    start(
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
      { cwd: join(ROOT, 'apps/web'), env: webEnv },
    );
    await waitForHttp(webBase);
    check('served the production web build with a managed preview proxy');

    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      acceptDownloads: false,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      const ignorable =
        text.toLowerCase().includes('favicon') || /Failed to load resource.*404/i.test(text);
      if (message.type() === 'error' && !ignorable) errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
    await assertStudio(page);
    await openProject(page);
    const review = page.getByRole('region', { name: 'Review' });

    await page.getByText(/1 interrupted by a server restart/).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: join(OUT, 'after-recovery-banner.png'), fullPage: true });
    await page.getByRole('button', { name: 'Acknowledge notices' }).click();
    await page.getByText(/1 interrupted by a server restart/).waitFor({ state: 'hidden' });
    check('recovery banner was acknowledged without deleting the interrupted job');
    await page.screenshot({ path: join(OUT, 'after-recovery-ack.png'), fullPage: true });

    // Provider/model identity: chat and Studio generation are separate.
    await page.getByText('Chat · echo (offline)').waitFor({ timeout: 10_000 });
    await page.getByText('fake-muse (configured)').first().waitFor({ timeout: 10_000 });
    check('distinguishes chat provider from configured Studio generation identity');

    // Descriptive project name, with the internal id retained in the subtitle.
    await page
      .getByRole('heading', { name: 'Studio Workflow Project', level: 1 })
      .waitFor({ timeout: 10_000 });
    const switcherText = (await page.locator('button[title^="Project:"]').textContent()) ?? '';
    if (!switcherText.includes('Studio Workflow Project')) {
      throw new Error(`project switcher did not show the descriptive name: ${switcherText}`);
    }
    check('shows the descriptive project name with the internal id secondary');

    // No decisions: Guard must not imply generic game checks were run.
    await page.getByText('No project decisions to check.').waitFor({ timeout: 15_000 });
    check('Decision Guard reports that there are no project decisions');
    await page.screenshot({ path: join(OUT, 'after-empty.png'), fullPage: true });

    // Explicit project-memory creation through the existing validated API.
    await page.getByRole('button', { name: 'Add project decision', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Project decision' })
      .fill('Never use countdown timers.');
    await page.getByLabel('Decision type').selectOption('constraint');
    await page.getByRole('button', { name: 'Save decision' }).click();
    await page.getByText('Decision saved to this project.').waitFor({ timeout: 15_000 });
    await page.getByText('Never use countdown timers.').waitFor({ timeout: 10_000 });
    await page.getByText('No project decisions to check.').waitFor({ state: 'hidden' });
    check('explicitly added a scoped project decision');

    // Drafts are project-scoped and must not leak on a project switch.
    const promptBox = page.getByLabel('Application description');
    await promptBox.fill('Draft prompt for this project.');
    await openProject(page, 'studio-workflow-other');
    await waitForValue(page.getByLabel('Application description'), '');
    await openProject(page, PROJECT);
    await waitForValue(
      page.getByLabel('Application description'),
      'Draft prompt for this project.',
    );
    check('project prompt drafts are preserved without leaking between projects');

    await page
      .getByLabel('Application description')
      .fill('A small accessible task list with add, delete and a task count.');
    // Click after the fill so Playwright waits for React to enable the button;
    // an immediate Meta+Enter can race the controlled-textarea state update.
    await page.getByRole('button', { name: 'Generate HTML' }).click();
    await page.getByText(/Studio generation staged an HTML version/).waitFor({ timeout: LONG });
    // A first generation opens the Changes tab; the staged label lives in the
    // preview tab bar, so switch to Preview before asserting it.
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByText('staged — not approved').waitFor({ timeout: 20_000 });
    check('generated a staged HTML application through the form');

    await page.getByRole('tab', { name: 'Changes' }).click();
    const diffPanel = page.locator('#studio-panel-diff');
    await diffPanel.getByText('staged · not approved').waitFor({ timeout: 10_000 });
    if ((await diffPanel.locator('[data-diff-kind="add"]').count()) === 0) {
      throw new Error('Changes panel rendered no added lines');
    }
    await page.getByText('Syntax/structure passed').waitFor({ timeout: 10_000 });
    await page.getByText(/Applicable checks:.*countdown mechanics/).waitFor({ timeout: 10_000 });
    check('staged diff, structure result and applicable Guard checks are visible');

    await page.getByRole('tab', { name: 'Preview' }).click();
    const frame = page.frameLocator('iframe[title="HTML application preview"]');
    await frame.getByRole('heading', { name: 'Task list' }).waitFor({ timeout: 30_000 });
    await frame.getByLabel('New task').fill('Keyboard review task');
    await frame.getByLabel('New task').press('Enter');
    await frame.getByText('Keyboard review task').waitFor({ timeout: 10_000 });
    check('staged preview rendered and accepted a form submit by Enter');

    // ---- First approval and inspectable verification --------------------
    await review.getByRole('button', { name: /^Approve v1/ }).click();
    await page.getByText('First version approved.').waitFor({ timeout: 60_000 });
    if ((await page.getByText(/previous version stays in history/i).count()) > 0) {
      throw new Error('first-version approval incorrectly claimed a previous version');
    }
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    check('first-version approval messaging is accurate');
    await page.screenshot({ path: join(OUT, 'after-approved-v1.png'), fullPage: true });

    // The change request starts empty and cannot be submitted while blank.
    const changeInput = page.getByLabel('Change request');
    await changeInput.waitFor({ timeout: 10_000 });
    if ((await changeInput.inputValue()) !== '') {
      throw new Error('change request was prefilled');
    }
    if ((await changeInput.getAttribute('placeholder')) !== 'Describe what you want to change.') {
      throw new Error('change request placeholder is not neutral');
    }
    if (!(await page.getByRole('button', { name: 'Generate change' }).isDisabled())) {
      throw new Error('Generate change is enabled for an empty request');
    }
    check('change request starts empty with a neutral placeholder and disabled action');

    // Version summary uses the recorded request, not a generic model phrase.
    await review
      .getByText('A small accessible task list with add, delete and a task count.')
      .waitFor({ timeout: 10_000 });
    check('first version summary uses the recorded request');

    // Export caveat is available beside the download action.
    await page.getByText('Export info', { exact: true }).click();
    await page.getByText(/runs outside Studio’s sandbox/).waitFor({ timeout: 10_000 });
    check('export disclosure explains sandbox and dependency limits');

    // Approval verification is inspectable and includes managed-browser data.
    await page.getByText('Approval checks', { exact: true }).first().click();
    const approvalChecks = page.getByTestId('approval-checks').first();
    await approvalChecks.waitFor({ timeout: 10_000 });
    const checkValue = async (label: string) =>
      ((await approvalChecks.locator(`[data-check-value="${label}"]`).textContent()) ?? '').trim();
    const runtimeResult = await checkValue('Runtime load check');
    if (runtimeResult !== 'passed') {
      throw new Error(`runtime verification was not recorded as passed: ${runtimeResult}`);
    }
    const browserIdentity = await checkValue('Browser');
    if (!/Chromium \d/.test(browserIdentity)) {
      throw new Error(`browser identity was not recorded: ${browserIdentity}`);
    }
    const artifactHash = await checkValue('Checked artifact');
    if (!/^sha [a-f0-9]{12}$/.test(artifactHash)) {
      throw new Error(`checked artifact hash was not recorded: ${artifactHash}`);
    }
    const browserPolicy = await checkValue('Browser policy');
    if (browserPolicy !== 'managed') {
      throw new Error(`expected managed browser policy, got ${browserPolicy}`);
    }
    if ((await checkValue('Launch failure')) !== 'none') {
      throw new Error('successful managed-browser approval recorded a launch failure');
    }
    if ((await approvalChecks.getByText('Approval verification was not recorded').count()) > 0) {
      throw new Error('approval verification was incorrectly reported as missing');
    }
    check('approval checks show runtime result, browser identity and artifact hash');

    // Change drafts are also project-scoped.
    await changeInput.fill('Draft change for this project.');
    await openProject(page, 'studio-workflow-other');
    await openProject(page, PROJECT, 'v1 approved');
    await waitForValue(page.getByLabel('Change request'), 'Draft change for this project.');
    check('project change drafts are preserved without leaking between projects');

    await page.getByRole('tab', { name: 'Change this app' }).click();
    await page.getByLabel('Change request').fill('Add a verification change control.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Change staged\./).waitFor({ timeout: LONG });
    await page.getByText('staged — not approved').waitFor({ timeout: 10_000 });
    await review.getByRole('button', { name: 'Reject', exact: true }).click();
    await page
      .getByText('Change rejected. The approved application is untouched.')
      .waitFor({ timeout: 20_000 });
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    check('rejected a staged modification without changing v1');

    await page.getByRole('tab', { name: 'Change this app' }).click();
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Change staged\./).waitFor({ timeout: LONG });
    await review.getByRole('button', { name: /^Approve & publish v2/ }).click();
    await page.getByText(/Approved v2\./).waitFor({ timeout: 60_000 });
    await page.getByText('v2 approved').waitFor({ timeout: 10_000 });
    check('approved a second version');

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByText('Restore v1 as the current version?').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Restore v1', exact: true }).click();
    await page.getByText(/Restored v1 as the current version\./).waitFor({ timeout: 20_000 });
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    check('rolled back to the recorded parent v1');

    // ---- Restart recovery ----------------------------------------------
    await page.getByRole('tab', { name: 'Change this app' }).click();
    await page.getByLabel('Change request').fill('Add a restart-recovery note.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Change staged\./).waitFor({ timeout: LONG });

    const before = await json<{
      state: {
        current_version: number | null;
        versions: Array<{ version: number; base_version?: number | null; sha256?: string }>;
      };
      jobs: Array<{
        id: string;
        status: string;
        version: number | null;
        base_version: number | null;
      }>;
    }>(`${apiBase}/api/forge/projects/${PROJECT}`);
    const pending = before.jobs.find((job) => job.status === 'succeeded' && job.version === null);
    if (!pending) throw new Error('the staged job was not recorded before restart');
    if (before.state.current_version !== 1) {
      throw new Error(
        `expected current v1 after rollback, got ${String(before.state.current_version)}`,
      );
    }
    if (pending.base_version !== 1) {
      throw new Error(
        `expected the staged change to be based on v1, got ${String(pending.base_version)}`,
      );
    }
    const earlierVersions = structuredClone(before.state.versions);

    await stop(server);
    server = start('api', process.execPath, [join(ROOT, 'apps/server/dist/index.js')], {
      cwd: ROOT,
      env: serverEnv,
    });
    await waitForHttp(`${apiBase}/api/health`);
    check('restarted the API with the same isolated database and workspace');

    const after = await json<{
      jobs: Array<{
        id: string;
        status: string;
        version: number | null;
        base_version: number | null;
      }>;
      recovery?: {
        startup: { loaded_jobs: number; interrupted_jobs: number };
        issues: unknown[];
        storage: { ok: boolean };
      };
    }>(`${apiBase}/api/forge/projects/${PROJECT}`);
    const restaged = after.jobs.find((job) => job.id === pending.id);
    if (restaged?.status !== 'succeeded' || restaged.version !== null) {
      throw new Error('the staged job did not survive the restart');
    }
    if (restaged.base_version !== 1) {
      throw new Error(`reloaded job lost its v1 base (got ${String(restaged.base_version)})`);
    }
    if (after.recovery && after.recovery.startup.interrupted_jobs !== 0) {
      throw new Error('a completed staged job was incorrectly marked interrupted');
    }
    if (after.recovery && after.recovery.issues.length > 0) {
      throw new Error(`restart recovery reported issues: ${JSON.stringify(after.recovery.issues)}`);
    }
    check('reloaded the completed staged job from disk with no recovery issues');

    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await assertStudio(page);
    await page.getByText('A staged change is waiting for review.').waitFor({ timeout: 20_000 });
    await page.getByText('staged — not approved').waitFor({ timeout: 10_000 });
    check('the Studio restored the staged change for review after restart');

    // Versions are monotonic across history: v1 and v2 were already created,
    // the rollback only moved the current pointer back to v1. The next
    // approval is therefore v3, based on v1, while v2 remains in history.
    await review.getByRole('button', { name: /^Approve & publish v3/ }).click();
    await page.getByText(/Approved v3\./).waitFor({ timeout: 60_000 });
    await page.getByText('v3 approved').waitFor({ timeout: 10_000 });
    check('approved the recovered staged change as v3 from base v1');

    const final = await json<{
      state: {
        current_version: number | null;
        versions: Array<{ version: number; base_version?: number | null; sha256?: string }>;
      };
    }>(`${apiBase}/api/forge/projects/${PROJECT}`);
    if (final.state.current_version !== 3) {
      throw new Error(`expected current v3, got ${String(final.state.current_version)}`);
    }
    if (final.state.versions.map((entry) => entry.version).join(',') !== '1,2,3') {
      throw new Error(
        `expected versions 1,2,3, got ${final.state.versions.map((entry) => entry.version).join(',')}`,
      );
    }
    const v3 = final.state.versions.find((entry) => entry.version === 3);
    if (v3?.base_version !== 1) {
      throw new Error(`expected v3 base_version 1, got ${String(v3?.base_version)}`);
    }
    for (const earlier of earlierVersions) {
      const kept = final.state.versions.find((entry) => entry.version === earlier.version);
      if (JSON.stringify(kept) !== JSON.stringify(earlier)) {
        throw new Error(`v${earlier.version} changed after the v3 approval`);
      }
    }
    check('v1 and v2 remain intact and v3 records its v1 ancestry');

    await page.screenshot({ path: join(OUT, 'studio-workflow-final.png'), fullPage: true });

    if (errors.length > 0) {
      throw new Error(`console/page errors: ${errors.slice(0, 3).join(' | ')}`);
    }
    check('no console or page errors');

    console.log(
      `\nAutomated Studio workflow: ${checks.length} checks passed (project ${PROJECT}).`,
    );
    console.log('Verification levels:');
    console.log('  • syntax/structure: automated node --check + HTML checks; not execution');
    console.log('  • successful loading: server runtime check loads the staged page once');
    console.log(
      '  • tested interactions: generation, review, approve, modify, reject, rollback, restart',
    );
    console.log('  • human review: visual design, gameplay and decision quality remain manual');
    console.log(`Logs and screenshot: ${OUT}/`);
  } catch (error) {
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const page = pages[0];
      if (page) {
        await page
          .screenshot({ path: join(OUT, 'failure.png'), fullPage: true })
          .catch(() => undefined);
      }
    }
    console.error(error);
    for (const item of managed) {
      console.error(`\n--- ${item.name} (${item.log}) ---\n${item.tail.slice(-4_000)}`);
    }
    process.exitCode = 1;
  } finally {
    for (const item of [...managed].reverse()) await stop(item);
    await browser?.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
