import {
  type FieldValue,
  MAX_TABLE_ROWS,
  type UiField,
  type UiFormBlock,
  UiProtocolError,
  type UiSubmission,
  UiSubmissionSchema,
  type UiSurface,
  UiSurfaceSchema,
} from './schema.js';

/**
 * Validation at the trust boundary.
 *
 * A surface is accepted only if it parses against the closed schema. A
 * submission is accepted only if it matches the fields of the form that
 * produced it — the client cannot introduce fields, values, or option choices
 * the surface did not declare.
 */

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function parseSurface(input: unknown): UiSurface {
  const parsed = UiSurfaceSchema.safeParse(input);
  if (!parsed.success) {
    const issues = issuesOf(parsed.error);
    throw new UiProtocolError(
      'invalid_surface',
      `Invalid interface: ${issues[0]?.message ?? 'schema mismatch'}.`,
      issues,
    );
  }
  return parsed.data;
}

/** Pretty form used by tests and diagnostics; keeps limits in one place. */
export function surfaceLimits(): { blocks: number; fields: number; rows: number } {
  return { blocks: 10, fields: 10, rows: MAX_TABLE_ROWS };
}

export interface NormalisedSubmission {
  form: UiFormBlock;
  values: Record<string, string | number | boolean | string[]>;
  /** Human-readable structured message sent back to the agent. */
  summary: string;
}

export function validateSubmission(surface: UiSurface, input: unknown): NormalisedSubmission {
  const parsed = UiSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new UiProtocolError(
      'invalid_submission',
      'The submission did not match the expected shape.',
      issuesOf(parsed.error),
    );
  }

  const submission: UiSubmission = parsed.data;
  const form = findForm(surface, submission.action_id);

  const known = new Set(form.fields.map((field) => field.id));
  for (const key of Object.keys(submission.values)) {
    if (!known.has(key)) {
      throw new UiProtocolError('invalid_submission', `Unknown field "${key}".`, [
        { path: key, message: 'not declared by this interface' },
      ]);
    }
  }

  const values: NormalisedSubmission['values'] = {};
  const lines: string[] = [];

  for (const field of form.fields) {
    const raw = submission.values[field.id];
    const normalised = normaliseField(field, raw);
    if (normalised === undefined) {
      if (field.required) {
        throw new UiProtocolError('invalid_submission', `"${field.label}" is required.`, [
          { path: field.id, message: 'required' },
        ]);
      }
      continue;
    }
    values[field.id] = normalised;
    lines.push(`${field.label}: ${formatValue(normalised)}`);
  }

  const summary = [
    `Interface "${form.title}" was submitted with these values:`,
    ...lines.map((line) => `- ${line}`),
    '',
    'Continue the work using these choices.',
  ].join('\n');

  return { form, values, summary };
}

function findForm(surface: UiSurface, actionId?: string): UiFormBlock {
  const forms = surface.blocks.filter((block): block is UiFormBlock => block.kind === 'form');
  if (forms.length === 0) {
    throw new UiProtocolError('invalid_submission', 'This interface has no form to submit.');
  }
  if (actionId) {
    const match = forms.find((form) => form.id === actionId);
    if (!match) {
      throw new UiProtocolError('invalid_submission', `Unknown form "${actionId}".`);
    }
    return match;
  }
  const first = forms[0];
  if (!first) throw new UiProtocolError('invalid_submission', 'This interface has no form.');
  return first;
}

function normaliseField(
  field: UiField,
  raw: FieldValue | undefined,
): NormalisedSubmission['values'][string] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  switch (field.type) {
    case 'checkbox':
      if (typeof raw !== 'boolean') throw typeError(field, 'a boolean');
      return raw;
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) throw typeError(field, 'a number');
      if (field.min !== undefined && value < field.min) {
        throw new UiProtocolError(
          'invalid_submission',
          `"${field.label}" must be at least ${field.min}.`,
          [{ path: field.id, message: 'below minimum' }],
        );
      }
      if (field.max !== undefined && value > field.max) {
        throw new UiProtocolError(
          'invalid_submission',
          `"${field.label}" must be at most ${field.max}.`,
          [{ path: field.id, message: 'above maximum' }],
        );
      }
      return value;
    }
    case 'select': {
      if (typeof raw !== 'string') throw typeError(field, 'a single choice');
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (!allowed.has(raw)) {
        throw new UiProtocolError(
          'invalid_submission',
          `"${field.label}" is not an allowed choice.`,
          [{ path: field.id, message: 'unknown option' }],
        );
      }
      return raw;
    }
    case 'multiselect': {
      if (!Array.isArray(raw)) throw typeError(field, 'a list of choices');
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      const unique = [...new Set(raw)];
      for (const value of unique) {
        if (!allowed.has(value)) {
          throw new UiProtocolError(
            'invalid_submission',
            `"${field.label}" contains an unknown choice.`,
            [{ path: field.id, message: 'unknown option' }],
          );
        }
      }
      if (unique.length === 0) return undefined;
      return unique;
    }
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') throw typeError(field, 'text');
      const max = field.max_length ?? (field.type === 'text' ? 500 : 4_000);
      const value = raw.trim();
      if (value.length === 0) return undefined;
      if (value.length > max) {
        throw new UiProtocolError(
          'invalid_submission',
          `"${field.label}" is too long (max ${max}).`,
          [{ path: field.id, message: 'too long' }],
        );
      }
      return value;
    }
    default:
      return undefined;
  }
}

function formatValue(value: NormalisedSubmission['values'][string]): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function typeError(field: UiField, expected: string): UiProtocolError {
  return new UiProtocolError('invalid_submission', `"${field.label}" expects ${expected}.`, [
    { path: field.id, message: `expected ${expected}` },
  ]);
}
