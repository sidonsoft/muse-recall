import { afterEach, describe, expect, it } from 'vitest';
import { launchVerificationBrowser } from '../../scripts/lib/browser.js';

const previousPolicy = process.env.FORGE_RUNTIME_BROWSER;

afterEach(() => {
  if (previousPolicy === undefined) delete process.env.FORGE_RUNTIME_BROWSER;
  else process.env.FORGE_RUNTIME_BROWSER = previousPolicy;
});

describe('active-script browser policy', () => {
  it('rejects an invalid policy without launching a browser', async () => {
    process.env.FORGE_RUNTIME_BROWSER = 'nonsense';
    await expect(launchVerificationBrowser()).rejects.toThrow(/Invalid FORGE_RUNTIME_BROWSER/);
  });

  it('defaults to managed Chromium and makes one launch attempt', async () => {
    delete process.env.FORGE_RUNTIME_BROWSER;
    let policy: string | null = null;
    await launchVerificationBrowser({
      launch: async (selected) => {
        policy = selected;
        throw new Error('missing fixture browser');
      },
    }).catch(() => undefined);
    expect(policy).toBe('managed');
  });

  it('uses system Chrome only when explicitly selected, with one attempt', async () => {
    process.env.FORGE_RUNTIME_BROWSER = 'chrome';
    let calls = 0;
    const error = await launchVerificationBrowser({
      launch: async () => {
        calls += 1;
        throw new Error('system chrome missing');
      },
    }).catch((cause: unknown) => cause);
    expect(calls).toBe(1);
    expect((error as Error).message).toContain('system Chrome could not be launched');
  });
  it('reports an actionable missing managed browser without falling back to system Chrome', async () => {
    process.env.FORGE_RUNTIME_BROWSER = 'managed';
    let launches = 0;
    const error = await launchVerificationBrowser({
      launch: async () => {
        launches += 1;
        throw new Error("Executable doesn't exist at /missing/chromium");
      },
    }).catch((cause: unknown) => cause);
    expect(launches).toBe(1);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('managed Chromium could not be launched');
    expect((error as Error).message).toContain('playwright-core install chromium');
    expect((error as Error).message).not.toContain('system Chrome could not be launched');
  });
});
