import { z } from 'zod';

export const ServiceStatusSchema = z.enum(['ok', 'degraded', 'error']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ComponentStatusSchema = z.enum(['ok', 'degraded', 'error', 'skipped']);
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

/**
 * A single dependency check.
 *
 * `detail` is written for a human debugging a demo five minutes before
 * submission, so it states what was actually observed.
 */
export const ComponentCheckSchema = z.object({
  status: ComponentStatusSchema,
  detail: z.string(),
  latency_ms: z.number().int().min(0).nullable(),
});
export type ComponentCheck = z.infer<typeof ComponentCheckSchema>;

/**
 * Provider health, including whether a *real* round-trip succeeded.
 * This is what separates a liveness ping from an integration check.
 */
export const ProviderCheckSchema = ComponentCheckSchema.extend({
  provider_id: z.string(),
  provider_name: z.string(),
  model: z.string().nullable(),
  /** True only when a real model call returned in this process. */
  verified_with_live_call: z.boolean(),
  capabilities: z
    .object({
      streaming: z.boolean(),
      tool_calling: z.boolean(),
      structured_output: z.boolean(),
      max_context_tokens: z.number().int().positive(),
    })
    .nullable(),
});
export type ProviderCheck = z.infer<typeof ProviderCheckSchema>;

export const DatabaseCheckSchema = ComponentCheckSchema.extend({
  engine: z.string(),
  path: z.string(),
  /** Schema version currently applied, from the migration table. */
  schema_version: z.number().int().min(0),
  /** True when a real write/read/rollback round-trip succeeded. */
  write_verified: z.boolean(),
});
export type DatabaseCheck = z.infer<typeof DatabaseCheckSchema>;

export const HealthResponseSchema = z.object({
  status: ServiceStatusSchema,
  service: z.literal('muse-memory-lab'),
  version: z.string(),
  environment: z.string(),
  uptime_seconds: z.number().min(0),
  timestamp: z.iso.datetime(),
  database: DatabaseCheckSchema,
  provider: ProviderCheckSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Response for the lightweight liveness probe, used by CI and the UI. */
export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
