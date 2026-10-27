import { chromium } from 'playwright-core';

/**
 * Runs a staged game in a real browser before it can be approved.
 *
 * Structural validation cannot catch a game that throws during scene creation
 * (for example an API that does not exist). This check loads the HTML, waits
 * for the first frames, and fails on page errors or a missing canvas.
 *
 * It also bounds network access. Generated HTML is untrusted: without a
 * request policy it could POST the page contents (or probe the local network)
 * the moment verification loads it. Only the approved Phaser CDN is reachable;
 * every other request is aborted and reported. This is a load-time check, not
 * a sandbox: it does not follow later interaction.
 */
export interface RuntimeCheckResult {
  ok: boolean;
  canvas: boolean;
  errors: string[];
  /** Requests aborted by the verification allowlist (credentials stripped). */
  blocked: string[];
}

/** The only remote origin a staged game may load during verification. */
const ALLOWED_REMOTE_HOSTS = new Set(['cdn.jsdelivr.net']);

/** Network destinations that never leave the machine / are not remote. */
function isLocalScheme(protocol: string): boolean {
  return protocol === 'about:' || protocol === 'data:' || protocol === 'blob:';
}

/** True when a request URL is permitted during headless verification. */
export function isAllowedRuntimeRequest(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Anything unparseable is treated as non-network and left to the browser.
    return true;
  }
  if (isLocalScheme(url.protocol)) return true;
  if (url.protocol !== 'https:') return false;
  return ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase());
}

export async function checkGameRuntime(
  html: string,
  timeoutMs = 20_000,
): Promise<RuntimeCheckResult> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const blocked: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (isAllowedRuntimeRequest(url)) {
        await route.continue();
        return;
      }
      // A favicon probe is browser noise, not a game request; drop it quietly.
      if (!/favicon/i.test(url)) blocked.push(url);
      await route.abort();
    });

    // `page.route` covers HTTP(S) only. No WebSocket destination is approved,
    // so every socket is closed before it can carry data.
    await page.routeWebSocket(/.*/, (socket) => {
      const url = socket.url();
      if (!/favicon/i.test(url)) blocked.push(url);
      socket.close({ code: 1008, reason: 'Blocked by runtime verification allowlist.' });
    });

    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(1_200);
    const canvas = (await page.locator('canvas').count()) > 0;
    // The full URL is deliberately not echoed: it may embed a query string the
    // generated page built from page data. The origin is enough to act on.
    const blockedErrors = blocked.map((url) => {
      try {
        return `Blocked network request to ${new URL(url).origin}.`;
      } catch {
        return 'Blocked network request.';
      }
    });
    const failure = [...blockedErrors, ...errors];
    return {
      ok: canvas && failure.length === 0,
      canvas,
      errors: canvas ? failure : ['No canvas element was created.', ...failure],
      blocked,
    };
  } finally {
    await browser.close();
  }
}
