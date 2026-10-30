/**
 * Phase 12D — synthetic adversarial corpus for the Decision Guard audit.
 *
 * Deterministic, hand-authored source fixtures. Each case pins:
 *   - the rule under audit,
 *   - an adversarial category (violation, compliance, inert comment, inert
 *     string, rename, alt pattern, formatting, multi-construct, memory
 *     relevance, decision linking, negation scope, provenance missing),
 *   - auditor ground truth (does the fixture actually violate/comply with
 *     the decision, judged by reading the fixture),
 *   - the ideal verdict an honest engine should emit,
 *   - notes explaining the judgement.
 *
 * Ground truth is a property of the FIXTURE, not of the engine. The harness
 * records the engine verdict separately; correctness is derived at runtime.
 */

import type {
  GuardDecision,
  GuardOptions,
  GuardRuleId,
  GuardVerdict,
} from '../../../../packages/decision-guard/src/index.js';
import {
  DEC_ALL_RULES,
  DEC_AUTOMEDIA,
  DEC_AUTOMEDIA_EXPIRED,
  DEC_COLOUR,
  DEC_COUNTDOWN,
  DEC_COUNTDOWN_EXPIRED,
  DEC_EXT,
  DEC_EXT_EXPIRED,
  DEC_FLASH,
  DEC_FLASH_ALLOWED,
  DEC_FLASH_SUPERSEDED,
  DEC_MUSIC,
  DEC_PALETTE,
  DEC_PALETTE_COOL,
  DEC_PALETTE_LIME,
  DEC_PALETTE_MULTI,
  DEC_PALETTE_OLD,
  DEC_PALETTE_ORANGE,
  DEC_PALETTE_PLAIN,
  DEC_PALETTE_WARM_WORDS,
  DEC_PENALTY,
  DEC_PENALTY_SUPERSEDED,
  DEC_PENALTY_VERB,
  DEC_RED_GREEN,
  DEC_SOFT_PACE,
} from './decisions.js';

export const CDN =
  '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>';

export type GroundTruth = 'violation' | 'compliant' | 'indeterminate';

export type CorpusCategory =
  | 'violation-clear'
  | 'compliance-clear'
  | 'ambiguous'
  | 'comment-inert'
  | 'string-inert'
  | 'renamed'
  | 'alt-pattern'
  | 'formatting'
  | 'multi-construct'
  | 'memory-relevance'
  | 'decision-linking'
  | 'negation-scope'
  | 'provenance-missing';

export interface CorpusCase {
  id: string;
  rule: GuardRuleId;
  category: CorpusCategory;
  decisions: readonly GuardDecision[];
  options?: GuardOptions;
  source: string;
  ground_truth: GroundTruth;
  ideal: GuardVerdict;
  notes: string;
}

const OPT_PALETTE: GuardOptions = { supersededDecisions: [DEC_PALETTE_OLD] };

export const CORPUS: readonly CorpusCase[] = [
  // =========================================================================
  // Rule A — countdown-mechanics (decision: DEC_COUNTDOWN)
  // =========================================================================
  {
    id: 'A01',
    rule: 'countdown-mechanics',
    category: 'violation-clear',
    decisions: [DEC_COUNTDOWN],
    source: `${CDN}
let timeLeft = 30;
setInterval(() => { timeLeft--; updateHud(timeLeft); }, 1000);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Canonical countdown: named timeLeft, per-second decrement.',
  },
  {
    id: 'A02',
    rule: 'countdown-mechanics',
    category: 'violation-clear',
    decisions: [DEC_COUNTDOWN],
    source: `let countdown = 10;
hudDiv.textContent = countdown--;`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Variable literally named countdown, decremented for display.',
  },
  {
    id: 'A03',
    rule: 'countdown-mechanics',
    category: 'compliance-clear',
    decisions: [DEC_COUNTDOWN],
    source: `let elapsed = 0;
function onFrame(dt) { elapsed += dt; if (elapsed >= 45) finishLevel(); }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Elapsed-time accumulation, no visible drain.',
  },
  {
    id: 'A04',
    rule: 'countdown-mechanics',
    category: 'compliance-clear',
    decisions: [DEC_COUNTDOWN],
    source: `let gameClock = 0;
gameClock += dt;
label.setText('Played ' + Math.floor(gameClock) + 's');`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Stopwatch containing "Clock" but only ever incremented.',
  },
  {
    id: 'A05',
    rule: 'countdown-mechanics',
    category: 'ambiguous',
    decisions: [DEC_COUNTDOWN],
    source: `let secondsPlayed = 0;
function onFrame(dt) { secondsPlayed += dt; if (secondsPlayed >= 60) finishLevel(); }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Soft auto-finish at 60 s; no visible countdown. Arguable — could be seen as hidden time pressure.',
  },
  {
    id: 'A06',
    rule: 'countdown-mechanics',
    category: 'comment-inert',
    decisions: [DEC_COUNTDOWN],
    source: `// The previous build had a countdown ring here; removed after testing.
card.flipFace();`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Line comment mentions "countdown" historically; no live mechanic.',
  },
  {
    id: 'A07',
    rule: 'countdown-mechanics',
    category: 'comment-inert',
    decisions: [DEC_COUNTDOWN],
    source: `/* countdown UI experiment retired — see design notes */
dealCards();`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Block comment mentions "countdown"; no live mechanic.',
  },
  {
    id: 'A08',
    rule: 'countdown-mechanics',
    category: 'string-inert',
    decisions: [DEC_COUNTDOWN],
    source: `const helpText = 'Take your time: there is no countdown in this game.';
dialog.setText(helpText);`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'The word "countdown" appears only inside a reassuring UI string.',
  },
  {
    id: 'A09',
    rule: 'countdown-mechanics',
    category: 'renamed',
    decisions: [DEC_COUNTDOWN],
    source: `let secsLeft = 60;
function tick() { secsLeft -= 1; if (secsLeft <= 0) endRound(); }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'True countdown under renamed identifier (secsLeft); no "time"/"countdown" token.',
  },
  {
    id: 'A10',
    rule: 'countdown-mechanics',
    category: 'alt-pattern',
    decisions: [DEC_COUNTDOWN],
    source: `let remaining = 20;
const id = setInterval(() => { remaining = Math.max(0, remaining - 1); ring.redraw(remaining / 20); }, 1000);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Countdown implemented without tokens timeLeft/secondsLeft/countdown.',
  },
  {
    id: 'A11',
    rule: 'countdown-mechanics',
    category: 'formatting',
    decisions: [DEC_COUNTDOWN],
    source: `let time = 15;
function tick() {
  time
    --;
}`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Decrement operator split onto the next line by formatting.',
  },
  {
    id: 'A12',
    rule: 'countdown-mechanics',
    category: 'multi-construct',
    decisions: [DEC_COUNTDOWN],
    source: `let countdown = 5;
let timeLeft = countdown;
setInterval(() => { timeLeft--; paintBar(timeLeft); }, 1000);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Two matching constructs; engine reports only the first.',
  },
  {
    id: 'A13',
    rule: 'countdown-mechanics',
    category: 'memory-relevance',
    decisions: [DEC_COUNTDOWN, DEC_COUNTDOWN_EXPIRED],
    source: `let elapsed = 0;
function onFrame(dt) { elapsed += dt; }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Expired memory requiring countdowns must not enforce; active no-countdown decision applies.',
  },
  {
    id: 'A16',
    rule: 'countdown-mechanics',
    category: 'comment-inert',
    decisions: [DEC_COUNTDOWN],
    source: `<!-- the old countdown ring lived above the board -->
<script>let elapsed = 0;</script>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Countdown word inside an HTML comment.',
  },
  {
    id: 'A14',
    rule: 'countdown-mechanics',
    category: 'decision-linking',
    decisions: [DEC_SOFT_PACE],
    source: `${CDN}
let timeLeft = 30;
setInterval(() => { timeLeft--; updateHud(timeLeft); }, 1000);`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'Decision says "never show seconds left" without the word "countdown": rule never fires; honest UNVERIFIED expected.',
  },

  // =========================================================================
  // Rule B — flashing-effects (decision: DEC_FLASH)
  // =========================================================================
  {
    id: 'B01',
    rule: 'flashing-effects',
    category: 'violation-clear',
    decisions: [DEC_FLASH],
    source: `${CDN}
<style>
@keyframes blinkHint { 50% { opacity: 0; } }
.hint { animation: blinkHint 0.5s infinite; }
</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Infinite CSS blink keyframes.',
  },
  {
    id: 'B02',
    rule: 'flashing-effects',
    category: 'violation-clear',
    decisions: [DEC_FLASH],
    source: `setInterval(() => { banner.setVisible(!banner.visible); }, 400);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Interval toggling visibility — classic flash.',
  },
  {
    id: 'B03',
    rule: 'flashing-effects',
    category: 'compliance-clear',
    decisions: [DEC_FLASH],
    source: `title.setAlpha(1);
card.setScale(1.05);`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Static styling, no repeated toggling.',
  },
  {
    id: 'B04',
    rule: 'flashing-effects',
    category: 'compliance-clear',
    decisions: [DEC_FLASH],
    source: `this.tweens.add({ targets: overlay, alpha: { from: 0, to: 1 }, duration: 600 });`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'One-shot fade-in: a tween, not a repeated pulse.',
  },
  {
    id: 'B05',
    rule: 'flashing-effects',
    category: 'alt-pattern',
    decisions: [DEC_FLASH],
    source: `this.tweens.add({ targets: hint, alpha: 0.15, duration: 250, yoyo: true, repeat: -1 });`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Infinite alpha pulse via Phaser tween — documented engine gap (known FN).',
  },
  {
    id: 'B06',
    rule: 'flashing-effects',
    category: 'comment-inert',
    decisions: [DEC_FLASH],
    source: `/* animation: flash 1s infinite — retired, replaced by static glow */
box.classList.add('glow');`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'The retired animation lives only in a block comment.',
  },
  {
    id: 'B07',
    rule: 'flashing-effects',
    category: 'string-inert',
    decisions: [DEC_FLASH],
    source: `enemy.setName('Quickie Flash');`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: '"Flash" inside a name string with no visual effect.',
  },
  {
    id: 'B08',
    rule: 'flashing-effects',
    category: 'renamed',
    decisions: [DEC_FLASH],
    source: `let phase = 0;
function drawFrame(t) {
  phase += 0.2;
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 120);
  requestAnimationFrame(drawFrame);
}`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'rAF sine-driven alpha flicker; no flash/blink/interval tokens (documented FN).',
  },
  {
    id: 'B09',
    rule: 'flashing-effects',
    category: 'alt-pattern',
    decisions: [DEC_FLASH],
    source: `Phaser.Actions.ToggleVisibility(tiles, 6);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Library flash helper; no setInterval/keyframes tokens.',
  },
  {
    id: 'B10',
    rule: 'flashing-effects',
    category: 'formatting',
    decisions: [DEC_FLASH],
    source: `.card {
  animation
    : blink 1.2s infinite;
}`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'CSS declaration split across lines.',
  },
  {
    id: 'B11',
    rule: 'flashing-effects',
    category: 'multi-construct',
    decisions: [DEC_FLASH],
    source: `<style>
@keyframes flashBg { 50% { background: #ffffff; } }
@keyframes blinkDot { 50% { opacity: 0; } }
body { animation: flashBg 2s infinite; }
</style>
setInterval(() => { dot.setAlpha(0); }, 700);`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Three flashing constructs; engine reports only the first match.',
  },
  {
    id: 'B12',
    rule: 'flashing-effects',
    category: 'memory-relevance',
    decisions: [DEC_FLASH, DEC_FLASH_SUPERSEDED],
    source: `title.setAlpha(1);`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Superseded "flashing borders" style must not enforce; active ban does.',
  },
  {
    id: 'B13',
    rule: 'flashing-effects',
    category: 'alt-pattern',
    decisions: [DEC_FLASH],
    source: `setInterval(() => { ticker.setAlpha(1); ticker.x -= 2; }, 30);`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Scrolling ticker: interval touches setAlpha with a CONSTANT alpha — motion, not flashing.',
  },
  {
    id: 'B14',
    rule: 'flashing-effects',
    category: 'negation-scope',
    decisions: [DEC_FLASH_ALLOWED],
    source: `${CDN}
<style>
@keyframes blinkHint { 50% { opacity: 0; } }
.hint { animation: blinkHint 0.5s infinite; }
</style>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Decision BANS countdowns but EXPLICITLY ALLOWS brief flashing; negation matcher leaks "do not ... flash" scope across the semicolon and flags the allowed effect.',
  },

  // =========================================================================
  // Rule C — mistake-penalty (decision: DEC_PENALTY)
  // =========================================================================
  {
    id: 'C01',
    rule: 'mistake-penalty',
    category: 'violation-clear',
    decisions: [DEC_PENALTY],
    source: `function onWrong() { score -= 5; renderScore(); }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Direct score deduction for a wrong match.',
  },
  {
    id: 'C02',
    rule: 'mistake-penalty',
    category: 'violation-clear',
    decisions: [DEC_PENALTY],
    source: `let lives = 3;
function onMiss() { lives -= 1; if (lives <= 0) gameOver(); }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Life deduction on miss — a comparable mistake penalty.',
  },
  {
    id: 'C03',
    rule: 'mistake-penalty',
    category: 'compliance-clear',
    decisions: [DEC_PENALTY],
    source: `function onMatch() { score += 10; moves += 1; }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Score only increases.',
  },
  {
    id: 'C04',
    rule: 'mistake-penalty',
    category: 'ambiguous',
    decisions: [DEC_PENALTY],
    source: `const bonus = 100 - misses * 10;
awardScore(bonus);`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Misses shrink a bonus before awarding: graded reward, never a deduction from the score. Arguable.',
  },
  {
    id: 'C05',
    rule: 'mistake-penalty',
    category: 'comment-inert',
    decisions: [DEC_PENALTY],
    source: `// score-- retired after playtest feedback
celebrateMatch();`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Historical note "score--" inside a line comment.',
  },
  {
    id: 'C06',
    rule: 'mistake-penalty',
    category: 'string-inert',
    decisions: [DEC_PENALTY],
    source: `sign.setText('No points are lost: the score is never reduced!');`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: '"score is never reduced" inside a UI string describing compliance.',
  },
  {
    id: 'C07',
    rule: 'mistake-penalty',
    category: 'renamed',
    decisions: [DEC_PENALTY],
    source: `function onWrong() { points = points - 5; }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Penalty on renamed counter "points"; token "score" absent.',
  },
  {
    id: 'C08',
    rule: 'mistake-penalty',
    category: 'alt-pattern',
    decisions: [DEC_PENALTY],
    source: `if (wrong) { strikes += 1; if (strikes === 3) endRound(); }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Strike accumulator ending the round on mistakes; no score token. Arguable scope (decision words are score-centric).',
  },
  {
    id: 'C09',
    rule: 'mistake-penalty',
    category: 'alt-pattern',
    decisions: [DEC_PENALTY],
    source: `function reduceScoreboardPadding() { hud.setPadding(4); }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      '"reduce ... Score..." substring inside an identifier (Scoreboard padding layout), no penalty.',
  },
  {
    id: 'C10',
    rule: 'mistake-penalty',
    category: 'formatting',
    decisions: [DEC_PENALTY],
    source: `function onWrong() {
  score
    -= 5;
}`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Deduction split across lines.',
  },
  {
    id: 'C11',
    rule: 'mistake-penalty',
    category: 'multi-construct',
    decisions: [DEC_PENALTY],
    source: `function onWrong() { score -= 5; }
function onTimeout() { score -= 2; }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Two deduction sites; engine reports the first only.',
  },
  {
    id: 'C12',
    rule: 'mistake-penalty',
    category: 'memory-relevance',
    decisions: [DEC_PENALTY, DEC_MUSIC],
    source: `function onMatch() { score += 10; }`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Pre-v1.5.0 this music decision was out of scope (none-applicable UNVERIFIED kept the aggregate honest). ' +
      'Since v1.5.0 the autoplay-media rule checks it and abstains/passes on media-free sources — the corpus ' +
      'keeps this row to pin that coverage change.',
  },
  {
    id: 'C13',
    rule: 'mistake-penalty',
    category: 'memory-relevance',
    decisions: [DEC_PENALTY, DEC_PENALTY_SUPERSEDED],
    source: `function onWrong() { score -= 5; }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Superseded deduction memory excluded; active ban enforces.',
  },

  // =========================================================================
  // Rule D — superseded-palette (decision: DEC_PALETTE, history: DEC_PALETTE_OLD)
  // =========================================================================
  {
    id: 'D01',
    rule: 'superseded-palette',
    category: 'violation-clear',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --accent: #FF7E47; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Superseded hex live in a CSS custom property.',
  },
  {
    id: 'D02',
    rule: 'superseded-palette',
    category: 'compliance-clear',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --accent: #4FC3F7; --sky: #B3E5FC; }</style>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Required accent present, superseded hexes absent.',
  },
  {
    id: 'D03',
    rule: 'superseded-palette',
    category: 'comment-inert',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `// Legacy sunset theme: the header gradient used #FF7E47 before the rebrand.
<style>:root { --accent: #4FC3F7; }</style>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Forbidden hex appears only in a historical line comment.',
  },
  {
    id: 'D04',
    rule: 'superseded-palette',
    category: 'string-inert',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `changelogPanel.setText('Old swatch #FF7E47 kept for reference only');`,
    ground_truth: 'compliant',
    ideal: 'UNVERIFIED',
    notes:
      'Forbidden hex inside changelog text, not used as styling. Ideal: abstain; exact hex-in-string discrimination is not solvable without semantics.',
  },
  {
    id: 'D05',
    rule: 'superseded-palette',
    category: 'provenance-missing',
    decisions: [DEC_PALETTE],
    source: `<style>:root { --accent: #FF7E47; }</style>`,
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes:
      'Correction history not supplied via options; must abstain, never PASS/BLOCK on a guess.',
  },
  {
    id: 'D06',
    rule: 'superseded-palette',
    category: 'provenance-missing',
    decisions: [DEC_PALETTE_PLAIN],
    source: `<style>:root { --accent: #7E57C2; }</style>`,
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes: 'Palette decision that is not a correction (supersedes empty).',
  },
  {
    id: 'D07',
    rule: 'superseded-palette',
    category: 'formatting',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --accent: #4FC3F7; }
.btn { color: #FF7E47FF; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Superseded hue reintroduced as an 8-digit RGBA hex; the 6-hex regex word-boundary misses it.',
  },
  {
    id: 'D08',
    rule: 'superseded-palette',
    category: 'formatting',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --accent: #ff7e47; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Lowercase hex form.',
  },
  {
    id: 'D09',
    rule: 'superseded-palette',
    category: 'multi-construct',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --a: #FF7E47; --b: #FFB300; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Both superseded hexes present; single finding cites both.',
  },
  {
    id: 'D10',
    rule: 'superseded-palette',
    category: 'alt-pattern',
    decisions: [DEC_PALETTE_COOL],
    options: { supersededDecisions: [DEC_PALETTE_WARM_WORDS] },
    source: `<style>body { background: linear-gradient(180deg, #FFB300 0%, #FF7E47 100%); }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Superseded record has family words but NO hexes; v1.3.0 HSL family classification detects the warm source colours, so the violation now blocks.',
  },
  {
    id: 'D11',
    rule: 'superseded-palette',
    category: 'ambiguous',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<p>Warm golden-hour photos decorate the meadow intro.</p>
<style>:root { --accent: #4FC3F7; }</style>`,
    ground_truth: 'compliant',
    ideal: 'UNVERIFIED',
    notes:
      'Superseded family word "Warm" in prose while required hex present; engine skips the abstain branch once requiredPresent — family reintroduction is invisible.',
  },
  {
    id: 'D12',
    rule: 'superseded-palette',
    category: 'alt-pattern',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `btn.fill = 0xff7e47;`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Phaser numeric 0x hex form of the superseded colour. OBSERVED ABSTAIN: the engine extracts #RRGGBB and 0xRRGGBB tokens but never cross-matches notations — a superseded record written with "#" misses a 0x source use (equivalence gap).',
  },
  {
    id: 'D13',
    rule: 'superseded-palette',
    category: 'memory-relevance',
    decisions: [DEC_PALETTE_OLD],
    source: `<style>:root { --accent: #4FC3F7; }</style>`,
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes:
      'Only the superseded (inactive) record present: excluded, overall UNVERIFIED, never PASS.',
  },
  {
    id: 'D14',
    rule: 'superseded-palette',
    category: 'provenance-missing',
    decisions: [DEC_PALETTE_MULTI],
    options: { supersededDecisions: [DEC_PALETTE_LIME, DEC_PALETTE_ORANGE] },
    source: `<style>:root { --accent: #4FC3F7; }
.btn { border-color: #FF7E47; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Two superseded records; engine inspects only the FIRST found (lime), missing the orange violation.',
  },

  // =========================================================================
  // Rule E — colour-only-cue (decision: DEC_COLOUR)
  // =========================================================================
  {
    id: 'E01',
    rule: 'colour-only-cue',
    category: 'violation-clear',
    decisions: [DEC_COLOUR],
    source: `okTile.fillStyle = '#00FF00';
noTile.fillStyle = '#FF0000';`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Red/green differentiation with no non-colour cue anywhere.',
  },
  {
    id: 'E02',
    rule: 'colour-only-cue',
    category: 'compliance-clear',
    decisions: [DEC_COLOUR],
    source: `${CDN}
const legend = [
  { match: { fill: '#00FF00', shape: 'circle' } },
  { miss: { fill: '#FF0000', shape: 'square' } },
];`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Shape cue attached to each colour entry — the narrow PASS form.',
  },
  {
    id: 'E03',
    rule: 'colour-only-cue',
    category: 'ambiguous',
    decisions: [DEC_COLOUR],
    source: `<div class="legend">A shape and pattern guide every level.${'x'.repeat(200)}</div>
<script>okTile.fillStyle = '#00FF00'; noTile.fillStyle = '#FF0000';</script>`,
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes: 'Cue words exist but far from the colour references: correct abstain.',
  },
  {
    id: 'E04',
    rule: 'colour-only-cue',
    category: 'comment-inert',
    decisions: [DEC_COLOUR],
    source: `// The old red/green pairing confused colour-blind players.
applyEmojiSet();`,
    ground_truth: 'compliant',
    ideal: 'UNVERIFIED',
    notes: 'Red/green words only in a historical line comment; no live pairing.',
  },
  {
    id: 'E05',
    rule: 'colour-only-cue',
    category: 'string-inert',
    decisions: [DEC_COLOUR],
    source: `storyText.setText('The red dragon and the green knight guard the gate.');`,
    ground_truth: 'compliant',
    ideal: 'UNVERIFIED',
    notes: 'red/green in narrative text; no gameplay colour differentiation.',
  },
  {
    id: 'E06',
    rule: 'colour-only-cue',
    category: 'renamed',
    decisions: [DEC_COLOUR],
    source: `danger.setFill(0xe74c3c);
safe.setFill(0x27ae60);`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes: 'Red-ish/green-ish hexes outside the engine token list: honest abstain expected.',
  },
  {
    id: 'E07',
    rule: 'colour-only-cue',
    category: 'alt-pattern',
    decisions: [DEC_COLOUR],
    source: `go.setFill(0x00FF00);
stop.setFill(0xFF0000);`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'Exact red/green as 0x numerics — RED/GREEN_SOURCE only match #-hex and words (inconsistent with rule D which knows 0x).',
  },
  {
    id: 'E08',
    rule: 'colour-only-cue',
    category: 'formatting',
    decisions: [DEC_COLOUR],
    source: `.btnGo { background: GREEN; }
.btnStop { background: Red; }`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Mixed-case colour keywords.',
  },
  {
    id: 'E09',
    rule: 'colour-only-cue',
    category: 'multi-construct',
    decisions: [DEC_COLOUR],
    source: `goodCell.fill = '#2E8B57'; badCell.fill = '#DC143C';
gemGood.color = 'green'; gemBad.color = 'red';`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Two red/green pairs; one finding only.',
  },
  {
    id: 'E10',
    rule: 'colour-only-cue',
    category: 'ambiguous',
    decisions: [DEC_COLOUR],
    source: `const layout = { shape: 'rounded', gap: 8 };
board.add(
  { fill: 'green', w: 90 },
  { fill: 'red', w: 90 },
);`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'Unrelated layout "shape" within proximity window: engine narrow-PASSes while the buttons remain colour-only. Arguable but adversarial.',
  },
  {
    id: 'E11',
    rule: 'colour-only-cue',
    category: 'ambiguous',
    decisions: [DEC_COLOUR],
    source: `stage.background = 'solid purple';
go.setFill('#00FF00');
stop.setFill('#FF0000');`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      '"solid" (a background style word) counts as a non-colour cue: spurious narrow PASS for a real colour-only pair.',
  },
  {
    id: 'E12',
    rule: 'colour-only-cue',
    category: 'memory-relevance',
    decisions: [DEC_COLOUR],
    source: `title.setAlpha(1);
card.setScale(1.05);`,
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes: 'Relevant decision, no evaluable red/green pair: abstain, never PASS.',
  },
  {
    id: 'E13',
    rule: 'colour-only-cue',
    category: 'decision-linking',
    decisions: [DEC_RED_GREEN],
    source: `okTile.fillStyle = '#00FF00';
noTile.fillStyle = '#FF0000';`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'Decision words "red/green-only pairs" without "colour": only the flashing rule links; rule E never runs, so the aggregate can reach PASS on an unverified axis.',
  },
  {
    id: 'C14',
    rule: 'mistake-penalty',
    category: 'decision-linking',
    decisions: [DEC_PENALTY_VERB],
    source: `function onWrong() { score -= 5; }`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'Decision uses the verb "penalise"; the engine matcher only knows the nouns penalty/penalties (penalt\\w+), so rule C never fires: honest UNVERIFIED.',
  },
  {
    id: 'D15',
    rule: 'superseded-palette',
    category: 'renamed',
    decisions: [DEC_PALETTE],
    options: OPT_PALETTE,
    source: `<style>:root { --heroColor: #FF7E47; }</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Renamed CSS custom property cannot evade hex matching.',
  },
  {
    id: 'S3-DEC',
    rule: 'superseded-palette',
    category: 'memory-relevance',
    decisions: [DEC_ALL_RULES],
    source: `let timeLeft = 5;
setInterval(() => { timeLeft--; }, 1000);
<style>@keyframes blinkDot { 50% { opacity: 0; } }</style>
function onWrong() { score -= 1; }
go.setFill('#00FF00'); stop.setFill('#FF0000');`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'All five matchers fire from one decision; palette axis (under audit) abstains — no history supplied. Other axes block. Aggregate is sound.',
  },
  // =========================================================================
  // Rule F — autoplay-media (v1.5.0, decisions: DEC_AUTOMEDIA)
  // =========================================================================
  {
    id: 'F01',
    rule: 'autoplay-media',
    category: 'violation-clear',
    decisions: [DEC_AUTOMEDIA],
    source: `<audio autoplay src="assets/theme.mp3"></audio>
<button onclick="bgm.play()">Music</button>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Declarative autoplay attribute on an audio element.',
  },
  {
    id: 'F02',
    rule: 'autoplay-media',
    category: 'violation-clear',
    decisions: [DEC_AUTOMEDIA],
    source: `const bgm = new Audio('assets/theme.mp3');
bgm.autoplay = !0;
bgm.load();`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Autoplay set via the DOM property (minified true).',
  },
  {
    id: 'F03',
    rule: 'autoplay-media',
    category: 'compliance-clear',
    decisions: [DEC_AUTOMEDIA],
    source: `<audio id="bgm" src="assets/theme.mp3"></audio>
<button onclick="document.getElementById('bgm').play()">Play music</button>`,
    ground_truth: 'compliant',
    ideal: 'UNVERIFIED',
    notes:
      'Playback goes through .play(); whether it is user-initiated is not statically decidable, so an honest engine abstains rather than certifying PASS.',
  },
  {
    id: 'F04',
    rule: 'autoplay-media',
    category: 'compliance-clear',
    decisions: [DEC_AUTOMEDIA],
    source: `<div class="quiz"><h1>Quiz</h1><button id="next">Next</button></div>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'No media anywhere: the prohibited construct is provably absent.',
  },
  {
    id: 'F05',
    rule: 'autoplay-media',
    category: 'comment-inert',
    decisions: [DEC_AUTOMEDIA],
    source: `<!-- <audio autoplay src="assets/theme.mp3"> -->
// TODO: re-add the soundtrack (no autoplay!)
let question = 0;`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Autoplay markup lives only in an HTML comment and a line comment.',
  },
  {
    id: 'F06',
    rule: 'autoplay-media',
    category: 'string-inert',
    decisions: [DEC_AUTOMEDIA],
    source: `title.textContent = 'autoplay is off by design';`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'The word appears only as prose inside a string; no declaration construct matches.',
  },
  {
    id: 'F07',
    rule: 'autoplay-media',
    category: 'renamed',
    decisions: [DEC_AUTOMEDIA],
    source: `const media = new Audio('assets/theme.mp3');
media.autoplay = true;`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Renamed variable and full `true` literal: the property construct still matches.',
  },
  {
    id: 'F08',
    rule: 'autoplay-media',
    category: 'alt-pattern',
    decisions: [DEC_AUTOMEDIA],
    source: `<script>
player.setAttribute('autoplay', '');
</script>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'setAttribute form of the same declaration.',
  },
  {
    id: 'F09',
    rule: 'autoplay-media',
    category: 'formatting',
    decisions: [DEC_AUTOMEDIA],
    source: `<audio
  src="assets/theme.mp3"
  autoplay
  loop
></audio>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Attribute spread across lines; the tag span still matches.',
  },
  {
    id: 'F10',
    rule: 'autoplay-media',
    category: 'multi-construct',
    decisions: [DEC_AUTOMEDIA],
    source: `<audio autoplay src="a.mp3"></audio>
<script>vid.play();</script>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Declaration plus a later play call; the unambiguous declaration decides.',
  },
  {
    id: 'F11',
    rule: 'autoplay-media',
    category: 'memory-relevance',
    decisions: [DEC_AUTOMEDIA, DEC_AUTOMEDIA_EXPIRED],
    source: `<div>quiet trivia</div>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Expired record required autoplay; only the active no-autoplay decision may enforce, and it passes.',
  },
  // =========================================================================
  // Rule G — external-assets (v1.5.0, decisions: DEC_EXT)
  // =========================================================================
  {
    id: 'G01',
    rule: 'external-assets',
    category: 'violation-clear',
    decisions: [DEC_EXT],
    source: `${CDN}
<main id="game"></main>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Protocol-qualified CDN script tag.',
  },
  {
    id: 'G02',
    rule: 'external-assets',
    category: 'violation-clear',
    decisions: [DEC_EXT],
    source: `<style>
@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P");
</style>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Remote font pulled through a CSS @import url().',
  },
  {
    id: 'G03',
    rule: 'external-assets',
    category: 'compliance-clear',
    decisions: [DEC_EXT],
    source: `<link rel="stylesheet" href="styles.css">
<script src="game.js"></script>
<style>body { background: url(assets/tiles.png); }</style>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Relative script, stylesheet, and image references.',
  },
  {
    id: 'G04',
    rule: 'external-assets',
    category: 'compliance-clear',
    decisions: [DEC_EXT],
    source: `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'The XML namespace URI inside the data: URL is not a network fetch; the attribute value starts with data:, not //.',
  },
  {
    id: 'G05',
    rule: 'external-assets',
    category: 'comment-inert',
    decisions: [DEC_EXT],
    source: `<!-- old build: <link href="https://fonts.googleapis.com/css?family=VT323"> -->
<style>body { font-family: monospace; }</style>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'The external reference survives only in a commented-out tag.',
  },
  {
    id: 'G06',
    rule: 'external-assets',
    category: 'string-inert',
    decisions: [DEC_EXT],
    source: `help.textContent = 'We no longer use https://cdn.jsdelivr.net for anything';`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'A URL in prose does not load anything: patterns require tag attributes, CSS urls, or fetch/import calls.',
  },
  {
    id: 'G07',
    rule: 'external-assets',
    category: 'renamed',
    decisions: [DEC_EXT],
    source: `const lib = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
const script = document.createElement('script');
script.src = lib;`,
    ground_truth: 'violation',
    ideal: 'UNVERIFIED',
    notes:
      'URL assembled in a variable, attribute set later: honest engines cannot see the linkage statically. Recorded limitation (engine abstention ideal; current engine passes).',
  },
  {
    id: 'G08',
    rule: 'external-assets',
    category: 'alt-pattern',
    decisions: [DEC_EXT],
    source: `<script src="//cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Protocol-relative URL: still an external dependency.',
  },
  {
    id: 'G09',
    rule: 'external-assets',
    category: 'formatting',
    decisions: [DEC_EXT],
    source: `<link
  rel="stylesheet"
  href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'Whitespace around `=` and multi-line tag: the attribute pattern is tolerant.',
  },
  {
    id: 'G10',
    rule: 'external-assets',
    category: 'multi-construct',
    decisions: [DEC_EXT],
    source: `${CDN}
<script>
fetch('https://api.example.org/scores').then((r) => r.json());
</script>`,
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes: 'CDN tag plus a remote fetch; the earliest reference is reported.',
  },
  {
    id: 'G11',
    rule: 'external-assets',
    category: 'memory-relevance',
    decisions: [DEC_EXT, DEC_EXT_EXPIRED],
    source: `<script src="game.js"></script>`,
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Expired record permitted CDN loading; enforcement comes only from the active self-contained decision.',
  },
];
