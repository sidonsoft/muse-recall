/**
 * Phase 11C deterministic decision-aware evaluation.
 * Proves what the existing memory engine already delivers for the three
 * scenarios, and exercises the PROPOSED decision-guard as evaluation code.
 */

import { describe, expect, it } from 'vitest';
import { buildForgePromptForEval } from '../forge-memory/harness.js';
import {
  accessibilityGuard,
  buildDecisionReport,
  conflictHints,
  decisionGuard,
  decisionPromptFor,
  FIXTURES,
  paletteGuard,
  REQUESTS,
  retrieveDecision,
  SCENARIOS,
  setupDecision,
} from './decision-harness.js';

function soleDecision(retrieval: ReturnType<typeof retrieveDecision>) {
  const memory = retrieval.results[0]?.memory;
  if (!memory) throw new Error('expected the decision memory to be retrieved');
  return memory;
}

describe('scenario 1 — child-friendly game', () => {
  it('retrieves the design decision even though the request shares almost no words', () => {
    const s = setupDecision('s1');
    try {
      const retrieval = retrieveDecision(s.engine, REQUESTS.s1);
      expect(retrieval.results.map((r) => r.memory.id)).toContain(s.decisionId);
    } finally {
      s.close();
    }
  });

  it('injects decision AND rationale into the model prompt', () => {
    const s = setupDecision('s1');
    try {
      const prompt = decisionPromptFor(s.engine, REQUESTS.s1);
      expect(prompt).toContain(SCENARIOS.s1.content);
      expect(prompt).toContain(SCENARIOS.s1.rationale);
    } finally {
      s.close();
    }
  });

  it('decision guard flags all three prohibited mechanics and cites the decision id', () => {
    const s = setupDecision('s1');
    try {
      const retrieval = retrieveDecision(s.engine, REQUESTS.s1);
      const decision = soleDecision(retrieval);
      const issues = decisionGuard(FIXTURES.s1.violating, {
        id: decision.id,
        content: decision.content,
      });
      expect(issues.map((i) => i.check).sort()).toEqual([
        'no-countdown',
        'no-flashing',
        'no-penalty',
      ]);
      for (const issue of issues) expect(issue.decision_id).toBe(s.decisionId);
    } finally {
      s.close();
    }
  });

  it('compliant fixture passes the guard; conflict hints fire on risky wording', () => {
    const s = setupDecision('s1');
    try {
      const retrieval = retrieveDecision(s.engine, REQUESTS.s1);
      const decision = soleDecision(retrieval);
      expect(decisionGuard(FIXTURES.s1.compliant, decision)).toEqual([]);
      expect(conflictHints(REQUESTS.s1, decision)).not.toEqual([]);
    } finally {
      s.close();
    }
  });
});

describe('scenario 2 — accessibility', () => {
  it('retrieves the accessibility decision for the colour-framed request', () => {
    const s = setupDecision('s2');
    try {
      const retrieval = retrieveDecision(s.engine, REQUESTS.s2);
      expect(retrieval.results.map((r) => r.memory.id)).toContain(s.decisionId);
    } finally {
      s.close();
    }
  });

  it('detects colour-only distinctions and passes shape/label-differentiated designs', () => {
    const s = setupDecision('s2');
    try {
      const decision = soleDecision(retrieveDecision(s.engine, REQUESTS.s2));
      const issues = accessibilityGuard(FIXTURES.s2.violating, decision);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.check).toBe('no-colour-only-cue');
      expect(issues[0]?.decision_id).toBe(s.decisionId);
      expect(accessibilityGuard(FIXTURES.s2.compliant, decision)).toEqual([]);
      expect(conflictHints(REQUESTS.s2, decision)).not.toEqual([]);
    } finally {
      s.close();
    }
  });
});

describe('scenario 3 — corrected design decision', () => {
  it('retrieves only the corrected decision; superseded preference leaves active guidance', () => {
    const s = setupDecision('s3');
    try {
      const retrieval = retrieveDecision(s.engine, REQUESTS.s3);
      const ids = retrieval.results.map((r) => r.memory.id);
      expect(ids).toContain(s.correctedId);
      expect(ids).not.toContain(s.decisionId);
      const prompt = buildForgePromptForEval(retrieval, REQUESTS.s3);
      expect(prompt).toContain(SCENARIOS.s3.correctedContent ?? '');
      expect(prompt).not.toContain(SCENARIOS.s3.content);
    } finally {
      s.close();
    }
  });

  it('correction reason is auditable on the superseded record', () => {
    const s = setupDecision('s3');
    try {
      const history = s.engine.history(s.decisionId);
      const entry = history.find((e) => e.action === 'superseded');
      expect(entry?.reason).toBe(SCENARIOS.s3.correctionReason);
    } finally {
      s.close();
    }
  });

  it('palette guard catches reintroduction of the superseded sunset palette', () => {
    const s = setupDecision('s3');
    try {
      const decision = soleDecision(retrieveDecision(s.engine, REQUESTS.s3));
      const issues = paletteGuard(FIXTURES.s3.violating, decision);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.decision_id).toBe(s.correctedId);
      expect(paletteGuard(FIXTURES.s3.compliant, decision)).toEqual([]);
    } finally {
      s.close();
    }
  });
});

describe('cross-scenario report', () => {
  it('captures A-style evidence for all scenarios with JSON export', () => {
    const report = buildDecisionReport('0ce6444');
    const parsed = JSON.parse(JSON.stringify(report));
    expect(parsed.scenarios).toHaveLength(3);
    const [s1, s2, s3] = parsed.scenarios;
    for (const scenario of parsed.scenarios) {
      expect(scenario.prompt_contains.decision).toBe(true);
      expect(scenario.prompt_contains.rationale).toBe(true);
    }
    expect(s1.guard_violations_on_violating_fixture).toHaveLength(3);
    expect(s1.guard_violations_on_compliant_fixture).toEqual([]);
    expect(s2.guard_violations_on_violating_fixture).toHaveLength(1);
    expect(s2.guard_violations_on_compliant_fixture).toEqual([]);
    expect(s3.prompt_contains.superseded_decision_text).toBe(false);
    expect(s3.guard_violations_on_violating_fixture).toHaveLength(1);
    expect(parsed.boundaries.deterministic.length).toBeGreaterThan(0);
  });

  it('unused scenario requests remain byte-stable through the prompt mirror', () => {
    const s = setupDecision('s1');
    try {
      const prompt = decisionPromptFor(s.engine, REQUESTS.s1);
      expect(prompt.endsWith(REQUESTS.s1)).toBe(true);
    } finally {
      s.close();
    }
  });
});
