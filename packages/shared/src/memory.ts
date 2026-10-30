import { z } from 'zod';

/**
 * Memory taxonomy.
 *
 * These are the categories the memory engine curates. They are deliberately
 * *typed* rather than free-form: retrieval ranking, deduplication, and the
 * inspector UI all branch on them.
 */
export const MEMORY_TYPES = [
  'preference',
  'project',
  'technical_decision',
  'constraint',
  'verified_solution',
  'failed_approach',
  'unfinished_task',
  'goal',
  'correction',
  'contextual_fact',
] as const;

export const MemoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

/**
 * Scope decides who a memory is visible to.
 *
 * - `global`  — applies to every project (e.g. a user's language preference).
 * - `project` — only retrieved while working inside `project_id`.
 */
export const MEMORY_SCOPES = ['global', 'project'] as const;
export const MemoryScopeSchema = z.enum(MEMORY_SCOPES);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

/**
 * Validation status answers "how much should this be trusted as a fact?".
 * It is orthogonal to `status`, which answers "is this still current?".
 */
export const VALIDATION_STATUSES = ['unverified', 'verified', 'disputed'] as const;
export const ValidationStatusSchema = z.enum(VALIDATION_STATUSES);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

/**
 * Lifecycle status.
 *
 * `superseded` is *not* deletion: the record is retained as auditable history
 * and must never be presented as a current fact. `deleted` is a soft delete
 * that removes the row from every retrieval index; `expired` is applied by
 * retention policy. Hard deletion (`purge`) removes the bytes entirely.
 */
// `proposed` is a candidate that has not been accepted yet: it never enters
// retrieval or the default inspector list. Accepting promotes it to `active`
// (history action `accepted`); rejecting soft-deletes it (history action
// `rejected`). Roadmap §6 chose a lifecycle state over a separate proposal
// table so candidates share id space, history, and supersession edges while
// staying out of established facts (see DECISIONS.md D038).
export const MEMORY_STATUSES = ['proposed', 'active', 'superseded', 'deleted', 'expired'] as const;
export const MemoryStatusSchema = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

/**
 * Who performed a lifecycle operation. Recorded per transition on history
 * entries and, at the record level, as the actor of the latest change.
 */
export const MEMORY_ACTORS = ['user', 'agent', 'system'] as const;
export const MemoryActorSchema = z.enum(MEMORY_ACTORS);
export type MemoryActor = z.infer<typeof MemoryActorSchema>;

/**
 * Where a memory came from. Provenance is mandatory in spirit: a memory
 * without a traceable origin cannot be audited, so both fields are nullable
 * but always present.
 */
export const MemorySourceSchema = z.object({
  session_id: z.string().min(1).nullable().default(null),
  reference: z.string().min(1).nullable().default(null),
});
export type MemorySource = z.infer<typeof MemorySourceSchema>;

/** Confidence is a probability, not a vibe. Clamped to [0, 1]. */
export const ConfidenceSchema = z.number().min(0).max(1);

export const TagSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'tags are lowercase kebab-case');

export const MemorySchema = z.object({
  id: z.uuid(),
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema,
  project_id: z.string().min(1).nullable(),
  content: z.string().min(1).max(8_000),
  source: MemorySourceSchema,
  confidence: ConfidenceSchema,
  validation_status: ValidationStatusSchema,
  status: MemoryStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  expires_at: z.iso.datetime().nullable(),
  /** Ids of memories this record replaced. */
  supersedes: z.array(z.uuid()),
  /** The record that replaced this one, when superseded. */
  superseded_by: z.uuid().nullable(),
  tags: z.array(TagSchema),
  /**
   * Monotonic edit counter (roadmap §6 record contract). Every in-place
   * change — field update, supersession flip, expiry, proposal transition —
   * increments it. Callers can guard concurrent edits by sending
   * `expected_revision`; a mismatch is a conflict, never a silent overwrite.
   */
  revision: z.number().int().min(1),
  /** Actor of the most recent change to this record (see history for all). */
  actor: MemoryActorSchema,
});
export type Memory = z.infer<typeof MemorySchema>;

/**
 * Fields a caller may supply when remembering something. The engine owns
 * ids, timestamps, and lifecycle transitions.
 */
export const MemoryCreateInputSchema = z
  .object({
    type: MemoryTypeSchema,
    scope: MemoryScopeSchema.default('project'),
    project_id: z.string().min(1).max(128).nullable().default(null),
    content: z.string().min(1).max(8_000),
    source: MemorySourceSchema.default({ session_id: null, reference: null }),
    confidence: ConfidenceSchema.default(0.7),
    validation_status: ValidationStatusSchema.default('unverified'),
    expires_at: z.iso.datetime().nullable().default(null),
    tags: z.array(TagSchema).max(16).default([]),
  })
  .refine((value) => (value.scope === 'project' ? value.project_id !== null : true), {
    message: 'project-scoped memories require a project_id',
    path: ['project_id'],
  });
export type MemoryCreateInput = z.infer<typeof MemoryCreateInputSchema>;
/** Looser input shape: fields with defaults may be omitted by callers. */
export type MemoryCreateRequest = z.input<typeof MemoryCreateInputSchema>;

/** Update an existing memory in place. Lifecycle fields are deliberately absent. */
export const MemoryUpdateInputSchema = z.object({
  content: z.string().min(1).max(8_000).optional(),
  confidence: ConfidenceSchema.optional(),
  validation_status: ValidationStatusSchema.optional(),
  tags: z.array(TagSchema).max(16).optional(),
  expires_at: z.iso.datetime().nullable().optional(),
  /**
   * Optional optimistic-concurrency guard. When present, the engine only
   * applies the update if the record is still at this revision; otherwise it
   * fails with `memory_conflict` and the record's current revision.
   */
  expected_revision: z.number().int().min(1).optional(),
});
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>;

/**
 * A correction supersedes one or more memories with new content.
 * The old records are retained with `status = 'superseded'`.
 */
/**
 * Fields shared by "correct a memory" requests.
 *
 * Split out so the HTTP layer can accept the path id as an implicit target
 * while the engine still requires an explicit, non-empty `supersedes` list.
 */
export const MemoryCorrectionFieldsSchema = z.object({
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema.default('project'),
  project_id: z.string().min(1).max(128).nullable().default(null),
  content: z.string().min(1).max(8_000),
  source: MemorySourceSchema.default({ session_id: null, reference: null }),
  confidence: ConfidenceSchema.default(0.9),
  validation_status: ValidationStatusSchema.default('verified'),
  tags: z.array(TagSchema).max(16).default([]),
  /** Why the correction was made; stored in the superseded record's history. */
  reason: z.string().max(1_000).optional(),
});

const requireProjectForProjectScope = (value: { scope: MemoryScope; project_id: string | null }) =>
  value.scope === 'project' ? value.project_id !== null : true;

export const MemoryCorrectionInputSchema = MemoryCorrectionFieldsSchema.extend({
  supersedes: z.array(z.uuid()).min(1, 'a correction must supersede at least one memory'),
}).refine(requireProjectForProjectScope, {
  message: 'project-scoped memories require a project_id',
  path: ['project_id'],
});
export type MemoryCorrectionInput = z.infer<typeof MemoryCorrectionInputSchema>;

/**
 * HTTP correction body.
 *
 * `supersedes` is optional because the addressed memory is always a target;
 * additional ids may be supplied to replace several records at once.
 */
export const MemoryCorrectionRequestSchema = MemoryCorrectionFieldsSchema.extend({
  supersedes: z.array(z.uuid()).max(20).optional(),
}).refine(requireProjectForProjectScope, {
  message: 'project-scoped memories require a project_id',
  path: ['project_id'],
});
export type MemoryCorrectionRequest = z.infer<typeof MemoryCorrectionRequestSchema>;
export type MemoryCorrectionRequestInput = z.input<typeof MemoryCorrectionRequestSchema>;

/**
 * Result of a create call.
 *
 * `created` is false when an identical memory already existed and was returned
 * instead of inserting a duplicate — the same idempotency guarantee the API
 * relies on for retried requests.
 */
export const MemoryCreateResultSchema = z.object({
  memory: MemorySchema,
  created: z.boolean(),
});
export type MemoryCreateResult = z.infer<typeof MemoryCreateResultSchema>;

/** Query filters for the inspector and for retrieval. */
export const MemoryQuerySchema = z.object({
  project_id: z.string().min(1).max(128).nullable().default(null),
  include_global: z.boolean().default(true),
  /**
   * Inspector convenience: ignore scope entirely and list across projects.
   * Retrieval deliberately has no equivalent — prompts are always scoped.
   */
  all_projects: z.boolean().default(false),
  /**
   * Lifecycle filters. `deleted` is accepted for completeness but the engine
   * never returns deleted content — deletion is final from the API's point of
   * view. Use it only to assert that guarantee in tests.
   */
  status: z.array(MemoryStatusSchema).default(['active']),
  types: z.array(MemoryTypeSchema).optional(),
  text: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;

/**
 * Review queue (roadmap §7 / gap G-9 first slice).
 *
 * The queue is DERIVED, never a stored state machine: a memory is in the
 * queue when it needs a human decision — an unverified or disputed claim, or
 * a claim whose expiry has passed or is about to. Expiry is computed against
 * the moment of the request, so nothing goes stale between reads.
 */
export const REVIEW_HORIZON_DAYS_DEFAULT = 7;
export const REVIEW_HORIZON_DAYS_MAX = 365;

export const REVIEW_REASONS = ['unverified', 'disputed', 'expired', 'expiring'] as const;
export const ReviewReasonSchema = z.enum(REVIEW_REASONS);
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;

export const ReviewItemSchema = z.object({
  memory: MemorySchema,
  reasons: z.array(ReviewReasonSchema).min(1),
  days_until_expiry: z.number().int().nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewQueueQuerySchema = z.object({
  /** A named project always scopes the queue; without one it spans projects. */
  project_id: z.string().min(1).max(128).nullable().default(null),
  /** Kept for parity with the inspector query surface; scoping is decided by project_id. */
  all_projects: z.boolean().default(false),
  horizon_days: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_HORIZON_DAYS_MAX)
    .default(REVIEW_HORIZON_DAYS_DEFAULT),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuerySchema>;

export const ReviewQueueSchema = z.object({
  items: z.array(ReviewItemSchema),
  total: z.number().int().min(0),
  horizon_days: z.number().int().min(0),
});
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

/** One audit entry per lifecycle transition. Append-only. */
export const MemoryHistoryEntrySchema = z.object({
  id: z.uuid(),
  memory_id: z.uuid(),
  // `accepted` promotes a proposal to active; `rejected` tombstones it.
  action: z.enum([
    'created',
    'updated',
    'superseded',
    'deleted',
    'expired',
    'purged',
    'accepted',
    'rejected',
  ]),
  previous_status: MemoryStatusSchema.nullable(),
  next_status: MemoryStatusSchema,
  /** Human-readable reason, e.g. "user corrected the target platform". */
  reason: z.string().max(1_000).nullable(),
  actor: MemoryActorSchema,
  at: z.iso.datetime(),
});
export type MemoryHistoryEntry = z.infer<typeof MemoryHistoryEntrySchema>;

/** Paged list response for the inspector. `total` counts all matching rows. */
export const MemoryListResponseSchema = z.object({
  items: z.array(MemorySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

/**
 * Everything needed to audit one memory: the record, its provenance, the
 * records it replaced, the record that replaced it, and the full history.
 */
export const MemoryDetailSchema = z.object({
  memory: MemorySchema,
  history: z.array(MemoryHistoryEntrySchema),
  /** Memories this record superseded (older facts it replaced). */
  supersedes: z.array(MemorySchema),
  /** The active record that replaced this one, when this one is superseded. */
  superseded_by: MemorySchema.nullable(),
});
export type MemoryDetail = z.infer<typeof MemoryDetailSchema>;

/**
 * Outcome of a correction.
 *
 * `created` is false when the correction was idempotent — the content already
 * existed as the current fact — so a retried request cannot create a
 * duplicate chain.
 */
export const MemoryCorrectionResultSchema = z.object({
  memory: MemorySchema,
  superseded: z.array(MemorySchema),
  created: z.boolean(),
});
export type MemoryCorrectionResult = z.infer<typeof MemoryCorrectionResultSchema>;

/** Aggregate counts for the inspector header and the benchmark. */
export const MemoryStatsSchema = z.object({
  total: z.number().int().min(0),
  /** Candidates awaiting a decision; never counted as current facts. */
  proposed: z.number().int().min(0),
  active: z.number().int().min(0),
  superseded: z.number().int().min(0),
  expired: z.number().int().min(0),
  deleted: z.number().int().min(0),
  /** Only types that actually occur, so a stats read never demands all ten. */
  by_type: z.partialRecord(MemoryTypeSchema, z.number().int().min(0)),
});
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;

/** A project, used only as a memory scope anchor in Phase 2. */
export const ProjectSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1),
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;
