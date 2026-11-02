/**
 * The documented first run, checked rather than assumed.
 *
 * README tells a newcomer to run `MODEL_PROVIDER=echo pnpm dev` and open
 * http://127.0.0.1:5173. Everything that makes a beta install trustworthy — the
 * app mounts, the server is the offline provider, the dev proxy reaches the API,
 * nothing leaves the machine — is observable from that page. It is also the only
 * place some defects appear: React strips development warnings from production
 * bundles, so a duplicate sibling key or an unsafe lifecycle can pass every
 * production-bundle gate and still break the first thing a new user does.
 *
 * The metadata is parsed with the shipped contract (`ServiceMetaSchema`), so a
 * response that stops matching the contract fails here instead of quietly
 * reading as `null`.
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { type ServiceMeta, ServiceMetaSchema } from '../../packages/shared/src/index.js';

/**
 * The one host a generated app may contact. The product allowlists it in the
 * generation prompt, in the preview CSP, and in the approval runtime network
 * check (`apps/server/src/forge/runtime-check.ts`), and the guide documents it:
 * Phaser comes from the CDN. So the first run may touch it and nothing else.
 * Recording it here keeps that dependency visible instead of laundering a
 * "works offline" claim — a generated game does not run without it.
 */
export const ALLOWED_OUTBOUND_HOSTS: readonly string[] = ['cdn.jsdelivr.net'];

/** Ports the README documents for the first run. */
export const DOCUMENTED_PORTS = { api: 8787, web: 5173 } as const;

/** How long to wait for each part of the documented first run to come up. */
export const FIRST_RUN_TIMEOUT_MS = 90_000;

/** Raised when the run cannot be measured at all (busy ports, process died). */
export class FirstRunBlocked extends Error {}

export interface FirstRunUrls {
  webUrl: string;
  apiUrl: string;
}

export function urlsFor(ports: { api: number; web: number }): FirstRunUrls {
  return {
    apiUrl: `http://127.0.0.1:${String(ports.api)}`,
    webUrl: `http://127.0.0.1:${String(ports.web)}/`,
  };
}

/** Is a TCP port in use? A free port refuses the connection. */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((settle) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (busy: boolean): void => {
      socket.destroy();
      settle(busy);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function httpOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function waitUntil(test: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export interface FirstRunServerOptions {
  /** Command that starts the app exactly as the README writes it. */
  command: [string, ...string[]];
  cwd: string;
  logFile: string;
  ports?: { api: number; web: number };
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  /** Test seam for the fake first-run servers used by the harness tests. */
  readiness?: { apiUrl: string; webUrl: string };
}

export interface FirstRunServer<T> {
  value: T;
  startupMs: number;
  /** False when a listener survived the shutdown — a first run should be stoppable. */
  portsReleased: boolean;
}

/**
 * Start the app the documented way, hand its URLs to `work`, then take it down.
 *
 * The child is started in its own process group because `pnpm dev` fans out to
 * the API and the web dev server; killing only the parent would leave the
 * listener the next run is checking for.
 */
export async function withDocumentedFirstRun<T>(
  options: FirstRunServerOptions,
  work: (urls: FirstRunUrls) => Promise<T>,
): Promise<FirstRunServer<T>> {
  const ports = options.ports ?? DOCUMENTED_PORTS;
  const timeoutMs = options.startupTimeoutMs ?? FIRST_RUN_TIMEOUT_MS;
  const urls = urlsFor(ports);
  const ready = options.readiness ?? { apiUrl: `${urls.apiUrl}/api/health`, webUrl: urls.webUrl };

  const busy: number[] = [];
  for (const port of [ports.api, ports.web]) if (await portBusy(port)) busy.push(port);
  if (busy.length > 0) {
    throw new FirstRunBlocked(
      `the ports the README documents for the first run are already in use: ${busy.join(', ')}. ` +
        'Stop whatever holds them and re-run, rather than measuring a different first run.',
    );
  }

  // The start command's own output is kept: when a first run fails to come up,
  // the difference between "the port was taken" and "the dev server crashed" is
  // only visible in what it printed.
  const log = openSync(options.logFile, 'w');
  const started = Date.now();
  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: options.cwd,
    // ACCESS_TOKEN is deliberately unset: an empty value is not a valid token and
    // would change what is being measured.
    env: { ...process.env, MODEL_PROVIDER: 'echo', ...options.env },
    detached: true,
    stdio: ['ignore', log, log],
  });
  let value: T;
  try {
    const apiUp = await waitUntil(() => httpOk(ready.apiUrl), timeoutMs);
    const webUp = await waitUntil(() => httpOk(ready.webUrl), timeoutMs);
    if (!apiUp || !webUp) {
      const died = child.exitCode !== null;
      throw new FirstRunBlocked(
        `${apiUp ? 'the web dev server' : 'the API'} never answered on port ${String(apiUp ? ports.web : ports.api)} ` +
          `within ${String(timeoutMs)}ms; the start command ${died ? `exited with code ${String(child.exitCode)}` : ' stayed running'}`,
      );
    }
    value = await work(urls);
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    closeSync(log);
  }
  // A first run that cannot be stopped is not a first run: the next install
  // would be measured against the leftover listener.
  const released = await waitUntil(
    async () => !(await portBusy(ports.web)) && !(await portBusy(ports.api)),
    15_000,
  );
  return { value, startupMs: Date.now() - started, portsReleased: released };
}

export interface FirstRunObservation {
  apiHealthy: boolean;
  webStatus: number;
  /** Provider id the running server reports; null when /api/meta was unreadable. */
  provider: string | null;
  environment: string | null;
  /**
   * Build commit the server reports. A development run has none — the contract
   * says null means "built without identity (dev/tsx)" — so a non-null value
   * means the check measured some other server.
   */
  buildIdentity: string | null;
  /** Whether the app's root element has children, i.e. React actually mounted. */
  mounted: boolean;
  consoleErrors: string[];
  nonLocalRequests: string[];
  /** Set when the metadata response did not satisfy the shipped contract. */
  metaContractViolation: boolean;
  /** Nav destinations the page was walked through after the first paint. */
  tabsVisited: string[];
  /** Named nav destinations the shell no longer offers. */
  missingTabs: string[];
}

/**
 * Read `/api/meta` through the envelope the server actually sends. The success
 * body is wrapped in `{ ok: true, data: … }`; guessing either shape would let a
 * contract change pass as "the field was absent".
 */
export function readServiceMeta(envelope: { status: number; body: unknown }): {
  meta: ServiceMeta | null;
  violation: boolean;
} {
  if (envelope.status !== 200) return { meta: null, violation: true };
  const body = envelope.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { meta: null, violation: true };
  }
  const data = (body as { data?: unknown }).data ?? body;
  const parsed = ServiceMetaSchema.safeParse(data);
  return parsed.success ? { meta: parsed.data, violation: false } : { meta: null, violation: true };
}

/**
 * Judge the first run. The wording matters: a page that loads but never mounts,
 * or a server that is not the offline provider the README started, is not a
 * working first run even though a browser would show *something*.
 */
export function firstRunIssues(run: FirstRunObservation): string[] {
  const issues: string[] = [];
  if (!run.apiHealthy) issues.push('the API did not answer /api/health on the documented port');
  if (run.webStatus !== 200) issues.push(`the web dev server answered ${run.webStatus}, not 200`);
  if (run.metaContractViolation) {
    issues.push(
      '/api/meta did not satisfy ServiceMetaSchema — the shipped contract and this build disagree',
    );
  }
  if (!run.metaContractViolation && run.provider === null) {
    issues.push('the page could not read /api/meta through the dev proxy');
  }
  if (run.provider !== null && run.provider !== 'echo') {
    issues.push(`the first run started with provider "${run.provider}", not echo`);
  }
  if (run.buildIdentity !== null) {
    issues.push(
      `the first run reported a baked build identity (${run.buildIdentity.slice(0, 12)}), so what started is not the development server the README describes`,
    );
  }
  if (!run.mounted) issues.push('the web app never mounted — the page loaded but rendered nothing');
  if (run.consoleErrors.length > 0) {
    issues.push(
      `the fresh app logged console errors: ${run.consoleErrors.slice(0, 3).join(' | ')}`,
    );
  }
  const unexpected = [...new Set(run.nonLocalRequests)].filter(
    (host) => !ALLOWED_OUTBOUND_HOSTS.includes(host),
  );
  if (unexpected.length > 0) {
    issues.push(
      `the fresh app contacted hosts the product does not allowlist: ${unexpected.slice(0, 3).join(', ')}`,
    );
  }
  if (run.missingTabs.length > 0) {
    issues.push(
      `the app shell no longer offers the screens the guide documents: ${run.missingTabs.join(', ')}`,
    );
  }
  return issues;
}

/**
 * Open the freshly served app and record what it actually does. Console errors
 * carry their arguments, because React puts the offending value (a duplicate
 * sibling key, for instance) in the arguments rather than the formatted message.
 */
export async function inspectFirstRun(options: {
  browser: import('playwright-core').Browser;
  webUrl: string;
  apiUrl: string;
  screenshotTo?: string;
  /**
   * Screens the shell is expected to offer. Console output is captured across
   * the walk, so a warning that only appears on one screen is still caught.
   */
  visitTabs?: string[];
}): Promise<FirstRunObservation> {
  const { browser, webUrl, apiUrl, screenshotTo, visitTabs } = options;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors: string[] = [];
  const nonLocal: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const args = message
      .args()
      .map((arg) => arg.toString())
      .filter((value) => value !== '' && !value.startsWith('JSHandle'))
      .slice(0, 2);
    const text = message.text().slice(0, 240);
    consoleErrors.push(args.length > 0 ? `${text} [${args.join(', ')}]`.slice(0, 320) : text);
  });
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') nonLocal.push(host);
  });
  const response = await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  const webStatus = response?.status() ?? 0;
  let mounted = false;
  try {
    await page.waitForFunction('document.querySelector("#root")?.childElementCount !== 0', null, {
      timeout: 30_000,
    });
    mounted = await page.evaluate('(document.querySelector("#root")?.childElementCount ?? 0) > 0');
  } catch {
    mounted = false;
  }
  // Read the service's own account of itself through the dev proxy, the way the
  // app's own code does. Functions are passed as source strings: the test
  // runner's name-helper is not defined inside the browser.
  const envelope = await page.evaluate<{ status: number; body: unknown }>(`(async () => {
    try {
      const response = await fetch('/api/meta');
      return { status: response.status, body: await response.json() };
    } catch {
      return { status: 0, body: null };
    }
  })()`);
  const { meta, violation } = readServiceMeta(envelope);
  if (screenshotTo) await page.screenshot({ path: screenshotTo });
  const tabsVisited: string[] = [];
  const missingTabs: string[] = [];
  for (const label of visitTabs ?? []) {
    // The shell's screens are buttons, not anchors: asking only for links would
    // report a missing screen that is plainly on the page.
    const link = page
      .getByRole('link', { name: label })
      .or(page.getByRole('button', { name: label }))
      .first();
    if ((await link.count()) === 0) {
      missingTabs.push(label);
      continue;
    }
    await link.click();
    await page.waitForLoadState('domcontentloaded');
    // A screen's own effects run after paint; give them a beat before deciding
    // the console is clean.
    await page.waitForTimeout(800);
    tabsVisited.push(label);
  }
  await page.close();
  return {
    apiHealthy: await httpOk(`${apiUrl}/api/health`),
    webStatus,
    provider: meta?.provider.id ?? null,
    environment: meta?.environment ?? null,
    buildIdentity: meta?.build?.commit ?? null,
    mounted,
    consoleErrors,
    nonLocalRequests: nonLocal,
    metaContractViolation: violation,
    tabsVisited,
    missingTabs,
  };
}
