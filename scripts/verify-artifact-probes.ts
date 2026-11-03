/**
 * `verify:artifact-probes` — sequence probes for a generated artifact.
 *
 * Two modes, and they mean different things:
 *
 * **Fixture mode (default, the one CI runs).** Two small documents: one that keeps handing over
 * output it is no longer displaying, one that refreshes it. The battery must flag the first and leave
 * the second alone. That gates product-side code — a probe that cannot tell a stale export from a
 * fresh one is not measuring anything, and would print `no findings` over the real defect.
 *
 * **Packet mode (`PROBE_PACKET=<packet-dir>`).** Runs the battery against the retained bytes in a
 * review packet and records what it finds. A finding there is a measurement of a generated artifact,
 * not a product failure: it is named and written to the report for the reviewer's sheet, and the
 * packet itself is never rewritten.
 *
 * Why this exists. The human review of Palette Bench found a stale CSS export (KI-87), a seed that
 * folds into 32 bits (KI-88) and undo lost across a reload (KI-89) by thinking about sequences the
 * capture never drove. The capture had printed `issues: []` across all three. `issues: []` means "this
 * capture is fit to judge from" — it has never meant "nothing is wrong". That gap cost a paid-quality
 * finding that a free local sequence would have found first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import {
  hexTokens,
  probeFindings,
  reloadPersistence,
  seedCollision,
  stalePublication,
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
const checks: string[] = [];
const observations: Record<string, unknown> = {};

function check(claim: string): void {
  checks.push(claim);
  console.log(`  ✓ ${claim}`);
}

interface Interactions {
  /** Labelled input whose value feeds the regenerated state. */
  fill?: { label: string; value: string };
  regenerate: string;
  publish: string;
  /** A control that hands the published thing to the user (clipboard) without re-publishing. */
  copy?: string;
  /** A control that discards state, for the undo-survives-reload probe. */
  destructive?: string;
}

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
 * Bytes are served over http, not `file://`. A file:// document gets an opaque origin, and the
 * clipboard API refuses to work there — so the very sequence KI-87 lives in could not be exercised.
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

async function displayedColours(page: Page): Promise<string[]> {
  // `innerText`, deliberately, and the lint rule gets a refusal rather than a fix: it wants
  // `textContent`, which reads hidden elements too. "The colours the application is displaying" has to
  // mean the ones a person can see — a swatch hidden by CSS is not a colour on screen, and counting it
  // would let the probe report a stale export that nobody could notice.
  // biome-ignore lint/performance/useDomNodeTextContent: displayed means rendered, and hidden is not displayed
  return hexTokens(await page.evaluate(() => document.body.innerText));
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

async function usesStorage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.length > 0;
    } catch {
      return false;
    }
  });
}

async function hasControl(page: Page, name: string | undefined): Promise<boolean> {
  if (!name) return false;
  return (await page.getByRole('button', { name }).count()) > 0;
}

interface ProbeOutcome {
  stale?: ReturnType<typeof stalePublication>;
  collision?: ReturnType<typeof seedCollision>;
  persistence?: ReturnType<typeof reloadPersistence>;
}

async function probe(page: Page, url: string, how: Interactions): Promise<ProbeOutcome> {
  await page.goto(url, { waitUntil: 'load' });

  // KI-87's shape, where the sequence is the whole point: publish, change what is on screen, then
  // take what was published *without publishing again*. The first version of this probe re-pressed
  // Export, which let the app refresh its own output and hid the defect. What the reviewer actually
  // did was Export, regenerate, **Copy CSS** — and the clipboard carried the palette the screen no
  // longer showed.
  await page.getByRole('button', { name: how.publish }).first().click();
  if (how.fill) {
    await page.getByLabel(how.fill.label).first().fill(how.fill.value);
  } else {
    await page.locator('input').first().fill('9999');
  }
  await page.getByRole('button', { name: how.regenerate }).first().click();
  const shownAfter = await displayedColours(page);
  let handedVia = 'published region';
  let handedOver = hexTokens(await publishedText(page));
  if (how.copy) {
    await page.getByRole('button', { name: how.copy }).first().click();
    const clip = await clipboardText(page);
    if (clip !== null && clip !== '') {
      handedOver = hexTokens(clip);
      handedVia = 'clipboard';
    } else {
      handedVia = 'published region, clipboard unreadable';
    }
  }
  const stale = stalePublication({ displayed: shownAfter, published: handedOver });
  observations.handed_over_via = handedVia;

  // KI-88's shape: two seeds the field accepts, differing by exactly 2^32. Same app decision means
  // the generator folded a number the input allowed down to 32 bits. A small output space in general
  // is a design choice, and `seedCollision` says so instead of calling every collision a bug.
  const seedInput = how.fill
    ? page.getByLabel(how.fill.label).first()
    : page.locator('input').first();
  await seedInput.fill('1');
  await page.getByRole('button', { name: how.regenerate }).first().click();
  const paletteA = await displayedColours(page);
  await seedInput.fill(String(2 ** 32 + 1));
  await page.getByRole('button', { name: how.regenerate }).first().click();
  const collision = seedCollision({
    seed_a: '1',
    seed_b: String(2 ** 32 + 1),
    palette_a: paletteA,
    palette_b: await displayedColours(page),
  });

  // KI-89's shape: destroy something, reload, and ask whether the way back survived. A product
  // decision the generated app gets to make — but if it claims it, it has to hold.
  let persistence: ProbeOutcome['persistence'];
  if (how.destructive) {
    const undoBefore = await hasControl(page, 'undo');
    await page.getByRole('button', { name: how.destructive }).first().click();
    const before = await displayedColours(page);
    const stored = await usesStorage(page);
    await page.reload({ waitUntil: 'load' });
    const undoAfter = await hasControl(page, 'undo');
    // Then ask the same question of a *fresh* destruction: if a way back appears now, the affordance
    // is session-scoped, which is a different finding from "Undo does nothing" and reads differently
    // against a decision that says every destructive action is undoable.
    await page.getByRole('button', { name: how.destructive }).first().click();
    const undoAfterFreshDestruction = await hasControl(page, 'undo');
    persistence = reloadPersistence({
      before,
      after: await displayedColours(page),
      undo_before: undoBefore,
      undo_after: undoAfter,
      undo_after_new_destruction: undoAfterFreshDestruction,
      uses_storage: stored,
    });
  }

  return { stale, collision, persistence };
}

const STALE_FIXTURE = `<!doctype html><meta charset="utf-8"><title>stale</title>
<label for="seed">Seed</label><input id="seed" type="number" value="1">
<button id="g">Generate</button><button id="e">Export</button>
<button id="cp">Copy</button><button id="c">Clear</button>
<textarea id="out" aria-label="exported"></textarea><div id="shown"></div>
<script>
var colours=[];
function paint(){document.getElementById('shown').textContent=colours.join(' ');}
function hex(n){return '#'+(((n>>>0)%4096)).toString(16).padStart(3,'0');}
document.getElementById('g').onclick=function(){var s=parseInt(document.getElementById('seed').value,10);colours=[0,1,2,3,4].map(function(i){return hex(s*7+i*13);});paint();};
document.getElementById('e').onclick=function(){document.getElementById('out').value=colours.join(' ');};
document.getElementById('cp').onclick=function(){var v=document.getElementById('out').value;if(navigator.clipboard){navigator.clipboard.writeText(v);}};
document.getElementById('c').onclick=function(){colours=[];paint();};
document.getElementById('g').click();document.getElementById('e').click();
</script>`;

// Differs from the stale fixture in two ways on purpose: regenerating refreshes what has already been
// handed over, and its seed mixing is string-based rather than a 32-bit fold. Otherwise a single
// fixture change would flip both findings at once and the two shapes could not be told apart.
const FRESH_FIXTURE = STALE_FIXTURE.replace(
  "document.getElementById('g').onclick=function(){var s=parseInt(document.getElementById('seed').value,10);colours=[0,1,2,3,4].map(function(i){return hex(s*7+i*13);});paint();};",
  "document.getElementById('g').onclick=function(){var v=String(document.getElementById('seed').value);var s=0;for(var k=0;k<v.length;k++){s=s*31+v.charCodeAt(k);}colours=[0,1,2,3,4].map(function(i){return hex(s+i*13);});paint();document.getElementById('out').value=colours.join(' ');};",
);

const FIXTURE_INTERACTIONS: Interactions = {
  fill: { label: 'Seed', value: '77' },
  regenerate: 'Generate',
  publish: 'Export',
  copy: 'Copy',
  destructive: 'Clear',
};

async function fixtureMode(
  browser: Awaited<ReturnType<typeof launchVerificationBrowser>>['browser'],
): Promise<void> {
  const stalePage = await browser.newPage();
  try {
    const url = await serveBytes(STALE_FIXTURE);
    await stalePage
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    const findings = await probe(stalePage, url, FIXTURE_INTERACTIONS);
    await stalePage.screenshot({ path: join(OUT, 'fixture-stale.png'), fullPage: true });
    observations.stale_fixture = findings;
    if (!findings.stale?.stale) {
      throw new Error(
        'the battery did not flag a document that hands over colours it is no longer displaying, so it ' +
          'cannot detect the defect the human reviewer found (KI-87)',
      );
    }
    check(
      `the battery flags a document that hands over colours it is not displaying ` +
        `(measured through the ${observations.handed_over_via as string})`,
    );
    if (!findings.collision) {
      throw new Error(
        'the battery missed a generator that folds two accepted seeds 2^32 apart into one palette (KI-88), ' +
          'so a real truncation would go unreported',
      );
    }
    check('the battery flags a generator that folds seeds 2^32 apart into one palette');
    if (
      !findings.persistence ||
      findings.persistence.persisted ||
      findings.persistence.undo_survives
    ) {
      throw new Error(
        'the battery reported a lost-on-reload undo as surviving, so the destructive-action decision ' +
          'could be marked satisfied on an app that cannot undo after a reload (KI-89)',
      );
    }
    check('the battery reports undo lost across a reload');
  } finally {
    await stalePage.close();
    await closeServer();
  }

  const freshPage = await browser.newPage();
  try {
    const url = await serveBytes(FRESH_FIXTURE);
    await freshPage
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    const findings = await probe(freshPage, url, {
      ...FIXTURE_INTERACTIONS,
      destructive: undefined,
    });
    await freshPage.screenshot({ path: join(OUT, 'fixture-fresh.png'), fullPage: true });
    observations.fresh_fixture = findings;
    if (findings.stale?.stale || findings.collision) {
      throw new Error(
        `the battery flagged a document that refreshes what it hands over and does not fold its seeds: ` +
          `${probeFindings(findings).join(' | ')}`,
      );
    }
    check(
      'the battery leaves alone a document that refreshes what it hands over and does not truncate seeds',
    );
  } finally {
    await freshPage.close();
    await closeServer();
  }
}

async function packetMode(
  browser: Awaited<ReturnType<typeof launchVerificationBrowser>>['browser'],
): Promise<void> {
  const packetDir = String(process.env.PROBE_PACKET);
  const how = JSON.parse(String(process.env.PROBE_INTERACTIONS ?? '{}')) as Interactions;
  if (!how.regenerate || !how.publish) {
    throw new Error(
      'PROBE_INTERACTIONS must name `regenerate` and `publish` by accessible control name, plus `copy`, ' +
        '`destructive` and `fill: {label, value}` where the artifact has them',
    );
  }
  const report = JSON.parse(readFileSync(join(packetDir, 'report.json'), 'utf8')) as {
    observations?: { artifact?: { sha256?: string } };
  };
  const bytes = readFileSync(join(packetDir, 'artifact.html'), 'utf8');
  const page = await browser.newPage();
  try {
    const url = await serveBytes(bytes);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    const findings = await probe(page, url, how);
    await page.screenshot({ path: join(OUT, 'probed.png'), fullPage: true });
    observations.probe_packet = packetDir;
    observations.artifact_sha256 = report.observations?.artifact?.sha256 ?? null;
    observations.interactions = how;
    observations.findings = findings;
    observations.flagged = probeFindings(findings);
    observations.verdict =
      'a measurement of one generated artifact, not a judgement of it and not a product failure';
    console.log(
      `  findings against the retained artifact (${String(observations.flagged === undefined ? 0 : (observations.flagged as string[]).length)}):`,
    );
    for (const line of observations.flagged as string[]) console.log(`    - ${line}`);
    check(`probed the retained artifact at ${packetDir.split('/').pop()}`);
  } finally {
    await page.close();
    await closeServer();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
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

async function run(): Promise<number> {
  try {
    await main();
    observations.checks = checks;
    const status = process.env.PROBE_PACKET?.trim()
      ? `MEASURED (${String(((observations.flagged as string[] | undefined) ?? []).length)} finding(s))`
      : `PASS (${String(checks.length)} checks)`;
    writeReport(status, 0);
    console.log(`\n${status} — evidence: ${OUT}`);
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
