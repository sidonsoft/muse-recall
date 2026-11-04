import { describe, expect, it } from 'vitest';
import { verifyBrowserLaunch } from '../../scripts/lib/codespaces-browser.js';

/**
 * The verification-browser check, executed — not just a file-exists probe.
 *
 * Approval loads a staged application in a real browser, so setup must prove
 * the managed Chromium *launches*, and must print the exact recovery command
 * when it does not. The success path runs only where a browser is actually
 * installed (it launches headless, no network, no ports, no credentials); the
 * failure paths run everywhere and pin the recovery instruction.
 */

describe('browser launch verification', () => {
  it('a bogus executable fails with the cause and the recovery command', async () => {
    const result = await verifyBrowserLaunch({
      executablePath: '/nonexistent/chromium-for-test-only',
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
    expect(result.executablePath).toBe('/nonexistent/chromium-for-test-only');
    expect(result.error).toContain('did not launch');
    expect(result.error).toContain('pnpm exec playwright-core install --with-deps chromium');
  });

  it('reports readiness by launching, not by file existence', async () => {
    const result = await verifyBrowserLaunch({ timeoutMs: 60_000 });
    if (result.executablePath === null) {
      // No Playwright browser resolution on this machine: the honest report
      // is a failure with a recovery command, never a crash.
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Recovery:');
      return;
    }
    // A resolved path is a claim, not a verdict: only a launch settles it.
    expect(result.ok).toBe(true);
    expect(result.version).toMatch(/\d+\.\d+/);
    expect(result.error).toBeNull();
  }, 90_000);

  it('never throws on an unresolvable browser', async () => {
    const result = await verifyBrowserLaunch({
      executablePath: '',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Recovery:');
  });
});
