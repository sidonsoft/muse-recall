import { z } from 'zod';

/**
 * Muse Forge contracts.
 *
 * A Forge project owns one generated game (`index.html`). Every change is a job
 * that writes into a staging copy; only an explicit approval promotes it to an
 * immutable version.
 */

export const FORGE_PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const ForgeProjectIdSchema = z
  .string()
  .regex(FORGE_PROJECT_ID_PATTERN, 'invalid project id');

export const FORGE_JOB_KINDS = ['generate', 'modify'] as const;
export const ForgeJobKindSchema = z.enum(FORGE_JOB_KINDS);
export type ForgeJobKind = z.infer<typeof ForgeJobKindSchema>;

export const FORGE_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'budget_exceeded',
  'rejected',
] as const;
export const ForgeJobStatusSchema = z.enum(FORGE_JOB_STATUSES);
export type ForgeJobStatus = z.infer<typeof ForgeJobStatusSchema>;

export const ForgeUsageSchema = z.object({
  calls: z.number().int().min(0),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  runtime_ms: z.number().int().min(0),
});
export type ForgeUsage = z.infer<typeof ForgeUsageSchema>;

export const ForgeValidationSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()),
});
export type ForgeValidation = z.infer<typeof ForgeValidationSchema>;

export const ForgeJobSchema = z.object({
  id: z.uuid(),
  project_id: ForgeProjectIdSchema,
  kind: ForgeJobKindSchema,
  status: ForgeJobStatusSchema,
  prompt: z.string(),
  request: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.iso.datetime(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
  logs: z.array(z.string()),
  usage: ForgeUsageSchema.nullable(),
  memory_ids: z.array(z.uuid()),
  base_version: z.number().int().min(1).nullable(),
  /** sha256 of the exact prompt sent to the model, when known. */
  prompt_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  validation: ForgeValidationSchema.nullable(),
  version: z.number().int().min(1).nullable(),
});
export type ForgeJob = z.infer<typeof ForgeJobSchema>;

export const ForgeVersionSchema = z.object({
  version: z.number().int().min(1),
  created_at: z.iso.datetime(),
  summary: z.string(),
  /** Version this change was based on; null for an initial generation. */
  base_version: z.number().int().min(1).nullable().optional(),
  job_id: z.uuid().nullable().optional(),
  /** Integrity hash of the approved file. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type ForgeVersion = z.infer<typeof ForgeVersionSchema>;

export const ForgeStateSchema = z.object({
  project_id: ForgeProjectIdSchema,
  current_version: z.number().int().min(1).nullable(),
  versions: z.array(ForgeVersionSchema),
  can_rollback: z.boolean(),
});
export type ForgeState = z.infer<typeof ForgeStateSchema>;

export const ForgeFileDiffSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
  diff: z.string(),
});
export type ForgeFileDiff = z.infer<typeof ForgeFileDiffSchema>;

export const ForgeDiffSchema = z.object({
  job_id: z.uuid(),
  summary: z.string(),
  files: z.array(ForgeFileDiffSchema),
  validation: ForgeValidationSchema,
});
export type ForgeDiff = z.infer<typeof ForgeDiffSchema>;

export const ForgeCreateProjectSchema = z.object({
  project_id: ForgeProjectIdSchema,
  name: z.string().min(1).max(120).optional(),
});

export const ForgeGenerateSchema = z.object({
  prompt: z.string().min(10).max(4_000),
});

export const ForgeModifySchema = z.object({
  request: z.string().min(3).max(2_000),
  /** PNG data URL captured from the preview; decoded and size-capped server-side. */
  screenshot_data_url: z.string().min(100).max(8_000_000),
  capture_memory: z.boolean().default(false),
});

export const ForgeApproveSchema = z.object({
  capture_memory: z.boolean().default(false),
  decision: z.string().max(500).optional(),
});

export const ForgeRollbackSchema = z.object({});

export const ForgeJobListSchema = z.object({ items: z.array(ForgeJobSchema) });
export const ForgeApprovalResultSchema = z.object({
  job: ForgeJobSchema,
  state: ForgeStateSchema,
});
export type ForgeApprovalResult = z.infer<typeof ForgeApprovalResultSchema>;
export const ForgeProjectViewSchema = z.object({
  state: ForgeStateSchema,
  jobs: z.array(ForgeJobSchema),
});
export type ForgeProjectView = z.infer<typeof ForgeProjectViewSchema>;
