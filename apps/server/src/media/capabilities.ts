import { ProviderError } from '@mml/muse-provider';
import {
  MEDIA_CAPABILITIES,
  type MediaCapability,
  type MediaCapabilityName,
  type MediaProbeReport,
  redactSecrets,
} from '@mml/shared';
import { MediaAdapter } from './adapter.js';

/**
 * Batch A1 — per-capability media probes.
 *
 * Each probe sends one lightweight request for its capability and maps the
 * outcome to a status record:
 *
 * - missing/blank API key → `unconfigured` (never throws, never disables the
 *   caller — the probe simply reports that nothing was attempted);
 * - HTTP 200 → `available`;
 * - 404/405/501 (unknown route / not implemented for this model) →
 *   `unavailable`;
 * - 401/403 or any other failure → `failed`.
 *
 * Records carry the targeted model id, a bounded redacted detail (response
 * shape summary on success, error text otherwise), and latency. Secrets are
 * never logged or echoed.
 */

export interface MediaProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  model?: string;
  /** Override the strictly-probed path for a capability (tests/fixtures). */
  paths?: Partial<Record<MediaCapabilityName, string>>;
  /** Passed through as `Idempotency-Key` so duplicate submits are deduped. */
  idempotencyKey?: string;
}

export type MediaProbeFn = (
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options?: MediaProbeOptions,
) => Promise<MediaProbeReport>;

export const MEDIA_PROBE_PATHS: Record<MediaCapabilityName, string> = {
  'image-generate': '/v1/media/image/generate',
  'image-understand': '/v1/media/image/understand',
  segment: '/v1/media/segment',
  transcribe: '/v1/media/transcribe',
  video: '/v1/media/video',
};

const MAX_DETAIL_CHARS = 300;

function boundedRedacted(message: string, limit = MAX_DETAIL_CHARS): string {
  const redacted = redactSecrets(message);
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
}

/** Shape summary of a JSON probe body, e.g. `object{data,status}`. Bounded. */
function shapeOf(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return body.length === 0 ? 'empty response' : `text[${body.length}]`;
  }
  if (Array.isArray(parsed)) return `array[${parsed.length}]`;
  if (parsed !== null && typeof parsed === 'object') {
    const keys = Object.keys(parsed).slice(0, 8).join(',');
    return keys.length > 0 ? `object{${keys}}` : 'object{}';
  }
  return typeof parsed;
}

function statusFor(error: unknown): MediaCapability['status'] {
  if (!ProviderError.isProviderError(error)) return 'failed';
  if (error.code === 'invalid_request') {
    const status = error.details.status;
    if (status === 404 || status === 405 || status === 501) return 'unavailable';
  }
  return 'failed';
}

async function probeOne(
  capability: MediaCapabilityName,
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options: MediaProbeOptions = {},
): Promise<MediaCapability> {
  const model = options.model ?? adapter.targetedModel;
  if (!adapter.configured) {
    // Missing credentials are a report, not an error: the caller stays live.
    return { capability, status: 'unconfigured', model, detail: null, latency_ms: null };
  }
  const started = Date.now();
  const path = options.paths?.[capability] ?? MEDIA_PROBE_PATHS[capability];
  try {
    const result = await adapter.call(
      path,
      { capability, probe: true },
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      },
    );
    return {
      capability,
      status: 'available',
      model: result.model ?? model,
      detail: boundedRedacted(`ok ${result.status} ${shapeOf(result.body)}`),
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      capability,
      status: statusFor(error),
      model,
      detail: boundedRedacted(error instanceof Error ? error.message : String(error)),
      latency_ms: Date.now() - started,
    };
  }
}

export async function probeMediaCapability(
  capability: MediaCapabilityName,
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options: MediaProbeOptions = {},
): Promise<MediaCapability> {
  return probeOne(capability, adapter, options);
}

export async function probeMediaCapabilities(
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options: MediaProbeOptions = {},
): Promise<MediaProbeReport> {
  const capabilities: MediaCapability[] = [];
  for (const capability of MEDIA_CAPABILITIES) {
    capabilities.push(await probeOne(capability, adapter, options));
  }
  return { probed_at: new Date().toISOString(), capabilities };
}

/** Build an adapter from the Forge media key (`FORGE_MUSE_API_KEY`). */
export function mediaAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps?: { fetchImpl?: typeof fetch; model?: string },
): MediaAdapter {
  const raw = env.FORGE_MUSE_API_KEY?.trim();
  return new MediaAdapter({
    apiKey: raw !== undefined && raw.length > 0 ? raw : null,
    ...(deps?.model !== undefined ? { model: deps.model } : {}),
    ...(deps?.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
}
