/**
 * Judgements used by `verify:artifact-probes`.
 *
 * The human review of Palette Bench found, by thinking about sequences an automated capture had never
 * driven, three defects that capture had reported `issues: []` over: a stale published output (KI-88),
 * a seed field that accepts numbers the generator folds into 32 bits (KI-89), and undo that does not
 * survive a reload (KI-90). A fourth, layout at phone width (KI-91), was an enhancement request. Those
 * findings were about a generated application. What they exposed here is a harness that could only
 * measure a *state*, and that used one ambiguous word — "no findings" — for four different situations:
 * a sequence that ran and was clean, a sequence that was never run, a sequence that could not run, and
 * a sequence that found something.
 *
 * So every probe here returns a **structured outcome** with the sequence it executed, and the outcome
 * vocabulary is explicit:
 *
 * - `finding`    — the sequence ran and something measurable was wrong
 * - `clean`      — the sequence ran and nothing measurable was wrong
 * - `not_tested` — the sequence was skipped, named, with the reason (no such control here / not asked
 *                  for by the interaction config)
 * - `incomplete` — the sequence started and could not be finished (control not locatable, clipboard
 *                  unreadable, timeout), with the reason
 *
 * A `clean` outcome is never a claim about the application: it is a claim about one sequence. Nothing
 * in this file can say an application is defect-free, and the driver is required to say so out loud.
 *
 * Everything here is a judgement over already-measured values; nothing in this file touches a browser,
 * a provider, or an artifact.
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

export type ProbeStatus = 'finding' | 'clean' | 'not_tested' | 'incomplete';

/** One probe's result: the sequence, what it did, and what came of it. */
export interface ProbeResult {
  probe: string;
  /** The steps actually executed, in the order executed, as a reader could repeat them. */
  sequence: string;
  status: ProbeStatus;
  /** What was observed, or why the sequence did not produce an observation. */
  detail: string;
}

export function findingsOf(results: readonly ProbeResult[]): ProbeResult[] {
  return results.filter((result) => result.status === 'finding');
}

/**
 * One line per probe, always in execution order, so a reader can see what was and was not driven.
 * A run where nothing was tested and a run where everything was clean must not print the same thing.
 */
/** Printed status. `not_tested` prints as `NOT TESTED`, because the reader is not reading TypeScript. */
export function statusLabel(status: ProbeStatus): string {
  return status.replace('_', ' ').toUpperCase();
}

export function renderProbeResults(results: readonly ProbeResult[]): string[] {
  return results.map(
    (result) =>
      `${result.probe.padEnd(30)} ${statusLabel(result.status).padEnd(11)} ${result.sequence}\n` +
      `${' '.repeat(43)}${result.detail}`,
  );
}

/* ------------------------------------------------------------------ *
 * Stale published output (KI-88)
 * ------------------------------------------------------------------ */

export interface StalePublication {
  /** The colours the application is showing right now. */
  displayed: string[];
  /** The colours inside the output the application handed over (exported text, clipboard). */
  published: string[];
}

export interface StaleFinding {
  stale: boolean;
  /** True when the probe could not read a single colour out of what the app handed over. */
  nothing_handed_over: boolean;
  /** Handed-over colours the application is not currently displaying. */
  publishes_unseen: string[];
  /** Displayed colours missing from what it handed over. */
  omits_displayed: string[];
  note: string;
}

/**
 * Is the thing the app hands over still the thing the app shows?
 *
 * The reviewer's sequence was: generate A, export A, generate B, **copy** — and the clipboard
 * delivered A while the screen showed B. Re-pressing "export" instead of copying lets an app refresh
 * its own output and hides exactly that, so the two variants are measured separately.
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
        ? `what was handed over carries ${String(publishesUnseen.length)} colour(s) the application is ` +
          `not displaying and omits ${String(omitsDisplayed.length)} it is displaying ` +
          `(handed over: ${publishesUnseen.slice(0, 5).join(' ') || 'none'})`
        : 'what was handed over carries exactly the colours the application is displaying',
  };
}

/* ------------------------------------------------------------------ *
 * Accepted input versus effective domain (KI-89)
 * ------------------------------------------------------------------ */

export interface InputDomain {
  /** The value the field held after typing, read back from the field. */
  accepted_a: string;
  accepted_b: string;
  output_a: string[];
  output_b: string[];
  /** Distinct outputs the probe sampled, and how many distinct inputs it tried. */
  outputs_observed?: number;
  inputs_observed?: number;
}

/**
 * Two values the input accepts that produce one application output.
 *
 * The distinction this helper exists to preserve: values exactly 2^32 apart landing on one output is
 * truncation — the field took a number the generator cannot represent, and the user gets no signal.
 * A generator with a merely small output space is a design decision. The wording must never blame
 * bounded arithmetic for a choice nobody made, and must never call two values distinct when the
 * observation says otherwise.
 */
export function inputDomainCollision(input: InputDomain): string | null {
  const a = input.output_a.join(',');
  const b = input.output_b.join(',');
  if (input.accepted_a === input.accepted_b) {
    return (
      `the field did not keep the two values apart either (${input.accepted_a} and ` +
      `${input.accepted_b} both read back as the same thing), so the input control itself rejected or ` +
      'normalised one of them — that is a different finding from the generator folding numbers together'
    );
  }
  if (a !== b) return null;
  const na = Number(input.accepted_a);
  const nb = Number(input.accepted_b);
  const wraps = Number.isFinite(na) && Number.isFinite(nb) && Math.abs(nb - na) % 2 ** 32 === 0;
  if (wraps) {
    return (
      `the accepted values ${input.accepted_a} and ${input.accepted_b} differ by a multiple of 2^32 and ` +
      `produced one output (${input.output_a.join(' ')}): the field takes numbers the generator cannot ` +
      'represent, so distinct inputs the user can type are silently equivalent'
    );
  }
  const { outputs_observed: outputs, inputs_observed: inputs } = input;
  if (outputs !== undefined && inputs !== undefined && outputs >= inputs) {
    // Every input sampled produced its own output. A narrow range is a design decision, and there is
    // no evidence of a defect to report.
    return null;
  }
  const measured =
    outputs !== undefined && inputs !== undefined
      ? `${String(outputs)} distinct output(s) across ${String(inputs)} input(s) sampled, so values inside ` +
        'that range can collide and the user gets no signal that they did — depending on intent this may ' +
        'not be a defect'
      : 'the size of the output space was not sampled, so this collision is reported without any claim ' +
        'about how large or small the space is';
  return (
    `the accepted values ${input.accepted_a} and ${input.accepted_b} produced one output ` +
    `(${input.output_a.join(' ')}), which is not a 2^32 wrap: ${measured}`
  );
}

/* ------------------------------------------------------------------ *
 * Undo inside a session
 * ------------------------------------------------------------------ */

export interface UndoAttempt {
  /** Colours displayed before the destructive action. */
  before_destruction: string[];
  /** Colours displayed after the destructive action. */
  after_destruction: string[];
  /** Colours displayed after using the undo affordance. */
  after_undo: string[];
  /** Whether an undo affordance existed after the destructive action. */
  undo_offered: boolean;
}

export interface UndoFinding {
  /** The destructive action changed something on screen, so there was something to undo. */
  destroyed: boolean;
  undo_offered: boolean;
  restored: boolean;
  note: string;
}

/**
 * Destructive action → undo → is the discarded state back?
 *
 * An undo control that exists but does not restore is worse than no control, and a probe that only
 * counts the control reports it as available. Four states get separated here: nothing was destroyed
 * (the sequence proves nothing), no way back is offered, a way back is offered and works, and a way
 * back is offered and does not restore what was discarded.
 */
export function undoWithinSession(input: UndoAttempt): UndoFinding {
  const before = unique(input.before_destruction);
  const after = unique(input.after_destruction);
  const undone = unique(input.after_undo);
  const destroyed = before.join(',') !== after.join(',');
  const restored = undone.join(',') === before.join(',');
  if (!destroyed) {
    return {
      destroyed: false,
      undo_offered: input.undo_offered,
      restored: false,
      note:
        'the destructive action left the displayed state unchanged, so this sequence had nothing to ' +
        'undo and proves nothing about recovery',
    };
  }
  if (!input.undo_offered) {
    return {
      destroyed: true,
      undo_offered: false,
      restored: false,
      note:
        'no undo affordance appeared after the destructive action, so the application offers no way ' +
        'back inside a session',
    };
  }
  if (!restored) {
    return {
      destroyed: true,
      undo_offered: true,
      restored: false,
      note:
        'an undo affordance appeared but the state after using it is not the state that was discarded: ' +
        `the application discarded ${String(before.length)} colour(s) and put back ${String(undone.length)}`,
    };
  }
  return {
    destroyed: true,
    undo_offered: true,
    restored: true,
    note: 'the undo affordance restored the state the destructive action discarded',
  };
}

/* ------------------------------------------------------------------ *
 * Reload persistence and recovery (KI-90)
 * ------------------------------------------------------------------ */

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
   * broken" from "Undo is session-scoped": the second still satisfies a decision word for word inside
   * a session, and the reviewer's finding was the second one.
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

/* ------------------------------------------------------------------ *
 * Narrow viewport (KI-91)
 * ------------------------------------------------------------------ */

export interface ViewportFacts {
  /** The width the document was measured at. */
  width: number;
  /** Widest horizontal extent the document reports for itself. */
  document_scroll_width: number;
  /** Controls the probe could see at all (rendered with a non-empty box). */
  controls_visible: number;
  /** Controls with a visible box that falls partly outside the viewport. */
  controls_clipped: number;
  /** Controls present in the accessibility tree with no usable box (hidden or zero-sized). */
  controls_unusable: number;
  /** Whether the essential interaction still changed what is displayed at this width. */
  interaction_changed_output: boolean;
  /** Whether the interaction control itself was reachable at this width. */
  control_reachable: boolean;
}

export interface ViewportFinding {
  overflow: boolean;
  clipped: number;
  unusable: number;
  interaction_worked: boolean;
  note: string;
}

/**
 * Narrow viewport → interaction.
 *
 * This measures, it does not judge taste. "Harder to compare five swatches" stays a human judgement
 * (KI-91). What can be measured is whether the document scrolls sideways, whether a control's box
 * falls outside the viewport, whether a control is unreachable, and whether the essential interaction
 * still works at that width — the shapes that turn a cramped layout into a broken one.
 */
export function narrowViewport(input: ViewportFacts): ViewportFinding {
  const overflow = input.document_scroll_width > input.width + 2;
  const finding =
    overflow ||
    input.controls_clipped > 0 ||
    input.controls_unusable > 0 ||
    !input.interaction_changed_output;
  const parts: string[] = [];
  if (overflow) {
    parts.push(
      `the document is ${String(input.document_scroll_width)}px wide at ${String(input.width)}px, so the page scrolls sideways`,
    );
  }
  if (input.controls_clipped > 0) {
    parts.push(`${String(input.controls_clipped)} control(s) sit partly outside the viewport`);
  }
  if (input.controls_unusable > 0) {
    parts.push(
      `${String(input.controls_unusable)} control(s) named to assistive technology have no usable box at this width`,
    );
  }
  if (!input.control_reachable) {
    parts.push('the control the sequence needs could not be reached at this width');
  } else if (!input.interaction_changed_output) {
    parts.push('the essential interaction ran without changing what is displayed at this width');
  }
  return {
    overflow,
    clipped: input.controls_clipped,
    unusable: input.controls_unusable,
    interaction_worked: input.interaction_changed_output,
    note: finding
      ? parts.join('; ')
      : `at ${String(input.width)}px the document fits the viewport, every control the probe could name ` +
        'had a usable box inside it, and the essential interaction changed what is displayed',
  };
}

/** A viewport finding becomes a probe finding only when something measurable went wrong. */
export function viewportProbeResult(finding: ViewportFinding, sequence: string): ProbeResult {
  const bad =
    finding.overflow || finding.clipped > 0 || finding.unusable > 0 || !finding.interaction_worked;
  return {
    probe: 'narrow-viewport-interaction',
    sequence,
    status: bad ? 'finding' : 'clean',
    detail: finding.note,
  };
}

/* ------------------------------------------------------------------ *
 * Error → retry → recovery
 * ------------------------------------------------------------------ */

export interface RetryFacts {
  /** What the field held after the invalid input was typed into it. */
  value_after_invalid_input: string;
  /** Colours displayed before and after the invalid attempt. */
  displayed_before_invalid: string[];
  displayed_after_invalid: string[];
  /** Rendered status/live-region text after the invalid attempt. */
  status_after_invalid: string;
  /** Whether the app's own words claim the invalid attempt succeeded. */
  claims_success: boolean;
  /** Colours after retrying with a valid value. */
  displayed_after_retry: string[];
  /** Whether the invalid attempt put non-values into the rendered output. */
  renders_non_values: boolean;
}

export interface RetryFinding {
  note: string;
  /** True when something measurable went wrong. */
  defective: boolean;
  recovered: boolean;
}

/**
 * Invalid input → what the app does → retry with a valid value → recovery.
 *
 * Rejecting invalid input silently is not automatically a defect, and this helper does not pretend it
 * is: it reports what the application actually did, and only calls it a finding for the shapes that
 * mislead — a rendered `NaN`, a success claim with an unchanged result, or a retry that cannot recover.
 */
export function errorThenRetry(facts: RetryFacts): RetryFinding {
  const changedByInvalid =
    unique(facts.displayed_before_invalid).join(',') !==
    unique(facts.displayed_after_invalid).join(',');
  const retryProduced =
    unique(facts.displayed_after_retry).join(',') !==
    unique(facts.displayed_after_invalid).join(',');
  const parts: string[] = [];
  if (facts.renders_non_values) {
    parts.push('the invalid input reached the rendered output as a non-value (NaN or undefined)');
  }
  if (facts.claims_success && !changedByInvalid) {
    parts.push(
      'the application described the attempt as successful while still displaying the previous result',
    );
  }
  if (!retryProduced) {
    parts.push(
      'retrying with a valid value did not change what is displayed, so the sequence cannot recover ' +
        'inside the application',
    );
  }
  if (parts.length === 0) {
    const described = facts.status_after_invalid
      ? `the application said something about the invalid attempt (${JSON.stringify(facts.status_after_invalid.slice(0, 80))})`
      : `the application gave no message about the invalid attempt and left the field reading ${JSON.stringify(facts.value_after_invalid_input)}`;
    return {
      defective: false,
      recovered: retryProduced,
      note: `${described}; a retry with a valid value did change what is displayed${changedByInvalid ? ', and the invalid attempt itself changed the output' : ''}`,
    };
  }
  return { defective: true, recovered: retryProduced, note: parts.join('; ') };
}
