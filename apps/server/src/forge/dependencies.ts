/**
 * Dependency disclosure for the human approval interface (KI-74).
 *
 * Vendoring (D059) is deliberately narrow: only the one pinned reference is
 * replaced. A document can therefore still fetch something at run time, and the
 * person deciding to approve has to be able to tell that from a document that
 * carries its own engine — and tell an *unsupported* version from a supported one
 * that was left remote because of how its tag was written. Until now three
 * surfaces knew those facts (`vendor_gaps`, `network_policy`,
 * `x-forge-vendor-gaps`) and no surface a person reads showed any of them.
 *
 * The rule that makes this worth reading: it is measured from **the exact bytes
 * promotion would write** — the staged file after the vendoring pass — not from
 * the source view the diff shows and not from what the model claimed. Those are
 * the same bytes the browser check runs on and the same bytes approval promotes,
 * so the panel, the check and the artifact cannot disagree.
 *
 * Pure: no network, no clock beyond the recorded timestamp, no mutation.
 */
import { createHash } from 'node:crypto';
import type {
  ForgeDependency,
  ForgeDependencyDisclosure,
  ForgeDependencyReason,
  ForgeDependencyStatus,
  ForgeNetworkPolicy,
} from '@mml/shared';
import {
  ALLOWED_REMOTE_ORIGINS,
  documentNetworkPolicy,
  isAllowedRuntimeRequest,
  originOf,
} from './network-policy.js';
import {
  externalReferences,
  externalScriptReferences,
  pinnedLibraries,
  VENDORED_SCRIPTS,
  vendoredLibrariesIn,
} from './vendored-scripts.js';

/** A jsDelivr-style npm reference: `…/npm/<name>@<version>/…`. */
const NPM_REFERENCE = /\/npm\/(@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)@([^/]+)/i;
/** A version-shaped path segment or filename suffix: `…/jquery-3.7.1.min.js`. */
const DASHED_VERSION = /[/-]([0-9]+\.[0-9]+(?:\.[0-9]+)?)[-.](?:min\.)?js$/i;
/** Literal URLs the application's own code asks the browser to fetch. */
const CODE_REQUEST =
  /\b(?:fetch|importScripts|import)\s*\(\s*['"`](https?:\/\/[^'"`\s]{1,400})['"`]|\bnew\s+WebSocket\s*\(\s*['"`]((?:wss?|https?):\/\/[^'"`\s]{1,400})['"`]|\bXMLHttpRequest\b[\s\S]{0,120}?\.open\s*\(\s*['"][A-Za-z]+['"]\s*,\s*['"`](https?:\/\/[^'"`\s]{1,400})/gi;
/** `muse-asset://<id>/v<n>` placeholders approval resolves into embedded bytes. */
const MEDIA_PLACEHOLDER = /\bmuse-asset:\/\/[0-9a-f-]+\/v\d+/gi;

const MAX_ROWS = 40;

function parsedLibrary(url: string): { name: string | null; version: string | null } {
  const npm = NPM_REFERENCE.exec(url);
  if (npm) return { name: npm[1] ?? null, version: npm[2] ?? null };
  const dashed = DASHED_VERSION.exec(url);
  if (dashed) return { name: null, version: dashed[1] ?? null };
  return { name: null, version: null };
}

/**
 * Status for one remote reference under this document's policy: verification
 * would *permit* the fetch, or *refuse* it. A blocked row is not a warning — it
 * is the disclosure saying the dependency never arrives during the check, which
 * is exactly the case a reviewer must not have to infer from a blank preview.
 */
function statusFor(url: string, policy: ForgeNetworkPolicy): ForgeDependencyStatus {
  return isAllowedRuntimeRequest(url, policy) ? 'fetched' : 'blocked';
}

function bounded(value: string, max = 400): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Every remote reference the document makes, and what the policy does with it. */
function remoteRows(html: string, policy: ForgeNetworkPolicy): ForgeDependency[] {
  const rows: ForgeDependency[] = [];
  const seen = new Set<string>();
  const vendored = vendoredLibrariesIn(html);
  const scriptRefs = externalScriptReferences(html);
  const scriptUrls = new Set(scriptRefs.map((entry) => entry.url));

  for (const ref of scriptRefs) {
    const parsed = parsedLibrary(ref.url);
    const origin = originOf(ref.url);
    const pinned = VENDORED_SCRIPTS.find((entry) => entry.url === ref.url);
    const carriesVendoredCopy = vendored.some(
      (entry) =>
        pinned !== undefined && entry.name === pinned.name && entry.version === pinned.version,
    );
    let reason: ForgeDependencyReason;
    let note: string;
    if (pinned && carriesVendoredCopy) {
      reason = 'vendored_copy_and_remote_copy';
      note = `these bytes already carry ${pinned.name}@${pinned.version} and still reference it over the network`;
    } else if (parsed.name !== null && /phaser/i.test(parsed.name) && pinned === undefined) {
      reason = 'version_outside_pin';
      note =
        `asks for ${parsed.name}@${parsed.version ?? '(unknown version)'}; this product vendors ` +
        `${VENDORED_SCRIPTS.map((entry) => `${entry.name}@${entry.version}`).join(', ')} and left ` +
        'the reference exactly as written';
    } else if (ref.other_attributes !== '' || ref.has_body) {
      reason = 'tag_form_not_replaced';
      note =
        'the tag carries ' +
        (ref.has_body ? 'a body alongside its src' : `${ref.other_attributes}`) +
        ', which an inlined copy would not preserve, so the reference was left as written';
    } else {
      reason = 'remote_asset';
      note = 'a script this product carries no copy of, loaded from the remote host';
    }
    rows.push({
      status: statusFor(ref.url, policy),
      reason,
      library: parsed.name ? bounded(parsed.name, 80) : null,
      version: parsed.version ? bounded(parsed.version, 60) : null,
      url: bounded(ref.url, 500),
      origin: origin === null ? null : bounded(origin, 300),
      sha256: null,
      bytes: null,
      note: bounded(note),
    });
    seen.add(ref.url);
  }

  // Remote assets that are not scripts: images, stylesheets, fonts, frames.
  for (const url of externalReferences(html)) {
    if (scriptUrls.has(url) || seen.has(url)) continue;
    const parsed = parsedLibrary(url);
    const origin = originOf(url);
    rows.push({
      status: statusFor(url, policy),
      reason: 'remote_asset',
      library: parsed.name ? bounded(parsed.name, 80) : null,
      version: parsed.version ? bounded(parsed.version, 60) : null,
      url: bounded(url, 500),
      origin: origin === null ? null : bounded(origin, 300),
      sha256: null,
      bytes: null,
      note: 'a remote asset the application loads when it runs',
    });
    seen.add(url);
  }

  // URLs the application's own script asks the browser to fetch. These never
  // appear as a tag, so they are the case the tag scan cannot see — and the
  // runtime policy refuses them all the same.
  CODE_REQUEST.lastIndex = 0;
  let match: RegExpExecArray | null = CODE_REQUEST.exec(html);
  while (match !== null) {
    const url = match[1] ?? match[2] ?? match[3] ?? '';
    if (url !== '' && !seen.has(url)) {
      const origin = originOf(url);
      rows.push({
        status: statusFor(url, policy),
        reason: 'requested_by_application_code',
        library: null,
        version: null,
        url: bounded(url, 500),
        origin: origin === null ? null : bounded(origin, 300),
        sha256: null,
        bytes: null,
        note: "a literal URL in the application's own code, requested at run time",
      });
      seen.add(url);
    }
    match = CODE_REQUEST.exec(html);
  }
  return rows;
}

/**
 * The disclosure for one byte sequence. Call with the bytes that would be
 * promoted (staged-after-vendoring, media-resolved at approval); the recorded
 * `html_sha256` is the identity of exactly those bytes, so a panel can show it
 * and a test can prove the panel was not handed the source view.
 */
export function dependencyDisclosure(
  html: string,
  options: { recordedAt?: string; now?: () => Date } = {},
): ForgeDependencyDisclosure {
  const policy = documentNetworkPolicy(html);
  const rows = remoteRows(html, policy);
  const bundled: ForgeDependency[] = vendoredLibrariesIn(html).map((entry) => ({
    status: 'bundled' as const,
    reason: 'bundled_pinned_copy' as const,
    library: entry.name,
    version: entry.version,
    url: entry.replaced_url,
    origin: null,
    sha256: entry.sha256,
    bytes: entry.bytes,
    note:
      `carried by this product at the pinned sha256 in place of ${entry.replaced_url}; ` +
      `${String(entry.bytes)} bytes`,
  }));
  const ordered = [...bundled, ...rows].slice(0, MAX_ROWS);
  const pending = html.match(MEDIA_PLACEHOLDER)?.length ?? 0;
  return {
    network_policy: policy,
    // A document asks for nothing outside itself only when no remote reference
    // survives the vendoring pass. The policy alone does not say that: a plain
    // app with no engine is on the allowlist policy and still asks for nothing,
    // and a document that carries an engine but also references a remote asset is
    // not self-contained even though it bundles the engine.
    self_contained: rows.length === 0,
    granted_origins:
      policy === 'vendored' ? [] : ALLOWED_REMOTE_ORIGINS.map((origin) => bounded(origin, 300)),
    dependencies: ordered,
    pending_media_references: pending,
    html_sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
    recorded_at: options.recordedAt ?? (options.now ?? (() => new Date()))().toISOString(),
  };
}

/** The pinned copies this build can bundle, for messages and gates. */
export function bundledDependencyCatalogue(): { name: string; version: string; url: string }[] {
  return pinnedLibraries().map(({ name, version, url }) => ({ name, version, url }));
}
