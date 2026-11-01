/**
 * Retained SAM cutout evidence for the live-smoke cutout-continuation
 * (`BATCHC_SMOKE_RESUME_CUTOUT=<evidence-dir>`): reuses a previous run's
 * cutout PNG bytes in a fresh isolated project without a new SAM or
 * vision dispatch. Fail-closed like the vision loader: missing files,
 * unparsable reports, or a sha mismatch throw before any browser,
 * server, or provider work. The cutout is labeled retained live output
 * everywhere it is used — never a fresh SAM result.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RetainedCutout {
  /** Evidence directory the cutout was retained from. */
  dir: string;
  /** Exact cutout PNG bytes (sha-verified against the retained report). */
  bytes: Buffer;
  sha256: string;
  /** Original SAM segment id (audit trail, not reused for inference). */
  segmentId: string;
  /** Original segmentation concept (audit trail). */
  concept: string;
  /** Original match box in source pixels (audit trail). */
  box: { x1: number; y1: number; x2: number; y2: number };
  maskWidth: number;
  maskHeight: number;
  /** Reference image the cutout was taken from (sha + path). */
  referenceSha256: string;
  referencePath: string;
}

const MAX_REPORT_BYTES = 1_000_000;

function fail(dir: string, reason: string): never {
  throw new Error(`cannot reuse retained cutout from ${dir}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readReport(dir: string): Record<string, unknown> {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(join(dir, 'report.json'));
  } catch {
    fail(dir, 'report.json is missing');
  }
  if (!stat.isFile() || stat.size > MAX_REPORT_BYTES)
    fail(dir, 'report.json is not a readable report');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  } catch {
    fail(dir, 'report.json is not valid JSON');
  }
  if (!isRecord(parsed)) fail(dir, 'report.json is not an object');
  return parsed;
}

/** Load and validate a retained cutout; throws on any mismatch. */
export function loadRetainedCutout(dir: string): RetainedCutout {
  const trimmed = dir.trim();
  if (trimmed.length === 0) fail(dir, 'empty directory');
  let bytes: Buffer;
  try {
    const st = statSync(join(trimmed, 'cutout.png'));
    if (!st.isFile() || st.size === 0) fail(trimmed, 'cutout.png is missing or empty');
    bytes = readFileSync(join(trimmed, 'cutout.png'));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('cannot reuse retained cutout'))
      throw error;
    fail(trimmed, 'cutout.png is missing or unreadable');
  }
  const report = readReport(trimmed);
  const observations = report.observations;
  if (!isRecord(observations)) fail(trimmed, 'report has no observations object');
  const cutoutPng = observations.cutoutPng;
  if (!isRecord(cutoutPng) || typeof cutoutPng.sha256 !== 'string') {
    fail(trimmed, 'report has no cutoutPng.sha256 to verify against');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== cutoutPng.sha256) {
    fail(
      trimmed,
      `cutout.png sha256 ${sha256.slice(0, 12)}… does not match retained ${String(cutoutPng.sha256).slice(0, 12)}…`,
    );
  }
  const segment = observations.segment;
  const segmentId =
    isRecord(segment) && typeof segment.segment_id === 'string' ? segment.segment_id : null;
  if (segmentId === null || segmentId.length === 0)
    fail(trimmed, 'report has no segment.segment_id');
  const cutout = observations.cutout;
  const source = isRecord(cutout) ? cutout.source : null;
  const inner = isRecord(source) ? source.segment : source;
  const concept =
    (isRecord(source) && typeof source.text === 'string' && source.text) ||
    (isRecord(inner) && typeof inner.concept === 'string' && inner.concept) ||
    null;
  if (concept === null || concept.length === 0) fail(trimmed, 'report has no cutout concept');
  const boxRaw = isRecord(inner)
    ? inner.box
    : isRecord(source) && isRecord(source.box)
      ? source.box
      : null;
  const box =
    isRecord(boxRaw) &&
    Number.isInteger(boxRaw.x1) &&
    Number.isInteger(boxRaw.y1) &&
    Number.isInteger(boxRaw.x2) &&
    Number.isInteger(boxRaw.y2) &&
    (boxRaw.x2 as number) > (boxRaw.x1 as number) &&
    (boxRaw.y2 as number) > (boxRaw.y1 as number)
      ? {
          x1: boxRaw.x1 as number,
          y1: boxRaw.y1 as number,
          x2: boxRaw.x2 as number,
          y2: boxRaw.y2 as number,
        }
      : null;
  if (box === null) fail(trimmed, 'report has no usable cutout box');
  const mask_width =
    isRecord(inner) && typeof inner.mask_width === 'number' ? inner.mask_width : null;
  const mask_height =
    isRecord(inner) && typeof inner.mask_height === 'number' ? inner.mask_height : null;
  if (mask_width === null || mask_height === null) fail(trimmed, 'report has no cutout mask dims');
  const reference = report.reference_image;
  const referenceSha256 =
    isRecord(reference) && typeof reference.sha256 === 'string' ? reference.sha256 : null;
  const referencePath =
    isRecord(reference) && typeof reference.path === 'string' ? reference.path : null;
  if (referenceSha256 === null || referencePath === null) {
    fail(trimmed, 'report has no reference_image sha/path to re-upload');
  }
  return {
    dir: trimmed,
    bytes,
    sha256,
    segmentId,
    concept,
    box,
    maskWidth: mask_width,
    maskHeight: mask_height,
    referenceSha256,
    referencePath,
  };
}
