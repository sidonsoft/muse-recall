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
 */
import type {
  VisualReviewFinding,
  VisualReviewUnverified,
} from '../../packages/shared/src/media.js';

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
  readonly groundedEvidence: boolean;
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

  const flagged = contradicted.some((finding) => finding.verdict === 'possible_conflict');
  const falseConflict = honoured.some((finding) => finding.verdict === 'possible_conflict');
  const groundedEvidence = contradicted.some((finding) =>
    REVIEW_PROBE.contradictedEvidenceTokens.some((token) =>
      finding.evidence.toLowerCase().includes(token),
    ),
  );

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
  if (!groundedEvidence) {
    issues.push(
      `no evidence string for the countdown decision mentions any of: ${REVIEW_PROBE.contradictedEvidenceTokens.join(', ')}`,
    );
  }
  if (findings.length === 0 && unverified.length === 0) {
    issues.push(
      'the model returned neither findings nor unverified entries — nothing was assessed',
    );
  }
  return { issues, rows, flagged, falseConflict, groundedEvidence };
}
