import { MemorySchema, TurnResultSchema } from '@mml/shared';
import { z } from 'zod';
import { FieldValueSchema, type UiSurface, UiSurfaceSchema } from './schema.js';

/**
 * HTTP-facing surface records.
 *
 * Stored separately from the spec so the transcript can reference a surface by
 * id and the submission history stays append-only.
 */

export const UI_SURFACE_STATUSES = ['active', 'submitted', 'dismissed'] as const;
export const UiSurfaceStatusSchema = z.enum(UI_SURFACE_STATUSES);
export type UiSurfaceStatus = z.infer<typeof UiSurfaceStatusSchema>;

export const UiEventSchema = z.object({
  id: z.uuid(),
  surface_id: z.uuid(),
  action_id: z.string(),
  values: z.record(z.string(), FieldValueSchema),
  created_at: z.iso.datetime(),
});
export type UiEvent = z.infer<typeof UiEventSchema>;

export const UiSurfaceRecordSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  message_id: z.uuid().nullable(),
  title: z.string(),
  spec: UiSurfaceSchema,
  status: UiSurfaceStatusSchema,
  created_at: z.iso.datetime(),
  submitted_at: z.iso.datetime().nullable(),
  events: z.array(UiEventSchema),
});
export type UiSurfaceRecord = z.infer<typeof UiSurfaceRecordSchema>;

export const GenerateUiInputSchema = z.object({
  /** What the interface should help the user do. */
  intent: z.string().min(3).max(500),
});
export type GenerateUiInput = z.input<typeof GenerateUiInputSchema>;

export const UiSurfaceListSchema = z.object({
  items: z.array(UiSurfaceRecordSchema),
});
export type UiSurfaceList = z.infer<typeof UiSurfaceListSchema>;

export const SubmitUiInputSchema = z.object({
  action_id: z.string().min(1).max(64).optional(),
  values: z.record(z.string(), FieldValueSchema),
});
export type SubmitUiInput = z.input<typeof SubmitUiInputSchema>;

/** Generation is a bounded, validated call — never a free-form code request. */
export const UiGenerationResultSchema = z.object({
  surface: UiSurfaceRecordSchema,
  model: z.string(),
  latency_ms: z.number().min(0),
});
export type UiGenerationResult = z.infer<typeof UiGenerationResultSchema>;

export function parseStoredSurface(raw: unknown): UiSurface {
  return UiSurfaceSchema.parse(raw);
}

/** Result of submitting an interface: the event, the optional memory, and the agent's continuation. */
export const UiSubmissionResultSchema = z.object({
  surface: UiSurfaceRecordSchema,
  memory: MemorySchema.nullable(),
  turn: TurnResultSchema,
});
export type UiSubmissionResult = z.infer<typeof UiSubmissionResultSchema>;
