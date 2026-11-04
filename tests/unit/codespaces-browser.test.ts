import { chromium } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
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
    expect(result.error).toContain('pnpm exec playwright-core install-deps chromium');
  });

  it('reports launch success as ready and launch failure with recovery', async () => {
    // A resolved path is a claim, not a verdict: only a launch settles it.
    // Where no usable browser exists (e.g. CI legs without the browser
    // install), the honest report is a failure with the recovery command —
    // the same contract setup.sh relies on to warn instead of failing.
    const result = await verifyBrowserLaunch({ timeoutMs: 60_000 });
    if (result.ok) {
      expect(result.version).toMatch(/\d+\.\d+/);
      expect(result.error).toBeNull();
    } else {
      expect(result.error).toContain('did not launch');
      expect(result.error).toContain('Recovery:');
      expect(result.error).toContain('pnpm exec playwright-core install');
    }
  }, 90_000);

  it('uses the browser driver timeout so timed-out launches are cleaned up', async () => {
    const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('launch timed out'));
    try {
      const result = await verifyBrowserLaunch({ timeoutMs: 25 });
      expect(launch).toHaveBeenCalledWith({ headless: true, timeout: 25 });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('launch timed out');
    } finally {
      launch.mockRestore();
    }
  });

  it('never throws on an unresolvable browser', async () => {
    const result = await verifyBrowserLaunch({
      executablePath: '',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Recovery:');
  });
});
