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
  /**
   * Media provider configuration actually in force: image, SAM, and
   * vision models plus the transport retry budget. Recorded so live
   * acceptance evidence cites effective settings, never hard-coded
   * defaults.
   */
  media: z.object({
    image_model: z.string(),
    sam_model: z.string(),
    vision_model: z.string(),
    // The voice and video models belong in the contract, not just in the response:
    // a live run has to name which model it paid, and a client typed from this
    // schema could not read them before. `max_retries` is the call-budget knob the
    // same runs assert on.
    transcribe_model: z.string(),
    video_model: z.string(),
    max_retries: z.number().int().min(0),
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
    /**
     * Which trust model is enforcing access right now: the loopback bind
     * itself, or a shared bearer token (gap G-6 groundwork). One shared
     * secret is authentication without identity — the mode says so.
     */
    authentication: z.enum(['loopback-only', 'shared-token']).default('loopback-only'),
  }),
  /** Pointer to the machine-readable error catalogue (GET /api/errors). */
  errors: z
    .object({
      catalog_version: z.number().int(),
      endpoint: z.literal('/api/errors'),
    })
    .optional(),
  /**
   * Build provenance baked into the bundle at build time: the source
   * commit and content hash the running code was built from. Null when
   * the bundle was built without identity (dev/tsx). Acceptance
   * harnesses compare this against the build manifest so a stale
   * production build fails closed instead of running untested code.
   */
  build: z
    .object({
      commit: z.string(),
      source_hash: z.string(),
      built_at: z.string(),
    })
    .nullable(),
});
export type ServiceMeta = z.infer<typeof ServiceMetaSchema>;
