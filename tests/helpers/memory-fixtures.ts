import type { MemoryCorrectionInput, MemoryCreateInput } from '@mml/shared';

/**
 * `MemoryEngine.create`, `propose` and `correct` take the schema's *parsed*
 * shape, in which the defaulted fields are present, while the runtime accepts
 * their absence and fills them from the schema. Test fixtures that are ordinary
 * records therefore need those fields written down; this module writes them once
 * so a fixture states only what it actually varies, and the mirrored values name
 * the schema they come from.
 *
 * Spread these FIRST and the literal's own fields win, so a fixture that varies
 * a value still varies it. Fixtures that exist to prove a default applies must
 * keep omitting the field — do not "fix" those by spreading this.
 */

/** Defaults declared by `MemoryCreateInputSchema` (packages/shared/src/memory.ts). */
export const CREATE_DEFAULTS: Pick<
  MemoryCreateInput,
  'source' | 'confidence' | 'validation_status' | 'expires_at' | 'tags'
> = {
  source: { session_id: null, reference: null },
  confidence: 0.7,
  validation_status: 'unverified',
  expires_at: null,
  tags: [],
};

/** Defaults declared by `MemoryCorrectionFieldsSchema` (same file). */
export const CORRECTION_DEFAULTS: Pick<
  MemoryCorrectionInput,
  'scope' | 'source' | 'confidence' | 'validation_status' | 'tags'
> = {
  scope: 'project',
  source: { session_id: null, reference: null },
  confidence: 0.9,
  validation_status: 'verified',
  tags: [],
};
