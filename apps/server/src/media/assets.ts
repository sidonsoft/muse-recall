/**
 * Project-scoped, versioned media asset store.
 *
 * Standalone module (no dependency on the media adapter/capabilities files):
 * it only needs a {@link ForgeWorkspace} for project-directory resolution and
 * path containment.
 *
 * Layout (all bytes outside SQLite):
 *   `<projectDir>/media/<assetId>/<version>.bin`   raw image bytes, mode 0600
 *   `<projectDir>/media/<assetId>/<version>.json`  immutable version manifest
 *   `<projectDir>/media/<assetId>/asset.json`      mutable curation pointer
 *                                                  (statuses + latest version)
 *
 * Guarantees:
 * - Only `image` assets with MIME `image/png`, `image/jpeg`, `image/webp`.
 *   SVG/HTML (and any other markup) is refused with an explicit error, as is
 *   any byte sequence whose magic bytes disagree with the declared MIME or
 *   whose dimensions cannot be parsed.
 * - Version manifests are write-once (`wx` + existence check): approving or
 *   rejecting an asset never rewrites history, it only advances the pointer.
 * - Every read re-verifies the sha256 of the bytes on disk against the
 *   manifest; drift throws `version_corrupt` instead of serving bad bytes.
 * - Cross-project references (a parent from another project) are rejected.
 * - All paths are contained with the same resolve+relative rule the Forge
 *   workspace uses; reads additionally refuse symlinks and re-check realpath.
 * - `verifyProjectMedia` / `collectMediaManifest` are integration-ready
 *   helpers for backup tooling: hash inventory without touching `backup.ts`.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { FORGE_PROJECT_ID_PATTERN } from '@mml/shared';
import type { ForgeWorkspace } from '../forge/workspace.js';

export type MediaKind = 'image';
export type MediaMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type MediaStatus = 'candidate' | 'approved' | 'rejected';

export type MediaErrorCode =
  | 'invalid_project_id'
  | 'invalid_asset_id'
  | 'invalid_version'
  | 'path_escape'
  | 'unsupported_mime'
  | 'malformed_media'
  | 'version_conflict'
  | 'version_corrupt'
  | 'cross_project_reference'
  | 'asset_not_found'
  | 'invalid_status_transition'
  | 'persistence_failed';

export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface MediaParentRef {
  asset_id: string;
  version?: number;
  project_id: string;
}

export interface MediaSource {
  kind?: 'prompt' | 'upload' | 'edit' | 'segment';
  text?: string;
  job_id?: string;
  /** SAM cutout provenance, mirroring the shared contract. */
  segment?: {
    concept: string;
    box: { x1: number; y1: number; x2: number; y2: number };
    confidence?: number;
    mask_width: number;
    mask_height: number;
  };
}

export interface MediaMemoryRef {
  memory_id: string;
  revision?: number;
}

export interface MediaModel {
  provider?: string;
  model?: string;
  /** Model id the provider reported in its response, when it reported one. */
  observed?: string;
}

export interface MediaUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export interface CreateMediaInput {
  kind: MediaKind;
  mime: MediaMime;
  bytes: Buffer | Uint8Array;
  parent?: MediaParentRef;
  source?: MediaSource;
  job_id?: string | null;
  memory_refs?: MediaMemoryRef[];
  model?: MediaModel;
  usage?: MediaUsage;
}

export interface MediaVersionRecord {
  asset_id: string;
  version: number;
  project_id: string;
  kind: MediaKind;
  mime: MediaMime;
  width: number;
  height: number;
  duration_ms: null;
  byte_size: number;
  sha256: string;
  parent: { asset_id: string; version: number; project_id: string } | null;
  source: MediaSource | null;
  job_id: string | null;
  memory_refs: MediaMemoryRef[];
  model: MediaModel | null;
  usage: MediaUsage | null;
  status: MediaStatus;
  created_at: string;
}

export interface MediaAssetSummary {
  asset_id: string;
  project_id: string;
  kind: MediaKind;
  created_at: string;
  updated_at: string;
  latest_version: number;
  version_count: number;
  approved_versions: number[];
}

export interface MediaMismatch {
  asset_id: string;
  version: number | null;
  reason: string;
}

export interface MediaVerifyResult {
  project_id: string;
  checked: number;
  ok: boolean;
  mismatches: MediaMismatch[];
}

export interface MediaManifestEntry {
  asset_id: string;
  version: number;
  mime: MediaMime;
  sha256: string;
  byte_size: number;
  bytes_path: string;
  manifest_path: string;
}

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MEDIA_ALLOWED_MIMES: readonly MediaMime[] = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_MEDIA_BYTES = 10_000_000;
const ALLOWED_MIMES = MEDIA_ALLOWED_MIMES;
const MAX_DIMENSION = 16_384;
const MAX_MEMORY_REFS = 50;
const MAX_TEXT = 2_000;
const MAX_LABEL = 120;

interface AssetPointer {
  asset_id: string;
  project_id: string;
  kind: MediaKind;
  created_at: string;
  updated_at: string;
  latest_version: number;
  statuses: Record<string, MediaStatus>;
}

function assertProjectId(projectId: string): void {
  if (!FORGE_PROJECT_ID_PATTERN.test(projectId)) {
    throw new MediaError('invalid_project_id', 'Invalid media project id.');
  }
}

function assertAssetId(assetId: string): void {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new MediaError('invalid_asset_id', 'Invalid media asset id.');
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new MediaError('invalid_version', 'Invalid media version number.');
  }
}

function within(base: string, ...parts: string[]): string {
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new MediaError('path_escape', 'Resolved media path escapes the project workspace.');
  }
  return target;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is best-effort; the file sync above still holds.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Atomic same-directory temp-file write with owner-only permissions. */
async function writeAtomic(dir: string, fileName: string, data: string | Buffer): Promise<void> {
  await ensurePrivateDir(dir);
  const target = within(dir, fileName);
  const temp = within(dir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600);
    await syncFile(temp);
    await rename(temp, target);
    await syncDirectory(dir);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (error instanceof MediaError) throw error;
    throw new MediaError(
      'persistence_failed',
      `Could not persist media file ${fileName}: ${(error as Error).message}`,
    );
  }
}

/** Read a file only if it is a regular file contained by the project. */
async function readContainedBuffer(projectDir: string, file: string): Promise<Buffer> {
  const stat = await lstat(file).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new MediaError(
      'version_corrupt',
      'Refusing to read a symlink or non-regular media file.',
    );
  }
  const [realFile, realProject] = await Promise.all([realpath(file), realpath(projectDir)]);
  if (!realFile.startsWith(realProject + sep)) {
    throw new MediaError('path_escape', 'Resolved media file escapes the project workspace.');
  }
  return readFile(file);
}

function sniffMime(bytes: Buffer): MediaMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function looksLikeMarkup(bytes: Buffer): string | null {
  const head = bytes.subarray(0, Math.min(bytes.length, 2048)).toString('utf8');
  const trimmed = head.replace(/^﻿/, '').trimStart().toLowerCase();
  if (!trimmed.startsWith('<')) return null;
  if (trimmed.startsWith('<svg')) return 'SVG';
  if (trimmed.startsWith('<html') || trimmed.startsWith('<!doctype html')) return 'HTML';
  if (trimmed.startsWith('<?xml')) return 'XML';
  return 'markup';
}

function checkDimensions(
  width: number,
  height: number,
  mime: MediaMime,
): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new MediaError(
      'malformed_media',
      `Malformed ${mime} media: dimensions ${String(width)}x${String(height)} are not positive integers.`,
    );
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new MediaError(
      'malformed_media',
      `Malformed ${mime} media: dimensions ${String(width)}x${String(height)} exceed the ${String(MAX_DIMENSION)}px limit.`,
    );
  }
  return { width, height };
}

function parsePngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new MediaError(
      'malformed_media',
      'Malformed image/png media: missing or truncated IHDR chunk.',
    );
  }
  return checkDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'image/png');
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpegDimensions(bytes: Buffer): { width: number; height: number } {
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      throw new MediaError(
        'malformed_media',
        'Malformed image/jpeg media: corrupted marker sequence.',
      );
    }
    let marker: number | undefined = bytes[pos + 1];
    // Skip fill bytes.
    while (marker === 0xff && pos + 4 <= bytes.length) {
      pos += 1;
      marker = bytes[pos + 1];
    }
    if (marker === undefined) {
      throw new MediaError(
        'malformed_media',
        'Malformed image/jpeg media: truncated marker sequence.',
      );
    }
    if (marker === 0xd8) {
      pos += 2; // SOI: standalone.
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS before SOF: malformed.
    if (pos + 4 > bytes.length) break;
    const length = bytes.readUInt16BE(pos + 2);
    if (length < 2 || pos + length > bytes.length) {
      throw new MediaError('malformed_media', 'Malformed image/jpeg media: truncated segment.');
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) {
        throw new MediaError(
          'malformed_media',
          'Malformed image/jpeg media: truncated start-of-frame.',
        );
      }
      return checkDimensions(
        bytes.readUInt16BE(pos + 7),
        bytes.readUInt16BE(pos + 5),
        'image/jpeg',
      );
    }
    pos += 2 + length;
  }
  throw new MediaError(
    'malformed_media',
    'Malformed image/jpeg media: no start-of-frame marker found.',
  );
}

function parseWebpDimensions(bytes: Buffer): { width: number; height: number } {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const tag = bytes.subarray(pos, pos + 4).toString('ascii');
    const size = bytes.readUInt32LE(pos + 4);
    const data = pos + 8;
    if (tag === 'VP8 ') {
      if (data + 10 > bytes.length) break;
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        throw new MediaError('malformed_media', 'Malformed image/webp media: bad VP8 start code.');
      }
      const width = bytes.readUInt16LE(data + 6) & 0x3fff;
      const height = bytes.readUInt16LE(data + 8) & 0x3fff;
      return checkDimensions(width, height, 'image/webp');
    }
    if (tag === 'VP8L') {
      if (data + 5 > bytes.length) break;
      if (bytes[data] !== 0x2f) {
        throw new MediaError('malformed_media', 'Malformed image/webp media: bad VP8L signature.');
      }
      const bits = bytes.readUInt32LE(data + 1);
      return checkDimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, 'image/webp');
    }
    if (tag === 'VP8X') {
      // The VP8X payload starts with four flag bytes, then canvas width minus 1
      // and canvas height minus 1 as three-byte little-endian values. Reading
      // the dimensions one byte in reported the width from flag padding: a real
      // 1600x1600 WebP from the live image model was stored as 1x1600, which
      // would have mis-scaled every downstream reference and preview.
      if (data + 10 > bytes.length) break;
      const width = bytes.readUIntLE(data + 4, 3) + 1;
      const height = bytes.readUIntLE(data + 7, 3) + 1;
      return checkDimensions(width, height, 'image/webp');
    }
    pos = data + size + (size % 2);
  }
  throw new MediaError(
    'malformed_media',
    'Malformed image/webp media: no VP8/VP8L/VP8X chunk found.',
  );
}

/**
 * Validate magic bytes, markup refusal, MIME agreement and intrinsic
 * dimensions. Exported for the generation/edit path, which receives bytes
 * whose MIME is discovered rather than declared (`declared = null`).
 */
export function inspectMediaBytes(
  bytes: Buffer,
  declared: MediaMime | null,
): { mime: MediaMime; width: number; height: number } {
  if (bytes.length === 0) {
    throw new MediaError('malformed_media', 'Malformed media: empty byte sequence refused.');
  }
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new MediaError(
      'malformed_media',
      `Malformed media: ${String(bytes.length)} bytes exceeds the ${String(MAX_MEDIA_BYTES)}-byte limit.`,
    );
  }
  const markup = looksLikeMarkup(bytes);
  if (markup !== null) {
    throw new MediaError(
      'unsupported_mime',
      `Refused ${markup} media: SVG/HTML documents are not image assets.`,
    );
  }
  if (declared !== null && !ALLOWED_MIMES.includes(declared)) {
    throw new MediaError(
      'unsupported_mime',
      `Unsupported media MIME ${declared}: only image/png, image/jpeg and image/webp are accepted; SVG/HTML are refused.`,
    );
  }
  const sniffed = sniffMime(bytes);
  if (sniffed === null) {
    throw new MediaError(
      'malformed_media',
      `Malformed ${declared ?? 'media'}: magic bytes do not identify a PNG, JPEG or WebP image.`,
    );
  }
  if (declared !== null && sniffed !== declared) {
    throw new MediaError(
      'malformed_media',
      `Malformed media: declared MIME ${declared} disagrees with detected ${sniffed}; refusing mismatched bytes.`,
    );
  }
  const dims =
    sniffed === 'image/png'
      ? parsePngDimensions(bytes)
      : sniffed === 'image/jpeg'
        ? parseJpegDimensions(bytes)
        : parseWebpDimensions(bytes);
  return { mime: sniffed, width: dims.width, height: dims.height };
}

function cleanLabel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.slice(0, MAX_LABEL);
}

function validateMemoryRefs(input: unknown): MediaMemoryRef[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: memory_refs must be an array.',
    );
  }
  if (input.length > MAX_MEMORY_REFS) {
    throw new MediaError(
      'malformed_media',
      `Malformed media metadata: at most ${String(MAX_MEMORY_REFS)} memory references allowed.`,
    );
  }
  return input.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new MediaError(
        'malformed_media',
        'Malformed media metadata: memory reference must be an object.',
      );
    }
    const candidate = entry as { memory_id?: unknown; revision?: unknown };
    if (
      typeof candidate.memory_id !== 'string' ||
      candidate.memory_id.length === 0 ||
      candidate.memory_id.length > 256
    ) {
      throw new MediaError(
        'malformed_media',
        'Malformed media metadata: memory_id must be a non-empty string.',
      );
    }
    const ref: MediaMemoryRef = { memory_id: candidate.memory_id };
    if (candidate.revision !== undefined) {
      if (!Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0) {
        throw new MediaError(
          'malformed_media',
          'Malformed media metadata: revision must be a non-negative integer.',
        );
      }
      ref.revision = candidate.revision as number;
    }
    return ref;
  });
}

function validateModel(input: unknown): MediaModel | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new MediaError('malformed_media', 'Malformed media metadata: model must be an object.');
  }
  const candidate = input as { provider?: unknown; model?: unknown; observed?: unknown };
  const provider = cleanLabel(candidate.provider);
  const model = cleanLabel(candidate.model);
  const observed = cleanLabel(candidate.observed);
  if (provider === undefined && model === undefined && observed === undefined) return null;
  // Closed shape: only the three bounded labels survive, so secrets placed in
  // extra fields can never reach the manifest.
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(observed !== undefined ? { observed } : {}),
  };
}

function validateUsage(input: unknown): MediaUsage | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new MediaError('malformed_media', 'Malformed media metadata: usage must be an object.');
  }
  const candidate = input as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cost_usd?: unknown;
  };
  const usage: MediaUsage = {};
  for (const key of ['input_tokens', 'output_tokens'] as const) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new MediaError(
        'malformed_media',
        `Malformed media metadata: ${key} must be a non-negative integer.`,
      );
    }
    usage[key] = value as number;
  }
  if (candidate.cost_usd !== undefined) {
    if (
      typeof candidate.cost_usd !== 'number' ||
      !Number.isFinite(candidate.cost_usd) ||
      candidate.cost_usd < 0
    ) {
      throw new MediaError(
        'malformed_media',
        'Malformed media metadata: cost_usd must be a finite non-negative number.',
      );
    }
    usage.cost_usd = candidate.cost_usd;
  }
  return Object.keys(usage).length === 0 ? null : usage;
}

function validateSource(input: unknown): MediaSource | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new MediaError('malformed_media', 'Malformed media metadata: source must be an object.');
  }
  const candidate = input as {
    kind?: unknown;
    text?: unknown;
    job_id?: unknown;
    segment?: unknown;
  };
  if (
    candidate.kind !== undefined &&
    candidate.kind !== 'prompt' &&
    candidate.kind !== 'upload' &&
    candidate.kind !== 'edit' &&
    candidate.kind !== 'segment'
  ) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.kind must be prompt, upload, edit or segment.',
    );
  }
  if (
    candidate.text !== undefined &&
    (typeof candidate.text !== 'string' || candidate.text.length > MAX_TEXT)
  ) {
    throw new MediaError(
      'malformed_media',
      `Malformed media metadata: source.text is bounded to ${String(MAX_TEXT)} chars.`,
    );
  }
  if (
    candidate.job_id !== undefined &&
    (typeof candidate.job_id !== 'string' || !JOB_ID_PATTERN.test(candidate.job_id))
  ) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.job_id must be a job id.',
    );
  }
  const source: MediaSource = {};
  if (candidate.kind !== undefined) source.kind = candidate.kind;
  if (typeof candidate.text === 'string') source.text = candidate.text;
  if (typeof candidate.job_id === 'string') source.job_id = candidate.job_id;
  const segment = validateSegmentProvenance(candidate.segment);
  if (segment !== undefined) source.segment = segment;
  return Object.keys(source).length === 0 ? null : source;
}

/** Closed shape for SAM cutout provenance: bounded, no secret room. */
function validateSegmentProvenance(input: unknown): MediaSource['segment'] | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.segment must be an object.',
    );
  }
  const candidate = input as {
    concept?: unknown;
    box?: unknown;
    confidence?: unknown;
    mask_width?: unknown;
    mask_height?: unknown;
  };
  if (
    typeof candidate.concept !== 'string' ||
    candidate.concept.length < 1 ||
    candidate.concept.length > 120
  ) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.segment.concept is bounded to 1..120 chars.',
    );
  }
  const box = candidate.box;
  if (box === null || typeof box !== 'object' || Array.isArray(box)) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.segment.box must be an object.',
    );
  }
  const coords = box as Record<string, unknown>;
  for (const key of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (
      typeof coords[key] !== 'number' ||
      !Number.isSafeInteger(coords[key]) ||
      (coords[key] as number) < 0
    ) {
      throw new MediaError(
        'malformed_media',
        `Malformed media metadata: source.segment.box.${key} must be a safe non-negative integer.`,
      );
    }
  }
  if (
    candidate.confidence !== undefined &&
    (typeof candidate.confidence !== 'number' ||
      !(candidate.confidence >= 0 && candidate.confidence <= 1))
  ) {
    throw new MediaError(
      'malformed_media',
      'Malformed media metadata: source.segment.confidence must be within [0, 1].',
    );
  }
  for (const key of ['mask_width', 'mask_height'] as const) {
    if (
      typeof candidate[key] !== 'number' ||
      !Number.isSafeInteger(candidate[key]) ||
      (candidate[key] as number) < 1
    ) {
      throw new MediaError(
        'malformed_media',
        `Malformed media metadata: source.segment.${key} must be a positive integer.`,
      );
    }
  }
  return {
    concept: candidate.concept,
    box: {
      x1: coords.x1 as number,
      y1: coords.y1 as number,
      x2: coords.x2 as number,
      y2: coords.y2 as number,
    },
    ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
    mask_width: candidate.mask_width as number,
    mask_height: candidate.mask_height as number,
  };
}

export class MediaAssetStore {
  /**
   * Single-process serialisation per asset, mirroring the ForgeJobStore
   * write queue: two concurrent `addVersion` calls for the same asset must
   * not compute the same next version and overwrite each other's bytes.
   * Crashed holders never block: the entry is removed in `finally`.
   */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly workspace: ForgeWorkspace) {}

  private async withAssetLock<T>(assetKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(assetKey) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Tails only ever resolve (via release), so awaiting `previous` cannot
    // throw and a crashed holder always unblocks its waiter in `finally`.
    const tail = previous.then(() => mine);
    this.locks.set(assetKey, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(assetKey) === tail) this.locks.delete(assetKey);
    }
  }

  private mediaDir(projectId: string): string {
    return within(this.workspace.projectDir(projectId), 'media');
  }

  private assetDir(projectId: string, assetId: string): string {
    assertAssetId(assetId);
    return within(this.mediaDir(projectId), assetId);
  }

  private bytesFile(projectId: string, assetId: string, version: number): string {
    assertVersion(version);
    return within(this.assetDir(projectId, assetId), `${String(version)}.bin`);
  }

  private manifestFile(projectId: string, assetId: string, version: number): string {
    assertVersion(version);
    return within(this.assetDir(projectId, assetId), `${String(version)}.json`);
  }

  private pointerFile(projectId: string, assetId: string): string {
    return within(this.assetDir(projectId, assetId), 'asset.json');
  }

  async createAsset(projectId: string, input: CreateMediaInput): Promise<MediaVersionRecord> {
    assertProjectId(projectId);
    const assetId = randomUUID();
    return this.withAssetLock(`${projectId}/${assetId}`, () =>
      this.storeVersion(projectId, assetId, 1, input, true),
    );
  }

  async addVersion(
    projectId: string,
    assetId: string,
    input: CreateMediaInput,
  ): Promise<MediaVersionRecord> {
    assertProjectId(projectId);
    assertAssetId(assetId);
    return this.withAssetLock(`${projectId}/${assetId}`, async () => {
      const pointer = await this.readPointer(projectId, assetId);
      if (!pointer) {
        throw new MediaError(
          'asset_not_found',
          `Media asset ${assetId} does not exist in this project.`,
        );
      }
      if (pointer.kind !== input.kind) {
        throw new MediaError('malformed_media', 'New versions must keep the asset kind.');
      }
      return this.storeVersion(projectId, assetId, pointer.latest_version + 1, input, false);
    });
  }

  async getVersion(
    projectId: string,
    assetId: string,
    version: number,
  ): Promise<MediaVersionRecord> {
    assertProjectId(projectId);
    const record = await this.readManifest(projectId, assetId, version);
    const pointer = await this.readPointer(projectId, assetId);
    const overlay = pointer?.statuses[String(version)];
    return overlay !== undefined ? { ...record, status: overlay } : record;
  }

  /** Byte-identical round trip: hash-verified against the immutable manifest. */
  async readBytes(projectId: string, assetId: string, version: number): Promise<Buffer> {
    assertProjectId(projectId);
    const record = await this.readManifest(projectId, assetId, version);
    const bytes = await readContainedBuffer(
      this.workspace.projectDir(projectId),
      this.bytesFile(projectId, assetId, version),
    );
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== record.sha256) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} v${String(version)} no longer matches its recorded hash.`,
      );
    }
    if (bytes.length !== record.byte_size) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} v${String(version)} no longer matches its recorded byte size.`,
      );
    }
    return bytes;
  }

  async approve(projectId: string, assetId: string, version: number): Promise<MediaVersionRecord> {
    return this.setStatus(projectId, assetId, version, 'approved');
  }

  async reject(projectId: string, assetId: string, version: number): Promise<MediaVersionRecord> {
    return this.setStatus(projectId, assetId, version, 'rejected');
  }

  async listAssets(projectId: string): Promise<MediaAssetSummary[]> {
    assertProjectId(projectId);
    let entries: string[];
    try {
      entries = await readdir(this.mediaDir(projectId));
    } catch {
      return [];
    }
    const summaries: MediaAssetSummary[] = [];
    for (const name of entries.sort()) {
      if (name.startsWith('.') || !ASSET_ID_PATTERN.test(name)) continue;
      const pointer = await this.readPointer(projectId, name);
      if (!pointer) continue;
      summaries.push({
        asset_id: pointer.asset_id,
        project_id: projectId,
        kind: pointer.kind,
        created_at: pointer.created_at,
        updated_at: pointer.updated_at,
        latest_version: pointer.latest_version,
        version_count: Object.keys(pointer.statuses).length,
        approved_versions: Object.entries(pointer.statuses)
          .filter(([, status]) => status === 'approved')
          .map(([version]) => Number(version))
          .sort((a, b) => a - b),
      });
    }
    return summaries;
  }

  async listVersions(projectId: string, assetId: string): Promise<MediaVersionRecord[]> {
    assertProjectId(projectId);
    assertAssetId(assetId);
    const pointer = await this.readPointer(projectId, assetId);
    if (!pointer) {
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} does not exist in this project.`,
      );
    }
    const records: MediaVersionRecord[] = [];
    for (let version = 1; version <= pointer.latest_version; version += 1) {
      records.push(await this.getVersion(projectId, assetId, version));
    }
    return records;
  }

  /**
   * Hash inventory for backup tooling: every manifest with the on-disk byte
   * path, so a backup drill can prove hash preservation without reading
   * `backup.ts` internals. Never throws on a damaged project; damage is data.
   */
  async collectMediaManifest(projectId: string): Promise<MediaManifestEntry[]> {
    assertProjectId(projectId);
    const entries: MediaManifestEntry[] = [];
    for (const summary of await this.listAssets(projectId)) {
      for (let version = 1; version <= summary.latest_version; version += 1) {
        try {
          const record = await this.readManifest(projectId, summary.asset_id, version);
          entries.push({
            asset_id: record.asset_id,
            version: record.version,
            mime: record.mime,
            sha256: record.sha256,
            byte_size: record.byte_size,
            bytes_path: this.bytesFile(projectId, record.asset_id, version),
            manifest_path: this.manifestFile(projectId, record.asset_id, version),
          });
        } catch {
          // Damaged versions are reported by verifyProjectMedia, not hidden here.
        }
      }
    }
    return entries;
  }

  /**
   * Re-hash every stored version and report drift. Used by backup drills to
   * prove hash preservation across backup/restore cycles.
   */
  async verifyProjectMedia(projectId: string): Promise<MediaVerifyResult> {
    assertProjectId(projectId);
    const mismatches: MediaMismatch[] = [];
    let checked = 0;
    for (const summary of await this.listAssets(projectId)) {
      for (let version = 1; version <= summary.latest_version; version += 1) {
        checked += 1;
        try {
          await this.readBytes(projectId, summary.asset_id, version);
        } catch (error) {
          mismatches.push({
            asset_id: summary.asset_id,
            version,
            reason: error instanceof Error ? error.message : 'Unreadable media version.',
          });
        }
      }
    }
    return { project_id: projectId, checked, ok: mismatches.length === 0, mismatches };
  }

  private async storeVersion(
    projectId: string,
    assetId: string,
    version: number,
    input: CreateMediaInput,
    isNewAsset: boolean,
  ): Promise<MediaVersionRecord> {
    if (input.kind !== 'image') {
      throw new MediaError('unsupported_mime', 'Only image media assets are supported.');
    }
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    const parsed = inspectMediaBytes(bytes, input.mime);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    let parent: MediaVersionRecord['parent'] = null;
    if (input.parent) {
      // Cross-project check runs before any filesystem touch so the failure
      // mode is explicit rather than a missing-file lookup.
      if (input.parent.project_id !== projectId) {
        throw new MediaError(
          'cross_project_reference',
          `Refusing parent ${input.parent.asset_id} from project ${input.parent.project_id} in project ${projectId}.`,
        );
      }
      assertAssetId(input.parent.asset_id);
      const parentVersion =
        input.parent.version ??
        (await this.readPointer(projectId, input.parent.asset_id))?.latest_version;
      if (parentVersion === undefined) {
        throw new MediaError(
          'asset_not_found',
          `Parent media asset ${input.parent.asset_id} does not exist in this project.`,
        );
      }
      await this.readManifest(projectId, input.parent.asset_id, parentVersion);
      parent = { asset_id: input.parent.asset_id, version: parentVersion, project_id: projectId };
    }

    if (input.job_id !== undefined && input.job_id !== null && !JOB_ID_PATTERN.test(input.job_id)) {
      throw new MediaError('malformed_media', 'Malformed media metadata: job_id must be a job id.');
    }

    const now = new Date().toISOString();
    const record: MediaVersionRecord = {
      asset_id: assetId,
      version,
      project_id: projectId,
      kind: 'image',
      mime: parsed.mime,
      width: parsed.width,
      height: parsed.height,
      duration_ms: null,
      byte_size: bytes.length,
      sha256,
      parent,
      source: validateSource(input.source),
      job_id: input.job_id ?? null,
      memory_refs: validateMemoryRefs(input.memory_refs),
      model: validateModel(input.model),
      usage: validateUsage(input.usage),
      status: 'candidate',
      created_at: now,
    };

    const dir = this.assetDir(projectId, assetId);
    // Write-once guard: an existing manifest means this version already
    // exists, so refuse instead of overwriting immutable history.
    const manifestPath = this.manifestFile(projectId, assetId, version);
    if (await this.exists(manifestPath)) {
      throw new MediaError(
        'version_conflict',
        `Media asset ${assetId} v${String(version)} already exists; versions are immutable.`,
      );
    }
    await writeAtomic(dir, `${String(version)}.bin`, bytes);
    try {
      await writeAtomic(dir, `${String(version)}.json`, `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      await rm(this.bytesFile(projectId, assetId, version), { force: true }).catch(() => undefined);
      throw error;
    }

    const previous = await this.readPointer(projectId, assetId);
    const pointer: AssetPointer = {
      asset_id: assetId,
      project_id: projectId,
      kind: 'image',
      created_at: previous?.created_at ?? now,
      updated_at: now,
      latest_version: version,
      statuses: { ...(previous?.statuses ?? {}), [String(version)]: 'candidate' },
    };
    if (!isNewAsset && !previous) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} does not exist in this project.`,
      );
    }
    await writeAtomic(dir, 'asset.json', `${JSON.stringify(pointer, null, 2)}\n`);
    return record;
  }

  private async setStatus(
    projectId: string,
    assetId: string,
    version: number,
    status: MediaStatus,
  ): Promise<MediaVersionRecord> {
    assertProjectId(projectId);
    assertAssetId(assetId);
    assertVersion(version);
    const pointer = await this.readPointer(projectId, assetId);
    if (!pointer) {
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} does not exist in this project.`,
      );
    }
    await this.readManifest(projectId, assetId, version);
    const current = pointer.statuses[String(version)];
    if (current === undefined) {
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} v${String(version)} does not exist.`,
      );
    }
    if (current !== 'candidate') {
      throw new MediaError(
        'invalid_status_transition',
        `Media asset ${assetId} v${String(version)} is already ${current}; only candidates can be approved or rejected.`,
      );
    }
    const next: AssetPointer = {
      ...pointer,
      updated_at: new Date().toISOString(),
      statuses: { ...pointer.statuses, [String(version)]: status },
    };
    await writeAtomic(
      this.assetDir(projectId, assetId),
      'asset.json',
      `${JSON.stringify(next, null, 2)}\n`,
    );
    return this.getVersion(projectId, assetId, version);
  }

  private async readPointer(projectId: string, assetId: string): Promise<AssetPointer | null> {
    let raw: string;
    try {
      raw = await readFile(this.pointerFile(projectId, assetId), 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} has an unreadable asset pointer.`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} has a malformed asset pointer.`,
      );
    }
    const candidate = parsed as Partial<AssetPointer>;
    if (
      candidate.asset_id !== assetId ||
      candidate.project_id !== projectId ||
      candidate.kind !== 'image' ||
      !Number.isSafeInteger(candidate.latest_version) ||
      typeof candidate.statuses !== 'object' ||
      candidate.statuses === null
    ) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} has a malformed asset pointer.`,
      );
    }
    return candidate as AssetPointer;
  }

  private async readManifest(
    projectId: string,
    assetId: string,
    version: number,
  ): Promise<MediaVersionRecord> {
    assertAssetId(assetId);
    assertVersion(version);
    let raw: string;
    try {
      raw = await readContainedBuffer(
        this.workspace.projectDir(projectId),
        this.manifestFile(projectId, assetId, version),
      ).then((buffer) => buffer.toString('utf8'));
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError(
        'asset_not_found',
        `Media asset ${assetId} v${String(version)} does not exist.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} v${String(version)} has an unreadable manifest.`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} v${String(version)} has a malformed manifest.`,
      );
    }
    const record = parsed as Partial<MediaVersionRecord>;
    if (
      record.asset_id !== assetId ||
      record.version !== version ||
      record.project_id !== projectId ||
      record.kind !== 'image' ||
      !ALLOWED_MIMES.includes(record.mime as MediaMime) ||
      typeof record.sha256 !== 'string' ||
      typeof record.byte_size !== 'number'
    ) {
      throw new MediaError(
        'version_corrupt',
        `Media asset ${assetId} v${String(version)} has a malformed manifest.`,
      );
    }
    return record as MediaVersionRecord;
  }

  private async exists(file: string): Promise<boolean> {
    try {
      const stat = await lstat(file);
      return stat.isFile() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }
}
