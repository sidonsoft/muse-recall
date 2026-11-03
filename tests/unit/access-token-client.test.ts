import { describe, expect, it } from 'vitest';
import { authorizationHeader, storedAccessToken } from '../../apps/web/src/lib/access-token.ts';

/**
 * The browser client sends a bearer header ONLY when a token is stored.
 * Vitest (node) has no localStorage — which is exactly the SSR/privacy-mode
 * path: no crash, no header, loopback default untouched.
 */
describe('web bearer support (G-6 groundwork)', () => {
  it('yields no header and no crash when storage is unavailable', () => {
    expect(storedAccessToken()).toBeNull();
    expect(authorizationHeader()).toEqual({});
  });

  it('sends the header when localStorage holds a token', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    try {
      store.set('mml.access_token', 'sekret');
      expect(authorizationHeader()).toEqual({ authorization: 'Bearer sekret' });
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
