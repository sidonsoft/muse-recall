import { createHash, randomUUID } from 'node:crypto';
import type { Memory } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import {
  evaluateDecisionGuardAdvisory,
  MAX_ADVISORY_BYTES,
  MAX_ADVISORY_FINDINGS,
  MAX_ADVISORY_UNVERIFIED,
  plainText,
  resolveDecisionContext,
} from '../../apps/server/src/forge/decision-guard.js';

const PROJECT = 'demo-game';
const OTHER_PROJECT = 'other-game';
const NOW = new Date('2026-10-27T04:30:00.000Z');

function memory(overrides: Partial<Memory> & Pick<Memory, 'id' | 'content'>): Memory {
  return {
    type: 'constraint',
    scope: 'project',
    project_id: PROJECT,
    source: { session_id: null, reference: 'test' },
    confidence: 0.9,
    validation_status: 'verified',
    status: 'active',
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
    expires_at: null,
    supersedes: [],
    superseded_by: null,
    tags: ['test'],
    ...overrides,
  };
}

/** In-memory resolver keyed by id; unknown ids resolve to null, like a delete. */
function resolver(rows: Memory[]): (id: string) => Memory | null {
  const index = new Map(rows.map((row) => [row.id, row]));
  return (id) => index.get(id) ?? null;
}

const CHILD = memory({
  id: '11111111-1111-4111-8111-111111111111',
  content:
    'This game is for children. Avoid flashing effects, countdown timers, and penalties for mistakes.',
});

const A11Y = memory({
  id: '22222222-2222-4222-8222-222222222222',
  content: 'All essential actions must remain usable without colour discrimination.',
  type: 'technical_decision',
});

const OCEAN = memory({
  id: '33333333-3333-4333-8333-333333333333',
  content: 'Art direction: cool ocean palette. Primary accent #4EA8DE and dark text #102A43.',
  supersedes: ['44444444-4444-4444-8444-444444444444'],
});

const SUNSET = memory({
  id: '44444444-4444-4444-8444-444444444444',
  content: 'Art direction: warm sunset palette. Primary accent #FF7E5F and dark text #2D1E2F.',
  status: 'superseded',
  superseded_by: OCEAN.id,
});

const ROUNDED = memory({
  id: '55555555-5555-4555-8555-555555555555',
  content: 'Prefer rounded corners on all game panels.',
  type: 'preference',
});

const PHASER =
  '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>';

function evaluate(options: {
  source: string;
  rows: Memory[];
  memoryIds: string[];
  runtimeVerified?: boolean;
  secrets?: (string | null | undefined)[];
}) {
  return evaluateDecisionGuardAdvisory({
    projectId: PROJECT,
    memoryIds: options.memoryIds,
    source: options.source,
    getMemory: resolver(options.rows),
    evaluatedAt: NOW,
    runtimeVerified: options.runtimeVerified ?? false,
    ...(options.secrets ? { secrets: options.secrets } : {}),
  });
}

describe('decision provenance resolution', () => {
  it('resolves an active same-project decision as an evaluable constraint', () => {
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [CHILD.id],
      getMemory: resolver([CHILD]),
    });
    expect(resolution.active.map((entry) => entry.id)).toEqual([CHILD.id]);
    expect(resolution.evaluatedMemoryIds).toEqual([CHILD.id]);
    expect(resolution.superseded).toEqual([]);
    expect(resolution.unverified).toEqual([]);
  });

  it('excludes a superseded decision from active constraints and says so', () => {
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [SUNSET.id],
      getMemory: resolver([SUNSET]),
    });
    expect(resolution.active).toEqual([]);
    expect(resolution.evaluatedMemoryIds).toEqual([]);
    expect(resolution.unverified.map((entry) => entry.code)).toContain('decision_not_active');
  });

  it('resolves superseded history separately for a corrected decision', () => {
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      // Both ids recorded on the job: the active correction and its history.
      memoryIds: [SUNSET.id, OCEAN.id],
      getMemory: resolver([SUNSET, OCEAN]),
    });
    expect(resolution.active.map((entry) => entry.id)).toEqual([OCEAN.id]);
    expect(resolution.superseded.map((entry) => entry.id)).toEqual([SUNSET.id]);
    expect(resolution.supersededMemoryIds).toEqual([SUNSET.id]);
    // History resolved for exactly the correction rule is not a limitation.
    expect(resolution.unverified.filter((entry) => entry.decision_id === SUNSET.id)).toEqual([]);
  });

  it('keeps project isolation: another project’s decision is never evaluated', () => {
    const foreign = memory({
      id: '66666666-6666-4666-8666-666666666666',
      project_id: OTHER_PROJECT,
      content: 'Avoid countdown timers in this other project.',
    });
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [foreign.id, CHILD.id],
      getMemory: resolver([foreign, CHILD]),
    });
    expect(resolution.active.map((entry) => entry.id)).toEqual([CHILD.id]);
    expect(resolution.evaluatedMemoryIds).not.toContain(foreign.id);
    expect(resolution.unverified.map((entry) => entry.code)).toContain('cross_project');
    expect(resolution.unverified.find((entry) => entry.decision_id === foreign.id)?.reason).toMatch(
      /different project/,
    );
  });

  it('does not treat global-scope memories as project constraints', () => {
    const globalDecision = memory({
      id: '77777777-7777-4777-8777-777777777777',
      scope: 'global',
      project_id: null,
      content: 'Avoid flashing effects in every game.',
    });
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [globalDecision.id],
      getMemory: resolver([globalDecision]),
    });
    expect(resolution.active).toEqual([]);
    expect(resolution.unverified.map((entry) => entry.code)).toContain('global_scope');
  });

  it('records an explicit limitation for a memory that cannot be resolved', () => {
    const missing = randomUUID();
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [missing],
      getMemory: resolver([]),
    });
    expect(resolution.active).toEqual([]);
    const entry = resolution.unverified.find((item) => item.decision_id === missing);
    expect(entry?.code).toBe('memory_unresolved');
    expect(entry?.reason).toMatch(/could not be resolved/);
  });

  it('records a deleted memory as unresolved rather than compliant', () => {
    // `engine.get` returns null for deleted rows, which is what the resolver sees.
    const deletedId = randomUUID();
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [deletedId],
      getMemory: () => null,
    });
    expect(resolution.unverified.map((entry) => entry.code)).toContain('memory_unresolved');
  });

  it('does not adopt a replacement memory that was not in the job context', () => {
    const replacement = memory({
      id: '88888888-8888-4888-8888-888888888888',
      content: 'Art direction: cool ocean palette. Primary accent #4EA8DE.',
    });
    // The job recorded the sunset constraint; it was corrected afterwards. The
    // replacement exists but was never part of this job.
    const resolution = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [SUNSET.id],
      getMemory: resolver([SUNSET, replacement]),
    });
    expect(resolution.evaluatedMemoryIds).not.toContain(replacement.id);
    expect(resolution.unverified.map((entry) => entry.code)).toContain('decision_not_active');
  });

  it('never mutates resolved memory records', () => {
    const rows = [CHILD, OCEAN, SUNSET];
    const before = structuredClone(rows);
    resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: rows.map((row) => row.id),
      getMemory: resolver(rows),
    });
    expect(rows).toEqual(before);
  });

  it('evaluates decisions in a deterministic id order', () => {
    const first = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [A11Y.id, CHILD.id],
      getMemory: resolver([A11Y, CHILD]),
    });
    const second = resolveDecisionContext({
      projectId: PROJECT,
      memoryIds: [CHILD.id, A11Y.id],
      getMemory: resolver([CHILD, A11Y]),
    });
    expect(first.evaluatedMemoryIds).toEqual(second.evaluatedMemoryIds);
    expect(first.evaluatedMemoryIds).toEqual([CHILD.id, A11Y.id]);
  });
});

describe('advisory evaluation', () => {
  it('reports a known violation with a bounded finding that cites the decision', () => {
    const advisory = evaluate({
      source: `${PHASER}<div id="countdown">10</div><script>let timeLeft = 10; setInterval(function tick(){ timeLeft -= 1; }, 1000);</script>`,
      rows: [CHILD],
      memoryIds: [CHILD.id],
    });
    expect(advisory.mode).toBe('advisory');
    expect(advisory.engine_verdict).toBe('BLOCK');
    expect(advisory.assessment).toBe('violation_detected');
    expect(advisory.assessment_reason).toMatch(/do not block approval/);
    expect(advisory.findings).toHaveLength(1);
    const finding = advisory.findings[0];
    expect(finding?.decision_id).toBe(CHILD.id);
    expect(finding?.rule).toBe('countdown-mechanics');
    expect(finding?.severity).toBe('high');
    expect(finding?.kind).toBe('violation');
    expect(finding?.decision_ref).toContain('children');
    expect(finding?.evidence).toContain('timeLeft');
    expect(finding?.evidence.length).toBeLessThanOrEqual(240);
    expect(advisory.evaluated_memory_ids).toEqual([CHILD.id]);
    expect(advisory.applicable_rules).toEqual(
      expect.arrayContaining(['countdown-mechanics', 'flashing-effects', 'mistake-penalty']),
    );
  });

  it('reports no finding for a compliant source', () => {
    const advisory = evaluate({
      source: `${PHASER}<script>let elapsed = 0; function pick(){ score += 10; elapsed += 1; }</script>`,
      rows: [CHILD],
      memoryIds: [CHILD.id],
    });
    expect(advisory.findings).toEqual([]);
    expect(advisory.engine_verdict).toBe('PASS');
    expect(advisory.assessment).toBe('no_violation_detected');
    expect(advisory.assessment_reason).toMatch(/not a certification/);
    expect(advisory.assessment_reason).not.toMatch(/compliant/i);
  });

  it('marks an unsupported decision UNVERIFIED instead of compliant', () => {
    const advisory = evaluate({
      source: `${PHASER}<style>.panel { border-radius: 12px }</style>`,
      rows: [ROUNDED],
      memoryIds: [ROUNDED.id],
    });
    expect(advisory.engine_verdict).toBe('UNVERIFIED');
    expect(advisory.assessment).toBe('not_verified');
    expect(advisory.findings).toEqual([]);
    const entry = advisory.unverified.find((item) => item.decision_id === ROUNDED.id);
    expect(entry?.code).toBe('unsupported_decision');
    expect(entry?.reason).toMatch(/cannot be claimed/);
    expect(advisory.applicable_rules).toEqual([]);
  });

  it('abstains on a hidden long timer without publishing a violation finding', () => {
    const source = `var SPRINT_LEN = 15*60*1000;
var sprintTimer = null;
function startSprint(){
  if(sprintTimer) window.clearTimeout(sprintTimer);
  sprintTimer = window.setTimeout(function(){
    sprintTimer = null;
    setSprintMsg('Reading time finished — great cozy reading!');
  }, SPRINT_LEN);
}`;
    const advisory = evaluate({ source, rows: [CHILD], memoryIds: [CHILD.id] });
    expect(advisory.engine_verdict).toBe('UNVERIFIED');
    expect(advisory.assessment).toBe('not_verified');
    expect(advisory.findings).toEqual([]);
    const entry = advisory.unverified.find(
      (item) => item.decision_id === CHILD.id && item.rule === 'countdown-mechanics',
    );
    expect(entry?.code).toBe('rule_unverified');
    expect(entry?.reason).toContain('15-minute timer bounds an activity');
    expect(entry?.reason).toContain('SPRINT_LEN = 15*60*1000');
  });

  it('evaluates a corrected palette and resolves its superseded history', () => {
    const advisory = evaluate({
      source: `${PHASER}<style>:root { --accent: #FF7E5F; }</style>`,
      rows: [OCEAN, SUNSET],
      memoryIds: [OCEAN.id, SUNSET.id],
    });
    expect(advisory.engine_verdict).toBe('BLOCK');
    expect(advisory.findings[0]?.rule).toBe('superseded-palette');
    expect(advisory.findings[0]?.decision_id).toBe(OCEAN.id);
    expect(advisory.superseded_memory_ids).toEqual([SUNSET.id]);
  });

  it('keeps evidence one bounded line and keeps markup inert as data', () => {
    const hostile = `${PHASER}<script>let timeLeft = 99;<img src=x>timeLeft -= 1;</script>`;
    const advisory = evaluate({ source: hostile, rows: [CHILD], memoryIds: [CHILD.id] });
    const evidence = advisory.findings[0]?.evidence ?? '';
    expect(evidence).toContain('timeLeft');
    expect(evidence).toContain('<img');
    expect(evidence).not.toContain('\u0000');
    expect(evidence).not.toContain('\n');
    expect(evidence.length).toBeLessThanOrEqual(240);
    expect(plainText(' a\n\nb\tc ', 80)).toBe('a b c');
  });

  it('minimises evidence context around the matched construct', () => {
    const source = `${PHASER}<p>${'padding '.repeat(80)}</p><script>let timeLeft = 5; timeLeft -= 1;</script><p>${'trailing '.repeat(80)}</p>`;
    const advisory = evaluate({ source, rows: [CHILD], memoryIds: [CHILD.id] });
    const evidence = advisory.findings[0]?.evidence ?? '';
    expect(evidence).toContain('timeLeft');
    expect(evidence).not.toContain('padding');
    expect(evidence).not.toContain('trailing');
    expect(evidence.length).toBeLessThan(160);
  });

  it('redacts credential-shaped strings and known secrets from findings and references', () => {
    const secret = 'sk-live-EVIDENCESECRET42';
    const memorySecret = 'sk-live-MEMORYSECRET42';
    const rows = [
      memory({
        id: CHILD.id,
        content: `Avoid countdown timers. Never persist ${memorySecret}.`,
      }),
    ];
    const advisory = evaluate({
      source: `${PHASER}<script>const key = '${secret}'; let timeLeft = 5; timeLeft -= 1;</script>`,
      rows,
      memoryIds: [CHILD.id],
    });
    const serialized = JSON.stringify(advisory);
    expect(advisory.assessment).toBe('violation_detected');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(memorySecret);
    expect(advisory.findings[0]?.evidence).toContain('timeLeft');
    expect(advisory.findings[0]?.decision_ref).toContain('countdown timers');
  });

  it('redacts exact configured secrets even when the pattern does not match', () => {
    const secret = 'plain-value-that-is-a-credential';
    const advisory = evaluate({
      source: `${PHASER}<script>const key = '${secret}'; timeLeft -= 1;</script>`,
      rows: [CHILD],
      memoryIds: [CHILD.id],
      secrets: [secret],
    });
    expect(JSON.stringify(advisory)).not.toContain(secret);
  });

  it('bounds findings, unverified entries and the serialised payload', () => {
    const decisions = Array.from({ length: 40 }, (_, index) =>
      memory({
        id: `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`,
        content: 'Avoid flashing effects, countdown timers, and penalties for mistakes.',
      }),
    );
    const source = `${PHASER}<style>@keyframes blinkBanner { 50% { opacity: 0 } }</style><div id="countdown"></div><script>setInterval(function(){ timeLeft -= 1; }, 1000); function w(){ score -= 1; }</script>`;
    const advisory = evaluate({
      source,
      rows: decisions,
      memoryIds: decisions.map((decision) => decision.id),
    });
    expect(advisory.findings.length).toBeLessThanOrEqual(MAX_ADVISORY_FINDINGS);
    expect(advisory.unverified.length).toBeLessThanOrEqual(MAX_ADVISORY_UNVERIFIED);
    expect(Buffer.byteLength(JSON.stringify(advisory), 'utf8')).toBeLessThanOrEqual(
      MAX_ADVISORY_BYTES,
    );
    // The bound is honest: it says something was omitted.
    expect(
      advisory.unverified.some((entry) => entry.code === 'truncated') ||
        advisory.evaluated_memory_ids.length === 32,
    ).toBe(true);
  });

  it('records an explicit limitation when the job has no decisions', () => {
    const advisory = evaluate({ source: PHASER, rows: [], memoryIds: [] });
    expect(advisory.engine_verdict).toBe('UNVERIFIED');
    expect(advisory.assessment).toBe('not_verified');
    expect(advisory.unverified.map((entry) => entry.code)).toContain('no_decisions');
    expect(advisory.applicable_rules).toEqual([]);
  });

  it('records runtime status, the source hash and the injected clock', () => {
    const source = `${PHASER}<script>ok</script>`;
    const advisory = evaluate({
      source,
      rows: [CHILD],
      memoryIds: [CHILD.id],
      runtimeVerified: true,
    });
    expect(advisory.runtime_verified).toBe(true);
    expect(advisory.evaluated_at).toBe(NOW.toISOString());
    expect(advisory.source_sha256).toBe(createHash('sha256').update(source).digest('hex'));
  });

  it('is deterministic for identical input and clock', () => {
    const input = {
      source: `${PHASER}<script>score -= 1; timeLeft -= 1;</script>`,
      rows: [CHILD, A11Y],
      memoryIds: [A11Y.id, CHILD.id],
    };
    const first = JSON.stringify(evaluate(input));
    const second = JSON.stringify(evaluate(input));
    expect(first).toBe(second);
  });

  it('degrades to an explicit internal_error limitation instead of claiming compliance', () => {
    // A non-UUID decision id can only arrive from a contract violation; the
    // snapshot must fail closed rather than publish an unvalidated finding.
    const rogue = memory({ id: 'dec-rogue', content: 'Avoid countdown timers.' });
    const advisory = evaluate({
      source: `${PHASER}<div id="countdown"></div>`,
      rows: [rogue],
      memoryIds: [rogue.id],
    });
    expect(advisory.engine_verdict).toBe('UNVERIFIED');
    expect(advisory.assessment).toBe('evaluation_unavailable');
    expect(advisory.findings).toEqual([]);
    expect(advisory.unverified.map((entry) => entry.code)).toContain('internal_error');
  });
});
