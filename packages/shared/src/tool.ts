import { z } from 'zod';

/**
 * Tool-call contracts.
 *
 * A tool call is a first-class, auditable record: validated arguments, an
 * explicit side-effect class, a decision, a result, and timing. The model can
 * *request* a call; only the runtime decides whether it runs.
 */

export const TOOL_SIDE_EFFECTS = ['read', 'write'] as const;
export const ToolSideEffectSchema = z.enum(TOOL_SIDE_EFFECTS);
export type ToolSideEffect = z.infer<typeof ToolSideEffectSchema>;

export const TOOL_CALL_STATUSES = ['pending', 'executed', 'failed', 'denied', 'invalid'] as const;
export const ToolCallStatusSchema = z.enum(TOOL_CALL_STATUSES);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

/** A tool as advertised to the model and to the interface. */
export const ToolInfoSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  side_effect: ToolSideEffectSchema,
  requires_confirmation: z.boolean(),
  input_schema: z.record(z.string(), z.unknown()),
});
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

/**
 * Version of the shared tool contract (gap G-5 / roadmap §4).
 *
 * Every surface that exposes the tool set — the session runtime, `GET
 * /api/tools`, and the MCP server — stamps this version. It bumps only on
 * breaking changes to tool identity, argument meaning, or side-effect
 * semantics; conformance tests pin the surfaces against one registry.
 */
export const TOOL_CONTRACT_VERSION = '1';

export const ToolListSchema = z.object({
  items: z.array(ToolInfoSchema),
  contract_version: z.string().default(TOOL_CONTRACT_VERSION),
});
export type ToolList = z.infer<typeof ToolListSchema>;

export const ToolCallSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  /** The assistant message this call was decided for, when known. */
  message_id: z.uuid().nullable(),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  status: ToolCallStatusSchema,
  requires_confirmation: z.boolean(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().min(0).nullable(),
  created_at: z.iso.datetime(),
  decided_at: z.iso.datetime().nullable(),
  executed_at: z.iso.datetime().nullable(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolCallListSchema = z.object({ items: z.array(ToolCallSchema) });
export type ToolCallList = z.infer<typeof ToolCallListSchema>;

export const ToolDecisionInputSchema = z.object({
  decision: z.enum(['approve', 'deny']),
});
export type ToolDecisionInput = z.infer<typeof ToolDecisionInputSchema>;

/** Result of deciding on a pending call. */
export const ToolDecisionResultSchema = z.object({
  call: ToolCallSchema,
  /** Present when approval triggered a follow-up agent turn. */
  turn: z.unknown().nullable(),
});
export type ToolDecisionResult = z.infer<typeof ToolDecisionResultSchema>;
