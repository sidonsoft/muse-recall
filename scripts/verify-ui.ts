/**
 * Browser smoke verification.
 *
 * Loads the real UI against a running API, exercises the Muse live-check and
 * the provider bench through the actual interface, and fails on any console
 * error or uncaught page exception. Writes a screenshot for the docs.
 *
 * Usage:
 *   pnpm dev:server   # terminal 1
 *   pnpm dev:web      # terminal 2
 *   pnpm exec tsx scripts/verify-ui.ts [--screenshot docs/assets/phase1-ui.png]
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text();
    // React's dev-only StrictMode double-render notice is not a defect.
    if (/Download the React DevTools/.test(text)) return;
    problems.push(`console error: ${text}`);
  }
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

page.on('pageerror', (error) => {
  problems.push(`page exception: ${error.message}`);
});

try {
  log(`loading ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

  await page.getByRole('heading', { name: 'API service' }).waitFor({ timeout: 10_000 });
  notes.push('overview rendered');

  const databaseCard = page.locator('section', { hasText: 'Memory database' }).first();
  const writeCheck = (await databaseCard.textContent()) ?? '';
  if (!/round-trip verified/.test(writeCheck)) {
    problems.push(`database write check not verified: ${writeCheck.replace(/\s+/g, ' ')}`);
  } else {
    notes.push('database write round-trip verified in the UI');
  }

  // Real Muse probe through the interface.
  const probeButton = page.getByRole('button', { name: /live check/i });
  if ((await probeButton.count()) === 0) {
    problems.push('the Muse live-check button is missing (provider is not muse-cli)');
  } else {
    log('running live Muse check via the UI');
    await probeButton.click();
    await page.getByText('verified', { exact: true }).first().waitFor({ timeout: 90_000 });
    notes.push('Muse verified by a live call from the browser');
  }

  // Provider bench round-trip.
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

  // Evidence shot: the bench with a real model reply on screen.
  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.getByRole('heading', { name: 'Provider bench' }).first().scrollIntoViewIfNeeded();
    const benchShot = screenshotPath.replace(/\.png$/, '-bench.png');
    await page.screenshot({ path: benchShot });
    notes.push(`bench screenshot written to ${benchShot}`);
  }

  // Navigation to an unbuilt section must be honest about it.
  await page
    .getByRole('button', { name: /Memories/ })
    .first()
    .click();
  await page.getByText(/scheduled for Phase 2/i).waitFor({ timeout: 5_000 });
  notes.push('unbuilt section reports its phase instead of pretending');
  await page
    .getByRole('button', { name: /System/ })
    .first()
    .click();

  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    notes.push(`screenshot written to ${screenshotPath}`);
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
