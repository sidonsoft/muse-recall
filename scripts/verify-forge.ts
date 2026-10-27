/**
 * Browser verification for the Forge workflow.
 *
 * Requires the API and web dev servers to be running, and a Muse CLI available
 * (use `FORGE_MUSE_BIN=tests/fixtures/fake-muse.mjs FAKE_MUSE_MODE=auto` for a
 * fast deterministic run). Generates, previews, captures, modifies, rejects,
 * modifies again, approves and undoes.
 *
 *   pnpm verify:forge
 */
import { chromium } from 'playwright-core';

const BASE = process.env.FORGE_VERIFY_BASE ?? 'http://127.0.0.1:5173';
const PROJECT =
  process.env.FORGE_VERIFY_PROJECT ?? `forge-verify-${Date.now().toString(36).slice(-5)}`;
const LONG = Number(process.env.FORGE_VERIFY_TIMEOUT_MS ?? 900_000);

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors: string[] = [];
  const checks: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    const ignorable =
      text.toLowerCase().includes('favicon') || /Failed to load resource.*404/i.test(text);
    if (message.type() === 'error' && !ignorable) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const check = (label: string) => {
    checks.push(label);
    console.log(`  ✓ ${label}`);
  };

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.getByRole('button', { name: /Forge/ }).first().click();
  await page.getByLabel('Forge project id').fill(PROJECT);
  await page.getByRole('button', { name: 'Open project' }).click();
  await page.getByText('approved:').waitFor({ timeout: 15_000 });
  check('opened an empty Forge project');

  await page.getByRole('button', { name: 'Generate game' }).click();
  await page.getByText('staged — not approved').waitFor({ timeout: LONG });
  await page.screenshot({ path: 'docs/assets/phase9-forge-generated.png' });
  check('generated a staged game');

  const frame = page.frameLocator('iframe[title="Game preview"]');
  await frame.locator('canvas').waitFor({ timeout: 30_000 });
  check('preview rendered a canvas');

  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Change approved').waitFor({ timeout: 60_000 });
  check('approved the first version');

  await page.getByRole('button', { name: 'Capture preview' }).click();
  await page.locator('img[alt="Captured preview"]').waitFor({ timeout: 30_000 });
  check('captured the preview screenshot');

  await page.getByRole('button', { name: 'Generate change' }).click();
  await page.getByText('Review change').waitFor({ timeout: LONG });
  await page.screenshot({ path: 'docs/assets/phase9-forge-diff.png' });
  check('staged a screenshot-driven change with a diff');

  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByText('Change rejected').waitFor({ timeout: 20_000 });
  check('rejected the change');

  await page.getByRole('button', { name: 'Capture preview' }).click();
  await page.locator('img[alt="Captured preview"]').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Generate change' }).click();
  await page.getByText('Review change').waitFor({ timeout: LONG });
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Change approved').waitFor({ timeout: 60_000 });
  await page.getByText(/^v2$/).first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: 'docs/assets/phase9-forge-approved.png' });
  check('approved the second version');

  await page.getByRole('button', { name: 'Undo last change' }).click();
  await page.getByText('Restored the previous approved version').waitFor({ timeout: 20_000 });
  await page.getByText(/^v1$/).first().waitFor({ timeout: 15_000 });
  check('rolled back to the previous approved version');

  if (errors.length > 0) {
    console.error(`  ✗ console/page errors: ${errors.slice(0, 3).join(' | ')}`);
    process.exitCode = 1;
  } else {
    console.log('  ✓ no console or page errors');
  }
  console.log(`\nForge verification: ${checks.length} checks passed (project ${PROJECT}).`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
