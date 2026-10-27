/**
 * Phase 12B — deterministic Decision Guard engine tests (acceptance list §6).
 * Pure engine: no server, db, browser, or model calls.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateDecisions,
  type GuardDecision,
  MAX_SOURCE_CHARS,
  RULE_ORDER,
  toValidationIssues,
} from '../../../packages/decision-guard/src/index.js';

const CHILD_DECISION: GuardDecision = {
  id: 'dec-child',
  content:
    'This game is intended for children aged 5-8. Avoid flashing effects, countdown timers, and penalties for mistakes.',
  status: 'active',
  supersedes: [],
};

const A11Y_DECISION: GuardDecision = {
  id: 'dec-a11y',
  content: 'All essential game actions must remain usable without colour discrimination.',
  status: 'active',
  supersedes: [],
};

const OCEAN_DECISION: GuardDecision = {
  id: 'dec-ocean',
  content:
    'The game should use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.',
  status: 'active',
  supersedes: ['dec-sunset'],
};

const SUNSET_SUPERSEDED: GuardDecision = {
  id: 'dec-sunset',
  content: 'The game should use a warm sunset palette. Primary accent #FF7E5F.',
  status: 'superseded',
  supersedes: [],
};

const PHASER =
  '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>';

describe('guard engine — 18 acceptance cases', () => {
  it('1. explicit countdown violation blocks and cites evidence', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<div id="countdown">10</div><script>let timeLeft = 10; setInterval(function tick(){ timeLeft -= 1; render(timeLeft); }, 1000);</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'countdown-mechanics');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.blocks_approval).toBe(true);
    expect(evaluation?.findings[0]?.evidence).toContain('timeLeft');
    expect(evaluation?.findings[0]?.decision_id).toBe('dec-child');
  });

  it('2. benign elapsed-time counter passes', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>let elapsed = 0; setInterval(function tick(){ elapsed += 1; render(elapsed); }, 1000);</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'countdown-mechanics');
    expect(evaluation?.verdict).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('3. explicit flashing violation blocks', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<style>@keyframes blinkBanner { 50% { opacity: 0 } } .banner { animation: blinkBanner 0.4s infinite }</style>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'flashing-effects');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.evidence).toContain('blink');
  });

  it('4. ordinary animation passes', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<style>@keyframes bounce { 50% { transform: translateY(-8px) } } .card { transition: transform 0.2s; animation: bounce 0.3s ease }</style>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'flashing-effects');
    expect(evaluation?.verdict).toBe('PASS');
  });

  it('5. explicit mistake penalty blocks', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>function onWrong() { score -= 5; updateScore(); }</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'mistake-penalty');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.explanation).toContain('prohibits punishing mistakes');
  });

  it('6. ordinary score increase passes', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>function onPick() { score += 10; score = score + bonus; renderScore(); }</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'mistake-penalty');
    expect(evaluation?.verdict).toBe('PASS');
  });

  it('7. corrected-palette violation blocks citing the active corrected decision', () => {
    const result = evaluateDecisions(
      [OCEAN_DECISION],
      `${PHASER}<style>:root { --accent: #FF7E5F; }</style>`,
      { supersededDecisions: [SUNSET_SUPERSEDED] },
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'superseded-palette');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.decision_id).toBe('dec-ocean');
    expect(evaluation?.findings[0]?.evidence.toUpperCase()).toContain('#FF7E5F');
  });

  it('8. corrected-palette compliance passes', () => {
    const result = evaluateDecisions(
      [OCEAN_DECISION],
      `${PHASER}<style>:root { --accent: #4EA8DE; --ink: #102A43; }</style>`,
      { supersededDecisions: [SUNSET_SUPERSEDED] },
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'superseded-palette');
    expect(evaluation?.verdict).toBe('PASS');
    expect(result.verdict).toBe('PASS');
  });

  it('9. superseded decisions are excluded as active constraints', () => {
    const result = evaluateDecisions(
      [SUNSET_SUPERSEDED],
      `${PHASER}<style>:root{--accent:#4EA8DE}</style>`,
    );
    expect(result.excluded_decision_ids).toEqual(['dec-sunset']);
    expect(result.evaluations).toEqual([]);
    expect(result.findings).toEqual([]);
    // Excluded constraint coverage must not masquerade as compliance.
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('10. provable colour-only cue blocks', () => {
    const result = evaluateDecisions(
      [A11Y_DECISION],
      `${PHASER}<script>collectibleA.fill = "#FF0000"; collectibleB.fill = "#00FF00";</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'colour-only-cue');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.rule).toBe('colour-only-cue');
  });

  it('11. ambiguous colour cue returns UNVERIFIED, never PASS or BLOCK', () => {
    const padded =
      '<div class="instructions">Shape and pattern guide every element in this game. '.padEnd(
        200,
        'x',
      );
    const filler = `${padded}</div>`;
    const result = evaluateDecisions(
      [A11Y_DECISION],
      `${PHASER}${filler}<script>collectibleA.fill = "#FF0000"; collectibleB.fill = "#00FF00";</script>`,
    );
    const evaluation = result.evaluations.find((e) => e.rule === 'colour-only-cue');
    expect(evaluation?.verdict).toBe('UNVERIFIED');
  });

  it('12. unsupported decision returns UNVERIFIED (never falsely compliant)', () => {
    const rounded: GuardDecision = {
      id: 'dec-rounded',
      content: 'Prefer rounded corners on all game panels.',
      status: 'active',
      supersedes: [],
    };
    const result = evaluateDecisions(
      [rounded],
      `${PHASER}<style>.panel { border-radius: 12px }</style>`,
    );
    expect(result.verdict).toBe('UNVERIFIED');
    expect(result.evaluations[0]?.rule).toBe('none-applicable');
    expect(result.evaluations[0]?.reason).toContain('cannot be claimed');
  });

  it('13. multiple findings follow the fixed rule order', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<div id="countdown">10</div><style>@keyframes blinkBanner { 50% { opacity: 0 } }</style><script>setInterval(function tick(){ timeLeft -= 1; }, 1000); function wrong(){ score -= 1; }</script>`,
    );
    expect(result.verdict).toBe('BLOCK');
    const rules = result.findings.map((f) => f.rule);
    expect(rules).toEqual(['countdown-mechanics', 'flashing-effects', 'mistake-penalty']);
    expect(rules).toEqual(RULE_ORDER.filter((rule) => rules.includes(rule)));
    expect(result.findings.every((f) => f.blocks_approval)).toBe(true);
  });

  it('14. project isolation at the caller boundary: findings cite only passed decisions', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION, A11Y_DECISION],
      `${PHASER}<script>collectibleA.fill = "#FF0000"; collectibleB.fill = "#00FF00";</script>`,
    );
    for (const finding of result.findings) {
      expect(finding.decision_id).toBe('dec-a11y');
    }
    const childEvaluations = result.evaluations.filter((e) => e.decision_id === 'dec-child');
    expect(childEvaluations.every((e) => e.verdict === 'PASS')).toBe(true);
  });

  it('15. malformed inputs produce UNVERIFIED with warnings', () => {
    const notArray = evaluateDecisions(null as unknown as GuardDecision[], 'source');
    expect(notArray.verdict).toBe('UNVERIFIED');
    expect(notArray.input_warnings).toContain('malformed_input:decisions_not_array');

    const badEntry = evaluateDecisions(
      [{ id: 42 } as unknown as GuardDecision, CHILD_DECISION],
      `${PHASER}`,
    );
    expect(badEntry.input_warnings).toContain('malformed_input:decision_rejected');
    expect(badEntry.evaluations.every((e) => e.decision_id === 'dec-child')).toBe(true);

    const badSource = evaluateDecisions([CHILD_DECISION], null as unknown as string);
    expect(badSource.verdict).toBe('UNVERIFIED');
    expect(badSource.input_warnings).toContain('malformed_input:source_not_string');
  });

  it('16. oversized source is UNVERIFIED, never PASS', () => {
    const huge = `${PHASER}${'a'.repeat(MAX_SOURCE_CHARS + 1)}`;
    const result = evaluateDecisions([CHILD_DECISION, A11Y_DECISION], huge);
    expect(result.verdict).toBe('UNVERIFIED');
    expect(result.input_warnings).toContain('source_oversized');
    expect(result.findings).toEqual([]);
  });

  it('17. deterministic across repeated runs', () => {
    const source = `${PHASER}<div id="countdown">10</div><script>setInterval(function tick(){ timeLeft -= 1; score -= 1; }, 1000);</script>`;
    const first = JSON.stringify(evaluateDecisions([CHILD_DECISION, A11Y_DECISION], source));
    const second = JSON.stringify(evaluateDecisions([CHILD_DECISION, A11Y_DECISION], source));
    expect(first).toBe(second);
  });

  it('18. inputs are never mutated', () => {
    const decisions = [
      OCEAN_DECISION,
      CHILD_DECISION,
      { ...SUNSET_SUPERSEDED, status: 'active' },
    ] as GuardDecision[];
    const before = structuredClone(decisions);
    const source = `${PHASER}<style>:root{--accent:#4EA8DE}</style>`;
    const sourceBefore = source;
    evaluateDecisions(decisions, source, { supersededDecisions: [SUNSET_SUPERSEDED] });
    expect(decisions).toEqual(before);
    expect(source).toBe(sourceBefore);
  });
});

describe('v1.1.0 comment-masking regressions (Phase 12D accuracy fix)', () => {
  const verdictFor = (
    result: ReturnType<typeof evaluateDecisions>,
    rule: string,
  ): string | undefined => result.evaluations.find((e) => e.rule === rule)?.verdict;

  it('line comment naming a countdown does not block', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}// the old countdown ring lived here\nlet elapsed = 0;`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('PASS');
  });

  it('block comment naming a countdown does not block', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      '/* countdown UI experiment retired — see design notes */\ndealCards();',
    );
    expect(result.verdict).toBe('PASS');
  });

  it('HTML comment naming a countdown does not block', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      '<!-- the old countdown ring lived above the board -->\n<script>let elapsed = 0;</script>',
    );
    expect(result.verdict).toBe('PASS');
  });

  it('a "//" inside a string URL is not treated as a comment (real code still blocks)', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>let timeLeft = 10; timeLeft -= 1;</script>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
    expect(result.findings[0]?.evidence).toContain('timeLeft');
  });

  it('apostrophe in an HTML text node cannot swallow following live code', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `<p>Don't worry — the round simply ends.</p>\n<script>let timeLeft = 10; timeLeft -= 1;</script>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
  });

  it('superseded hex in a comment no longer blocks the corrected palette', () => {
    const result = evaluateDecisions(
      [OCEAN_DECISION],
      `/* the old accent was #FF7E5F before the rebrand */<style>:root { --accent: #4EA8DE; --ink: #102A43; }</style>`,
      { supersededDecisions: [SUNSET_SUPERSEDED] },
    );
    expect(verdictFor(result, 'superseded-palette')).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('comment-only red/green wording yields UNVERIFIED, never BLOCK', () => {
    const result = evaluateDecisions(
      [A11Y_DECISION],
      '// the old red/green pairing confused colour-blind players\napplyEmojiSet();',
    );
    expect(verdictFor(result, 'colour-only-cue')).toBe('UNVERIFIED');
  });

  it('commented animation/penalty wording no longer blocks', () => {
    const flash = evaluateDecisions(
      [CHILD_DECISION],
      '/* animation: flash 1s infinite — retired, replaced by static glow */\nbox.classList.add("glow");',
    );
    expect(verdictFor(flash, 'flashing-effects')).toBe('PASS');
    const penalty = evaluateDecisions(
      [CHILD_DECISION],
      '// score-- retired after playtest feedback\ncelebrateMatch();',
    );
    expect(verdictFor(penalty, 'mistake-penalty')).toBe('PASS');
  });

  it('evidence is still sliced from the ORIGINAL source around the live match', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      '// countdown retired\nlet timeLeft = 10;\ntimeLeft -= 1;',
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
    const evidence = result.findings[0]?.evidence ?? '';
    expect(evidence).toContain('let timeLeft = 10;');
  });
});

describe('integration adapter', () => {
  it('projects blocking findings into validation-issue strings and separates UNVERIFIED notes', () => {
    const result = evaluateDecisions([CHILD_DECISION], `${PHASER}<div id="countdown">10</div>`);
    const adapted = toValidationIssues(result);
    expect(adapted.blocking).toBe(true);
    expect(adapted.issues).toHaveLength(1);
    expect(adapted.issues[0]).toContain('[decision-guard:countdown-mechanics]');
    expect(adapted.unverified_notes).toEqual([]);

    const unverifiedOnly = evaluateDecisions(
      [
        {
          id: 'dec-rounded',
          content: 'Prefer rounded corners on all game panels.',
          status: 'active',
          supersedes: [],
        },
      ],
      `${PHASER}<style>.panel { border-radius: 12px }</style>`,
    );
    const adaptedNotes = toValidationIssues(unverifiedOnly);
    expect(adaptedNotes.blocking).toBe(false);
    expect(adaptedNotes.issues).toEqual([]);
    expect(adaptedNotes.unverified_notes.some((note) => note.includes('dec-rounded'))).toBe(true);
  });
});
