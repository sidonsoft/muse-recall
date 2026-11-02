/**
 * Build a real Muse app for **human** quality review, and package the evidence a
 * person needs to judge it.
 *
 * This is the one workflow in the repository whose output cannot be scored by a
 * gate. Everything else here asks a question with a yes/no answer ("did the
 * restart keep the bytes identical?", "was there exactly one paid dispatch?").
 * The remaining open questions in the beta are judgement: is the generated app
 * good, did it follow the project's decisions, would you hand it to a colleague.
 * So this script spends its machine effort on two things only —
 *
 *   1. producing the app through the product's own path (real coding model, real
 *      approval, real served artifact), and
 *   2. proving whether the evidence it captured is worth judging at all
 *      (`scripts/lib/review-packet.ts`),
 *
 * and then stops. The judgement sheet in `review-packet.md` is left blank on
 * purpose.
 *
 * Cost: exactly **one coding job**, capped by `REVIEW_APP_MAX_CALLS` internal
 * calls (default 12), submitted under an Idempotency-Key so a client-side retry
 * cannot spend a second job. Zero provider media calls: the media adapter traces
 * every dispatch and the run fails its own accounting if any appears.
 *
 * Prerequisites: the configured credential and coding CLI. With no credential the
 * run refuses (exit 2) rather than falling back to the deterministic fake CLI: an
 * app nobody had to pay for is not evidence of model quality.
 *
 * Usage:
 *   FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(command -v muse) pnpm run review:app
 *
 * A further app is one command away:
 *   REVIEW_APP_SLUG=habit-garden REVIEW_APP_BRIEF_FILE=docs/review-apps/habit-garden-brief.md \
 *   REVIEW_APP_DECISIONS_FILE=docs/review-apps/habit-garden-decisions.json pnpm run review:app
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { describeBundleIdentity, verifyBuildProvenance } from './lib/build-provenance.js';
import {
  classifyGateFailure,
  describeGateOutcome,
  GATE_PASS,
  PrerequisiteRefusal,
} from './lib/gate-outcome.js';
import { readCodingJobs, totalCodingCalls } from './lib/media-live.js';
import { accountDispatches, ledgerEvidence, readMediaTrace } from './lib/media-trace.js';
import { type PacketFacts, packetIssues, renderReviewPacket } from './lib/review-packet.js';
import { startupFailureExcerpt } from './lib/server-startup.js';

const ROOT = process.cwd();
const APP = process.env.REVIEW_APP_SLUG?.trim() || 'palette-bench';
const BRIEF_FILE = process.env.REVIEW_APP_BRIEF_FILE?.trim() || `docs/review-apps/${APP}-brief.md`;
const DECISIONS_FILE =
  process.env.REVIEW_APP_DECISIONS_FILE?.trim() || `docs/review-apps/${APP}-decisions.json`;
const MAX_CALLS_PER_JOB = Number(process.env.REVIEW_APP_MAX_CALLS ?? '12');
const CODING_MODEL = process.env.REVIEW_APP_CODING_MODEL?.trim() || 'muse-wonder-1.0';
const PROJECT = `review-${APP}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
const OUT = join(ROOT, 'test-results', 'human-review', `${APP}-${STAMP}`);
const JOB_TIMEOUT_MS = Number(process.env.REVIEW_APP_JOB_TIMEOUT_MS ?? '900000');
/** Steps that bring the app to a used state before the second pair of captures. */
const CAPTURE_STEPS = JSON.parse(process.env.REVIEW_APP_STEPS ?? '[]') as CaptureStep[];

const LOADED_VIA =
  'the artifact bytes loaded as a document from disk (the artifact endpoint itself answers with a JSON envelope for the Studio preview)';

const checks: string[] = [];
const observations: Record<string, unknown> = {};
let dataRoot: string | null = null;
let reportStatus = 'PASS';
let reportOk = true;

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function logPath(name: string): string {
  return join(OUT, `${name}.log`);
}

interface ArtifactInfo {
  version: number | null;
  sha256: string;
  bytes: number;
  lines: number | null;
  title: string;
}

type PageFacts = PacketFacts['page'];

interface Managed {
  child: ChildProcess;
  log: string;
  stop: () => Promise<void>;
}

function start(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): Managed {
  const log = logPath(name);
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const handle = (chunk: Buffer): void => {
    writeFileSync(log, `${readFileSync(log, 'utf8')}${chunk.toString()}`.slice(-2_000_000));
  };
  child.stdout?.on('data', handle);
  child.stderr?.on('data', handle);
  writeFileSync(log, '');
  return {
    child,
    log,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('could not allocate a port');
  return address.port;
}

async function waitForHttp(url: string, timeoutMs = 30_000, logPath?: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timed out waiting for ${url}: ${last}${logPath ? ` — server log: ${startupFailureExcerpt(readFileSync(logPath, 'utf8'))}` : ''}`,
  );
}

function dataOf(body: unknown): Record<string, unknown> {
  const record = body as Record<string, unknown>;
  const data = record.data ?? record;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

async function apiJson(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} -> HTTP ${String(response.status)}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return dataOf(body);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * An interaction the harness performs before taking the second pair of captures.
 *
 * A screenshot of an app sitting in its empty state cannot support a judgement
 * about the thing the app is for: an ungenerated palette tells a reviewer nothing
 * about contrast, colour or hierarchy. So a run may name the steps that get it to
 * a used state. The steps are app-specific on purpose, and every step taken is
 * written into the packet labels, because "the app looked good" and "the app
 * looked good after I pressed Generate" are different observations.
 */
export interface CaptureStep {
  /** Label or `id` of a field to type into. */
  fill?: string;
  /** Value to type, when `fill` is set. */
  value?: string;
  /** Visible text of the control to click. */
  clickText?: string;
}

const STEP_TIMEOUT_MS = 8_000;

/**
 * Apply the steps and return a description of each one actually taken. A step
 * whose target cannot be found fails the run instead of skipping quietly: the
 * capture a reviewer is handed has to say what was done to reach it.
 */
async function runCaptureSteps(page: Page, steps: readonly CaptureStep[]): Promise<string[]> {
  const taken: string[] = [];
  for (const step of steps) {
    if (typeof step.fill === 'string') {
      const field = page
        .getByLabel(step.fill)
        .or(page.locator(`#${step.fill}`))
        .first();
      await field.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      const value = step.value ?? '';
      await field.fill(value);
      taken.push(`typed "${value}" into the field labelled "${step.fill}"`);
    }
    if (typeof step.clickText === 'string') {
      // Prefer a real control. `getByText("Generate")` also matches the helper
      // sentence "Press Enter to generate", and clicking a paragraph succeeds
      // while doing nothing - which would let the packet claim a state change
      // that never happened.
      const button = page.getByRole('button', { name: step.clickText, exact: false }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: STEP_TIMEOUT_MS });
        taken.push(`clicked the button "${step.clickText}"`);
      } else {
        const fallback = page.getByText(step.clickText, { exact: false }).first();
        await fallback.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        await fallback.click();
        taken.push(
          `clicked "${step.clickText}" (no button with that name was found; a text match was used)`,
        );
      }
      await page.waitForTimeout(600);
    }
  }
  return taken;
}

/**
 * Measurable facts about how the app presents itself.
 *
 * None of this is a judgement. A reviewer still decides whether five saturated
 * hues on one screen is a violation of a decision or the whole point of the app.
 * What belongs in the packet is the part that is checkable: which controls have
 * names, how the app reports results, and the measured contrast of text drawn
 * over a solid background - because a decision that says "at least 4.5:1" cannot
 * be judged from the app's own badges, which are self-report.
 *
 * Text over a gradient, an image or a transparent layer counts as not measurable
 * rather than guessed at, and the count travels with the number. The page code
 * travels as a string: `page.evaluate` runs in the browser, and an arrow function
 * compiled by tsx arrives wrapped in a helper that does not exist there.
 */
type AppFacts = NonNullable<PacketFacts['page']['app_facts']>;

async function captureAppFacts(page: Page): Promise<AppFacts | undefined> {
  const facts = await page.evaluate(APP_FACTS_SCRIPT);
  return facts as AppFacts | undefined;
}

/**
 * The page-side measurement, written as plain JavaScript in `String.raw`.
 *
 * Two failure modes this choice avoids, both of which produce a wrong number
 * rather than an error: a function written in TypeScript reaches the browser
 * wrapped in a compile-time helper that does not exist there (`__name is not
 * defined`), and the same code in a plain template literal loses its regex
 * backslashes, so the colour parser silently matches nothing and the contrast
 * count comes back zero — a measurement that reads like a clean result.
 */
const APP_FACTS_SCRIPT = String.raw`(function () {
  function parse(color) {
    const match = /rgba?\(([^)]*)\)/.exec(color);
    const raw = match === null ? '' : match[1];
    if (!raw) return null;
    const values = raw
      .split(/[,\s/]+/)
      .filter(function (v) {
        return v.length > 0;
      })
      .map(Number);
    if (values.length < 3) return null;
    for (const value of values) {
      if (Number.isNaN(value)) return null;
    }
    return {
      r: values[0],
      g: values[1],
      b: values[2],
      a: values.length > 3 ? values[3] : 1,
    };
  }
  function channel(v) {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance(c) {
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }
  function composite(fg, bg) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  }
  function backgroundOf(el) {
    const layers = [];
    let node = el;
    while (node !== null) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      const color = parse(style.backgroundColor);
      if (color !== null && color.a > 0) {
        layers.push(color);
        if (color.a === 1) break;
      }
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) base = composite(layers[i], base);
    return base;
  }
  const named = [];
  let unlabeledControls = 0;
  let unlabeledFields = 0;
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
    const name =
      el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim() || el.id || '';
    if (name !== '') {
      const label = name.slice(0, 24);
      if (named.indexOf(label) === -1) named.push(label);
    }
    // Counted apart from fields on purpose: a text input can never have text
    // content of its own, so mixing the two makes one number meaningless.
    if ((el.textContent || '').trim() === '' && name !== '') {
      if (el.matches('input, textarea, select')) unlabeledFields += 1;
      else unlabeledControls += 1;
    }
  }
  const statusTexts = Array.from(document.querySelectorAll('[role="status"], [aria-live], .status'))
    .map(function (node) {
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    })
    .filter(function (text) {
      return text.length > 0;
    })
    .slice(0, 4);
  let checked = 0;
  let below = 0;
  let skipped = 0;
  const measured = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const ownText = Array.from(el.childNodes).some(function (node) {
      return node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim().length > 0;
    });
    if (!ownText) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const fg = parse(getComputedStyle(el).color);
    const bg = backgroundOf(el);
    if (fg === null || bg === null) {
      skipped += 1;
      continue;
    }
    const fgSolid = composite(fg, bg);
    const a = luminance(fgSolid);
    const b = luminance(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    checked += 1;
    if (ratio < 4.5) below += 1;
    measured.push({ ratio: ratio, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44) });
  }
  measured.sort(function (x, y) {
    return x.ratio - y.ratio;
  });
  const facts = {
    named_controls: named.slice(0, 24),
    controls_without_visible_label: unlabeledControls,
    fields_without_visible_label: unlabeledFields,
    status_texts: statusTexts,
    contrast: { checked: checked, below_4_5: below, worst: measured.slice(0, 3), skipped: skipped },
  };
  if (checked === 0) {
    facts.contrast_note =
      'no text element could be measured against a flat background, so these contrast numbers say nothing about legibility';
  }
  return facts;
})()`;

/** Visible text of the page, excluding the app's own script and style source. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body?.cloneNode(true) as HTMLElement | null;
    clone?.querySelectorAll('script,style,noscript,template').forEach((node) => {
      node.remove();
    });
    return (clone?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/** Distinct colours in a PNG, as a blank-page detector and nothing more. */
function distinctColors(pngBytes: Buffer): number {
  const png = PNG.sync.read(pngBytes);
  const seen = new Set<number>();
  for (let i = 0; i + 2 < png.data.length; i += 4) {
    seen.add(
      (png.data[i] as number) * 65_536 +
        (png.data[i + 1] as number) * 256 +
        (png.data[i + 2] as number),
    );
    if (seen.size > 4_096) break;
  }
  return seen.size;
}

function writeReport(status: string, extra: Record<string, unknown> = {}): void {
  const report = {
    ok: reportOk,
    gate: 'review-app',
    app: APP,
    project: PROJECT,
    stamp: STAMP,
    status,
    paid: {
      coding_jobs: 1,
      max_calls_per_job: MAX_CALLS_PER_JOB,
      idempotency_key: observations.idempotency_key ?? null,
      media_dispatches: observations.media_dispatches ?? null,
      coding_calls_known: observations.coding_calls_known ?? null,
      coding_calls_unknown_jobs: observations.coding_calls_unknown_jobs ?? null,
    },
    checks,
    observations: { ...observations, ...extra },
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * Re-measure an artifact that has already been paid for.
 *
 * A packet is for a person, and a harness defect that mis-measures it (a `data:`
 * fetch counted as network egress, say) must not force a second paid job to
 * correct the numbers. This mode loads the retained bytes, writes a **new**
 * evidence directory with fresh screenshots and a fresh packet, and carries the
 * original run's cost record forward unchanged. The retained packet is not
 * touched: a corrected number and the number it replaced both stay readable.
 */
/**
 * Drive the app into a used state and capture it, returning screenshot entries.
 */
async function captureUsedState(page: Page, prefix: string): Promise<ScreenshotEntry[]> {
  observations.app_facts_initial = await captureAppFacts(page);
  const before = await visibleText(page);
  const taken = await runCaptureSteps(page, CAPTURE_STEPS);
  const after = await visibleText(page);
  const changed = before !== after;
  observations.capture_steps = taken;
  observations.capture_changed_the_page = changed;
  if (!changed) {
    // Say it out loud: the second pair of captures is not a different state, and
    // a reviewer must not be told it is.
    taken.push(
      'the visible text did not change after these steps, so the "used state" captures show the same screen',
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  const desktop = await page.screenshot({
    path: join(OUT, `${prefix}-used-1280.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const phone = await page.screenshot({
    path: join(OUT, `${prefix}-used-390.png`),
    fullPage: true,
  });
  observations.distinct_colors_used_state = distinctColors(desktop);
  observations.app_facts = await captureAppFacts(page);
  const label = `after ${taken.join('; ')}`;
  return [
    {
      name: `${prefix}-used-1280.png`,
      label: `desktop 1280×800, full page, ${label}`,
      bytes: desktop.length,
    },
    {
      name: `${prefix}-used-390.png`,
      label: `phone 390×844, full page, ${label}`,
      bytes: phone.length,
    },
  ];
}

type ScreenshotEntry = PacketFacts['screenshots'][number];
let usedStateShots: ScreenshotEntry[] = [];

/**
 * The re-measure path owns a browser. A failure inside it must not leave that
 * browser connected: the run would then sit until something external kills it,
 * which is how a broken capture turned into a timeout with no verdict.
 */
let activePage: Page | null = null;
let activeBrowser: Browser | null = null;

async function remeasure(sourceDir: string): Promise<void> {
  try {
    await remeasureFromBytes(sourceDir);
  } finally {
    await activePage?.close().catch(() => undefined);
    await activeBrowser?.close().catch(() => undefined);
    activePage = null;
    activeBrowser = null;
  }
}

async function remeasureFromBytes(sourceDir: string): Promise<void> {
  const sourceReport = JSON.parse(readFileSync(join(sourceDir, 'report.json'), 'utf8')) as {
    observations?: Record<string, unknown>;
    paid?: Record<string, unknown>;
    app?: string;
  };
  const htmlPath = join(sourceDir, 'artifact.html');
  if (!existsSync(htmlPath))
    throw new PrerequisiteRefusal(`${sourceDir} holds no artifact.html to re-measure`);
  const sourceObservations = sourceReport.observations ?? {};
  const html = readFileSync(htmlPath, 'utf8');
  const recordedSha = String(
    ((sourceObservations.artifact as Record<string, unknown> | undefined)?.sha256 as string) ?? '',
  );
  if (recordedSha.length > 0 && recordedSha !== sha256(html)) {
    throw new Error(
      `the retained artifact no longer matches the hash its own report recorded (${recordedSha.slice(0, 12)}... expected): refusing to publish a packet about bytes that changed`,
    );
  }

  const launched = await launchVerificationBrowser();
  const browser = launched.browser;
  const page = await browser.newPage();
  activeBrowser = browser;
  activePage = page;
  const consoleErrors: string[] = [];
  const httpFailures: string[] = [];
  const nonLocal: string[] = [];
  const nonHttp: string[] = [];
  const nativeDialogs: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 200)));
  page.on('dialog', (dialog) =>
    nativeDialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 80)}`),
  );
  page.on('requestfailed', (request) =>
    httpFailures.push(`${request.method()} ${request.url()}`.slice(0, 200)),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      httpFailures.push(`${String(response.status())} ${response.url()}`.slice(0, 200));
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      nonHttp.push(url.protocol);
      return;
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') nonLocal.push(url.hostname);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
  await page.waitForTimeout(1_500);
  const shot = await page.screenshot({ path: join(OUT, 'app-1280.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobile = await page.screenshot({ path: join(OUT, 'app-390.png'), fullPage: true });
  if (CAPTURE_STEPS.length > 0) {
    usedStateShots = await captureUsedState(page, 'app');
  }
  const domFacts = await page.evaluate(() => ({
    title: document.title,
    controls: document.querySelectorAll('button, input, select, a[href], textarea').length,
    text_length: (() => {
      const clone = document.body?.cloneNode(true) as HTMLElement | null;
      clone?.querySelectorAll('script,style,noscript,template').forEach((node) => {
        node.remove();
      });
      return (clone?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    })(),
  }));

  copyFileSync(htmlPath, join(OUT, 'artifact.html'));
  writeFileSync(join(OUT, 'brief.md'), readFileSync(join(sourceDir, 'brief.md'), 'utf8'));
  copyFileSync(join(sourceDir, 'decisions-requested.json'), join(OUT, 'decisions-requested.json'));

  const pageInfo: PageFacts = {
    title: domFacts.title,
    distinct_colors_used_state:
      typeof observations.distinct_colors_used_state === 'number'
        ? observations.distinct_colors_used_state
        : undefined,
    native_dialogs: Array.isArray(observations.native_dialogs)
      ? (observations.native_dialogs as string[])
      : undefined,
    app_facts: (observations.app_facts as PacketFacts['page']['app_facts']) ?? undefined,
    interactive_controls: domFacts.controls,
    distinct_colors: distinctColors(shot),
    console_errors: consoleErrors.length,
    http_failures: httpFailures.length,
    non_local_requests: [...new Set(nonLocal)],
  };
  observations.remeasured_from = sourceDir;
  observations.non_http_requests = [...new Set(nonHttp)];
  observations.native_dialogs = nativeDialogs;
  observations.page = { ...pageInfo, visible_text_characters: domFacts.text_length };
  observations.artifact_endpoint_content_type =
    sourceObservations.artifact_endpoint_content_type ?? 'not recorded';
  observations.credential_basis = sourceObservations.credential_basis ?? 'not recorded';
  observations.coding_cli = sourceObservations.coding_cli ?? 'not recorded';
  observations.decisions = sourceObservations.decisions ?? [];
  observations.buildProvenance = sourceObservations.buildProvenance ?? {};
  observations.coding_job_records = sourceObservations.coding_job_records ?? [];
  observations.artifact = sourceObservations.artifact ?? {};
  observations.media_dispatches = sourceObservations.media_dispatches ?? 0;
  observations.media_ledger = sourceObservations.media_ledger ?? {};
  check(
    `re-measured the retained artifact at no cost: ${String(pageInfo.interactive_controls)} control(s), ${String(pageInfo.distinct_colors)} colour(s), ${String(pageInfo.console_errors)} console error(s)`,
  );

  const facts: PacketFacts = {
    project: PROJECT,
    app_name: APP,
    brief_path: BRIEF_FILE,
    created_at: new Date().toISOString(),
    commit: String(
      (observations.buildProvenance as Record<string, unknown>).commit ?? 'not recorded',
    ),
    bundle_identity: {
      server_build_hash: String(
        (observations.buildProvenance as Record<string, unknown>).serverBuildHash ?? '',
      ),
      web_build_hash: String(
        (observations.buildProvenance as Record<string, unknown>).webBuildHash ?? '',
      ),
      supports_commit_identity: Boolean(
        (observations.buildProvenance as Record<string, unknown>).supportsCommitIdentity,
      ),
      note: String(
        (observations.buildProvenance as Record<string, unknown>).identity_note ?? 'not recorded',
      ),
    },
    decisions: observations.decisions as PacketFacts['decisions'],
    job: {
      id: String(
        ((sourceObservations.job as Record<string, unknown> | undefined)?.id as string) ??
          'not recorded',
      ),
      coding_cli: String(observations.coding_cli),
      kind: 'generate',
      status: String(
        (observations.coding_job_records as Record<string, unknown>[])[0]?.status ?? 'succeeded',
      ),
      usage_calls: Number(
        ((observations.coding_job_records as Record<string, unknown>[])[0]
          ?.usage_calls as number) ?? 0,
      ),
      model_observed:
        String(
          ((observations.coding_job_records as Record<string, unknown>[])[0]
            ?.model_observed as string) ?? 'not recorded',
        ) ?? null,
    },
    artifact: {
      version: Number((observations.artifact as Record<string, unknown>).version ?? 1),
      sha256: String((observations.artifact as Record<string, unknown>).sha256 ?? ''),
      bytes: Buffer.byteLength(html, 'utf8'),
      saved_to: join('test-results', 'human-review', `${APP}-${STAMP}`, 'artifact.html'),
    },
    media_dispatches: Number(observations.media_dispatches ?? 0),
    screenshots: [
      {
        name: 'app-1280.png',
        label: 'desktop 1280×800, full page, initial state',
        bytes: shot.length,
      },
      {
        name: 'app-390.png',
        label: 'phone 390×844, full page, initial state',
        bytes: mobile.length,
      },
      ...usedStateShots,
    ],
    page: pageInfo,
    loaded_via: `${LOADED_VIA}; re-measured from the retained bytes without a second job`,
    credential_basis: String(observations.credential_basis),
  };
  const issues = packetIssues(facts);
  writeFileSync(join(OUT, 'review-packet.md'), renderReviewPacket(facts, issues));
  observations.packet_issues = issues;
  reportStatus = 'PASS (re-measured, no provider call)';
  writeReport(reportStatus, { paid_basis_carried_forward: sourceReport.paid ?? null });
  console.log(
    `\nPASS (re-measured): ${String(checks.length)} check(s) — packet: ${join(OUT, 'review-packet.md')} — 0 provider calls`,
  );
}

async function main(): Promise<void> {
  const remeasureDir = process.env.REVIEW_APP_REMEASURE_DIR?.trim();
  if (remeasureDir && remeasureDir.length > 0) {
    mkdirp(OUT);
    await remeasure(isAbsolute(remeasureDir) ? remeasureDir : join(ROOT, remeasureDir));
    return;
  }
  const briefPath = join(ROOT, BRIEF_FILE);
  const decisionsPath = join(ROOT, DECISIONS_FILE);
  if (!existsSync(briefPath)) {
    throw new PrerequisiteRefusal(
      `no brief at ${BRIEF_FILE}: an app needs a brief before it can be judged`,
    );
  }
  if (!existsSync(decisionsPath)) {
    throw new PrerequisiteRefusal(
      `no decisions file at ${DECISIONS_FILE}: the review asks whether the app followed decisions that were never seeded`,
    );
  }
  const bin = process.env.FORGE_MUSE_BIN?.trim() ?? '';
  if (bin.length === 0 || !existsSync(bin)) {
    throw new PrerequisiteRefusal(
      `FORGE_MUSE_BIN must name a real coding CLI (got "${bin || '(unset)'}")`,
    );
  }
  // The product's own rule is that an unset Forge key means the coding CLI rides
  // its own login (.env says so; the runner only passes --api-key-stdin when a
  // key exists). A review run has to say who paid, so the basis is either the
  // key or an explicit opt-in to the CLI login.
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  const storedCliAuth = process.env.REVIEW_APP_ALLOW_STORED_CLI_AUTH === '1';
  if (key.length === 0 && !storedCliAuth) {
    throw new PrerequisiteRefusal(
      'no FORGE_MUSE_API_KEY in the environment and REVIEW_APP_ALLOW_STORED_CLI_AUTH is not set: this run would spend against the logged-in coding CLI, and the packet has to name that basis. Set the key, or set REVIEW_APP_ALLOW_STORED_CLI_AUTH=1 to accept the CLI login as the basis.',
    );
  }
  const credentialBasis =
    key.length > 0
      ? 'FORGE_MUSE_API_KEY, delivered to the coding CLI over stdin like every other credential'
      : 'the logged-in coding CLI: no FORGE_MUSE_API_KEY was set, so the spend lands on whatever account that CLI is authenticated to';
  observations.credential_basis = credentialBasis;
  if (!Number.isInteger(MAX_CALLS_PER_JOB) || MAX_CALLS_PER_JOB < 1 || MAX_CALLS_PER_JOB > 30) {
    throw new PrerequisiteRefusal(
      `REVIEW_APP_MAX_CALLS must be an integer between 1 and 30 (got ${String(MAX_CALLS_PER_JOB)})`,
    );
  }

  const brief = readFileSync(briefPath, 'utf8');
  const seeded = JSON.parse(readFileSync(decisionsPath, 'utf8')) as {
    decisions?: { type?: string; content?: string; confidence?: number; tags?: string[] }[];
  };
  if (!Array.isArray(seeded.decisions) || seeded.decisions.length === 0) {
    throw new PrerequisiteRefusal(`${DECISIONS_FILE} holds no decisions`);
  }

  mkdirp(OUT);
  writeFileSync(join(OUT, 'brief.md'), brief);
  copyFileSync(decisionsPath, join(OUT, 'decisions-requested.json'));

  const provenance = verifyBuildProvenance({ root: ROOT });
  const identity = describeBundleIdentity(provenance);
  observations.buildProvenance = {
    commit: provenance.commit,
    treeClean: provenance.treeClean,
    bundlesBuiltAtHead: identity.builtAtHead,
    bundlesBuiltFromCleanTree: identity.builtFromCleanTree,
    bundlesBuiltAtCommit: identity.builtAtCommit,
    supportsCommitIdentity: identity.supportsCommitIdentity,
    serverBuildHash: identity.serverBuildHash,
    webBuildHash: identity.webBuildHash,
    identity_note: identity.note,
  };
  console.log(`  bundles: ${identity.note}`);

  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);
  check(`browser available: ${launched.selection.selected ?? launched.selection.attempted}`);

  const serverPort = await freePort();
  dataRoot = mkdtempSync(join(tmpdir(), `review-app-${APP}-`));
  const apiBase = `http://127.0.0.1:${serverPort}`;

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATABASE_PATH: join(dataRoot, 'memory.db'),
    WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
    CORS_ORIGINS: apiBase,
    MODEL_PROVIDER: 'echo',
    LOG_LEVEL: 'warn',
    FORGE_MUSE_BIN: bin,
    FORGE_MUSE_MODEL: CODING_MODEL,
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_CALLS: String(MAX_CALLS_PER_JOB),
    FORGE_MAX_RUNTIME_MS: '600000',
    // No media call should happen at all; if one does, the ledger has to show it.
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
  };
  // A credential set to the empty string is not "unset" to the config parser: it
  // fails the >=10-character rule and the server dies with a message about key
  // length. The key is only ever added when it is real.
  for (const name of ['FORGE_MUSE_API_KEY', 'FORGE_FALLBACK_API_KEY', 'META_API_KEY']) {
    if ((serverEnv[name] ?? '').trim().length === 0) delete serverEnv[name];
  }
  if (key.length > 0) serverEnv.FORGE_MUSE_API_KEY = key;
  const server = start(
    'api',
    process.execPath,
    [join(ROOT, 'apps/server/dist/index.js')],
    serverEnv,
  );
  try {
    await waitForHttp(`${apiBase}/api/health`, 30_000, server.log);
    check('started the production API on an isolated database and workspace');

    await apiJson(apiBase, '/api/forge/projects', {
      method: 'POST',
      body: JSON.stringify({ project_id: PROJECT, name: `${APP} (human review)` }),
    });

    const decisions: PacketFacts['decisions'] = [];
    for (const decision of seeded.decisions ?? []) {
      if (typeof decision.content !== 'string' || typeof decision.type !== 'string') {
        throw new Error('a seeded decision is missing type or content');
      }
      const created = await apiJson(apiBase, '/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          type: decision.type,
          scope: 'project',
          project_id: PROJECT,
          content: decision.content,
          confidence: decision.confidence ?? 0.9,
          validation_status: 'verified',
          tags: decision.tags ?? [],
        }),
      });
      const memory = (created.memory ?? created) as Record<string, unknown>;
      if (typeof memory.id !== 'string' || typeof memory.revision !== 'number') {
        throw new Error('the memory API returned a decision without an id and revision');
      }
      decisions.push({
        id: memory.id,
        revision: memory.revision,
        type: decision.type,
        content: decision.content,
      });
    }
    check(`seeded ${String(decisions.length)} project decisions at pinned revisions`);
    observations.decisions = decisions;

    // One job, submitted once, under an Idempotency-Key: if the response is lost
    // the replay returns the recorded answer instead of starting a second job.
    const idempotencyKey = randomUUID();
    observations.idempotency_key = idempotencyKey;
    const job = dataOf(
      await apiJson(apiBase, `/api/forge/projects/${PROJECT}/generate`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ prompt: brief }),
      }),
    );
    const jobId = typeof job.id === 'string' ? job.id : '';
    if (jobId.length === 0) throw new Error('the generate call returned no job id');
    let jobStatus = typeof job.status === 'string' ? job.status : 'queued';
    let jobKind = typeof job.kind === 'string' ? job.kind : 'generate';
    let jobUsageCalls: number | null = null;
    let jobModel: string | null = null;
    observations.job = { id: jobId, kind: jobKind, status: jobStatus };
    check(
      `submitted one generate job (${jobId.slice(0, 8)}) capped at ${String(MAX_CALLS_PER_JOB)} internal calls`,
    );

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (jobStatus === 'queued' || jobStatus === 'running') {
      if (Date.now() > deadline) {
        await apiJson(apiBase, `/api/forge/jobs/${jobId}/cancel`, { method: 'POST' }).catch(
          () => undefined,
        );
        throw new Error(
          `coding job ${jobId.slice(0, 8)} did not finish within ${String(JOB_TIMEOUT_MS)}ms and was cancelled`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const polled = dataOf(await apiJson(apiBase, `/api/forge/jobs/${jobId}`));
      if (typeof polled.status === 'string') jobStatus = polled.status;
      if (typeof polled.kind === 'string') jobKind = polled.kind;
      const usage = polled.usage as Record<string, unknown> | undefined;
      if (typeof usage?.calls === 'number') jobUsageCalls = usage.calls;
      if (typeof polled.model_observed === 'string') jobModel = polled.model_observed;
      observations.job = {
        id: jobId,
        kind: jobKind,
        status: jobStatus,
        usage_calls: jobUsageCalls,
        model_observed: jobModel,
      };
    }
    if (jobStatus !== 'succeeded') {
      throw new Error(`the coding job ended ${jobStatus}: nothing was staged to approve`);
    }
    check(`the coding CLI staged a version (model ${jobModel ?? 'unnamed'}, CLI ${bin})`);
    observations.coding_cli = bin;

    await apiJson(apiBase, `/api/forge/jobs/${jobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ capture_memory: false }),
    });
    const artifact = dataOf(await apiJson(apiBase, `/api/forge/projects/${PROJECT}/artifact`));
    const html = typeof artifact.html === 'string' ? artifact.html : '';
    const sha = typeof artifact.sha256 === 'string' ? artifact.sha256 : '';
    if (html.length === 0) throw new Error('the approved artifact holds no HTML');
    if (sha !== sha256(html)) {
      throw new Error('the artifact hash the API reported does not match the bytes it returned');
    }
    writeFileSync(join(OUT, 'artifact.html'), html);
    const artifactInfo: ArtifactInfo = {
      version: typeof artifact.version === 'number' ? artifact.version : null,
      sha256: sha,
      bytes: Buffer.byteLength(html, 'utf8'),
      lines: typeof artifact.lines === 'number' ? artifact.lines : null,
      title: typeof artifact.title === 'string' ? artifact.title : '',
    };
    observations.artifact = { ...artifactInfo, saved_to: 'artifact.html' };
    check(
      `approved v${String(artifactInfo.version ?? '?')} and saved the artifact (${String(artifactInfo.bytes)} bytes)`,
    );

    // Read the job back out of the workspace isolate as well: the API's own
    // numbers describe what it thinks it did, the record says what it spent.
    const jobs = readCodingJobs(join(dataRoot, 'workspaces', 'forge', PROJECT));
    const totals = totalCodingCalls(jobs);
    observations.coding_job_records = jobs;
    observations.coding_calls_known = totals.known;
    observations.coding_calls_unknown_jobs = totals.unknownJobs;
    const record = jobs.find((entry) => entry.job_id === jobId) ?? jobs[0];

    const trace = accountDispatches(readMediaTrace(server.log));
    observations.media_dispatches = trace.dispatches.length;
    observations.media_ledger = { ...ledgerEvidence(server.log), dispatch_paths: trace.paths };
    if (trace.dispatches.length > 0) {
      throw new Error(
        `this app was supposed to cost no media call and the ledger shows ${String(trace.dispatches.length)}: ${trace.paths.join(', ')}`,
      );
    }
    check('the ledger records zero provider media calls');

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const httpFailures: string[] = [];
    const nonLocal: string[] = [];
    const nonHttp: string[] = [];
    const nativeDialogs: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 200)));
    page.on('dialog', (dialog) =>
      nativeDialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 80)}`),
    );
    page.on('requestfailed', (request) =>
      httpFailures.push(`${request.method()} ${request.url()}`.slice(0, 200)),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        httpFailures.push(`${String(response.status())} ${response.url()}`.slice(0, 200));
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        // A data:/blob: fetch is the app carrying its own bytes, which is what
        // a self-contained brief asks for. Counting it as network egress would
        // flag the compliance as a violation.
        nonHttp.push(url.protocol);
        return;
      }
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') nonLocal.push(url.hostname);
    });
    // The artifact endpoint answers with a JSON envelope, which is what the
    // Studio reads to render its sandboxed preview. Judging the app means
    // loading the artifact bytes as a document, so the screenshot shows the app
    // rather than the transport. This is recorded in the packet, because an app
    // seen through the product's own preview could behave differently.
    const endpointResponse = await fetch(`${apiBase}/api/forge/projects/${PROJECT}/artifact`);
    observations.artifact_endpoint_content_type =
      endpointResponse.headers.get('content-type') ?? 'none';
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`file://${join(OUT, 'artifact.html')}`, { waitUntil: 'load' });
    await page.waitForTimeout(1_500);
    const shot = await page.screenshot({ path: join(OUT, 'app-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const mobile = await page.screenshot({ path: join(OUT, 'app-390.png'), fullPage: true });
    if (CAPTURE_STEPS.length > 0) {
      usedStateShots = await captureUsedState(page, 'app');
    }
    const domFacts = await page.evaluate(() => ({
      title: document.title,
      controls: document.querySelectorAll('button, input, select, a[href], textarea').length,
      // textContent alone would count the app's own <script> and <style> source
      // as visible text, which is how a 464-line file looks like an essay.
      text_length: (() => {
        const clone = document.body?.cloneNode(true) as HTMLElement | null;
        clone?.querySelectorAll('script,style,noscript,template').forEach((node) => {
          node.remove();
        });
        return (clone?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      })(),
    }));
    await page.close();

    const pageInfo: PageFacts = {
      title: domFacts.title,
      distinct_colors_used_state:
        typeof observations.distinct_colors_used_state === 'number'
          ? observations.distinct_colors_used_state
          : undefined,
      native_dialogs: Array.isArray(observations.native_dialogs)
        ? (observations.native_dialogs as string[])
        : undefined,
      app_facts: (observations.app_facts as PacketFacts['page']['app_facts']) ?? undefined,
      interactive_controls: domFacts.controls,
      distinct_colors: distinctColors(shot),
      console_errors: consoleErrors.length,
      http_failures: httpFailures.length,
      non_local_requests: [...new Set(nonLocal)],
    };
    observations.non_http_requests = [...new Set(nonHttp)];
    observations.native_dialogs = nativeDialogs;
    observations.page = { ...pageInfo, visible_text_characters: domFacts.text_length };
    observations.console_errors = consoleErrors;
    check(
      `the approved artifact loads: ${String(pageInfo.interactive_controls)} control(s), ${String(pageInfo.distinct_colors)} distinct colour(s), ${String(pageInfo.console_errors)} console error(s)`,
    );

    const facts: PacketFacts = {
      project: PROJECT,
      app_name: APP,
      brief_path: BRIEF_FILE,
      created_at: new Date().toISOString(),
      commit: provenance.commit,
      bundle_identity: {
        server_build_hash: identity.serverBuildHash,
        web_build_hash: identity.webBuildHash,
        supports_commit_identity: identity.supportsCommitIdentity,
        note: identity.note,
      },
      decisions,
      job: {
        id: jobId,
        coding_cli: bin,
        kind: jobKind === 'modify' ? 'modify' : 'generate',
        status: jobStatus,
        usage_calls: record?.usage_calls ?? jobUsageCalls,
        model_observed: record?.model_observed ?? jobModel,
      },
      artifact: {
        version: artifactInfo.version,
        sha256: artifactInfo.sha256,
        bytes: artifactInfo.bytes,
        saved_to: join('test-results', 'human-review', `${APP}-${STAMP}`, 'artifact.html'),
      },
      media_dispatches: observations.media_dispatches as number,
      screenshots: [
        {
          name: 'app-1280.png',
          label: 'desktop 1280×800, full page, initial state',
          bytes: shot.length,
        },
        {
          name: 'app-390.png',
          label: 'phone 390×844, full page, initial state',
          bytes: mobile.length,
        },
        ...usedStateShots,
      ],
      page: pageInfo,
      loaded_via: LOADED_VIA,
      credential_basis: credentialBasis,
    };
    const issues = packetIssues(facts);
    writeFileSync(join(OUT, 'review-packet.md'), renderReviewPacket(facts, issues));
    observations.packet_issues = issues;
    check(
      `wrote the judgement sheet (${String(issues.length)} evidence issue(s) flagged) in review-packet.md`,
    );

    cpSync(dataRoot, join(OUT, 'isolate'), { recursive: true });
    reportOk = true;
    reportStatus = 'PASS';
    writeReport(reportStatus);
    console.log(
      `\nPASS: ${String(checks.length)} checks — packet: ${join(OUT, 'review-packet.md')}`,
    );
    console.log(
      `  cost: 1 coding job, ${String(observations.coding_calls_known)} internal call(s) known, ${String(observations.media_dispatches)} media call(s)`,
    );
  } finally {
    await server.stop().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

main().then(
  async () => {
    process.exitCode = GATE_PASS.exitCode;
  },
  async (error: unknown) => {
    const outcome = classifyGateFailure(error);
    reportOk = false;
    reportStatus =
      outcome.kind === 'blocked' ? `BLOCKED: ${outcome.reason}` : `FAILED: ${outcome.reason}`;
    console.error(`\n${describeGateOutcome(outcome)}`);
    if (outcome.kind === 'failed')
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    try {
      writeReport(reportStatus);
      if (dataRoot && existsSync(dataRoot)) {
        cpSync(dataRoot, join(OUT, 'isolate-at-failure'), { recursive: true });
      }
    } catch {
      /* evidence is best effort */
    }
    console.error(`evidence: ${OUT}`);
    process.exitCode = outcome.exitCode;
  },
);
