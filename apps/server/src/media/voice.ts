/**
 * Batch D — Muse Voice Transcribe and Muse Spark clip understanding.
 *
 * Both operations go through {@link MediaAdapter}, inheriting the provider
 * origin pin, redirect refusal, credential handling, bounded retries,
 * cancellation and response-size cap.
 *
 * Documented contracts (dev.meta.ai, checked 1 November 2026):
 * - `POST /v1/asr/transcribe` is multipart with a `request` JSON part and an
 *   `audio` WAV part. The buffered response carries `transcript`,
 *   `audioDurationMs`, and (for ENDPOINTING/DIARIZATION) `turns[]` with
 *   turn-level `startMs`/`endMs`.
 * - Video: upload the MP4 to `POST /v1/files` with `purpose=user_data`, then
 *   reference the returned id as an `input_file` content block on
 *   `POST /v1/responses`. Structured output uses `text.format` with a strict
 *   JSON schema.
 *
 * Provider output is never trusted: every transcript turn and observation is
 * parsed into typed values, bounded, and validated against the DURATION
 * MEASURED FROM THE UPLOADED FILE. Imagined or out-of-range timestamps are a
 * provider contract failure, not navigation data.
 */

import { ProviderError } from '@mml/muse-provider';
import {
  DEFAULT_TRANSCRIBE_MODEL,
  DEFAULT_VIDEO_MODEL,
  MEDIA_DURATION_TOLERANCE_MS,
  type MediaClipObservation,
  type MediaClipResponse,
  type MediaTranscribeMode,
  type MediaTranscript,
  type MediaTranscriptTurn,
} from '@mml/shared';
import type { MediaAdapter, MediaRequestOptions } from './adapter.js';
import { collectOutputParts, parseResponsesEnvelope } from './capabilities.js';

export interface MediaVoiceSource {
  bytes: Buffer;
  mime: 'audio/wav' | 'video/mp4';
  durationMs: number;
}

export interface TranscribeOptions {
  mode?: MediaTranscribeMode;
  languageBias?: string[];
  keywords?: string[];
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface ClipOptions {
  prompt?: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface VoiceOperationOptions {
  transcribeModel?: string;
  videoModel?: string;
  timeoutMs?: number;
}

const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_TURNS = 200;
const MAX_TURN_CHARS = 5_000;
const MAX_OBSERVATIONS = 8;
const MAX_OBSERVATION_CHARS = 500;

/**
 * Output budget for the clip request, sized from the schema it must satisfy.
 *
 * The first live attempt (2 Nov, `test-results/batchd-live/2026-11-02-0354`)
 * proved the budget was the limit rather than the model: the provider answered
 * `incomplete / max_output_tokens` with `output_tokens` exactly equal to the cap
 * the request asked for. A strict-schema answer may legitimately write
 * MAX_OBSERVATIONS observations of MAX_OBSERVATION_CHARS each, so the cap is
 * derived from those two numbers — at roughly four characters per token, plus the
 * array/field envelope, doubled for the whitespace and numbers a strict answer
 * actually spends — instead of being guessed once and never revisited.
 */
export const CLIP_MAX_OUTPUT_TOKENS =
  2 * Math.ceil((MAX_OBSERVATIONS * (MAX_OBSERVATION_CHARS + 24) + 256) / 4);
export { MAX_OBSERVATION_CHARS, MAX_OBSERVATIONS };

const FILE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

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

function bounded(message: string, limit = 300): string {
  return message.length <= limit ? message : `${message.slice(0, limit - 1)}…`;
}

function observedModelOf(body: string): string | null {
  const json = parseJsonObject(body);
  const value = json?.model;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 120);
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseTurn(raw: unknown, index: number, durationMs: number): MediaTranscriptTurn | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text = record.transcript ?? record.text;
  if (typeof text !== 'string' || text.length > MAX_TURN_CHARS) return null;
  if (!isSafeInt(record.startMs) || !isSafeInt(record.endMs)) return null;
  const start = record.startMs;
  const end = record.endMs;
  if (end < start) return null;
  if (end > durationMs + MEDIA_DURATION_TOLERANCE_MS) return null;
  const clampedEnd = Math.min(end, durationMs);
  const turn: MediaTranscriptTurn = {
    turn_id:
      typeof record.turnId === 'number' && Number.isSafeInteger(record.turnId) && record.turnId >= 0
        ? record.turnId
        : index,
    text,
    start_ms: start,
    end_ms: clampedEnd,
  };
  if (typeof record.speaker === 'string' && record.speaker.trim().length > 0) {
    turn.speaker = record.speaker.trim().slice(0, 8);
  }
  return turn;
}

/** Validate the buffered TranscribeResponse against measured source duration. */
export function parseTranscribeResponse(
  body: string,
  source: { sourceId: string; durationMs: number; model: string },
): MediaTranscript {
  const json = parseJsonObject(body);
  if (json === null) {
    throw new ProviderError(
      'provider_invalid_output',
      'Transcription response is not a JSON object.',
    );
  }
  if (json.type === 'error') {
    const message = typeof json.message === 'string' ? json.message : 'transcription refused';
    throw new ProviderError('provider_invalid_output', bounded(`Transcription error: ${message}`));
  }
  if (typeof json.transcript !== 'string') {
    throw new ProviderError(
      'provider_invalid_output',
      'Transcription response is missing a string `transcript`.',
    );
  }
  const transcript = json.transcript;
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new ProviderError(
      'provider_invalid_output',
      `Transcription is ${String(transcript.length)} chars, above the ${String(MAX_TRANSCRIPT_CHARS)}-char bound.`,
    );
  }
  let audioDuration: number | null = null;
  if (json.audioDurationMs !== undefined && json.audioDurationMs !== null) {
    if (
      typeof json.audioDurationMs !== 'number' ||
      !Number.isFinite(json.audioDurationMs) ||
      json.audioDurationMs < 0
    ) {
      throw new ProviderError(
        'provider_invalid_output',
        'Transcription audioDurationMs is not a non-negative number.',
      );
    }
    audioDuration = Math.round(json.audioDurationMs);
    if (Math.abs(audioDuration - source.durationMs) > MEDIA_DURATION_TOLERANCE_MS) {
      throw new ProviderError(
        'provider_invalid_output',
        `Transcription processed ${String(audioDuration)} ms but the uploaded file measures ${String(source.durationMs)} ms; refusing a mismatched result.`,
      );
    }
  }
  const turns: MediaTranscriptTurn[] = [];
  if (json.turns !== undefined) {
    if (!Array.isArray(json.turns)) {
      throw new ProviderError('provider_invalid_output', 'Transcription turns is not an array.');
    }
    if (json.turns.length > MAX_TURNS) {
      throw new ProviderError(
        'provider_invalid_output',
        `Transcription returned ${String(json.turns.length)} turns, above the ${String(MAX_TURNS)} bound.`,
      );
    }
    for (const [index, entry] of json.turns.entries()) {
      const turn = parseTurn(entry, index, source.durationMs);
      if (turn === null) {
        throw new ProviderError(
          'provider_invalid_output',
          `Transcription turn ${String(index)} has an invalid shape or timestamp outside 0..${String(source.durationMs)} ms.`,
        );
      }
      turns.push(turn);
    }
  }
  const sessionId =
    typeof json.sessionId === 'string' && json.sessionId.length > 0
      ? json.sessionId.slice(0, 200)
      : null;
  return {
    source_id: source.sourceId,
    transcript,
    turns,
    duration_ms: source.durationMs,
    audio_duration_ms: audioDuration,
    model: source.model,
    observed_model: observedModelOf(body),
    session_id: sessionId,
    provider_attempts: 1,
  };
}

const CLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observations'],
  properties: {
    observations: {
      type: 'array',
      maxItems: MAX_OBSERVATIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['observation', 'startMs', 'endMs', 'confidence'],
        properties: {
          observation: { type: 'string' },
          startMs: { type: 'integer', minimum: 0 },
          endMs: { type: 'integer', minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

function parseObservation(raw: unknown, durationMs: number): MediaClipObservation | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.observation !== 'string') return null;
  const observation = record.observation.trim();
  if (observation.length === 0 || observation.length > MAX_OBSERVATION_CHARS) return null;
  if (!isSafeInt(record.startMs) || !isSafeInt(record.endMs)) return null;
  if (record.endMs < record.startMs) return null;
  if (record.endMs > durationMs + MEDIA_DURATION_TOLERANCE_MS) return null;
  if (
    typeof record.confidence !== 'number' ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return null;
  }
  return {
    observation,
    start_ms: record.startMs,
    end_ms: Math.min(record.endMs, durationMs),
    confidence: record.confidence,
  };
}

/** Validate the structured Responses output for a clip. */
export function parseClipResponse(
  body: string,
  source: { sourceId: string; durationMs: number; model: string; fileId: string | null },
): MediaClipResponse {
  const envelope = parseResponsesEnvelope(body, 'video');
  if (!envelope.ok || envelope.output === null) {
    throw new ProviderError(
      'provider_invalid_output',
      bounded(`Clip understanding failed: ${envelope.summary} ${envelope.error ?? ''}`),
    );
  }
  const { texts, refusals } = collectOutputParts(envelope.output);
  if (refusals.length > 0) {
    throw new ProviderError(
      'provider_invalid_output',
      bounded(`Clip understanding refused: ${refusals[0]?.text ?? 'refused'}`),
    );
  }
  const raw = texts
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (raw.length === 0) {
    throw new ProviderError('provider_invalid_output', 'Clip understanding returned no text.');
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new ProviderError(
      'provider_invalid_output',
      `Clip understanding did not return observation JSON: ${bounded(raw, 200)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderError('provider_invalid_output', 'Clip observation JSON is not an object.');
  }
  const list = (parsed as Record<string, unknown>).observations;
  if (!Array.isArray(list)) {
    throw new ProviderError(
      'provider_invalid_output',
      'Clip observation JSON has no observations[].',
    );
  }
  if (list.length > MAX_OBSERVATIONS) {
    throw new ProviderError(
      'provider_invalid_output',
      `Clip returned ${String(list.length)} observations, above the ${String(MAX_OBSERVATIONS)} bound.`,
    );
  }
  const observations: MediaClipObservation[] = [];
  for (const [index, entry] of list.entries()) {
    const observation = parseObservation(entry, source.durationMs);
    if (observation === null) {
      throw new ProviderError(
        'provider_invalid_output',
        `Clip observation ${String(index)} has an invalid shape or timestamp outside 0..${String(source.durationMs)} ms.`,
      );
    }
    observations.push(observation);
  }
  return {
    source_id: source.sourceId,
    duration_ms: source.durationMs,
    observations,
    model: source.model,
    observed_model: observedModelOf(body),
    provider_attempts: 1,
    file_id: source.fileId,
  };
}

export class MediaVoice {
  private readonly transcribeModel: string;
  private readonly videoModel: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly adapter: MediaAdapter,
    options: VoiceOperationOptions = {},
  ) {
    this.transcribeModel = options.transcribeModel?.trim()
      ? options.transcribeModel.trim()
      : DEFAULT_TRANSCRIBE_MODEL;
    this.videoModel = options.videoModel?.trim() ? options.videoModel.trim() : DEFAULT_VIDEO_MODEL;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  get configured(): boolean {
    return this.adapter.configured;
  }

  get models(): { transcribe: string; video: string } {
    return { transcribe: this.transcribeModel, video: this.videoModel };
  }

  async transcribe(
    sourceId: string,
    source: MediaVoiceSource,
    options: TranscribeOptions = {},
  ): Promise<MediaTranscript> {
    if (source.mime !== 'audio/wav') {
      throw new ProviderError(
        'invalid_request',
        `Transcription requires audio/wav, not ${source.mime}.`,
      );
    }
    const mode = options.mode ?? 'PUSH_TO_TALK';
    const request: Record<string, unknown> = {
      model: this.transcribeModel,
      audioEncoding: 'WAV',
      mode,
    };
    if (options.languageBias !== undefined && options.languageBias.length > 0) {
      request.languageBias = options.languageBias.slice(0, 4);
    }
    if (options.keywords !== undefined && options.keywords.length > 0) {
      request.keywords = options.keywords.slice(0, 20);
    }
    const form = new FormData();
    form.append('request', JSON.stringify(request));
    form.append(
      'audio',
      new Blob([new Uint8Array(source.bytes)], { type: 'audio/wav' }),
      'recording.wav',
    );
    const passthrough: MediaRequestOptions = {
      rawBody: form,
      // The model rides inside the multipart `request` part, so nothing in a JSON
      // body names it. Without this the ledger writes `model=(none)` for a call
      // this service decided to make — the KI-61 defect in another operation.
      traceModel: this.transcribeModel,
      timeoutMs: this.timeoutMs,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
    };
    const result = await this.adapter.call('/v1/asr/transcribe', {}, passthrough);
    const transcript = parseTranscribeResponse(result.body, {
      sourceId,
      durationMs: source.durationMs,
      model: this.transcribeModel,
    });
    return { ...transcript, provider_attempts: result.attempts };
  }

  async understandClip(
    sourceId: string,
    source: MediaVoiceSource,
    options: ClipOptions = {},
  ): Promise<MediaClipResponse> {
    if (source.mime !== 'video/mp4') {
      throw new ProviderError(
        'invalid_request',
        `Clip understanding requires video/mp4, not ${source.mime}.`,
      );
    }
    const uploadForm = new FormData();
    uploadForm.append('purpose', 'user_data');
    uploadForm.append(
      'file',
      new Blob([new Uint8Array(source.bytes)], { type: 'video/mp4' }),
      'clip.mp4',
    );
    const upload = await this.adapter.call(
      '/v1/files',
      {},
      {
        rawBody: uploadForm,
        timeoutMs: this.timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.idempotencyKey !== undefined
          ? { idempotencyKey: `${options.idempotencyKey}-upload` }
          : {}),
      },
    );
    const uploaded = parseJsonObject(upload.body);
    const fileId = uploaded?.id;
    if (typeof fileId !== 'string' || !FILE_ID_PATTERN.test(fileId)) {
      throw new ProviderError(
        'provider_invalid_output',
        'File upload response did not carry a bounded file id.',
      );
    }

    const focus =
      options.prompt !== undefined && options.prompt.trim().length > 0
        ? ` Focus on: ${options.prompt.trim().slice(0, 500)}.`
        : '';
    const prompt =
      `Watch this ${(source.durationMs / 1000).toFixed(1)}s clip and return up to ${String(
        MAX_OBSERVATIONS,
      )} concrete observations about what is shown.${focus}` +
      ' Each observation must cite a start and end time in milliseconds inside the clip.' +
      ' Only state what the clip supports; do not infer requirements or unsupported behavior.';

    const result = await this.adapter.call(
      '/v1/responses',
      {
        model: this.videoModel,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_file', file_id: fileId },
            ],
          },
        ],
        max_output_tokens: CLIP_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: 'json_schema',
            name: 'clip_observations',
            strict: true,
            schema: CLIP_SCHEMA,
          },
        },
      },
      {
        timeoutMs: this.timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      },
    );
    const clip = parseClipResponse(result.body, {
      sourceId,
      durationMs: source.durationMs,
      model: this.videoModel,
      fileId,
    });
    return {
      ...clip,
      provider_attempts: upload.attempts + result.attempts,
    };
  }
}
