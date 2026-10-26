import { MemoryTypeSchema } from '@mml/shared';
import { z } from 'zod';

/**
 * Declarative UI specification.
 *
 * The model never produces markup or code. It produces this document, which is
 * validated against a closed schema and rendered by a fixed component
 * registry. Anything outside the registry is a validation failure, not a
 * fallback to raw HTML.
 */

export const MAX_BLOCKS = 10;
export const MAX_FIELDS = 10;
export const MAX_OPTIONS = 12;
export const MAX_TABLE_ROWS = 30;

const Identifier = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'use lowercase snake_case identifiers');

const Label = z.string().min(1).max(120);
const ShortText = z.string().min(1).max(200);

/** Free text shown to the user. No markup is interpreted. */
const PlainText = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !/[<>]/.test(value), 'plain text only; markup is not part of the protocol');

export const FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'number',
  'checkbox',
] as const;
export const FieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldOptionSchema = z.object({
  value: z.string().min(1).max(80),
  label: Label,
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const UiFieldSchema = z
  .object({
    id: Identifier,
    label: Label,
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    placeholder: z.string().max(160).optional(),
    help: z.string().max(300).optional(),
    options: z.array(FieldOptionSchema).min(1).max(MAX_OPTIONS).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    max_length: z.number().int().min(1).max(4_000).optional(),
  })
  .superRefine((field, context) => {
    const needsOptions = field.type === 'select' || field.type === 'multiselect';
    if (needsOptions && (!field.options || field.options.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: `${field.type} fields require options`,
      });
    }
    if (!needsOptions && field.options && field.options.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: `options are not allowed on ${field.type} fields`,
      });
    }
    if (field.type === 'number' && field.min !== undefined && field.max !== undefined) {
      if (field.min > field.max) {
        context.addIssue({ code: 'custom', path: ['min'], message: 'min must be <= max' });
      }
    }
  });
export type UiField = z.infer<typeof UiFieldSchema>;

const HeadingBlock = z.object({
  kind: z.literal('heading'),
  text: ShortText,
  level: z.union([z.literal(2), z.literal(3)]).default(2),
});

const TextBlock = z.object({
  kind: z.literal('text'),
  text: PlainText,
});

const StatusBlock = z.object({
  kind: z.literal('status'),
  label: Label,
  tone: z.enum(['ok', 'warn', 'err', 'idle', 'accent']).default('idle'),
});

const ProgressBlock = z.object({
  kind: z.literal('progress'),
  label: Label,
  value: z.number().min(0).max(100),
});

const TaskListBlock = z.object({
  kind: z.literal('tasklist'),
  title: Label.optional(),
  items: z
    .array(z.object({ id: Identifier, label: Label, done: z.boolean().default(false) }))
    .min(1)
    .max(20),
});

const TableBlock = z.object({
  kind: z.literal('table'),
  title: Label.optional(),
  columns: z
    .array(z.object({ key: Identifier, label: Label }))
    .min(1)
    .max(6),
  rows: z
    .array(z.record(z.string(), z.string().max(200)))
    .max(MAX_TABLE_ROWS)
    .default([]),
});

const CardBlock = z.object({
  kind: z.literal('card'),
  title: Label,
  body: PlainText,
});

const ButtonBlock = z.object({
  kind: z.literal('button'),
  label: Label,
  action: z.enum(['dismiss']).default('dismiss'),
});

/**
 * A form is the only interactive block type. Its fields define exactly what a
 * submission may contain, so an event can be validated against the surface that
 * produced it rather than trusted from the client.
 */
const FormBlock = z.object({
  kind: z.literal('form'),
  id: Identifier,
  title: Label,
  fields: z.array(UiFieldSchema).min(1).max(MAX_FIELDS),
  submit_label: Label,
  /** Optional: persist the submission as project memory, with provenance. */
  save_to_memory: z
    .object({
      type: MemoryTypeSchema.default('project'),
      label: Label.optional(),
    })
    .optional(),
});

export const UiBlockSchema = z.discriminatedUnion('kind', [
  HeadingBlock,
  TextBlock,
  StatusBlock,
  ProgressBlock,
  TaskListBlock,
  TableBlock,
  CardBlock,
  FormBlock,
  ButtonBlock,
]);
export type UiBlock = z.infer<typeof UiBlockSchema>;
export type UiFormBlock = z.infer<typeof FormBlock>;

export const UiSurfaceSchema = z
  .object({
    version: z.literal(1),
    title: Label,
    description: z.string().max(400).optional(),
    blocks: z.array(UiBlockSchema).min(1).max(MAX_BLOCKS),
  })
  .superRefine((surface, context) => {
    const formIds = new Set<string>();
    for (const block of surface.blocks) {
      if (block.kind !== 'form') continue;
      if (formIds.has(block.id)) {
        context.addIssue({
          code: 'custom',
          path: ['blocks'],
          message: `duplicate form id ${block.id}`,
        });
      }
      formIds.add(block.id);

      const fieldIds = new Set<string>();
      for (const field of block.fields) {
        if (fieldIds.has(field.id)) {
          context.addIssue({
            code: 'custom',
            path: ['blocks'],
            message: `duplicate field id ${field.id}`,
          });
        }
        fieldIds.add(field.id);
      }
    }
  });
export type UiSurface = z.infer<typeof UiSurfaceSchema>;

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export const FieldValueSchema = z.union([
  z.string().max(4_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(80)).max(MAX_OPTIONS),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const UiSubmissionSchema = z.object({
  action_id: z.string().min(1).max(64).optional(),
  values: z.record(z.string(), FieldValueSchema),
});
export type UiSubmission = z.infer<typeof UiSubmissionSchema>;

export class UiProtocolError extends Error {
  readonly code: 'invalid_surface' | 'invalid_submission' | 'unknown_block' | 'limit_exceeded';
  readonly issues: { path: string; message: string }[];

  constructor(
    code: UiProtocolError['code'],
    message: string,
    issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'UiProtocolError';
    this.code = code;
    this.issues = issues;
  }

  static isUiProtocolError(value: unknown): value is UiProtocolError {
    return value instanceof UiProtocolError;
  }
}
