import { afterEach, describe, expect, it } from 'vitest';
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
});
