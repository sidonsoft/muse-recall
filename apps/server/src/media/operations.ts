import { ProviderError } from '@mml/muse-provider';
import {
  MEDIA_IMAGE_SIZES,
  type MediaImageSize,
  type MediaUsage,
  redactSecrets,
} from '@mml/shared';
import type { MediaAdapter, MediaFetch } from './adapter.js';
import { inspectMediaBytes, MAX_MEDIA_BYTES, type MediaMime } from './assets.js';
import { MEDIA_PROBE_MODELS } from './capabilities.js';

/**
 * Batch B1 — documented image generation and editing calls.
 *
 * Both calls go through {@link MediaAdapter}, so the provider origin pin,
 * redirect refusal, credential handling, bounded retries, cancellation and
 * response-size cap are inherited rather than re-implemented here.
 *
 * Output handling is intentionally paranoid:
 * - `b64_json` is decoded strictly (canonical base64 only) and capped before
 *   the bytes are handed to the asset store.
 * - Some responses carry a `url` instead. The adapter refuses arbitrary URL
 *   fetches, so a separate constrained downloader is used: HTTPS only, no
 *   credentials, no redirects, exact-host allowlist (default `api.meta.ai`),
 *   bounded bytes, and an `image/*` content type. The downloaded bytes are
 *   then validated exactly like an upload.
 * - Regardless of source, magic bytes must identify PNG/JPEG/WebP and the
 *   intrinsic dimensions must parse; SVG/HTML and malformed media are refused.
 */

/** Documented image sizes accepted by the provider contract. */
export const MEDIA_IMAGE_SIZE_VALUES = MEDIA_IMAGE_SIZES;

/** Default exact hosts allowed for provider-returned image downloads. */
export const MEDIA_DOWNLOAD_HOSTS = ['api.meta.ai'] as const;

const MAX_PROMPT_CHARS = 2_000;
const MAX_BASE64_CHARS = Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 16;

export interface MediaImageOperationOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Override the allowlist for tests or an explicitly configured asset host. */
  downloadHosts?: readonly string[];
}

export interface MediaGenerateInput {
  prompt: string;
  size?: MediaImageSize;
}

export interface MediaEditInput {
  prompt: string;
  size?: MediaImageSize;
  image: {
    bytes: Buffer | Uint8Array;
    mime: MediaMime;
  };
}

export interface MediaImageOutput {
  mime: MediaMime;
  bytes: Buffer;
  width: number;
  height: number;
  model: string;
  latency_ms: number;
  usage: MediaUsage | null;
  /** Where the payload came from; useful for diagnostics, never for trust. */
  payload_source: 'b64_json' | 'url';
}

export interface MediaOperationsOptions {
  fetchImpl?: MediaFetch;
  /** Model id sent to the images endpoints. */
  model?: string;
  downloadHosts?: readonly string[];
  downloadTimeoutMs?: number;
  generationTimeoutMs?: number;
}

function bounded(message: string, limit = 300): string {
  const redacted = redactSecrets(message);
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit - 1)}…`;
}

function assertPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    throw new ProviderError('invalid_request', 'An image prompt is required.');
  }
  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw new ProviderError(
      'invalid_request',
      `Image prompt is ${String(trimmed.length)} chars; the ceiling is ${String(MAX_PROMPT_CHARS)}.`,
    );
  }
  return trimmed;
}

function assertSize(size: MediaImageSize | undefined): MediaImageSize | undefined {
  if (size === undefined) return undefined;
  if (!(MEDIA_IMAGE_SIZE_VALUES as readonly string[]).includes(size)) {
    throw new ProviderError(
      'invalid_request',
      `Unsupported image size ${JSON.stringify(size)}; use ${MEDIA_IMAGE_SIZE_VALUES.join(', ')}.`,
    );
  }
  return size;
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function decodeCanonicalBase64(value: string): Buffer {
  if (value.length === 0) {
    throw new ProviderError('provider_invalid_output', 'Image response carried empty image data.');
  }
  if (value.length > MAX_BASE64_CHARS) {
    throw new ProviderError(
      'provider_invalid_output',
      `Image response payload is ${String(value.length)} base64 chars, above the bounded decode limit.`,
    );
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new ProviderError(
      'provider_invalid_output',
      'Image response b64_json is not canonical base64; refusing to decode ambiguous payload data.',
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0) {
    throw new ProviderError('provider_invalid_output', 'Image response decoded to zero bytes.');
  }
  return bytes;
}

interface ParsedImagesResponse {
  b64Json: string | null;
  url: string | null;
  usage: MediaUsage | null;
}

function parseUsage(value: unknown): MediaUsage | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const usage: MediaUsage = {};
  if (Number.isSafeInteger(candidate.input_tokens) && (candidate.input_tokens as number) >= 0) {
    usage.input_tokens = candidate.input_tokens as number;
  }
  if (Number.isSafeInteger(candidate.output_tokens) && (candidate.output_tokens as number) >= 0) {
    usage.output_tokens = candidate.output_tokens as number;
  }
  return Object.keys(usage).length === 0 ? null : usage;
}

function parseImagesResponse(body: string): ParsedImagesResponse {
  const json = parseJsonObject(body);
  if (json === null) {
    throw new ProviderError('provider_invalid_output', 'Image response is not a JSON object.');
  }
  const data = json.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ProviderError(
      'provider_invalid_output',
      'Image response is missing a non-empty data[] array.',
    );
  }
  const first: unknown = data[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new ProviderError('provider_invalid_output', 'Image response data[0] is not an object.');
  }
  const record = first as Record<string, unknown>;
  const b64 = typeof record.b64_json === 'string' ? record.b64_json : null;
  const url = typeof record.url === 'string' ? record.url : null;
  if (b64 === null && url === null) {
    throw new ProviderError(
      'provider_invalid_output',
      'Image response data[0] carried neither b64_json nor url.',
    );
  }
  return { b64Json: b64, url, usage: parseUsage(json.usage) };
}

function isAllowedDownloadUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError(
      'provider_invalid_output',
      'Image response returned a URL that could not be parsed.',
    );
  }
  if (url.protocol !== 'https:') {
    throw new ProviderError(
      'provider_unavailable',
      `Refusing image download over ${url.protocol}; only HTTPS is allowed.`,
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new ProviderError(
      'provider_unavailable',
      'Refusing image download URL that embeds credentials.',
    );
  }
  if (url.port !== '' && url.port !== '443') {
    throw new ProviderError(
      'provider_unavailable',
      `Refusing image download on non-default port ${url.port}.`,
    );
  }
  if (!allowedHosts.includes(url.hostname)) {
    throw new ProviderError(
      'provider_unavailable',
      `Refusing image download from ${url.hostname}: not in the configured asset-host allowlist.`,
    );
  }
  return url;
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isSafeInteger(length) && length > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        'provider_invalid_output',
        `Downloaded image is ${String(length)} bytes, above the ${String(maxBytes)}-byte limit.`,
      );
    }
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new ProviderError(
        'provider_invalid_output',
        `Downloaded image is ${String(bytes.length)} bytes, above the ${String(maxBytes)}-byte limit.`,
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ProviderError(
          'provider_invalid_output',
          `Downloaded image exceeds the ${String(maxBytes)}-byte limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = Buffer.alloc(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export class MediaOperations {
  private readonly fetchImpl: MediaFetch;
  private readonly model: string;
  private readonly downloadHosts: readonly string[];
  private readonly downloadTimeoutMs: number;
  private readonly generationTimeoutMs: number;

  constructor(
    private readonly adapter: MediaAdapter,
    options: MediaOperationsOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model ?? adapter.targetedModel ?? MEDIA_PROBE_MODELS['image-generate'];
    this.downloadHosts = options.downloadHosts ?? MEDIA_DOWNLOAD_HOSTS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 30_000;
    this.generationTimeoutMs = options.generationTimeoutMs ?? 120_000;
  }

  async generate(
    input: MediaGenerateInput,
    options: MediaImageOperationOptions = {},
  ): Promise<MediaImageOutput> {
    const prompt = assertPrompt(input.prompt);
    const size = assertSize(input.size);
    const result = await this.adapter.call(
      '/v1/images/generations',
      {
        prompt,
        n: 1,
        ...(size !== undefined ? { size } : {}),
        response_format: 'b64_json',
      },
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
        timeoutMs: options.timeoutMs ?? this.generationTimeoutMs,
      },
    );
    return this.toOutput(result.body, result.model ?? this.model, result.latency_ms, options);
  }

  async edit(
    input: MediaEditInput,
    options: MediaImageOperationOptions = {},
  ): Promise<MediaImageOutput> {
    const prompt = assertPrompt(input.prompt);
    const size = assertSize(input.size);
    const bytes = Buffer.isBuffer(input.image.bytes)
      ? input.image.bytes
      : Buffer.from(input.image.bytes);
    if (bytes.length === 0) {
      throw new ProviderError('invalid_request', 'An edit requires a non-empty source image.');
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
      throw new ProviderError(
        'invalid_request',
        `Source image is ${String(bytes.length)} bytes, above the ${String(MAX_MEDIA_BYTES)}-byte limit.`,
      );
    }
    const extension =
      input.image.mime === 'image/png' ? 'png' : input.image.mime === 'image/jpeg' ? 'jpg' : 'webp';
    const form = new FormData();
    form.append('model', this.model);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('response_format', 'b64_json');
    if (size !== undefined) form.append('size', size);
    form.append(
      'image',
      new Blob([new Uint8Array(bytes)], { type: input.image.mime }),
      `source.${extension}`,
    );
    const result = await this.adapter.call(
      '/v1/images/edits',
      {},
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
        timeoutMs: options.timeoutMs ?? this.generationTimeoutMs,
        rawBody: form,
        // Content-Type is intentionally omitted so fetch writes the multipart boundary.
      },
    );
    return this.toOutput(result.body, result.model ?? this.model, result.latency_ms, options);
  }

  private async toOutput(
    body: string,
    model: string,
    latencyMs: number,
    options: MediaImageOperationOptions,
  ): Promise<MediaImageOutput> {
    const parsed = parseImagesResponse(body);
    let bytes: Buffer;
    let payloadSource: 'b64_json' | 'url';
    if (parsed.b64Json !== null) {
      bytes = decodeCanonicalBase64(parsed.b64Json);
      payloadSource = 'b64_json';
    } else if (parsed.url !== null) {
      bytes = await this.download(
        parsed.url,
        options.downloadHosts ?? this.downloadHosts,
        options.signal,
        options.timeoutMs,
      );
      payloadSource = 'url';
    } else {
      throw new ProviderError('provider_invalid_output', 'Image response carried no payload.');
    }
    const inspected = inspectMediaBytes(bytes, null);
    return {
      mime: inspected.mime,
      bytes,
      width: inspected.width,
      height: inspected.height,
      model,
      latency_ms: latencyMs,
      usage: parsed.usage,
      payload_source: payloadSource,
    };
  }

  private async download(
    rawUrl: string,
    allowedHosts: readonly string[],
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): Promise<Buffer> {
    const url = isAllowedDownloadUrl(rawUrl, allowedHosts);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(timeoutMs ?? this.downloadTimeoutMs, this.downloadTimeoutMs),
    );
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/png,image/jpeg,image/webp' },
        // No credentials: the download URL is provider content, not our API.
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderError(
          'provider_unavailable',
          `Image download was redirected (status ${String(response.status)}); redirects are refused.`,
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          'provider_unavailable',
          `Image download failed with status ${String(response.status)}.`,
        );
      }
      const contentType = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      if (contentType === undefined || !contentType.startsWith('image/')) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderError(
          'provider_invalid_output',
          `Image download returned content type ${JSON.stringify(contentType ?? '')}, not an image.`,
        );
      }
      return readBoundedBytes(response, MAX_MEDIA_BYTES);
    } catch (error) {
      if (ProviderError.isProviderError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (signal?.aborted === true || /abort/i.test(message)) {
        throw new ProviderError('provider_cancelled', 'Image download was cancelled.');
      }
      if (/timeout|timed out/i.test(message)) {
        throw new ProviderError(
          'provider_timeout',
          `Image download timed out: ${bounded(message)}`,
        );
      }
      throw new ProviderError('provider_unavailable', `Image download failed: ${bounded(message)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
