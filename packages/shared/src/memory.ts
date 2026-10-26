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
export const MEMORY_STATUSES = ['active', 'superseded', 'deleted', 'expired'] as const;
export const MemoryStatusSchema = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

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

/** Update an existing memory in place. Lifecycle fields are deliberately absent. */
export const MemoryUpdateInputSchema = z.object({
  content: z.string().min(1).max(8_000).optional(),
  confidence: ConfidenceSchema.optional(),
  validation_status: ValidationStatusSchema.optional(),
  tags: z.array(TagSchema).max(16).optional(),
  expires_at: z.iso.datetime().nullable().optional(),
});
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>;

/**
 * A correction supersedes one or more memories with new content.
 * The old records are retained with `status = 'superseded'`.
 */
export const MemoryCorrectionInputSchema = z.object({
  supersedes: z.array(z.uuid()).min(1, 'a correction must supersede at least one memory'),
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema.default('project'),
  project_id: z.string().min(1).max(128).nullable().default(null),
  content: z.string().min(1).max(8_000),
  source: MemorySourceSchema.default({ session_id: null, reference: null }),
  confidence: ConfidenceSchema.default(0.9),
  validation_status: ValidationStatusSchema.default('verified'),
  tags: z.array(TagSchema).max(16).default([]),
});
export type MemoryCorrectionInput = z.infer<typeof MemoryCorrectionInputSchema>;

/** Query filters for the inspector and for retrieval. */
export const MemoryQuerySchema = z.object({
  project_id: z.string().min(1).max(128).nullable().default(null),
  include_global: z.boolean().default(true),
  status: z.array(MemoryStatusSchema).default(['active']),
  types: z.array(MemoryTypeSchema).optional(),
  text: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;

/** One audit entry per lifecycle transition. Append-only. */
export const MemoryHistoryEntrySchema = z.object({
  id: z.uuid(),
  memory_id: z.uuid(),
  action: z.enum(['created', 'updated', 'superseded', 'deleted', 'expired', 'purged']),
  previous_status: MemoryStatusSchema.nullable(),
  next_status: MemoryStatusSchema,
  /** Human-readable reason, e.g. "user corrected the target platform". */
  reason: z.string().max(1_000).nullable(),
  actor: z.enum(['user', 'agent', 'system']),
  at: z.iso.datetime(),
});
export type MemoryHistoryEntry = z.infer<typeof MemoryHistoryEntrySchema>;
