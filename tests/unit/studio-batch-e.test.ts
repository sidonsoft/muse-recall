import {
  type ForgeGenerationList,
  ForgeGenerationListSchema,
  type ForgeJob,
  ForgeJobSchema,
  type MediaVisualReviewResponse,
  MediaVisualReviewResponseSchema,
  type Memory,
  MemorySchema,
} from '@mml/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionReviewPanel } from '../../apps/web/src/components/studio/DecisionReviewPanel.tsx';
import {
  pinnedSelection,
  proposalFailureText,
  reviewFailureText,
  reviewIdempotencyKey,
  selectableDecisions,
  suppliedRevisionsLine,
} from '../../apps/web/src/components/studio/decision-review.ts';
import { GenerationsPanel } from '../../apps/web/src/components/studio/GenerationsPanel.tsx';
import {
  comparisonLimits,
  decisionReferenceLine,
  driftRowView,
  generationLabelView,
  reviewFindingRowView,
  verdictText,
} from '../../apps/web/src/components/studio/generation-view.ts';
import { ApiError } from '../../apps/web/src/lib/api.ts';

/**
 * Batch E — how decision history and screenshot review are worded and wired.
 *
 * These tests exist because the wording is the claim. A label that hints at
 * causal influence, a retired decision rendered as current guidance, or a review
 * finding that reads like an approval all break the feature without changing any
 * code path. The fixtures go through the shared schemas, so a contract change
 * cannot slip past them unnoticed.
 */

function decision(overrides: Partial<Memory> = {}): Memory {
  return MemorySchema.parse({
    id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
    type: 'constraint',
    scope: 'project',
    project_id: 'batch-e',
    content: 'Never use countdown timers.',
    source: { session_id: null, reference: 'studio:project-memory' },
    confidence: 0.9,
    validation_status: 'verified',
    status: 'active',
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    expires_at: null,
    supersedes: [],
    superseded_by: null,
    tags: [],
    revision: 3,
    actor: 'user',
    ...overrides,
  });
}

const STALE_GENERATION: ForgeGenerationList = ForgeGenerationListSchema.parse({
  project_id: 'batch-e',
  current_version: 3,
  truncated: false,
  items: [
    {
      version: 2,
      created_at: '2026-11-01T10:00:00.000Z',
      summary: 'Rounded the cards and moved scoring to the header.',
      base_version: 1,
      job_id: '7b1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f10',
      job_status: 'succeeded',
      job_kind: 'modify',
      memory_reference: [
        {
          memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
          revision: 2,
          content_sha256: 'c'.repeat(64),
          excerpt: 'Never use countdown timers.',
          type: 'constraint',
          user_selected: true,
          injected_sha256: 'd'.repeat(64),
          injected_excerpt: 'Never use countdown',
          injected_truncated: true,
        },
        {
          memory_id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
          revision: 1,
          content_sha256: 'e'.repeat(64),
          excerpt: 'Theme: ocean.',
          type: 'preference',
          user_selected: false,
        },
      ],
      comparison: {
        label: 'received_previous_decision',
        reason: 'One decision it was given has since been corrected.',
        limits: [
          'Labels describe which decisions a generation was given; they are not evidence that the model followed, was guided by, or was caused by any decision.',
          'A decision corrected after a generation ran does not change that generation — only a new job can use current guidance.',
        ],
        drift: [
          {
            memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
            supplied_revision: 2,
            supplied_excerpt: 'Never use countdown timers.',
            current_revision: 3,
            current_status: 'deleted',
            current_excerpt: null,
            superseded_by: null,
            change: 'withdrawn',
          },
          {
            memory_id: '4a1b2c3d-0003-4e5f-8a60-333333333333',
            supplied_revision: 1,
            supplied_excerpt: 'Keep the palette warm.',
            current_revision: 4,
            current_status: 'active',
            current_excerpt: 'Keep the palette cool.',
            superseded_by: null,
            change: 'revised_in_place',
          },
        ],
        added_since: [],
        unchanged: [],
      },
    },
    {
      version: 1,
      created_at: '2026-11-01T09:30:00.000Z',
      summary: 'First approved version.',
      base_version: null,
      job_id: '7b1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f11',
      job_status: 'succeeded',
      job_kind: 'generate',
      memory_reference: null,
      comparison: {
        label: 'potentially_affected',
        reason: 'No decision reference was stored for this generation.',
        limits: [
          'Labels describe which decisions a generation was given; they are not evidence that the model followed, was guided by, or was caused by any decision.',
        ],
        drift: [],
        added_since: [
          {
            memory_id: '4a1b2c3d-0004-4e5f-8a60-444444444444',
            revision: 1,
            content_sha256: 'f'.repeat(64),
            excerpt: 'Sound off by default.',
            type: 'constraint',
            user_selected: false,
          },
        ],
        unchanged: [],
      },
    },
  ],
});

const REVIEW: MediaVisualReviewResponse = MediaVisualReviewResponseSchema.parse({
  advisory: true,
  artifact_changed: false,
  screenshot_sha256: 'a'.repeat(64),
  generation: {
    id: '7b1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f10',
    kind: 'modify',
    status: 'succeeded',
    version: 2,
    created_at: '2026-11-01T10:00:00.000Z',
  },
  findings: [
    {
      decision_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
      decision_excerpt: 'Never use countdown timers.',
      decision_revision: 3,
      verdict: 'possible_conflict',
      evidence: 'a row of three digits ticks down at the top right of the frame',
      uncertainty: 'one frame cannot show whether the digits change or are a static score',
      confidence: 0.6,
    },
  ],
  unverified: [
    {
      decision_id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
      decision_excerpt: 'Theme: ocean.',
      decision_revision: 1,
      reason: 'the answer said nothing about this decision',
      uncertainty: 'nothing was reported, so nothing can be said about the frame',
    },
  ],
  ignored_entries: 1,
  limits: [
    'Findings describe this frame only; they say nothing about the app in general or any other version.',
    'A finding is not a defect report and never approves, rejects, or changes anything.',
  ],
  provider: { provider: 'meta', model: 'muse-spark-1.3', observed: 'muse-spark-1.3-observed' },
  provider_attempts: 1,
});

describe('generation comparison wording', () => {
  it('names the two non-causal labels exactly as the plan states them', () => {
    expect(generationLabelView('received_previous_decision').title).toBe(
      'Received previous decision',
    );
    expect(generationLabelView('potentially_affected').title).toBe('Potentially affected');
    expect(generationLabelView('matched_current_decision').title).toBe('Matched current decision');
  });

  it('never phrases a label as influence over the result', () => {
    const causal = /\b(caused|because of|due to|led to|resulted from|influenced|shaped|drove)\b/i;
    for (const label of [
      'received_previous_decision',
      'potentially_affected',
      'matched_current_decision',
    ] as const) {
      const view = generationLabelView(label);
      expect(`${view.title} ${view.meaning}`).not.toMatch(causal);
    }
  });

  it('keeps the non-causal limits attached even for a bare payload', () => {
    expect(comparisonLimits([])).toEqual([expect.stringContaining('not evidence')]);
    expect(comparisonLimits(['sent by the server'])).toEqual(['sent by the server']);
  });

  it('reports a retired decision as retired, never as current guidance', () => {
    const retired = driftRowView({
      memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
      supplied_revision: 2,
      supplied_excerpt: 'Never use countdown timers.',
      current_revision: 7,
      current_status: 'deleted',
      current_excerpt: 'Never use countdown timers.',
      superseded_by: null,
      change: 'withdrawn',
    });
    expect(retired.retired).toBe(true);
    expect(retired.current).toContain('retired');
    expect(retired.currentMeta).toBe('retired: deleted');
    // A purged record says so plainly instead of implying the text is current.
    const purged = driftRowView({
      memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
      supplied_revision: 2,
      supplied_excerpt: 'Never use countdown timers.',
      current_revision: null,
      current_status: null,
      current_excerpt: null,
      superseded_by: null,
      change: 'withdrawn',
    });
    expect(purged.currentMeta).toContain('gone');
  });

  it('keeps an in-place edit described as an edit', () => {
    const revised = driftRowView({
      memory_id: '4a1b2c3d-0003-4e5f-8a60-333333333333',
      supplied_revision: 1,
      supplied_excerpt: 'Keep the palette warm.',
      current_revision: 4,
      current_status: 'active',
      current_excerpt: 'Keep the palette cool.',
      superseded_by: null,
      change: 'revised_in_place',
    });
    expect(revised.retired).toBe(false);
    expect(revised.current).toBe('Keep the palette cool.');
    expect(revised.currentMeta).toBe('revision 4');
  });

  it('separates the stored record from the text that was actually injected', () => {
    expect(
      decisionReferenceLine({
        memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
        revision: 2,
        content_sha256: 'c'.repeat(64),
        excerpt: 'Never use countdown timers.',
        type: 'constraint',
        user_selected: true,
        injected_sha256: 'd'.repeat(64),
        injected_excerpt: 'Never use countdown',
        injected_truncated: true,
      }),
    ).toBe('rev 2 · truncated to a prefix in the prompt · selected by you');
    expect(
      decisionReferenceLine({
        memory_id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
        revision: 1,
        content_sha256: 'e'.repeat(64),
        excerpt: 'Theme: ocean.',
        type: 'preference',
        user_selected: false,
      }),
    ).toBe('rev 1 · not injected into this generation');
  });

  it('keeps a verdict about the frame, not the application', () => {
    expect(verdictText('possible_conflict')).toContain('frame');
    expect(verdictText('possible_conflict')).toContain('may');
    expect(verdictText('consistent')).toContain('appears');
  });

  it('marks an unreported decision as not assessed with no confidence', () => {
    const view = reviewFindingRowView({
      decision_id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
      decision_excerpt: 'Theme: ocean.',
      decision_revision: 1,
      reason: 'the answer said nothing about this decision',
      uncertainty: 'nothing was reported',
    });
    expect(view.unverified).toBe(true);
    expect(view.headline).toBe('not assessed');
    expect(view.confidence).toBe('no confidence reported');
  });
});

describe('the review call identity', () => {
  const selection = pinnedSelection(
    ['4a1b2c3d-0001-4e5f-8a60-111111111111', '4a1b2c3d-0002-4e5f-8a60-222222222222'],
    [
      decision(),
      decision({
        id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
        content: 'Theme: ocean.',
        revision: 1,
      }),
    ],
  );

  function key(input: {
    frame: string;
    decisions?: typeof selection;
    jobId?: string | null;
  }): string {
    return reviewIdempotencyKey({
      screenshotDataUrl: input.frame,
      decisions: input.decisions ?? selection,
      jobId: input.jobId === undefined ? '7b1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f10' : input.jobId,
    });
  }

  it('names one frame and selection consistently', () => {
    expect(key({ frame: 'data:image/png;base64,AAA' })).toBe(
      key({ frame: 'data:image/png;base64,AAA' }),
    );
    // Selection order is not part of the question being asked.
    expect(key({ frame: 'f', decisions: [...selection].reverse() })).toBe(key({ frame: 'f' }));
  });

  it('changes when anything the feedback describes changes', () => {
    const base = key({ frame: 'data:image/png;base64,AAA' });
    const keys = new Set([
      base,
      key({ frame: 'data:image/png;base64,AAB' }),
      key({ frame: 'data:image/png;base64,AAA', jobId: null }),
      key({
        frame: 'data:image/png;base64,AAA',
        decisions: [{ memory_id: selection[0]?.memory_id as string, expected_revision: 9 }],
      }),
      key({
        frame: 'data:image/png;base64,AAA',
        decisions: [selection[0] as (typeof selection)[0]],
      }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('stays inside the single-token header the server accepts', () => {
    const value = key({ frame: `data:image/png;base64,${'A'.repeat(2_000_000)}` });
    expect(value).not.toContain(',');
    expect(value).not.toContain(' ');
    expect(value.length).toBeGreaterThanOrEqual(8);
    expect(value.length).toBeLessThanOrEqual(128);
  });
});

describe('GenerationsPanel', () => {
  const markup = renderToStaticMarkup(
    createElement(GenerationsPanel, {
      generations: STALE_GENERATION,
      loading: false,
      error: null,
      onRefresh: () => undefined,
    }),
  );

  it('labels each generation with the plan wording and shows why', () => {
    expect(markup).toContain('Received previous decision');
    expect(markup).toContain('Potentially affected');
    expect(markup).toContain('One decision it was given has since been corrected.');
  });

  it('carries the non-causal limits on the same screen as the labels', () => {
    expect(markup).toContain('not evidence that the model followed');
    expect(markup).toContain('only a new job can use current guidance');
  });

  it('shows a retired decision as retired, including how it was retired', () => {
    expect(markup).toContain('decision retired (deleted)');
    expect(markup).toContain('decision edited in place');
  });

  it('reports a missing reference as unknown rather than as no decisions', () => {
    expect(markup).toContain('No decision reference was stored for this generation');
    expect(markup).toContain('unknown, not absent');
  });

  it('announces decisions accepted after a generation ran as impossible to have received', () => {
    expect(markup).toContain('could not have received it');
    expect(markup).toContain('only a new job can use current guidance');
  });

  it('is a reader: the panel offers no approve, restore, or regenerate control', () => {
    const labels = [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
      .map((match) => match[1].replace(/<[^>]*>/g, '').trim())
      .filter((label) => label.length > 0);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/approve|restore|regenerate|rollback|apply|accept/i);
    }
    expect(labels).toContain('Reload');
  });
});

describe('DecisionReviewPanel', () => {
  const withReview = renderToStaticMarkup(
    createElement(DecisionReviewPanel, {
      decisions: [
        decision(),
        decision({
          id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
          content: 'Theme: ocean.',
          type: 'preference',
          revision: 1,
        }),
      ],
      loading: false,
      error: null,
      selected: ['4a1b2c3d-0001-4e5f-8a60-111111111111'],
      onToggle: () => undefined,
      review: REVIEW,
      reviewBusy: false,
      reviewError: null,
      reviewNotice: null,
      onReview: () => undefined,
      canReview: true,
      suppliedLine: suppliedRevisionsLine(jobWithReferences()),
    }),
  );

  it('shows the selection pinned to the revision on screen', () => {
    expect(withReview).toContain('rev 3');
    expect(withReview).toContain('rev 1');
    expect(withReview).toContain('Review this screenshot');
    expect(withReview).toContain('advisory');
  });

  it('pairs every finding with evidence and uncertainty and says what was not assessed', () => {
    expect(withReview).toContain('the frame may conflict');
    expect(withReview).toContain('a row of three digits ticks down');
    expect(withReview).toContain('Still uncertain:');
    expect(withReview).toContain('not assessed');
    expect(withReview).toContain('the answer said nothing about this decision');
    expect(withReview).toContain('model self-report 60%');
  });

  it('counts an invented entry as dropped rather than as feedback', () => {
    expect(withReview).toContain('1 entry in the model answer described a decision');
    expect(withReview).toContain('dropped, not counted as feedback');
  });

  it('states that nothing was changed or approved, next to the findings', () => {
    expect(withReview).toContain('artifact unchanged: yes');
    expect(withReview).toContain('Nothing here approves a change');
    expect(withReview).toContain('has to be reviewed and approved by you');
  });

  it('names the approved generation the frame was reviewed beside', () => {
    expect(withReview).toContain('generation v2 (modify)');
  });

  it('refuses to read an empty review as a clean result', () => {
    const empty = renderToStaticMarkup(
      createElement(DecisionReviewPanel, {
        decisions: [decision()],
        loading: false,
        error: null,
        selected: ['4a1b2c3d-0001-4e5f-8a60-111111111111'],
        onToggle: () => undefined,
        review: MediaVisualReviewResponseSchema.parse({
          ...REVIEW,
          findings: [],
          unverified: [],
          ignored_entries: 0,
          generation: undefined,
        }),
        reviewBusy: false,
        reviewError: null,
        reviewNotice: null,
        onReview: () => undefined,
        canReview: true,
        suppliedLine: null,
      }),
    );
    expect(empty).toContain('not a clean result');
    expect(empty).toContain('not attached to a generation');
    expect(empty).not.toContain('generation v');
  });

  it('refuses to invite a review when there is no frame or no selection', () => {
    const blocked = renderToStaticMarkup(
      createElement(DecisionReviewPanel, {
        decisions: [decision()],
        loading: false,
        error: null,
        selected: [],
        onToggle: () => undefined,
        review: null,
        reviewBusy: false,
        reviewError: null,
        reviewNotice: null,
        onReview: () => undefined,
        canReview: false,
        suppliedLine: null,
      }),
    );
    expect(blocked).toContain('Capture a screenshot from the preview');
    const button = blocked.match(/<button[^>]*disabled[^>]*>[^<]*Review this screenshot/);
    expect(button).not.toBeNull();
  });
});

describe('selection and failure plumbing', () => {
  it('names a selection only by id and the revision the row displayed', () => {
    const selection = pinnedSelection(
      ['4a1b2c3d-0001-4e5f-8a60-111111111111', 'missing-id'],
      [decision(), decision({ id: '4a1b2c3d-0008-4e5f-8a60-888888888888', revision: 9 })],
    );
    expect(selection).toEqual([
      { memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111', expected_revision: 3 },
    ]);
    // Never any decision text: the server resolves what was meant.
    expect(JSON.stringify(selection)).not.toContain('countdown');
  });

  it('offers only accepted current decisions for review', () => {
    const offered = selectableDecisions([
      decision(),
      decision({ id: '4a1b2c3d-0005-4e5f-8a60-555555555555', status: 'superseded' }),
      decision({ id: '4a1b2c3d-0006-4e5f-8a60-666666666666', status: 'deleted' }),
      decision({ id: '4a1b2c3d-0007-4e5f-8a60-777777777777', status: 'proposed' }),
    ]);
    expect(offered.map((memory) => memory.id)).toEqual(['4a1b2c3d-0001-4e5f-8a60-111111111111']);
  });

  it('reports the exact revisions a job was supplied, including shortening', () => {
    const line = suppliedRevisionsLine(jobWithReferences());
    expect(line).toContain('constraint rev 2 (shortened in the prompt)');
    expect(line).toContain('preference rev 1');
    const none = suppliedRevisionsLine(
      ForgeJobSchema.parse({ ...jobBase(), decision_revisions_supplied: [] }),
    );
    expect(none).toContain('no decisions you selected');
    expect(suppliedRevisionsLine(null)).toBeNull();
  });

  it('says nothing was reviewed when a selection is no longer current', () => {
    expect(
      reviewFailureText(
        new ApiError('decision_revision_conflict', 'server says', 409, {
          cause: 'server says',
        }),
      ),
    ).toMatch(/edited after this screen loaded.*Nothing was reviewed/s);
    expect(
      reviewFailureText(new ApiError('decision_not_active', 'server says', 422, { cause: 'x' })),
    ).toMatch(/no longer an accepted current decision/s);
    expect(
      reviewFailureText(new ApiError('invalid_job_id', 'server says', 404, { cause: 'x' })),
    ).toMatch(/not an approved generation/s);
    expect(
      reviewFailureText(new ApiError('media_unconfigured', 'server says', 503, { cause: 'x' })),
    ).toMatch(/not configured/s);
  });

  it('says the proposal was not sent when its decisions are stale', () => {
    expect(
      proposalFailureText(
        new ApiError('decision_revision_conflict', 'server says', 409, { cause: 'x' }),
      ),
    ).toMatch(/The update was not proposed/);
  });
});

function jobBase() {
  return {
    id: '7b1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f10',
    project_id: 'batch-e',
    kind: 'modify',
    status: 'succeeded',
    prompt: '',
    request: 'Round the cards.',
    summary: 'Rounded the cards.',
    error: null,
    created_at: '2026-11-01T10:00:00.000Z',
    started_at: '2026-11-01T10:00:01.000Z',
    finished_at: '2026-11-01T10:00:20.000Z',
    logs: [],
    usage: null,
    model_observed: null,
    memory_ids: [],
    base_version: 1,
    validation: null,
    decision_guard: null,
    version: 2,
  };
}

function jobWithReferences(): ForgeJob {
  return ForgeJobSchema.parse({
    ...jobBase(),
    decision_revisions_supplied: [
      {
        memory_id: '4a1b2c3d-0001-4e5f-8a60-111111111111',
        revision: 2,
        content_sha256: 'c'.repeat(64),
        excerpt: 'Never use countdown timers.',
        type: 'constraint',
        user_selected: true,
        injected_sha256: 'd'.repeat(64),
        injected_excerpt: 'Never use countdown',
        injected_truncated: true,
      },
      {
        memory_id: '4a1b2c3d-0002-4e5f-8a60-222222222222',
        revision: 1,
        content_sha256: 'e'.repeat(64),
        excerpt: 'Theme: ocean.',
        type: 'preference',
        user_selected: true,
        injected_sha256: 'e'.repeat(64),
        injected_excerpt: 'Theme: ocean.',
        injected_truncated: false,
      },
    ],
  });
}
