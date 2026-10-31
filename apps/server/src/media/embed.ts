/**
 * Bounded image embedding for the sandboxed Forge preview.
 *
 * Batch A design (image leg of the media spike):
 *
 * - Accepted input formats are PNG, JPEG, and WebP only. SVG — and HTML
 *   masquerading as an image — is refused outright: SVG is executable markup
 *   that can carry script and foreignObject payloads, so it must never be
 *   emitted into a preview document. Output is always a freshly constructed
 *   raster data URL (`data:image/png|jpeg|webp;base64,...`) built from bytes
 *   whose magic number and intrinsic dimensions were verified server-side;
 *   caller-supplied URL text is never passed through. Because round-trip
 *   byte-identity is required, the payload is NOT re-encoded (re-encoding
 *   would strip nothing an allowlisted raster decoder does not already
 *   ignore, and would break manifest hash equality); "sanitized" here means
 *   allowlisted MIME plus magic-byte, dimension, and hash verification with
 *   fresh URL construction.
 * - Byte/dimension/decoded-pixel limits bound what the sandboxed renderer may
 *   be asked to decode. The per-image byte ceiling reuses
 *   FORGE_SCREENSHOT_MAX_BYTES: the modify route already proves a 6 MB
 *   in-memory decode is acceptable on this server. The per-axis dimension cap
 *   (8192) guards decoder row allocation; the decoded-pixel cap (4096^2,
 *   ~64 MB worst-case RGBA canvas) bounds total renderer memory; the HTML cap
 *   keeps staged/preview documents servable (it binds before the per-image
 *   ceiling when many images embed at once). Header-declared dimensions are
 *   the enforcement point — mirroring decodePng(), which reads IHDR
 *   width/height without a full decode — because full raster decode happens
 *   in the sandboxed preview renderer, not in server memory.
 * - Placeholders use the exact grammar `muse-asset://<assetId>/v<version>`.
 *   Resolution is project-scoped and approval-gated: only `approved` versions
 *   owned by the requesting project resolve. Unknown, cross-project,
 *   unapproved, or malformed references are explicit errors, never silent
 *   omissions — preview HTML must not ship with a silently dropped image.
 * - Output satisfies the existing preview CSP (`img-src data: blob:`) by
 *   construction: every image is an inline `data:` URL, so
 *   `apps/server/src/routes/forge.ts` must NOT change for this feature.
 *
 * The asset record shape below is a minimal structural type. Teammate A2 owns
 * `apps/server/src/media/assets.ts`; when that store lands, its version
 * records can satisfy this interface directly (or be adapted to it) without
 * changing the resolver — the store is injected, never imported.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { FORGE_SCREENSHOT_MAX_BYTES } from '@mml/shared';

/** URL scheme that introduces every asset placeholder. */
export const EMBED_PLACEHOLDER_SCHEME = 'muse-asset://';

/**
 * Per-image decoded-byte ceiling. Shared with the modify-route screenshot
 * convention: a 6 MB in-memory decode is already proven acceptable.
 */
export const EMBED_IMAGE_MAX_BYTES = FORGE_SCREENSHOT_MAX_BYTES;

/** Per-axis dimension ceiling (width and height independently). */
export const EMBED_IMAGE_MAX_DIMENSION = 8192;

/** Decoded-pixel ceiling: 4096^2 pixels, ~64 MB worst-case RGBA canvas. */
export const EMBED_IMAGE_MAX_PIXELS = 16_777_216;

/** Servable-document ceiling for fully embedded preview HTML. */
export const EMBED_HTML_MAX_BYTES = 32_000_000;

/** Fail-fast bound on distinct asset references per document. */
export const EMBED_MAX_REFERENCES_PER_DOCUMENT = 16;

const EMBEDDABLE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type EmbeddableMimeType = (typeof EMBEDDABLE_MIME_TYPES)[number];

function isEmbeddableMimeType(value: string): value is EmbeddableMimeType {
  return (EMBEDDABLE_MIME_TYPES as readonly string[]).includes(value);
}

export type EmbedErrorCode =
  | 'invalid_placeholder'
  | 'unknown_asset_reference'
  | 'cross_project_reference'
  | 'unapproved_asset_reference'
  | 'unsupported_asset_media_type'
  | 'asset_bytes_mismatch'
  | 'asset_hash_mismatch'
  | 'asset_too_large'
  | 'asset_dimensions_exceeded'
  | 'asset_pixels_exceeded'
  | 'too_many_references'
  | 'embedded_html_too_large'
  | 'unresolved_placeholder';

export class EmbedError extends Error {
  readonly code: EmbedErrorCode;

  constructor(code: EmbedErrorCode, message: string) {
    super(message);
    this.name = 'EmbedError';
    this.code = code;
  }
}

/**
 * Minimal structural view of an A2 asset version record — only what the
 * resolver enforces. Read-only: this file never imports or edits assets.ts.
 */
export interface EmbeddableImageVersion {
  readonly assetId: string;
  readonly version: number;
  readonly projectId: string;
  readonly status: 'candidate' | 'approved' | 'rejected';
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /** Lowercase (or uppercase) hex sha256 of `bytes`; must match exactly. */
  readonly sha256Hex: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Project-bound asset lookup. `projectId` is the requesting project: any
 * record whose `projectId` differs is rejected as cross-project, so a store
 * implementation cannot accidentally leak another project's media.
 */
export interface EmbedAssetStore {
  readonly projectId: string;
  lookup(assetId: string, version: number): EmbeddableImageVersion | undefined | null;
}

export interface EmbedOptions {
  readonly htmlMaxBytes?: number;
}

export interface EmbeddedImage {
  readonly assetId: string;
  readonly version: number;
  readonly mimeType: EmbeddableMimeType;
  readonly bytes: number;
  readonly sha256Hex: string;
  readonly dataUrlLength: number;
}

export interface EmbeddedDocument {
  readonly html: string;
  readonly embedded: EmbeddedImage[];
  readonly bytes: number;
}

const PLACEHOLDER_GRAMMAR = /^muse-asset:\/\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/v([1-9][0-9]{0,8})$/;
const PLACEHOLDER_SCAN = /muse-asset:\/\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/v[1-9][0-9]{0,8}/g;
const PLACEHOLDER_LEFTOVER = /muse-asset:\/\/[^\s"'<>`]*/;

/**
 * Parse one placeholder reference under the exact grammar
 * `muse-asset://<assetId>/v<version>`: assetId is 1-64 chars of
 * [A-Za-z0-9_-] starting with an alphanumeric; version is a positive integer
 * with no leading zeros. Anything else is an explicit error.
 */
export function parseAssetPlaceholder(reference: string): {
  assetId: string;
  version: number;
} {
  const match = PLACEHOLDER_GRAMMAR.exec(reference);
  if (!match) {
    throw new EmbedError(
      'invalid_placeholder',
      `Invalid asset placeholder ${JSON.stringify(reference)}: ` +
        'expected muse-asset://<assetId>/v<version> ' +
        '(assetId: 1-64 [A-Za-z0-9_-] starting with an alphanumeric; ' +
        'version: positive integer without leading zeros).',
    );
  }
  return { assetId: match[1] ?? '', version: Number(match[2]) };
}

/** Unique well-formed references in document order; malformed ones throw. */
function collectPlaceholderReferences(html: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(PLACEHOLDER_SCAN)) {
    const reference = match[0];
    if (!seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  }
  const leftover = html.replace(PLACEHOLDER_SCAN, '').match(PLACEHOLDER_LEFTOVER);
  if (leftover) {
    throw new EmbedError(
      'invalid_placeholder',
      `Invalid asset placeholder ${JSON.stringify(leftover[0].slice(0, 80))}: ` +
        'expected muse-asset://<assetId>/v<version>.',
    );
  }
  return references;
}

/** Bounds-checked byte read that fails as an EmbedError, never a RangeError. */
function checkedByte(bytes: Buffer, offset: number, detail: string): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new EmbedError('asset_bytes_mismatch', `Corrupt image payload: ${detail}.`);
  }
  return value;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  const fail = (detail: string): EmbedError =>
    new EmbedError('asset_bytes_mismatch', `Corrupt PNG payload: ${detail}.`);
  if (bytes.length < 33) throw fail('truncated PNG header');
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (checkedByte(bytes, index, 'truncated PNG signature') !== PNG_SIGNATURE[index]) {
      throw fail('bad PNG signature');
    }
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw fail('missing IHDR chunk');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw fail('empty PNG frame');
  return { width, height };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpegDimensions(bytes: Buffer): { width: number; height: number } {
  const fail = (detail: string): EmbedError =>
    new EmbedError('asset_bytes_mismatch', `Corrupt JPEG payload: ${detail}.`);
  if (
    bytes.length < 4 ||
    checkedByte(bytes, 0, 'truncated SOI') !== 0xff ||
    checkedByte(bytes, 1, 'truncated SOI') !== 0xd8
  ) {
    throw fail('missing SOI marker');
  }
  let offset = 2;
  for (;;) {
    if (offset + 1 >= bytes.length) throw fail('truncated marker');
    if (checkedByte(bytes, offset, 'truncated marker') !== 0xff) {
      throw fail('expected marker prefix');
    }
    let marker = checkedByte(bytes, offset + 1, 'truncated marker');
    offset += 2;
    while (marker === 0xff) {
      marker = checkedByte(bytes, offset, 'truncated marker padding');
      offset += 1;
    }
    if (marker === 0x00) throw fail('stuffed byte outside scan data');
    // Standalone markers carry no length: SOI, TEM, RST0-RST7.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // A frame header must precede entropy-coded data; EOI/SOS first is corrupt.
    if (marker === 0xd9 || marker === 0xda) throw fail('no frame header before scan data');
    if (offset + 1 >= bytes.length) throw fail('truncated segment length');
    const segLen =
      (checkedByte(bytes, offset, 'truncated segment length') << 8) |
      checkedByte(bytes, offset + 1, 'truncated segment length');
    if (segLen < 2) throw fail('bad segment length');
    if (offset + segLen > bytes.length) throw fail('segment overruns payload');
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segLen < 7) throw fail('truncated frame header');
      const height =
        (checkedByte(bytes, offset + 3, 'truncated frame header') << 8) |
        checkedByte(bytes, offset + 4, 'truncated frame header');
      const width =
        (checkedByte(bytes, offset + 5, 'truncated frame header') << 8) |
        checkedByte(bytes, offset + 6, 'truncated frame header');
      if (width < 1 || height < 1) throw fail('empty JPEG frame');
      return { width, height };
    }
    offset += segLen;
  }
}

/**
 * Read intrinsic WebP dimensions. Returns null for valid containers whose
 * dimensions need extended-chunk parsing (VP8X/VP8L): those keep the manifest
 * record dimensions, which ingest validation already grounded.
 */
function parseWebpDimensions(bytes: Buffer): { width: number; height: number } | null {
  const fail = (detail: string): EmbedError =>
    new EmbedError('asset_bytes_mismatch', `Corrupt WebP payload: ${detail}.`);
  if (
    bytes.length < 16 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw fail('not a WebP container');
  }
  if (bytes.toString('ascii', 12, 16) !== 'VP8 ') return null;
  if (bytes.length < 30) throw fail('truncated VP8 chunk');
  if (
    checkedByte(bytes, 23, 'truncated VP8 frame') !== 0x9d ||
    checkedByte(bytes, 24, 'truncated VP8 frame') !== 0x01 ||
    checkedByte(bytes, 25, 'truncated VP8 frame') !== 0x2a
  ) {
    throw fail('bad VP8 start code');
  }
  const width =
    ((checkedByte(bytes, 26, 'truncated VP8 frame') |
      (checkedByte(bytes, 27, 'truncated VP8 frame') << 8)) &
      0x3fff) +
    1;
  const height =
    ((checkedByte(bytes, 28, 'truncated VP8 frame') |
      (checkedByte(bytes, 29, 'truncated VP8 frame') << 8)) &
      0x3fff) +
    1;
  return { width, height };
}

function readIntrinsicDimensions(
  mimeType: EmbeddableMimeType,
  bytes: Buffer,
): { width: number; height: number } | null {
  switch (mimeType) {
    case 'image/png':
      return parsePngDimensions(bytes);
    case 'image/jpeg':
      return parseJpegDimensions(bytes);
    case 'image/webp':
      return parseWebpDimensions(bytes);
  }
}

function resolveReference(
  reference: string,
  store: EmbedAssetStore,
): { dataUrl: string; embedded: EmbeddedImage } {
  const { assetId, version } = parseAssetPlaceholder(reference);
  const record = store.lookup(assetId, version);
  if (!record || record.assetId !== assetId || record.version !== version) {
    throw new EmbedError(
      'unknown_asset_reference',
      `Unknown asset reference ${reference}: no such asset version in this project.`,
    );
  }
  if (record.projectId !== store.projectId) {
    throw new EmbedError(
      'cross_project_reference',
      `Cross-project asset reference ${reference}: the asset belongs to project ` +
        `${JSON.stringify(record.projectId)} and cannot be embedded here.`,
    );
  }
  if (record.status !== 'approved') {
    throw new EmbedError(
      'unapproved_asset_reference',
      `Unapproved asset reference ${reference}: status is ${JSON.stringify(record.status)}; ` +
        'only approved versions embed.',
    );
  }
  if (!isEmbeddableMimeType(record.mimeType)) {
    throw new EmbedError(
      'unsupported_asset_media_type',
      `Unsupported media type ${JSON.stringify(record.mimeType)} for ${reference}: ` +
        'only image/png, image/jpeg, and image/webp embed (never SVG or HTML).',
    );
  }
  const bytes = Buffer.from(record.bytes);
  if (bytes.length === 0) {
    throw new EmbedError('asset_bytes_mismatch', `Empty image payload for ${reference}; refusing.`);
  }
  if (bytes.length > EMBED_IMAGE_MAX_BYTES) {
    throw new EmbedError(
      'asset_too_large',
      `${reference} is ${bytes.length} bytes, above the ${EMBED_IMAGE_MAX_BYTES}-byte image ceiling.`,
    );
  }
  const intrinsic = readIntrinsicDimensions(record.mimeType, bytes);
  if (intrinsic && (intrinsic.width !== record.width || intrinsic.height !== record.height)) {
    throw new EmbedError(
      'asset_bytes_mismatch',
      `${reference} manifest claims ${record.width}x${record.height} but the payload ` +
        `is ${intrinsic.width}x${intrinsic.height}; refusing.`,
    );
  }
  if (
    !Number.isInteger(record.width) ||
    !Number.isInteger(record.height) ||
    record.width < 1 ||
    record.height < 1 ||
    record.width > EMBED_IMAGE_MAX_DIMENSION ||
    record.height > EMBED_IMAGE_MAX_DIMENSION
  ) {
    throw new EmbedError(
      'asset_dimensions_exceeded',
      `${reference} claims ${record.width}x${record.height}; each axis is capped ` +
        `at ${EMBED_IMAGE_MAX_DIMENSION}px.`,
    );
  }
  if (record.width * record.height > EMBED_IMAGE_MAX_PIXELS) {
    throw new EmbedError(
      'asset_pixels_exceeded',
      `${reference} claims ${record.width}x${record.height} ` +
        `(${record.width * record.height} pixels), above the ${EMBED_IMAGE_MAX_PIXELS}-pixel budget.`,
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(record.sha256Hex)) {
    throw new EmbedError(
      'asset_hash_mismatch',
      `${reference} manifest carries a malformed sha256; refusing.`,
    );
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== record.sha256Hex.toLowerCase()) {
    throw new EmbedError(
      'asset_hash_mismatch',
      `${reference} payload hash ${digest} does not match the manifest; refusing.`,
    );
  }
  // Freshly constructed from verified bytes: satisfies `img-src data:` and
  // carries no caller-controlled URL text.
  const dataUrl = `data:${record.mimeType};base64,${bytes.toString('base64')}`;
  return {
    dataUrl,
    embedded: {
      assetId,
      version,
      mimeType: record.mimeType,
      bytes: bytes.length,
      sha256Hex: digest,
      dataUrlLength: dataUrl.length,
    },
  };
}

/**
 * Replace every `muse-asset://` placeholder in `html` with its bounded data
 * URL. Any failure — unknown, cross-project, unapproved, malformed,
 * over-limit, or hash-mismatched — throws an explicit EmbedError and embeds
 * nothing further. The returned HTML already satisfies the preview CSP.
 */
export function embedAssetImages(
  html: string,
  store: EmbedAssetStore,
  options?: EmbedOptions,
): EmbeddedDocument {
  const references = collectPlaceholderReferences(html);
  if (references.length > EMBED_MAX_REFERENCES_PER_DOCUMENT) {
    throw new EmbedError(
      'too_many_references',
      `Document references ${references.length} assets; the per-document ceiling ` +
        `is ${EMBED_MAX_REFERENCES_PER_DOCUMENT}.`,
    );
  }
  let embedded = html;
  const resolved: EmbeddedImage[] = [];
  for (const reference of references) {
    const result = resolveReference(reference, store);
    // String-pattern replaceAll is literal: placeholder grammar has no
    // pattern metacharacters to escape.
    embedded = embedded.replaceAll(reference, result.dataUrl);
    resolved.push(result.embedded);
  }
  const bytes = verifyEmbeddedHtml(embedded, options);
  return { html: embedded, embedded: resolved, bytes };
}

/**
 * Assert finished preview HTML carries no unresolved placeholders and stays
 * within the HTML size cap. Returns the UTF-8 byte length. Throws
 * `unresolved_placeholder` or `embedded_html_too_large`.
 */
export function verifyEmbeddedHtml(html: string, options?: EmbedOptions): number {
  if (html.includes(EMBED_PLACEHOLDER_SCHEME)) {
    const at = html.indexOf(EMBED_PLACEHOLDER_SCHEME);
    const sample = html.slice(at, at + 80);
    throw new EmbedError(
      'unresolved_placeholder',
      `Preview HTML still contains an unresolved asset placeholder near ` +
        `${JSON.stringify(sample)}; every muse-asset:// reference must resolve ` +
        'to a data URL before serving.',
    );
  }
  const cap = options?.htmlMaxBytes ?? EMBED_HTML_MAX_BYTES;
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > cap) {
    throw new EmbedError(
      'embedded_html_too_large',
      `Embedded preview HTML is ${bytes} bytes, above the ${cap}-byte document ceiling.`,
    );
  }
  return bytes;
}
