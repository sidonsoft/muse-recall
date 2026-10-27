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
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.FORGE_VERIFY_BASE ?? 'http://127.0.0.1:5173';
/** Test output, never historical evidence. `docs/assets` is read-only here. */
const SHOTS = 'test-results/verify-forge';
const PROJECT =
  process.env.FORGE_VERIFY_PROJECT ?? `forge-verify-${Date.now().toString(36).slice(-5)}`;
const LONG = Number(process.env.FORGE_VERIFY_TIMEOUT_MS ?? 900_000);

async function main() {
  mkdirSync(SHOTS, { recursive: true });
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
  await page.screenshot({ path: `${SHOTS}/phase9-forge-generated.png` });
  check('generated a staged game');

  const frame = page.frameLocator('iframe[title="Game preview"]');
  await frame.locator('canvas').waitFor({ timeout: 30_000 });
  check('preview rendered a canvas');

  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Change approved').waitFor({ timeout: 60_000 });
  check('approved the first version');

  await page.getByRole('button', { name: 'Capture preview' }).click();
  await page.locator('img[alt="Captured preview"]').waitFor({ timeout: 30_000 });
  const capture = await page.evaluate(async () => {
    const image = document.querySelector('img[alt="Captured preview"]') as HTMLImageElement | null;
    if (!image) return { min: 0, max: 0, colourful: 0 };
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return { min: 0, max: 0, colourful: 0 };
    context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let min = 255;
    let max = 0;
    let colourful = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < min) min = luminance;
      if (luminance > max) max = luminance;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 12) colourful += 1;
    }
    return { min, max, colourful };
  });
  if (capture.max - capture.min < 8) {
    throw new Error(`captured image is blank (range ${capture.max - capture.min})`);
  }
  const method = await page
    .locator('img[alt="Captured preview"]')
    .getAttribute('data-capture-method');
  if (method !== 'snapshot') {
    throw new Error(`expected a renderer snapshot capture, got ${String(method)}`);
  }
  check(
    `captured a non-blank screenshot via renderer.snapshot (range ${Math.round(capture.max - capture.min)})`,
  );

  await page.getByRole('button', { name: 'Generate change' }).click();
  await page.getByText('Review change').waitFor({ timeout: LONG });
  await page.screenshot({ path: `${SHOTS}/phase9-forge-diff.png` });
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
  await page.screenshot({ path: `${SHOTS}/phase9-forge-approved.png` });
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
