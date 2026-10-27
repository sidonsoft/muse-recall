/**
 * Phase 12D — accuracy harness: runs corpus cases through the pure Decision
 * Guard engine, classifies each against auditor ground truth, and computes
 * per-rule confusion metrics. No network, no model calls, no mutation.
 */

import {
  evaluateDecisions,
  type GuardRuleId,
  type GuardVerdict,
} from '../../../../packages/decision-guard/src/index.js';
import type { CorpusCase, GroundTruth } from './corpus.js';

/** Engine outcome for the rule under audit. NOT_EVALUATED = rule never fired. */
export type Observed = GuardVerdict | 'NOT_EVALUATED';

export type Classification =
  | 'TP' // violation, engine BLOCK
  | 'FN' // violation, engine claimed PASS
  | 'FP' // compliant, engine BLOCK
  | 'TN' // compliant, engine PASS
  | 'ABSTAIN' // engine UNVERIFIED / rule not evaluated (no claim made)
  | 'UNSOUND_PASS' // indeterminate fixture, engine claimed PASS
  | 'OVERBLOCK'; // indeterminate fixture, engine BLOCKed without proof

export interface CaseRow {
  id: string;
  rule: GuardRuleId;
  category: string;
  ground_truth: GroundTruth;
  ideal: GuardVerdict;
  observed: Observed;
  overall: GuardVerdict;
  classification: Classification;
  /** True when a BLOCK actually fired and the block was correct. */
  block_correct: boolean;
  /** True when a BLOCK fired on a fixture that does not violate the decision. */
  block_unsafe: boolean;
  matches_ideal: boolean;
}

export function runCase(testCase: CorpusCase): CaseRow {
  const result = evaluateDecisions(
    [...testCase.decisions],
    testCase.source,
    testCase.options ?? {},
  );
  const evaluation = result.evaluations.find((entry) => entry.rule === testCase.rule);
  const observed: Observed = evaluation ? evaluation.verdict : 'NOT_EVALUATED';
  return {
    id: testCase.id,
    rule: testCase.rule,
    category: testCase.category,
    ground_truth: testCase.ground_truth,
    ideal: testCase.ideal,
    observed,
    overall: result.verdict,
    classification: classify(testCase.ground_truth, observed),
    block_correct: observed === 'BLOCK' && testCase.ground_truth === 'violation',
    block_unsafe: observed === 'BLOCK' && testCase.ground_truth !== 'violation',
    matches_ideal: observed === testCase.ideal,
  };
}

export function runCorpus(cases: readonly CorpusCase[]): CaseRow[] {
  return cases.map((testCase) => runCase(testCase));
}

export function classify(groundTruth: GroundTruth, observed: Observed): Classification {
  if (observed === 'UNVERIFIED' || observed === 'NOT_EVALUATED') return 'ABSTAIN';
  if (groundTruth === 'violation') return observed === 'BLOCK' ? 'TP' : 'FN';
  if (groundTruth === 'compliant') return observed === 'BLOCK' ? 'FP' : 'TN';
  return observed === 'BLOCK' ? 'OVERBLOCK' : 'UNSOUND_PASS';
}

export interface RuleMetrics {
  rule: GuardRuleId;
  cases: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  abstain: number;
  unsound_pass: number;
  overblock: number;
  /** null when the denominator is zero — never reported as 0 or NaN. */
  precision: number | null;
  recall: number | null;
  false_positive_rate: number | null;
  false_negative_rate: number | null;
  /** Blocks fired on non-violating fixtures / all blocks fired. */
  unsafe_block_rate: number | null;
  /** UNVERIFIED / NOT_EVALUATED share of this rule's cases. */
  abstention_rate: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(3));
}

export function metricsForRule(rows: readonly CaseRow[], rule: GuardRuleId): RuleMetrics {
  const scoped = rows.filter((row) => row.rule === rule);
  const count = (classification: Classification) =>
    scoped.filter((row) => row.classification === classification).length;
  const tp = count('TP');
  const fp = count('FP');
  const tn = count('TN');
  const fn = count('FN');
  const abstain = count('ABSTAIN');
  const blocks = scoped.filter((row) => row.observed === 'BLOCK').length;
  const unsafeBlocks = scoped.filter((row) => row.block_unsafe).length;
  return {
    rule,
    cases: scoped.length,
    tp,
    fp,
    tn,
    fn,
    abstain,
    unsound_pass: count('UNSOUND_PASS'),
    overblock: count('OVERBLOCK'),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    false_positive_rate: ratio(fp, fp + tn),
    false_negative_rate: ratio(fn, tp + fn),
    unsafe_block_rate: ratio(unsafeBlocks, blocks),
    abstention_rate: ratio(abstain, scoped.length),
  };
}

export function metricsForRules(
  rows: readonly CaseRow[],
  rules: readonly GuardRuleId[],
): RuleMetrics[] {
  return rules.map((rule) => metricsForRule(rows, rule));
}
