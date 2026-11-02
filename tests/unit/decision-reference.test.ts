import {
  type ForgeDecisionReference,
  type ForgeJob,
  type ForgeState,
  type Memory,
  MemorySchema,
} from '@mml/shared';
import { describe, expect, it } from 'vitest';
import {
  buildGenerationList,
  compareGeneration,
  decisionContentSha256,
  decisionExcerpt,
  decisionReference,
  GENERATION_COMPARISON_LIMITS,
  isActiveProjectDecision,
  pinnedRetrieved,
} from '../../apps/server/src/forge/decision-reference.js';

/**
 * Batch E comparison rules. The labels are the contract: a generation given
 * stale guidance is called `received_previous_decision`, one that merely could
 * have missed a later decision is `potentially_affected`, and nothing in this
 * module is allowed to phrase either as measured influence.
 */

function memory(overrides: Partial<Memory> = {}): Memory {
  return MemorySchema.parse({
    id: '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000001',
    type: 'constraint',
    scope: 'project',
    project_id: 'batch-e',
    content: 'Keep every card face-up between turns.',
    source: { session_id: null, reference: null },
    confidence: 0.9,
    validation_status: 'verified',
    status: 'active',
    created_at: '2026-11-01T08:00:00.000Z',
    updated_at: '2026-11-01T08:00:00.000Z',
    expires_at: null,
    supersedes: [],
    superseded_by: null,
    tags: [],
    revision: 1,
    actor: 'user',
    ...overrides,
  });
}

function referenceOf(source: Memory): ForgeDecisionReference {
  return decisionReference(source);
}

const ID_A = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000001';
const ID_B = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000002';
const ID_C = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000003';

describe('decision references', () => {
  it('fingerprints the exact content a generation is given', () => {
    const source = memory({ content: 'Ocean theme, never  dark  water.' });
    const reference = decisionReference(source);
    expect(reference.memory_id).toBe(ID_A);
    expect(reference.revision).toBe(1);
    expect(reference.content_sha256).toBe(decisionContentSha256(source.content));
    expect(reference.content_sha256).not.toBe(
      decisionContentSha256('Ocean theme, never dark water.'),
    );
    expect(reference.user_selected).toBe(false);
    expect(decisionReference(source, { userSelected: true }).user_selected).toBe(true);
  });

  it('collapses whitespace and bounds the excerpt for side-by-side reading', () => {
    const long = `${'x'.repeat(300)}\n\nsecond line`;
    const excerpt = decisionExcerpt(long);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(decisionExcerpt('a   b\n\tc')).toBe('a b c');
    expect(decisionExcerpt('   ')).toBe('(empty decision)');
  });

  it('never echoes a credential that a decision happens to contain', () => {
    const secret = 'sk-live-MEMORYSECRET42';
    const source = memory({ content: `Avoid timers. Never store ${secret} in memory.` });
    const excerpt = decisionExcerpt(source.content);
    expect(excerpt).not.toContain(secret);
    expect(excerpt).toContain('[REDACTED');
    // The fingerprint still covers the exact stored text, so a later edit to
    // the same decision is detectable even though the excerpt is redacted.
    expect(decisionContentSha256(source.content)).toBe(
      decisionContentSha256(`Avoid timers. Never store ${secret} in memory.`),
    );
    const reference = decisionReference(source);
    expect(reference.excerpt).not.toContain(secret);
    expect(reference.content_sha256).toHaveLength(64);
  });

  it('keeps a truncated excerpt from splitting a redaction marker', () => {
    const filler = 'a'.repeat(190);
    const excerpt = decisionExcerpt(`${filler} password=hunter2secretsecret more words`);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt).not.toContain('hunter2secretsecret');
    expect(excerpt).not.toMatch(/\[REDAC|EDCTED|REDACTED:[a-z-]*$/);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('separates the stored record from the bytes actually injected', () => {
    const full = `${'x'.repeat(2_400)} TAIL_NOT_SENT`;
    const prefix = `${'x'.repeat(1_999)}…`;
    const source = memory({ content: full });
    const reference = decisionReference(source, {
      userSelected: true,
      injected: { content: prefix, truncated: true },
    });
    // The record fingerprint still covers the whole stored decision …
    expect(reference.content_sha256).toBe(decisionContentSha256(full));
    // … while the injection fingerprint covers only what the model was handed.
    expect(reference.injected_sha256).toBe(decisionContentSha256(prefix));
    expect(reference.injected_sha256).not.toBe(reference.content_sha256);
    expect(reference.injected_truncated).toBe(true);
    expect(reference.injected_excerpt).not.toContain('TAIL_NOT_SENT');
  });

  it('claims no injection for a decision the generation never received', () => {
    const reference = decisionReference(memory());
    expect(reference.injected_sha256).toBeUndefined();
    expect(reference.injected_excerpt).toBeUndefined();
    expect(reference.injected_truncated).toBeUndefined();
    // An untruncated injection records equal fingerprints on both sides.
    const sent = decisionReference(memory(), {
      injected: { content: memory().content, truncated: false },
    });
    expect(sent.injected_sha256).toBe(sent.content_sha256);
    expect(sent.injected_truncated).toBe(false);
  });

  it('marks a user pin as user-selected and explains why it was in context', () => {
    const retrieved = pinnedRetrieved(memory());
    expect(retrieved.pinned).toBe(true);
    expect(retrieved.evidence).toContain('selected by the user');
    expect(retrieved.injected_content).toBe(retrieved.memory.content);
    expect(retrieved.truncated).toBe(false);
  });
});

describe('compareGeneration', () => {
  it('reports an unknown relationship when no reference was stored', () => {
    const result = compareGeneration({
      reference: null,
      currentOf: () => memory(),
      activeDecisions: [memory()],
    });
    expect(result.label).toBe('potentially_affected');
    expect(result.reason).toContain('predates decision references');
    expect(result.drift).toEqual([]);
    expect(result.added_since).toEqual([]);
  });

  it('labels an in-place revision as received_previous_decision with both wordings', () => {
    const before = memory({ content: 'Keep every card face-up between turns.', revision: 3 });
    const after = memory({ content: 'Cards may flip back between turns.', revision: 4 });
    const result = compareGeneration({
      reference: [referenceOf(before)],
      currentOf: () => after,
      activeDecisions: [after],
    });
    expect(result.label).toBe('received_previous_decision');
    expect(result.drift).toHaveLength(1);
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('revised_in_place');
    expect(drift.supplied_revision).toBe(3);
    expect(drift.current_revision).toBe(4);
    expect(drift.supplied_excerpt).toBe('Keep every card face-up between turns.');
    expect(drift.current_excerpt).toBe('Cards may flip back between turns.');
    expect(result.unchanged).toEqual([]);
  });

  it('shows the successor wording when the decision was superseded', () => {
    const supplied = memory({ content: 'Theme: ocean.', superseded_by: ID_B, revision: 2 });
    const successor = memory({ id: ID_B, content: 'Theme: woodland.' });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: (id) => (id === ID_A ? supplied : id === ID_B ? successor : null),
      activeDecisions: [successor],
    });
    expect(result.label).toBe('received_previous_decision');
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('superseded');
    expect(drift.superseded_by).toBe(ID_B);
    expect(drift.supplied_excerpt).toBe('Theme: ocean.');
    expect(drift.current_excerpt).toBe('Theme: woodland.');
  });

  it('reports a withdrawn decision rather than guessing its current text', () => {
    const supplied = memory({ content: 'No timer in this game.' });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => null,
      activeDecisions: [],
    });
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('withdrawn');
    expect(drift.current_revision).toBeNull();
    expect(drift.current_excerpt).toBeNull();
  });

  it('calls a deleted record retired instead of revised', () => {
    // Deletion keeps the row, preserves its wording, and bumps the revision.
    // Comparing wording alone would report an in-place revision that never
    // happened and quote a deleted decision as if it were current guidance.
    const supplied = memory({ content: 'No timer in this game.', revision: 2 });
    const deleted = memory({ content: 'No timer in this game.', revision: 3, status: 'deleted' });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => deleted,
      activeDecisions: [],
    });
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(result.label).toBe('received_previous_decision');
    expect(drift.change).toBe('withdrawn');
    expect(drift.current_status).toBe('deleted');
    expect(drift.current_revision).toBe(3);
    expect(drift.current_excerpt).toBeNull();
    expect(result.unchanged).toEqual([]);
  });

  it('calls a record past its own expiry retired before the sweep runs', () => {
    const supplied = memory({ content: 'Seasonal theme: Halloween.', revision: 4 });
    const expiredButUnswept = memory({
      content: 'Seasonal theme: Halloween.',
      revision: 4,
      expires_at: '2026-10-31T00:00:00.000Z',
    });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => expiredButUnswept,
      activeDecisions: [],
      now: '2026-11-01T00:00:00.000Z',
    });
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('withdrawn');
    expect(drift.current_status).toBe('expired');
    expect(drift.current_excerpt).toBeNull();
  });

  it('accepts a swept row that already carries expired status', () => {
    const supplied = memory({ content: 'Seasonal theme: Halloween.', revision: 4 });
    const swept = memory({
      content: 'Seasonal theme: Halloween.',
      revision: 5,
      status: 'expired',
      expires_at: '2026-10-31T00:00:00.000Z',
    });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => swept,
      activeDecisions: [],
      now: '2026-11-01T00:00:00.000Z',
    });
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('withdrawn');
    expect(drift.current_status).toBe('expired');
  });

  it('leaves a live record with future expiry unmatched only if wording matches', () => {
    const live = memory({
      content: 'Keep every card face-up between turns.',
      expires_at: '2027-01-01T00:00:00.000Z',
    });
    const result = compareGeneration({
      reference: [referenceOf(live)],
      currentOf: () => live,
      activeDecisions: [live],
      now: '2026-11-01T00:00:00.000Z',
    });
    expect(result.label).toBe('matched_current_decision');
    expect(result.drift).toEqual([]);
  });

  it('never labels an in-place edit as withdrawn when the record is still active', () => {
    const supplied = memory({ content: 'Theme: ocean.', revision: 1 });
    const revised = memory({ content: 'Theme: woodland.', revision: 2 });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => revised,
      activeDecisions: [revised],
      now: '2026-11-01T00:00:00.000Z',
    });
    const drift = result.drift[0] as (typeof result.drift)[number];
    expect(drift.change).toBe('revised_in_place');
    expect(drift.current_status).toBe('active');
    expect(drift.current_excerpt).toBe('Theme: woodland.');
  });

  it('separates a coverage gap from stale guidance', () => {
    const supplied = memory();
    const added = memory({ id: ID_C, content: 'Add a keyboard shortcut for restarting.' });
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => supplied,
      activeDecisions: [supplied, added],
    });
    expect(result.label).toBe('potentially_affected');
    expect(result.drift).toEqual([]);
    expect(result.added_since.map((entry) => entry.memory_id)).toEqual([ID_C]);
    // These were never injected, so the record must not claim injection bytes.
    for (const entry of result.added_since) expect(entry.injected_sha256).toBeUndefined();
    expect(result.reason).toContain('coverage gap');
    expect(result.unchanged).toHaveLength(1);
  });

  it('calls a fully current reference matched, with no drift invented', () => {
    const supplied = memory();
    const result = compareGeneration({
      reference: [referenceOf(supplied)],
      currentOf: () => memory(),
      activeDecisions: [supplied],
    });
    expect(result.label).toBe('matched_current_decision');
    expect(result.drift).toEqual([]);
    expect(result.added_since).toEqual([]);
  });

  it('ships the non-causal disclaimer with every label', () => {
    for (const reference of [
      null,
      [referenceOf(memory())],
      [referenceOf(memory({ content: 'old', revision: 1 }))],
    ]) {
      const result = compareGeneration({
        reference,
        currentOf: () => memory({ content: 'new', revision: 2 }),
        activeDecisions: [memory({ content: 'new', revision: 2 })],
      });
      expect(result.limits.length).toBeGreaterThan(0);
      for (const limit of GENERATION_COMPARISON_LIMITS) expect(result.limits).toContain(limit);
      const text = `${result.label} ${result.reason} ${result.limits.join(' ')}`.toLowerCase();
      expect(text).not.toMatch(/because the model (used|followed)/);
      expect(text).not.toContain('caused the model');
    }
  });
});

describe('isActiveProjectDecision', () => {
  it('keeps active project and global decisions only', () => {
    expect(isActiveProjectDecision(memory(), 'batch-e')).toBe(true);
    expect(isActiveProjectDecision(memory({ project_id: null, scope: 'global' }), 'batch-e')).toBe(
      true,
    );
    expect(isActiveProjectDecision(memory({ project_id: 'other' }), 'batch-e')).toBe(false);
    expect(isActiveProjectDecision(memory({ status: 'proposed' }), 'batch-e')).toBe(false);
    expect(isActiveProjectDecision(memory({ superseded_by: ID_B }), 'batch-e')).toBe(false);
  });
});

describe('buildGenerationList', () => {
  const job = (id: string, reference: ForgeDecisionReference[] | null): ForgeJob =>
    ({
      id,
      project_id: 'batch-e',
      kind: 'generate',
      status: 'succeeded',
      prompt: 'p',
      request: null,
      summary: null,
      error: null,
      created_at: '2026-11-01T08:00:00.000Z',
      started_at: null,
      finished_at: null,
      logs: [],
      usage: null,
      model_observed: null,
      memory_ids: reference === null ? [] : reference.map((entry) => entry.memory_id),
      ...(reference === null ? {} : { memory_reference: reference }),
      base_version: null,
      validation: null,
      decision_guard: null,
      version: null,
    }) as ForgeJob;

  const current = memory({ content: 'Theme: woodland.', revision: 2 });
  const supplied = memory({ content: 'Theme: ocean.', revision: 1 });

  function state(versions: Array<{ version: number; job_id: string }>): ForgeState {
    return {
      project_id: 'batch-e',
      current_version: versions.at(-1)?.version ?? null,
      versions: versions.map((entry) => ({
        version: entry.version,
        created_at: '2026-11-01T09:00:00.000Z',
        summary: `v${String(entry.version)}`,
        job_id: entry.job_id,
      })),
      can_rollback: versions.length > 1,
    };
  }

  it('lists every generation with its stored reference, newest first', () => {
    const list = buildGenerationList({
      projectId: 'batch-e',
      state: state([{ version: 1, job_id: '11111111-1111-4111-8111-111111111111' }]),
      jobs: [job('11111111-1111-4111-8111-111111111111', [referenceOf(supplied)])],
      activeDecisions: [current],
      currentOf: (id) =>
        id === ID_A ? memory({ content: 'Theme: ocean.', revision: 1 }) : current,
    });
    expect(list.items).toHaveLength(1);
    const generation = list.items[0] as (typeof list.items)[number];
    expect(generation.memory_reference).not.toBeNull();
    expect(generation.comparison.label).toBe('matched_current_decision');
  });

  it('labels a generation whose supplied text has since changed', () => {
    const list = buildGenerationList({
      projectId: 'batch-e',
      state: state([
        { version: 1, job_id: '11111111-1111-4111-8111-111111111111' },
        { version: 2, job_id: '22222222-2222-4222-8222-222222222222' },
      ]),
      jobs: [
        job('11111111-1111-4111-8111-111111111111', [referenceOf(supplied)]),
        job('22222222-2222-4222-8222-222222222222', [decisionReference(current)]),
      ],
      activeDecisions: [current],
      currentOf: () => current,
    });
    expect(list.items.map((item) => item.version)).toEqual([2, 1]);
    expect(list.truncated).toBe(false);
    expect((list.items[0] as (typeof list.items)[number]).comparison.label).toBe(
      'matched_current_decision',
    );
    expect((list.items[1] as (typeof list.items)[number]).comparison.label).toBe(
      'received_previous_decision',
    );
  });

  it('marks a version with no job record as potentially affected', () => {
    const list = buildGenerationList({
      projectId: 'batch-e',
      state: state([{ version: 1, job_id: '33333333-3333-4333-8333-333333333333' }]),
      jobs: [],
      activeDecisions: [current],
      currentOf: () => current,
    });
    const generation = list.items[0] as (typeof list.items)[number];
    expect(generation.job_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(generation.job_status).toBeNull();
    expect(generation.memory_reference).toBeNull();
    expect(generation.comparison.label).toBe('potentially_affected');
  });

  it('truncates the oldest generations instead of the newest', () => {
    const versions = Array.from({ length: 70 }, (_unused, index) => ({
      version: index + 1,
      job_id: `1000000${String(index).padStart(2, '0')}-0000-4000-8000-000000000000`,
    }));
    const list = buildGenerationList({
      projectId: 'batch-e',
      state: state(versions),
      jobs: versions.map((entry) => job(entry.job_id, [decisionReference(current)])),
      activeDecisions: [current],
      currentOf: () => current,
      limit: 8,
    });
    expect(list.items).toHaveLength(8);
    expect(list.items[0]?.version).toBe(70);
    expect(list.items.at(-1)?.version).toBe(63);
    expect(list.truncated).toBe(true);
  });
});
