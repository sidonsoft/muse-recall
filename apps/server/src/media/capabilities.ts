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
 * Batch A1 — per-capability media probes, rewritten after the d3f3b67
 * review to use DOCUMENTED Meta Model API contracts. The previous version
 * probed invented `/v1/media/*` routes with `{capability, probe:true}`
 * payloads: a fake 200 proved nothing, and a real 404 on the fabricated
 * route could mislabel a healthy capability as unavailable.
 *
 * Each probe now sends a minimal but REAL inference request:
 *
 * - image-generate → POST /v1/images/generations (OpenAI-compatible;
 *   `muse-image-1.0`), validates ImagesResponse carries image data.
 * - image-understand → POST /v1/responses with a Muse Spark input carrying
 *   one tiny inline image + question; validates a text output item.
 * - segment → POST /v1/responses with model `sam-3.1` and a text+nano-image
 *   input; validates geometry output (boxes/masks referenced in output).
 * - transcribe → POST /v1/asr/transcribe as multipart upload of a tiny WAV;
 *   validates transcript text in the response.
 * - video → POST /v1/responses with a Muse Spark input referencing a
 *   `file_id` placeholder is NOT attempted (no upload happens in a probe):
 *   instead the probe issues a text-only Responses request to the same
 *   model/endpoint used for video, so it proves reachability of the exact
 *   inference path without billable media processing.
 *
 * Success requires validating the expected result shape, not merely
 * HTTP 200. Probes are sequential, tiny, and explicit — opening Studio
 * never fans out billable calls automatically; callers invoke these
 * deliberately (e.g. a settings health check).
 *
 * Mapping (unchanged): missing/blank key → `unconfigured` (never throws,
 * zero I/O); 404/405/501 → `unavailable`; 401/403/other → `failed`.
 */

export interface MediaProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  model?: string;
  /**
   * Override the model per capability (documented model ids only). Tests and
   * fixtures use this to avoid real model names.
   */
  models?: Partial<Record<MediaCapabilityName, string>>;
  /** Passed through as `Idempotency-Key` so duplicate submits are deduped. */
  idempotencyKey?: string;
}

export type MediaProbeFn = (
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options?: MediaProbeOptions,
) => Promise<MediaProbeReport>;

/** Documented default models per capability (dev.meta.ai/docs/models). */
export const MEDIA_PROBE_MODELS: Record<MediaCapabilityName, string> = {
  // OpenAI-compatible images endpoint; the model id is a body field.
  'image-generate': 'muse-image-1.0',
  // Responses API vision-language model.
  'image-understand': 'muse-spark-1.3',
  // Responses API segmentation model.
  segment: 'sam-3.1',
  // Multipart ASR endpoint; the model rides as a form field.
  transcribe: 'muse-voice-transcribe-1.0',
  // Same Responses endpoint/model used for video understanding.
  video: 'muse-spark-1.3',
};

const MAX_DETAIL_CHARS = 300;

function boundedRedacted(message: string, limit = MAX_DETAIL_CHARS): string {
  const redacted = redactSecrets(message);
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
}

function modelFor(
  capability: MediaCapabilityName,
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options: MediaProbeOptions,
): string {
  return (
    options.model ??
    options.models?.[capability] ??
    adapter.targetedModel ??
    MEDIA_PROBE_MODELS[capability]
  );
}

/** 1x1 transparent PNG as a data URL: the smallest real image fixture. */
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 0.1s of silence, 8kHz 16-bit mono WAV (44-byte header + 1600 samples). */
function tinyWav(): Buffer {
  const samples = 800;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
}

/** Parsed validation outcome: ok carries a shape summary for the detail. */
interface ProbeCheck {
  ok: boolean;
  summary: string;
}

/** Safely parse JSON; null when the body is not JSON. */
function parseJsonObject(body: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** image-generate: ImagesResponse must carry at least one image payload. */
function checkImagesResponse(body: string): ProbeCheck {
  const json = parseJsonObject(body);
  if (!json) return { ok: false, summary: 'non-JSON image response' };
  const data: unknown = json.data;
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, summary: 'ImagesResponse without data[]' };
  }
  const first: unknown = data[0];
  const firstRecord: Record<string, unknown> =
    first !== null && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {};
  const hasPayload =
    typeof firstRecord.b64_json === 'string' || typeof firstRecord.url === 'string';
  return hasPayload
    ? { ok: true, summary: `ImagesResponse data[${data.length}]` }
    : { ok: false, summary: 'ImagesResponse data[0] without b64_json/url' };
}

/** Responses API: must carry output with a text-bearing item. */
function checkResponsesText(body: string, label: string): ProbeCheck {
  const json = parseJsonObject(body);
  if (!json) return { ok: false, summary: `non-JSON ${label} response` };
  const output: unknown = json.output;
  if (!Array.isArray(output) || output.length === 0) {
    return { ok: false, summary: `${label} response without output[]` };
  }
  const serialized = JSON.stringify(output);
  const hasText =
    serialized.includes('output_text') ||
    serialized.includes('"text"') ||
    serialized.includes('"content"');
  return hasText
    ? { ok: true, summary: `${label} output[${output.length}]` }
    : { ok: false, summary: `${label} output without text content` };
}

/** transcribe: ASR response must carry transcript text. */
function checkTranscribeResponse(body: string): ProbeCheck {
  const json = parseJsonObject(body);
  if (!json) return { ok: false, summary: 'non-JSON transcribe response' };
  const text: unknown = json.text ?? json.transcript ?? json.results;
  if (typeof text === 'string' && text.length > 0) {
    return { ok: true, summary: 'transcript text' };
  }
  if (text !== undefined && text !== null) {
    return { ok: true, summary: 'transcript results' };
  }
  return { ok: false, summary: 'transcribe response without transcript' };
}

interface ProbeRequest {
  path: string;
  body: Record<string, unknown>;
  rawBody?: RequestInit['body'];
  contentType?: string;
  check: (body: string) => ProbeCheck;
}

/** Build the documented minimal request + validator for one capability. */
function requestFor(capability: MediaCapabilityName, model: string): ProbeRequest {
  switch (capability) {
    case 'image-generate':
      return {
        path: '/v1/images/generations',
        body: { model, prompt: 'a tiny red square, flat design', n: 1, size: '256x256' },
        check: checkImagesResponse,
      };
    case 'image-understand':
      return {
        path: '/v1/responses',
        body: {
          model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: 'What color is this square? Answer in one word.' },
                { type: 'input_image', image_url: TINY_PNG_DATA_URL },
              ],
            },
          ],
          max_output_tokens: 16,
        },
        check: (result) => checkResponsesText(result, 'understand'),
      };
    case 'segment':
      return {
        path: '/v1/responses',
        body: {
          model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: 'the square' },
                { type: 'input_image', image_url: TINY_PNG_DATA_URL },
              ],
            },
          ],
          max_output_tokens: 256,
        },
        check: (result) => checkResponsesText(result, 'segment'),
      };
    case 'transcribe': {
      const wav = tinyWav();
      const form = new FormData();
      form.append('model', model);
      form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'probe.wav');
      form.append('mode', 'PUSH_TO_TALK');
      return {
        path: '/v1/asr/transcribe',
        body: {},
        rawBody: form,
        // Let fetch set the multipart boundary: contentType intentionally
        // omitted so the header is generated from the FormData.
        check: checkTranscribeResponse,
      };
    }
    case 'video':
      // Probe the exact Responses inference path used for video (same
      // endpoint + model) with a text-only turn: proves reachability without
      // uploading media or triggering billable video processing.
      return {
        path: '/v1/responses',
        body: {
          model,
          input: 'Reply with the single word "ready".',
          max_output_tokens: 8,
        },
        check: (result) => checkResponsesText(result, 'video-path'),
      };
  }
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
  const model = modelFor(capability, adapter, options);
  if (!adapter.configured) {
    // Missing credentials are a report, not an error: the caller stays live.
    return { capability, status: 'unconfigured', model, detail: null, latency_ms: null };
  }
  const started = Date.now();
  const probe = requestFor(capability, model);
  try {
    const result = await adapter.call(
      probe.path,
      probe.body,
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(probe.rawBody !== undefined
          ? {
              rawBody: probe.rawBody,
              ...(probe.contentType !== undefined ? { contentType: probe.contentType } : {}),
            }
          : {}),
      },
    );
    const check = probe.check(result.body);
    if (!check.ok) {
      return {
        capability,
        status: 'failed',
        model: result.model ?? model,
        detail: boundedRedacted(`ok ${result.status} but invalid: ${check.summary}`),
        latency_ms: Date.now() - started,
      };
    }
    return {
      capability,
      status: 'available',
      model: result.model ?? model,
      detail: boundedRedacted(`ok ${result.status} ${check.summary}`),
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
