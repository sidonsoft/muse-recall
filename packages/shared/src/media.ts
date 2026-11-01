import { z } from 'zod';
import { ForgeProjectIdSchema } from './forge.js';

/**
 * Media capability contracts (Batch A1).
 *
 * The server probes the Meta Model API for media features (image generation /
 * understanding, segmentation, transcription, video) and reports one status
 * per capability. Statuses are *observed*, never assumed:
 *
 * - `unconfigured` — no media API key is configured, so nothing was attempted.
 *   Probes return this instead of throwing; callers are never disabled by a
 *   missing key.
 * - `available` — the capability answered a capability-specific request
 *   whose result validated against the documented shape (parsed types, not
 *   key presence).
 * - `unverified` — the endpoint/model is reachable but the
 *   capability-specific input was not exercised (e.g. video reachability via
 *   a text-only turn: text inference works, video upload/decode/
 *   understanding untested). Never displayed as ready; a deliberate
 *   capability-specific test promotes this to `available`.
 * - `unavailable` — the endpoint reports the capability is not offered
 *   (unknown route / not implemented for the configured model).
 * - `failed` — credentials were rejected, or the probe errored transiently,
 *   or a 200 carried an invalid shape.
 *
 * Every string is length-bounded and every secret is redacted before it
 * reaches a record, so probe reports are safe to log, persist, and return
 * from the API.
 */

/** Media features the server can probe on the Meta Model API. */
export const MEDIA_CAPABILITIES = [
  'image-generate',
  'image-understand',
  'segment',
  'transcribe',
  'video',
] as const;
export const MediaCapabilityNameSchema = z.enum(MEDIA_CAPABILITIES);
export type MediaCapabilityName = z.infer<typeof MediaCapabilityNameSchema>;

export const MEDIA_CAPABILITY_STATUSES = [
  'unconfigured',
  'available',
  'unverified',
  'unavailable',
  'failed',
] as const;
export const MediaCapabilityStatusSchema = z.enum(MEDIA_CAPABILITY_STATUSES);
export type MediaCapabilityStatus = z.infer<typeof MediaCapabilityStatusSchema>;

export const MediaCapabilitySchema = z.object({
  capability: MediaCapabilityNameSchema,
  status: MediaCapabilityStatusSchema,
  /** Model the probe targeted or observed; null when nothing was attempted. */
  model: z.string().min(1).max(200).nullable(),
  /** Bounded, redacted human-readable note (shape summary or error). */
  detail: z.string().max(300).nullable(),
  /** Wall-clock duration of the probe in milliseconds; null when unattempted. */
  latency_ms: z.number().int().min(0).nullable(),
});
export type MediaCapability = z.infer<typeof MediaCapabilitySchema>;

export const MediaProbeReportSchema = z.object({
  probed_at: z.iso.datetime(),
  capabilities: z.array(MediaCapabilitySchema).length(MEDIA_CAPABILITIES.length),
});
export type MediaProbeReport = z.infer<typeof MediaProbeReportSchema>;

/**
 * Batch B — image asset, generation-job and upload contracts.
 *
 * These mirror the server-side media store records exactly (snake_case) so the
 * HTTP boundary can be validated with the same shape the store persists.
 * Bytes never travel in a version record: callers fetch the binary endpoint,
 * which re-verifies the sha256 before serving.
 */

export const MEDIA_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MediaMimeSchema = z.enum(MEDIA_MIME_TYPES);
export type MediaMimeName = z.infer<typeof MediaMimeSchema>;

export const MEDIA_IMAGE_SIZES = [
  '256x256',
  '512x512',
  '1024x1024',
  '1024x1536',
  '1536x1024',
] as const;
export const MediaImageSizeSchema = z.enum(MEDIA_IMAGE_SIZES);
export type MediaImageSize = z.infer<typeof MediaImageSizeSchema>;

/**
 * Documented default for the OpenAI-compatible image endpoints.
 *
 * This is the model the server targets when `FORGE_MEDIA_MODEL` is unset. It
 * is deliberately separate from the Studio coding model: `/v1/images/*` and
 * `/v1/chat/completions` do not accept the same model ids, and a coding model
 * sent to the images endpoint is rejected (or worse, silently substituted).
 */
export const DEFAULT_MEDIA_IMAGE_MODEL = 'muse-image-1.0';

export const MEDIA_ASSET_STATUSES = ['candidate', 'approved', 'rejected'] as const;
export const MediaAssetStatusSchema = z.enum(MEDIA_ASSET_STATUSES);
export type MediaAssetStatusName = z.infer<typeof MediaAssetStatusSchema>;

/** Maximum decoded upload bytes accepted by the media asset route. */
export const MEDIA_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
/** Base64 expansion of the decoded upload cap, plus URL-scheme prefix room. */
export const MEDIA_UPLOAD_MAX_BASE64_CHARS = Math.ceil(MEDIA_UPLOAD_MAX_BYTES / 3) * 4 + 64;
/** Route body limit: the base64 payload plus a bounded JSON envelope. */
export const MEDIA_UPLOAD_BODY_LIMIT_BYTES = MEDIA_UPLOAD_MAX_BASE64_CHARS + 16_384;

export const MediaSourceSchema = z
  .object({
    kind: z.enum(['prompt', 'upload', 'edit', 'segment']).optional(),
    text: z.string().max(2_000).optional(),
    job_id: z.uuid().optional(),
    /**
     * SAM cutout provenance: the concept described, the source-pixel box
     * the mask covered, and the mask raster dims. Present only when
     * `kind` is `segment`, so an approved cutout stays linked to the exact
     * match it was cut from.
     */
    segment: z
      .object({
        concept: z.string().min(1).max(120),
        box: z.object({
          x1: z.number().int().min(0),
          y1: z.number().int().min(0),
          x2: z.number().int().min(0),
          y2: z.number().int().min(0),
        }),
        confidence: z.number().min(0).max(1).optional(),
        mask_width: z.number().int().min(1),
        mask_height: z.number().int().min(1),
      })
      .optional(),
  })
  .nullable();

export const MediaModelSchema = z
  .object({
    provider: z.string().max(120).optional(),
    /** Model id the server explicitly requested (configured targeting). */
    model: z.string().max(120).optional(),
    /** Model id the provider reported in its response, when it reported one. */
    observed: z.string().max(120).optional(),
  })
  .nullable();

export const MediaUsageSchema = z
  .object({
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
    cost_usd: z.number().finite().min(0).optional(),
  })
  .nullable();
export type MediaUsage = z.infer<typeof MediaUsageSchema>;

export const MediaMemoryRefSchema = z.object({
  memory_id: z.string().min(1).max(256),
  revision: z.number().int().min(0).optional(),
});

export const MediaParentRefSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1),
  project_id: ForgeProjectIdSchema,
});

export const MediaVersionRecordSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1),
  project_id: ForgeProjectIdSchema,
  kind: z.literal('image'),
  mime: MediaMimeSchema,
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
  duration_ms: z.null(),
  byte_size: z.number().int().min(1).max(MEDIA_UPLOAD_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parent: MediaParentRefSchema.nullable(),
  source: MediaSourceSchema,
  job_id: z.uuid().nullable(),
  memory_refs: z.array(MediaMemoryRefSchema).max(50),
  model: MediaModelSchema,
  usage: MediaUsageSchema,
  status: MediaAssetStatusSchema,
  created_at: z.iso.datetime(),
});
export type MediaVersionRecordView = z.infer<typeof MediaVersionRecordSchema>;

export const MediaAssetSummarySchema = z.object({
  asset_id: z.uuid(),
  project_id: ForgeProjectIdSchema,
  kind: z.literal('image'),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  latest_version: z.number().int().min(1),
  version_count: z.number().int().min(1),
  approved_versions: z.array(z.number().int().min(1)),
});
export type MediaAssetSummaryView = z.infer<typeof MediaAssetSummarySchema>;

export const MediaAssetListSchema = z.object({ items: z.array(MediaAssetSummarySchema) });
export type MediaAssetList = z.infer<typeof MediaAssetListSchema>;

export const MediaVersionListSchema = z.object({ items: z.array(MediaVersionRecordSchema) });
export type MediaVersionList = z.infer<typeof MediaVersionListSchema>;

export const MEDIA_JOB_KINDS = ['generate', 'edit', 'upscale', 'describe'] as const;
export const MediaJobKindSchema = z.enum(MEDIA_JOB_KINDS);
export type MediaJobKindName = z.infer<typeof MediaJobKindSchema>;

export const MEDIA_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export const MediaJobStatusSchema = z.enum(MEDIA_JOB_STATUSES);
export type MediaJobStatusName = z.infer<typeof MediaJobStatusSchema>;

export const MediaJobResultSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const MediaJobSchema = z.object({
  id: z.uuid(),
  project_id: ForgeProjectIdSchema,
  kind: MediaJobKindSchema,
  status: MediaJobStatusSchema,
  generation: z.number().int().min(0),
  params: z.record(z.string(), z.unknown()),
  result: MediaJobResultSchema.nullable(),
  error: z.string().max(2_000).nullable(),
  logs: z.array(z.string()).max(200),
  created_at: z.iso.datetime(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
});
export type MediaJobView = z.infer<typeof MediaJobSchema>;
export type MediaJob = MediaJobView;

export const MediaJobListSchema = z.object({
  items: z.array(MediaJobSchema),
  issues: z
    .array(
      z.object({
        file: z.string(),
        project_id: z.string(),
        job_id: z.uuid().nullable(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type MediaJobList = z.infer<typeof MediaJobListSchema>;

export const MediaUploadRequestSchema = z.object({
  mime: MediaMimeSchema,
  /** Base64 (no data-URL prefix); the route rejects mismatched magic bytes. */
  data_base64: z.string().min(1).max(MEDIA_UPLOAD_MAX_BASE64_CHARS),
  source_text: z.string().max(2_000).optional(),
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;

export const MediaGenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  size: MediaImageSizeSchema.optional(),
});
export type MediaGenerateRequest = z.infer<typeof MediaGenerateRequestSchema>;

export const MediaEditRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  size: MediaImageSizeSchema.optional(),
  parent: z.object({
    asset_id: z.uuid(),
    version: z.number().int().min(1).optional(),
  }),
});
export type MediaEditRequest = z.infer<typeof MediaEditRequestSchema>;

/**
 * Batch C — visual references and SAM object extraction.
 *
 * Documented defaults for the Responses API models. Like the image model,
 * these are independent settings: the segmentation and vision endpoints do
 * not accept the Studio coding model ids.
 */
export const DEFAULT_SAM_MODEL = 'sam-3.1';
export const DEFAULT_VISION_MODEL = 'muse-spark-1.3';

/** Short noun-phrase concept prompt per the SAM prompting rules. */
export const MediaSegmentConceptSchema = z.string().min(1).max(120);

export const MediaSegmentRequestSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1).optional(),
  concept: MediaSegmentConceptSchema,
});
export type MediaSegmentRequest = z.infer<typeof MediaSegmentRequestSchema>;

export const MediaSegmentMatchSchema = z.object({
  /** Zero-based index into the segment session; used to save the cutout. */
  match_index: z.number().int().min(0),
  box: z.object({
    x1: z.number().int().min(0),
    y1: z.number().int().min(0),
    x2: z.number().int().min(0),
    y2: z.number().int().min(0),
  }),
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Downscaled overlay preview (PNG data URL): the source with the match
   * highlighted, so matches can be inspected without downloading masks.
   */
  preview_data_url: z.string().max(2_000_000),
});
export type MediaSegmentMatch = z.infer<typeof MediaSegmentMatchSchema>;

export const MediaSegmentResponseSchema = z.object({
  segment_id: z.uuid(),
  asset_id: z.uuid(),
  version: z.number().int().min(1),
  concept: z.string().min(1).max(120),
  /** Empty when SAM reports zero matches: valid, not an error. */
  matches: z.array(MediaSegmentMatchSchema).max(16),
  /**
   * Provider fetch dispatches for the SAM request, counted at the adapter
   * boundary (1 when retries are disabled). Lets acceptance harnesses
   * enforce exact call budgets instead of counting UI submissions.
   */
  provider_attempts: z.number().int().min(1),
  /**
   * Bounded streaming evidence: SSE events parsed from the `stream: true`
   * response, raw stream bytes received, and a hex sha256 over the exact
   * raw stream bytes. Lets reviewers verify what the provider sent
   * without retaining the full payload.
   */
  stream_events: z.number().int().min(0).optional(),
  stream_bytes: z.number().int().min(0).optional(),
  response_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /** `response.output_text.delta` events folded into the lane. */
  delta_events: z.number().int().min(0).optional(),
  /** Unknown SSE event types ignored for forward compatibility. */
  ignored_events: z.number().int().min(0).optional(),
});
export type MediaSegmentResponse = z.infer<typeof MediaSegmentResponseSchema>;

export const MediaCutoutRequestSchema = z.object({
  match_index: z.number().int().min(0),
});
export type MediaCutoutRequest = z.infer<typeof MediaCutoutRequestSchema>;

/** Memory types a reference image may suggest (style or requirements). */
export const MediaSuggestionKindSchema = z.enum(['preference', 'constraint', 'technical_decision']);
export type MediaSuggestionKind = z.infer<typeof MediaSuggestionKindSchema>;

export const MediaSuggestRequestSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1).optional(),
  /** Optional guidance for what to look for (style, palette, requirements). */
  guidance: z.string().min(1).max(500).optional(),
  count: z.number().int().min(1).max(5).default(3),
});
export type MediaSuggestRequest = z.infer<typeof MediaSuggestRequestSchema>;

export const MediaSuggestionSchema = z.object({
  type: MediaSuggestionKindSchema,
  content: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
});
export type MediaSuggestion = z.infer<typeof MediaSuggestionSchema>;

export const MediaSuggestResponseSchema = z.object({
  asset_id: z.uuid(),
  version: z.number().int().min(1),
  suggestions: z.array(MediaSuggestionSchema).max(5),
  /**
   * Provider fetch dispatches for the vision request, counted at the
   * adapter boundary (1 when retries are disabled).
   */
  provider_attempts: z.number().int().min(1),
});
export type MediaSuggestResponse = z.infer<typeof MediaSuggestResponseSchema>;

/**
 * Batch D — voice and video source contracts.
 *
 * These are SOURCE inputs, not embeddable app assets: the existing image
 * asset store (and its approval/embed/rollback contract) is unchanged. A
 * source record is an immutable, project-scoped upload whose bytes, MIME and
 * measured duration are validated before any provider call. Transcripts and
 * clip observations are proposals: nothing here writes project memory, and
 * nothing here starts a Forge generation job.
 *
 * Documented provider limits (dev.meta.ai, checked 1 November 2026):
 * - Muse Voice Transcribe accepts mono 16-bit PCM WAV at 16 kHz or 24 kHz,
 *   up to 10 minutes and 32 MB per request.
 * - Muse Spark video understanding accepts MP4 uploaded through the Files
 *   API (`purpose: "user_data"`) and referenced by `file_id`.
 *
 * The product bounds below are deliberately narrower than the transport
 * limits so a beta request stays inspectable and cheap.
 */

export const MEDIA_AUDIO_MIME_TYPES = ['audio/wav'] as const;
export const MediaAudioMimeSchema = z.enum(MEDIA_AUDIO_MIME_TYPES);
export type MediaAudioMime = z.infer<typeof MediaAudioMimeSchema>;

export const MEDIA_VIDEO_MIME_TYPES = ['video/mp4'] as const;
export const MediaVideoMimeSchema = z.enum(MEDIA_VIDEO_MIME_TYPES);
export type MediaVideoMime = z.infer<typeof MediaVideoMimeSchema>;

export const MEDIA_SOURCE_MIME_TYPES = [
  ...MEDIA_AUDIO_MIME_TYPES,
  ...MEDIA_VIDEO_MIME_TYPES,
] as const;
export const MediaSourceMimeSchema = z.enum(MEDIA_SOURCE_MIME_TYPES);
export type MediaSourceMime = z.infer<typeof MediaSourceMimeSchema>;

export const MEDIA_SOURCE_KINDS = ['audio', 'video'] as const;
export const MediaSourceKindSchema = z.enum(MEDIA_SOURCE_KINDS);
export type MediaSourceKindName = z.infer<typeof MediaSourceKindSchema>;

export const MEDIA_SOURCE_ORIGINS = ['upload', 'recording'] as const;
export const MediaSourceOriginSchema = z.enum(MEDIA_SOURCE_ORIGINS);
export type MediaSourceOriginName = z.infer<typeof MediaSourceOriginSchema>;

/** Decoded byte caps for stored sources (strictly below provider caps). */
export const MEDIA_AUDIO_MAX_BYTES = 16 * 1024 * 1024;
export const MEDIA_VIDEO_MAX_BYTES = 32 * 1024 * 1024;
/** Base64 expansion plus a bounded JSON envelope for the upload route. */
export const MEDIA_AUDIO_MAX_BASE64_CHARS = Math.ceil(MEDIA_AUDIO_MAX_BYTES / 3) * 4 + 64;
export const MEDIA_VIDEO_MAX_BASE64_CHARS = Math.ceil(MEDIA_VIDEO_MAX_BYTES / 3) * 4 + 64;
export const MEDIA_AUDIO_UPLOAD_BODY_LIMIT_BYTES = MEDIA_AUDIO_MAX_BASE64_CHARS + 16_384;
export const MEDIA_VIDEO_UPLOAD_BODY_LIMIT_BYTES = MEDIA_VIDEO_MAX_BASE64_CHARS + 16_384;

/** Product duration bounds for one beta request. */
export const MEDIA_AUDIO_MAX_DURATION_MS = 3 * 60_000;
export const MEDIA_VIDEO_MAX_DURATION_MS = 30_000;
/** Provider-reported duration drift tolerated against the measured file. */
export const MEDIA_DURATION_TOLERANCE_MS = 1_000;

export function mediaSourceKindForMime(mime: MediaSourceMime): MediaSourceKindName {
  return (MEDIA_AUDIO_MIME_TYPES as readonly string[]).includes(mime) ? 'audio' : 'video';
}

export function mediaSourceMaxBytes(kind: MediaSourceKindName): number {
  return kind === 'audio' ? MEDIA_AUDIO_MAX_BYTES : MEDIA_VIDEO_MAX_BYTES;
}

export function mediaSourceMaxDurationMs(kind: MediaSourceKindName): number {
  return kind === 'audio' ? MEDIA_AUDIO_MAX_DURATION_MS : MEDIA_VIDEO_MAX_DURATION_MS;
}

export const MediaSourceRecordSchema = z.object({
  source_id: z.uuid(),
  project_id: ForgeProjectIdSchema,
  kind: MediaSourceKindSchema,
  mime: MediaSourceMimeSchema,
  duration_ms: z.number().int().min(1).max(600_000),
  byte_size: z.number().int().min(1).max(MEDIA_VIDEO_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  origin: MediaSourceOriginSchema,
  original_name: z.string().max(120).nullable(),
  created_at: z.iso.datetime(),
});
export type MediaSourceRecordView = z.infer<typeof MediaSourceRecordSchema>;

export const MediaSourceListSchema = z.object({
  items: z.array(MediaSourceRecordSchema).max(200),
});
export type MediaSourceList = z.infer<typeof MediaSourceListSchema>;

export const MediaSourceUploadRequestSchema = z.object({
  mime: MediaSourceMimeSchema,
  /** Base64 (no data-URL prefix); magic bytes must agree with `mime`. */
  data_base64: z.string().min(1).max(MEDIA_VIDEO_MAX_BASE64_CHARS),
  origin: MediaSourceOriginSchema.default('upload'),
  original_name: z.string().max(120).optional(),
});
export type MediaSourceUploadRequest = z.infer<typeof MediaSourceUploadRequestSchema>;

export const MEDIA_TRANSCRIBE_MODES = ['PUSH_TO_TALK', 'ENDPOINTING', 'DIARIZATION'] as const;
export const MediaTranscribeModeSchema = z.enum(MEDIA_TRANSCRIBE_MODES);
export type MediaTranscribeMode = z.infer<typeof MediaTranscribeModeSchema>;

/** Documented Muse Voice Transcribe default model. */
export const DEFAULT_TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';
/** Documented Muse Spark model used for video understanding. */
export const DEFAULT_VIDEO_MODEL = 'muse-spark-1.3';

export const MediaTranscribeRequestSchema = z.object({
  mode: MediaTranscribeModeSchema.default('PUSH_TO_TALK'),
  /** Documented language hints; the model still detects language itself. */
  language_bias: z.array(z.string().min(1).max(40)).max(4).default([]),
  /** Vocabulary biasing terms (product names, acronyms). */
  keywords: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type MediaTranscribeRequest = z.infer<typeof MediaTranscribeRequestSchema>;

export const MediaTranscriptTurnSchema = z.object({
  turn_id: z.number().int().min(0).max(10_000),
  text: z.string().max(5_000),
  start_ms: z.number().int().min(0).max(600_000),
  end_ms: z.number().int().min(0).max(600_000),
  speaker: z.string().min(1).max(8).optional(),
});
export type MediaTranscriptTurn = z.infer<typeof MediaTranscriptTurnSchema>;

export const MediaTranscriptSchema = z.object({
  source_id: z.uuid(),
  transcript: z.string().max(20_000),
  turns: z.array(MediaTranscriptTurnSchema).max(200),
  /** Duration measured from the uploaded file, not from the provider. */
  duration_ms: z.number().int().min(1).max(600_000),
  /** Duration the provider reported processing, when it reported one. */
  audio_duration_ms: z.number().int().min(0).max(600_000).nullable(),
  model: z.string().min(1).max(120),
  observed_model: z.string().min(1).max(120).nullable(),
  session_id: z.string().min(1).max(200).nullable(),
  provider_attempts: z.number().int().min(1),
});
export type MediaTranscript = z.infer<typeof MediaTranscriptSchema>;

export const MediaClipRequestSchema = z.object({
  /** Optional focus for the observations, e.g. "navigation and layout". */
  prompt: z.string().min(1).max(500).optional(),
});
export type MediaClipRequest = z.infer<typeof MediaClipRequestSchema>;

export const MediaClipObservationSchema = z.object({
  observation: z.string().min(1).max(500),
  start_ms: z.number().int().min(0).max(600_000),
  end_ms: z.number().int().min(0).max(600_000),
  confidence: z.number().min(0).max(1),
});
export type MediaClipObservation = z.infer<typeof MediaClipObservationSchema>;

export const MediaClipResponseSchema = z.object({
  source_id: z.uuid(),
  duration_ms: z.number().int().min(1).max(600_000),
  observations: z.array(MediaClipObservationSchema).max(8),
  model: z.string().min(1).max(120),
  observed_model: z.string().min(1).max(120).nullable(),
  provider_attempts: z.number().int().min(1),
  /** Bounded provider file id used for the clip; retained for inspection. */
  file_id: z.string().min(1).max(200).nullable(),
});
export type MediaClipResponse = z.infer<typeof MediaClipResponseSchema>;

/** Memory kinds a selected source observation may propose (never auto-accepted). */
export const MEDIA_PROPOSAL_MEMORY_TYPES = [
  'preference',
  'constraint',
  'technical_decision',
  'project',
  'goal',
] as const;
export const MediaProposalMemoryTypeSchema = z.enum(MEDIA_PROPOSAL_MEMORY_TYPES);
export type MediaProposalMemoryType = z.infer<typeof MediaProposalMemoryTypeSchema>;

export const MEDIA_PROPOSAL_KINDS = ['transcript', 'clip_observation'] as const;
export const MediaProposalKindSchema = z.enum(MEDIA_PROPOSAL_KINDS);
export type MediaProposalKind = z.infer<typeof MediaProposalKindSchema>;

export const MediaProposalItemSchema = z.object({
  kind: MediaProposalKindSchema,
  memory_type: MediaProposalMemoryTypeSchema,
  /** The user-edited text; always required, never inferred server-side. */
  content: z.string().min(1).max(2_000),
  start_ms: z.number().int().min(0).max(600_000).optional(),
  end_ms: z.number().int().min(0).max(600_000).optional(),
});
export type MediaProposalItem = z.infer<typeof MediaProposalItemSchema>;

export const MediaProposalRequestSchema = z.object({
  proposals: z.array(MediaProposalItemSchema).min(1).max(8),
});
export type MediaProposalRequest = z.infer<typeof MediaProposalRequestSchema>;

export const MediaProposalResultSchema = z.object({
  source_id: z.uuid(),
  proposed: z
    .array(
      z.object({
        memory_id: z.uuid(),
        content: z.string().max(2_000),
        memory_type: MediaProposalMemoryTypeSchema,
        reference: z.string().max(300),
        created: z.boolean(),
      }),
    )
    .max(8),
});
export type MediaProposalResult = z.infer<typeof MediaProposalResultSchema>;
