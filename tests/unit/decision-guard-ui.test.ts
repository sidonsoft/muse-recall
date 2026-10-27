import type { DecisionGuardAdvisory } from '@mml/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionGuardPanel } from '../../apps/web/src/components/forge/DecisionGuardAdvisory.tsx';

/**
 * Phase 12C — the advisory panel must render untrusted findings as text.
 *
 * This renders the real React component on the server and inspects the markup,
 * so it fails if evidence or a decision reference is ever injected as HTML.
 */

const DECISION_ID = '11111111-1111-4111-8111-111111111111';

function advisory(overrides: Partial<DecisionGuardAdvisory> = {}): DecisionGuardAdvisory {
  return {
    mode: 'advisory',
    engine_version: '1.2.0',
    engine_verdict: 'BLOCK',
    assessment: 'violation_detected',
    assessment_reason:
      'At least one supported check reported a possible violation. Findings are advisory and do not block approval.',
    findings: [
      {
        kind: 'violation',
        decision_id: DECISION_ID,
        decision_ref: '<b>child-friendly</b> decision',
        rule: 'countdown-mechanics',
        severity: 'high',
        evidence: '</pre><img src=x onerror="alert(1)"><script>alert(2)</script>',
        explanation: 'decision prohibits countdown mechanics',
      },
    ],
    unverified: [
      {
        kind: 'unverified',
        decision_id: DECISION_ID,
        decision_ref: '<i>palette</i> decision',
        rule: 'superseded-palette',
        severity: null,
        code: 'rule_unverified',
        reason: 'superseded decision text not supplied',
      },
    ],
    evaluated_memory_ids: [DECISION_ID],
    superseded_memory_ids: [],
    source_sha256: 'a'.repeat(64),
    runtime_verified: true,
    evaluated_at: '2026-10-27T04:30:00.000Z',
    ...overrides,
  };
}

function render(value: DecisionGuardAdvisory | null): string {
  return renderToStaticMarkup(createElement(DecisionGuardPanel, { advisory: value }));
}

describe('Decision Guard advisory panel', () => {
  it('labels itself advisory and states that findings do not block approval', () => {
    const markup = render(advisory());
    expect(markup).toContain('Decision Guard — Advisory');
    expect(markup).toContain('Findings do not block approval in this version.');
  });

  it('escapes evidence and decision references instead of injecting markup', () => {
    const markup = render(advisory());
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<script>alert(2)');
    expect(markup).not.toContain('<b>child-friendly</b>');
    expect(markup).not.toContain('<i>palette</i>');
    expect(markup).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(markup).toContain('&lt;b&gt;child-friendly&lt;/b&gt;');
  });

  it('shows decision, rule, severity, evidence, explanation and the kind', () => {
    const markup = render(advisory());
    expect(markup).toContain(DECISION_ID);
    expect(markup).toContain('countdown-mechanics');
    expect(markup).toContain('severity: high');
    expect(markup).toContain('detected violation');
    expect(markup).toContain('decision prohibits countdown mechanics');
    expect(markup).toContain('Evidence excerpt');
    expect(markup).toContain('constraint not verified');
    expect(markup).toContain('superseded decision text not supplied');
    expect(markup).toContain('VIOLATION DETECTED');
  });

  it('never claims compliance when a supported check passes with an unverified constraint', () => {
    const markup = render(
      advisory({
        engine_verdict: 'PASS',
        assessment: 'not_verified',
        findings: [],
        unverified: advisory().unverified,
      }),
    );
    expect(markup).toContain('NOT VERIFIED');
    expect(markup).not.toContain('PASS');
    expect(markup).not.toContain('compliant');
  });

  it('describes a clean supported pass without claiming complete compliance', () => {
    const markup = render(
      advisory({
        engine_verdict: 'PASS',
        assessment: 'no_violation_detected',
        assessment_reason:
          'No violation was detected by the supported checks. This is not a certification that every remembered decision was verified.',
        findings: [],
        unverified: [],
        superseded_memory_ids: [],
      }),
    );
    expect(markup).toContain('NO VIOLATION DETECTED · SUPPORTED CHECKS');
    expect(markup).toContain('not a certification');
    expect(markup).toContain('Supported checks only');
    expect(markup).not.toContain('PASS (advisory)');
    expect(markup).not.toContain('compliant');
  });

  it('distinguishes an unavailable evaluation from an unverified constraint', () => {
    const markup = render(
      advisory({
        engine_verdict: 'UNVERIFIED',
        assessment: 'evaluation_unavailable',
        assessment_reason: 'Decision Guard did not complete, so no compliance is claimed.',
        findings: [],
        unverified: [],
      }),
    );
    expect(markup).toContain('EVALUATION UNAVAILABLE');
    expect(markup).toContain('no compliance is claimed');
  });

  it('does not claim compliance when no snapshot exists', () => {
    const markup = render(null);
    expect(markup).toContain('Decision Guard — Advisory');
    expect(markup).toContain('NOT EVALUATED');
    expect(markup).toContain('compliance was not checked');
    expect(markup).not.toContain('PASS');
    expect(markup).not.toContain('compliant');
  });
});
