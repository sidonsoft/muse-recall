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
  /**
   * Loads the allowlist *permitted* but the network refused, named by origin.
   * An approved-CDN failure is the difference between "the game is broken" and
   * "this machine cannot reach the engine the game needs", and a reviewer can
   * only act on the second one if the report says so.
   */
  remote_failures: string[];
  /**
   * Whether the checked document was held to a no-network policy (it carries
   * its own engine) or to the CDN allowlist (it still asks the network for
   * one). A passed check means different things under each.
   */
  network_policy?: ForgeRuntimeNetworkPolicy;
  /** Remote engine references the check could not vendor, named. */
  vendor_gaps?: string[];
  /** Browser identity/version, when the checker can report it. */
  browser?: string | null;
  /** Explicit launch policy and bounded diagnostics. */
  browser_selection?: ForgeRuntimeBrowserSelection;
}

/*
 * Two network policies, chosen from the document under check rather than
 * declared by the caller. A document that carries the engine itself (KI-53)
 * needs no network at all, so the check grants it none: any outbound request
 * from a vendored artifact is a finding. A document that still points at the
 * approved CDN is checked under the old allowlist, because refusing its engine
 * would report a broken game where the truth is an unvendored dependency — and
 * that difference is recorded in `network_policy` rather than guessed later.
 */
export type ForgeRuntimeNetworkPolicy = 'vendored' | 'cdn-allowlist';

import { externalReferences, VENDOR_MARKER_ATTRIBUTE, vendorGapUrls } from './vendored-scripts.js';

/** The only remote origin a staged application may load during verification. */
const ALLOWED_REMOTE_HOSTS = new Set(['cdn.jsdelivr.net']);

/** Which policy applies to these document bytes. */
export function runtimeNetworkPolicy(html: string): ForgeRuntimeNetworkPolicy {
  return html.includes(`${VENDOR_MARKER_ATTRIBUTE}="`) && externalReferences(html).length === 0
    ? 'vendored'
    : 'cdn-allowlist';
}

/** Network destinations that never leave the machine / are not remote. */
function isLocalScheme(protocol: string): boolean {
  return protocol === 'about:' || protocol === 'data:' || protocol === 'blob:';
}

/** True when a request URL is permitted during headless verification. */
export function isAllowedRuntimeRequest(
  raw: string,
  policy: ForgeRuntimeNetworkPolicy = 'cdn-allowlist',
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Anything unparseable is treated as non-network and left to the browser.
    return true;
  }
  if (isLocalScheme(url.protocol)) return true;
  if (url.protocol !== 'https:') return false;
  // A vendored document was verified with no remote origin at all.
  if (policy === 'vendored') return false;
  return ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase());
}

/*
 * A browser reason can carry the whole URL it failed on
 * (`net::ERR_FAILED https://host/some/path?token=…`). Redaction alone does not
 * make that safe: the path can name the generated page, and a query can hold data
 * the page built. Every URL in the reason is reduced to its origin first, so the
 * only host named anywhere in this text is the one the allowlist permitted.
 */
function stripUrlsToOrigins(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/gi, (found) => {
    try {
      const parsed = new URL(found);
      return parsed.origin;
    } catch {
      return '[url removed]';
    }
  });
}

/**
 * How a permitted-but-failed load is reported. Origin only: the path and any
 * query the generated page built are deliberately dropped, the same rule the
 * blocked-request text follows — including when the *browser reason itself* embeds
 * a URL. 300 is the shared schema bound for one error.
 */
export function remoteLoadFailure(origin: string, errorText: string): string {
  const reason = boundedRedacted(
    stripUrlsToOrigins(errorText.trim().length > 0 ? errorText : 'the connection failed'),
    80,
  );
  return boundedRedacted(
    `A load the allowlist permitted failed (${origin}): ${reason}. ` +
      'An application that gets its engine from the approved CDN cannot be approved while that host is unreachable.',
    MAX_DIAGNOSTIC_TEXT,
  );
}

type BrowserPolicy = 'managed' | 'chrome';

function browserPolicy(): BrowserPolicy | null {
  const configured =
    process.env.FORGE_RUNTIME_BROWSER ??
    (process.env.FORGE_RUNTIME_CHANNEL === 'chrome' ? 'chrome' : 'managed');
  return configured === 'managed' || configured === 'chrome' ? configured : null;
}

const MAX_SELECTION_TEXT = 160;
const MAX_DIAGNOSTIC_TEXT = 300;

/** Bound after redaction, so replacements cannot push a value over its schema limit. */
function boundedRedacted(message: string, limit: number): string {
  const redacted = redactSecrets(message);
  if (redacted.length <= limit) return redacted;
  const marker = '…';
  return `${redacted.slice(0, Math.max(0, limit - marker.length))}${marker}`.slice(0, limit);
}

function browserFailure(
  attempted: string,
  detail: string,
  action: string,
  maxLength = MAX_DIAGNOSTIC_TEXT,
): string {
  // Keep the actionable setup guidance intact and truncate only the raw
  // launcher output. Bound the complete string, not just the detail, because
  // the appended guidance previously made the field exceed its schema limit.
  const boundedDetail = boundedRedacted(detail, 150);
  return boundedRedacted(
    `${attempted} could not be launched. ${action} Details: ${boundedDetail}`,
    maxLength,
  );
}

async function launchVerificationBrowser(): Promise<
  | { browser: Browser; selection: ForgeRuntimeBrowserSelection }
  | { browser: null; selection: ForgeRuntimeBrowserSelection; error: string }
> {
  const policy = browserPolicy();
  if (!policy) {
    const failure = boundedRedacted(
      'Invalid FORGE_RUNTIME_BROWSER value. Use "managed" or "chrome".',
      MAX_DIAGNOSTIC_TEXT,
    );
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
    const action =
      policy === 'managed'
        ? 'Run "pnpm exec playwright-core install chromium" or explicitly set FORGE_RUNTIME_BROWSER=chrome.'
        : 'Install Chrome or set FORGE_RUNTIME_BROWSER=managed after installing Playwright Chromium.';
    const failure = browserFailure(
      attempted,
      error instanceof Error ? error.message : String(error),
      action,
    );
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
      remote_failures: [],
      network_policy: runtimeNetworkPolicy(html),
      vendor_gaps: vendorGapUrls(html),
      browser: null,
      browser_selection: launched.selection,
    };
  }
  const browser = launched.browser;
  const networkPolicy = runtimeNetworkPolicy(html);
  const vendorGaps = vendorGapUrls(html);
  let browserIdentity: string | null = null;
  try {
    browserIdentity = boundedRedacted(`Chromium ${await browser.version()}`, MAX_SELECTION_TEXT);
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
    const remoteFailures: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // A load the allowlist permitted but the network refused. Requests the
    // allowlist rejects never reach here: they are recorded in `blocked`.
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!isAllowedRuntimeRequest(url, networkPolicy)) return;
      try {
        const line = remoteLoadFailure(new URL(url).origin, request.failure()?.errorText ?? '');
        if (!remoteFailures.includes(line)) remoteFailures.push(line);
      } catch {
        // Unparseable URL: the browser's own page/console error still reports it.
      }
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (isAllowedRuntimeRequest(url, networkPolicy)) {
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
    const failure = [...blockedErrors, ...remoteFailures, ...errors];
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
      remote_failures: remoteFailures,
      network_policy: networkPolicy,
      vendor_gaps: vendorGaps,
      browser: browserIdentity,
      browser_selection: selection,
    };
  } finally {
    await browser.close();
  }
}
