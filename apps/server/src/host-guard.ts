/**
 * Host-header validation for the loopback API.
 *
 * The server binds to a loopback address, but that alone does not stop a
 * DNS-rebinding page from making same-origin requests to `127.0.0.1`: the
 * browser sends whatever hostname resolved to loopback. Requiring the `Host`
 * header to name a loopback host — on the configured API port, or on a
 * configured local web origin (the Vite dev proxy forwards the browser's Host)
 * — closes that gap without adding authentication to a single-user local app.
 *
 * A configured port of `0` means "assigned at bind time" (tests and ephemeral
 * runs); there is no known port to compare, so those configurations validate
 * the hostname only.
 *
 * A trusted port-forwarding proxy (GitHub Codespaces) reaches the loopback
 * server with its public hostname in `Host`. Those hostnames are accepted only
 * when the operator lists the exact HTTPS origins in `forwardedOrigins`; the
 * default is none, so nothing but loopback is accepted out of the box.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface HostGuardOptions {
  /** Configured API port; `0` disables port comparison. */
  port: number;
  /** Locally served web origins whose forwarded Host is also acceptable. */
  corsOrigins: readonly string[];
  /** Exact public origins of an explicitly trusted forwarding proxy. Default: none. */
  forwardedOrigins?: readonly string[];
}

/** True when a parsed `Host` hostname is a loopback name. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** Parse a `Host` header into a lower-cased hostname and numeric port. */
export function parseHostHeader(value: string): { hostname: string; port: number } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    return null;
  }
  // Reject user info, paths, queries and fragments smuggled into the header.
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname.length === 0) return null;
  const port = url.port === '' ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { hostname, port };
}

/** True when the Host header names an expected local host and port. */
export function isAllowedHostHeader(value: string | undefined, options: HostGuardOptions): boolean {
  if (value === undefined) return false;
  const parsed = parseHostHeader(value);
  if (!parsed) return false;
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return isForwardedHostHeader(value, options.forwardedOrigins ?? []);
  }

  // Port 0 means "assigned at bind time": no concrete port exists to compare.
  if (options.port === 0) return true;

  const allowedPorts = new Set<number>();
  allowedPorts.add(options.port);
  for (const origin of options.corsOrigins) {
    try {
      const url = new URL(origin);
      if (!LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) continue;
      if (url.port === '') continue;
      allowedPorts.add(Number(url.port));
    } catch {
      // A malformed configured origin simply contributes no extra port.
    }
  }
  if (allowedPorts.size === 0) return true;
  return allowedPorts.has(parsed.port);
}

/**
 * True when the Host header names exactly the host of a configured forwarded
 * origin, with or without that origin's default port spelled out.
 */
function isForwardedHostHeader(value: string, forwardedOrigins: readonly string[]): boolean {
  const host = value.trim().toLowerCase();
  for (const origin of forwardedOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      // A malformed configured origin contributes no trust.
      continue;
    }
    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    const accepted = new Set([url.host, `${url.hostname}:${url.port || defaultPort}`]);
    if (accepted.has(host)) return true;
  }
  return false;
}
