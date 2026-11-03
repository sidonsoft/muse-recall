/**
 * `verify:artifact-probes` — sequence probes for a generated artifact.
 *
 * Two modes, and they answer different questions:
 *
 * **Fixture mode (default, the one CI runs).** Seven single-defect fixtures plus one clean baseline.
 * Each knob is exactly one deliberate defect, and the gate requires that the matching probe flags it
 * and that the other probes stay clean. A battery that cannot make that distinction is not measuring
 * anything, and would print "no findings" over the defect it was written to catch.
 *
 * **Packet mode (`PROBE_PACKET=<packet-dir>`).** Runs the same sequences against the retained bytes of
 * a review packet and records what it finds. A defect in a generated application is a measurement of
 * that application, not a product failure: packet mode reports and never fails the product build. The
 * packet is never rewritten.
 *
 * The outcome vocabulary is the point (KI-87). Each sequence reports exactly one of:
 *
 * - `FINDING`     the sequence ran and something measurable was wrong
 * - `CLEAN`       the sequence ran and nothing measurable was wrong
 * - `NOT TESTED`  the sequence was skipped, with the reason named (no such affordance here)
 * - `INCOMPLETE`  the sequence started and could not be finished, with the reason named
 *
 * `issues: []` and "no findings" are not evidence that an application is defect-free, and this gate
 * says so on the terminal rather than leaving the reader to remember it.
 *
 * Why it exists at all: the human review of Palette Bench found a stale published output (KI-88), a
 * seed domain wider than the generator (KI-89) and undo that dies on reload (KI-90) by thinking about
 * sequences the capture had never driven, while that capture reported `issues: []` over all three.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { Browser, ElementHandle, Locator, Page } from 'playwright-core';
import {
  CLEAN_KNOBS,
  DEFECTIVE_KNOBS,
  FIXTURE_CONTROLS,
  type FixtureKnobs,
  probeFixture,
} from './lib/artifact-probe-fixtures.ts';
import {
  errorThenRetry,
  findingsOf,
  hexTokens,
  inputDomainCollision,
  narrowViewport,
  type ProbeResult,
  reloadPersistence,
  renderProbeResults,
  stalePublication,
  undoWithinSession,
  unique,
} from './lib/artifact-probes.js';
import {
  BrowserUnavailableError,
  launchVerificationBrowser,
  reportBrowserSelection,
} from './lib/browser.js';
import { evidenceStamp, uniqueEvidenceDir } from './lib/evidence-dir.js';
import { classifyGateFailure, type GateFailure } from './lib/gate-outcome.js';

const ROOT = process.cwd();
const OUT = uniqueEvidenceDir(join(ROOT, 'test-results', 'artifact-probes'), evidenceStamp()).path;
const PHONE = { width: 390, height: 844 };
const checks: string[] = [];
const observations: Record<string, unknown> = {};

function check(claim: string): void {
  checks.push(claim);
  console.log(`  ✓ ${claim}`);
}

/** Which control names a sequence needs, by accessible name. */
interface Interactions {
  fill?: { label: string; value: string };
  /** A value the field can be made to take that the application should reject. */
  invalid_value?: string;
  regenerate: string;
  publish: string;
  copy?: string;
  destructive?: string;
  undo?: string;
}

const PROBE_NAMES = [
  'export-then-regenerate-then-export',
  'copy-after-state-change',
  'distinct-accepted-inputs',
  'destructive-then-undo',
  'destructive-then-reload-recovery',
  'narrow-viewport-interaction',
  'invalid-input-then-retry',
] as const;

/* ------------------------------------------------------------------ *
 * Serving bytes over a real origin
 * ------------------------------------------------------------------ */

let server: Server | null = null;

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server === null) return resolve();
    const active = server;
    server = null;
    active.close(() => resolve());
  });
}

/**
 * Bytes are served over `http://127.0.0.1`, never `file://`. A file document has an opaque origin, and
 * the clipboard API refuses to run there — which is precisely where KI-88's stale palette was hiding.
 */
async function serveBytes(bytes: string): Promise<string> {
  const active = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => active.listen(0, '127.0.0.1', resolve));
  server = active;
  const address = active.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the probe server did not report a port');
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

/* ------------------------------------------------------------------ *
 * Measurement primitives
 * ------------------------------------------------------------------ */

async function displayedColours(page: Page): Promise<string[]> {
  // `innerText`, deliberately, and the lint rule gets a refusal rather than a fix: it wants
  // `textContent`, which reads hidden elements too. "The colours the application is displaying" has to
  // mean the ones a person can see — a swatch hidden by CSS is not a colour on screen, and counting it
  // would let the probe report a stale export nobody could notice.
  // biome-ignore lint/performance/useDomNodeTextContent: displayed means rendered, and hidden is not displayed
  return hexTokens(await page.evaluate(() => document.body.innerText));
}

async function renderedText(page: Page): Promise<string> {
  // biome-ignore lint/performance/useDomNodeTextContent: same reason as above — rendered text is the claim
  return page.evaluate(() => document.body.innerText);
}

async function publishedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    let best = '';
    for (const region of Array.from(document.querySelectorAll('textarea, pre'))) {
      const value = 'value' in region ? String(region.value) : (region.textContent ?? '');
      if (value.length > best.length) best = value;
    }
    return best;
  });
}

async function clipboardText(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    });
  } catch {
    return null;
  }
}

async function statusText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const regions = Array.from(document.querySelectorAll('[role=status], [aria-live], output'));
    return regions
      .map((region) => (region.textContent ?? '').trim())
      .filter((text) => text !== '')
      .join(' | ');
  });
}

async function usesStorage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.length > 0;
    } catch {
      return false;
    }
  });
}

function control(page: Page, name: string): Locator {
  return page.getByRole('button', { name });
}

async function controlCount(page: Page, name: string | undefined): Promise<number> {
  if (!name) return 0;
  return await control(page, name).count();
}

async function fieldFor(page: Page, how: Interactions): Promise<Locator | null> {
  if (how.fill) {
    const byLabel = page.getByLabel(how.fill.label);
    if ((await byLabel.count()) > 0) return byLabel.first();
    return null;
  }
  const first = page.locator('input').first();
  return (await first.count()) > 0 ? first : null;
}

async function setField(field: Locator, value: string): Promise<void> {
  // `fill()` refuses non-numeric text on `input[type=number]`, which would hide the very case the
  // invalid-input sequence is about. Typing is what a user does, and the browser decides what the
  // field keeps — that decision is part of the measurement.
  await field.fill('');
  await field.pressSequentially(value, { delay: 12 });
}

async function fieldValue(field: Locator): Promise<string> {
  return field.evaluate((node) => String((node as HTMLInputElement).value));
}

/* ------------------------------------------------------------------ *
 * The seven sequences
 * ------------------------------------------------------------------ */

function notTested(probe: string, sequence: string, reason: string): ProbeResult {
  return { probe, sequence, status: 'not_tested', detail: reason };
}

function incomplete(probe: string, sequence: string, error: unknown): ProbeResult {
  const message =
    error instanceof Error ? (error.message.split('\n')[0] ?? 'unknown error') : String(error);
  return {
    probe,
    sequence,
    status: 'incomplete',
    detail: `the sequence started and could not be finished: ${message.slice(0, 220)}`,
  };
}

async function freshPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

async function probeExportThenExport(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const sequence =
    'Generate → Export → change state → Generate → Export → compare the export with the screen';
  const probe = 'export-then-regenerate-then-export';
  const page = await freshPage(browser, url);
  try {
    const field = await fieldFor(page, how);
    if (field === null) {
      return notTested(
        probe,
        sequence,
        'the application has no labelled input to change the state with',
      );
    }
    await control(page, how.regenerate).first().click();
    await control(page, how.publish).first().click();
    await setField(field, how.fill?.value ?? '9999');
    await control(page, how.regenerate).first().click();
    await control(page, how.publish).first().click();
    const shown = await displayedColours(page);
    const stale = stalePublication({
      displayed: shown,
      published: hexTokens(await publishedText(page)),
    });
    return {
      probe,
      sequence,
      status: stale.stale || stale.nothing_handed_over ? 'finding' : 'clean',
      detail: stale.note,
    };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function probeCopyAfterChange(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const sequence =
    'Generate → Export → change state → Generate → Copy (without re-exporting) → compare what was copied with the screen';
  const probe = 'copy-after-state-change';
  if (!how.copy) {
    // The distinction matters: an application with no copy affordance is not passing this sequence.
    return notTested(
      probe,
      sequence,
      'the interaction config names no copy control, so no copy path was driven',
    );
  }
  const page = await freshPage(browser, url);
  try {
    if ((await controlCount(page, how.copy)) === 0) {
      return notTested(
        probe,
        sequence,
        `the application has no control named ${JSON.stringify(how.copy)}`,
      );
    }
    const field = await fieldFor(page, how);
    if (field === null) {
      return notTested(
        probe,
        sequence,
        'the application has no labelled input to change the state with',
      );
    }
    await control(page, how.regenerate).first().click();
    await control(page, how.publish).first().click();
    await setField(field, how.fill?.value ?? '9999');
    await control(page, how.regenerate).first().click();
    await control(page, how.copy).first().click();
    const clip = await clipboardText(page);
    if (clip === null) {
      return incomplete(
        probe,
        sequence,
        'the clipboard could not be read back in this browser context',
      );
    }
    const shown = await displayedColours(page);
    const stale = stalePublication({ displayed: shown, published: hexTokens(clip) });
    return {
      probe,
      sequence,
      status: stale.stale || stale.nothing_handed_over ? 'finding' : 'clean',
      detail: `handed over through the clipboard. ${stale.note}`,
    };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function probeInputDomain(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const a = '1';
  const b = String(2 ** 32 + 1);
  const sequence = `Type seed ${a} → Generate → read output → type seed ${b} → Generate → compare outputs`;
  const probe = 'distinct-accepted-inputs';
  const page = await freshPage(browser, url);
  try {
    const field = await fieldFor(page, how);
    if (field === null) {
      return notTested(
        probe,
        sequence,
        'the application has no labelled input to take the two values',
      );
    }
    await setField(field, a);
    await control(page, how.regenerate).first().click();
    const keptA = await fieldValue(field);
    const outA = await displayedColours(page);
    await setField(field, b);
    const keptB = await fieldValue(field);
    await control(page, how.regenerate).first().click();
    const outB = await displayedColours(page);
    const collision = inputDomainCollision({
      accepted_a: keptA,
      accepted_b: keptB,
      output_a: outA,
      output_b: outB,
    });
    return {
      probe,
      sequence,
      status: collision ? 'finding' : 'clean',
      detail:
        collision ??
        `the field kept ${JSON.stringify(keptA)} and ${JSON.stringify(keptB)} apart, and they produced ` +
          `${String(unique(outA).length)} and ${String(unique(outB).length)} displayed colour(s) respectively`,
    };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function probeUndoInSession(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const sequence =
    'Generate → Clear (destructive) → note the state → use the undo affordance → compare';
  const probe = 'destructive-then-undo';
  if (!how.destructive) {
    return notTested(probe, sequence, 'the interaction config names no destructive control');
  }
  const page = await freshPage(browser, url);
  try {
    if ((await controlCount(page, how.destructive)) === 0) {
      return notTested(
        probe,
        sequence,
        `the application has no control named ${JSON.stringify(how.destructive)}`,
      );
    }
    await control(page, how.regenerate).first().click();
    const before = await displayedColours(page);
    await control(page, how.destructive).first().click();
    const afterDestruction = await displayedColours(page);
    // Whether an undo affordance exists is measured, not assumed: a hidden button is not offered, and
    // the same discovery decides which control gets clicked.
    const undo = await findUndoButton(page);
    if (undo !== null) await undo.click({ timeout: 5000 });
    const afterUndo = await displayedColours(page);
    const finding = undoWithinSession({
      before_destruction: before,
      after_destruction: afterDestruction,
      after_undo: afterUndo,
      undo_offered: undo !== null,
    });
    const status: ProbeResult['status'] = finding.destroyed
      ? finding.restored && finding.undo_offered
        ? 'clean'
        : 'finding'
      : 'not_tested';
    return { probe, sequence, status, detail: finding.note };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

/**
 * The undo affordance, found the way a person would find it: a visible, non-hidden button whose own
 * text says undo/restore/revert. Returning the handle rather than a boolean means the probe that asks
 * "is a way back offered" and the probe that uses it cannot disagree about which control they mean.
 */
async function findUndoButton(page: Page): Promise<ElementHandle | null> {
  for (const button of await page.$$('button')) {
    const text = (await button.evaluate((node) => node.textContent ?? '')).trim().toLowerCase();
    if (!/undo|restore|revert/.test(text)) continue;
    const usable = await button.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !(node as HTMLButtonElement).hasAttribute('hidden')
      );
    });
    if (usable) return button;
  }
  return null;
}

async function undoVisible(page: Page): Promise<boolean> {
  return (await findUndoButton(page)) !== null;
}

async function probeReloadRecovery(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const sequence =
    'Generate → Clear → note state and undo → reload → compare state and undo → Clear again → note undo';
  const probe = 'destructive-then-reload-recovery';
  if (!how.destructive) {
    return notTested(probe, sequence, 'the interaction config names no destructive control');
  }
  const page = await freshPage(browser, url);
  try {
    if ((await controlCount(page, how.destructive)) === 0) {
      return notTested(
        probe,
        sequence,
        `the application has no control named ${JSON.stringify(how.destructive)}`,
      );
    }
    await control(page, how.regenerate).first().click();
    await control(page, how.destructive).first().click();
    // Undo visibility is sampled *after* the destruction. Asking before it produced an honest-looking
    // `undo_survives: false` on a document that offers undo perfectly well — the probe had checked for
    // a way back before anything needed one.
    const undoBefore = await undoVisible(page);
    const before = await displayedColours(page);
    const stored = await usesStorage(page);
    await page.reload({ waitUntil: 'load' });
    // Read the reload state *before* clicking anything else. An earlier draft drove a fresh
    // destruction first and then read the screen, so "after the reload" described a state the probe
    // itself had just destroyed.
    const afterReload = await displayedColours(page);
    const undoAfter = await undoVisible(page);
    await control(page, how.destructive).first().click();
    const undoAfterFreshDestruction = await undoVisible(page);
    const finding = reloadPersistence({
      before,
      after: afterReload,
      undo_before: undoBefore,
      undo_after: undoAfter,
      undo_after_new_destruction: undoAfterFreshDestruction,
      uses_storage: stored,
    });
    const bad = !finding.persisted || !finding.undo_survives;
    return { probe, sequence, status: bad ? 'finding' : 'clean', detail: finding.note };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function probeNarrowViewport(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const sequence = `Load at ${String(PHONE.width)}×${String(PHONE.height)} → measure overflow and control boxes → change state → Generate → compare`;
  const probe = 'narrow-viewport-interaction';
  const page = await freshPage(browser, url);
  try {
    await page.setViewportSize(PHONE);
    const field = await fieldFor(page, how);
    if (field === null) {
      return notTested(
        probe,
        sequence,
        'the application has no labelled input to drive an interaction at width',
      );
    }
    const facts = await page.evaluate((width: number) => {
      const root = document.documentElement;
      let visible = 0;
      let clipped = 0;
      let unusable = 0;
      const nodes = Array.from(
        document.querySelectorAll('button, input, select, textarea, a[href], [role=button]'),
      );
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const hidden =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          (node as HTMLElement).hasAttribute('hidden');
        if (hidden) continue;
        if (rect.width === 0 || rect.height === 0) {
          unusable += 1;
          continue;
        }
        visible += 1;
        if (rect.left < -2 || rect.right > width + 2) clipped += 1;
      }
      return {
        scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        visible,
        clipped,
        unusable,
      };
    }, PHONE.width);
    let reachable = true;
    let changed = false;
    try {
      await setField(field, how.fill?.value ?? '9999');
      const before = await displayedColours(page);
      await control(page, how.regenerate).first().click({ timeout: 5000 });
      const after = await displayedColours(page);
      changed = unique(before).join(',') !== unique(after).join(',');
    } catch {
      reachable = false;
    }
    const finding = narrowViewport({
      width: PHONE.width,
      document_scroll_width: facts.scrollWidth,
      controls_visible: facts.visible,
      controls_clipped: facts.clipped,
      controls_unusable: facts.unusable,
      interaction_changed_output: changed,
      control_reachable: reachable,
    });
    const bad =
      finding.overflow ||
      finding.clipped > 0 ||
      finding.unusable > 0 ||
      !finding.interaction_worked;
    return {
      probe,
      sequence,
      status: bad ? 'finding' : 'clean',
      detail: `${finding.note} (controls measured: ${String(facts.visible)} visible, ${String(facts.clipped)} clipped, ${String(facts.unusable)} without a usable box)`,
    };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function probeInvalidThenRetry(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult> {
  const invalid = how.invalid_value ?? 'abc';
  const sequence = `Type ${JSON.stringify(invalid)} into the seed field → Generate → read what happened → type a valid value → Generate → compare`;
  const probe = 'invalid-input-then-retry';
  const page = await freshPage(browser, url);
  try {
    const field = await fieldFor(page, how);
    if (field === null) {
      return notTested(probe, sequence, 'the application has no labelled input to invalidate');
    }
    await control(page, how.regenerate).first().click();
    const before = await displayedColours(page);
    await setField(field, invalid);
    const kept = await fieldValue(field);
    await control(page, how.regenerate).first().click();
    const afterInvalid = await displayedColours(page);
    const text = await renderedText(page);
    const status = await statusText(page);
    const finding = errorThenRetry({
      value_after_invalid_input: kept,
      displayed_before_invalid: before,
      displayed_after_invalid: afterInvalid,
      status_after_invalid: status,
      claims_success: /generated|exported|copied|done|success/i.test(status),
      displayed_after_retry: [],
      renders_non_values: /\b(NaN|undefined|Infinity)\b/.test(text),
    });
    // Only now retry, so the retry observation is not contaminated by the invalid attempt's own words.
    await setField(field, how.fill?.value ?? '9999');
    await control(page, how.regenerate).first().click();
    const afterRetry = await displayedColours(page);
    const recovered = errorThenRetry({
      value_after_invalid_input: kept,
      displayed_before_invalid: before,
      displayed_after_invalid: afterInvalid,
      status_after_invalid: status,
      claims_success: /generated|exported|copied|done|success/i.test(status),
      displayed_after_retry: afterRetry,
      renders_non_values: /\b(NaN|undefined|Infinity)\b/.test(text),
    });
    return {
      probe,
      sequence,
      status: recovered.defective ? 'finding' : 'clean',
      detail: `${recovered.note} (field kept ${JSON.stringify(kept)}; status said ${JSON.stringify(status.slice(0, 90))}; first pass said: ${finding.note})`,
    };
  } catch (error) {
    return incomplete(probe, sequence, error);
  } finally {
    await page.close();
  }
}

async function runSequences(
  browser: Browser,
  url: string,
  how: Interactions,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  results.push(await probeExportThenExport(browser, url, how));
  results.push(await probeCopyAfterChange(browser, url, how));
  results.push(await probeInputDomain(browser, url, how));
  results.push(await probeUndoInSession(browser, url, how));
  results.push(await probeReloadRecovery(browser, url, how));
  results.push(await probeNarrowViewport(browser, url, how));
  results.push(await probeInvalidThenRetry(browser, url, how));
  return results;
}

/**
 * Every declared sequence must report, in the declared order. A battery that silently drops one prints
 * the same headline as a battery that ran it, which is the KI-83 failure mode wearing a different hat:
 * the count stays plausible while a claim stops being measured.
 */
function assertSequencesComplete(results: readonly ProbeResult[], label: string): void {
  const got = results.map((result) => result.probe);
  const missing = PROBE_NAMES.filter((name) => !got.includes(name));
  const extra = got.filter((name) => !(PROBE_NAMES as readonly string[]).includes(name));
  if (missing.length > 0 || extra.length > 0 || got.length !== PROBE_NAMES.length) {
    throw new Error(
      `${label} did not report every sequence: expected ${String(PROBE_NAMES.length)}, got ${String(got.length)}` +
        (missing.length > 0 ? `; missing ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; unexpected ${extra.join(', ')}` : ''),
    );
  }
}

function counts(results: readonly ProbeResult[]): Record<ProbeResult['status'], number> {
  const out: Record<ProbeResult['status'], number> = {
    finding: 0,
    clean: 0,
    not_tested: 0,
    incomplete: 0,
  };
  for (const result of results) out[result.status] += 1;
  return out;
}

function reportDocument(
  label: string,
  results: ProbeResult[],
  extra: Record<string, unknown> = {},
): void {
  const tally = counts(results);
  console.log(`\n── ${label}`);
  for (const line of renderProbeResults(results)) console.log(`  ${line}`);
  console.log(
    `  → ${String(tally.finding)} finding(s), ${String(tally.clean)} clean, ` +
      `${String(tally.not_tested)} not tested, ${String(tally.incomplete)} incomplete`,
  );
  const seen = observations.documents as unknown[];
  seen.push({ label, counts: tally, results, ...extra });
}

/* ------------------------------------------------------------------ *
 * Fixture mode: can the battery tell the difference?
 * ------------------------------------------------------------------ */

const EXPECTED_FINDINGS: Record<
  string,
  { mustFind: readonly string[]; mustStayClean: readonly string[] }
> = {
  'stale-copy-export': {
    // The KI-88 shape, and the reason the two publish sequences are driven separately: re-pressing
    // Export keeps an application in step, so only the copy path goes stale. A battery that drove only
    // the export path reported exactly this document clean.
    mustFind: ['copy-after-state-change'],
    mustStayClean: [
      'export-then-regenerate-then-export',
      'distinct-accepted-inputs',
      'destructive-then-undo',
      'destructive-then-reload-recovery',
      'narrow-viewport-interaction',
    ],
  },
  'frozen-export': {
    mustFind: ['export-then-regenerate-then-export', 'copy-after-state-change'],
    mustStayClean: [
      'distinct-accepted-inputs',
      'destructive-then-undo',
      'narrow-viewport-interaction',
    ],
  },
  'wrap32-seed': {
    mustFind: ['distinct-accepted-inputs'],
    mustStayClean: [
      'export-then-regenerate-then-export',
      'copy-after-state-change',
      'destructive-then-reload-recovery',
      'destructive-then-undo',
      'narrow-viewport-interaction',
    ],
  },
  'undo-does-nothing': {
    mustFind: ['destructive-then-undo'],
    mustStayClean: [
      'export-then-regenerate-then-export',
      'copy-after-state-change',
      'destructive-then-reload-recovery',
      'distinct-accepted-inputs',
      'narrow-viewport-interaction',
    ],
  },
  'no-undo-control': {
    // A document that discards state and never offers a way back fails both recovery sequences: the
    // one that asks inside a session, and the one that asks across a reload.
    mustFind: ['destructive-then-undo', 'destructive-then-reload-recovery'],
    mustStayClean: [
      'distinct-accepted-inputs',
      'invalid-input-then-retry',
      'narrow-viewport-interaction',
    ],
  },
  'reload-loses-undo': {
    mustFind: ['destructive-then-reload-recovery'],
    mustStayClean: [
      'destructive-then-undo',
      'distinct-accepted-inputs',
      'invalid-input-then-retry',
    ],
  },
  'fixed-width-layout': {
    mustFind: ['narrow-viewport-interaction'],
    mustStayClean: [
      'distinct-accepted-inputs',
      'destructive-then-undo',
      'invalid-input-then-retry',
    ],
  },
  'nan-renders': {
    mustFind: ['invalid-input-then-retry'],
    mustStayClean: [
      'distinct-accepted-inputs',
      'destructive-then-undo',
      'narrow-viewport-interaction',
    ],
  },
};

function knobDiff(knobs: FixtureKnobs): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(CLEAN_KNOBS) as Array<keyof FixtureKnobs>) {
    if (knobs[key] !== CLEAN_KNOBS[key]) changed.push(`${key}=${String(knobs[key])}`);
  }
  return changed;
}

async function fixtureMode(browser: Browser): Promise<void> {
  const documents: Array<{ label: string; knobs: FixtureKnobs }> = [
    { label: 'clean-baseline', knobs: CLEAN_KNOBS },
    ...DEFECTIVE_KNOBS.map((entry) => ({ label: entry.label, knobs: entry.knobs })),
  ];

  for (const document of documents) {
    const url = await serveBytes(probeFixture(document.knobs, document.label));
    const results = await runSequences(browser, url, FIXTURE_CONTROLS);
    assertSequencesComplete(results, `fixture ${document.label}`);
    reportDocument(
      `fixture ${document.label} (${knobDiff(document.knobs).join(', ') || 'no knobs changed'})`,
      results,
      {
        kind: 'fixture',
        knobs: document.knobs,
      },
    );
    await closeServer();

    if (document.label === 'clean-baseline') {
      const bad = results.filter(
        (result) => result.status === 'finding' || result.status === 'incomplete',
      );
      if (bad.length > 0) {
        throw new Error(
          `the battery flagged a document with no defect installed: ${bad.map((result) => `${result.probe} (${result.status}: ${result.detail})`).join(' | ')}`,
        );
      }
      const skipped = results.filter((result) => result.status === 'not_tested');
      if (skipped.length > 0) {
        throw new Error(
          `the battery skipped sequences on a document that has every control: ${skipped.map((result) => result.probe).join(', ')}`,
        );
      }
      check(
        `the clean baseline installs no finding and skips no sequence (${String(results.length)} sequences ran)`,
      );
      continue;
    }

    const expectation = EXPECTED_FINDINGS[document.label];
    if (expectation === undefined) {
      throw new Error(
        `the knob ${document.label} has no stated expectation, so nothing pins which probe must catch it`,
      );
    }
    const flagged = new Set(findingsOf(results).map((result) => result.probe));
    const missing = expectation.mustFind.filter((probe) => !flagged.has(probe));
    if (missing.length > 0) {
      throw new Error(
        `the knob ${document.label} was not caught by ${missing.join(', ')}; the battery cannot detect that shape, ` +
          `so a real artifact with it would be reported clean`,
      );
    }
    const falsePositives = expectation.mustStayClean.filter((probe) => flagged.has(probe));
    if (falsePositives.length > 0) {
      throw new Error(
        `the knob ${document.label} was flagged by ${falsePositives.join(', ')} as well; those probes do not measure ` +
          'one thing, so their clean results carry no information',
      );
    }
    const notRun = results.filter((result) => result.status === 'incomplete');
    if (notRun.length > 0) {
      throw new Error(
        `the knob ${document.label} left sequences incomplete: ${notRun.map((result) => `${result.probe} (${result.detail})`).join(' | ')}`,
      );
    }
    check(
      `the ${document.label} fixture is caught by ${expectation.mustFind.join(', ')} and by nothing else ` +
        `(${String(expectation.mustStayClean.length)} probe(s) stayed clean)`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Packet mode: measure a retained artifact, judge nothing
 * ------------------------------------------------------------------ */

async function packetMode(browser: Browser): Promise<void> {
  const packetDir = String(process.env.PROBE_PACKET);
  const how = JSON.parse(String(process.env.PROBE_INTERACTIONS ?? '{}')) as Interactions;
  if (!how.regenerate || !how.publish) {
    throw new Error(
      'PROBE_INTERACTIONS must name `regenerate` and `publish` by accessible control name, plus `copy`, ' +
        '`destructive`, `undo`, `invalid_value` and `fill: {label, value}` where the artifact has them',
    );
  }
  const report = JSON.parse(readFileSync(join(packetDir, 'report.json'), 'utf8')) as {
    observations?: { artifact?: { sha256?: string } };
  };
  const bytes = readFileSync(join(packetDir, 'artifact.html'), 'utf8');
  const url = await serveBytes(bytes);
  try {
    const results = await runSequences(browser, url, how);
    assertSequencesComplete(results, `artifact ${packetDir.split('/').pop()}`);
    reportDocument(`artifact ${packetDir.split('/').pop()}`, results, {
      kind: 'packet',
      packet: packetDir,
      artifact_sha256: report.observations?.artifact?.sha256 ?? null,
      interactions: how,
    });
    observations.scope_note =
      'these results describe seven driven sequences against one artifact. They are not a judgement of ' +
      'the application, they are not a product failure, and "clean" here means only that the named sequence ' +
      'behaved. Quality judgements remain human and are not measured by this gate.';
  } finally {
    await closeServer();
  }
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  observations.documents = [];
  const launched = await launchVerificationBrowser();
  reportBrowserSelection(launched.selection);
  check(`browser available: ${launched.selection.selected ?? launched.selection.attempted}`);
  try {
    if (process.env.PROBE_PACKET?.trim()) {
      await packetMode(launched.browser);
    } else {
      await fixtureMode(launched.browser);
    }
  } finally {
    await launched.browser.close();
  }
}

function writeReport(status: string, exitCode: number): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'report.json'),
    `${JSON.stringify({ gate: 'artifact-probes', status, exit_code: exitCode, observations, generated_at: new Date().toISOString() }, null, 2)}\n`,
  );
  if (status === 'FAILED') {
    writeFileSync(
      join(OUT, 'FAILED.md'),
      `# artifact-probes FAILED\n\n${String(observations.error)}\n`,
    );
  }
}

function packetStatus(): string {
  const documents = observations.documents as Array<{
    counts: Record<ProbeResult['status'], number>;
  }>;
  const total = { finding: 0, clean: 0, not_tested: 0, incomplete: 0 };
  for (const document of documents) {
    for (const key of Object.keys(total) as Array<keyof typeof total>)
      total[key] += document.counts[key] ?? 0;
  }
  return (
    `MEASURED (${String(total.finding)} finding(s), ${String(total.clean)} clean, ` +
    `${String(total.not_tested)} not tested, ${String(total.incomplete)} incomplete)`
  );
}

async function run(): Promise<number> {
  try {
    await main();
    observations.checks = checks;
    const isPacket = Boolean(process.env.PROBE_PACKET?.trim());
    const status = isPacket ? packetStatus() : `PASS (${String(checks.length)} checks)`;
    writeReport(status, 0);
    console.log(`\n${status} — evidence: ${OUT}`);
    if (isPacket) {
      console.log(String(observations.scope_note));
      console.log('HUMAN REVIEW REQUIRED: application quality is not measured by this gate.');
    }
    return 0;
  } catch (error) {
    const failure: GateFailure = classifyGateFailure(error);
    observations.error = error instanceof Error ? error.message : String(error);
    if (error instanceof BrowserUnavailableError || failure.kind === 'blocked') {
      writeReport('BLOCKED', 2);
      console.log(`BLOCKED before measuring anything: ${observations.error}\n  evidence: ${OUT}`);
      return 2;
    }
    writeReport('FAILED', 1);
    console.log(`FAILED: ${observations.error}\n  evidence: ${OUT}`);
    return 1;
  }
}

process.exit(await run());
