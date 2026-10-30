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

const WARM_WORDS_SUPERSEDED: GuardDecision = {
  id: 'dec-warm-words',
  content: 'Palette: warm — orange, gold and peach on a cream background.',
  status: 'superseded',
  supersedes: [],
};

const COOL_WORDS_ACTIVE: GuardDecision = {
  id: 'dec-cool-words',
  content:
    'Palette: cool — teal and navy on a soft white background. The warm orange palette is retired.',
  status: 'active',
  supersedes: ['dec-warm-words'],
};

const WARM_STYLESHEET = `:root{
  --orange:#e8862e; --gold:#e8a838; --peach:#f6c9a0;
  --cream:#fdf6ec; --ink:#4a3421; --soft:#fffdf8;
  --border:#e5cfae;
}
header{background:var(--orange);color:#fff}
.badge{background:var(--gold);color:#4a2c00}
.card h2{color:#8a4d12}
.btn-quiet{background:var(--peach);color:#4a2c00}
.book{border:2px solid var(--gold);background:#fff8ee}`;

const COOL_STYLESHEET = `:root{
  --teal:#0f766e; --aqua:#2aa198; --mist:#cde8e5;
  --paper:#f4f8fa; --navy:#1e3a5f; --white:#ffffff;
  --border:#b8d4d8;
}`;

const PHASER =
  '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>';

const verdictFor = (
  result: ReturnType<typeof evaluateDecisions>,
  rule: string,
): string | undefined => result.evaluations.find((entry) => entry.rule === rule)?.verdict;

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

describe('v1.2.0 palette notation equivalence', () => {
  const sourceFor = (value: string) => `${PHASER}<script>g.fillStyle(${value}, 1);</script>`;

  it('matches a 0x source against a #RRGGBB record and preserves provenance', () => {
    const result = evaluateDecisions([OCEAN_DECISION], sourceFor('0xff7e5f'), {
      supersededDecisions: [SUNSET_SUPERSEDED],
    });
    const evaluation = result.evaluations.find((entry) => entry.rule === 'superseded-palette');
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.findings[0]?.decision_id).toBe('dec-ocean');
    expect(evaluation?.findings[0]?.explanation).toContain('#FF7E5F');
    expect(evaluation?.findings[0]?.match_spans[0]).toBeDefined();
  });

  it('matches a #RRGGBB source against a 0xRRGGBB record', () => {
    const ocean = {
      ...OCEAN_DECISION,
      content: 'The game should use a cool ocean palette, accent 0x4EA8DE.',
    };
    const sunset = {
      ...SUNSET_SUPERSEDED,
      content: 'The game used a warm sunset palette, accent 0xFF7E5F.',
    };
    const result = evaluateDecisions([ocean], `${PHASER}<style>:root{--accent:#ff7e5f}</style>`, {
      supersededDecisions: [sunset],
    });
    expect(result.evaluations.find((entry) => entry.rule === 'superseded-palette')?.verdict).toBe(
      'BLOCK',
    );
  });

  it('is case-insensitive but deliberately does not widen to 8-digit RGBA hex', () => {
    const upper = evaluateDecisions([OCEAN_DECISION], sourceFor('0XFF7E5F'), {
      supersededDecisions: [SUNSET_SUPERSEDED],
    });
    expect(verdictFor(upper, 'superseded-palette')).toBe('BLOCK');

    const eightDigit = evaluateDecisions([OCEAN_DECISION], sourceFor('0xFF7E5FFF'), {
      supersededDecisions: [SUNSET_SUPERSEDED],
    });
    expect(verdictFor(eightDigit, 'superseded-palette')).toBe('UNVERIFIED');
  });

  it('still requires superseded history: no history supplied means UNVERIFIED', () => {
    const result = evaluateDecisions([OCEAN_DECISION], sourceFor('0xff7e5f'));
    expect(verdictFor(result, 'superseded-palette')).toBe('UNVERIFIED');
  });
});

describe('v1.3.0 palette family classification', () => {
  const paletteVerdict = (source: string) => {
    const result = evaluateDecisions([COOL_WORDS_ACTIVE], source, {
      supersededDecisions: [WARM_WORDS_SUPERSEDED],
    });
    return {
      result,
      evaluation: result.evaluations.find((entry) => entry.rule === 'superseded-palette'),
    };
  };

  it('blocks a warm stylesheet even though the superseded decision names no hexes', () => {
    const { evaluation } = paletteVerdict(WARM_STYLESHEET);
    expect(evaluation?.verdict).toBe('BLOCK');
    expect(evaluation?.reason).toContain('warm');
    expect(evaluation?.reason).toContain('cool');
    expect(evaluation?.reason.toUpperCase()).toContain('#E8862E');
    expect(evaluation?.reason.toUpperCase()).toContain('#E8A838');
    expect(evaluation?.findings[0]?.evidence).toContain('--orange');
    const span = evaluation?.findings[0]?.match_spans[0];
    expect(span).toBeDefined();
    expect(WARM_STYLESHEET.slice(span?.start, span?.end).toUpperCase()).toBe('#E8862E');
  });

  it('passes a cool stylesheet against the retired warm palette', () => {
    const { result, evaluation } = paletteVerdict(COOL_STYLESHEET);
    expect(evaluation?.verdict).toBe('PASS');
    expect(result.verdict).toBe('PASS');
  });

  it('abstains when both warm and cool saturated colours appear', () => {
    const { evaluation } = paletteVerdict(
      `<style>:root{--orange:#e8862e;--gold:#e8a838;--teal:#0f766e;--navy:#1e3a5f}</style>`,
    );
    expect(evaluation?.verdict).toBe('UNVERIFIED');
    expect(evaluation?.reason).toContain('mixed');
  });

  it('does not block on neutral colours alone', () => {
    const { result, evaluation } = paletteVerdict(
      `<style>:root{--cream:#fdf6ec;--white:#ffffff;--ink:#4a3421}</style>`,
    );
    expect(evaluation?.verdict).not.toBe('BLOCK');
    expect(evaluation?.reason).not.toContain('prose/comment');
    expect(result.findings).toEqual([]);
  });
});

describe('v1.2.0 countdown executable-vs-prose evidence', () => {
  it('abstains on HTML documentation instead of blocking it', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<p>This game has no countdown and no timer.</p>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(result.findings).toEqual([]);
  });

  it('abstains on an inert JavaScript string', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>const help = 'there is no countdown'; elapsed += 1;</script>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(result.findings).toEqual([]);
  });

  it('blocks an executable timer even when prose also mentions countdowns', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<p>No countdown here.</p><script>let timeLeft = 5; timeLeft -= 1;</script>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
    expect(result.findings[0]?.evidence).toContain('timeLeft');
  });

  it('keeps comments inert and does not treat inert attributes as mechanics', () => {
    const commented = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>// old countdown ring removed\nlet elapsed = 0;</script>`,
    );
    expect(verdictFor(commented, 'countdown-mechanics')).toBe('PASS');

    const attribute = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<div id="countdown" data-tip="timer">10</div>`,
    );
    expect(verdictFor(attribute, 'countdown-mechanics')).toBe('UNVERIFIED');
  });

  it('still evaluates executable code in inline event handlers', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<button onclick="timeLeft -= 1">tick</button>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
  });
});

describe('v1.4.0 hidden time pressure', () => {
  const SPRINT = `var SPRINT_LEN = 15*60*1000;
var sprintTimer = null;
function startSprint(){
  if(sprintTimer) window.clearTimeout(sprintTimer);
  sprintTimer = window.setTimeout(function(){
    sprintTimer = null;
    setSprintMsg('Reading time finished — great cozy reading!');
  }, SPRINT_LEN);
}`;

  const evaluate = (source: string) => evaluateDecisions([CHILD_DECISION], source);
  const countdown = (source: string) =>
    evaluate(source).evaluations.find((entry) => entry.rule === 'countdown-mechanics');

  it('abstains on a hidden 15-minute sprint timer', () => {
    const result = evaluate(SPRINT);
    const evaluation = countdown(SPRINT);
    expect(evaluation?.verdict).toBe('UNVERIFIED');
    expect(evaluation?.reason).toBe(
      'a 15-minute timer bounds an activity (setTimeout delay SPRINT_LEN = 15*60*1000); time pressure cannot be ruled out',
    );
    expect(evaluation?.findings).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.verdict).toBe('UNVERIFIED');
  });

  it('passes a 0 ms cleanup timer', () => {
    const result = evaluate(
      'setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);',
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('passes a one-second interval', () => {
    const result = evaluate('let tick = 0; setInterval(tick, 1000);');
    expect(verdictFor(result, 'countdown-mechanics')).toBe('PASS');
  });

  it('abstains on a literal 120000 ms timeout', () => {
    const result = evaluate('setTimeout(done, 120000);');
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(countdown('setTimeout(done, 120000);')?.reason).toContain(
      'a 2-minute timer bounds an activity (setTimeout delay 120000)',
    );
    expect(result.findings).toEqual([]);
  });

  it('resolves parenthesised constant arithmetic', () => {
    const result = evaluate('setTimeout(done, (2 + 0) * 60 * 1000);');
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
  });

  it('leaves a doubly assigned identifier unresolved', () => {
    const reassigned = 'var delay = 15*60*1000; delay = 0; setTimeout(done, delay);';
    const redeclared = 'var delay = 15*60*1000; var delay = 0; setTimeout(done, delay);';
    expect(verdictFor(evaluate(reassigned), 'countdown-mechanics')).toBe('PASS');
    expect(verdictFor(evaluate(redeclared), 'countdown-mechanics')).toBe('PASS');
  });

  it('reads nested timer calls without confusing their arguments', () => {
    const result = evaluate('setTimeout(() => setTimeout(done, 120000), 0);');
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(countdown('setTimeout(() => setTimeout(done, 120000), 0);')?.reason).toContain(
      'setTimeout delay 120000',
    );
    expect(result.findings).toEqual([]);
  });

  it('ignores timer text inside strings and comments', () => {
    const result = evaluate("const note = 'setTimeout(done, 120000)'; // setTimeout(done, 120000)");
    expect(verdictFor(result, 'countdown-mechanics')).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it.each([
    ['a method call', 'setTimeout(done, 60 * 1000 + Math.random())'],
    ['a decimal literal', 'setTimeout(done, 1.5 * 60000)'],
    ['a string literal', "setTimeout(done, '120000')"],
    ['a hexadecimal literal', 'setTimeout(done, 0xEA60)'],
    ['an identifier alias', 'var base = 120000; var delay = base; setTimeout(done, delay)'],
  ])('rejects %s instead of treating it as arithmetic', (_label, source) => {
    expect(verdictFor(evaluate(source), 'countdown-mechanics')).toBe('PASS');
  });
});

describe('v1.4.0 script-mode raw-text masking', () => {
  const evaluate = (source: string) => evaluateDecisions([CHILD_DECISION], source);
  const countdown = (source: string) =>
    evaluate(source).evaluations.find((entry) => entry.rule === 'countdown-mechanics');

  it('resolves a delay declared after a < comparison', () => {
    const source = `<script>
if(a<b){}
var L = 15*60*1000;
setTimeout(done, L);
</script>`;
    const result = evaluate(source);
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(countdown(source)?.reason).toContain('15-minute');
    expect(result.findings).toEqual([]);
  });

  it('resolves a delay declared after a for-loop comparison', () => {
    const source = '<script>for(var i=0;i<n;i++){} setTimeout(done, 120000);</script>';
    const result = evaluate(source);
    expect(verdictFor(result, 'countdown-mechanics')).toBe('UNVERIFIED');
    expect(countdown(source)?.reason).toContain('2-minute');
  });

  it('resolves the live sprint excerpt with its streak-loop comparisons', () => {
    const source = `<script>
function streakCount(){
  var c = 0, d = new Date(), guard = 0;
  if(!(state.logs[todayStr(d)]>0)) d.setDate(d.getDate()-1);
  while(((state.logs[todayStr(d)]||0)>0) && guard<3660){ c++; d.setDate(d.getDate()-1); guard++; }
  return c;
}
var SPRINT_LEN = 15*60*1000;
var sprintTimer = null;
function startSprint(){
  if(sprintTimer) window.clearTimeout(sprintTimer);
  sprintTimer = window.setTimeout(function(){ sprintTimer = null; }, SPRINT_LEN);
}
</script>`;
    const result = evaluate(source);
    const evaluation = countdown(source);
    expect(evaluation?.verdict).toBe('UNVERIFIED');
    expect(evaluation?.reason).toContain('15-minute');
    expect(evaluation?.reason).toContain('SPRINT_LEN = 15*60*1000');
    expect(result.findings).toEqual([]);
  });

  it('still blocks a countdown declared after a < comparison', () => {
    const result = evaluate(
      '<script>if(a<b){} var timeLeft = 30; setInterval(function(){ timeLeft--; }, 1000);</script>',
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
  });

  it('still treats </script> inside a JS string as string data', () => {
    const result = evaluate(
      `<script>var markup = '</script>'; var timeLeft = 30; timeLeft--;</script>`,
    );
    expect(verdictFor(result, 'countdown-mechanics')).toBe('BLOCK');
  });
});

describe('integration adapter', () => {
  it('projects blocking findings into validation-issue strings and separates UNVERIFIED notes', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `${PHASER}<script>let timeLeft = 10; timeLeft -= 1;</script>`,
    );
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

describe('v1.5.0 autoplay-media and external-assets families (roadmap G-7)', () => {
  const NO_AUTOPLAY: GuardDecision = {
    id: 'dec-noautoplay',
    content: 'Never autoplay audio or music; playback starts only on user action.',
    status: 'active',
    supersedes: [],
  };
  const SELF_CONTAINED: GuardDecision = {
    id: 'dec-selfcontained',
    content:
      'The app must stay self-contained: no external CDNs, scripts, fonts, or other remote assets.',
    status: 'active',
    supersedes: [],
  };

  it('extends the fixed rule order without renumbering the historical rules', () => {
    expect(RULE_ORDER).toEqual([
      'countdown-mechanics',
      'flashing-effects',
      'mistake-penalty',
      'superseded-palette',
      'colour-only-cue',
      'autoplay-media',
      'external-assets',
    ]);
  });

  it('blocks declared autoplay with exact spans', () => {
    const source = `<audio autoplay src="t.mp3"></audio>`;
    const result = evaluateDecisions([NO_AUTOPLAY], source);
    const autoplay = result.evaluations.find((entry) => entry.rule === 'autoplay-media');
    expect(autoplay?.verdict).toBe('BLOCK');
    expect(autoplay?.findings[0]?.severity).toBe('high');
    expect(autoplay?.findings[0]?.match_spans[0]?.start).toBe(0);
  });

  it('abstains on bare play calls: user-initiated playback cannot be proven statically', () => {
    const result = evaluateDecisions(
      [NO_AUTOPLAY],
      `<audio id="b" src="t.mp3"></audio><button onclick="document.getElementById('b').play()">Play</button>`,
    );
    expect(result.evaluations.find((entry) => entry.rule === 'autoplay-media')?.verdict).toBe(
      'UNVERIFIED',
    );
  });

  it('HTML-commented autoplay markup stays inert', () => {
    const result = evaluateDecisions([NO_AUTOPLAY], `<!-- <audio autoplay src="t.mp3"> -->`);
    expect(result.evaluations.find((entry) => entry.rule === 'autoplay-media')?.verdict).toBe(
      'PASS',
    );
  });

  it('blocks protocol-relative CDNs, remote CSS urls, and reports the earliest external hit', () => {
    const result = evaluateDecisions(
      [SELF_CONTAINED],
      `<script src="//cdn.example.org/lib.js"></script>
<style>@import url("https://fonts.example.org/x.css");</style>`,
    );
    const external = result.evaluations.find((entry) => entry.rule === 'external-assets');
    expect(external?.verdict).toBe('BLOCK');
    expect(external?.findings[0]?.severity).toBe('medium');
    expect(external?.findings[0]?.match_spans[0]?.start).toBe(0);
  });

  it('relative paths and data: URLs satisfy the self-contained decision', () => {
    const result = evaluateDecisions(
      [SELF_CONTAINED],
      `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<script src="game.js"></script>`,
    );
    expect(result.evaluations.find((entry) => entry.rule === 'external-assets')?.verdict).toBe(
      'PASS',
    );
    expect(result.verdict).toBe('PASS');
  });

  it('decisions that never mention the new families never activate them', () => {
    const result = evaluateDecisions(
      [CHILD_DECISION],
      `<audio autoplay></audio><script src="https://cdn.example.org/x.js"></script>`,
    );
    expect(result.evaluations.some((entry) => entry.rule === 'autoplay-media')).toBe(false);
    expect(result.evaluations.some((entry) => entry.rule === 'external-assets')).toBe(false);
  });
});
