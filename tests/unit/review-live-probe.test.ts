import { describe, expect, it } from 'vitest';
import type { VisualReviewFinding } from '../../packages/shared/src/media.js';
import { REVIEW_PROBE, scoreReviewProbe } from '../../scripts/lib/review-live.js';

const CONTRADICTED = '11111111-1111-4111-8111-111111111111';
const HONOURED = '22222222-2222-4222-8222-222222222222';
const IDS = { contradicted: CONTRADICTED, honoured: HONOURED };

function finding(
  decisionId: string,
  verdict: VisualReviewFinding['verdict'],
  evidence: string,
  confidence = 0.8,
): VisualReviewFinding {
  return {
    decision_id: decisionId,
    decision_excerpt: 'excerpt',
    decision_revision: 1,
    verdict,
    evidence,
    uncertainty: 'a single frame cannot show what happens after the count reaches zero',
    confidence,
  };
}

describe('scoring one live screenshot review', () => {
  it('accepts an answer that flags the visible conflict and leaves the met preference alone', () => {
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'A large "COUNTDOWN 10" label sits in the middle of the board.',
        ),
        finding(HONOURED, 'consistent', 'The top bar shows "SCORE 120" on the right.'),
      ],
      [],
      IDS,
    );
    expect(score.issues).toEqual([]);
    expect(score.flagged).toBe(true);
    expect(score.falseConflict).toBe(false);
    expect(score.groundedEvidence).toBe(true);
  });

  it('fails an answer that never flags the countdown the frame is showing', () => {
    const score = scoreReviewProbe(
      [
        finding(CONTRADICTED, 'consistent', 'No timer is visible in this frame.'),
        finding(HONOURED, 'consistent', 'Score shown at top.'),
      ],
      [],
      IDS,
    );
    expect(score.flagged).toBe(false);
    expect(score.issues.join(' ')).toContain('the frame shows a countdown timer');
  });

  it('does not count "unclear" as a flag, because unclear claims nothing', () => {
    const score = scoreReviewProbe(
      [finding(CONTRADICTED, 'unclear', 'There may be a timer, but the text is hard to read.')],
      [],
      IDS,
    );
    expect(score.flagged).toBe(false);
    expect(score.issues.join(' ')).toContain(
      'no finding marked the countdown decision as a possible conflict',
    );
  });

  it('fails an answer that invents a conflict against something the frame satisfies', () => {
    const score = scoreReviewProbe(
      [
        finding(CONTRADICTED, 'possible_conflict', 'A countdown timer is displayed.'),
        finding(HONOURED, 'possible_conflict', 'The score is too small to read comfortably.'),
      ],
      [],
      IDS,
    );
    expect(score.falseConflict).toBe(true);
    expect(score.issues.join(' ')).toContain('called that a possible conflict');
  });

  it('fails an answer whose evidence names nothing on screen', () => {
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'The interface uses a dark colour scheme with orange accents.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.groundedEvidence).toBe(false);
    expect(score.issues.join(' ')).toContain(
      'no evidence string for the countdown decision mentions',
    );
  });

  it('refuses a finding about a decision that was never selected', () => {
    const score = scoreReviewProbe(
      [
        finding(CONTRADICTED, 'possible_conflict', 'A countdown timer is displayed.'),
        finding(
          '33333333-3333-4333-8333-333333333333',
          'possible_conflict',
          'Something else entirely.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.issues.join(' ')).toContain('named a decision that was not selected');
  });

  it('treats silence as nothing assessed, not as agreement', () => {
    const score = scoreReviewProbe([], [], IDS);
    expect(score.issues.join(' ')).toContain('neither findings nor unverified entries');
    expect(score.flagged).toBe(false);
  });

  it('accepts an unanswered decision recorded as unverified, and still requires the visible conflict', () => {
    const score = scoreReviewProbe(
      [finding(CONTRADICTED, 'possible_conflict', 'The board shows "COUNTDOWN 10" in large text.')],
      [
        {
          decision_id: HONOURED,
          decision_excerpt: "Show the player's current score in the top bar.",
          decision_revision: 1,
          reason: 'the model did not report on this decision',
          uncertainty: 'not assessed',
        },
      ],
      IDS,
    );
    expect(score.issues).toEqual([]);
  });

  it('states the probe it scores against, so a passing run cannot be reinterpreted later', () => {
    expect(REVIEW_PROBE.contradictedEvidenceTokens).toEqual(['countdown', 'timer']);
    expect(REVIEW_PROBE.frame.countdown).toBe('COUNTDOWN 10');
    expect(REVIEW_PROBE.frame.topBar).toBe('SCORE 120');
    expect(REVIEW_PROBE.decisions.map((decision) => decision.key)).toEqual([
      'contradicted',
      'honoured',
    ]);
  });
});
