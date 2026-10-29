import { z } from 'zod';
import { ModelCapabilitiesSchema } from './provider.js';
import { RetrievalBudgetSchema, RetrievalWeightsSchema } from './retrieval.js';

/**
 * Build-status vocabulary.
 *
 * The UI renders this so a reviewer can never mistake a schema for a feature.
 * `schema_only` means the tables exist but no engine API uses them yet.
 */
export const ModuleStatusSchema = z.enum(['not_implemented', 'schema_only', 'partial', 'complete']);
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;

export const ServiceMetaSchema = z.object({
  service: z.literal('muse-memory-lab'),
  version: z.string(),
  environment: z.string(),
  /** Delivery phase from the build brief. */
  phase: z.number().int().min(1),
  /** General conversation provider (chat/provider bench). */
  provider: z.object({
    id: z.string(),
    name: z.string(),
    configured_model: z.string().nullable(),
    capabilities: ModelCapabilitiesSchema,
  }),
  /**
   * HTML Studio generation configuration. This is separate from the chat
   * provider: Forge may use a different CLI model. `observed_model` is only
   * populated from execution telemetry; null means it was not recorded.
   */
  forge: z.object({
    provider: z.string(),
    configured_model: z.string().nullable(),
    observed_model: z.string().nullable(),
    /** False when the generation CLI is not installed, so generation cannot start. */
    cli_available: z.boolean().optional(),
  }),
  modules: z.object({
    memory_engine: ModuleStatusSchema,
    agent_runtime: ModuleStatusSchema,
    muse_integration: ModuleStatusSchema,
    ui_protocol: ModuleStatusSchema,
    agent_tools: ModuleStatusSchema,
    evaluation: ModuleStatusSchema,
  }),
  /** Retrieval configuration in force for this install, for the inspector. */
  memory: z.object({
    default_budget: RetrievalBudgetSchema,
    weights: RetrievalWeightsSchema,
  }),
  safety: z.object({
    tool_approval_policy: z.enum(['always', 'never']),
    /** Whether generated UI may ever execute model-authored code. */
    generated_code_execution: z.literal(false),
  }),
});
export type ServiceMeta = z.infer<typeof ServiceMetaSchema>;
