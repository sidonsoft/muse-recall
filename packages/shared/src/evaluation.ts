import { z } from 'zod';
import { MemoryCreateInputSchema } from './memory.js';
import { RetrievalBudgetSchema } from './retrieval.js';

/**
 * Evaluation contracts.
 *
 * Phase 2 defines the interface and a working runner, but does **not** publish
 * a Muse comparison: no memory-enabled-versus-baseline result exists yet, and
 * none may be claimed until the Phase 6 runs actually happen.
 */

export const EvaluationTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The user's request, identical across configurations. */
  prompt: z.string().min(1),
  /** Project the task happens in, used for memory scoping. */
  project_id: z.string().min(1).nullable().default(null),
  /** Memories seeded before the run (the "initial conditions"). */
  seed_memories: z.array(MemoryCreateInputSchema).default([]),
  /** Memories a correct retrieval should surface, by seed index or content. */
  expected_memory_contents: z.array(z.string()).default([]),
  /** Facts the final answer should contain (case-insensitive substring checks). */
  expected_facts: z.array(z.string()).default([]),
  /** Facts that must NOT appear, e.g. a superseded decision. */
  forbidden_facts: z.array(z.string()).default([]),
});
export type EvaluationTask = z.infer<typeof EvaluationTaskSchema>;

export const EvaluationConfigurationSchema = z.object({
  id: z.enum(['baseline', 'memory-enabled']),
  memory_enabled: z.boolean(),
  retrieval_budget: RetrievalBudgetSchema.partial().optional(),
});
export type EvaluationConfiguration = z.infer<typeof EvaluationConfigurationSchema>;

/**
 * One recorded run. `usage` is provider-reported; when a provider reports no
 * usage the field stays zero and `usage_available` is false — never estimated
 * into the record as if it were billed.
 */
export const EvaluationRunSchema = z.object({
  task_id: z.string().min(1),
  configuration_id: z.enum(['baseline', 'memory-enabled']),
  provider_id: z.string().min(1),
  model: z.string().nullable(),
  started_at: z.iso.datetime(),
  duration_ms: z.number().min(0),
  output_text: z.string(),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  usage_available: z.boolean(),
  retrieved_memory_ids: z.array(z.uuid()),
  retrieved_characters: z.number().int().min(0),
  /** Null when the run failed before producing an answer. */
  success: z.boolean().nullable(),
  notes: z.string().nullable(),
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export const EvaluationComparisonSchema = z.object({
  task_id: z.string().min(1),
  baseline: EvaluationRunSchema,
  memory_enabled: EvaluationRunSchema,
  input_token_delta: z.number().int(),
  output_token_delta: z.number().int(),
  duration_delta_ms: z.number(),
  /** True only when both runs reported provider usage. */
  token_comparison_valid: z.boolean(),
});
export type EvaluationComparison = z.infer<typeof EvaluationComparisonSchema>;

export const DEFAULT_EVALUATION_CONFIGURATIONS: EvaluationConfiguration[] = [
  { id: 'baseline', memory_enabled: false },
  { id: 'memory-enabled', memory_enabled: true },
];
