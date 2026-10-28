import { type ForgeRuntimeBrowserSelection, redactSecrets } from '@mml/shared';
import { type Browser, chromium } from 'playwright-core';

/**
 * Runs a staged browser application in a real browser before it can be approved.
 *
 * Structural validation cannot catch an application that throws while it
 * initialises (for example an API that does not exist). This check loads the
 * HTML, waits for first paint, and fails on page errors or a blank document.
 * A Phaser game must additionally create its canvas; any other application must
 * render visible content.
 *
 * It also bounds network access. Generated HTML is untrusted: without a
 * request policy it could POST the page contents (or probe the local network)
 * the moment verification loads it. Only the approved CDN is reachable; every
 * other request is aborted and reported. This is a load-time check, not
 * a sandbox: it does not follow later interaction.
 */
export interface RuntimeCheckResult {
  ok: boolean;
  /** True when the page created a canvas (expected for Phaser games). */
  canvas: boolean;
  /** True when the document rendered visible text or layout. */
  rendered: boolean;
  errors: string[];
  /** Requests aborted by the verification allowlist (credentials stripped). */
  blocked: string[];
  /** Browser identity/version, when the checker can report it. */
  browser?: string | null;
  /** Explicit launch policy and bounded diagnostics. */
  browser_selection?: ForgeRuntimeBrowserSelection;
}

/** The only remote origin a staged application may load during verification. */
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

type BrowserPolicy = 'managed' | 'chrome';

function browserPolicy(): BrowserPolicy | null {
  const configured =
    process.env.FORGE_RUNTIME_BROWSER ??
    (process.env.FORGE_RUNTIME_CHANNEL === 'chrome' ? 'chrome' : 'managed');
  return configured === 'managed' || configured === 'chrome' ? configured : null;
}

function browserFailure(message: string, maxLength = 300): string {
  return redactSecrets(message, { maxLength });
}

async function launchVerificationBrowser(): Promise<
  | { browser: Browser; selection: ForgeRuntimeBrowserSelection }
  | { browser: null; selection: ForgeRuntimeBrowserSelection; error: string }
> {
  const policy = browserPolicy();
  if (!policy) {
    const failure = 'Invalid FORGE_RUNTIME_BROWSER value. Use "managed" or "chrome".';
    return {
      browser: null,
      selection: {
        policy: 'managed',
        attempted: 'managed Chromium',
        selected: null,
        failure,
      },
      error: failure,
    };
  }
  const attempted = policy === 'managed' ? 'managed Chromium' : 'system Chrome';
  try {
    const browser =
      policy === 'managed'
        ? await chromium.launch({ headless: true })
        : await chromium.launch({ channel: 'chrome', headless: true });
    return {
      browser,
      selection: { policy, attempted, selected: null, failure: null },
    };
  } catch (error) {
    const detail = browserFailure(error instanceof Error ? error.message : String(error));
    const action =
      policy === 'managed'
        ? 'Run "pnpm exec playwright-core install chromium" or explicitly set FORGE_RUNTIME_BROWSER=chrome.'
        : 'Install Chrome or set FORGE_RUNTIME_BROWSER=managed after installing Playwright Chromium.';
    const failure = `${attempted} could not be launched: ${detail}. ${action}`;
    return {
      browser: null,
      selection: { policy, attempted, selected: null, failure },
      error: failure,
    };
  }
}

export async function checkGameRuntime(
  html: string,
  timeoutMs = 20_000,
): Promise<RuntimeCheckResult> {
  const launched = await launchVerificationBrowser();
  if (!launched.browser) {
    return {
      ok: false,
      canvas: false,
      rendered: false,
      errors: [launched.error],
      blocked: [],
      browser: null,
      browser_selection: launched.selection,
    };
  }
  const browser = launched.browser;
  let browserIdentity: string | null = null;
  try {
    browserIdentity = `Chromium ${await browser.version()}`;
  } catch {
    browserIdentity = null;
  }
  const selection: ForgeRuntimeBrowserSelection = {
    ...launched.selection,
    selected: browserIdentity ?? launched.selection.attempted,
  };
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
      // A favicon probe is browser noise, not an application request; drop it quietly.
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
    // A general application has no canvas, so require visible content instead.
    const rendered =
      (await page.evaluate(`(() => {
      const body = document.body;
      if (!body) return false;
      if ((body.innerText || '').trim().length > 0) return true;
      const elements = Array.from(body.querySelectorAll('*'));
      return elements.some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      });
    })()`)) === true;
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
    const reason =
      canvas || rendered
        ? []
        : [
            'The application did not render visible content.',
            ...(/phaser/i.test(html) ? ['No canvas element was created.'] : []),
          ];
    return {
      ok: (canvas || rendered) && failure.length === 0,
      canvas,
      rendered,
      errors: [...reason, ...failure],
      blocked,
      browser: browserIdentity,
      browser_selection: selection,
    };
  } finally {
    await browser.close();
  }
}
