/**
 * Phase 12D — authentic Muse-generated source corpus category.
 *
 * Source: experiments/muse-forge/game/index.html — the final-state artifact of
 * the Muse Forge feasibility sprint (docs/MUSE_FORGE_FEASIBILITY.md): generated
 * by real Muse (`muse-wonder-1.0`, Muse Code 1.4.13), experiment C, and
 * committed untouched in f751233. The file is READ-ONLY input here; the corpus
 * asserts its sha256 so any edit to the artifact fails this audit loudly.
 *
 * Provenance rules honoured:
 *  - no fabricated provenance: decisions below are auditor-written fixtures
 *    paired with the authentic SOURCE; the decisions are synthetic.
 *  - no paid Muse inference was run for this audit.
 *  - the generated source is not modified, reformatted, or truncated.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  GuardDecision,
  GuardOptions,
  GuardVerdict,
} from '../../../../packages/decision-guard/src/index.js';
import type { CorpusCategory, GroundTruth } from './corpus.js';

const GAME_URL = new URL('../../../../experiments/muse-forge/game/index.html', import.meta.url);

export const AUTHENTIC_FILE = {
  label: 'experiments/muse-forge/game/index.html',
  // Final-state artifact of feasibility experiment C (26,260 bytes, commit f751233).
  sha256: '34bc91e5dfdbf202f697408959a666ffd6a1dc6a20783ac7900ff6c1b060a93d',
  bytes: 26_260,
};

export function readAuthenticSource(): string {
  const source = readFileSync(fileURLToPath(GAME_URL), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== AUTHENTIC_FILE.sha256) {
    throw new Error(
      `authentic artifact changed: ${AUTHENTIC_FILE.label} sha256 ${hash} (expected ${AUTHENTIC_FILE.sha256})`,
    );
  }
  return source;
}

// ---------------------------------------------------------------------------
// Auditor-written decisions for the authentic game. These are SYNTHETIC
// decisions: the provenance claim covers the source file only.

export const DEC_AUTHENTIC_PACE: GuardDecision = {
  id: '12d-auth-dec-pace',
  content: "Monty's Memory Meadow is for ages 4-7: no countdown timers and no time pressure.",
  status: 'active',
  supersedes: [],
};

export const DEC_AUTHENTIC_FLASH: GuardDecision = {
  id: '12d-auth-dec-flash',
  content: "No flashing or blinking may be used in Monty's Memory Meadow.",
  status: 'active',
  supersedes: [],
};

export const DEC_AUTHENTIC_PENALTY: GuardDecision = {
  id: '12d-auth-dec-penalty',
  content: 'Mistakes must never cost score penalties: wrong flips must not reduce the score.',
  status: 'active',
  supersedes: [],
};

/** Hypothetical palette correction for the authentic game (auditor-written). */
export const DEC_AUTHENTIC_PALETTE: GuardDecision = {
  id: '12d-auth-dec-palette',
  content:
    'The meadow palette now uses fresh leaf greens, accent 0x43A047, replacing the dusk sunset oranges 0xFF7E47 and 0xFFC94D.',
  status: 'active',
  supersedes: ['12d-auth-dec-palette-old'],
};

export const DEC_AUTHENTIC_PALETTE_OLD: GuardDecision = {
  id: '12d-auth-dec-palette-old',
  content: 'The dusk gradient background used sunset oranges 0xff7e47 and 0xffc94d.',
  status: 'superseded',
  supersedes: [],
};

export const DEC_AUTHENTIC_COLOUR: GuardDecision = {
  id: '12d-auth-dec-colour',
  content: "Essential actions in Monty's Memory Meadow must work without colour discrimination.",
  status: 'active',
  supersedes: [],
};

export interface AuthenticCase {
  id: string;
  rule:
    | 'countdown-mechanics'
    | 'flashing-effects'
    | 'mistake-penalty'
    | 'superseded-palette'
    | 'colour-only-cue';
  category: CorpusCategory;
  decisions: readonly GuardDecision[];
  options?: GuardOptions;
  ground_truth: GroundTruth;
  ideal: GuardVerdict;
  notes: string;
}

export const AUTHENTIC_CASES: readonly AuthenticCase[] = [
  {
    id: 'M01',
    rule: 'countdown-mechanics',
    category: 'compliance-clear',
    decisions: [DEC_AUTHENTIC_PACE],
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Authentic artifact has no timer countdown; the word "timers" appears only in a design comment (line 35).',
  },
  {
    id: 'M02',
    rule: 'flashing-effects',
    category: 'compliance-clear',
    decisions: [DEC_AUTHENTIC_FLASH],
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes:
      'Victory bounce / card flip use one-shot tweens (yoyo, repeat:1); engine gap means tween pulses would also pass if repeated forever.',
  },
  {
    id: 'M03',
    rule: 'mistake-penalty',
    category: 'compliance-clear',
    decisions: [DEC_AUTHENTIC_PENALTY],
    ground_truth: 'compliant',
    ideal: 'PASS',
    notes: 'Score only increments (`this.score += 1`); "penalties" occurs only in a comment.',
  },
  {
    id: 'M04',
    rule: 'superseded-palette',
    category: 'violation-clear',
    decisions: [DEC_AUTHENTIC_PALETTE],
    options: { supersededDecisions: [DEC_AUTHENTIC_PALETTE_OLD] },
    ground_truth: 'violation',
    ideal: 'BLOCK',
    notes:
      'Hypothetical correction: sunset gradient hexes 0xff7e47/0xffc94d are live Graphics background code in the artifact → block is warranted.',
  },
  {
    id: 'M05',
    rule: 'colour-only-cue',
    category: 'ambiguous',
    decisions: [DEC_AUTHENTIC_COLOUR],
    ground_truth: 'indeterminate',
    ideal: 'UNVERIFIED',
    notes:
      'No evaluable red/green token pair (flower hexes like 0xef5350 are outside the token list); engine abstains.',
  },
];
