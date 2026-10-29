/**
 * GitHub Codespaces origin support.
 *
 * In a codespace the browser opens the web app at
 * `https://<codespace>-5173.<forwarding domain>`, and the Codespaces port
 * forwarder rewrites both headers before they reach the container: `Host`
 * becomes `localhost:5173` and `Origin` becomes `https://localhost:5173`
 * (the browser's scheme with the forwarded host replaced). Neither matches
 * the plain-HTTP local origins in `CORS_ORIGINS`, so every state-changing
 * request from the forwarded app was refused as cross-origin.
 *
 * When — and only when — the process runs inside a codespace, this adds, for
 * each configured loopback web origin `http://<loopback>:<port>`:
 *
 *   - `https://localhost:<port>`, the rewritten form the forwarder delivers;
 *   - `https://<codespace>-<port>.<domain>`, the browser's own origin, in case
 *     a forwarder ever passes it through unchanged.
 *
 * Nothing wider is trusted: other ports, other codespaces and foreign sites
 * are still rejected, and the API still binds to loopback only.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function codespacesWebOrigins(
  configured: readonly string[],
  env: NodeJS.ProcessEnv,
): string[] {
  if (env.CODESPACES?.trim().toLowerCase() !== 'true') return [];
  const name = env.CODESPACE_NAME?.trim() ?? '';
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim() ?? '';

  const ports = new Set<string>();
  for (const origin of configured) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' || url.port === '') continue;
      if (!LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) continue;
      ports.add(url.port);
    } catch {
      // A malformed configured origin contributes nothing.
    }
  }

  const extra: string[] = [];
  for (const port of ports) {
    extra.push(`https://localhost:${port}`);
    if (name.length > 0 && domain.length > 0) {
      extra.push(`https://${name}-${port}.${domain}`.toLowerCase());
    }
  }
  return extra.filter((origin) => !configured.includes(origin));
}
