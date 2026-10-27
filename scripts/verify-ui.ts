/**
 * Broad browser smoke verification for the current product.
 *
 * Scope: System health, provider bench, the memory inspector journey (create →
 * inspect → correct → explain retrieval → delete), two conversation turns with
 * retrieval evidence, and the HTML Studio landing/tab shell. It is a smoke
 * test, not the Studio generation/review workflow: that is `pnpm verify:forge`
 * (browser) and `pnpm verify:forge-workflow` (backend).
 *
 * Fails on any console error, page exception, or HTTP error.
 *
 * Usage:
 *   pnpm dev:server   # terminal 1
 *   pnpm dev:web      # terminal 2
 *   pnpm verify:browser
 *
 * `VERIFY_URL` selects the web client (default http://127.0.0.1:5173). Point
 * it at the server you actually intend to test; the script asserts product
 * surfaces rather than a port number.
 *
 * Screenshots default to `test-results/verify-ui/` (gitignored). Pass
 * `--screenshot <path>` only when you deliberately want to write elsewhere;
 * the historical evidence under `docs/assets/` must not be overwritten by a
 * routine test run.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:5173';
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath =
  screenshotFlag !== -1
    ? (process.argv[screenshotFlag + 1] ?? 'test-results/verify-ui/phase1-ui.png')
    : 'test-results/verify-ui/phase1-ui.png';

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

let liveProvider = false;

try {
  log(`loading ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  const metaResponse = await page.request.get(new URL('/api/meta', url).toString());
  const metaBody = (await metaResponse.json()) as { data?: { provider?: { id?: string } } };
  liveProvider = metaBody.data?.provider?.id === 'muse-cli';

  // ---- System overview ---------------------------------------------------
  // HTML Studio is the landing surface; System is the diagnostics tab.
  await page.getByRole('button', { name: 'System', exact: true }).click();
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
    // The echo provider is deterministic and offline; it deliberately has no
    // live-check control. Record the skip instead of failing the smoke test.
    notes.push('live Muse check skipped: the configured provider is not muse-cli');
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
  await page.getByRole('button', { name: 'Memory', exact: true }).click();

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

  // ---- Conversations -----------------------------------------------------
  log('opening conversations');
  await page
    .getByRole('button', { name: /Conversations/ })
    .first()
    .click();
  await page.getByRole('button', { name: /New conversation/ }).waitFor({ timeout: 10_000 });
  notes.push('conversations view rendered');

  const project = `verify-ui-${runId}`;
  await page.getByRole('button', { name: /New conversation/ }).click();
  await page.getByLabel(/Project scope/).fill(project);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Message').waitFor({ timeout: 10_000 });

  await page.getByLabel('Message').fill('Remember that this project uses SQLite in WAL mode.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // The assistant turn must complete with retrieval evidence attached.
  await page
    .getByRole('button', { name: /Memory used/ })
    .first()
    .waitFor({ timeout: 120_000 });
  notes.push(
    liveProvider
      ? 'streamed a real Muse answer through the conversations view'
      : 'streamed a deterministic echo answer through the conversations view',
  );

  await page
    .getByRole('button', { name: /Memory used/ })
    .first()
    .click();
  const evidenceText = (await page.locator('article').last().textContent()) ?? '';
  if (!/score \d/.test(evidenceText)) {
    problems.push('memory evidence did not render a relevance score');
  } else {
    notes.push('memory used panel shows retrieved memories with scores');
  }
  if (!evidenceText.includes('SQLite in WAL mode')) {
    problems.push('captured memory was not listed as retrieved in the first turn');
  } else {
    notes.push('explicitly captured memory appeared in the same turn retrieval');
  }

  // A second, independent conversation in the same project must retrieve it.
  await page.getByRole('button', { name: /New conversation/ }).click();
  await page.getByLabel(/Project scope/).fill(project);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Message').fill('Which storage does this project use?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page
    .getByRole('button', { name: /Memory used/ })
    .first()
    .waitFor({ timeout: 120_000 });

  const secondEvidence = (await page.locator('article').last().textContent()) ?? '';
  if (!secondEvidence.includes('SQLite in WAL mode')) {
    problems.push('a new conversation did not retrieve the earlier session memory');
  } else {
    notes.push('a new conversation retrieved memory from an earlier session');
  }

  if (screenshotPath) {
    await page.screenshot({ path: screenshotName('conversations') });
    notes.push(`conversations screenshot written to ${screenshotName('conversations')}`);
  }

  // ---- Generative interface ---------------------------------------------
  // The offline echo provider returns plain text, not a UI spec. Skip the
  // generative-interface journey when it is configured instead of failing.
  if (!liveProvider) {
    notes.push('generative interface skipped: the configured provider is not muse-cli');
  } else {
    log('generating an interface');
    await page.getByRole('button', { name: /New conversation/ }).click();
    await page.getByLabel(/Project scope/).fill(`verify-ui-${runId}-ui`);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByLabel('Message').fill('Help me plan the first milestone for the game');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const surface = page.getByRole('region', { name: /^Interface:/ });
    await surface.waitFor({ timeout: 180_000 });
    notes.push('Muse generated a validated interface inside the conversation');

    // Fill every free-text field and choose the first option of each select, so
    // the test does not depend on the model's chosen field ids.
    const textInputs = surface.locator('input[type="text"]');
    for (let index = 0; index < (await textInputs.count()); index += 1) {
      await textInputs.nth(index).fill('Verification milestone');
    }
    const textareas = surface.locator('textarea');
    for (let index = 0; index < (await textareas.count()); index += 1) {
      await textareas.nth(index).fill('Verification details for the first milestone');
    }
    const selects = surface.locator('select');
    for (let index = 0; index < (await selects.count()); index += 1) {
      await selects.nth(index).selectOption({ index: 1 });
    }
    const numbers = surface.locator('input[type="number"]');
    for (let index = 0; index < (await numbers.count()); index += 1) {
      await numbers.nth(index).fill('5');
    }
    // Required multiselect fields need at least one option chosen.
    const multiGroups = surface.locator('[data-field-type="multiselect"]');
    for (let index = 0; index < (await multiGroups.count()); index += 1) {
      await multiGroups.nth(index).locator('label:has(input.sr-only)').first().click();
    }
    // Checkbox fields (not the sr-only inputs used by multiselect chips).
    const checkboxes = surface.locator('input[type="checkbox"]:not(.sr-only)');
    for (let index = 0; index < (await checkboxes.count()); index += 1) {
      if (!(await checkboxes.nth(index).isChecked())) await checkboxes.nth(index).check();
    }

    await surface.locator('button[type="submit"]').click();
    await page.getByText(/Interface submitted/).waitFor({ timeout: 180_000 });
    notes.push('submitted the interface and the agent continued the work');
  }

  if (screenshotPath) {
    await page.screenshot({ path: screenshotName('generative-ui') });
    notes.push(`generative UI screenshot written to ${screenshotName('generative-ui')}`);
  }

  // ---- HTML Studio is the landing surface --------------------------------
  await page.getByRole('button', { name: 'HTML Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 10_000 });
  notes.push('HTML Studio rendered with its Preview/Source/Changes tabs');

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
