import {
  decodeMaskToRaster,
  formats,
  recordsOfKind,
  type SegmentationMaskRecord,
} from '@meta-sam/parser';
import { ProviderError } from '@mml/muse-provider';
import { DEFAULT_SAM_MODEL, DEFAULT_VISION_MODEL } from '@mml/shared';
import { PNG } from 'pngjs';
import type { MediaAdapter } from './adapter.js';
import { parseResponsesEnvelope } from './capabilities.js';
import { assembleResponsesStream, collectOutputParts } from './sse.js';

/**
 * Batch C — SAM object extraction and vision understanding over the
 * Responses API.
 *
 * Segmentation uses the documented `sam-3.1` geometry lane (never the Studio
 * coding model and never the image model: those endpoints do not accept
 * these model ids). The official `@meta-sam/parser` validates the wire
 * grammar and decodes mask payloads; this module only maps the parsed
 * records onto source pixels and composites PNGs.
 */

export interface SegmentBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ParsedSegmentMatch {
  objectId: string;
  box: SegmentBox;
  confidence?: number;
  maskWidth: number;
  maskHeight: number;
  /** Row-major 0/1 bytes, maskWidth * maskHeight. */
  raster: Uint8Array;
}

/** Provider matches per segment call are bounded, like embedded references. */
export const MAX_SEGMENT_MATCHES = 16;
/** Source images are fitted inside this box before upload to bound cost. */
export const SEGMENT_SEND_MAX_SIDE = 2048;
/** Match previews are fitted inside this box to bound data-URL size. */
export const SEGMENT_PREVIEW_MAX_SIDE = 512;

function toBox(bounds: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): SegmentBox | null {
  const x1 = Math.max(0, Math.floor(bounds.left));
  const y1 = Math.max(0, Math.floor(bounds.top));
  const x2 = Math.max(0, Math.ceil(bounds.right));
  const y2 = Math.max(0, Math.ceil(bounds.bottom));
  if (
    !Number.isSafeInteger(x1) ||
    !Number.isSafeInteger(y1) ||
    !Number.isSafeInteger(x2) ||
    !Number.isSafeInteger(y2)
  ) {
    return null;
  }
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

/**
 * Parse one SAM output_text lane into matches using the official grammar.
 * Malformed matches are skipped (counted in `skipped`); an empty lane is
 * zero matches, which is valid. Throws only when the lane itself cannot be
 * parsed at all.
 */
export function parseSegmentLane(
  lane: string,
  maxMatches: number = MAX_SEGMENT_MATCHES,
): { matches: ParsedSegmentMatch[]; skipped: number; diagnostics: string[] } {
  const parser = formats.segmentation.image().createParser();
  parser.push(lane);
  const { result } = parser.finish({ status: 'completed' });
  const diagnostics = result.diagnostics.map(
    (diagnostic) => `${diagnostic.code} on line ${diagnostic.line}: ${diagnostic.message}`,
  );
  const matches: ParsedSegmentMatch[] = [];
  let skipped = 0;
  const masks = recordsOfKind(result.records, 'mask') as readonly SegmentationMaskRecord[];
  for (const record of masks) {
    if (matches.length >= maxMatches) break;
    const box = toBox(record.bounds);
    if (box === null) {
      skipped += 1;
      continue;
    }
    let raster: Uint8Array;
    try {
      raster = decodeMaskToRaster(record.mask);
    } catch {
      skipped += 1;
      continue;
    }
    if (raster.length !== record.mask.width * record.mask.height) {
      skipped += 1;
      continue;
    }
    const match: ParsedSegmentMatch = {
      objectId: record.objectId,
      box,
      maskWidth: record.mask.width,
      maskHeight: record.mask.height,
      raster,
    };
    if (record.confidence !== undefined) match.confidence = record.confidence;
    matches.push(match);
  }
  return { matches, skipped, diagnostics };
}

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA row-major bytes, width * height * 4. */
  data: Buffer;
}

/** Pixel budget shared with the embed path: masks never exceed the source. */
const MAX_SEGMENT_PIXELS = 16_777_216;

async function decodePng(bytes: Buffer): Promise<RgbaImage> {
  let parsed: { width: number; height: number; data: Buffer };
  try {
    parsed = PNG.sync.read(bytes);
  } catch {
    throw new ProviderError('provider_invalid_output', 'Source image is not a decodable PNG.');
  }
  return { width: parsed.width, height: parsed.height, data: Buffer.from(parsed.data) };
}

async function decodeJpeg(bytes: Buffer): Promise<RgbaImage> {
  const jpeg = await import('jpeg-js');
  const decode = (jpeg.default ?? jpeg) as {
    decode: (
      data: Buffer,
      options?: Record<string, unknown>,
    ) => { width: number; height: number; data: Uint8Array };
  };
  let parsed: { width: number; height: number; data: Uint8Array };
  try {
    parsed = decode.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
  } catch {
    throw new ProviderError('provider_invalid_output', 'Source image is not a decodable JPEG.');
  }
  return { width: parsed.width, height: parsed.height, data: Buffer.from(parsed.data) };
}

let webpModule: Promise<{
  decode: (
    buffer: ArrayBuffer,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}> | null = null;

async function webpCodec(): Promise<{
  decode: (
    buffer: ArrayBuffer,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}> {
  if (webpModule === null) {
    webpModule = (async () => {
      const { createRequire } = await import('node:module');
      const { readFileSync } = await import('node:fs');
      const { dirname, join } = await import('node:path');
      const require = createRequire(import.meta.url);
      const pkgDir = dirname(require.resolve('@jsquash/webp/package.json'));
      const wasmBytes = readFileSync(join(pkgDir, 'codec/dec/webp_dec.wasm'));
      // The stock ESM build fetches its WASM over the network; hand the
      // emscripten factory the packaged bytes instead. (The server lib set
      // has no WebAssembly types, so the override crosses as untyped.)
      const codec = (await import('@jsquash/webp/decode.js')) as unknown as {
        init: (overrides: unknown) => Promise<unknown>;
        default: (buffer: ArrayBuffer) => Promise<{
          width: number;
          height: number;
          data: Uint8ClampedArray;
        }>;
      };
      const wasmBinary = wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.length,
      );
      await codec.init({ wasmBinary });
      return { decode: codec.default };
    })();
  }
  return webpModule;
}

/** Decode a stored version to RGBA pixels. Supports every stored MIME. */
export async function decodeImage(bytes: Buffer, mime: string): Promise<RgbaImage> {
  let image: RgbaImage;
  if (mime === 'image/png') {
    image = await decodePng(bytes);
  } else if (mime === 'image/jpeg') {
    image = await decodeJpeg(bytes);
  } else if (mime === 'image/webp') {
    try {
      const { decode } = await webpCodec();
      const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
      const parsed = await decode(view as ArrayBuffer);
      image = { width: parsed.width, height: parsed.height, data: Buffer.from(parsed.data) };
    } catch {
      throw new ProviderError('provider_invalid_output', 'Source image is not a decodable WebP.');
    }
  } else {
    throw new ProviderError(
      'invalid_request',
      `Segmentation needs PNG, JPEG or WebP, not ${mime}.`,
    );
  }
  if (image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
    throw new ProviderError('provider_invalid_output', 'Decoded image has an inconsistent shape.');
  }
  if (image.width * image.height > MAX_SEGMENT_PIXELS) {
    throw new ProviderError(
      'invalid_request',
      'Source image exceeds the 16 megapixel segmentation budget.',
    );
  }
  return image;
}

/**
 * Map a box from fitted-image coordinates back to original pixels. The mask
 * raster is resolution-independent (it covers its box), so only the box
 * moves. Boxes always clip to the image; they never escape it.
 */
export function mapBoxToSource(
  box: SegmentBox,
  sentWidth: number,
  sentHeight: number,
  srcWidth: number,
  srcHeight: number,
): SegmentBox {
  const x1 = Math.max(0, Math.floor((box.x1 * srcWidth) / Math.max(1, sentWidth)));
  const y1 = Math.max(0, Math.floor((box.y1 * srcHeight) / Math.max(1, sentHeight)));
  const x2 = Math.min(srcWidth, Math.ceil((box.x2 * srcWidth) / Math.max(1, sentWidth)));
  const y2 = Math.min(srcHeight, Math.ceil((box.y2 * srcHeight) / Math.max(1, sentHeight)));
  return { x1, y1, x2: Math.max(x1 + 1, x2), y2: Math.max(y1 + 1, y2) };
}

/** Nearest-neighbour fit inside maxSide; scale 1 when already small. */
export function fitScale(width: number, height: number, maxSide: number): number {
  const side = Math.max(width, height);
  if (side <= maxSide) return 1;
  return maxSide / side;
}

export function downscaleRgba(src: RgbaImage, scale: number): RgbaImage {
  if (scale >= 1) return src;
  const width = Math.max(1, Math.floor(src.width * scale));
  const height = Math.max(1, Math.floor(src.height * scale));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      src.data.copy(
        data,
        (y * width + x) * 4,
        (sy * src.width + sx) * 4,
        (sy * src.width + sx) * 4 + 4,
      );
    }
  }
  return { width, height, data };
}

/** Clip a box to image bounds; null when nothing remains. */
export function clipBoxToImage(box: SegmentBox, width: number, height: number): SegmentBox | null {
  const x1 = Math.max(0, Math.min(width, box.x1));
  const y1 = Math.max(0, Math.min(height, box.y1));
  const x2 = Math.max(0, Math.min(width, box.x2));
  const y2 = Math.max(0, Math.min(height, box.y2));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

/** Mask cell (0/1) for a source pixel inside the (clipped) box. */
function maskAt(match: ParsedSegmentMatch, box: SegmentBox, px: number, py: number): boolean {
  const bw = box.x2 - box.x1;
  const bh = box.y2 - box.y1;
  const mx = Math.min(match.maskWidth - 1, Math.floor(((px - box.x1) * match.maskWidth) / bw));
  const my = Math.min(match.maskHeight - 1, Math.floor(((py - box.y1) * match.maskHeight) / bh));
  return match.raster[my * match.maskWidth + mx] === 1;
}

/**
 * Cut the match out of the source as a trimmed transparent PNG: pixels the
 * mask covers keep their RGB and their own source alpha, everything else
 * is dropped with the crop. Existing transparency survives compositing:
 * translucent source edges stay translucent instead of being resurrected
 * opaque. Trimming keeps cutouts small and directly usable as stickers.
 */
export interface BoundedCutout {
  bytes: Buffer;
  width: number;
  height: number;
  /** The clipped match box in original source pixels (provenance). */
  box: SegmentBox;
  /** Downscaled source the cutout was rendered from (identity when unscaled). */
  fitted: RgbaImage;
  scaled: boolean;
}

/**
 * Render the cutout, halving once and twice when the PNG would exceed the
 * version byte cap. Trimmed cutouts are small; the fallback only triggers
 * for near-full-frame photographic boxes.
 */
export function renderCutoutBounded(
  src: RgbaImage,
  match: ParsedSegmentMatch,
  maxBytes: number,
): BoundedCutout {
  const original = clipBoxToImage(match.box, src.width, src.height);
  if (original === null) {
    throw new ProviderError('provider_invalid_output', 'SAM match box lies outside the image.');
  }
  let fitted = src;
  let scaled = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // The mask raster covers its box at any resolution, so only the box is
    // remapped when the source is halved; provenance keeps original pixels.
    const box = mapBoxToSource(original, src.width, src.height, fitted.width, fitted.height);
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = maskAt(match, box, box.x1 + x, box.y1 + y);
        const from = ((box.y1 + y) * fitted.width + (box.x1 + x)) * 4;
        const to = (y * width + x) * 4;
        data[to] = fitted.data[from] ?? 0;
        data[to + 1] = fitted.data[from + 1] ?? 0;
        data[to + 2] = fitted.data[from + 2] ?? 0;
        data[to + 3] = inside ? (fitted.data[from + 3] ?? 0) : 0;
      }
    }
    const bytes = encodePng(width, height, data);
    if (bytes.length <= maxBytes || attempt === 2) {
      if (bytes.length > maxBytes) {
        throw new ProviderError(
          'invalid_request',
          'Cutout exceeds the version byte cap even at quarter size.',
        );
      }
      return { bytes, width, height, box: original, fitted, scaled };
    }
    fitted = downscaleRgba(fitted, 0.5);
    scaled = true;
  }
  throw new ProviderError('invalid_request', 'Cutout exceeds the version byte cap.');
}

export function renderCutout(src: RgbaImage, match: ParsedSegmentMatch): Buffer {
  const box = clipBoxToImage(match.box, src.width, src.height);
  if (box === null) {
    throw new ProviderError('provider_invalid_output', 'SAM match box lies outside the image.');
  }
  const width = box.x2 - box.x1;
  const height = box.y2 - box.y1;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = maskAt(match, box, box.x1 + x, box.y1 + y);
      const from = ((box.y1 + y) * src.width + (box.x1 + x)) * 4;
      const to = (y * width + x) * 4;
      data[to] = src.data[from] ?? 0;
      data[to + 1] = src.data[from + 1] ?? 0;
      data[to + 2] = src.data[from + 2] ?? 0;
      data[to + 3] = inside ? (src.data[from + 3] ?? 0) : 0;
    }
  }
  return encodePng(width, height, data);
}

/**
 * Inspectable match preview: the downscaled source with the match region at
 * full brightness, everything else dimmed, and the box outlined. Returned as
 * a PNG data URL bounded for inline display.
 */
export function renderMatchPreview(
  src: RgbaImage,
  match: ParsedSegmentMatch,
  maxSide: number = SEGMENT_PREVIEW_MAX_SIDE,
): string {
  const scale = fitScale(src.width, src.height, maxSide);
  const small = downscaleRgba(src, scale);
  const box = clipBoxToImage(
    {
      x1: Math.floor(match.box.x1 * scale),
      y1: Math.floor(match.box.y1 * scale),
      x2: Math.ceil(match.box.x2 * scale),
      y2: Math.ceil(match.box.y2 * scale),
    },
    small.width,
    small.height,
  );
  const data = Buffer.from(small.data);
  const at = (x: number, y: number): number => (y * small.width + x) * 4;
  const insideMask = (x: number, y: number): boolean => {
    if (box === null) return false;
    const sx = Math.min(src.width - 1, Math.floor(x / scale));
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    const clipped = clipBoxToImage(match.box, src.width, src.height);
    if (clipped === null) return false;
    if (sx < clipped.x1 || sx >= clipped.x2 || sy < clipped.y1 || sy >= clipped.y2) return false;
    return maskAt(match, clipped, sx, sy);
  };
  for (let y = 0; y < small.height; y += 1) {
    for (let x = 0; x < small.width; x += 1) {
      const offset = at(x, y);
      if (!insideMask(x, y)) {
        data[offset] = Math.floor((data[offset] ?? 0) * 0.45);
        data[offset + 1] = Math.floor((data[offset + 1] ?? 0) * 0.45);
        data[offset + 2] = Math.floor((data[offset + 2] ?? 0) * 0.45);
      }
    }
  }
  if (box !== null) {
    const paint = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= small.width || y >= small.height) return;
      const offset = at(x, y);
      data[offset] = 255;
      data[offset + 1] = 64;
      data[offset + 2] = 64;
      data[offset + 3] = 255;
    };
    for (let x = box.x1; x < box.x2; x += 1) {
      paint(x, box.y1);
      paint(x, box.y1 + 1);
      paint(x, box.y2 - 1);
      paint(x, box.y2 - 2);
    }
    for (let y = box.y1; y < box.y2; y += 1) {
      paint(box.x1, y);
      paint(box.x1 + 1, y);
      paint(box.x2 - 1, y);
      paint(box.x2 - 2, y);
    }
  }
  return `data:image/png;base64,${encodePng(small.width, small.height, data).toString('base64')}`;
}

function observedModelOf(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return observedModelOfRecord(parsed);
}

/** Model id from an already-parsed response object (streaming terminal). */
function observedModelOfRecord(parsed: unknown): string | null {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const model = (parsed as Record<string, unknown>).model;
    if (typeof model === 'string' && model.trim().length > 0) {
      return model.trim().slice(0, 120);
    }
  }
  return null;
}

function encodePng(width: number, height: number, data: Buffer): Buffer {
  const png = new PNG({ width, height });
  png.data = data;
  return PNG.sync.write(png);
}

function imageDataUrl(image: RgbaImage): string {
  return `data:image/png;base64,${encodePng(image.width, image.height, image.data).toString('base64')}`;
}

export interface SegmentOperationOptions {
  /** Image model is never valid here; defaults to the documented SAM model. */
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface SegmentCallResult {
  /** The exact geometry lane SAM streamed (empty when zero matches). */
  lane: string;
  matches: ParsedSegmentMatch[];
  skipped: number;
  diagnostics: string[];
  /** Model id explicitly requested. */
  model: string;
  /** Model id the provider reported, when it reported one. */
  observedModel: string | null;
  latencyMs: number;
  /** Provider fetch dispatches for the SAM request (adapter boundary). */
  attempts: number;
  /** SSE events parsed from the stream (terminal included). */
  streamEvents: number;
  /** `response.output_text.delta` events folded into the lane. */
  deltaEvents: number;
  /** Unknown SSE event types ignored for forward compatibility. */
  ignoredEvents: number;
  /** Exact raw stream bytes received (sha256 input). */
  streamBytes: number;
  /** Hex sha256 over the exact raw stream bytes (bounded evidence). */
  responseSha256: string;
}

/**
 * SAM object extraction over the Responses streaming contract. The
 * request sets `stream: true` and geometry is collected from
 * `response.output_text.delta` events through the terminal
 * `response.completed` event. Boxes come back in the
 * coordinates of the fitted image actually sent, so matches are mapped back
 * to the original pixels before compositing.
 */
export class MediaSegmentation {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(
    private readonly adapter: MediaAdapter,
    options: SegmentOperationOptions = {},
  ) {
    // Deliberately NOT adapter.targetedModel: that carries the image
    // generation model, which the segmentation endpoint does not accept.
    this.model = options.model?.trim() ? options.model.trim() : DEFAULT_SAM_MODEL;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxOutputTokens = options.maxOutputTokens ?? 4096;
  }

  get targetedModel(): string {
    return this.model;
  }

  async segment(
    image: RgbaImage,
    concept: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SegmentCallResult> {
    const trimmed = concept.trim();
    if (trimmed.length === 0) {
      throw new ProviderError('invalid_request', 'Segmentation needs a non-empty concept.');
    }
    const sent = downscaleRgba(image, fitScale(image.width, image.height, SEGMENT_SEND_MAX_SIDE));
    const started = Date.now();
    // Streaming contract: the adapter injects `stream: true` and returns
    // parsed SSE events; geometry is assembled from output_text deltas.
    const result = await this.adapter.callStream(
      '/v1/responses',
      {
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: trimmed },
              { type: 'input_image', image_url: imageDataUrl(sent) },
            ],
          },
        ],
        max_output_tokens: this.maxOutputTokens,
      },
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: this.timeoutMs,
      },
    );
    // Post-dispatch failures (assembly, refusal, geometry validation)
    // keep exact dispatch accounting plus the bounded stream evidence
    // already available, so error envelopes stay accountable. The thrown
    // errors never retry: validation failures are deterministic.
    // Partial assembly counts ride on the thrown error's details when
    // assembly itself failed; otherwise they come from the assembled
    // stream recorded below.
    let assembledCounts: { deltaEvents?: unknown; ignoredEvents?: unknown } = {};
    const withEvidence = (error: unknown): never => {
      const details =
        ProviderError.isProviderError(error) &&
        error.details !== null &&
        typeof error.details === 'object' &&
        !Array.isArray(error.details)
          ? (error.details as Record<string, unknown>)
          : {};
      const asCount = (value: unknown, fallback: unknown): number | null =>
        typeof value === 'number' ? value : typeof fallback === 'number' ? fallback : null;
      if (ProviderError.isProviderError(error)) {
        throw new ProviderError(error.code, error.message, {
          ...details,
          attempts: result.attempts,
          stream_events: result.events.length,
          stream_bytes: result.streamBytes,
          response_sha256: result.responseSha256,
          delta_events: asCount(details.deltaEvents, assembledCounts.deltaEvents),
          ignored_events: asCount(details.ignoredEvents, assembledCounts.ignoredEvents),
        });
      }
      throw error;
    };
    try {
      const assembled = assembleResponsesStream(result.events, 'segment');
      assembledCounts = {
        deltaEvents: assembled.deltaEvents,
        ignoredEvents: assembled.ignoredEvents,
      };
      const streamEvidence = {
        streamEvents: assembled.events,
        deltaEvents: assembled.deltaEvents,
        ignoredEvents: assembled.ignoredEvents,
        streamBytes: result.streamBytes,
        responseSha256: result.responseSha256,
      };
      // Refusals fail here, mirroring the buffered contract. The lane
      // emptiness rules live in the assembler: only an explicitly empty
      // terminal text output is a zero match.
      if (assembled.refusals.length > 0) {
        throw new ProviderError(
          'provider_invalid_output',
          `Segmentation refused: ${(assembled.refusals[0]?.text ?? 'refused').slice(0, 200)}`,
        );
      }
      const lane = assembled.lane;
      if (lane.trim().length === 0) {
        // The assembler already required an explicit empty text output
        // for this path, so an empty lane here is a legitimate
        // zero-match result. Anything else must carry usable geometry.
        return {
          lane,
          matches: [],
          skipped: 0,
          diagnostics: [],
          model: this.model,
          observedModel: observedModelOfRecord(assembled.response),
          latencyMs: Date.now() - started,
          attempts: result.attempts,
          ...streamEvidence,
        };
      }
      const parsed = parseSegmentLane(lane);
      if (parsed.matches.length === 0) {
        const detail =
          parsed.diagnostics.length > 0
            ? parsed.diagnostics[0]
            : `${String(parsed.skipped)} unreadable match(es)`;
        throw new ProviderError(
          'provider_invalid_output',
          `Segmentation returned no usable matches: ${detail}`.slice(0, 300),
        );
      }
      const matches = parsed.matches.map((match) => ({
        ...match,
        box: mapBoxToSource(match.box, sent.width, sent.height, image.width, image.height),
      }));
      return {
        lane,
        matches,
        skipped: parsed.skipped,
        diagnostics: parsed.diagnostics,
        model: this.model,
        observedModel: observedModelOfRecord(assembled.response),
        latencyMs: Date.now() - started,
        attempts: result.attempts,
        ...streamEvidence,
      };
    } catch (error) {
      return withEvidence(error);
    }
  }
}

export interface SuggestionDraft {
  type: 'preference' | 'constraint' | 'technical_decision';
  content: string;
  confidence: number;
}

export interface UnderstandOperationOptions {
  model?: string;
  timeoutMs?: number;
}

const SUGGESTION_TYPES = ['preference', 'constraint', 'technical_decision'] as const;

/**
 * Reference-image understanding: asks the vision model for decision
 * suggestions and returns them as data. Nothing is written to memory here;
 * the caller proposes reviewed suggestions through the memory engine.
 */
export class MediaUnderstand {
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly adapter: MediaAdapter,
    options: UnderstandOperationOptions = {},
  ) {
    this.model = options.model?.trim() ? options.model.trim() : DEFAULT_VISION_MODEL;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  get targetedModel(): string {
    return this.model;
  }

  async suggest(
    image: { bytes: Buffer; mime: string },
    options: { guidance?: string; count?: number; signal?: AbortSignal } = {},
  ): Promise<{
    suggestions: SuggestionDraft[];
    model: string;
    observedModel: string | null;
    attempts: number;
  }> {
    const count = Math.max(1, Math.min(5, options.count ?? 3));
    const guidance =
      options.guidance !== undefined && options.guidance.trim().length > 0
        ? ` Focus on: ${options.guidance.trim().slice(0, 500)}`
        : '';
    const prompt =
      `Look at this reference image and suggest up to ${count} project decisions it implies` +
      ` (visual style, palette, layout, or requirements).${guidance}` +
      ' Respond with JSON only, no prose or fences:' +
      ' {"suggestions":[{"type":"preference|constraint|technical_decision","content":"one sentence","confidence":0.0-1.0}]}';
    const dataUrl = `data:${image.mime};base64,${image.bytes.toString('base64')}`;
    const result = await this.adapter.call(
      '/v1/responses',
      {
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: dataUrl },
            ],
          },
        ],
        max_output_tokens: 1024,
      },
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: this.timeoutMs,
      },
    );
    return {
      suggestions: parseSuggestions(result.body, count),
      model: this.model,
      observedModel: observedModelOf(result.body),
      attempts: result.attempts,
    };
  }
}

export interface VisualReviewDecision {
  id: string;
  text: string;
}

export interface VisualReviewFindingDraft {
  decision_id: string;
  verdict: 'consistent' | 'possible_conflict' | 'unclear';
  evidence: string;
  uncertainty: string;
  confidence: number;
}

export interface VisualReviewOutcome {
  findings: VisualReviewFindingDraft[];
  /** Selected decisions the output left unusable, with the reason. */
  unverified: { decision_id: string; reason: string }[];
  /** Output entries for decisions that were never selected. */
  ignored: number;
  model: string;
  observedModel: string | null;
  attempts: number;
}

const REVIEW_VERDICTS = ['consistent', 'possible_conflict', 'unclear'] as const;

/**
 * Screenshot review against decisions the user selected. Inference only: the
 * result is advisory data, and this module has no access to Forge state, so it
 * cannot approve, restage, or rewrite anything.
 *
 * Validation is deliberately unforgiving. A finding needs both evidence in the
 * frame and a statement of what a still image cannot prove; anything else is
 * reported as unverified instead of being polished into a finding. Entries that
 * name a decision the user did not select are counted and dropped, so a model
 * cannot introduce its own scope.
 */
export class MediaVisualReview {
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly adapter: MediaAdapter,
    options: UnderstandOperationOptions = {},
  ) {
    this.model = options.model?.trim() ? options.model.trim() : DEFAULT_VISION_MODEL;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  get targetedModel(): string {
    return this.model;
  }

  async review(
    image: { bytes: Buffer; mime: string },
    decisions: VisualReviewDecision[],
    options: { signal?: AbortSignal } = {},
  ): Promise<VisualReviewOutcome> {
    if (decisions.length === 0) {
      throw new ProviderError('invalid_request', 'Visual review needs at least one decision.');
    }
    const catalogue = decisions
      .map(
        (entry) => `{"id":"${entry.id}","decision":${JSON.stringify(entry.text.slice(0, 1_000))}}`,
      )
      .join('\n');
    const prompt =
      'Review this screenshot of a running web application against the project decisions below.\n' +
      'For each decision id, report how the frame relates to that decision: "consistent" if the frame appears to follow it, "possible_conflict" if the frame appears to contradict it, or "unclear" if the frame does not show enough to tell.\n' +
      'For every entry name the specific part of the screenshot you based that on, and state what a single still image cannot establish about that decision.\n' +
      'Do not invent decisions, do not propose changes, and use only the ids given below.\n' +
      'Respond with JSON only, no prose or fences: {"findings":[{"decision_id":"<id>","verdict":"consistent|possible_conflict|unclear","evidence":"what in the frame","uncertainty":"what a still image cannot tell","confidence":0.0-1.0}]}\n' +
      `Decisions:\n${catalogue}`;
    const dataUrl = `data:${image.mime};base64,${image.bytes.toString('base64')}`;
    const result = await this.adapter.call(
      '/v1/responses',
      {
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: dataUrl },
            ],
          },
        ],
        max_output_tokens: 1_536,
      },
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: this.timeoutMs,
      },
    );
    return {
      ...parseVisualReview(result.body, new Set(decisions.map((entry) => entry.id))),
      model: this.model,
      observedModel: observedModelOf(result.body),
      attempts: result.attempts,
    };
  }
}

/** Bounded, credential-free JSON validation of a visual review response. */
export function parseVisualReview(
  body: string,
  allowedIds: Set<string>,
): Pick<VisualReviewOutcome, 'findings' | 'unverified' | 'ignored'> {
  const envelope = parseResponsesEnvelope(body, 'visual_review');
  if (!envelope.ok || envelope.output === null) {
    throw new ProviderError(
      'provider_invalid_output',
      `Visual review failed: ${envelope.summary} ${envelope.error ?? ''}`.slice(0, 300),
    );
  }
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    throw new ProviderError(
      'provider_invalid_output',
      `Visual review refused: ${(refusals[0]?.text ?? 'refused').slice(0, 200)}`,
    );
  }
  const raw = texts
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (raw.length === 0) {
    throw new ProviderError('provider_invalid_output', 'Visual review returned no text.');
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new ProviderError(
      'provider_invalid_output',
      `Visual review did not return review JSON: ${raw.slice(0, 200)}`,
    );
  }
  const list =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).findings
      : null;
  if (!Array.isArray(list)) {
    throw new ProviderError('provider_invalid_output', 'Visual review JSON has no findings[].');
  }

  const findings: VisualReviewFindingDraft[] = [];
  const unverified: { decision_id: string; reason: string }[] = [];
  const reported = new Set<string>();
  let ignored = 0;
  for (const entry of list.slice(0, 64)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      ignored += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.decision_id === 'string' ? record.decision_id : '';
    // A decision the user never selected is out of scope, and a duplicate does
    // not get a second chance to assert something about the same decision.
    if (!allowedIds.has(id) || reported.has(id)) {
      ignored += 1;
      continue;
    }
    reported.add(id);
    if (
      typeof record.verdict !== 'string' ||
      !(REVIEW_VERDICTS as readonly string[]).includes(record.verdict)
    ) {
      unverified.push({
        decision_id: id,
        reason: 'the answer did not name one of the three verdicts',
      });
      continue;
    }
    const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
    if (evidence.length === 0) {
      unverified.push({
        decision_id: id,
        reason: 'no evidence in the screenshot was named, so there is nothing to inspect',
      });
      continue;
    }
    const uncertainty = typeof record.uncertainty === 'string' ? record.uncertainty.trim() : '';
    if (uncertainty.length === 0) {
      unverified.push({
        decision_id: id,
        reason: 'no uncertainty was stated for a single still frame',
      });
      continue;
    }
    const confidence =
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0.5;
    findings.push({
      decision_id: id,
      verdict: record.verdict as VisualReviewFindingDraft['verdict'],
      evidence: evidence.slice(0, 600),
      uncertainty: uncertainty.slice(0, 400),
      confidence,
    });
  }
  for (const id of allowedIds) {
    if (!reported.has(id)) {
      unverified.push({
        decision_id: id,
        reason: 'the review did not report on this decision at all',
      });
    }
  }
  return { findings, unverified, ignored };
}

function parseSuggestions(body: string, count: number): SuggestionDraft[] {
  const envelope = parseResponsesEnvelope(body, 'understand');
  if (!envelope.ok || envelope.output === null) {
    throw new ProviderError(
      'provider_invalid_output',
      `Understanding failed: ${envelope.summary} ${envelope.error ?? ''}`.slice(0, 300),
    );
  }
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    throw new ProviderError(
      'provider_invalid_output',
      `Understanding refused: ${(refusals[0]?.text ?? 'refused').slice(0, 200)}`,
    );
  }
  const raw = texts
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (raw.length === 0) {
    throw new ProviderError('provider_invalid_output', 'Understanding returned no text.');
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new ProviderError(
      'provider_invalid_output',
      `Understanding did not return suggestion JSON: ${raw.slice(0, 200)}`,
    );
  }
  const list =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).suggestions
      : null;
  if (!Array.isArray(list)) {
    throw new ProviderError('provider_invalid_output', 'Understanding JSON has no suggestions[].');
  }
  const suggestions: SuggestionDraft[] = [];
  for (const entry of list.slice(0, count)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.type !== 'string' ||
      !(SUGGESTION_TYPES as readonly string[]).includes(record.type)
    ) {
      continue;
    }
    if (typeof record.content !== 'string' || record.content.trim().length === 0) continue;
    const confidence =
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0.5;
    suggestions.push({
      type: record.type as SuggestionDraft['type'],
      content: record.content.trim().slice(0, 1_000),
      confidence,
    });
  }
  return suggestions;
}
