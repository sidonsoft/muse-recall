import { ProviderError } from '@mml/muse-provider';
import {
  DEFAULT_MEDIA_IMAGE_MODEL,
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
  /**
   * Deliberate video clip test: a `file_id` from an already-uploaded clip
   * (uploads never happen inside a probe) plus its MIME for the documented
   * `input_file` reference. Without this the video probe stays `unverified`:
   * text-only reachability must never read as video-ready. Supplying a clip
   * is an explicit, potentially billable inference call — never implied by
   * opening Studio or by a default probe run.
   */
  videoClip?: { fileId: string; mime?: string };
}

export type MediaProbeFn = (
  adapter: Pick<MediaAdapter, 'call' | 'configured' | 'targetedModel'>,
  options?: MediaProbeOptions,
) => Promise<MediaProbeReport>;

/** Documented default models per capability (dev.meta.ai/docs/models). */
export const MEDIA_PROBE_MODELS: Record<MediaCapabilityName, string> = {
  // OpenAI-compatible images endpoint; the model id is a body field.
  'image-generate': DEFAULT_MEDIA_IMAGE_MODEL,
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

/**
 * Result of parsing a Responses API envelope (shared by text/segment/video,
 * and by the Batch C understand/segment operations).
 */
export interface ResponsesEnvelope {
  ok: boolean;
  summary: string;
  /** Complete output items when the envelope parsed; null otherwise. */
  output: unknown[] | null;
  /** Terminal status string when present (completed/incomplete/failed/...). */
  status: string | null;
  /** Error message when the envelope is an error result. */
  error: string | null;
}

/** Safely parse JSON; null when the body is not a JSON object. */
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

/**
 * Parse a Responses API envelope into typed parts. Never serializes-and-
 * searches: output items are walked as structures. Error envelopes
 * (`error` field or a failed status) and incomplete/truncated results are
 * reported explicitly so callers can distinguish refusal from success.
 */
export function parseResponsesEnvelope(body: string, label: string): ResponsesEnvelope {
  const json = parseJsonObject(body);
  if (!json)
    return {
      ok: false,
      summary: `non-JSON ${label} response`,
      output: null,
      status: null,
      error: null,
    };
  const errorField: unknown = json.error;
  if (errorField !== undefined && errorField !== null) {
    const message =
      typeof errorField === 'string'
        ? errorField
        : typeof (errorField as Record<string, unknown>).message === 'string'
          ? String((errorField as Record<string, unknown>).message)
          : 'error result';
    return {
      ok: false,
      summary: `${label} error result: ${message}`.slice(0, 120),
      output: null,
      status: null,
      error: message,
    };
  }
  const status: unknown = json.status;
  const statusText = typeof status === 'string' ? status : null;
  if (statusText !== null && statusText !== 'completed') {
    return {
      ok: false,
      summary: `${label} terminal status ${JSON.stringify(statusText)} (not completed)`,
      output: null,
      status: statusText,
      error: null,
    };
  }
  const output: unknown = json.output;
  if (!Array.isArray(output) || output.length === 0) {
    return {
      ok: false,
      summary: `${label} response without output[]`,
      output: null,
      status: statusText,
      error: null,
    };
  }
  return {
    ok: true,
    summary: `${label} output[${output.length}]`,
    output,
    status: statusText,
    error: null,
  };
}

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface RefusalPart {
  kind: 'refusal';
  text: string;
}

/** Walk output items and collect typed text/refusal parts (parsed, not grepped). */
export function collectOutputParts(output: unknown[]): {
  texts: TextPart[];
  refusals: RefusalPart[];
} {
  const texts: TextPart[] = [];
  const refusals: RefusalPart[] = [];
  for (const item of output) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const content: unknown = record.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part === null || typeof part !== 'object' || Array.isArray(part)) continue;
      const typed = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if (typed.type === 'output_text' || typed.type === 'text') {
        if (typeof typed.text === 'string') texts.push({ kind: 'text', text: typed.text });
      } else if (typed.type === 'refusal') {
        const message =
          typeof typed.refusal === 'string'
            ? typed.refusal
            : typeof typed.text === 'string'
              ? typed.text
              : 'refused';
        refusals.push({ kind: 'refusal', text: message });
      }
    }
  }
  return { texts, refusals };
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

/** image-understand: requires a text part with actual non-empty content. */
function checkUnderstandResponse(body: string): ProbeCheck {
  const envelope = parseResponsesEnvelope(body, 'understand');
  if (!envelope.ok || envelope.output === null) return envelope;
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    return { ok: false, summary: `understand refusal: ${refusals[0]?.text.slice(0, 80)}` };
  }
  const answered = texts.find((part) => part.text.trim().length > 0);
  return answered
    ? { ok: true, summary: `understand text[${answered.text.trim().length} chars]` }
    : { ok: false, summary: 'understand output without text content' };
}

/**
 * SAM segmentation: validate the documented geometry lane. Per
 * dev.meta.ai/docs/sam/reading-segmentation the stream carries one
 * `output_text` lane with one line per frame:
 * `<Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;x=0;y=0[;c=..];data=H,W,PAYLOAD|>,...`
 * Zero matches is VALID (empty `output_text` + completed response): the
 * probe proves the geometry path works, it does not require a match on a
 * 1x1 probe image. A fixture with a known object can additionally assert a
 * match; the default probe accepts the valid empty shape explicitly.
 */
const SAM_FRAME_MARKER = /<\d+f>/;
const SAM_BOX_TOKEN = /<\|box;x1=\d+;y1=\d+;x2=\d+;y2=\d+;w=\d+;h=\d+(;c=\d+(?:\.\d+)?)?\|>/;
const SAM_MASK_TOKEN = /<\|mask;x=\d+;y=\d+(;c=\d+(?:\.\d+)?)?;data=\d+,\d+,[^|]+\|>/;

function checkSegmentResponse(body: string): ProbeCheck {
  const envelope = parseResponsesEnvelope(body, 'segment');
  if (!envelope.ok || envelope.output === null) return envelope;
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    return { ok: false, summary: `segment refusal: ${refusals[0]?.text.slice(0, 80)}` };
  }
  if (texts.length === 0) {
    // No text lane at all: genuinely missing geometry (not a zero-match,
    // which still carries an empty output_text lane).
    return { ok: false, summary: 'segment output without an output_text lane' };
  }
  const lane = texts.map((part) => part.text).join('\n');
  if (lane.trim().length === 0) {
    return { ok: true, summary: 'segment zero matches (empty output_text, completed)' };
  }
  const lines = lane
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const valid = lines.filter(
    (line) => SAM_FRAME_MARKER.test(line) && SAM_BOX_TOKEN.test(line) && SAM_MASK_TOKEN.test(line),
  );
  return valid.length > 0
    ? { ok: true, summary: `segment geometry ${valid.length}/${lines.length} frame lines` }
    : { ok: false, summary: 'segment output_text without box/mask geometry' };
}

/** One validated transcript turn: turn-level text plus numeric timing. */
interface TranscriptTurn {
  text: string;
}

/**
 * transcribe: validate the documented buffered shape. PUSH_TO_TALK returns a
 * single-turn `{text}` (empty string is legitimate silence);
 * ENDPOINTING/DIARIZATION return `{turns: [...]}` where each turn carries a
 * string transcript — and `turns: []` is legitimate silence, reported as
 * available with a no-speech detail, not as failure. Error-result envelopes
 * (`type: 'error'`) fail. Unknown shapes (`results: []`, bare arrays) fail:
 * an unrecognized contract is not evidence of compatibility.
 */
function checkTranscribeResponse(body: string): ProbeCheck {
  const json = parseJsonObject(body);
  if (!json) return { ok: false, summary: 'non-JSON transcribe response' };
  const envelopeType: unknown = json.type;
  if (envelopeType === 'error') {
    const message: unknown = json.message;
    return {
      ok: false,
      summary: `transcribe error result: ${typeof message === 'string' ? message.slice(0, 80) : 'refused'}`,
    };
  }
  if (typeof json.text === 'string') {
    return json.text.trim().length > 0
      ? { ok: true, summary: `transcript text[${json.text.trim().length} chars]` }
      : { ok: true, summary: 'transcript empty (silence)' };
  }
  const turns: unknown = json.turns;
  if (!Array.isArray(turns)) {
    return { ok: false, summary: 'transcribe response without text/turns' };
  }
  const parsed: TranscriptTurn[] = [];
  for (const turn of turns) {
    if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
      return { ok: false, summary: 'transcribe turn with invalid shape' };
    }
    const record = turn as Record<string, unknown>;
    const text: unknown = record.transcript ?? record.text;
    if (typeof text !== 'string') {
      return { ok: false, summary: 'transcribe turn without string transcript' };
    }
    parsed.push({ text });
  }
  const spoken = parsed.filter((turn) => turn.text.trim().length > 0);
  return spoken.length > 0
    ? { ok: true, summary: `transcript ${spoken.length}/${parsed.length} turns with speech` }
    : { ok: true, summary: `transcript ${parsed.length} turns, no speech (silence)` };
}

/** video-path reachability: text-only turn proves endpoint+model only. */
function checkVideoReachability(body: string): ProbeCheck {
  const envelope = parseResponsesEnvelope(body, 'video-path');
  if (!envelope.ok || envelope.output === null) return envelope;
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    return { ok: false, summary: `video-path refusal: ${refusals[0]?.text.slice(0, 80)}` };
  }
  const answered = texts.find((part) => part.text.trim().length > 0);
  return answered
    ? { ok: true, summary: 'video-path endpoint reachable (text turn only)' }
    : { ok: false, summary: 'video-path output without text content' };
}

interface ProbeRequest {
  path: string;
  body: Record<string, unknown>;
  rawBody?: RequestInit['body'];
  contentType?: string;
  check: (body: string) => ProbeCheck;
  /**
   * When true, a passing check reports `unverified` (reachability only)
   * instead of `available`. Used by the text-only video probe: the endpoint
   * answers, but the capability-specific input was not exercised.
   */
  reachabilityOnly?: boolean;
}

/** Build the documented minimal request + validator for one capability. */
function requestFor(
  capability: MediaCapabilityName,
  model: string,
  options: MediaProbeOptions,
): ProbeRequest {
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
        check: checkUnderstandResponse,
      };
    case 'segment':
      // Short noun-phrase concept prompt per the documented prompting rules
      // (no commands, no questions, one concept). max_output_tokens bounds
      // the geometry lane; a zero-match empty lane is a valid pass.
      return {
        path: '/v1/responses',
        body: {
          model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: 'red square' },
                { type: 'input_image', image_url: TINY_PNG_DATA_URL },
              ],
            },
          ],
          max_output_tokens: 256,
        },
        check: checkSegmentResponse,
      };
    case 'transcribe': {
      const wav = tinyWav();
      const form = new FormData();
      // Documented multipart shape: `request` (JSON settings) + `audio`.
      form.append('request', JSON.stringify({ model, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' }));
      form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'probe.wav');
      return {
        path: '/v1/asr/transcribe',
        body: {},
        rawBody: form,
        // Let fetch set the multipart boundary: contentType intentionally
        // omitted so the header is generated from the FormData.
        check: checkTranscribeResponse,
      };
    }
    case 'video': {
      const clip = options.videoClip;
      if (clip) {
        // Deliberate clip test only: the caller uploaded the clip already
        // (probes never upload) and passes its file_id. The documented
        // video-understanding shape references the file by id.
        return {
          path: '/v1/responses',
          body: {
            model,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Describe this clip in one sentence.' },
                  { type: 'input_file', file_id: clip.fileId },
                ],
              },
            ],
            max_output_tokens: 64,
          },
          check: checkUnderstandResponse,
        };
      }
      // Default: text-only reachability. Proves the exact endpoint + model
      // answer, but exercises no video upload, decode, or understanding —
      // so a pass reports `unverified`, never `available`.
      return {
        path: '/v1/responses',
        body: {
          model,
          input: 'Reply with the single word "ready".',
          max_output_tokens: 8,
        },
        check: checkVideoReachability,
        reachabilityOnly: true,
      };
    }
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
  const probe = requestFor(capability, model, options);
  try {
    const result = await adapter.call(probe.path, probe.body, {
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(probe.rawBody !== undefined
        ? {
            rawBody: probe.rawBody,
            ...(probe.contentType !== undefined ? { contentType: probe.contentType } : {}),
          }
        : {}),
    });
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
    if (probe.reachabilityOnly === true) {
      // Endpoint + model answer, but the capability input was not exercised:
      // reachable yet explicitly NOT video-ready.
      return {
        capability,
        status: 'unverified',
        model: result.model ?? model,
        detail: boundedRedacted(
          `ok ${result.status} ${check.summary}; video upload/decode/understanding untested — pass videoClip for a clip test`,
        ),
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
