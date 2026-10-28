/**
 * Shared browser policy for active verification scripts.
 *
 * Managed Playwright Chromium is the default. System Chrome is used only when
 * FORGE_RUNTIME_BROWSER=chrome is set explicitly. There is no automatic
 * fallback: a missing managed browser produces an actionable setup error.
 */

import { type Browser, chromium } from 'playwright-core';
import { redactSecrets } from '../../packages/shared/src/redact.js';

export type ScriptBrowserPolicy = 'managed' | 'chrome';

export interface ScriptBrowserSelection {
  policy: ScriptBrowserPolicy;
  attempted: string;
  selected: string | null;
  failure: string | null;
}

function configuredPolicy(): ScriptBrowserPolicy | null {
  const value = process.env.FORGE_RUNTIME_BROWSER ?? 'managed';
  return value === 'managed' || value === 'chrome' ? value : null;
}

function boundedFailure(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error), {
    maxLength: 300,
  });
}

export async function launchVerificationBrowser(
  options: {
    /** Test seam; production callers use the real Playwright launcher. */
    launch?: (policy: ScriptBrowserPolicy) => Promise<Browser>;
  } = {},
): Promise<{
  browser: Browser;
  selection: ScriptBrowserSelection;
}> {
  const policy = configuredPolicy();
  if (!policy) {
    throw new Error(
      'Invalid FORGE_RUNTIME_BROWSER value. Use "managed" (default) or "chrome" (explicit system Chrome).',
    );
  }
  const attempted = policy === 'managed' ? 'managed Chromium' : 'system Chrome';
  try {
    const browser = options.launch
      ? await options.launch(policy)
      : policy === 'managed'
        ? await chromium.launch({ headless: true })
        : await chromium.launch({ channel: 'chrome', headless: true });
    let version: string;
    try {
      version = await browser.version();
    } catch {
      version = 'version unavailable';
    }
    const selected = `${policy === 'managed' ? 'Chromium' : 'Google Chrome'} ${version}`;
    return {
      browser,
      selection: { policy, attempted, selected, failure: null },
    };
  } catch (error) {
    const failure = boundedFailure(error);
    const action =
      policy === 'managed'
        ? 'Run "pnpm exec playwright-core install chromium", or set FORGE_RUNTIME_BROWSER=chrome explicitly.'
        : 'Install Google Chrome, or set FORGE_RUNTIME_BROWSER=managed after installing Playwright Chromium.';
    throw new Error(`${attempted} could not be launched: ${failure}. ${action}`);
  }
}

export function reportBrowserSelection(selection: ScriptBrowserSelection): void {
  console.log(`  Browser: ${selection.selected ?? selection.attempted} (${selection.policy})`);
}
