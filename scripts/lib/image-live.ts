import { join } from 'node:path';
import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace.ts';

/**
 * What a live image call is allowed to claim.
 *
 * Batch B has always been reported as "built and verified against fixtures".
 * The gap is not plumbing — it is that nobody has ever measured what the image
 * model actually returned. So this module turns a returned PNG into numbers:
 * dimensions, colour spread, how many pixels sit under each channel, and how
 * far an edit moved the picture. Those numbers are what a live acceptance run
 * asserts on; without them "the model answered" is the only evidence on offer.
 */

export interface ChannelCounts {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface ImageMeasurement {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  /** Distinct RGB triples, capped so a photographic image cannot blow up the report. */
  readonly distinctColors: number;
  /** Pixels where one channel beats the other two by `DOMINANCE_MARGIN`. */
  readonly dominant: ChannelCounts;
  /** Mean of each channel over the whole frame. */
  readonly mean: ChannelCounts;
}

/** A channel "dominates" when it leads the other two by at least this much. */
export const DOMINANCE_MARGIN = 40;
/** Distinct-colour counting stops here; the report says so when it does. */
export const DISTINCT_COLOR_CAP = 4096;

export interface ExpectedRegion {
  readonly channel: keyof ChannelCounts;
  /** Minimum share of pixels that must sit under this channel. */
  readonly minShare: number;
}

export interface RegionVerdict {
  readonly missing: string[];
  /** Share of pixels per channel, for the record. */
  readonly shares: ChannelCounts;
}

export function measurePng(rgba: Uint8Array, width: number, height: number): ImageMeasurement {
  const distinct = new Set<number>();
  let distinctFull = true;
  const dominant = { red: 0, green: 0, blue: 0 };
  const total = { red: 0, green: 0, blue: 0 };
  const pixels = width * height;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    if (distinctFull) {
      distinct.add((red << 16) | (green << 8) | blue);
      if (distinct.size > DISTINCT_COLOR_CAP) {
        distinctFull = false;
        distinct.clear();
      }
    }
    total.red += red;
    total.green += green;
    total.blue += blue;
    if (red - Math.max(green, blue) >= DOMINANCE_MARGIN) dominant.red += 1;
    else if (green - Math.max(red, blue) >= DOMINANCE_MARGIN) dominant.green += 1;
    else if (blue - Math.max(red, green) >= DOMINANCE_MARGIN) dominant.blue += 1;
  }
  return {
    width,
    height,
    pixels,
    distinctColors: distinctFull ? distinct.size : DISTINCT_COLOR_CAP,
    dominant,
    mean: {
      red: Math.round(total.red / pixels),
      green: Math.round(total.green / pixels),
      blue: Math.round(total.blue / pixels),
    },
  };
}

/** Share of the frame each dominant-channel count represents, as a 0..1 number. */
export function dominantShares(measurement: ImageMeasurement): ChannelCounts {
  return {
    red: measurement.dominant.red / measurement.pixels,
    green: measurement.dominant.green / measurement.pixels,
    blue: measurement.dominant.blue / measurement.pixels,
  };
}

/**
 * Did the picture contain the regions the prompt asked for? The thresholds are
 * deliberately generous: this is a coarse "the model drew the thing it was
 * told" signal, not a quality judgement, and every number is reported so the
 * reader can apply their own.
 */
export function checkRegions(
  measurement: ImageMeasurement,
  expected: readonly ExpectedRegion[],
): RegionVerdict {
  const shares = dominantShares(measurement);
  const missing = expected
    .filter((region) => shares[region.channel] < region.minShare)
    .map(
      (region) =>
        `${region.channel}-dominant pixels were ${(shares[region.channel] * 100).toFixed(1)}%, expected at least ${(region.minShare * 100).toFixed(1)}%`,
    );
  return { missing, shares };
}

/**
 * Share of pixels an edit changed, ignoring alpha. Identical dimensions are
 * required; a returned image of a different size is a contract change, not an
 * edit, and the caller decides what to do about that.
 */
export function diffShare(a: Uint8Array, b: Uint8Array, width: number, height: number): number {
  const pixels = width * height;
  let changed = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    if (
      (a[offset] ?? 0) !== (b[offset] ?? 0) ||
      (a[offset + 1] ?? 0) !== (b[offset + 1] ?? 0) ||
      (a[offset + 2] ?? 0) !== (b[offset + 2] ?? 0)
    ) {
      changed += 1;
    }
  }
  return changed / pixels;
}

/** The two prompts the run uses, and what each one must show to count. */
export const IMAGE_PROMPTS = {
  generate: {
    prompt: 'A flat-design poster: one solid red square centred on a solid green background.',
    size: '512x512',
    expected: [
      { channel: 'red', minShare: 0.02 },
      { channel: 'green', minShare: 0.1 },
    ] satisfies ExpectedRegion[],
  },
  edit: {
    prompt:
      'Add one solid blue circle in the middle. Keep the red square and the green background.',
    expected: [
      { channel: 'blue', minShare: 0.02 },
      { channel: 'red', minShare: 0.02 },
      { channel: 'green', minShare: 0.05 },
    ] satisfies ExpectedRegion[],
  },
} as const;

/** An edit that changed almost nothing is not an edit. */
export const MIN_EDIT_DIFF_SHARE = 0.005;

/**
 * Where the product stores an image asset version.
 *
 * The live harness reads these bytes to measure a paid call. Guessing the
 * layout is not acceptable: the first live generate wrote a real image and the
 * harness looked in the wrong place, then deleted the isolate. This helper is
 * pinned by a test that writes through the real asset store.
 */
export function assetVersionPaths(
  workspaceRoot: string,
  projectId: string,
  assetId: string,
  version: number,
): { bytes: string; manifest: string; dir: string } {
  // <WORKSPACE_ROOT>/forge/<project_id>/media/<asset_id>/<version>.bin
  const dir = join(workspaceRoot, 'forge', projectId, 'media', assetId);
  const suffix = String(version);
  return { dir, bytes: join(dir, `${suffix}.bin`), manifest: join(dir, `${suffix}.json`) };
}

/**
 * The only provider paths a Batch B image run may touch: one generate, one edit.
 *
 * Kept beside the measurement code so the budget and the pixel assertions live in
 * one place and can be exercised without a provider.
 */
export const IMAGE_ALLOWED_PATHS = ['/v1/images/generations', '/v1/images/edits'] as const;

/**
 * Whole-run ledger problems an image run must refuse before calling itself paid
 * and measured.
 *
 * Per-operation checks cannot see traffic outside their own slice, so an extra
 * dispatch on a path nobody expected (a `/v1/files` upload, a stray vision call)
 * used to pass while `calls.otherPaidPaths` sat non-zero in the report. The rule
 * here is the inverse of a forbidden list: every path in the ledger must be an
 * allowed one, the counts must be exact, and the ledger must be complete.
 */
export function imageLedgerIssues(
  ledger: DispatchAccount,
  expected: { generate: number; edit: number },
): string[] {
  const issues = ledgerIntegrityIssues(ledger, 'image run');
  const outside = pathsOutside(ledger, IMAGE_ALLOWED_PATHS);
  if (outside.length > 0) {
    issues.push(`image run dispatched paths it was never allowed to touch: ${outside.join(', ')}`);
  }
  const generate = ledger.dispatches.filter((d) => d.path === '/v1/images/generations').length;
  const edit = ledger.dispatches.filter((d) => d.path === '/v1/images/edits').length;
  if (generate !== expected.generate) {
    issues.push(
      `expected ${String(expected.generate)} generate dispatch(es), saw ${String(generate)}`,
    );
  }
  if (edit !== expected.edit) {
    issues.push(`expected ${String(expected.edit)} edit dispatch(es), saw ${String(edit)}`);
  }
  return issues;
}
