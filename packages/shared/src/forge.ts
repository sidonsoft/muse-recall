import { z } from 'zod';

/**
 * Muse Forge contracts.
 *
 * A Forge project owns one generated browser application (`index.html`). Every
 * change is a job
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
  /**
   * The server stopped before this job reached a terminal state. Interrupted
   * jobs are never resumed automatically: the status is an explicit record
   * that the model run did not finish. Staged bytes are kept for inspection.
   */
  'interrupted',
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
 * Approval-time verification record for an approved artifact.
 *
 * Historical versions may lack this field entirely; that means "not recorded",
 * not "passed". Diagnostics are bounded and redacted before persistence.
 */
export const ForgeRuntimeBrowserSelectionSchema = z.object({
  policy: z.enum(['managed', 'chrome']),
  attempted: z.string().max(160),
  selected: z.string().max(160).nullable(),
  /** Bounded, redacted launch failure; null on success. */
  failure: z.string().max(300).nullable(),
});
export type ForgeRuntimeBrowserSelection = z.infer<typeof ForgeRuntimeBrowserSelectionSchema>;

export const ForgeRuntimeVerificationSchema = z.object({
  ok: z.boolean(),
  checked_at: z.iso.datetime(),
  /** sha256 of the exact bytes the browser loaded. */
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Browser identity/version when the checker could report it. */
  browser: z.string().max(160).nullable(),
  /** Explicit selection policy and bounded launch diagnostics. */
  browser_selection: ForgeRuntimeBrowserSelectionSchema.optional(),
  errors: z.array(z.string().max(300)).max(20),
});
export type ForgeRuntimeVerification = z.infer<typeof ForgeRuntimeVerificationSchema>;

export const ForgeApprovalVerificationSchema = z.object({
  syntax_structure: ForgeValidationSchema.nullable(),
  runtime: ForgeRuntimeVerificationSchema.nullable(),
  recorded_at: z.iso.datetime(),
});
export type ForgeApprovalVerification = z.infer<typeof ForgeApprovalVerificationSchema>;

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
  /**
   * Supported rules that applied to at least one evaluated decision. Missing
   * on historical snapshots; an empty array means no supported rule matched.
   */
  applicable_rules: z.array(DecisionGuardRuleSchema).max(16).optional(),
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
  /** Approval-time checks for this job, when it was approved by this build. */
  approval_verification: ForgeApprovalVerificationSchema.nullable().optional(),
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
  /** Approval-time checks recorded with this immutable version. */
  approval_verification: ForgeApprovalVerificationSchema.optional(),
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
  /**
   * Optional PNG data URL captured from the preview. When present it grounds a
   * visual change; when absent the request is applied from the approved source.
   * Decoded and size-capped server-side when supplied.
   */
  screenshot_data_url: z.string().min(100).max(8_000_000).optional(),
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

/**
 * Durable-job recovery report.
 *
 * Startup recovery is observable rather than silent: unreadable job records,
 * storage write failures, and jobs interrupted by a restart are reported to
 * the user instead of being presented as an empty project.
 */
export const FORGE_RECOVERY_ISSUE_CODES = [
  'job_unreadable',
  'job_invalid',
  'job_project_mismatch',
  'job_duplicate',
  'job_persist_failed',
  'job_store_unreadable',
  'job_interrupted',
  'staged_missing',
  'state_unreadable',
] as const;
export const ForgeRecoveryIssueCodeSchema = z.enum(FORGE_RECOVERY_ISSUE_CODES);
export type ForgeRecoveryIssueCode = z.infer<typeof ForgeRecoveryIssueCodeSchema>;

export const FORGE_RECOVERY_ISSUE_KINDS = ['startup', 'active'] as const;
export const ForgeRecoveryIssueKindSchema = z.enum(FORGE_RECOVERY_ISSUE_KINDS);
export type ForgeRecoveryIssueKind = z.infer<typeof ForgeRecoveryIssueKindSchema>;

export const FORGE_RECOVERY_ISSUE_SCOPES = ['store', 'project'] as const;
export const ForgeRecoveryIssueScopeSchema = z.enum(FORGE_RECOVERY_ISSUE_SCOPES);
export type ForgeRecoveryIssueScope = z.infer<typeof ForgeRecoveryIssueScopeSchema>;

export const ForgeRecoveryIssueSchema = z.object({
  /** Stable id used for acknowledgement; not a deletion tombstone. */
  id: z.string().min(1).max(400),
  kind: ForgeRecoveryIssueKindSchema,
  code: ForgeRecoveryIssueCodeSchema,
  /**
   * Explicit incident scope. A store-wide issue is visible in every project
   * view and may be acknowledged from any project. A project issue belongs to
   * exactly one project, even when that project's id is `forge` (which is also
   * the historical sentinel used by store-wide issues).
   *
   * Defaults to `project` for older clients; the server always sends it.
   */
  scope: ForgeRecoveryIssueScopeSchema.default('project'),
  /** Relative path inside the Forge workspace; never an absolute host path. */
  file: z.string().max(300),
  message: z.string().min(1).max(300),
  project_id: ForgeProjectIdSchema,
  job_id: z.uuid().nullable(),
});
export type ForgeRecoveryIssue = z.infer<typeof ForgeRecoveryIssueSchema>;

export const ForgeRecoveryStartupSchema = z.object({
  scanned_at: z.iso.datetime(),
  /** Jobs present when recovery ran; excludes jobs created later. */
  loaded_jobs: z.number().int().min(0),
  interrupted_jobs: z.number().int().min(0),
});
export type ForgeRecoveryStartup = z.infer<typeof ForgeRecoveryStartupSchema>;

/**
 * Jobs discovered by a later, explicit storage retry after an incomplete read
 * at startup. These are deliberately separate from the immutable startup
 * counts: a repaired directory can reveal records that the first scan could
 * not see.
 */
export const ForgeRecoveryLaterSchema = z.object({
  loaded_jobs: z.number().int().min(0),
  interrupted_jobs: z.number().int().min(0),
});
export type ForgeRecoveryLater = z.infer<typeof ForgeRecoveryLaterSchema>;

export const ForgeRecoveryStorageSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(300).nullable(),
  /** Healthy, project-scoped, root/store-wide, or both failures. */
  scope: z.enum(['healthy', 'project', 'store', 'both']),
  /** Independent results from a health check or startup read. */
  root_ok: z.boolean(),
  root_error: z.string().max(300).nullable(),
  project_ok: z.boolean().nullable(),
  project_error: z.string().max(300).nullable(),
});
export type ForgeRecoveryStorage = z.infer<typeof ForgeRecoveryStorageSchema>;

export const ForgeRecoveryReportSchema = z.object({
  /** Immutable statistics from the startup recovery pass. */
  startup: ForgeRecoveryStartupSchema,
  /** Jobs first discovered by a later storage retry, never counted as startup. */
  later_recovery: ForgeRecoveryLaterSchema.default({ loaded_jobs: 0, interrupted_jobs: 0 }),
  /** Current in-memory job counts, for display only. */
  current_jobs: z.number().int().min(0),
  current_interrupted_jobs: z.number().int().min(0),
  /** Unacknowledged historical incidents plus active storage failures. */
  issues: z.array(ForgeRecoveryIssueSchema).max(50),
  /** Historical incidents hidden by acknowledgement. */
  acknowledged_issues: z.number().int().min(0),
  storage: ForgeRecoveryStorageSchema,
});
export type ForgeRecoveryReport = z.infer<typeof ForgeRecoveryReportSchema>;

export const ForgeRecoveryAckSchema = z.object({
  issue_ids: z.array(z.string().min(1).max(400)).min(1).max(50),
});

export const ForgeJobListSchema = z.object({ items: z.array(ForgeJobSchema) });
export const ForgeApprovalResultSchema = z.object({
  job: ForgeJobSchema,
  state: ForgeStateSchema,
});
export type ForgeApprovalResult = z.infer<typeof ForgeApprovalResultSchema>;
export const ForgeProjectViewSchema = z.object({
  state: ForgeStateSchema,
  jobs: z.array(ForgeJobSchema),
  /**
   * Optional for old persisted fixtures and third-party clients; the server
   * always sends it. A missing report must not be read as "all clear".
   */
  recovery: ForgeRecoveryReportSchema.optional(),
});
export type ForgeProjectView = z.infer<typeof ForgeProjectViewSchema>;

/**
 * One inspectable HTML artifact: the approved version, or the staged file for
 * a review job. The exact bytes are returned for source inspection, export,
 * and integrity display; nothing here is executed by the application.
 */
export const ForgeArtifactSchema = z.object({
  project_id: ForgeProjectIdSchema,
  job_id: z.uuid().nullable(),
  version: z.number().int().min(1).nullable(),
  staged: z.boolean(),
  artifact_type: z.literal('html'),
  title: z.string().min(1).max(160),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  html: z.string(),
});
export type ForgeArtifact = z.infer<typeof ForgeArtifactSchema>;
