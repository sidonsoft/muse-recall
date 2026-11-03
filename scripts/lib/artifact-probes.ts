/**
 * Judgements used by `verify:artifact-probes`.
 *
 * The human review of Palette Bench found, by reading the source and thinking about sequences the
 * capture never drove, three defects the automated capture had reported `issues: []` over (KI-87
 * stale exported output, KI-88 numeric seed collisions, KI-89 undo not surviving a reload). These
 * helpers turn each of those shapes into a measurement, so the next capture does not have to wait
 * for a person to notice them.
 *
 * Everything here is a judgement over already-measured values; nothing in this file touches a
 * browser, a provider, or an artifact.
 */

/** A `#rgb` / `#rrggbb` colour token, as it appears in rendered text or in exported CSS. */
export const HEX_TOKEN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

export function hexTokens(value: string): string[] {
  const found = value.match(HEX_TOKEN) ?? [];
  return found.map((token) => token.toLowerCase());
}

/** Unique, order-preserving. */
export function unique(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export interface StalePublication {
  /** The colours the application is showing right now. */
  displayed: string[];
  /** The colours inside the output the application publishes (exported text, clipboard). */
  published: string[];
}

export interface StaleFinding {
  stale: boolean;
  /** True when the probe could not read a single colour out of what the app handed over. */
  nothing_handed_over: boolean;
  /** Published colours the application is not currently displaying. */
  publishes_unseen: string[];
  /** Displayed colours missing from what it publishes. */
  omits_displayed: string[];
  note: string;
}

/**
 * Is the thing the app publishes still the thing the app shows?
 *
 * The reviewer's sequence was: generate A, export A, generate B, copy — and the clipboard delivered
 * A while the screen showed B. A published set that disagrees with the displayed set is the
 * measurable form of that, whatever the app calls "publish".
 */
export function stalePublication(input: StalePublication): StaleFinding {
  const displayed = unique(input.displayed);
  const published = unique(input.published);
  const nothingHandedOver = published.length === 0;
  const publishesUnseen = published.filter((token) => !displayed.includes(token));
  const omitsDisplayed = displayed.filter((token) => !published.includes(token));
  // Nothing handed over is its own fact, not a stale publication. An export area left empty after a
  // "copied to your clipboard" message is a different defect from handing over an old palette, and
  // calling it stale would describe a comparison that never happened.
  const stale = !nothingHandedOver && (publishesUnseen.length > 0 || omitsDisplayed.length > 0);
  return {
    stale,
    nothing_handed_over: nothingHandedOver,
    publishes_unseen: publishesUnseen,
    omits_displayed: omitsDisplayed,
    note: nothingHandedOver
      ? 'nothing was handed over to compare against what the application displays: if it said it ' +
        'exported or copied, that claim did not hold; if it never claimed to, there is nothing to compare'
      : stale
        ? `the published output carries ${String(publishesUnseen.length)} colour(s) the application is ` +
          `not displaying and omits ${String(omitsDisplayed.length)} it is displaying`
        : 'the published output carries exactly the colours the application is displaying',
  };
}

export interface SeedCollision {
  seed_a: string;
  seed_b: string;
  palette_a: string[];
  palette_b: string[];
  /** Distinct palettes the probe sampled. Without these, no claim is made about the size of the space. */
  palettes_observed?: number;
  /** Distinct seeds the probe tried. */
  seeds_observed?: number;
}

/**
 * Two distinct seeds producing one palette, where the difference is a multiple of 2^32.
 *
 * A generator that folds a seed into 32 bits accepts numbers the field will take and quietly gives
 * them back as each other. The 2^32 test is what separates "the app has a small palette" from "the
 * app truncates the number you typed", which is the difference between a design choice and a bug.
 */
export function seedCollision(input: SeedCollision): string | null {
  const a = input.palette_a.join(',');
  const b = input.palette_b.join(',');
  if (input.seed_a === input.seed_b) return null;
  if (a !== b) return null;
  const na = Number(input.seed_a);
  const nb = Number(input.seed_b);
  const wraps = Number.isFinite(na) && Number.isFinite(nb) && Math.abs(nb - na) % 2 ** 32 === 0;
  if (!wraps) {
    const { palettes_observed: palettes, seeds_observed: seeds } = input;
    if (palettes !== undefined && seeds !== undefined && palettes >= seeds) {
      // Every seed sampled produced its own palette. A generator with a narrow range is a design
      // choice, and the probe has no evidence of a bug to report.
      return null;
    }
    const measured =
      palettes !== undefined && seeds !== undefined
        ? `${String(palettes)} palette(s) across ${String(seeds)} seed(s) sampled, so seeds inside that ` +
          'range can collide and the user has no signal that they did — depending on intent this may not ' +
          'be a bug'
        : 'the size of the output space was not sampled, so this collision is reported without any ' +
          'claim about how large or small the space is';
    return (
      `seeds ${input.seed_a} and ${input.seed_b} produced the same palette (${input.palette_a.join(' ')}) ` +
      `— not a 2^32 wrap: ${measured}`
    );
  }
  return (
    `seeds ${input.seed_a} and ${input.seed_b} differ by a multiple of 2^32 and produced the same ` +
    `palette (${input.palette_a.join(' ')}): the generator truncates the number the field accepted, ` +
    'so distinct inputs the user can type are silently equivalent'
  );
}

export interface ReloadState {
  /** Rendered colours before the reload. */
  before: string[];
  /** Rendered colours after the reload. */
  after: string[];
  /** Whether an undo affordance was present before the reload. */
  undo_before: boolean;
  /** Whether an undo affordance was present after the reload. */
  undo_after: boolean;
  /** Whether the app stores anything at all (a document with no storage is not failing). */
  uses_storage: boolean;
  /**
   * Whether a destructive action taken *after* the reload offers a way back. It separates "Undo is
   * broken" from "Undo is session-scoped": the second still satisfies the decision word for word
   * inside a session, and the reviewer's finding was the second one.
   */
  undo_after_new_destruction?: boolean;
}

export interface PersistenceFinding {
  persisted: boolean;
  undo_survives: boolean;
  /** True when undo works inside a session but nothing carries across a reload; null if unmeasured. */
  undo_session_scoped: boolean | null;
  note: string;
}

export function reloadPersistence(input: ReloadState): PersistenceFinding {
  const before = unique(input.before);
  const after = unique(input.after);
  // "Survived" has to mean the affordance was there and is still there. An earlier draft compared the
  // two booleans with `===`, which read "no undo control before the reload and none after" as a pass —
  // the exact sloppy reading this helper exists to prevent.
  const undoSurvives = input.undo_before && input.undo_after;
  const sessionScoped =
    input.undo_after_new_destruction === undefined
      ? null
      : !undoSurvives && input.undo_after_new_destruction;
  // Emptying the state is itself state: a reload that brings colours back did not preserve what the
  // user left, even though both sides are "a palette".
  const persisted = before.length === 0 ? after.length === 0 : before.join(',') === after.join(',');
  let note: string;
  if (!input.uses_storage) {
    note = 'the application keeps no storage at all, so reload persistence is not a claim it makes';
  } else if (before.length === 0 && after.length > 0) {
    note =
      'the state had been emptied before the reload and the reload produced colours anyway, so what the ' +
      'user sees is not what they left';
  } else if (persisted && input.undo_before && !input.undo_after) {
    note =
      'the state survived the reload but the undo affordance did not: what was undone away from is ' +
      'still gone while the way back has disappeared';
  } else if (sessionScoped === true) {
    note =
      'undo does not carry across the reload, but a destructive action taken after the reload does ' +
      'offer a way back: the affordance is session-scoped rather than broken';
  } else if (sessionScoped === false) {
    note =
      'no undo affordance after the reload and none for a destructive action taken after it either: ' +
      'this artifact offers no way back at all';
  } else if (!persisted && input.uses_storage) {
    note =
      `the application stores state but the reload produced ${String(after.length)} colour(s) where ` +
      `${String(before.length)} were displayed, so what the user sees is not what they left`;
  } else {
    note = 'state and undo affordance both survived the reload';
  }
  return { persisted, undo_survives: undoSurvives, undo_session_scoped: sessionScoped, note };
}

/** Findings the probe battery reached, in the order a reader should see them. */
export function probeFindings(parts: {
  stale?: StaleFinding;
  collision?: string | null;
  persistence?: PersistenceFinding;
}): string[] {
  const out: string[] = [];
  if (parts.stale?.stale) out.push(`stale published output: ${parts.stale.note}`);
  if (parts.stale?.nothing_handed_over) out.push(`nothing handed over: ${parts.stale.note}`);
  if (parts.collision) out.push(`seed collision: ${parts.collision}`);
  if (parts.persistence && (!parts.persistence.persisted || !parts.persistence.undo_survives)) {
    out.push(`reload persistence: ${parts.persistence.note}`);
  }
  return out;
}
