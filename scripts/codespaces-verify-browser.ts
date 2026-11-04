/**
 * `pnpm exec tsx scripts/codespaces-verify-browser.ts` — prove the managed
 * Chromium the approval flow needs actually launches, as the invoking user.
 *
 * Exit 0 with `BROWSER_READY=1` and the version on success; exit 1 with the
 * failure cause and the exact recovery command on stdout-readable stderr.
 * Setup treats failure as a warning (offline exploration does not need the
 * browser), never as a setup failure.
 */
import { verifyBrowserLaunch } from './lib/codespaces-browser.js';

const result = await verifyBrowserLaunch({});
if (result.ok) {
  console.log(`BROWSER_READY=1`);
  console.log(`BROWSER_VERSION=${result.version}`);
  console.log(`BROWSER_PATH=${result.executablePath}`);
  process.exit(0);
}
console.error(result.error);
console.log('BROWSER_READY=0');
process.exit(1);
