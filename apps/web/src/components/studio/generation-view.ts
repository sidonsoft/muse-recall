import type {
  ForgeDecisionDrift,
  ForgeDecisionReference,
  ForgeGeneration,
  GenerationDecisionLabel,
  VisualReviewFinding,
  VisualReviewUnverified,
  VisualReviewVerdict,
} from '@mml/shared';

/**
 * Batch E — how decision history and screenshot review are worded.
 *
 * The wording is the contract, so it lives outside the components and is unit
 * tested directly. Two rules hold for every surface:
 *
 * - a generation that was given a decision that is no longer current is called
 *   "Received previous decision", and one that simply could not have received a
 *   later decision is "Potentially affected". Neither phrasing may claim that a
 *   decision caused anything the generation did;
 * - a decision record that was deleted, purged, or expired is described as
 *   retired. Its surviving wording is never presented as current guidance.
 */

export interface GenerationLabelView {
  /** The exact label text the acceptance criteria name. */
  title: string;
  /** One plain sentence on what the label does and does not say. */
  meaning: string;
  tone: 'stale' | 'unknown' | 'current';
}

const GENERATION_LABELS: Record<GenerationDecisionLabel, GenerationLabelView> = {
  received_previous_decision: {
    title: 'Received previous decision',
    meaning:
      'The stored record proves this generation was handed wording that is no longer current. It says nothing about how that guidance affected the result.',
    tone: 'stale',
  },
  potentially_affected: {
    title: 'Potentially affected',
    meaning:
      'This generation could not have received a decision that did not exist when it ran, or no reference was stored for it. The relationship to current guidance is unknown, not measured.',
    tone: 'unknown',
  },
  matched_current_decision: {
    title: 'Matched current decision',
    meaning:
      'Every decision reference stored for this generation still matches the current record. That is a record of what it was given, not proof it followed it.',
    tone: 'current',
  },
};

export function generationLabelView(label: GenerationDecisionLabel): GenerationLabelView {
  return GENERATION_LABELS[label];
}

/** The label names, exactly as the plan's acceptance text spells them. */
export const GENERATION_LABEL_TITLES: readonly string[] = [
  'Received previous decision',
  'Potentially affected',
  'Matched current decision',
];

/**
 * Fallback disclaimer for the rare payload with no limits text. The server sends
 * limits with every comparison; the UI still refuses to render a bare label.
 */
export const FALLBACK_COMPARISON_LIMIT =
  'Labels describe which decisions a generation was given; they are not evidence that the model followed, was guided by, or was caused by any decision.';

export function comparisonLimits(limits: readonly string[]): readonly string[] {
  return limits.length > 0 ? limits : [FALLBACK_COMPARISON_LIMIT];
}

export interface DriftRowView {
  change: string;
  /** Wording shown for the current record; null when there is nothing current. */
  current: string;
  currentMeta: string;
  retired: boolean;
}

const CHANGE_TEXT: Record<ForgeDecisionDrift['change'], string> = {
  revised_in_place: 'edited in place',
  superseded: 'corrected by a newer decision',
  withdrawn: 'retired',
};

export function driftRowView(drift: ForgeDecisionDrift): DriftRowView {
  const retired = drift.change === 'withdrawn';
  const status = drift.current_status;
  return {
    change: CHANGE_TEXT[drift.change],
    // A retired record's text may still be readable in the store. Showing it in
    // the slot reserved for current guidance would present it as guidance the
    // generation missed, so the slot stays empty regardless of what a payload
    // happens to carry.
    current: retired
      ? '(no current wording — the decision is retired)'
      : (drift.current_excerpt ?? '(no current wording — the record is gone)'),
    currentMeta: retired
      ? status === null
        ? 'record gone (purged or never resolvable)'
        : `retired: ${status}`
      : `revision ${String(drift.current_revision ?? '?')}`,
    retired,
  };
}

/** How one stored reference reads: which revision, and whether it was shortened. */
export function decisionReferenceLine(entry: ForgeDecisionReference): string {
  const parts = [`rev ${String(entry.revision)}`];
  if (entry.injected_truncated === true) {
    parts.push('truncated to a prefix in the prompt');
  } else if (entry.injected_sha256 !== undefined) {
    parts.push('injected as stored');
  } else {
    parts.push('not injected into this generation');
  }
  if (entry.user_selected) parts.push('selected by you');
  return parts.join(' · ');
}

/** One line summarising a listed generation for a heading or list row. */
export function generationSummaryLine(generation: ForgeGeneration): string {
  const label = generationLabelView(generation.comparison.label);
  const version = generation.version === null ? 'unapproved' : `v${String(generation.version)}`;
  const kind = generation.job_kind ?? 'generation';
  return `${version} · ${kind} · ${label.title}`;
}

/** Verdict wording that stays about the frame, never about the app as a whole. */
const VERDICT_TEXT: Record<VisualReviewVerdict, string> = {
  consistent: 'the frame appears consistent',
  possible_conflict: 'the frame may conflict',
  unclear: 'the frame does not show enough to tell',
};

export function verdictText(verdict: VisualReviewVerdict): string {
  return VERDICT_TEXT[verdict];
}

export interface ReviewRowView {
  headline: string;
  evidence: string;
  uncertainty: string;
  confidence: string;
  unverified: boolean;
}

export function reviewFindingRowView(
  finding: VisualReviewFinding | VisualReviewUnverified,
): ReviewRowView {
  const isUnverified = 'reason' in finding;
  return {
    headline: isUnverified ? 'not assessed' : verdictText(finding.verdict as VisualReviewVerdict),
    evidence: isUnverified ? (finding as VisualReviewUnverified).reason : finding.evidence,
    uncertainty: finding.uncertainty,
    confidence: isUnverified
      ? 'no confidence reported'
      : `model self-report ${String(Math.round((finding as VisualReviewFinding).confidence * 100))}%`,
    unverified: isUnverified,
  };
}

/** Review state shown next to the proposal trigger, derived only from data. */
export function reviewStateLine(input: {
  findings: readonly VisualReviewFinding[];
  unverified: readonly VisualReviewUnverified[];
}): string {
  if (input.findings.length === 0 && input.unverified.length === 0) {
    return 'No review yet. Proposing an update does not require one.';
  }
  return `${String(input.findings.length)} finding${input.findings.length === 1 ? '' : 's'} · ${String(
    input.unverified.length,
  )} not assessed`;
}
