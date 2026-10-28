import { ForgeRuntimeBrowserSelectionSchema } from '@mml/shared';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGameRuntime } from '../../apps/server/src/forge/runtime-check.js';

const previous = process.env.FORGE_RUNTIME_BROWSER;
const previousChannel = process.env.FORGE_RUNTIME_CHANNEL;

afterEach(() => {
  if (previous === undefined) delete process.env.FORGE_RUNTIME_BROWSER;
  else process.env.FORGE_RUNTIME_BROWSER = previous;
  if (previousChannel === undefined) delete process.env.FORGE_RUNTIME_CHANNEL;
  else process.env.FORGE_RUNTIME_CHANNEL = previousChannel;
});

describe('runtime browser policy', () => {
  it('rejects an explicit invalid policy without launching a browser', async () => {
    process.env.FORGE_RUNTIME_BROWSER = 'nonsense';
    const result = await checkGameRuntime('<html><body>ok</body></html>');
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Invalid FORGE_RUNTIME_BROWSER');
    expect(result.browser).toBeNull();
    expect(result.browser_selection).toMatchObject({
      policy: 'managed',
      attempted: 'managed Chromium',
      selected: null,
    });
    expect(result.browser_selection?.failure).toContain('Invalid FORGE_RUNTIME_BROWSER');
  });

  it('bounds and redacts the complete long launch diagnostic and keeps setup guidance', async () => {
    process.env.FORGE_RUNTIME_BROWSER = 'managed';
    const launch = vi
      .spyOn(chromium, 'launch')
      .mockRejectedValue(
        new Error(`api_key=supersecretvalue Executable doesn't exist ${'x'.repeat(700)}`),
      );
    try {
      const result = await checkGameRuntime('<html><body>ok</body></html>');
      const failure = result.browser_selection?.failure;
      expect(result.ok).toBe(false);
      expect(failure).toBeDefined();
      expect(failure?.length).toBeLessThanOrEqual(300);
      expect(result.errors[0]?.length).toBeLessThanOrEqual(300);
      expect(failure).toContain('pnpm exec playwright-core install chromium');
      expect(failure).toContain('[REDACTED]');
      expect(failure).not.toContain('supersecretvalue');
      expect(() =>
        ForgeRuntimeBrowserSelectionSchema.parse(result.browser_selection),
      ).not.toThrow();
    } finally {
      launch.mockRestore();
    }
  });
});
