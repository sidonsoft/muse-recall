/**
 * Browser verification for the current HTML Studio.
 *
 * Drives the real UI against a running API and web client. It checks the
 * surfaces the product actually ships: the Studio landing state, project
 * opening, generation, staged preview, Source and Changes, staged-versus-
 * approved switching, approval, rejection, a second approval, rollback,
 * project-memory visibility, Decision Guard visibility and HTML download.
 *
 * It does not test backend workflow semantics; those live in
 * `pnpm verify:forge-workflow` (API + fake Muse, no UI).
 *
 * Requirements:
 *   - API and web dev servers running; the web client proxies /api.
 *   - The server should use the deterministic fixture:
 *       FORGE_MUSE_BIN=tests/fixtures/fake-muse.mjs
 *       FAKE_MUSE_MODE=app
 *     (no paid inference, no network, no live Muse call)
 *
 * Usage:
 *   pnpm dev:server   # terminal 1
 *   pnpm dev:web      # terminal 2
 *   pnpm verify:forge
 *
 * `FORGE_VERIFY_BASE` selects the web client (default http://127.0.0.1:5173).
 * `FORGE_VERIFY_SHOTS` selects the screenshot directory; it defaults to the
 * disposable `test-results/verify-forge/`, never tracked evidence.
 *
 * Uses Playwright-managed Chromium by default. Set FORGE_RUNTIME_BROWSER=chrome
 * only for an explicit system-Chrome run; there is no automatic fallback.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const BASE = process.env.FORGE_VERIFY_BASE ?? 'http://127.0.0.1:5173';
/** Test output, never historical evidence. `docs/assets` is read-only here. */
const SHOTS = process.env.FORGE_VERIFY_SHOTS ?? 'test-results/verify-forge';
const PROJECT =
  process.env.FORGE_VERIFY_PROJECT ?? `forge-verify-${Date.now().toString(36).slice(-5)}`;
const LONG = Number(process.env.FORGE_VERIFY_TIMEOUT_MS ?? 900_000);

const checks: string[] = [];
function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

/**
 * Fail loudly when the base URL is not the repositioned Studio. The previous
 * revision of this script silently passed against the legacy "Muse Memory Lab"
 * page on 5173, which made the command's scope ambiguous.
 */
async function assertCurrentStudio(page: Page): Promise<void> {
  const previewTab = page.getByRole('tab', { name: 'Preview' });
  try {
    await previewTab.waitFor({ timeout: 20_000 });
  } catch {
    const legacyForge = await page.getByRole('button', { name: /^Forge$/ }).count();
    const body = ((await page.locator('body').textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 180);
    throw new Error(
      `verify:forge expected the current HTML Studio at ${BASE}, but its Preview tab never appeared. ` +
        (legacyForge > 0
          ? 'This looks like the legacy Muse Memory Lab UI; verify:forge no longer targets it. '
          : '') +
        `Point FORGE_VERIFY_BASE at the current web client. Page began: ${body}`,
    );
  }
  const studio = page.getByRole('button', { name: 'HTML Studio', exact: true });
  if ((await studio.count()) === 0) {
    throw new Error(`Not the current Studio: the "HTML Studio" surface is missing at ${BASE}.`);
  }
  const selected = await studio.first().getAttribute('aria-current');
  if (selected !== 'page') {
    throw new Error(`Landing surface is not HTML Studio (aria-current=${String(selected)}).`);
  }
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const { browser, selection } = await launchVerificationBrowser();
  reportBrowserSelection(selection);
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      acceptDownloads: true,
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

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
    await assertCurrentStudio(page);
    check('landed on the current HTML Studio');

    // ---- Open an isolated project ----------------------------------------
    await page.locator('button[title^="Project:"]').click();
    const dialog = page.getByRole('dialog', { name: 'Switch project' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel('Project id').fill(PROJECT);
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    // An empty project already says "no approved version"; wait for the
    // selected project id so the prompt is not filled into the old project
    // and then reset by the project switch.
    await page.waitForFunction((id) => document.body.textContent?.includes(id) ?? false, PROJECT, {
      timeout: 20_000,
    });
    await page.getByText('no approved version', { exact: true }).waitFor({ timeout: 20_000 });
    check('opened an empty project in the current Studio');

    // ---- Generate a first, non-game application --------------------------
    await page
      .getByLabel('Application description')
      .fill('A small accessible task list with add, delete and a task count.');
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          entry.textContent?.includes('Generate HTML'),
        );
        return button !== undefined && !button.disabled;
      },
      undefined,
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Generate HTML' }).click();
    await page.getByText(/Studio generation staged an HTML version/).waitFor({ timeout: LONG });
    check('generated a staged HTML application');

    // ---- Preview ---------------------------------------------------------
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByText('staged — not approved').waitFor({ timeout: 10_000 });
    const frame = page.frameLocator('iframe[title="HTML application preview"]');
    await frame.getByRole('heading', { name: 'Task list' }).waitFor({ timeout: 30_000 });
    await frame.getByLabel('New task').fill('Verification task');
    await frame.getByRole('button', { name: 'Add task' }).click();
    await frame.getByText('Verification task').waitFor({ timeout: 10_000 });
    check('staged preview renders and its JavaScript interaction works');

    await page.screenshot({ path: `${SHOTS}/studio-staged.png` });

    // ---- Source ----------------------------------------------------------
    await page.getByRole('tab', { name: 'Source' }).click();
    const sourcePanel = page.locator('#studio-panel-source');
    await sourcePanel.getByText('staged source').waitFor({ timeout: 10_000 });
    const sourceText = (await sourcePanel.textContent()) ?? '';
    if (!sourceText.includes('index.html') || !/sha [a-f0-9]{10}/.test(sourceText)) {
      throw new Error('Source panel did not show index.html and its SHA-256.');
    }
    check('Source shows the staged index.html with integrity metadata');

    // ---- Changes ---------------------------------------------------------
    await page.getByRole('tab', { name: 'Changes' }).click();
    const diffPanel = page.locator('#studio-panel-diff');
    await diffPanel.getByText('staged · not approved').waitFor({ timeout: 10_000 });
    if ((await diffPanel.locator('[data-diff-kind="add"]').count()) === 0) {
      throw new Error('Changes panel rendered no added lines for a first version.');
    }
    check('Changes shows the staged diff with added lines');
    await page.screenshot({ path: `${SHOTS}/studio-diff.png` });

    // ---- Approval --------------------------------------------------------
    const review = page.getByRole('region', { name: 'Review' });
    await review.getByRole('button', { name: /^Approve/ }).click();
    await page.getByText(/First version approved\./).waitFor({ timeout: 60_000 });
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    check('approved the first version');

    // Approved preview and source must now describe v1, not a staged file.
    await page.getByRole('tab', { name: 'Preview' }).click();
    await frame.getByRole('heading', { name: 'Task list' }).waitFor({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Source' }).click();
    await sourcePanel.getByText('v1', { exact: true }).waitFor({ timeout: 10_000 });
    if (((await sourcePanel.textContent()) ?? '').includes('staged source')) {
      throw new Error('Source still reports a staged artifact after approval.');
    }
    check('approved preview and source replace the staged view');

    // ---- Export ----------------------------------------------------------
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Download HTML' }).click();
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    if (!suggested.endsWith('.html')) throw new Error(`unexpected export name: ${suggested}`);
    const exportedPath = await download.path();
    if (!exportedPath) throw new Error('export produced no file');
    check(`exported ${suggested}`);

    // ---- Staged modification and comparisons ----------------------------
    await page.getByRole('tab', { name: 'Change this app' }).click();
    await page.getByLabel('Change request').fill('Add a verification change control.');
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Change staged\./).waitFor({ timeout: LONG });
    await page.getByText('staged — not approved').waitFor({ timeout: 10_000 });

    const stagedToggle = page.getByRole('button', { name: /^Staged v/ });
    if ((await stagedToggle.getAttribute('aria-pressed')) !== 'true') {
      throw new Error('staged preview toggle was not selected after a modification.');
    }
    await page.getByRole('button', { name: 'Approved v1' }).click();
    await page.getByText('staged — not approved').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByRole('button', { name: /^Staged v/ }).click();
    await page.getByText('staged — not approved').waitFor({ timeout: 10_000 });
    check('staged and approved views are switchable and labelled');

    // ---- Decision Guard and memory visibility ---------------------------
    const guard = page.getByRole('region', { name: 'Decision Guard advisory' });
    await guard.waitFor({ timeout: 10_000 });
    const guardText = (await guard.textContent()) ?? '';
    if (
      !/(NOT VERIFIED|NO VIOLATION|VIOLATION DETECTED|NOT EVALUATED|NO DECISIONS)/.test(guardText)
    ) {
      throw new Error('Decision Guard advisory did not report an assessment.');
    }
    const memory = page.getByRole('region', { name: 'Project memory' });
    await memory.waitFor({ timeout: 10_000 });
    if (
      !((await memory.textContent()) ?? '').includes(
        'Retrieved context, not proof that it changed a model decision.',
      )
    ) {
      throw new Error('Project memory rail lost its retrieval caveat.');
    }
    check('Decision Guard advisory and project-memory caveat are visible');

    await page.screenshot({ path: `${SHOTS}/studio-staged-modification.png` });

    // ---- Rejection -------------------------------------------------------
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await page
      .getByText('Change rejected. The approved application is untouched.')
      .waitFor({ timeout: 20_000 });
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    if ((await page.getByText('staged — not approved').count()) > 0) {
      throw new Error('a rejected change is still presented as staged.');
    }
    check('rejected the staged change without changing the approved v1');

    // ---- Second approval and rollback -----------------------------------
    await page.getByRole('button', { name: 'Generate change' }).click();
    await page.getByText(/Change staged\./).waitFor({ timeout: LONG });
    await review.getByRole('button', { name: /^Approve/ }).click();
    await page.getByText(/Approved v2\./).waitFor({ timeout: 60_000 });
    await page.getByText('v2 approved').waitFor({ timeout: 10_000 });
    check('approved a second version');

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByText('Restore v1 as the current version?').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Restore v1', exact: true }).click();
    await page.getByText(/Restored v1 as the current version\./).waitFor({ timeout: 20_000 });
    await page.getByText('v1 approved').waitFor({ timeout: 10_000 });
    check('rolled back to the recorded parent v1');

    await page.screenshot({ path: `${SHOTS}/studio-rolled-back.png` });

    if (errors.length > 0) {
      console.error(`  ✗ console/page errors: ${errors.slice(0, 3).join(' | ')}`);
      process.exitCode = 1;
    } else {
      console.log('  ✓ no console or page errors');
    }
    console.log(`\nHTML Studio verification: ${checks.length} checks passed (project ${PROJECT}).`);
    console.log(`Screenshots: ${SHOTS}/`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
