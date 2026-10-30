/**
 * Phase 12D — decision fixtures for the Decision Guard accuracy audit.
 *
 * All decisions are hand-written auditor fixtures (synthetic provenance).
 * Ids are prefixed `12d-` so they never collide with real project memories.
 */

import type { GuardDecision } from '../../../../packages/decision-guard/src/index.js';

export const DEC_COUNTDOWN: GuardDecision = {
  id: '12d-dec-countdown',
  content:
    'This game is for children aged 4-7. No countdown timers and no time pressure: children play at their own pace.',
  status: 'active',
  supersedes: [],
};

export const DEC_FLASH: GuardDecision = {
  id: '12d-dec-flash',
  content: 'Avoid flashing or blinking visual effects anywhere in the game.',
  status: 'active',
  supersedes: [],
};

export const DEC_PENALTY: GuardDecision = {
  id: '12d-dec-penalty',
  content: 'Never issue score penalties: a wrong match must not reduce the score.',
  status: 'active',
  supersedes: [],
};

/**
 * Decision-linking gap probe: the verb forms "penalise"/"penalize" do NOT
 * match the engine's `penalt\w+` matcher (nouns only). Genuine engine gap.
 */
export const DEC_PENALTY_VERB: GuardDecision = {
  id: '12d-dec-penalty-verb',
  content: 'Wrong matches must never penalise the player.',
  status: 'active',
  supersedes: [],
};

export const DEC_PALETTE: GuardDecision = {
  id: '12d-dec-palette',
  content:
    'The meadow palette now uses cool sky blues, accent #4FC3F7, replacing the old warm palette.',
  status: 'active',
  supersedes: ['12d-dec-palette-old'],
};

export const DEC_PALETTE_OLD: GuardDecision = {
  id: '12d-dec-palette-old',
  content: 'The meadow palette used warm sunset oranges, accent #FF7E47 and #FFB300.',
  status: 'superseded',
  supersedes: [],
};

export const DEC_COLOUR: GuardDecision = {
  id: '12d-dec-colour',
  content:
    'All essential actions must work without colour discrimination; never rely on colour only.',
  status: 'active',
  supersedes: [],
};

// ---------------------------------------------------------------------------
// Supplementary decision fixtures for specific audit dimensions.

/** Negation-scope probe: bans countdowns but EXPLICITLY ALLOWS brief flashing. */
export const DEC_FLASH_ALLOWED: GuardDecision = {
  id: '12d-dec-flash-allowed',
  content: 'Do not use countdown timers; brief flashing transitions are acceptable.',
  status: 'active',
  supersedes: [],
};

/** Decision-linking gap: describes a countdown without the word "countdown". */
export const DEC_SOFT_PACE: GuardDecision = {
  id: '12d-dec-soft-pace',
  content: 'Remaining playtime should drain slowly; never show seconds left.',
  status: 'active',
  supersedes: [],
};

/** Decision-linking gap: red/green wording without the word "colour". */
export const DEC_RED_GREEN: GuardDecision = {
  id: '12d-dec-red-green',
  content: 'Never use flashing effects or red/green-only pairs for essential actions.',
  status: 'active',
  supersedes: [],
};

/** Irrelevant active decision (must yield none-applicable, never PASS). */
export const DEC_MUSIC: GuardDecision = {
  id: '12d-dec-music',
  content: 'Background music must not loop aggressively and must not autoplay.',
  status: 'active',
  supersedes: [],
};

/** Inactive memory decisions (must be excluded from enforcement). */
export const DEC_COUNTDOWN_EXPIRED: GuardDecision = {
  id: '12d-dec-countdown-expired',
  content: 'The original ruleset required 30-second countdown rounds.',
  status: 'expired',
  supersedes: [],
};

export const DEC_FLASH_SUPERSEDED: GuardDecision = {
  id: '12d-dec-flash-superseded',
  content: 'Flashing borders were the previous house style.',
  status: 'superseded',
  supersedes: [],
};

export const DEC_PENALTY_SUPERSEDED: GuardDecision = {
  id: '12d-dec-penalty-superseded',
  content: 'Wrong answers previously deducted 5 points.',
  status: 'superseded',
  supersedes: [],
};

/** Palette decision that is not a correction (supersedes: []). */
export const DEC_PALETTE_PLAIN: GuardDecision = {
  id: '12d-dec-palette-plain',
  content: 'Every screen must keep a calm, low-saturation palette.',
  status: 'active',
  supersedes: [],
};

/** Correction whose superseded record has family words but NO hexes. */ export const DEC_PALETTE_COOL: GuardDecision =
  {
    id: '12d-dec-palette-cool',
    content: 'The meadow palette now uses cool ocean blues, accent #4FC3F7.',
    status: 'active',
    supersedes: ['12d-dec-palette-warm-words'],
  };

export const DEC_PALETTE_WARM_WORDS: GuardDecision = {
  id: '12d-dec-palette-warm-words',
  content: 'The meadow palette used warm sunset oranges.',
  status: 'superseded',
  supersedes: [],
};

/** Correction with two superseded records; the engine only inspects the first found. */
export const DEC_PALETTE_MULTI: GuardDecision = {
  id: '12d-dec-palette-multi',
  content: 'The meadow palette now uses cool sky blues, accent #4FC3F7.',
  status: 'active',
  supersedes: ['12d-dec-palette-lime', '12d-dec-palette-orange'],
};

export const DEC_PALETTE_LIME: GuardDecision = {
  id: '12d-dec-palette-lime',
  content: 'The palette used bright lime greens, accent #AEEA00.',
  status: 'superseded',
  supersedes: [],
};

export const DEC_PALETTE_ORANGE: GuardDecision = {
  id: '12d-dec-palette-orange',
  content: 'The palette used warm sunset oranges, accent #FF7E47.',
  status: 'superseded',
  supersedes: [],
};

/** All five decision matchers fire from one content string (finding-cap probe). */
export const DEC_ALL_RULES: GuardDecision = {
  id: '12d-dec-all-rules',
  content:
    'No countdown timers, avoid flashing, no score penalties, replace the warm sunset palette accent #FF7E47, and never rely on colour only.',
  status: 'active',
  supersedes: [],
};

// --- v1.5.0 rule families (roadmap G-7) -----------------------------------

/** Rule F decision: prohibit autoplaying media. */
export const DEC_AUTOMEDIA: GuardDecision = {
  id: '15-dec-autmedia',
  content: 'Never autoplay audio or music; playback starts only on user action.',
  status: 'active',
  supersedes: [],
};

/** Expired record that REQUIRED autoplay: must not enforce against rule F. */
export const DEC_AUTOMEDIA_EXPIRED: GuardDecision = {
  id: '15-dec-autmedia-expired',
  content: 'The soundtrack must autoplay on load.',
  status: 'expired',
  supersedes: [],
};

/** Rule G decision: self-contained app, no remote assets. */
export const DEC_EXT: GuardDecision = {
  id: '15-dec-ext',
  content:
    'The app must stay self-contained: no external CDNs, scripts, fonts, or other remote assets.',
  status: 'active',
  supersedes: [],
};

/** Expired record that allowed CDN loading: must not enforce against rule G. */
export const DEC_EXT_EXPIRED: GuardDecision = {
  id: '15-dec-ext-expired',
  content: 'Earlier builds pulled Phaser from a public CDN.',
  status: 'expired',
  supersedes: [],
};
