import { z } from 'zod';

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
