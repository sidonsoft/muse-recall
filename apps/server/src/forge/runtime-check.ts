import { chromium } from 'playwright-core';

/**
 * Runs a staged game in a real browser before it can be approved.
 *
 * Structural validation cannot catch a game that throws during scene creation
 * (for example an API that does not exist). This check loads the HTML, waits
 * for the first frames, and fails on page errors or a missing canvas.
 */
export interface RuntimeCheckResult {
  ok: boolean;
  canvas: boolean;
  errors: string[];
}

export async function checkGameRuntime(
  html: string,
  timeoutMs = 20_000,
): Promise<RuntimeCheckResult> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });

    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(1_200);
    const canvas = (await page.locator('canvas').count()) > 0;
    return {
      ok: canvas && errors.length === 0,
      canvas,
      errors: canvas ? errors : ['No canvas element was created.', ...errors],
    };
  } finally {
    await browser.close();
  }
}
