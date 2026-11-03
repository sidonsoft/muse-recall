/**
 * @mml/decision-guard — deterministic, pure decision-compliance engine.
 *
 * Phase 12B: checks generated source code against explicitly supported
 * project decisions and emits structured findings (PASS / BLOCK / UNVERIFIED).
 *
 * Pure by construction: no filesystem, network, shell, dynamic evaluation,
 * server, database, browser, or Muse access. Inputs are treated as untrusted
 * and never mutated. Results are deterministic: no time, randomness, or
 * input-order sensitivity in the output.
 *
 * v1.1.0 (Phase 12D accuracy audit): source-side rule matching runs on a
 * comment-masked copy of the input (see maskCommentBodies); findings cite
 * evidence sliced from the original source.
 *
 * v1.2.0 (Phase 12E release hardening): findings carry exact `match_spans` so
 * the integration boundary can redact and minimise its own evidence excerpt;
 * `#RRGGBB` and `0xRRGGBB` are equivalent for palette corrections; and rule A
 * distinguishes executable countdown code from documentation, comments, and
 * inert strings (prose-only hits abstain instead of blocking).
 *
 * v1.3.0 (palette family accuracy): rule D classifies saturated source hexes
 * by HSL hue family, so a family-word correction can still BLOCK when the
 * superseded decision names no hexes but the source is visibly warm/cool.
 *
 * v1.4.0 (hidden time pressure): rule A resolves constant timer delays. A
 * setTimeout/setInterval of a minute or more is potential time pressure even
 * when no countdown is visible, so it abstains instead of passing.
 *
 * v1.5.0 (rule-family breadth, roadmap G-7): two non-palette families. Rule F
 * (autoplay-media) BLOCKs declared media autoplay (tag attribute, `.autoplay`
 * property, setAttribute) and abstains on bare `.play()` calls, which cannot
 * be attributed to user action statically. Rule G (external-assets) BLOCKs
 * absolute (protocol or protocol-relative) references from tags, CSS urls,
 * and fetch/import; relative and data: references comply.
 *
 * A decision is NEVER marked compliant merely because no rule applies:
 * unsupported decisions produce UNVERIFIED, never PASS.
 */

import type { Memory } from '@mml/shared';

export const GUARD_VERSION = '1.5.0';

/** Structural subset of a memory record — no runtime coupling. */
export type GuardDecision = Pick<Memory, 'id' | 'content' | 'status' | 'supersedes'>;

export type GuardVerdict = 'PASS' | 'BLOCK' | 'UNVERIFIED';

export type GuardRuleId =
  | 'countdown-mechanics'
  | 'flashing-effects'
  | 'mistake-penalty'
  | 'superseded-palette'
  | 'colour-only-cue'
  | 'autoplay-media'
  | 'external-assets'
  | 'none-applicable';

/** Fixed evaluation + reporting order. Never change without a version bump. */
export const RULE_ORDER: readonly GuardRuleId[] = [
  'countdown-mechanics',
  'flashing-effects',
  'mistake-penalty',
  'superseded-palette',
  'colour-only-cue',
  'autoplay-media',
  'external-assets',
];

export interface GuardMatchSpan {
  /** Absolute start offset in the original source (inclusive). */
  start: number;
  /** Absolute end offset in the original source (exclusive). */
  end: number;
}

export interface GuardFinding {
  decision_id: string;
  decision_excerpt: string;
  rule: GuardRuleId;
  severity: 'high' | 'medium';
  evidence: string;
  explanation: string;
  blocks_approval: boolean;
  /**
   * Exact matched construct(s) in the original source. The integration layer
   * uses these to build its own redacted, narrow evidence excerpt instead of
   * trusting a pre-rendered slice. Offsets survive comment masking because the
   * masked copy is length-preserving.
   */
  match_spans: GuardMatchSpan[];
}

export interface DecisionEvaluation {
  decision_id: string;
  rule: GuardRuleId;
  verdict: GuardVerdict;
  reason: string;
  findings: GuardFinding[];
}

export interface GuardOptions {
  /**
   * Excerpts of the decisions a corrected (active) decision superseded.
   * Rule D needs them to know WHICH palette was replaced; without them an
   * otherwise enforceable correction stays UNVERIFIED.
   */
  supersededDecisions?: readonly GuardDecision[];
}

export interface GuardResult {
  engine_version: string;
  verdict: GuardVerdict;
  evaluations: DecisionEvaluation[];
  findings: GuardFinding[];
  excluded_decision_ids: string[];
  input_warnings: string[];
}

// ---------------------------------------------------------------------------
// Security bounds. Oversized or malformed inputs never yield PASS.

export const MAX_SOURCE_CHARS = 400_000;
export const MAX_DECISIONS = 32;
export const MAX_FINDINGS = 64;
const EXCERPT_CHARS = 120;
const EVIDENCE_CHARS = 160;

// ---------------------------------------------------------------------------
// Decision-side matchers: a rule only runs when the decision text EXPLICITLY
// prohibits something this engine can check. All patterns are linear.

const DECISION_MATCHERS: Record<Exclude<GuardRuleId, 'none-applicable'>, RegExp> = {
  'countdown-mechanics': /(?:avoid|no|never|without|prohibit\w*|do not)[^.]{0,80}countdown/i,
  'flashing-effects': /(?:avoid|no|never|without|prohibit\w*|do not)[^.]{0,80}flash/i,
  'mistake-penalty':
    /(?:avoid|no|never|without|prohibit\w*|do not)[^.]{0,60}(?:penalt\w+|punish\w+|deduct\w+)|(?:penalt\w+|punish\w+)[^.]{0,40}mistake/i,
  'superseded-palette': /palette/i,
  'colour-only-cue': /without colour|colour[- ]only|colour discrimination|colou?r[- ]blind/i,
  'autoplay-media':
    /(?:not|no|never|without|avoid\w*|prohibit\w*|ban)[^.]{0,60}auto[-\s]?play|auto[-\s]?play[^.]{0,40}(?:is\s+)?(?:forbidden|prohibited|banned|disallowed|not allowed)/i,
  'external-assets':
    /(?:no|without|never|avoid\w*|do not|prohibit\w*|fully|entirely|keep)[^.]{0,60}(?:external|third[-\s]?party|remote|cdn)[^.]{0,60}(?:asset|script|style|font|resource|dependenc\w+|request|link|library)|(?:self[-\s]?contained|works?\s+offline|runs?\s+offline)/i,
};

// ---------------------------------------------------------------------------
// Rule A — countdown mechanics.
// BLOCK only on unambiguous countdown implementations; ordinary elapsed-time
// counters (`elapsed += 1`) and unrelated uses of "timer" must not match.

const COUNTDOWN_SOURCE =
  /\bcountdown\b|timeLeft|secondsLeft|timeRemaining|time_remaining\b|\b(?:time|timer|clock)\s*(?:--|-=\s*\d)/i;

/**
 * A timer of a minute or more can bound an activity even when no countdown is
 * visible. Treat that as potential time pressure and abstain; shorter delays
 * are ordinary scheduling, effects, animation, and cleanup.
 */
const TIME_PRESSURE_THRESHOLD_MS = 60_000;

/** Bounds for the pure delay parser; larger expressions fall back to unresolved. */
const MAX_TIMER_EXPRESSION_CHARS = 400;
const MAX_TIMER_EXPRESSION_DEPTH = 32;

const TIMER_CALL_RE = /(?<![\w$.])(?:window\s*\.\s*)?(setTimeout|setInterval)\s*\(/g;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const MAX_TIMER_REASON_SOURCE_CHARS = 80;

interface TimerCall {
  index: number;
  name: string;
}

interface ResolvedDelay {
  delayMs: number;
  delayText: string;
  boundExpression: string | null;
}

interface TimerDelay extends ResolvedDelay {
  /** Absolute index of the call in the length-preserving executable view. */
  index: number;
  callName: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursive-descent arithmetic over non-negative integer literals, `+ - * /`,
 * unary signs, and parentheses. Returns null for anything else. This is a
 * parser, not evaluation: identifiers, calls, properties, and code never run.
 */
function parseIntegerArithmetic(expression: string): number | null {
  if (expression.length === 0 || expression.length > MAX_TIMER_EXPRESSION_CHARS) return null;
  let index = 0;
  let depth = 0;

  function skipWhitespace(): void {
    while (index < expression.length && /\s/.test(expression[index] ?? '')) index += 1;
  }

  function parseInteger(): number | null {
    skipWhitespace();
    const start = index;
    while (index < expression.length) {
      const code = expression.charCodeAt(index);
      if (code < 48 || code > 57) break;
      index += 1;
    }
    if (index === start) return null;
    const value = Number(expression.slice(start, index));
    return Number.isFinite(value) ? value : null;
  }

  function parseFactor(): number | null {
    skipWhitespace();
    const sign = expression[index];
    if (sign === '+' || sign === '-') {
      index += 1;
      const value = parseFactor();
      if (value === null) return null;
      return sign === '-' ? -value : value;
    }
    if (sign === '(') {
      if (depth >= MAX_TIMER_EXPRESSION_DEPTH) return null;
      depth += 1;
      index += 1;
      const value = parseExpression();
      if (value === null) return null;
      skipWhitespace();
      if (expression[index] !== ')') return null;
      index += 1;
      depth -= 1;
      return value;
    }
    return parseInteger();
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value === null) return null;
    while (true) {
      skipWhitespace();
      const operator = expression[index];
      if (operator !== '*' && operator !== '/') return value;
      index += 1;
      const right = parseFactor();
      if (right === null) return null;
      if (operator === '/' && right === 0) return null;
      value = operator === '*' ? value * right : value / right;
    }
  }

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value === null) return null;
    while (true) {
      skipWhitespace();
      const operator = expression[index];
      if (operator !== '+' && operator !== '-') return value;
      index += 1;
      const right = parseTerm();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }
  }

  const value = parseExpression();
  skipWhitespace();
  if (value === null || index !== expression.length) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Resolve an identifier only when the source declares it exactly once with an
 * initializer and never assigns it again. `var|let|const NAME = expr;` is the
 * narrow supported form; aliases and reassignments stay unresolved.
 */
function resolveIdentifierDelay(
  name: string,
  source: string,
): { delayMs: number; boundExpression: string } | null {
  const escaped = escapeRegExp(name);
  const declaration = new RegExp(
    `(?<![\\w$.])(?:var|let|const)\\s+${escaped}\\s*=\\s*([^;]*);`,
    'g',
  );
  const declarations = [...source.matchAll(declaration)];
  if (declarations.length !== 1) return null;
  const mutation = new RegExp(
    `(?<![\\w$.])${escaped}\\s*(?:=(?!=)|\\+=|-=|\\*=|/=|%=|\\+\\+|--)`,
    'g',
  );
  if ([...source.matchAll(mutation)].length !== 1) return null;
  const boundExpression = declarations[0]?.[1]?.trim() ?? '';
  const delayMs = parseIntegerArithmetic(boundExpression);
  return delayMs === null ? null : { delayMs, boundExpression };
}

function resolveTimerDelay(expression: string, source: string): ResolvedDelay | null {
  const direct = parseIntegerArithmetic(expression);
  if (direct !== null) {
    return { delayMs: direct, delayText: expression, boundExpression: null };
  }
  if (!IDENTIFIER_RE.test(expression)) return null;
  const bound = resolveIdentifierDelay(expression, source);
  if (bound === null) return null;
  return { delayMs: bound.delayMs, delayText: expression, boundExpression: bound.boundExpression };
}

interface DelimiterFrame {
  closing: ')' | ']' | '}';
  /** Timer call when this delimiter is its opening parenthesis. */
  call: TimerCall | null;
  firstComma: number;
  secondComma: number;
}

/** First setTimeout/setInterval whose delay resolves to the pressure threshold. */
function findLongTimerDelay(source: string): TimerDelay | null {
  const timerCalls = new Map<number, TimerCall>();
  for (const match of source.matchAll(TIMER_CALL_RE)) {
    const callIndex = match.index;
    const callName = match[1];
    if (callIndex === undefined || callName === undefined) continue;
    timerCalls.set(callIndex + match[0].length - 1, { index: callIndex, name: callName });
  }
  if (timerCalls.size === 0) return null;

  // One linear pass matches delimiters, records the top-level argument commas,
  // and resolves the delay when each timer call closes.
  const stack: DelimiterFrame[] = [];
  let found: TimerDelay | null = null;
  for (let position = 0; position < source.length; position += 1) {
    const char = source[position];
    if (char === '(' || char === '[' || char === '{') {
      stack.push({
        closing: char === '(' ? ')' : char === '[' ? ']' : '}',
        call: char === '(' ? (timerCalls.get(position) ?? null) : null,
        firstComma: -1,
        secondComma: -1,
      });
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      const frame = stack.pop();
      if (!frame || frame.closing !== char || frame.call === null) continue;
      if (frame.firstComma === -1) continue;
      const delayEnd = frame.secondComma === -1 ? position : frame.secondComma;
      const expression = source.slice(frame.firstComma + 1, delayEnd).trim();
      const resolved = resolveTimerDelay(expression, source);
      if (
        resolved !== null &&
        resolved.delayMs >= TIME_PRESSURE_THRESHOLD_MS &&
        (found === null || frame.call.index < found.index)
      ) {
        found = { ...resolved, index: frame.call.index, callName: frame.call.name };
      }
      continue;
    }
    if (char !== ',') continue;
    const frame = stack[stack.length - 1];
    if (!frame || frame.call === null) continue;
    if (frame.firstComma === -1) frame.firstComma = position;
    else if (frame.secondComma === -1) frame.secondComma = position;
  }
  return found;
}

function formatMinutes(delayMs: number): string {
  const minutes = delayMs / 60_000;
  const value = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(2));
  return `${value}-minute`;
}

function timerReason(timer: TimerDelay): string {
  const written = timer.boundExpression
    ? `${timer.delayText} = ${timer.boundExpression}`
    : timer.delayText;
  const sourceNote = excerpt(written, MAX_TIMER_REASON_SOURCE_CHARS);
  return `a ${formatMinutes(timer.delayMs)} timer bounds an activity (${timer.callName} delay ${sourceNote}); time pressure cannot be ruled out`;
}

// ---------------------------------------------------------------------------
// Rule B — flashing effects.
// BLOCK only on repeated visibility/alpha toggling (blink/flash keyframes or
// animation names, intervals toggling visibility/opacity/display).
// Known false negatives: Phaser tween pulses (yoyo/repeat), rAF sine alpha.

const FLASHING_SOURCE =
  /@keyframes\s+[\w-]*(?:flash|blink)|animation[^;{}]{0,48}(?:flash|blink)|setInterval\([\s\S]{0,160}?(?:visibility|opacity|alpha|display|visible|hidden)/i;

// ---------------------------------------------------------------------------
// Rule C — punishment for mistakes.
// BLOCK on explicit deductions; ordinary score increases never match.

const PENALTY_SOURCE =
  /score\s*-=(?!=)|score\s*=\s*score\s*-\s|score\s*--|(?:penaliz\w*|deduct\w*|subtract\w*|reduce\w*)[^.;]{0,30}score|score[^.;]{0,20}(?:decrement|reduced|drop\w*)|\blives?\s*-=(?!=)/i;

// ---------------------------------------------------------------------------
// Rule D — superseded palette.
// Hex codes count as active styling; family words outside styling contexts do
// not (they may be prose or historical comments).

const HEX_RE = /#[0-9a-f]{6}\b|0x[0-9a-f]{6}\b/gi;
const PALETTE_FAMILIES = {
  warm: /sunset|warm|orange|gold|tomato|salmon|peach/i,
  cool: /ocean|cool|teal|aqua|blue|azure|navy/i,
};

function familyForText(text: string): 'warm' | 'cool' | null {
  if (PALETTE_FAMILIES.cool.test(text)) return 'cool';
  if (PALETTE_FAMILIES.warm.test(text)) return 'warm';
  return null;
}

// Palette-family thresholds (HSL). Only saturated, mid-lightness colours carry
// palette meaning; near-greys, very dark inks and very pale backgrounds do not.
const PALETTE_MIN_SATURATION = 0.35;
const PALETTE_MIN_LIGHTNESS = 0.15;
const PALETTE_MAX_LIGHTNESS = 0.9;
const WARM_HUE_MIN = 0;
const WARM_HUE_MAX = 70;
const WARM_HUE_WRAP_MIN = 330;
const COOL_HUE_MIN = 160;
const COOL_HUE_MAX = 260;

/**
 * Normalise a supported 6-digit RGB token to bare uppercase hex digits.
 * `#RRGGBB` and `0xRRGGBB` are the same colour; only the notation differs.
 * 3-digit and 8-digit forms are deliberately outside this narrow equivalence.
 */
function canonicalHex(token: string): string {
  return token.slice(-6).toUpperCase();
}

function hexesIn(text: string): string[] {
  const found = text.match(HEX_RE);
  return found ? [...new Set(found.map(canonicalHex))].sort() : [];
}

interface HslColour {
  hue: number;
  saturation: number;
  lightness: number;
}

function hslForHex(hex: string): HslColour {
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: delta / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

function familyForHex(hex: string): 'warm' | 'cool' | null {
  const { hue, saturation, lightness } = hslForHex(hex);
  if (
    saturation < PALETTE_MIN_SATURATION ||
    lightness < PALETTE_MIN_LIGHTNESS ||
    lightness > PALETTE_MAX_LIGHTNESS
  ) {
    return null;
  }
  if ((hue >= WARM_HUE_MIN && hue < WARM_HUE_MAX) || (hue >= WARM_HUE_WRAP_MIN && hue < 360)) {
    return 'warm';
  }
  if (hue >= COOL_HUE_MIN && hue <= COOL_HUE_MAX) return 'cool';
  return null;
}

interface PaletteColour {
  hex: string;
  family: 'warm' | 'cool';
  index: number;
  matchLength: number;
}

/** Saturated warm/cool colours in source order; neutral hexes are omitted. */
function paletteColoursIn(text: string): PaletteColour[] {
  const colours: PaletteColour[] = [];
  for (const match of text.matchAll(HEX_RE)) {
    const hex = canonicalHex(match[0]);
    const family = familyForHex(hex);
    if (family === null) continue;
    colours.push({
      hex,
      family,
      index: match.index ?? 0,
      matchLength: match[0].length,
    });
  }
  return colours;
}

// ---------------------------------------------------------------------------
// Rule E — colour-only gameplay cues.
// Only narrow, explicitly identifiable violations BLOCK. Proximity of a
// non-colour cue to the colour reference is the narrow PASS form; a cue that
// exists elsewhere is UNVERIFIED, not compliance.

const RED_SOURCE = /#FF0000\b|#F00\b|#DC143C|#FF4C4C|\bred\b/i;
const GREEN_SOURCE = /#00FF00\b|#0F0\b|#2E8B57|#4CAF50|\bgreen\b/i;
const NON_COLOUR_CUE =
  /\bshape\b|\bicon\b|\bsymbol\b|\bletter\b|\blabel\b|\bcircle\b|\bsquare\b|\btriangle\b|\bstar\b|\bpattern\b|\btexture\b|\bdashed\b|\bsolid\b|\boutline\b/i;
const CUE_PROXIMITY_CHARS = 160;

// ---------------------------------------------------------------------------
// Helpers (pure).

/**
 * Phase 12D fix (accuracy audit): mask the BODIES of code comments before
 * source-side pattern matching. Inert documentation — a line comment naming
 * "the old countdown ring", a block comment citing an old accent hex, or an
 * HTML comment about a removed red/green pairing — must not read as an
 * active implementation.
 *
 * Properties:
 *  - String-aware: `//` / `/*` inside '...' , "...", or `...` is NOT a
 *    comment (CDN URLs like `https://cdn...` are left alone).
 *  - Offset-preserving: comment characters become spaces (newlines stay),
 *    so every index in the masked text maps to the same index in the
 *    original; evidence is always sliced from the ORIGINAL source.
 *  - Linear, allocation-bounded, no regex backtracking.
 *
 * Known limitation (documented, not solved): an unterminated quote in an
 * HTML text node (apostrophes like "Don't") extends a string state to end
 * of line; the failure mode is UNDER-masking (a real comment on that same
 * line stays visible), never code removal. Regex literals containing `//`
 * may over-mask to end of line — rare in generated game sources.
 */
function maskCommentBodies(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "'" || char === '"') {
      // Scan a single-line string: it is code data, never masked.
      i += 1;
      while (i < source.length && source[i] !== char && source[i] !== '\n') {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === '`') {
      // Template literal: inert except for ${ ... } expression segments.
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      let j = i;
      while (j < source.length && source[j] !== '\n') {
        out[j] = ' ';
        j += 1;
      }
      i = j;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      let j = i;
      while (j < source.length && !(source[j] === '*' && source[j + 1] === '/')) {
        if (out[j] !== '\n') out[j] = ' ';
        j += 1;
      }
      const end = Math.min(source.length, j + 2);
      for (; i < end; i += 1) out[i] = ' ';
      i = end;
      continue;
    }
    if (char === '<' && source.startsWith('<!--', i)) {
      let j = i;
      const close = source.indexOf('-->', j);
      const stop = close === -1 ? source.length : close + 3;
      while (j < stop) {
        if (out[j] !== '\n') out[j] = ' ';
        j += 1;
      }
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

interface HtmlTag {
  name: string;
  closing: boolean;
  /** First character after the tag name (attributes start here). */
  attributeStart: number;
  end: number;
}

/** Read an HTML tag starting at `start`; null when the character is not a tag. */
function readHtmlTag(source: string, start: number): HtmlTag | null {
  if (source[start] !== '<') return null;
  let i = start + 1;
  const closing = source[i] === '/';
  if (closing) i += 1;
  const nameStart = i;
  while (i < source.length && /[A-Za-z0-9:-]/.test(source[i] ?? '')) i += 1;
  if (i === nameStart) return null;
  const name = source.slice(nameStart, i).toLowerCase();
  const attributeStart = i;
  let quote: string | null = null;
  while (i < source.length) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      i += 1;
      break;
    }
    i += 1;
  }
  return { name, closing, attributeStart, end: i };
}

/**
 * Raw-text elements (script/style) only leave their mode on the matching HTML
 * closing tag. `<` in executable script code (`a<b`, `guard<3660`) is ordinary
 * code, not an HTML tag start.
 */
function isRawTextClosingTag(source: string, start: number, name: 'script' | 'style'): boolean {
  const prefix = `</${name}`;
  if (source.slice(start, start + prefix.length).toLowerCase() !== prefix) return false;
  const next = source[start + prefix.length];
  return next === undefined || /[\s/>]/.test(next);
}

/**
 * Blank inert attribute values (`id`, `class`, `data-*`, `aria-*`, `title`, …)
 * in the countdown executable view. Event-handler attributes (`on*`) may carry
 * executable code and stay visible. Without this, `<div id="countdown">` reads
 * as a countdown mechanic even though nothing decrements.
 */
function maskInertAttributes(source: string, out: string[], tag: HtmlTag): void {
  let i = tag.attributeStart;
  while (i < tag.end) {
    const char = source[i];
    if (char === '>' || char === '/') {
      i += 1;
      continue;
    }
    if (/\s/.test(char ?? '')) {
      i += 1;
      continue;
    }
    const nameStart = i;
    while (i < tag.end && !/[\s=/>]/.test(source[i] ?? '')) i += 1;
    const name = source.slice(nameStart, i).toLowerCase();
    while (i < tag.end && /\s/.test(source[i] ?? '')) i += 1;
    if (source[i] !== '=') continue;
    i += 1;
    while (i < tag.end && /\s/.test(source[i] ?? '')) i += 1;
    const quote = source[i] === '"' || source[i] === "'" ? source[i] : null;
    const valueStart = quote ? i + 1 : i;
    let valueEnd = valueStart;
    if (quote) {
      valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0 || valueEnd > tag.end) valueEnd = tag.end;
      i = valueEnd + 1;
    } else {
      while (valueEnd < tag.end && !/[\s>]/.test(source[valueEnd] ?? '')) valueEnd += 1;
      i = valueEnd;
    }
    if (name.startsWith('on')) continue;
    for (let j = valueStart; j < valueEnd; j += 1) {
      if (out[j] !== '\n') out[j] = ' ';
    }
  }
}

function maskQuoted(source: string, out: string[], start: number, quote: string): number {
  out[start] = ' ';
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      if (out[i] !== '\n') out[i] = ' ';
      if (i + 1 < source.length && out[i + 1] !== '\n') out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (char === quote) {
      out[i] = ' ';
      return i + 1;
    }
    if (char === '\n') return i;
    if (out[i] !== '\n') out[i] = ' ';
    i += 1;
  }
  return i;
}

function maskTemplate(source: string, out: string[], start: number): number {
  out[start] = ' ';
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      if (out[i] !== '\n') out[i] = ' ';
      if (i + 1 < source.length && out[i + 1] !== '\n') out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (char === '`') {
      out[i] = ' ';
      return i + 1;
    }
    if (out[i] !== '\n') out[i] = ' ';
    i += 1;
  }
  return i;
}

/**
 * Phase 12E — rule-A executable view.
 *
 * Countdown words can appear as documentation (`<p>No countdown</p>`), inert
 * UI copy (`'there is no countdown'`), or template text. Those are prose, not
 * evidence of an executable timer. This produces a length-preserving copy in
 * which HTML text nodes, `<style>` content, and JavaScript string/template
 * literals are blanked; code and HTML attributes are left intact (attributes
 * may drive behaviour, so they stay conservative).
 *
 * If a token appears only in the executable view, the engine BLOCKs. If it
 * appears solely in prose, the honest result is UNVERIFIED — never PASS (the
 * executable mechanic could be hidden) and never BLOCK (prose is not proof).
 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function maskCountdownNonExecutable(source: string): string {
  const out = source.split('');
  const n = source.length;
  const stack: string[] = [];
  let mode: 'html' | 'script' | 'style' = 'html';
  let i = 0;
  while (i < n) {
    if (
      source[i] === '<' &&
      (mode === 'html' ||
        (mode === 'script' && isRawTextClosingTag(source, i, 'script')) ||
        (mode === 'style' && isRawTextClosingTag(source, i, 'style')))
    ) {
      const tag = readHtmlTag(source, i);
      if (tag) {
        if (!tag.closing) maskInertAttributes(source, out, tag);
        if (tag.closing) {
          while (stack.length > 0 && stack[stack.length - 1] !== tag.name) stack.pop();
          if (stack[stack.length - 1] === tag.name) stack.pop();
          if (tag.name === 'script' || tag.name === 'style') mode = 'html';
        } else if (!VOID_ELEMENTS.has(tag.name)) {
          stack.push(tag.name);
          if (tag.name === 'script') mode = 'script';
          else if (tag.name === 'style') mode = 'style';
        }
        i = tag.end;
        continue;
      }
    }
    if (mode === 'script') {
      const char = source[i];
      if (char === "'" || char === '"') {
        i = maskQuoted(source, out, i, char);
        continue;
      }
      if (char === '`') {
        i = maskTemplate(source, out, i);
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'style') {
      if (out[i] !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    // Bare JS fragments (as used by the evaluation corpus and unit tests) are
    // code-like: their string literals are inert, like script-tag strings.
    if (stack.length === 0) {
      const char = source[i];
      if (char === "'" || char === '"') {
        i = maskQuoted(source, out, i, char);
        continue;
      }
      if (char === '`') {
        i = maskTemplate(source, out, i);
        continue;
      }
    }
    // Text nodes only exist inside an HTML element; outside one, code stays.
    if (stack.length > 0 && source[i] !== '<' && out[i] !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function evidenceAt(source: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(source.length, index + matchLength + 40);
  return excerpt(source.slice(start, end), EVIDENCE_CHARS);
}

function isGuardDecision(value: unknown): value is GuardDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.content === 'string' &&
    typeof record.status === 'string' &&
    Array.isArray(record.supersedes) &&
    record.supersedes.every((entry) => typeof entry === 'string')
  );
}

function aggregate(evaluations: DecisionEvaluation[]): GuardVerdict {
  if (evaluations.length === 0) return 'UNVERIFIED';
  if (evaluations.some((evaluation) => evaluation.verdict === 'BLOCK')) return 'BLOCK';
  if (evaluations.some((evaluation) => evaluation.verdict === 'UNVERIFIED')) return 'UNVERIFIED';
  return 'PASS';
}

function unverified(reason: string): { verdict: 'UNVERIFIED'; reason: string; findings: [] } {
  return { verdict: 'UNVERIFIED', reason, findings: [] };
}

// ---------------------------------------------------------------------------
// Rule F — autoplaying media.
// A decision prohibiting autoplay is decidable only where playback is
// declared: the autoplay attribute/property or setAttribute('autoplay') is
// unambiguous. A bare .play() call may be user-initiated, so it abstains.
// Known false negatives: wrapper libraries (player.start()), WebAudio graphs.

const AUTOPLAY_DECL =
  /<(?:audio|video|bgsound|embed)\b[^>]*?\bautoplay(?![\w-])|\.autoplay\s*=\s*(?:!0\b|true\b)|\.setAttribute\s*\(\s*['"]autoplay['"]/i;
const MEDIA_PLAY_CALL = /\.play\s*\(/i;

// ---------------------------------------------------------------------------
// Rule G — external assets.
// BLOCK on absolute (protocol-qualified or protocol-relative) references from
// HTML tags, CSS urls, and fetch/import calls. Relative paths, data: URLs,
// and blob: URLs comply. Known false negatives: URLs assembled from parts.

const EXTERNAL_REF_PATTERNS: readonly RegExp[] = [
  /<(?:script|link|img|image|source|iframe|audio|video|embed|use)\b[^>]*?\b(?:src|href|xlink:href)\s*=\s*["']?(?:https?:\/\/|\/\/)/i,
  /url\(\s*["']?(?:https?:\/\/|\/\/)/i,
  /(?:fetch|import)\s*\(\s*["'`](?:https?:\/\/|\/\/)/i,
];

// ---------------------------------------------------------------------------
// Rule evaluators. Each returns a verdict + reason + findings (BLOCK cases).

interface RuleContext {
  /** Comment-masked copy used for all source-side matching. */
  source: string;
  /** Original (unmasked) source; evidence is always sliced from this. */
  original: string;
  decision: GuardDecision;
  superseded?: GuardDecision;
}

function evaluateCountdown({ source, original, decision }: RuleContext): DecisionEvaluation {
  const executable = maskCountdownNonExecutable(source);
  const match = executable.match(COUNTDOWN_SOURCE);
  if (match && match.index !== undefined) {
    const finding = makeFinding(
      decision,
      'countdown-mechanics',
      evidenceAt(original, match.index, match[0].length),
      `decision prohibits countdown mechanics; source contains "${match[0]}"`,
      [{ start: match.index, end: match.index + match[0].length }],
      true,
      'high',
    );
    return {
      decision_id: decision.id,
      rule: 'countdown-mechanics',
      verdict: 'BLOCK',
      reason: 'countdown implementation detected',
      findings: [finding],
    };
  }
  // A hidden timer of a minute or more can bound an activity without ever
  // showing a countdown. No BLOCK applies, but claiming PASS would overclaim.
  const longTimer = findLongTimerDelay(executable);
  if (longTimer) {
    return {
      decision_id: decision.id,
      rule: 'countdown-mechanics',
      verdict: 'UNVERIFIED',
      reason: timerReason(longTimer),
      findings: [],
    };
  }
  // A token that exists only in a comment-masked but otherwise textual location
  // is prose. Do not turn documentation into a finding, and do not turn it into
  // PASS either: the executable mechanic may simply be hidden from this rule.
  if (source.match(COUNTDOWN_SOURCE)) {
    return {
      decision_id: decision.id,
      rule: 'countdown-mechanics',
      ...unverified(
        'countdown reference appears only in documentation, a string, or style content; no executable countdown mechanics were found',
      ),
    };
  }
  return {
    decision_id: decision.id,
    rule: 'countdown-mechanics',
    verdict: 'PASS',
    reason: 'no unambiguous countdown implementation found',
    findings: [],
  };
}

function evaluateFlashing({ source, original, decision }: RuleContext): DecisionEvaluation {
  const match = source.match(FLASHING_SOURCE);
  if (!match || match.index === undefined) {
    return {
      decision_id: decision.id,
      rule: 'flashing-effects',
      verdict: 'PASS',
      reason: 'no repeated visibility/alpha toggling found (tween-based pulses are a known gap)',
      findings: [],
    };
  }
  const finding = makeFinding(
    decision,
    'flashing-effects',
    evidenceAt(original, match.index, match[0].length),
    `decision prohibits flashing effects; source contains "${excerpt(match[0], 80)}"`,
    [{ start: match.index, end: match.index + match[0].length }],
    true,
    'high',
  );
  return {
    decision_id: decision.id,
    rule: 'flashing-effects',
    verdict: 'BLOCK',
    reason: 'flashing/visibility-toggle implementation detected',
    findings: [finding],
  };
}

function evaluatePenalty({ source, original, decision }: RuleContext): DecisionEvaluation {
  const match = source.match(PENALTY_SOURCE);
  if (!match || match.index === undefined) {
    return {
      decision_id: decision.id,
      rule: 'mistake-penalty',
      verdict: 'PASS',
      reason: 'no explicit score deduction or comparable penalty found',
      findings: [],
    };
  }
  const finding = makeFinding(
    decision,
    'mistake-penalty',
    evidenceAt(original, match.index, match[0].length),
    `decision prohibits punishing mistakes; source contains "${excerpt(match[0], 80)}"`,
    [{ start: match.index, end: match.index + match[0].length }],
    true,
    'high',
  );
  return {
    decision_id: decision.id,
    rule: 'mistake-penalty',
    verdict: 'BLOCK',
    reason: 'explicit mistake penalty detected',
    findings: [finding],
  };
}

function evaluatePalette(context: RuleContext): DecisionEvaluation {
  const { source, original, decision, superseded } = context;
  const base = { decision_id: decision.id, rule: 'superseded-palette' as const };
  if (decision.supersedes.length === 0) {
    return {
      ...base,
      ...unverified('palette decision is not a correction; superseded history unknown'),
    };
  }
  if (!superseded) {
    return {
      ...base,
      ...unverified('superseded decision text not supplied via options.supersededDecisions'),
    };
  }
  const requiredHexes = hexesIn(decision.content);
  const forbiddenHexes = hexesIn(superseded.content);
  const requiredFamily = familyForText(decision.content);
  const forbiddenFamily = familyForText(superseded.content);
  if (requiredHexes.length === 0 && requiredFamily === null) {
    return {
      ...base,
      ...unverified(
        'active corrected decision provides no enforceable palette (no hex or family words)',
      ),
    };
  }
  const sourceHexes = new Set(hexesIn(source));
  const forbiddenHit = forbiddenHexes.filter((hex) => sourceHexes.has(hex));
  const firstForbidden = forbiddenHit[0];
  if (forbiddenHit.length > 0 && firstForbidden) {
    const index = Math.max(0, source.toUpperCase().indexOf(firstForbidden.toUpperCase()));
    const finding = makeFinding(
      decision,
      'superseded-palette',
      evidenceAt(original, index, firstForbidden.length),
      `superseded palette reintroduced as active styling: ${forbiddenHit
        .map((hex) => `#${hex}`)
        .join(', ')} (replaced by ${
        requiredHexes.map((hex) => `#${hex}`).join(', ') || requiredFamily || 'unknown'
      })`,
      [{ start: index, end: index + firstForbidden.length }],
      true,
      'high',
    );
    return {
      ...base,
      verdict: 'BLOCK',
      reason: 'superseded palette hexes present in source',
      findings: [finding],
    };
  }
  const sourceColours = paletteColoursIn(source);
  const forbiddenColours =
    forbiddenFamily !== null
      ? sourceColours.filter((colour) => colour.family === forbiddenFamily)
      : [];
  if (requiredFamily !== null && forbiddenFamily !== null && requiredFamily !== forbiddenFamily) {
    const activeColours = sourceColours.filter((colour) => colour.family === requiredFamily);
    const supersededColours = sourceColours.filter((colour) => colour.family === forbiddenFamily);
    const activeHexes = new Set(activeColours.map((colour) => colour.hex));
    const supersededHexes = new Set(supersededColours.map((colour) => colour.hex));
    const firstSuperseded = supersededColours[0];
    if (supersededHexes.size >= 2 && activeHexes.size === 0 && firstSuperseded) {
      const hexList = [...supersededHexes]
        .sort()
        .map((hex) => `#${hex}`)
        .join(', ');
      const finding = makeFinding(
        decision,
        'superseded-palette',
        evidenceAt(original, firstSuperseded.index, firstSuperseded.matchLength),
        `superseded ${forbiddenFamily} palette reintroduced as active styling: ${hexList} (replaced by ${requiredFamily} palette)`,
        [
          {
            start: firstSuperseded.index,
            end: firstSuperseded.index + firstSuperseded.matchLength,
          },
        ],
        true,
        'high',
      );
      return {
        ...base,
        verdict: 'BLOCK',
        reason: `superseded ${forbiddenFamily} palette colours ${hexList} present; active ${requiredFamily} palette absent`,
        findings: [finding],
      };
    }
    if (activeHexes.size > 0 && supersededHexes.size === 0) {
      return {
        ...base,
        verdict: 'PASS',
        reason: `active ${requiredFamily} palette present; superseded ${forbiddenFamily} palette absent from styling`,
        findings: [],
      };
    }
    if (activeHexes.size > 0 && supersededHexes.size > 0) {
      return {
        ...base,
        ...unverified(
          `mixed palette families in source: both superseded ${forbiddenFamily} and active ${requiredFamily} colours appear`,
        ),
      };
    }
  }
  const forbiddenWordHit =
    forbiddenFamily !== null ? source.match(PALETTE_FAMILIES[forbiddenFamily]) : null;
  const requiredPresent =
    requiredHexes.some((hex) => sourceHexes.has(hex)) ||
    (requiredFamily !== null && PALETTE_FAMILIES[requiredFamily].test(source));
  if (forbiddenWordHit && !requiredPresent) {
    if (forbiddenColours.length === 0) {
      return {
        ...base,
        ...unverified(
          'superseded palette term appears, but only as prose/comment without styling evidence',
        ),
      };
    }
    return {
      ...base,
      ...unverified(
        `superseded ${forbiddenFamily} palette styling appears, but the active corrected palette is not confirmed`,
      ),
    };
  }
  if (requiredPresent) {
    return {
      ...base,
      verdict: 'PASS',
      reason: 'corrected palette present; superseded palette absent from styling',
      findings: [],
    };
  }
  if (forbiddenColours.length > 0) {
    return {
      ...base,
      ...unverified(
        `superseded ${forbiddenFamily} palette colours appear, but the active corrected palette is not confirmed`,
      ),
    };
  }
  return { ...base, ...unverified('neither corrected nor superseded palette present in source') };
}

function evaluateColourCue({ source, original, decision }: RuleContext): DecisionEvaluation {
  const base = { decision_id: decision.id, rule: 'colour-only-cue' as const };
  const red = source.match(RED_SOURCE);
  const green = source.match(GREEN_SOURCE);
  if (!red || !green) {
    return {
      ...base,
      ...unverified('no evaluable red/green pair found; broad accessibility cannot be claimed'),
    };
  }
  const redIndex = red.index ?? 0;
  const greenIndex = green.index ?? 0;
  const cueHit = source.match(NON_COLOUR_CUE);
  if (cueHit) {
    const cueIndex = cueHit.index ?? 0;
    const near =
      Math.abs(cueIndex - redIndex) <= CUE_PROXIMITY_CHARS ||
      Math.abs(cueIndex - greenIndex) <= CUE_PROXIMITY_CHARS;
    if (near) {
      return {
        ...base,
        verdict: 'PASS',
        reason: 'non-colour cue adjacent to colour reference (narrow pass)',
        findings: [],
      };
    }
    return {
      ...base,
      ...unverified(
        'non-colour cues exist but cannot be linked to the colour-differentiated elements',
      ),
    };
  }
  const finding = makeFinding(
    decision,
    'colour-only-cue',
    `${evidenceAt(original, redIndex, red[0].length)} | ${evidenceAt(original, greenIndex, green[0].length)}`.slice(
      0,
      EVIDENCE_CHARS,
    ),
    'red and green gameplay elements with no shape, icon, label, or pattern cue anywhere in source',
    [
      { start: redIndex, end: redIndex + red[0].length },
      { start: greenIndex, end: greenIndex + green[0].length },
    ],
    true,
    'high',
  );
  return {
    ...base,
    verdict: 'BLOCK',
    reason: 'colour-only differentiation detected',
    findings: [finding],
  };
}

function evaluateAutoplayMedia({ source, original, decision }: RuleContext): DecisionEvaluation {
  const base = { decision_id: decision.id, rule: 'autoplay-media' as const };
  const decl = source.match(AUTOPLAY_DECL);
  if (decl && decl.index !== undefined) {
    const finding = makeFinding(
      decision,
      'autoplay-media',
      evidenceAt(original, decl.index, decl[0].length),
      `decision prohibits autoplaying media; source declares "${excerpt(decl[0], 80)}"`,
      [{ start: decl.index, end: decl.index + decl[0].length }],
      true,
      'high',
    );
    return {
      ...base,
      verdict: 'BLOCK',
      reason: 'declared media autoplay detected',
      findings: [finding],
    };
  }
  if (source.match(MEDIA_PLAY_CALL)) {
    return {
      ...base,
      ...unverified(
        'media playback call present, but static analysis cannot tell whether playback is user-initiated',
      ),
    };
  }
  return {
    ...base,
    verdict: 'PASS',
    reason: 'no declared autoplay and no media playback call found',
    findings: [],
  };
}

function evaluateExternalAssets({ source, original, decision }: RuleContext): DecisionEvaluation {
  const base = { decision_id: decision.id, rule: 'external-assets' as const };
  let hit: RegExpMatchArray | null = null;
  for (const pattern of EXTERNAL_REF_PATTERNS) {
    const match = source.match(pattern);
    if (match && match.index !== undefined && (!hit || match.index < (hit.index ?? 0))) {
      hit = match;
    }
  }
  if (!hit || hit.index === undefined) {
    return {
      ...base,
      verdict: 'PASS',
      reason: 'no absolute external references found (relative and data: URLs comply)',
      findings: [],
    };
  }
  const finding = makeFinding(
    decision,
    'external-assets',
    evidenceAt(original, hit.index, hit[0].length),
    `decision requires a self-contained app; source references "${excerpt(hit[0], 80)}"`,
    [{ start: hit.index, end: hit.index + hit[0].length }],
    true,
    'medium',
  );
  return {
    ...base,
    verdict: 'BLOCK',
    reason: 'absolute external asset reference detected',
    findings: [finding],
  };
}

function makeFinding(
  decision: GuardDecision,
  rule: GuardRuleId,
  evidence: string,
  explanation: string,
  matchSpans: GuardMatchSpan[],
  blocks: boolean,
  severity: 'high' | 'medium',
): GuardFinding {
  return {
    decision_id: decision.id,
    decision_excerpt: excerpt(decision.content, EXCERPT_CHARS),
    rule,
    severity,
    evidence,
    explanation,
    blocks_approval: blocks,
    match_spans: matchSpans,
  };
}

const RULE_EVALUATORS: Record<
  Exclude<GuardRuleId, 'none-applicable'>,
  (context: RuleContext) => DecisionEvaluation
> = {
  'countdown-mechanics': evaluateCountdown,
  'flashing-effects': evaluateFlashing,
  'mistake-penalty': evaluatePenalty,
  'superseded-palette': evaluatePalette,
  'colour-only-cue': evaluateColourCue,
  'autoplay-media': evaluateAutoplayMedia,
  'external-assets': evaluateExternalAssets,
};

// ---------------------------------------------------------------------------
// Public entry point.

export function evaluateDecisions(
  decisions: readonly GuardDecision[],
  generatedSource: string,
  options: GuardOptions = {},
): GuardResult {
  const inputWarnings: string[] = [];
  const excluded: string[] = [];

  if (!Array.isArray(decisions)) {
    inputWarnings.push('malformed_input:decisions_not_array');
    return finish('UNVERIFIED', [], [], excluded, inputWarnings);
  }
  if (typeof generatedSource !== 'string') {
    inputWarnings.push('malformed_input:source_not_string');
    return finish('UNVERIFIED', [], [], excluded, inputWarnings);
  }

  const parsed: GuardDecision[] = [];
  for (const entry of decisions) {
    if (!isGuardDecision(entry)) {
      inputWarnings.push('malformed_input:decision_rejected');
      continue;
    }
    if (entry.status !== 'active') {
      excluded.push(entry.id);
      continue;
    }
    parsed.push(entry);
  }
  if (parsed.length > MAX_DECISIONS) {
    inputWarnings.push(`decision_limit_exceeded:${parsed.length}>${MAX_DECISIONS}`);
    parsed.length = MAX_DECISIONS;
  }

  if (generatedSource.length > MAX_SOURCE_CHARS) {
    inputWarnings.push('source_oversized');
    const evaluations: DecisionEvaluation[] = [...parsed]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((decision) => ({
        decision_id: decision.id,
        rule: 'none-applicable' as GuardRuleId,
        verdict: 'UNVERIFIED' as const,
        reason: 'source exceeds size bound; no rules evaluated',
        findings: [],
      }));
    return finish('UNVERIFIED', evaluations, [], excluded, inputWarnings);
  }

  const supersededIndex = new Map<string, GuardDecision>();
  if (Array.isArray(options.supersededDecisions)) {
    for (const entry of options.supersededDecisions) {
      if (isGuardDecision(entry)) supersededIndex.set(entry.id, entry);
      else inputWarnings.push('malformed_input:superseded_decision_rejected');
    }
  }

  // Matching runs on the comment-masked copy; evidence stays on the original.
  const matchSource = maskCommentBodies(generatedSource);

  const sorted = [...parsed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const evaluations: DecisionEvaluation[] = [];
  const findings: GuardFinding[] = [];

  for (const decision of sorted) {
    const applicableRules = (
      Object.keys(DECISION_MATCHERS) as Exclude<GuardRuleId, 'none-applicable'>[]
    )
      .filter((rule) => DECISION_MATCHERS[rule].test(decision.content))
      .sort((a, b) => RULE_ORDER.indexOf(a) - RULE_ORDER.indexOf(b));

    if (applicableRules.length === 0) {
      evaluations.push({
        decision_id: decision.id,
        rule: 'none-applicable',
        verdict: 'UNVERIFIED',
        reason: 'no supported rule matches this decision; compliance cannot be claimed',
        findings: [],
      });
      continue;
    }

    for (const rule of applicableRules) {
      const superseded =
        rule === 'superseded-palette'
          ? decision.supersedes
              .map((id) => supersededIndex.get(id))
              .find((entry) => entry !== undefined)
          : undefined;
      const evaluation = RULE_EVALUATORS[rule]({
        source: matchSource,
        original: generatedSource,
        decision,
        superseded,
      });
      evaluations.push(evaluation);
      for (const finding of evaluation.findings) {
        if (findings.length < MAX_FINDINGS) findings.push(finding);
        else inputWarnings.push('finding_limit_exceeded');
      }
    }
  }

  return finish(aggregate(evaluations), evaluations, findings, excluded, inputWarnings);
}

function finish(
  verdict: GuardVerdict,
  evaluations: DecisionEvaluation[],
  findings: GuardFinding[],
  excluded: string[],
  inputWarnings: string[],
): GuardResult {
  return {
    engine_version: GUARD_VERSION,
    verdict,
    evaluations,
    findings,
    excluded_decision_ids: excluded,
    input_warnings: [...new Set(inputWarnings)],
  };
}

// ---------------------------------------------------------------------------
// Integration adapter for the cloud agent (pure string projection; does NOT
// touch the production ForgeValidation structure).

export function toValidationIssues(result: GuardResult): {
  issues: string[];
  unverified_notes: string[];
  blocking: boolean;
} {
  const issues = result.findings
    .filter((finding) => finding.blocks_approval)
    .map(
      (finding) =>
        `[decision-guard:${finding.rule}] decision ${finding.decision_id}: ${finding.explanation} Evidence: ${finding.evidence}`,
    );
  const unverifiedNotes = result.evaluations
    .filter((evaluation) => evaluation.verdict === 'UNVERIFIED')
    .map(
      (evaluation) =>
        `[decision-guard] UNVERIFIED decision ${evaluation.decision_id} (${evaluation.rule}): ${evaluation.reason}`,
    );
  return { issues, unverified_notes: unverifiedNotes, blocking: result.verdict === 'BLOCK' };
}
