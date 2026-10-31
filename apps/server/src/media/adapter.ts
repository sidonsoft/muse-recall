import { ProviderError } from '@mml/muse-provider';
import { type ProviderErrorCode, redactSecrets } from '@mml/shared';

/**
 * Batch A1 — bounded server-side media adapter for the Meta Model API.
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
}

export interface MediaCallResult {
  status: number;
  body: string;
  model: string | null;
  latency_ms: number;
}

export type MediaFetch = typeof fetch;

export interface MediaAdapterOptions {
  apiKey: string | null | undefined;
  /** Model id targeted by probes/calls; sent as a body field only. */
  model?: string;
  fetchImpl?: MediaFetch;
  timeoutMs?: number;
  maxRetries?: number;
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
  if (status === 400 || status === 404 || status === 405 || status === 422)
    return 'invalid_request';
  if (status !== null && status >= 400 && status < 500) return 'invalid_request';
  return 'provider_unavailable';
}

/**
 * Minimal structured transport for media endpoints.
 *
 * - URL origin is pinned to `https://api.meta.ai`; anything else throws
 *   `invalid_request` before any I/O.
 * - A missing/blank API key throws `provider_auth_failed` — callers that must
 *   stay silent when unconfigured should use the capability probes, which map
 *   a missing key to `unconfigured` instead of throwing.
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

  constructor(options: MediaAdapterOptions) {
    const key = options.apiKey?.trim();
    this.apiKey = key !== undefined && key.length > 0 ? key : null;
    this.model = options.model?.trim() ? (options.model.trim() as string) : null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.defaultMaxRetries = options.maxRetries ?? 1;
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
    const payload: Record<string, unknown> = { ...body };
    if (this.model !== null && payload.model === undefined) payload.model = this.model;

    let attempt = 0;
    for (;;) {
      if (isAborted(options.signal)) {
        throw new ProviderError(
          'provider_cancelled',
          'Media request was cancelled before it started.',
        );
      }
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          // Credential goes in the header only — never in the URL or logs.
          authorization: `Bearer ${this.apiKey}`,
        };
        if (options.idempotencyKey !== undefined && options.idempotencyKey.length > 0) {
          headers['idempotency-key'] = options.idempotencyKey.slice(0, 128);
        }
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const text = boundedRedacted(await response.text(), 2_000, [this.apiKey]);
        clearTimeout(timer);
        if (isAborted(options.signal)) {
          // Completed after cancellation: report failure, never success.
          throw new ProviderError('provider_cancelled', 'Media request was cancelled.');
        }
        if (!response.ok) {
          if (attempt < maxRetries && isRetryable(null, response.status)) {
            attempt += 1;
            continue;
          }
          throw new ProviderError(
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
        };
      } catch (error) {
        clearTimeout(timer);
        if (ProviderError.isProviderError(error)) {
          // Provider-mapped failure (incl. late cancellation): never publish.
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const signalAborted = isAborted(options.signal);
        const aborted =
          signalAborted ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          /abort/i.test(message);
        if (aborted && signalAborted) {
          throw new ProviderError('provider_cancelled', 'Media request was cancelled.');
        }
        if (attempt < maxRetries && isRetryable(error, null)) {
          attempt += 1;
          continue;
        }
        const timedOut = /timeout|timed out/i.test(message) || error instanceof DOMException;
        throw new ProviderError(
          aborted ? 'provider_cancelled' : timedOut ? 'provider_timeout' : 'provider_unavailable',
          boundedRedacted(`Media request failed: ${message}`, MAX_DETAIL_CHARS, [this.apiKey]),
        );
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }
}
