/**
 * The engine Forge vendors into generated games.
 *
 * A generated game used to load Phaser from `cdn.jsdelivr.net` at run time, so
 * an approved artifact was only as reproducible as a third party's CDN and only
 * as available as that CDN was. This module replaces that reference with the
 * library the product itself carries: pinned to one version, verified by sha256
 * before a single byte of it reaches an artifact, and shipped with its MIT
 * notice because the license requires the notice to travel with copies. (KI-53.)
 *
 * Three rules keep that from becoming a way to smuggle code into an artifact:
 *
 * 1. Only the exact pinned URL is replaced. A document that asks for a different
 *    Phaser version keeps its own reference and gets a **named gap** instead of
 *    a silent substitution — the reviewer sees what still comes from the network
 *    rather than being told the artifact is self-contained.
 * 2. The bytes inlined are the bytes the pin describes, checked at load. A
 *    corrupted or edited vendor file stops vendoring and reports itself; it does
 *    not ship.
 * 3. A `data-forge-vendor` marker inside an artifact is not trusted. Validation
 *    re-hashes what the marker claims and fails the artifact if the content is
 *    not the pinned library, so stamping the marker on 1.1 MB of something else
 *    is refused rather than exempted.
 */
import { createHash } from 'node:crypto';

import { PHASER_LICENSE, PHASER_SOURCE_BASE64, PHASER_VENDOR_PIN } from './vendor/phaser-3.80.1.js';

/** Attribute that marks a script as product-vendored rather than model-written. */
export const VENDOR_MARKER_ATTRIBUTE = 'data-forge-vendor';
export const VENDOR_HASH_ATTRIBUTE = 'data-forge-sha256';

export type VendoredLibrary = {
  name: string;
  version: string;
  /** The exact URL this library replaces. */
  url: string;
  sha256: string;
  bytes: number;
  /** Marker value, e.g. `phaser@3.80.1`. */
  marker: string;
};

export type AppliedVendor = {
  name: string;
  version: string;
  sha256: string;
  bytes: number;
  replaced_url: string;
};

export type VendorGap = {
  url: string;
  reason: string;
};

export type VendorOutcome = {
  html: string;
  applied: AppliedVendor[];
  gaps: VendorGap[];
  /** Remote URLs left in the document for any reason. Never emptied by this module. */
  external_urls: string[];
};

const LIBRARIES: VendoredLibrary[] = [
  {
    name: PHASER_VENDOR_PIN.name,
    version: PHASER_VENDOR_PIN.version,
    url: PHASER_VENDOR_PIN.url,
    sha256: PHASER_VENDOR_PIN.sha256,
    bytes: PHASER_VENDOR_PIN.bytes,
    marker: `${PHASER_VENDOR_PIN.name}@${PHASER_VENDOR_PIN.version}`,
  },
];

/** The version this product can vendor, for messages and gates. */
export const VENDORED_SCRIPTS: { name: string; version: string; url: string }[] = LIBRARIES.map(
  ({ name, version, url }) => ({ name, version, url }),
);

/**
 * Sequences that would end or confuse an inline `<script>` once the library sits
 * inside HTML. Checked against the decoded bytes, not assumed from the pin.
 */
const HTML_UNSAFE_SEQUENCES = ['</script', '<script', '<!--', '--!>'] as const;

let cachedSource: { source: string; notice: string } | { reason: string } | null = null;

/**
 * Decode the pinned library and check it. Returns the reason instead of throwing
 * so a caller can turn a broken vendor file into a named gap rather than a crash
 * in the request path.
 */
function pinnedLibrary(
  library: VendoredLibrary,
): { source: string; notice: string } | { reason: string } {
  if (cachedSource) return cachedSource;
  let source: string;
  try {
    source = Buffer.from(PHASER_SOURCE_BASE64, 'base64').toString('utf8');
  } catch {
    cachedSource = { reason: 'the vendored copy in this build could not be decoded' };
    return cachedSource;
  }
  const got = createHash('sha256').update(source).digest('hex');
  if (got !== library.sha256 || Buffer.byteLength(source) !== library.bytes) {
    cachedSource = {
      reason:
        `the vendored copy in this build does not match its pin ` +
        `(sha256 ${got.slice(0, 12)}…, ${String(Buffer.byteLength(source))} bytes)`,
    };
    return cachedSource;
  }
  for (const sequence of HTML_UNSAFE_SEQUENCES) {
    if (source.includes(sequence)) {
      cachedSource = {
        reason: `the vendored library contains ${sequence}, which cannot sit inside an inline script`,
      };
      return cachedSource;
    }
  }
  // The MIT notice goes in an HTML comment. `--` would close that comment early.
  const notice = `Phaser ${library.version} | MIT License | (c) 2024 Richard Davey, Phaser Studio Inc.\n${PHASER_LICENSE}`;
  if (notice.includes('--')) {
    cachedSource = { reason: 'the vendored license notice cannot be embedded as an HTML comment' };
    return cachedSource;
  }
  cachedSource = { source, notice };
  return cachedSource;
}

const OPEN_SCRIPT = /<script\b([^>]*)>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** Attributes whose meaning an inlined replacement would not preserve. */
const BEHAVIOUR_ATTRIBUTES =
  /\b(type|defer|async|integrity|crossorigin|nomodule|charset|language|id)\b/i;
/** A jsDelivr Phaser URL of any version, so a version gap can be named. */
const CDN_PHASER_PATH =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@([^/]+)\/dist\/phaser\.min\.js$/i;

function attributeValue(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    attrs,
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

/** Every absolute http(s) URL the document would fetch on its own. */
export function externalReferences(html: string): string[] {
  const found = new Set<string>();
  const pattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match) {
    const value = match[1] ?? match[2] ?? '';
    if (/^https?:\/\//i.test(value)) found.add(value);
    match = pattern.exec(html);
  }
  return [...found];
}

/**
 * Replace every reference to the pinned CDN library with the copy this product
 * carries. Pure: it never mutates its input and never contacts the network.
 *
 * The staged-read path calls this, so the bytes a reviewer diffs, the bytes the
 * browser check runs, and the bytes approval promotes are the same bytes.
 */
export function vendorScripts(html: string): VendorOutcome {
  const applied: AppliedVendor[] = [];
  const gaps: VendorGap[] = [];
  let out = '';
  let cursor = 0;

  const alreadyVendored = new Set<string>();
  for (const library of LIBRARIES) {
    if (html.includes(`${VENDOR_MARKER_ATTRIBUTE}="${library.marker}"`)) {
      alreadyVendored.add(library.marker);
    }
  }

  OPEN_SCRIPT.lastIndex = 0;
  for (;;) {
    const match = OPEN_SCRIPT.exec(html);
    if (match === null) break;
    const attrs = match[1] ?? '';
    const close = html.indexOf('</script', match.index + match[0].length);
    // The whole element, the closing `>` included. Leaving one character behind
    // would drop it after the span emitted here, which is how a round trip
    // through the source view gained a stray `>`.
    const closingAngle = close === -1 ? -1 : html.indexOf('>', close);
    const endIndex = closingAngle === -1 ? html.length : closingAngle + 1;
    out += html.slice(cursor, match.index);
    cursor = endIndex;

    const src = attributeValue(attrs, 'src');
    const library = src ? LIBRARIES.find((entry) => entry.url === src) : undefined;

    if (src === null) {
      // An inline script. Leave it alone; validation owns what it may contain.
      out += html.slice(match.index, endIndex);
      continue;
    }

    const cdnPhaser = CDN_PHASER_PATH.exec(src);
    if (!library && !cdnPhaser) {
      // Not our library, not our business to rewrite.
      out += html.slice(match.index, endIndex);
      continue;
    }

    const tagStart = match.index;
    const tagText = html.slice(tagStart, endIndex);
    const emitGap = (url: string, reason: string): void => {
      gaps.push({ url, reason });
      out += tagText;
    };

    if (!library) {
      emitGap(
        src ?? '',
        `${cdnPhaser?.[1] ?? 'an unmatched Phaser build'} is not the version this product vendors ` +
          `(${LIBRARIES.map((entry) => `${entry.name}@${entry.version}`).join(', ')}); ` +
          'the reference is left as written and still needs the network',
      );
      continue;
    }

    if (alreadyVendored.has(library.marker)) {
      emitGap(
        src,
        `this document already carries a vendored ${library.marker} and still references it over the network`,
      );
      continue;
    }

    const otherAttributes = attrs.replace(SRC_ATTRIBUTE, '').replace(/\s+/g, ' ').trim();
    if (otherAttributes !== '' && BEHAVIOUR_ATTRIBUTES.test(otherAttributes)) {
      emitGap(
        src,
        'the script tag carries attributes an inlined replacement would not preserve ' +
          `(${otherAttributes}), so the reference is left as written`,
      );
      continue;
    }

    // A script tag with a body is not something this can replace honestly.
    const body = close === -1 ? '' : html.slice(match.index + match[0].length, close);
    if (body.trim() !== '') {
      emitGap(
        src,
        'the script tag has a body alongside its src, which is not a reference this can replace',
      );
      continue;
    }

    const pinned = pinnedLibrary(library);
    if ('reason' in pinned) {
      emitGap(src, pinned.reason);
      continue;
    }

    out += vendorSpan(library, pinned.source, pinned.notice);
    applied.push({
      name: library.name,
      version: library.version,
      sha256: library.sha256,
      bytes: library.bytes,
      replaced_url: src,
    });
    alreadyVendored.add(library.marker);
  }

  out += html.slice(cursor);
  return { html: out, applied, gaps, external_urls: externalReferences(out) };
}

function vendorSpan(library: VendoredLibrary, source: string, notice: string): string {
  /*
   * The span is delimited on both ends so the source view can be recovered
   * exactly. The engine belongs in the shipped bytes, but it must not be what a
   * model is asked to edit: seeding a modification with 1.1 MB of third-party
   * code invites a re-serialization of it, and any change to it invalidates the
   * hash that makes the copy trustworthy. So the artifact carries the delimited
   * block, and the review, the diff and the model's starting point all see the
   * one-line reference instead.
   */
  return (
    `<!-- forge-vendor:${library.marker} start | sha256 ${library.sha256}\n` +
    `${notice}\n-->` +
    `<script ${VENDOR_MARKER_ATTRIBUTE}="${library.marker}" ${VENDOR_HASH_ATTRIBUTE}="${library.sha256}">` +
    source +
    `</script>` +
    `<!-- forge-vendor:${library.marker} end -->`
  );
}

/**
 * The source view: the shipped bytes with each verified vendored engine replaced
 * by the one-line reference it came from. Round-trip exact — `vendorScripts`
 * reproduces the shipped bytes from this view byte for byte — so the review a
 * person reads and the code a model is handed stay readable without the artifact
 * being anything less than self-contained.
 *
 * A block whose contents do not hash to the pin is left as it is. Refusing to
 * show it would hide the very thing validation needs to report.
 */
export function unvendorScripts(html: string): string {
  let out = html;
  for (const library of LIBRARIES) {
    const start = `<!-- forge-vendor:${library.marker} start`;
    const end = `<!-- forge-vendor:${library.marker} end -->`;
    let index = out.indexOf(start);
    while (index !== -1) {
      const endAt = out.indexOf(end, index);
      if (endAt === -1) break;
      const span = out.slice(index, endAt + end.length);
      const verified = verifiedSpanHoldsPin(span, library);
      out =
        out.slice(0, index) +
        (verified ? `<script src="${library.url}"></script>` : span) +
        out.slice(endAt + end.length);
      index = out.indexOf(start, index + (verified ? 1 : span.length));
    }
  }
  return out;
}

/** Does a delimited vendor span carry the pinned bytes? */
function verifiedSpanHoldsPin(span: string, library: VendoredLibrary): boolean {
  const open = new RegExp(
    `<script\\b[^>]*${VENDOR_MARKER_ATTRIBUTE}="${library.marker}"[^>]*>`,
    'i',
  ).exec(span);
  if (!open) return false;
  const close = span.indexOf('</script', open.index + open[0].length);
  if (close === -1) return false;
  const content = span.slice(open.index + open[0].length, close);
  return createHash('sha256').update(content).digest('hex') === library.sha256;
}

/**
 * Every remote reference a `<script src=…>` tag carries, with the reason a
 * reviewer needs to read it: the other attributes on the tag and whether it has a
 * body. This is what the dependency disclosure (KI-74) reads, so the panel can
 * say *why* something was left remote — a version this product does not vendor, a
 * tag form an inlined copy would not preserve — rather than showing a bare URL.
 */
export type ExternalScriptReference = {
  url: string;
  /** The tag's other attributes, normalised; empty when the tag is a plain src. */
  other_attributes: string;
  has_body: boolean;
};

export function externalScriptReferences(html: string): ExternalScriptReference[] {
  const found: ExternalScriptReference[] = [];
  OPEN_SCRIPT.lastIndex = 0;
  for (;;) {
    const match = OPEN_SCRIPT.exec(html);
    if (match === null) break;
    const attrs = match[1] ?? '';
    const close = html.indexOf('</script', match.index + match[0].length);
    const closingAngle = close === -1 ? -1 : html.indexOf('>', close);
    const endIndex = closingAngle === -1 ? html.length : closingAngle + 1;
    const src = attributeValue(attrs, 'src');
    if (src && /^https?:\/\//i.test(src)) {
      const body = close === -1 ? '' : html.slice(match.index + match[0].length, close);
      found.push({
        url: src,
        other_attributes: attrs.replace(SRC_ATTRIBUTE, '').replace(/\s+/g, ' ').trim(),
        has_body: body.trim() !== '',
      });
    }
    OPEN_SCRIPT.lastIndex = endIndex;
  }
  return found;
}

/** The pinned libraries this build can vendor, for disclosure and messages. */
export function pinnedLibraries(): {
  name: string;
  version: string;
  url: string;
  sha256: string;
}[] {
  return LIBRARIES.map(({ name, version, url, sha256 }) => ({ name, version, url, sha256 }));
}

/**
 * Remote engine references the document still depends on, named by URL.
 * A pinned-version reference that somehow survived, a jsDelivr Phaser of another
 * version, and any other Phaser-shaped remote URL all appear here; the check and
 * the reviewer see the same list.
 */
export function vendorGapUrls(html: string): string[] {
  const gaps: string[] = [];
  for (const url of externalReferences(html)) {
    if (!/phaser/i.test(url)) continue;
    const pinned = LIBRARIES.some((entry) => entry.url === url);
    const marked = html.includes(`${VENDOR_MARKER_ATTRIBUTE}=`);
    if (pinned && !marked) continue; // the reference itself, unvendored
    gaps.push(url);
  }
  return gaps;
}

/**
 * Validation's half of rule 3: any `data-forge-vendor` script in a document must
 * hold exactly the bytes the pin describes. Returns issues; empty means every
 * marked script is what it claims.
 */
export function vendoredScriptIntegrityIssues(html: string): string[] {
  const issues: string[] = [];
  OPEN_SCRIPT.lastIndex = 0;
  for (;;) {
    const match = OPEN_SCRIPT.exec(html);
    if (match === null) break;
    const attrs = match[1] ?? '';
    if (!new RegExp(`\\b${VENDOR_MARKER_ATTRIBUTE}=`, 'i').test(attrs)) continue;
    const marker = attributeValue(attrs, VENDOR_MARKER_ATTRIBUTE) ?? '';
    const library = LIBRARIES.find((entry) => entry.marker === marker);
    if (!library) {
      issues.push(
        `a script claims to be vendored as ${marker || '(unnamed)'}, which this build does not vendor`,
      );
      continue;
    }
    const close = html.indexOf('</script', match.index + match[0].length);
    const content = close === -1 ? '' : html.slice(match.index + match[0].length, close);
    const pinned = pinnedLibrary(library);
    if ('reason' in pinned) {
      issues.push(`a vendored ${library.marker} script cannot be verified: ${pinned.reason}`);
      continue;
    }
    const got = createHash('sha256').update(content).digest('hex');
    if (got !== library.sha256) {
      issues.push(
        `a script marked ${library.marker} holds ${String(Buffer.byteLength(content))} bytes whose sha256 is ${got.slice(0, 12)}…, not the pinned library`,
      );
    }
  }
  return issues;
}

/**
 * Which pinned libraries a finished document actually carries, verified by
 * re-hashing what the marker claims. Promotion records this against the version
 * so the database states what the bytes contain instead of what a caller asked
 * for; an unverified marker is left out of the manifest and reported as an issue
 * by `vendoredScriptIntegrityIssues`.
 */
export function vendoredLibrariesIn(html: string): AppliedVendor[] {
  const found: AppliedVendor[] = [];
  OPEN_SCRIPT.lastIndex = 0;
  for (;;) {
    const match = OPEN_SCRIPT.exec(html);
    if (match === null) break;
    const attrs = match[1] ?? '';
    if (!new RegExp(`\\b${VENDOR_MARKER_ATTRIBUTE}=`, 'i').test(attrs)) continue;
    const marker = attributeValue(attrs, VENDOR_MARKER_ATTRIBUTE) ?? '';
    const library = LIBRARIES.find((entry) => entry.marker === marker);
    if (!library) continue;
    const close = html.indexOf('</script', match.index + match[0].length);
    if (close === -1) continue;
    const content = html.slice(match.index + match[0].length, close);
    if (createHash('sha256').update(content).digest('hex') !== library.sha256) continue;
    found.push({
      name: library.name,
      version: library.version,
      sha256: library.sha256,
      bytes: library.bytes,
      replaced_url: library.url,
    });
  }
  return found;
}

/**
 * Do these script bodies hold exactly one of the pinned libraries? Used by the
 * inline caps, which may treat a marked script as third-party only when the
 * bytes say it is.
 */
export function isPinnedVendorBody(body: string): boolean {
  const got = createHash('sha256').update(body).digest('hex');
  return LIBRARIES.some((entry) => entry.sha256 === got);
}

/** Is a marked script product-vendored rather than model-written? */
export function isVendoredScriptOpenTag(openTag: string): boolean {
  return new RegExp(`\\b${VENDOR_MARKER_ATTRIBUTE}=`, 'i').test(openTag);
}
