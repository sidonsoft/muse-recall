/**
 * The network rule a document is held to (KI-53 / KI-74).
 *
 * The rule is chosen from the document bytes, never declared by a caller, and it
 * is now read by three different surfaces: the browser verification, the preview
 * CSP, and the dependency disclosure in the approval rail. Those have to agree,
 * because a reviewer who is told "self-contained" while the checker grants a
 * remote origin (or the reverse) is being shown two different documents.
 *
 * So the primitives live here, apart from the browser, and `runtime-check.ts`
 * re-exports them for its existing callers.
 */
import type { ForgeNetworkPolicy } from '@mml/shared';
import { externalReferences, VENDOR_MARKER_ATTRIBUTE } from './vendored-scripts.js';

export type { ForgeNetworkPolicy };

/** The only remote origin a staged application may load during verification. */
export const ALLOWED_REMOTE_HOSTS: ReadonlySet<string> = new Set(['cdn.jsdelivr.net']);

/** Remote origins the verification policy permits, for reporting. */
export const ALLOWED_REMOTE_ORIGINS: readonly string[] = ['https://cdn.jsdelivr.net'];

/** Which policy applies to these document bytes. */
export function documentNetworkPolicy(html: string): ForgeNetworkPolicy {
  return html.includes(`${VENDOR_MARKER_ATTRIBUTE}="`) && externalReferences(html).length === 0
    ? 'vendored'
    : 'cdn-allowlist';
}

/** Schemes that are not remote fetches at all. */
function isLocalScheme(protocol: string): boolean {
  return protocol === 'about:' || protocol === 'data:' || protocol === 'blob:';
}

/** True when a request URL is permitted during headless verification. */
export function isAllowedRuntimeRequest(
  raw: string,
  policy: ForgeNetworkPolicy = 'cdn-allowlist',
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Anything unparseable is treated as non-network and left to the browser.
    return true;
  }
  if (isLocalScheme(url.protocol)) return true;
  if (url.protocol !== 'https:') return false;
  // A vendored document was verified with no remote origin at all.
  if (policy === 'vendored') return false;
  return ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase());
}

/** Origins a document would contact for one remote URL, reduced to origin only. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Human sentence for what the policy permits, shared by check and panel. */
export function describeNetworkPolicy(policy: ForgeNetworkPolicy): string {
  return policy === 'vendored'
    ? 'verification grants no remote origin at all'
    : `verification permits one remote origin: ${ALLOWED_REMOTE_ORIGINS.join(', ')}`;
}
