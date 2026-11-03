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
import {
  externalReferences,
  externalScriptReferences,
  VENDOR_MARKER_ATTRIBUTE,
} from './vendored-scripts.js';

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

/**
 * What the document itself asks from a remote host, read once.
 *
 * Three surfaces used to derive this independently — the verification grant, the
 * preview CSP and the approval-panel disclosure — and they disagreed: a quoted-only
 * scan missed an unquoted `src`, so the disclosure called a script fetched while
 * the preview refused to load it, and a document could be classed self-contained
 * while its tag asked a host. Script references and other references are listed
 * here together so every surface reads the same set, and `kind` lets a policy give
 * a grant to the directive that needs it.
 */
export type RemoteReferenceKind = 'script' | 'asset';
export type RemoteReference = { url: string; kind: RemoteReferenceKind };

export function remoteReferences(html: string): RemoteReference[] {
  const found: RemoteReference[] = [];
  const seen = new Set<string>();
  for (const reference of externalScriptReferences(html)) {
    if (seen.has(reference.url)) continue;
    seen.add(reference.url);
    found.push({ url: reference.url, kind: 'script' });
  }
  for (const url of externalReferences(html)) {
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ url, kind: 'asset' });
  }
  return found;
}

/** The remote origins these document bytes reference, in reference order. */
export function referencedRemoteOrigins(html: string): string[] {
  const origins: string[] = [];
  for (const reference of remoteReferences(html)) {
    const origin = originOf(reference.url);
    if (origin !== null && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** Is a remote origin one this product permits for a CDN-dependent document? */
export function isAllowedRemoteOrigin(origin: string): boolean {
  try {
    return ALLOWED_REMOTE_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The remote origins the preview policy may name for these bytes: ones the bytes
 * actually reference **and** the policy in force permits. A document that carries
 * its engine references nothing, so it gets nothing; a URL that only appears in
 * application code references nothing either, and stays refused in both preview
 * and verification. That agreement is the point — a reviewer told a dependency is
 * fetched must not be looking at a preview that quietly blocked it.
 */
export function previewRemoteGrant(html: string): string[] {
  const policy = documentNetworkPolicy(html);
  if (policy === 'vendored') return [];
  return referencedRemoteOrigins(html).filter((origin) => isAllowedRemoteOrigin(origin));
}

/** Human sentence for what the policy permits, shared by check and panel. */
export function describeNetworkPolicy(policy: ForgeNetworkPolicy): string {
  return policy === 'vendored'
    ? 'verification grants no remote origin at all'
    : `verification permits one remote origin: ${ALLOWED_REMOTE_ORIGINS.join(', ')}`;
}
