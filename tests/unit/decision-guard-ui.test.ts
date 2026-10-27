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
    engine_version: '1.0.0',
    engine_verdict: 'BLOCK',
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
    expect(markup).toContain('unverified constraint');
    expect(markup).toContain('superseded decision text not supplied');
  });

  it('never shows a green PASS while a relevant decision is unverified', () => {
    const markup = render(
      advisory({ engine_verdict: 'PASS', findings: [], unverified: advisory().unverified }),
    );
    expect(markup).toContain('UNVERIFIED');
    expect(markup).not.toContain('PASS (advisory)');
  });

  it('shows PASS only when the engine passes and nothing is unverified', () => {
    const markup = render(
      advisory({ engine_verdict: 'PASS', findings: [], unverified: [], superseded_memory_ids: [] }),
    );
    expect(markup).toContain('PASS (advisory)');
    expect(markup).toContain('Findings do not block approval in this version.');
  });

  it('does not claim compliance when no snapshot exists', () => {
    const markup = render(null);
    expect(markup).toContain('Decision Guard — Advisory');
    expect(markup).toContain('NOT EVALUATED');
    expect(markup).toContain('compliance was not checked');
    expect(markup).not.toContain('PASS (advisory)');
  });
});
