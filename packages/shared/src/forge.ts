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

/**
 * Phase 12C — Decision Guard advisory contract.
 *
 * Decision Guard is ADVISORY ONLY in this version. `engine_verdict` is the
 * pure engine's own aggregate and is never wired into `validation.ok`; the
 * server keeps it separate so no client can mistake an advisory finding for a
 * blocking validation error. Findings carry untrusted source excerpts, so every
 * string is length-bounded and the review UI renders them as text only.
 */

export const DECISION_GUARD_VERDICTS = ['PASS', 'BLOCK', 'UNVERIFIED'] as const;
export const DecisionGuardVerdictSchema = z.enum(DECISION_GUARD_VERDICTS);
export type DecisionGuardVerdict = z.infer<typeof DecisionGuardVerdictSchema>;

/**
 * Reviewer-facing assessment. This is deliberately not a score and not a
 * compliance certificate:
 *
 * - `violation_detected` — at least one supported check reported a finding.
 * - `no_violation_detected` — every recorded decision matched a supported
 *   check, all of those checks passed, and no limitation was recorded. This
 *   says nothing about constraints outside the supported rule set, or about
 *   aspects of a decision that no rule linked to.
 * - `not_verified` — at least one constraint or decision could not be checked.
 * - `evaluation_unavailable` — the engine did not complete, so no result exists.
 */
export const DECISION_GUARD_ASSESSMENTS = [
  'violation_detected',
  'no_violation_detected',
  'not_verified',
  'evaluation_unavailable',
] as const;
export const DecisionGuardAssessmentSchema = z.enum(DECISION_GUARD_ASSESSMENTS);
export type DecisionGuardAssessment = z.infer<typeof DecisionGuardAssessmentSchema>;

export const DECISION_GUARD_UNVERIFIED_CODES = [
  'memory_unresolved',
  'cross_project',
  'global_scope',
  'decision_not_active',
  'superseded_unresolved',
  'rule_unverified',
  'unsupported_decision',
  'input_warning',
  'no_decisions',
  'decision_limit_exceeded',
  'truncated',
  'internal_error',
] as const;
export const DecisionGuardUnverifiedCodeSchema = z.enum(DECISION_GUARD_UNVERIFIED_CODES);
export type DecisionGuardUnverifiedCode = z.infer<typeof DecisionGuardUnverifiedCodeSchema>;

/** Stable, bounded rule identifier from the engine (e.g. `mistake-penalty`). */
export const DecisionGuardRuleSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'rule ids are lowercase kebab-case');

export const DecisionGuardFindingSchema = z.object({
  kind: z.literal('violation'),
  decision_id: z.uuid(),
  /** Readable, bounded decision reference (excerpt, never the full record). */
  decision_ref: z.string().min(1).max(160),
  rule: DecisionGuardRuleSchema,
  severity: z.enum(['high', 'medium']),
  /** Untrusted staged-source excerpt; rendered as text, never as markup. */
  evidence: z.string().max(240),
  explanation: z.string().max(400),
});
export type DecisionGuardFinding = z.infer<typeof DecisionGuardFindingSchema>;

export const DecisionGuardUnverifiedSchema = z.object({
  kind: z.literal('unverified'),
  /** Null when the limitation is about the decision set, not one decision. */
  decision_id: z.uuid().nullable(),
  decision_ref: z.string().max(160),
  rule: DecisionGuardRuleSchema,
  severity: z.null(),
  code: DecisionGuardUnverifiedCodeSchema,
  reason: z.string().min(1).max(400),
});
export type DecisionGuardUnverified = z.infer<typeof DecisionGuardUnverifiedSchema>;

export const DecisionGuardAdvisorySchema = z.object({
  mode: z.literal('advisory'),
  engine_version: z.string().min(1).max(32),
  /** Advisory aggregate from the pure engine. Never used for authorisation. */
  engine_verdict: DecisionGuardVerdictSchema,
  /** Explicit reviewer-facing distinction; never an authorisation signal. */
  assessment: DecisionGuardAssessmentSchema.default('not_verified'),
  /** Bounded explanation of the assessment, including its limits. */
  assessment_reason: z
    .string()
    .max(400)
    .default('No verified assessment is available for this snapshot.'),
  findings: z.array(DecisionGuardFindingSchema).max(32),
  unverified: z.array(DecisionGuardUnverifiedSchema).max(32),
  /** Active decisions passed to the engine — the auditable decision set. */
  evaluated_memory_ids: z.array(z.uuid()).max(32),
  /** Superseded decisions resolved separately for correction rules. */
  superseded_memory_ids: z.array(z.uuid()).max(32),
  /** sha256 of the exact staged source that was evaluated. */
  source_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  /** True when the snapshot was (re)computed after the blocking runtime check. */
  runtime_verified: z.boolean(),
  evaluated_at: z.iso.datetime(),
});
export type DecisionGuardAdvisory = z.infer<typeof DecisionGuardAdvisorySchema>;

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
  /**
   * Phase 12C advisory snapshot. Deliberately separate from `validation`:
   * it is recorded for review and never blocks approval.
   */
  decision_guard: DecisionGuardAdvisorySchema.nullable().default(null),
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
  decision_guard: DecisionGuardAdvisorySchema.nullable().default(null),
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

/**
 * Approval body.
 *
 * `decision` is the user's own statement of the decision being saved. When
 * `capture_memory` is set it is required and must not be blank: a model's
 * terminal summary is never promoted into a verified creative decision.
 */
export const ForgeApproveSchema = z
  .object({
    capture_memory: z.boolean().default(false),
    decision: z.string().trim().max(500).optional(),
  })
  .refine((value) => !value.capture_memory || (value.decision ?? '').length > 0, {
    message: 'decision must be a non-empty user-provided statement when capture_memory is true',
    path: ['decision'],
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
