import { createHash } from 'node:crypto';
import { ProviderError } from '@mml/muse-provider';
import { type ProviderErrorCode, redactSecrets } from '@mml/shared';
import { type SseEvent, SseParser } from './sse.js';

/**
 * Batch A1 — bounded server-side media adapter for the Meta Model API.
 * Fixed after the d3f3b67 review: success payloads are preserved whole
 * (never silently truncated), redirects never leave the provider origin,
 * and only diagnostics are bounded/redacted.
 *
 * Security posture, mirroring `forge/runtime-check.ts`: generated content is
 * untrusted, so this adapter performs **no arbitrary-URL fetch**. Every
 * request targets the provider origin `https://api.meta.ai` and nothing else;
 * any other origin is rejected before work begins. Credentials travel in an
 * `Authorization` header, are never placed in a URL or log line, and every
 * diagnostic is bounded and passed through `redactSecrets`.
 */

export const MEDIA_PROVIDER_ORIGIN = 'https://api.meta.ai';

/** True only for https URLs whose origin is exactly the provider origin. */
export function isAllowedMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.origin === MEDIA_PROVIDER_ORIGIN;
}

const MAX_DETAIL_CHARS = 300;

/**
 * Maximum successful response body kept in memory (8 MiB). Payloads up to
 * this size are preserved whole and returned to the caller; anything larger
 * fails loudly with `provider_invalid_output` instead of being silently
 * truncated into corrupt data. Reading enforces the cap incrementally so an
 * unbounded stream cannot exhaust memory before the limit trips.
 */
export const MEDIA_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

function boundedRedacted(
  message: string,
  limit = MAX_DETAIL_CHARS,
  secrets: (string | null | undefined)[] = [],
): string {
  const redacted = redactSecrets(message, secrets.length > 0 ? { secrets } : {});
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
}

export interface MediaRequestOptions {
  /** Per-attempt wall-clock budget in milliseconds. */
  timeoutMs?: number;
  /** Extra attempts after the first failure (0 = no retry). */
  maxRetries?: number;
  /**
   * Idempotency / duplicate-submission key. Callers SHOULD supply one for
   * mutating media calls; the adapter echoes it as `Idempotency-Key` so a
   * client that retried after a network timeout does not pay twice. Mirrors
   * `IDEMPOTENCY_HEADER` ('idempotency-key') in `idempotency.ts`.
   */
  idempotencyKey?: string;
  /** Cooperative cancellation. The adapter stops and reports `cancelled`. */
  signal?: AbortSignal;
  /**
   * Raw request body for non-JSON endpoints (e.g. multipart uploads).
   * When set, `body` is sent as-is with `contentType` instead of JSON.
   */
  rawBody?: RequestInit['body'];
  contentType?: string;
  /**
   * The model this dispatch pays for, when the model is not a JSON field the
   * adapter can read. A multipart edit request carries `model` as a form field,
   * so the trace line would otherwise report `model=(none)` for a call that did
   * name its model — and a live run could not say what its paid edit cost.
   */
  traceModel?: string;
}

/**
 * Name the model a dispatch pays for, for the `[media-trace]` line.
 *
 * Preference order is deliberate: an explicit `traceModel` from the caller wins
 * (multipart calls know their model but cannot express it in a JSON payload),
 * then the JSON payload's own `model`, then `(none)` — which means the ledger
 * genuinely cannot attribute this dispatch, and must read as that.
 */
export function traceModelName(
  options: { traceModel?: string },
  payload: Record<string, unknown>,
): string {
  const explicit = typeof options.traceModel === 'string' ? options.traceModel.trim() : '';
  if (explicit.length > 0) return explicit;
  const fromPayload = typeof payload.model === 'string' ? payload.model.trim() : '';
  if (fromPayload.length > 0) return fromPayload;
  return '(none)';
}

export interface MediaCallResult {
  status: number;
  body: string;
  model: string | null;
  latency_ms: number;
  /**
   * Provider fetch dispatches performed for this call (1 with no retry).
   * Counted at the dispatch boundary so acceptance harnesses can enforce
   * exact call budgets instead of counting UI submissions.
   */
  attempts: number;
}

export type MediaFetch = typeof fetch;

export interface MediaStreamResult extends MediaCallResult {
  /** SSE events parsed from the stream, in arrival order. */
  events: SseEvent[];
  /** Exact raw stream bytes received (sha256 input). */
  streamBytes: number;
  /** Hex sha256 over the exact raw stream bytes (bounded evidence). */
  responseSha256: string;
}

export interface MediaAdapterOptions {
  apiKey: string | null | undefined;
  /** Model id targeted by probes/calls; sent as a body field only. */
  model?: string;
  fetchImpl?: MediaFetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Emit one bounded, secret-free diagnostic line per outbound attempt. */
  traceAttempts?: boolean;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryable(error: unknown, status: number | null): boolean {
  if (error !== null) return true; // network error / timeout: worth one more try
  return status !== null && RETRYABLE_STATUS.has(status);
}

/** Optional AbortSignal may be absent; treat only an explicit abort as cancelled. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function toProviderCode(status: number | null, message: string): ProviderErrorCode {
  if (/abort|aborted|cancel/i.test(message)) return 'provider_cancelled';
  if (/timed out|timeout/i.test(message)) return 'provider_timeout';
  if (
    status === 401 ||
    status === 403 ||
    /auth|credential|api key|unauthorized|forbidden/i.test(message)
  ) {
    return 'provider_auth_failed';
  }
  // 429 is the provider refusing on quota or rate limits, not the client writing a
  // bad request. It fell through to the 4xx bucket below, which told operators to
  // fix a request that was already correct and hid a quota wall behind a
  // client-shaped error. Under the beta's zero-retry rule nothing retries it, so it
  // has to be legible on its own.
  if (status === 429) return 'provider_auth_failed';
  if (status === 400 || status === 404 || status === 405 || status === 422)
    return 'invalid_request';
  if (status !== null && status >= 400 && status < 500) return 'invalid_request';
  return 'provider_unavailable';
}

/**
 * Read a response body whole, enforcing MEDIA_RESPONSE_MAX_BYTES
 * incrementally. Payloads within the cap are preserved exactly (success
 * data is never truncated); anything larger fails loudly instead of
 * becoming corrupt data. Only callers of this function see full bodies —
 * diagnostics elsewhere stay bounded and redacted.
 */
async function readBoundedText(response: Response): Promise<string> {
  // Prefer the declared length as a fast refusal, but never trust it: the
  // stream is still capped chunk by chunk below.
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isSafeInteger(length) && length > MEDIA_RESPONSE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        'provider_invalid_output',
        `Media response is ${length} bytes, above the ${MEDIA_RESPONSE_MAX_BYTES}-byte limit; refusing instead of truncating.`,
      );
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (text.length > MEDIA_RESPONSE_MAX_BYTES) {
      throw new ProviderError(
        'provider_invalid_output',
        `Media response is ${text.length} bytes, above the ${MEDIA_RESPONSE_MAX_BYTES}-byte limit; refusing instead of truncating.`,
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MEDIA_RESPONSE_MAX_BYTES) {
        throw new ProviderError(
          'provider_invalid_output',
          `Media response exceeds the ${MEDIA_RESPONSE_MAX_BYTES}-byte limit; refusing instead of truncating.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Read an SSE response incrementally, enforcing MEDIA_RESPONSE_MAX_BYTES
 * on the raw bytes (decoder runs in streaming mode so split multibyte
 * sequences survive chunk boundaries) while parsing events and hashing
 * the exact bytes received. A missing body fails: a streaming request
 * without a stream is a contract violation, not an empty result.
 */
async function readBoundedStream(response: Response): Promise<{
  events: SseEvent[];
  streamBytes: number;
  responseSha256: string;
}> {
  if (!response.body) {
    throw new ProviderError(
      'provider_invalid_output',
      'Media stream has no body; refusing to publish an empty result.',
    );
  }
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isSafeInteger(length) && length > MEDIA_RESPONSE_MAX_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new ProviderError(
        'provider_invalid_output',
        `Media stream is ${length} bytes, above the ${MEDIA_RESPONSE_MAX_BYTES}-byte limit; refusing instead of truncating.`,
      );
    }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const parser = new SseParser();
  const hash = createHash('sha256');
  const events: SseEvent[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MEDIA_RESPONSE_MAX_BYTES) {
        throw new ProviderError(
          'provider_invalid_output',
          `Media stream exceeds the ${MEDIA_RESPONSE_MAX_BYTES}-byte limit; refusing instead of truncating.`,
        );
      }
      hash.update(value);
      events.push(...parser.push(decoder.decode(value, { stream: true })));
    }
  } finally {
    reader.releaseLock();
  }
  events.push(...parser.push(decoder.decode()));
  return { events, streamBytes: total, responseSha256: hash.digest('hex') };
}

/**
 * Minimal structured transport for media endpoints.
 *
 * - URL origin is pinned to `https://api.meta.ai`; anything else throws
 *   `invalid_request` before any I/O.
 * - Redirects are never followed automatically (`redirect: 'manual'`): a 3xx
 *   with a `location` is surfaced as `provider_unavailable` naming the
 *   offending status, so a 307/308 can never smuggle a POST body (and the
 *   Authorization header) to another host. Signed asset downloads that need
 *   other origins use a separate constrained downloader (Batch B), never
 *   this inference transport.
 * - A missing/blank API key throws `provider_auth_failed` — callers that must
 *   stay silent when unconfigured should use the capability probes, which map
 *   a missing key to `unconfigured` instead of throwing.
 * - Success payloads are preserved whole up to MEDIA_RESPONSE_MAX_BYTES;
 *   oversized bodies fail instead of truncating into corrupt data. Reading
 *   enforces the cap incrementally, so memory stays bounded.
 * - Bounded retries apply only to network errors, timeouts, and retryable
 *   statuses (408/425/429/5xx). Auth and validation failures never retry.
 * - Cooperative cancellation via `AbortSignal`: on abort the in-flight fetch
 *   is aborted and a `provider_cancelled` ProviderError is thrown. A
 *   cancellation that arrives after the response completed is reported as a
 *   failure — it is never republished as success.
 */
export class MediaAdapter {
  private readonly apiKey: string | null;
  private readonly model: string | null;
  private readonly fetchImpl: MediaFetch;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly traceAttempts: boolean;

  constructor(options: MediaAdapterOptions) {
    const key = options.apiKey?.trim();
    this.apiKey = key !== undefined && key.length > 0 ? key : null;
    this.model = options.model?.trim() ? (options.model.trim() as string) : null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.defaultMaxRetries = options.maxRetries ?? 1;
    this.traceAttempts = options.traceAttempts === true;
  }

  get configured(): boolean {
    return this.apiKey !== null;
  }

  get targetedModel(): string | null {
    return this.model;
  }

  async call(
    path: string,
    body: Record<string, unknown>,
    options: MediaRequestOptions = {},
  ): Promise<MediaCallResult> {
    const url = `${MEDIA_PROVIDER_ORIGIN}${path}`;
    if (!isAllowedMediaUrl(url)) {
      throw new ProviderError(
        'invalid_request',
        `Refusing media request to non-provider origin: ${boundedRedacted(url, 120, [this.apiKey])}`,
      );
    }
    if (this.apiKey === null) {
      throw new ProviderError('provider_auth_failed', 'Media API key is not configured.');
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const started = Date.now();
    const hasRawBody = options.rawBody !== undefined;
    const payload: Record<string, unknown> = hasRawBody ? {} : { ...body };
    if (!hasRawBody && this.model !== null && payload.model === undefined) {
      payload.model = this.model;
    }

    let attempt = 0;
    let dispatches = 0;
    // Every ProviderError thrown after a dispatch carries the dispatch
    // count in details so callers (and HTTP error envelopes) can account
    // provider attempts exactly, including on failure.
    const fail = (
      code: ProviderErrorCode,
      message: string,
      extra: Record<string, unknown> = {},
    ): never => {
      throw new ProviderError(code, message, { ...extra, attempts: dispatches });
    };
    for (;;) {
      if (isAborted(options.signal)) {
        throw new ProviderError(
          'provider_cancelled',
          'Media request was cancelled before it started.',
        );
      }
      if (this.traceAttempts) {
        const traceModel = traceModelName(options, payload);
        console.error(
          `[media-trace] attempt=${attempt + 1} path=${path} model=${traceModel.slice(0, 120)}`,
        );
      }
      dispatches += 1;
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          // Credential goes in the header only — never in the URL or logs.
          authorization: `Bearer ${this.apiKey}`,
        };
        if (!hasRawBody) headers['content-type'] = 'application/json';
        else if (options.contentType !== undefined) headers['content-type'] = options.contentType;
        if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
          headers['idempotency-key'] = options.idempotencyKey.slice(0, 128);
        }
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: hasRawBody ? options.rawBody : JSON.stringify(payload),
          signal: controller.signal,
          // Never follow redirects automatically: a 3xx destination is NOT
          // validated by fetch, so default behaviour could deliver the POST
          // body and (same-origin) auth headers to another host.
          redirect: 'manual',
        });
        // A redirect is a transport refusal, not a success and not a body to
        // follow. Surface the status explicitly (never the location: it is
        // untrusted provider/host content and stays out of diagnostics).
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => undefined);
          clearTimeout(timer);
          fail(
            'provider_unavailable',
            `Media request was redirected (status ${response.status}); redirects are refused so requests stay on the provider origin.`,
            { status: response.status },
          );
        }
        const text = await readBoundedText(response);
        clearTimeout(timer);
        if (this.traceAttempts) {
          console.error(
            `[media-trace] outcome=response attempt=${attempt + 1} status=${response.status} bytes=${text.length}`,
          );
        }
        if (isAborted(options.signal)) {
          // Completed after cancellation: report failure, never success.
          fail('provider_cancelled', 'Media request was cancelled.');
        }
        if (!response.ok) {
          if (attempt < maxRetries && isRetryable(null, response.status)) {
            attempt += 1;
            continue;
          }
          fail(
            toProviderCode(response.status, text),
            `Media request failed with status ${response.status}: ${boundedRedacted(text, 200, [this.apiKey])}`,
            { status: response.status },
          );
        }
        return {
          status: response.status,
          body: text,
          model: this.model,
          latency_ms: Date.now() - started,
          attempts: dispatches,
        };
      } catch (error) {
        clearTimeout(timer);
        if (ProviderError.isProviderError(error)) {
          // Provider-mapped failure (incl. late cancellation): never publish.
          // Post-dispatch transport failures keep the exact dispatch count.
          if (typeof error.details.attempts !== 'number') {
            throw new ProviderError(error.code, error.message, {
              ...error.details,
              attempts: dispatches,
            });
          }
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (this.traceAttempts) {
          console.error(
            `[media-trace] outcome=error attempt=${attempt + 1} error=${boundedRedacted(message, 160, [this.apiKey])}`,
          );
        }
        const signalAborted = isAborted(options.signal);
        const aborted =
          signalAborted ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          /abort/i.test(message);
        if (aborted && signalAborted) {
          fail('provider_cancelled', 'Media request was cancelled.');
        }
        if (attempt < maxRetries && isRetryable(error, null)) {
          attempt += 1;
          continue;
        }
        const timedOut = /timeout|timed out/i.test(message) || error instanceof DOMException;
        fail(
          aborted ? 'provider_cancelled' : timedOut ? 'provider_timeout' : 'provider_unavailable',
          boundedRedacted(`Media request failed: ${message}`, MAX_DETAIL_CHARS, [this.apiKey]),
        );
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Streaming transport for the Responses `stream: true` contract
   * (SAM segmentation). Mirrors `call` — same origin pinning, key
   * handling, redirect refusal, retry policy, trace lines, and
   * per-attempt wall-clock budget — but reads `text/event-stream`
   * incrementally and returns parsed SSE events plus a sha256 over the
   * exact raw stream bytes. Anything that is not an event stream
   * (wrong content-type, oversized body, missing body) fails with
   * `provider_invalid_output`: a JSON body in answer to `stream: true`
   * is a contract violation, never a silent fallback.
   */
  async callStream(
    path: string,
    body: Record<string, unknown>,
    options: MediaRequestOptions = {},
  ): Promise<MediaStreamResult> {
    const url = `${MEDIA_PROVIDER_ORIGIN}${path}`;
    if (!isAllowedMediaUrl(url)) {
      throw new ProviderError(
        'invalid_request',
        `Refusing media request to non-provider origin: ${boundedRedacted(url, 120, [this.apiKey])}`,
      );
    }
    if (this.apiKey === null) {
      throw new ProviderError('provider_auth_failed', 'Media API key is not configured.');
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const started = Date.now();
    const hasRawBody = options.rawBody !== undefined;
    const payload: Record<string, unknown> = hasRawBody ? {} : { ...body };
    if (!hasRawBody) {
      if (this.model !== null && payload.model === undefined) {
        payload.model = this.model;
      }
      // The streaming contract is a transport guarantee, not caller
      // folklore: every callStream dispatch requests SSE explicitly.
      payload.stream = true;
    }

    let attempt = 0;
    let dispatches = 0;
    const fail = (
      code: ProviderErrorCode,
      message: string,
      extra: Record<string, unknown> = {},
    ): never => {
      throw new ProviderError(code, message, { ...extra, attempts: dispatches });
    };
    for (;;) {
      if (isAborted(options.signal)) {
        throw new ProviderError(
          'provider_cancelled',
          'Media request was cancelled before it started.',
        );
      }
      if (this.traceAttempts) {
        const traceModel = traceModelName(options, payload);
        console.error(
          `[media-trace] attempt=${attempt + 1} path=${path} model=${traceModel.slice(0, 120)}`,
        );
      }
      dispatches += 1;
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'text/event-stream',
        };
        if (!hasRawBody) headers['content-type'] = 'application/json';
        else if (options.contentType !== undefined) headers['content-type'] = options.contentType;
        if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
          headers['idempotency-key'] = options.idempotencyKey.slice(0, 128);
        }
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: hasRawBody ? options.rawBody : JSON.stringify(payload),
          signal: controller.signal,
          redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => undefined);
          clearTimeout(timer);
          fail(
            'provider_unavailable',
            `Media request was redirected (status ${response.status}); redirects are refused so requests stay on the provider origin.`,
            { status: response.status },
          );
        }
        if (!response.ok) {
          const text = await readBoundedText(response);
          clearTimeout(timer);
          if (attempt < maxRetries && isRetryable(null, response.status)) {
            attempt += 1;
            continue;
          }
          fail(
            toProviderCode(response.status, text),
            `Media request failed with status ${response.status}: ${boundedRedacted(text, 200, [this.apiKey])}`,
            { status: response.status },
          );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('text/event-stream')) {
          await response.body?.cancel().catch(() => undefined);
          clearTimeout(timer);
          fail(
            'provider_invalid_output',
            `Media stream answered ${boundedRedacted(contentType.slice(0, 120), 120, [this.apiKey]) || '(no content-type)'} instead of text/event-stream; refusing a non-stream body on a streaming request.`,
          );
        }
        const { events, streamBytes, responseSha256 } = await readBoundedStream(response);
        clearTimeout(timer);
        if (this.traceAttempts) {
          console.error(
            `[media-trace] outcome=response attempt=${attempt + 1} status=${response.status} bytes=${streamBytes} events=${events.length}`,
          );
        }
        if (isAborted(options.signal)) {
          fail('provider_cancelled', 'Media request was cancelled.');
        }
        return {
          status: response.status,
          body: '',
          model: this.model,
          latency_ms: Date.now() - started,
          attempts: dispatches,
          events,
          streamBytes,
          responseSha256,
        };
      } catch (error) {
        clearTimeout(timer);
        if (ProviderError.isProviderError(error)) {
          // Post-dispatch transport failures (byte cap, missing body,
          // wrong content-type) keep the exact dispatch count: the API
          // can only surface attempts when details retains it.
          if (typeof error.details.attempts !== 'number') {
            throw new ProviderError(error.code, error.message, {
              ...error.details,
              attempts: dispatches,
            });
          }
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (this.traceAttempts) {
          console.error(
            `[media-trace] outcome=error attempt=${attempt + 1} error=${boundedRedacted(message, 160, [this.apiKey])}`,
          );
        }
        const signalAborted = isAborted(options.signal);
        const aborted =
          signalAborted ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          /abort/i.test(message);
        if (aborted && signalAborted) {
          fail('provider_cancelled', 'Media request was cancelled.');
        }
        if (attempt < maxRetries && isRetryable(error, null)) {
          attempt += 1;
          continue;
        }
        const timedOut = /timeout|timed out/i.test(message) || error instanceof DOMException;
        fail(
          aborted ? 'provider_cancelled' : timedOut ? 'provider_timeout' : 'provider_unavailable',
          boundedRedacted(`Media request failed: ${message}`, MAX_DETAIL_CHARS, [this.apiKey]),
        );
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }
}
