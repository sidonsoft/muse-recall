/**
 * Browser smoke verification.
 *
 * Drives the real UI against a running API: system status, a live Muse check,
 * the provider bench, and the full memory inspector journey (create → inspect →
 * correct → explain retrieval → delete). Fails on any console error, page
 * exception, or HTTP error.
 *
 * Usage:
 *   pnpm dev:server   # terminal 1
 *   pnpm dev:web      # terminal 2
 *   pnpm exec tsx scripts/verify-ui.ts
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:5173';
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath =
  screenshotFlag !== -1 ? process.argv[screenshotFlag + 1] : 'docs/assets/phase1-ui.png';

const problems: string[] = [];
const notes: string[] = [];

function log(message: string): void {
  console.log(`  ${message}`);
}

function screenshotName(suffix: string): string {
  return screenshotPath.replace(/(\.png)$/, `-${suffix}.png`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text();
    if (/Download the React DevTools/.test(text)) return;
    problems.push(`console error: ${text}`);
  }
});

page.on('pageerror', (error) => {
  problems.push(`page exception: ${error.message}`);
});

page.on('response', async (response) => {
  if (response.status() >= 400) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      body = '(no body)';
    }
    problems.push(`HTTP ${response.status()} ${response.url()} — ${body}`);
  }
});

try {
  log(`loading ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

  // ---- System overview ---------------------------------------------------
  await page.getByRole('heading', { name: 'API service' }).waitFor({ timeout: 10_000 });
  notes.push('overview rendered');

  const databaseCard = page.locator('section', { hasText: 'Memory database' }).first();
  const writeCheck = (await databaseCard.textContent()) ?? '';
  if (!/round-trip verified/.test(writeCheck)) {
    problems.push(`database write check not verified: ${writeCheck.replace(/\s+/g, ' ')}`);
  } else {
    notes.push('database write round-trip verified in the UI');
  }

  // ---- Live Muse probe ---------------------------------------------------
  const probeButton = page.getByRole('button', { name: /live check/i });
  if ((await probeButton.count()) === 0) {
    problems.push('the Muse live-check button is missing (provider is not muse-cli)');
  } else {
    log('running live Muse check via the UI');
    await probeButton.click();
    await page.getByText('verified', { exact: true }).first().waitFor({ timeout: 90_000 });
    notes.push('Muse verified by a live call from the browser');
  }

  // ---- Provider bench ----------------------------------------------------
  log('sending a bench prompt from the UI');
  await page.getByRole('button', { name: /send to provider/i }).click();
  await page
    .getByText(/in \/.*out/)
    .first()
    .waitFor({ timeout: 90_000 });
  const benchText = (await page.locator('pre').first().textContent()) ?? '';
  if (benchText.trim().length === 0) {
    problems.push('provider bench returned empty text');
  } else {
    notes.push(`provider bench replied with ${benchText.trim().length} chars`);
  }

  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.getByRole('heading', { name: 'Provider bench' }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotName('bench') });
    notes.push(`bench screenshot written to ${screenshotName('bench')}`);
  }

  // ---- Memory inspector --------------------------------------------------
  log('opening the memory inspector');
  await page
    .getByRole('button', { name: /Memories/ })
    .first()
    .click();

  const searchInput = page.getByLabel('Search memories');
  await searchInput.waitFor({ timeout: 10_000 });
  notes.push('memory inspector rendered');

  // Unique per run so repeated verification does not collide with an earlier
  // run's memories (which would exercise dedupe instead of creation).
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const openContent = `Verification ${runId}: use SQLite in WAL mode for persistence`;
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Memory content').fill(openContent);
  await page.getByRole('button', { name: /Store memory/ }).click();
  await page.getByText(openContent).first().waitFor({ timeout: 10_000 });
  notes.push('created a memory through the inspector');

  // Select it and confirm provenance is shown.
  await page.getByText(openContent).first().click();
  await page.getByText('source ref', { exact: true }).waitFor({ timeout: 10_000 });
  const detailText =
    (await page.getByRole('region', { name: 'Memory detail' }).textContent()) ?? '';
  if (!detailText.includes('inspector')) {
    problems.push('provenance for the inspector-created memory was not displayed');
  } else {
    notes.push('provenance displayed (source reference)');
  }

  // ---- Correction --------------------------------------------------------
  log('correcting the memory');
  await page.getByRole('button', { name: 'Correct memory' }).click();
  const corrected = `Verification ${runId}: use Postgres in WAL mode for persistence`;
  await page.getByLabel('Corrected fact').fill(corrected);
  await page.getByLabel(/Why/).fill('verification run changed the decision');
  await page.getByRole('button', { name: /Supersede with correction/ }).click();
  await page.getByText(/Correction stored/).waitFor({ timeout: 15_000 });
  notes.push('correction applied and confirmed in the UI');

  await page.getByText(corrected).first().waitFor({ timeout: 10_000 });
  await page
    .getByText(/Replaced 1 earlier record/)
    .first()
    .waitFor({ timeout: 10_000 });
  notes.push('new record links back to the record it replaced');

  // Follow the supersession link to the old record and inspect its history.
  await page
    .getByRole('button', { name: /use SQLite in WAL mode/ })
    .first()
    .click();
  await page
    .getByText(/superseded · user/)
    .first()
    .waitFor({ timeout: 10_000 });
  await page.getByText('Superseded by', { exact: true }).waitFor({ timeout: 10_000 });
  notes.push('superseded record keeps its history and points at its replacement');

  if (screenshotPath) {
    await page.screenshot({ path: screenshotName('memory-detail') });
    notes.push(`memory detail screenshot written to ${screenshotName('memory-detail')}`);
  }

  // ---- Retrieval explanation --------------------------------------------
  log('running the retrieval explanation');
  await page.getByRole('button', { name: /Retrieval explanation/ }).click();
  await page.getByLabel('Retrieval query').fill('WAL mode persistence');
  await page.getByRole('button', { name: 'Explain' }).click();
  await page.getByText('candidates', { exact: true }).waitFor({ timeout: 15_000 });

  const retrievalPanel =
    (await page.getByRole('region', { name: 'Retrieval explanation' }).textContent()) ?? '';
  if (!/candidates[\s\S]*selected[\s\S]*excluded/.test(retrievalPanel)) {
    problems.push('retrieval explanation did not render its metadata');
  } else {
    notes.push('retrieval explanation rendered with budget metadata');
  }
  if (!retrievalPanel.includes(corrected)) {
    problems.push('retrieval explanation did not include the corrected memory');
  } else {
    notes.push('retrieval explanation lists the current (corrected) fact');
  }

  if (screenshotPath) {
    await page.screenshot({ path: screenshotName('memory-retrieval') });
    notes.push(`retrieval screenshot written to ${screenshotName('memory-retrieval')}`);
  }

  // ---- Deletion ----------------------------------------------------------
  log('deleting the memory');
  await page.getByRole('button', { name: 'Detail' }).click();
  // Selection is currently the superseded record (we followed its link), so
  // re-select the current fact before deleting it.
  await page.getByText(corrected).first().click();
  await page.getByRole('button', { name: 'Delete memory' }).click();
  await page.getByRole('button', { name: /Delete permanently/ }).click();
  await page.getByText(/Memory deleted/).waitFor({ timeout: 15_000 });
  notes.push('deletion confirmed in the UI');

  // The superseded record intentionally survives as history, so the assertion
  // is that the *deleted* content is gone, not that the run id disappears.
  await searchInput.fill(runId);
  await page.waitForTimeout(800);
  const remaining = await page.getByText(corrected).count();
  if (remaining > 0) {
    problems.push(`deleted memory still listed (${remaining} matches)`);
  } else {
    notes.push('deleted memory no longer appears in search');
  }

  // ---- Unbuilt section reports its phase --------------------------------
  await page
    .getByRole('button', { name: /Projects/ })
    .first()
    .click();
  await page.getByText(/scheduled for Phase 4/i).waitFor({ timeout: 5_000 });
  notes.push('unbuilt section reports its phase instead of pretending');
  await page
    .getByRole('button', { name: /System/ })
    .first()
    .click();

  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    notes.push(`overview screenshot written to ${screenshotPath}`);
  }
} catch (error) {
  problems.push(`verification aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}

console.log('\nChecks passed:');
for (const note of notes) console.log(`  ✓ ${note}`);

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log('\nUI verification passed.');
