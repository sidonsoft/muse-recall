/**
 * Verify the managed verification browser the way the approval flow needs it:
 * present on disk is not enough — it must actually launch.
 *
 * Used by `.devcontainer/setup.sh` (as the application user, after install)
 * and by the regression tests. No network, no ports, no credentials: a
 * headless launch that prints its version and exits.
 */
import { chromium } from 'playwright-core';

export interface BrowserVerification {
  ok: boolean;
  /** Resolved executable path (null when resolution itself failed). */
  executablePath: string | null;
  /** Browser version string when the launch succeeded. */
  version: string | null;
  /**
   * Short human-readable failure plus the exact recovery command. Never
   * includes paths outside the Playwright cache or any secret.
   */
  error: string | null;
}

const RECOVERY =
  'sudo pnpm exec playwright-core install-deps chromium; then, as the app user, pnpm exec playwright-core install chromium; pnpm exec tsx scripts/codespaces-verify-browser.ts';

export async function verifyBrowserLaunch(options: {
  /** Override for tests: a bogus path must fail with the recovery line. */
  executablePath?: string;
  timeoutMs?: number;
}): Promise<BrowserVerification> {
  let executablePath: string | null = null;
  try {
    executablePath = options.executablePath ?? chromium.executablePath();
  } catch (error) {
    return {
      ok: false,
      executablePath: null,
      version: null,
      error: `Could not resolve the managed Chromium path (${error instanceof Error ? error.message : String(error)}). Recovery: ${RECOVERY}.`,
    };
  }
  if (!executablePath) {
    return {
      ok: false,
      executablePath: null,
      version: null,
      error: `The managed Chromium path resolved empty. Recovery: ${RECOVERY}.`,
    };
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: timeoutMs,
      ...(options.executablePath ? { executablePath } : {}),
    });
    const version = browser.version();
    await browser.close();
    browser = null;
    return { ok: true, executablePath, version, error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Playwright launch failures name the missing .so; keep the first lines
    // (they carry the cause) and always end with the recovery command.
    const head = detail.split('\n').slice(0, 4).join(' ').slice(0, 500);
    return {
      ok: false,
      executablePath,
      version: null,
      error: `Managed Chromium did not launch: ${head}. Recovery: ${RECOVERY}.`,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
