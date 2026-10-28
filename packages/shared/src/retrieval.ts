import { z } from 'zod';
import { MemorySchema, MemoryTypeSchema } from './memory.js';

/**
 * Retrieval contracts.
 *
 * The engine returns not just "these memories" but *why*: the component scores,
 * the budget outcome, and the counts needed to judge whether retrieval was
 * selective or merely exhaustive. A caller that cannot explain a retrieval
 * cannot defend an action taken because of it.
 */

/**
 * Retrieval budgets.
 *
 * These are configuration, not architecture: a deployment may raise them. The
 * defaults exist to keep a turn's context small enough to reason about.
 */
export const RetrievalBudgetSchema = z.object({
  /** Hard cap on how many memories may be selected. */
  max_memories: z.number().int().min(1).max(50).default(8),
  /**
   * Hard cap on the **rendered** memory context. Accounting includes HTML
   * escaping, provenance headers, delimiters, safety wording, and the
   * two-block layouts used by chat and Forge. Rendered output is never sliced
   * through an entity; records that do not fit are excluded.
   */
  max_characters: z.number().int().min(200).max(50_000).default(4_000),
  /** Per-memory raw-content cap; longer memories are truncated, not dropped. */
  max_memory_characters: z.number().int().min(100).max(8_000).default(1_000),
});
export type RetrievalBudget = z.infer<typeof RetrievalBudgetSchema>;

/** Defaults as constants so the UI and docs can quote the same numbers. */
export const DEFAULT_RETRIEVAL_BUDGET: RetrievalBudget = {
  max_memories: 8,
  max_characters: 4_000,
  max_memory_characters: 1_000,
};

/**
 * Ranking weights. Components are each normalised to [0, 1]; the final score
 * is their weighted sum. Weights are configurable so the benchmark can show
 * sensitivity, but the default is the documented design.
 */
export const RetrievalWeightsSchema = z.object({
  relevance: z.number().min(0).max(1).default(0.4),
  scope: z.number().min(0).max(1).default(0.2),
  confidence: z.number().min(0).max(1).default(0.15),
  validation: z.number().min(0).max(1).default(0.1),
  recency: z.number().min(0).max(1).default(0.1),
  type_priority: z.number().min(0).max(1).default(0.05),
});
export type RetrievalWeights = z.infer<typeof RetrievalWeightsSchema>;

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  relevance: 0.4,
  scope: 0.2,
  confidence: 0.15,
  validation: 0.1,
  recency: 0.1,
  type_priority: 0.05,
};

/** Per-component scores, each in [0, 1], explaining the final score. */
export const RankComponentsSchema = z.object({
  relevance: z.number().min(0).max(1),
  scope: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  validation: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  type_priority: z.number().min(0).max(1),
});
export type RankComponents = z.infer<typeof RankComponentsSchema>;

export const RetrievedMemorySchema = z.object({
  /** The full stored record, so the inspector can show provenance. */
  memory: MemorySchema,
  /** Exactly the text that would be injected into a prompt (possibly truncated). */
  injected_content: z.string(),
  /** True when `injected_content` is shorter than `memory.content`. */
  truncated: z.boolean(),
  /**
   * True when the memory was force-included because it is an active
   * constraint or goal, regardless of keyword relevance.
   */
  pinned: z.boolean(),
  /** Weighted total in [0, 1]. */
  score: z.number().min(0).max(1),
  rank_components: RankComponentsSchema,
  /** Human-readable justification, e.g. "keyword match + project scope + verified". */
  evidence: z.string().min(1),
});
export type RetrievedMemory = z.infer<typeof RetrievedMemorySchema>;

/** Why candidates were dropped. Counts, never content. */
export const RetrievalExclusionsSchema = z.object({
  count_budget: z.number().int().min(0),
  character_budget: z.number().int().min(0),
  duplicate: z.number().int().min(0),
});
export type RetrievalExclusions = z.infer<typeof RetrievalExclusionsSchema>;

export const RetrievalMetadataSchema = z.object({
  query: z.string(),
  project_id: z.string().nullable(),
  /** Memories that passed the hard scope/status filters. */
  candidate_count: z.number().int().min(0),
  selected_count: z.number().int().min(0),
  /** `candidate_count - selected_count`. */
  excluded_count: z.number().int().min(0),
  excluded_by: RetrievalExclusionsSchema,
  characters_used: z.number().int().min(0),
  character_budget: z.number().int().min(0),
  memory_budget: z.number().int().min(0),
  /** Memories whose injected text was shortened to fit the per-memory cap. */
  truncated_count: z.number().int().min(0),
  /** Ids only — the caller never receives the rejected content. */
  memory_ids: z.array(z.uuid()),
  latency_ms: z.number().min(0),
  weights: RetrievalWeightsSchema,
  /**
   * Which candidate strategy was used:
   * `precise` = all tokens required; `relaxed` = any token (precision was
   * starving the set); `fallback` = no keyword match at all, so recent active
   * memories in scope were used; `none` = no query text.
   */
  query_mode: z.enum(['precise', 'relaxed', 'fallback', 'none']).default('none'),
});
export type RetrievalMetadata = z.infer<typeof RetrievalMetadataSchema>;

export const RetrievalResultSchema = z.object({
  results: z.array(RetrievedMemorySchema),
  metadata: RetrievalMetadataSchema,
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

/** Retrieval request. Budget and weights are partial and filled to defaults. */
export const RetrievalRequestSchema = z.object({
  /** Scope to retrieve within. `null` means global memories only. */
  project_id: z.string().min(1).max(128).nullable().default(null),
  /**
   * Retrieval is called with the user's message, which may be long. The FTS
   * builder keeps only meaningful tokens, so the bound here matches the message
   * limit rather than the shape of a search box.
   */
  query: z.string().max(16_000).default(''),
  types: z.array(MemoryTypeSchema).max(10).optional(),
  include_global: z.boolean().default(true),
  budget: RetrievalBudgetSchema.partial().optional(),
  weights: RetrievalWeightsSchema.partial().optional(),
});
export type RetrievalRequest = z.input<typeof RetrievalRequestSchema>;

/**
 * The rendered prompt block plus its exact cost.
 *
 * Deliberately separate from retrieval: a caller may retrieve for display
 * without injecting anything, and the injected text is always accounted.
 */
export const MemoryContextSchema = z.object({
  text: z.string(),
  characters: z.number().int().min(0),
  /** Estimated tokens (~4 chars/token). Labelled as an estimate everywhere. */
  estimated_tokens: z.number().int().min(0),
  memory_ids: z.array(z.uuid()),
});
export type MemoryContext = z.infer<typeof MemoryContextSchema>;

/** Preview response: the ranking plus the exact prompt block it would produce. */
export const RetrievalPreviewSchema = z.object({
  retrieval: RetrievalResultSchema,
  context: MemoryContextSchema.optional(),
});
export type RetrievalPreview = z.infer<typeof RetrievalPreviewSchema>;
