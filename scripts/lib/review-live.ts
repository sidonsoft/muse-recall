/**
 * A live screenshot review that can be scored, not just read.
 *
 * Batch E's review path has only ever been exercised against a stub provider, so
 * nothing in this tree says whether a real vision model returns findings that
 * point at what is actually in the frame. This module defines the probe: one
 * frame with two facts a reader can verify by eye, two pinned decisions (one the
 * frame satisfies, one it contradicts), and the scoring rules the run applies.
 *
 * A screenshot review is advisory by contract, so the score is deliberately
 * narrow: it asks whether the model pointed at the right decision for the right
 * visible reason, and whether it invented a conflict where the frame shows
 * agreement. It does not claim to measure whether the app is good.
 *
 * What the grounding check is, precisely: a **lexical** test over the evidence
 * string of the finding that raised the conflict. It requires that string to name
 * a fact the frame really contains, and refuses evidence that says that fact is
 * absent ("there is no countdown timer anywhere"). It cannot decide whether the
 * model actually saw the frame — an answer that paraphrases well is not proof of
 * perception. That limit travels with the score under the name `lexicalGrounding`,
 * so no reader takes it for a semantic judgement.
 */
import type {
  VisualReviewFinding,
  VisualReviewUnverified,
} from '../../packages/shared/src/media.js';
import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace.ts';

export const REVIEW_PROBE = {
  /** The fixture app rendered by the run, and what is visible in it. */
  frame: {
    title: 'Orb Runner',
    topBar: 'SCORE 120',
    countdown: 'COUNTDOWN 10',
    tokens: ['score', 'countdown', 'timer', 'orb runner'],
  },
  decisions: [
    {
      key: 'contradicted',
      // The frame shows a countdown, so this accepted constraint is the one at
      // odds with what is on screen.
      type: 'constraint',
      content: 'Never show a countdown timer in the game UI.',
      tags: ['ui', 'timer'],
    },
    {
      key: 'honoured',
      // The frame shows the score in the top bar, so this preference is met.
      type: 'preference',
      content: "Show the player's current score in the top bar.",
      tags: ['ui', 'score'],
    },
  ],
  /** The frame shows a countdown, so this decision is the one at odds with it. */
  contradictedKey: 'contradicted',
  /** The frame shows a score in the top bar, so this one is satisfied. */
  honouredKey: 'honoured',
  /** Evidence for the contradicted decision must name something actually on screen. */
  contradictedEvidenceTokens: ['countdown', 'timer'],
} as const;

export interface ProbeVerdictRow {
  readonly decision_id: string;
  readonly verdict: string;
  readonly evidence: string;
  readonly confidence: number;
}

export interface ProbeScore {
  readonly issues: string[];
  readonly rows: ProbeVerdictRow[];
  /** Did the frame's contradictable decision get flagged? */
  readonly flagged: boolean;
  /** Did the satisfied decision get flagged as if it were in conflict? */
  readonly falseConflict: boolean;
  /** The flagging finding's own evidence names a fact the frame contains. */
  readonly lexicalGrounding: boolean;
  /** The flagging finding's evidence says such a fact is *not* in the frame. */
  readonly evidenceDeniesTheFrame: boolean;
  /** Rules this score applies, kept beside the score so a reader sees the bar. */
  readonly limits: readonly string[];
}

/**
 * Evidence that names a countdown/timer in order to say it is **not in the frame**.
 *
 * A bare negation word anywhere is not enough, and the first version of this rule
 * proved it: "A countdown timer is visible despite the instruction not to show one"
 * is a correct reading of the fixture, yet it was scored as if the model had denied
 * the timer — turning a good paid answer into a reported model failure. So the
 * denial has to be an absence construction *about* the countdown/timer, within one
 * clause of it. Ambiguous negation is left alone: the score stops asserting that the
 * evidence denies the frame, and the wording still reaches a human reader.
 */
const FRAME_FACT = 'countdown|timer|counter';
const ABSENCE_BEFORE_FACT = new RegExp(
  String.raw`\b(no|not|never|none|without|absent|missing|lacks?|free of|clear of|devoid of)\b[^.!?;]{0,40}\b(?:${FRAME_FACT})\b`,
  'i',
);
const ABSENCE_AFTER_FACT = new RegExp(
  String.raw`\b(?:${FRAME_FACT})\b[^.!?;]{0,40}\b(absent|missing|nowhere|not\s+(?:present|visible|shown|displayed|there|to\s+be\s+seen))\b`,
  'i',
);

/** True when the evidence says the frame does *not* contain the fact it cites. */
export function evidenceDeniesFrame(evidence: string): boolean {
  return ABSENCE_BEFORE_FACT.test(evidence) || ABSENCE_AFTER_FACT.test(evidence);
}

/**
 * Score one live review against the probe.
 *
 * `ids` maps the probe keys to the memory ids the run created, so the scoring
 * never has to guess which finding belongs to which decision.
 */
export function scoreReviewProbe(
  findings: readonly VisualReviewFinding[],
  unverified: readonly VisualReviewUnverified[],
  ids: Record<string, string>,
): ProbeScore {
  const issues: string[] = [];
  const rows: ProbeVerdictRow[] = findings.map((finding) => ({
    decision_id: finding.decision_id,
    verdict: finding.verdict,
    evidence: finding.evidence,
    confidence: finding.confidence,
  }));

  const selected = new Set(Object.values(ids));
  const stray = findings.filter((finding) => !selected.has(finding.decision_id));
  if (stray.length > 0) {
    issues.push(`${String(stray.length)} finding(s) named a decision that was not selected`);
  }

  const contradictedId = ids[REVIEW_PROBE.contradictedKey];
  const honouredId = ids[REVIEW_PROBE.honouredKey];
  const contradicted = findings.filter((finding) => finding.decision_id === contradictedId);
  const honoured = findings.filter((finding) => finding.decision_id === honouredId);

  const flagging = contradicted.filter((finding) => finding.verdict === 'possible_conflict');
  const flagged = flagging.length > 0;
  const falseConflict = honoured.some((finding) => finding.verdict === 'possible_conflict');
  // Grounding belongs to the finding that raised the conflict. A separate,
  // well-worded finding about the same decision cannot ground somebody else's
  // verdict, so the check runs over the flagging findings themselves.
  const groundedRows = flagging.filter(
    (finding) =>
      !evidenceDeniesFrame(finding.evidence) &&
      REVIEW_PROBE.contradictedEvidenceTokens.some((token) =>
        finding.evidence.toLowerCase().includes(token),
      ),
  );
  const lexicalGrounding = groundedRows.length > 0;
  const evidenceDeniesTheFrame = flagging.some((finding) => evidenceDeniesFrame(finding.evidence));

  if (!flagged) {
    issues.push(
      'the frame shows a countdown timer, and no finding marked the countdown decision as a possible conflict',
    );
  }
  if (falseConflict) {
    issues.push(
      'the frame shows the score in the top bar, and a finding called that a possible conflict',
    );
  }
  if (!lexicalGrounding) {
    issues.push(
      `the finding that flagged the countdown decision cites none of the facts the frame contains: ${REVIEW_PROBE.contradictedEvidenceTokens.join(', ')}`,
    );
  }
  if (evidenceDeniesTheFrame) {
    issues.push(
      'the flagging evidence says a countdown/timer is *not* in the frame, which is the opposite of what the fixture renders',
    );
  }
  if (findings.length === 0 && unverified.length === 0) {
    issues.push(
      'the model returned neither findings nor unverified entries — nothing was assessed',
    );
  }
  return {
    issues,
    rows,
    flagged,
    falseConflict,
    lexicalGrounding,
    evidenceDeniesTheFrame,
    limits: [
      'grounding is lexical: the flagging evidence must name a fact the frame contains and must not deny it',
      'a lexical pass is not proof that the model perceived the frame; a human still reads the wording',
      'one still frame, one frame of one hand-authored app; nothing here measures app quality',
      'silence counts as nothing assessed, not as agreement',
    ],
  };
}

/** A screenshot review may touch one path, on one model, at most once. */
export const REVIEW_ALLOWED_PATHS = ['/v1/responses'] as const;

/**
 * Whole-run ledger problems a review run must refuse.
 *
 * Reporting the counts in the `finally` block is only half the job: an unanswered
 * start line means the run cannot know how many calls it paid, an orphan outcome
 * means an answer cannot be attributed, and any path outside `/v1/responses` is a
 * second capability being bought under a review budget.
 */
export function reviewLedgerIssues(ledger: DispatchAccount, expectedReviews: number): string[] {
  const issues = ledgerIntegrityIssues(ledger, 'review run');
  const outside = pathsOutside(ledger, REVIEW_ALLOWED_PATHS);
  if (outside.length > 0) {
    issues.push(`review run dispatched paths it was never allowed to touch: ${outside.join(', ')}`);
  }
  const reviews = ledger.dispatches.filter((d) => d.path === '/v1/responses').length;
  if (reviews !== expectedReviews) {
    issues.push(`expected ${String(expectedReviews)} review dispatch(es), saw ${String(reviews)}`);
  }
  return issues;
}
