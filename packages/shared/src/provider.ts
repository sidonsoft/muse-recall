import { z } from 'zod';

/**
 * Model provider abstraction.
 *
 * The application never talks to a model vendor directly: it talks to this
 * interface. That keeps the agent harness, memory engine, and UI protocol
 * independent of whichever backend is in play, and lets the evaluation
 * harness swap a real provider for a deterministic one.
 */

export const ModelRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelMessageSchema = z.object({
  role: ModelRoleSchema,
  content: z.string().min(1),
});
export type ModelMessage = z.infer<typeof ModelMessageSchema>;

/** What a provider can actually do. Never assumed, always reported. */
export const ModelCapabilitiesSchema = z.object({
  /** Incremental token streaming. */
  streaming: z.boolean(),
  /** Provider-native tool/function calling. */
  tool_calling: z.boolean(),
  /** Constrained JSON output via a caller-supplied schema. */
  structured_output: z.boolean(),
  /** True when the provider can continue a provider-side session. */
  provider_sessions: z.boolean(),
  max_context_tokens: z.number().int().positive(),
  models: z.array(z.string()).min(1),
  notes: z.array(z.string()).default([]),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelRequestSchema = z.object({
  messages: z.array(ModelMessageSchema).min(1),
  model: z.string().min(1).optional(),
  /** Sampling temperature. Omitted when the provider does not support it. */
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(200_000).optional(),
  /** JSON Schema the final text must satisfy, when structured output is used. */
  response_schema: z.record(z.string(), z.unknown()).optional(),
  /** Opaque correlation data echoed back in logs and telemetry. */
  metadata: z.record(z.string(), z.string()).optional(),
});
export type ModelRequest = z.input<typeof ModelRequestSchema>;

export const TokenUsageSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cached_input_tokens: z.number().int().min(0).default(0),
  reasoning_tokens: z.number().int().min(0).default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const StopReasonSchema = z.enum([
  'completed',
  'max_tokens',
  'stop_sequence',
  'tool_calls',
  'cancelled',
  'error',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const ModelResponseSchema = z.object({
  text: z.string(),
  model: z.string().min(1),
  provider: z.string().min(1),
  stop_reason: StopReasonSchema,
  usage: TokenUsageSchema,
  /** Wall-clock duration of the call in milliseconds. */
  latency_ms: z.number().int().min(0),
});
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export const PROVIDER_ERROR_CODES = [
  /** Binary missing or not executable. */
  'provider_unavailable',
  /** Called but rejected (auth, quota, region). */
  'provider_auth_failed',
  /** Exceeded the configured wall-clock budget. */
  'provider_timeout',
  /** Cancelled by the caller through an AbortSignal. */
  'provider_cancelled',
  /** Exited non-zero without a usable terminal event. */
  'provider_crashed',
  /** Non-empty output that failed schema validation. */
  'provider_invalid_output',
  /** Bad request constructed by us — a bug, not a provider fault. */
  'invalid_request',
] as const;
export const ProviderErrorCodeSchema = z.enum(PROVIDER_ERROR_CODES);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

/** Streaming events. Discriminated so consumers must handle the terminal event. */
export const ModelEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('reasoning_delta'), text: z.string() }),
  z.object({ type: z.literal('usage'), usage: TokenUsageSchema }),
  z.object({
    type: z.literal('completed'),
    text: z.string(),
    model: z.string(),
    stop_reason: StopReasonSchema,
    latency_ms: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('error'),
    code: ProviderErrorCodeSchema,
    message: z.string(),
  }),
]);
export type ModelEvent = z.infer<typeof ModelEventSchema>;

/**
 * Per-call options. Kept outside `ModelRequest` because a signal is runtime
 * state, not part of the serialisable request a provider may log or replay.
 */
export interface ModelCallOptions {
  /** Cooperative cancellation. Providers must stop work and return promptly. */
  signal?: AbortSignal;
}

/**
 * The contract each provider implements.
 *
 * `stream` is optional: a provider that cannot stream may still be usable.
 * Callers must consult `capabilities()` rather than assuming either way.
 */
export interface ModelProvider {
  /** Stable identifier, e.g. `muse-cli`. */
  readonly id: string;
  /** Human-readable name for the UI. */
  readonly name: string;

  capabilities(): ModelCapabilities;

  generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse>;

  stream?(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelEvent>;
}
