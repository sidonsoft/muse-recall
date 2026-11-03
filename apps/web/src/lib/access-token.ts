/**
 * Shared bearer token support (gap G-6 groundwork).
 *
 * When the server runs with ACCESS_TOKEN, the browser client presents it as
 * `Authorization: Bearer …`. The loopback default stays untouched: with no
 * stored token, no header is sent and the zero-friction local beta behaves
 * exactly as before. This is authentication WITHOUT identity — one secret,
 * one operator — which is why docs must not call it multi-user.
 */
const STORAGE_KEY = 'mml.access_token';

export function storedAccessToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null; // storage unavailable (SSR tests, privacy modes)
  }
}

export function authorizationHeader(): Record<string, string> {
  const token = storedAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
