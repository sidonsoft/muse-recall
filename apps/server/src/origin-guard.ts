/**
 * Cross-origin mutation guard.
 *
 * CORS response headers stop a foreign page from *reading* a response, but they
 * do not stop the browser from sending a "simple" request — and the browser
 * will send it. The mutating Forge routes (approve, reject, rollback, cancel)
 * accept a bodyless POST, so a cross-site page can change project state even
 * though it cannot read the reply.
 *
 * This guard runs before any handler. For state-changing methods it requires a
 * present, well-formed `Origin` that is either:
 *
 *   - the request's own origin, derived from the already-validated `Host`
 *     header, or
 *   - one of the operator-configured `corsOrigins`.
 *
 * `Origin: null`, malformed values and deceptive hosts/ports are rejected.
 * A request with no `Origin` is treated as a non-browser client (curl, tests,
 * the Vite proxy), not as proof of same-origin context; if the browser-supplied
 * `Sec-Fetch-Site` header says otherwise, it is rejected too.
 *
 * The host guard still runs first and limits the whole surface to loopback.
 */

import { isLoopbackHostname, parseHostHeader } from './host-guard.js';

export type OriginVerdict =
  | { allowed: true; reason: 'safe-method' | 'trusted-origin' | 'same-origin' | 'non-browser' }
  | {
      allowed: false;
      reason: 'null-origin' | 'malformed-origin' | 'untrusted-origin' | 'cross-site-fetch';
    };

export interface OriginCheckOptions {
  method: string;
  /** Raw `Origin` header, if any. */
  origin: string | undefined;
  /** Raw, host-guard-validated `Host` header, if any. */
  host: string | undefined;
  /** Operator-configured trusted web origins. */
  corsOrigins: readonly string[];
  /** Raw `Sec-Fetch-Site` header, if the browser supplied one. */
  secFetchSite?: string | undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Methods that can change state; everything except the safe set. */
export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Parse an origin header or configured origin into its canonical
 * `scheme://host[:port]` form.
 *
 * The header must be exactly one origin: no userinfo, path, query, fragment,
 * trailing slash, list separator or whitespace. Browsers emit exactly this
 * form; anything else is ambiguous and is refused rather than guessed at.
 * Returns `null` for `null`, malformed, non-HTTP(S) and non-canonical values.
 */
export function normalizeOrigin(value: string): string | null {
  const raw = value.trim();
  if (raw.length === 0) return null;
  if (raw.toLowerCase() === 'null') return null;
  // A single Origin header never contains whitespace or a comma; both signal
  // multiple or smuggled values.
  if (/[\s,]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  // A trailing dot is accepted by DNS but is a different, ambiguous host.
  if (url.hostname.length === 0 || url.hostname.endsWith('.')) return null;

  const normalized = `${url.protocol}//${url.host}`.toLowerCase();
  // Refuse non-canonical spellings such as `http://host:80`, `http://host/` or
  // an upper-case host, so the comparison is against one unambiguous string.
  if (normalized !== raw.toLowerCase()) return null;
  return normalized;
}

/**
 * Origin implied by a validated loopback `Host` header, on the server's
 * plain-HTTP scheme. A forwarded public host (an opt-in Codespaces proxy) is
 * served to the browser over the proxy's HTTPS, so it implies no same origin;
 * it is trusted only through its exact configured origin.
 */
function requestOriginFromHost(host: string | undefined): string | null {
  if (host === undefined) return null;
  const parsed = parseHostHeader(host);
  if (parsed === null || !isLoopbackHostname(parsed.hostname)) return null;
  return normalizeOrigin(`http://${host}`);
}

/**
 * Decide whether a request may proceed past the cross-origin guard.
 *
 * Pure function so the decision is unit-testable without a server.
 */
export function evaluateRequestOrigin(options: OriginCheckOptions): OriginVerdict {
  if (!isStateChangingMethod(options.method)) return { allowed: true, reason: 'safe-method' };

  if (options.origin === undefined) {
    // Non-browser clients send no Origin. A browser that says it is cross-site
    // has no business mutating state, even if the header is somehow absent.
    const site = options.secFetchSite?.toLowerCase();
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return { allowed: false, reason: 'cross-site-fetch' };
    }
    return { allowed: true, reason: 'non-browser' };
  }

  if (options.origin.trim().toLowerCase() === 'null') {
    return { allowed: false, reason: 'null-origin' };
  }

  const origin = normalizeOrigin(options.origin);
  if (origin === null) return { allowed: false, reason: 'malformed-origin' };

  const sameOrigin = requestOriginFromHost(options.host);
  if (sameOrigin !== null && origin === sameOrigin) {
    return { allowed: true, reason: 'same-origin' };
  }

  for (const configured of options.corsOrigins) {
    if (normalizeOrigin(configured) === origin) {
      return { allowed: true, reason: 'trusted-origin' };
    }
  }

  return { allowed: false, reason: 'untrusted-origin' };
}
