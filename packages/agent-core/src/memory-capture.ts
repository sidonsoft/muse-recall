import type { Memory, MemoryCandidate, MemoryType } from '@mml/shared';

/**
 * Explicit memory capture and conservative candidate extraction.
 *
 * Two rules govern this module:
 *
 * 1. **Only the user creates memories by request.** An explicit instruction
 *    ("remember that …") stores what the *user* said, with the user's message
 *    as provenance.
 * 2. **Extraction only proposes.** Candidates are returned to the interface for
 *    confirmation; nothing is written from a model's guess or from a sentence
 *    the user did not ask to keep.
 */

export interface ParsedMemoryCommand {
  trigger: 'leading' | 'trailing';
  facts: string[];
  /** True when the user framed the message as a change to prior knowledge. */
  correction: boolean;
}

const CUE = /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)\b/i;
const LEADING_CUE =
  /^\s*(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)\b\s*(?:(?:that|this|these)\b\s*[:,]?\s*|:\s*)?([\s\S]+)$/i;
const CUE_WITH_POINTER =
  /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)\s+(?:these|this|that)\b/i;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'will',
  'with',
  'you',
  'your',
  'now',
  'not',
  'no',
  'do',
  'does',
  'did',
  'should',
  'would',
  'could',
]);

export function meaningfulTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}+#]+/gu);
  const result = new Set<string>();
  for (const token of tokens ?? []) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    result.add(token);
  }
  return result;
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function looksLikeFact(sentence: string): boolean {
  if (sentence.trim().endsWith('?')) return false;
  if (words(sentence).length < 3) return false;
  return sentence.length <= 8_000;
}

/**
 * Detect an explicit "remember this" instruction.
 *
 * Handles three shapes:
 *   - trailing: "… facts … Remember these requirements."
 *   - leading:  "Remember that this project uses Phaser."
 *   - cue-first: "Remember these requirements. We build with Phaser."
 */
export function parseMemoryCommand(text: string): ParsedMemoryCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const correction = /\b(correction|changed?|instead of|no longer|switched|updated?)\b/i.test(
    trimmed,
  );

  const sentences = splitSentences(trimmed);
  const first = sentences[0];
  const last = sentences[sentences.length - 1];

  // Trailing cue: the last sentence is the instruction, the ones before are facts.
  if (last && CUE.test(last) && sentences.length > 1) {
    const facts = sentences.slice(0, -1).filter(looksLikeFact);
    if (facts.length > 0) return { trigger: 'trailing', facts, correction };
  }

  // Cue-first with a pointer ("remember these requirements."): facts follow.
  // Only when the cue sentence is *only* a pointer — "Remember that the notes
  // say X" is a normal leading instruction whose fact is the rest of the
  // sentence, not the sentence after it.
  if (first && CUE_WITH_POINTER.test(first) && isPurePointer(first) && sentences.length > 1) {
    const facts = sentences.slice(1).filter(looksLikeFact);
    if (facts.length > 0) return { trigger: 'leading', facts, correction };
  }

  // Single-sentence leading form: "remember that X".
  const leading = LEADING_CUE.exec(trimmed);
  if (leading?.[1]) {
    const facts = splitSentences(leading[1]).filter(looksLikeFact);
    if (facts.length > 0) return { trigger: 'leading', facts, correction };
  }

  return null;
}

/** True when a cue sentence carries no fact of its own ("Remember this."). */
export function isPurePointer(sentence: string): boolean {
  const remainder = sentence
    .replace(CUE_WITH_POINTER, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim();
  return remainder.split(/\s+/).filter(Boolean).length <= 3;
}

/**
 * True for sentences that only announce a change without stating the new fact
 * ("We've changed the target platform."). Those are conversation, not knowledge.
 */
export function isAnnouncementOnly(sentence: string): boolean {
  const announced = /^(?:we|i)(?:'ve| have)?\s+(?:changed|updated|switched|decided)\b/i.test(
    sentence.trim(),
  );
  const statesValue = /\b(?:to|instead of|now|will|shall|must|use|using)\b/i.test(sentence);
  return announced && !statesValue;
}

/** Infer a memory type from the fact's wording. Order matters: constraint wins. */
export function inferMemoryType(fact: string): MemoryType {
  if (
    /\b(?:must|cannot|can'?t|requirement|constraint|offline|at least|no more than)\b/i.test(fact)
  ) {
    return 'constraint';
  }
  if (
    /\b(?:art direction|visual style|colour|color|prefer|look and feel|aesthetic)\b/i.test(fact)
  ) {
    return 'preference';
  }
  if (
    /\b(?:using|built with|engine|stack|framework|language|database|phaser|typescript)\b/i.test(
      fact,
    )
  ) {
    return 'technical_decision';
  }
  if (/\b(?:platform|target|mobile|desktop|browser|ios|android)\b/i.test(fact)) {
    return 'technical_decision';
  }
  if (/\b(?:goal|aim|plan to|ship|deadline|milestone)\b/i.test(fact)) {
    return 'goal';
  }
  if (/\b(?:unfinished|todo|next step|not done|remaining|pending)\b/i.test(fact)) {
    return 'unfinished_task';
  }
  return 'contextual_fact';
}

/**
 * Pick the active memory a correction most likely replaces.
 *
 * Deterministic lexical overlap, no model call: at least two meaningful shared
 * tokens, and a blended containment/coverage score above 0.4. This is a
 * heuristic and deliberately conservative — a wrong supersession would destroy
 * a fact the user still needs, so a marginal match creates a new memory instead.
 */
export function selectSupersessionCandidate(candidates: Memory[], fact: string): Memory | null {
  const factTokens = meaningfulTokens(fact);
  if (factTokens.size === 0) return null;

  let best: Memory | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (candidate.status !== 'active') continue;
    const memoryTokens = meaningfulTokens(candidate.content);
    if (memoryTokens.size === 0) continue;

    let shared = 0;
    for (const token of factTokens) {
      if (memoryTokens.has(token)) shared += 1;
    }
    if (shared < 2) continue;

    const containment = shared / Math.min(factTokens.size, memoryTokens.size);
    const coverage = shared / factTokens.size;
    const score = containment * 0.6 + coverage * 0.4;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 0.4 ? best : null;
}

const CANDIDATE_PATTERNS: { pattern: RegExp; type: MemoryType; label: string }[] = [
  {
    pattern: /\bmust\s+([^.!?\n]{4,200})/i,
    type: 'constraint',
    label: 'a stated requirement',
  },
  {
    pattern: /\btarget\s+platform\s+is\s+([^.!?\n]{3,120})/i,
    type: 'technical_decision',
    label: 'a platform decision',
  },
  {
    pattern: /\b(?:we|i)\s+(?:use|are using|will use)\s+([^.!?\n]{3,200})/i,
    type: 'technical_decision',
    label: 'a technology choice',
  },
  {
    pattern: /\b(?:built|written)\s+(?:with|in)\s+([^.!?\n]{3,120})/i,
    type: 'technical_decision',
    label: 'a technology choice',
  },
  {
    pattern: /\bprefer(?:s|red)?\s+([^.!?\n]{3,200})/i,
    type: 'preference',
    label: 'a stated preference',
  },
  {
    pattern: /\b(?:we|i)(?:'ve| have)?\s+decided\s+to\s+([^.!?\n]{3,200})/i,
    type: 'technical_decision',
    label: 'a decision',
  },
  {
    pattern: /\b(?:we|i)(?:'re| are)\s+(?:building|making|creating)\s+([^.!?\n]{3,200})/i,
    type: 'project',
    label: 'a project description',
  },
];

/**
 * Propose memories from a user message.
 *
 * These are **candidates only** — returned to the UI for confirmation, never
 * stored automatically, and never produced from assistant output.
 */
export function extractCandidates(text: string, max = 3): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    if (sentence.trim().endsWith('?')) continue;
    for (const { pattern, type, label } of CANDIDATE_PATTERNS) {
      const match = pattern.exec(sentence);
      const captured = match?.[1]?.trim();
      if (!captured || captured.length < 3) continue;

      const content = normaliseCandidate(sentence, captured);
      const key = content.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        content,
        type,
        confidence: 0.6,
        reason: `looks like ${label}; confirm to store it`,
      });

      if (candidates.length >= max) return candidates;
      break; // one candidate per sentence
    }
  }

  return candidates;
}

/** Keep the full sentence: it usually reads better than the captured fragment. */
function normaliseCandidate(sentence: string, captured: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length <= 240 && words(trimmed).length >= 3) return trimmed;
  return captured.replace(/\s+/g, ' ').trim();
}
