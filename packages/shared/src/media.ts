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
 * - `available` — the capability answered a lightweight probe.
 * - `unavailable` — the endpoint reports the capability is not offered
 *   (unknown route / not implemented for the configured model).
 * - `failed` — credentials were rejected, or the probe errored transiently.
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
