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
 * A decision is NEVER marked compliant merely because no rule applies:
 * unsupported decisions produce UNVERIFIED, never PASS.
 */

import type { Memory } from '@mml/shared';

export const GUARD_VERSION = '1.1.0';

/** Structural subset of a memory record — no runtime coupling. */
export type GuardDecision = Pick<Memory, 'id' | 'content' | 'status' | 'supersedes'>;

export type GuardVerdict = 'PASS' | 'BLOCK' | 'UNVERIFIED';

export type GuardRuleId =
  | 'countdown-mechanics'
  | 'flashing-effects'
  | 'mistake-penalty'
  | 'superseded-palette'
  | 'colour-only-cue'
  | 'none-applicable';

/** Fixed evaluation + reporting order. Never change without a version bump. */
export const RULE_ORDER: readonly GuardRuleId[] = [
  'countdown-mechanics',
  'flashing-effects',
  'mistake-penalty',
  'superseded-palette',
  'colour-only-cue',
];

export interface GuardFinding {
  decision_id: string;
  decision_excerpt: string;
  rule: GuardRuleId;
  severity: 'high' | 'medium';
  evidence: string;
  explanation: string;
  blocks_approval: boolean;
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
};

// ---------------------------------------------------------------------------
// Rule A — countdown mechanics.
// BLOCK only on unambiguous countdown implementations; ordinary elapsed-time
// counters (`elapsed += 1`) and unrelated uses of "timer" must not match.

const COUNTDOWN_SOURCE =
  /\bcountdown\b|timeLeft|secondsLeft|timeRemaining|time_remaining\b|\b(?:time|timer|clock)\s*(?:--|-=\s*\d)/i;

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

function hexesIn(text: string): string[] {
  const found = text.match(HEX_RE);
  return found ? [...new Set(found.map((hex) => hex.toUpperCase()))].sort() : [];
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
  const match = source.match(COUNTDOWN_SOURCE);
  if (!match || match.index === undefined) {
    return {
      decision_id: decision.id,
      rule: 'countdown-mechanics',
      verdict: 'PASS',
      reason: 'no unambiguous countdown implementation found',
      findings: [],
    };
  }
  const finding = makeFinding(
    decision,
    'countdown-mechanics',
    evidenceAt(original, match.index, match[0].length),
    `decision prohibits countdown mechanics; source contains "${match[0]}"`,
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
    const index = source.toUpperCase().indexOf(firstForbidden.toUpperCase());
    const finding = makeFinding(
      decision,
      'superseded-palette',
      evidenceAt(original, Math.max(0, index), firstForbidden.length),
      `superseded palette reintroduced as active styling: ${forbiddenHit.join(', ')} (replaced by ${requiredHexes.join(', ') || requiredFamily || 'unknown'})`,
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
  const forbiddenWordHit =
    forbiddenFamily !== null ? source.match(PALETTE_FAMILIES[forbiddenFamily]) : null;
  const requiredPresent =
    requiredHexes.some((hex) => sourceHexes.has(hex)) ||
    (requiredFamily !== null && PALETTE_FAMILIES[requiredFamily].test(source));
  if (forbiddenWordHit && !requiredPresent) {
    return {
      ...base,
      ...unverified(
        'superseded palette term appears, but only as prose/comment without styling evidence',
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

function makeFinding(
  decision: GuardDecision,
  rule: GuardRuleId,
  evidence: string,
  explanation: string,
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
