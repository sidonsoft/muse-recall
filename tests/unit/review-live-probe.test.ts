import { describe, expect, it } from 'vitest';
import type { VisualReviewFinding } from '../../packages/shared/src/media.js';
import { frameDenial, REVIEW_PROBE, scoreReviewProbe } from '../../scripts/lib/review-live.js';

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
    expect(score.lexicalGrounding).toBe(true);
    expect(score.evidenceDeniesTheFrame).toBe(false);
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
    expect(score.lexicalGrounding).toBe(false);
    expect(score.issues.join(' ')).toContain('cites none of the facts the frame contains');
  });

  it('refuses an evidence string that names the fact in order to deny it', () => {
    // The substring test alone passed this answer: it contains "countdown" and
    // "timer", while saying the frame shows neither. A flagging finding whose own
    // evidence denies the visible fact cannot be grounding for a conflict.
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'There is no countdown timer visible anywhere in this frame.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.flagged).toBe(true);
    expect(score.lexicalGrounding).toBe(false);
    expect(score.evidenceDeniesTheFrame).toBe(true);
    expect(score.issues.join(' ')).toContain('opposite of what the fixture renders');
  });

  it('grounds a verdict only in the finding that raised it', () => {
    // One finding raises the conflict with vague wording; another finding about
    // the same decision describes the frame but calls it consistent. The second
    // cannot retrofit grounding onto the first.
    const score = scoreReviewProbe(
      [
        finding(CONTRADICTED, 'possible_conflict', 'The interface is visually busy.'),
        finding(CONTRADICTED, 'consistent', 'A COUNTDOWN 10 label is displayed.'),
      ],
      [],
      IDS,
    );
    expect(score.flagged).toBe(true);
    expect(score.lexicalGrounding).toBe(false);
  });

  it('accepts the wording the retained live run actually produced', () => {
    // Verbatim evidence from test-results/review-live/2026-11-02-0451, re-scored
    // offline against the tightened rule: the run still passes it.
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          "there is a large centered yellow text reading 'COUNTDOWN 10' with subtext below it that mentions the round starting when the count reaches zero",
          0.95,
        ),
        finding(
          HONOURED,
          'consistent',
          "the top bar of the interface shows 'SCORE 120' in the upper-right corner",
          0.9,
        ),
      ],
      [],
      IDS,
    );
    expect(score.issues).toEqual([]);
    expect(score.lexicalGrounding).toBe(true);
    expect(score.evidenceDeniesTheFrame).toBe(false);
    expect(score.limits.join(' ')).toContain('lexical');
  });

  it('keeps a correct answer that mentions the instruction while naming the timer', () => {
    // The counterexample the follow-up review produced. A bare negation word
    // anywhere used to read as "the model denied the timer", which turned a good
    // paid answer into a reported model failure. This sentence says the timer is
    // visible; only the *instruction* is negated.
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'A countdown timer is visible despite the instruction not to show one.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.lexicalGrounding).toBe(true);
    expect(score.evidenceDeniesTheFrame).toBe(false);
    expect(score.issues).toEqual([]);
  });

  it('does not fail a correct answer that quotes the decision wording', () => {
    // Self-review found the narrowed rule was still too broad. The probe's decisions
    // literally read "Never show a countdown timer in the game UI.", so a model that
    // answers correctly is likely to echo that wording, and each sentence below puts an
    // absence construction right next to "timer" while asserting the opposite of a
    // denial. Failing them would burn a paid call on a harness defect — the KI-51
    // shape again, one layer up: a fixture (here, a mental model of English) that
    // matches the parser instead of the world.
    for (const evidence of [
      'The UI shows a countdown timer despite the instruction not to show a timer.',
      'The score sits in the top bar; the developer was told not to display a countdown, and one appears here.',
      'The rule says no countdown timer may appear, and one does, large and centred.',
    ]) {
      const score = scoreReviewProbe(
        [finding(CONTRADICTED, 'possible_conflict', evidence)],
        [],
        IDS,
      );
      expect(score.evidenceDeniesTheFrame).toBe(false);
      expect(score.issues).toEqual([]);
    }
  });

  it('separates a denial of the frame from a quotation of the decision', () => {
    // What the score cannot decide lexically it reports instead of guessing: an
    // ambiguous clause is surfaced, and the wording still reaches the human reader.
    expect(frameDenial('No countdown timer is present in the frame')).toEqual({
      denies: true,
      ambiguous: false,
    });
    expect(frameDenial('No countdown timer was asked for, and one is on screen.')).toEqual({
      denies: false,
      ambiguous: true,
    });
    expect(frameDenial('The countdown is absent from this screenshot.')).toEqual({
      denies: true,
      ambiguous: false,
    });
    expect(frameDenial('The top bar reads SCORE 120 in the corner.')).toEqual({
      denies: false,
      ambiguous: false,
    });
  });

  it('keeps denying the frame in sentences that mention the decision in passing', () => {
    // The other direction, found by self-review of the first narrowing attempt: the
    // draft list treated any mention of "decision", "conflict" or "violates" as a quote
    // of the instruction, which swallowed a plain denial. Both sentences below assert
    // that the frame lacks the thing the frame contains, whatever else they mention.
    for (const evidence of [
      'The frame contains no timer, so the decision is honoured.',
      'This conflicts with the recorded rule, and no counter appears anywhere.',
      'The decision is violated: a countdown never shows up in this screenshot.',
    ]) {
      expect(frameDenial(evidence).denies).toBe(true);
    }
  });

  it('still catches an absence claim about the countdown itself', () => {
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'The frame shows a countdown label, but no timer is present anywhere.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.evidenceDeniesTheFrame).toBe(true);
    expect(score.issues.join(' ')).toContain('opposite of what the fixture renders');
  });

  it('does not let a denial word inside another word trip the check', () => {
    const score = scoreReviewProbe(
      [
        finding(
          CONTRADICTED,
          'possible_conflict',
          'A prominent COUNTDOWN 10 counter sits above the note panel.',
        ),
      ],
      [],
      IDS,
    );
    expect(score.lexicalGrounding).toBe(true);
    expect(score.evidenceDeniesTheFrame).toBe(false);
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
