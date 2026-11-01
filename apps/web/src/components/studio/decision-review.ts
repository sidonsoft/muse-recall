import type { ForgeJob, Memory } from '@mml/shared';
import type { PinnedDecisionSelection } from '../../lib/api.ts';
import { ApiError } from '../../lib/api.ts';

/**
 * Batch E — the data plumbing behind decision review and update proposals.
 *
 * Kept outside the component so the two rules the acceptance criteria care
 * about can be tested directly: the client only ever names a decision by id and
 * the revision it is displaying, and nothing here promotes a review finding into
 * an approval or a change to the artifact.
 */

/** Decisions this screen may offer for review or for the next update proposal. */
export function selectableDecisions(memories: Memory[] | null): Memory[] {
  return (memories ?? []).filter((memory) => memory.status === 'active');
}

/**
 * The payload sent for a selection. Revision comes from the record the row was
 * rendered from, so an in-place edit between render and click is a conflict the
 * server reports rather than a silent change of subject.
 */
export function pinnedSelection(
  ids: readonly string[],
  decisions: readonly Memory[],
): PinnedDecisionSelection[] {
  const byId = new Map(decisions.map((memory) => [memory.id, memory]));
  return ids
    .map((id) => byId.get(id))
    .filter((memory): memory is Memory => memory !== undefined)
    .map((memory) => ({ memory_id: memory.id, expected_revision: memory.revision }));
}

/**
 * Exact revisions the last job was handed, as one inspectable line. A job that
 * took no user selection says so instead of implying the model chose them.
 */
export function suppliedRevisionsLine(job: ForgeJob | null): string | null {
  if (job === null) return null;
  const supplied = job.decision_revisions_supplied ?? [];
  if (supplied.length === 0) {
    return 'The last job recorded no decisions you selected; Recall chose from project memory on its own.';
  }
  const parts = supplied.map(
    (entry) =>
      `${entry.type} rev ${String(entry.revision)}${entry.injected_truncated === true ? ' (shortened in the prompt)' : ''}`,
  );
  return `Supplied to the last job: ${parts.join(', ')}.`;
}

/** Guidance for a failed review, keyed to the code the route actually returns. */
export function reviewFailureText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'decision_revision_conflict') {
      return 'A selected decision was edited after this screen loaded. Nothing was reviewed. Re-read the decisions and select the current revision.';
    }
    if (cause.code === 'decision_not_active' || cause.code === 'decision_superseded') {
      return 'A selected decision is no longer an accepted current decision. Nothing was reviewed. Pick from the current decisions.';
    }
    if (cause.code === 'decision_not_found' || cause.code === 'decision_cross_project') {
      return 'A selected decision does not belong to this project. Nothing was reviewed.';
    }
    if (cause.code === 'invalid_job_id') {
      return 'The generation this review named is not an approved generation of this project. Nothing was reviewed.';
    }
    if (cause.code === 'media_unconfigured') {
      return 'Visual review is not configured on this server, so no screenshot can be reviewed.';
    }
    if (cause.code === 'media_unavailable' || cause.code === 'provider_invalid_output') {
      return `The vision review did not return usable feedback (${cause.code}). Nothing was changed; try again or review the frame yourself.`;
    }
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** Same handling for a refused update proposal, whose causes overlap. */
export function proposalFailureText(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'decision_revision_conflict') {
    return 'The decisions this screen selected are not current. The update was not proposed. Re-read the decisions and try again.';
  }
  if (cause instanceof ApiError && cause.code === 'decision_superseded') {
    return 'A selected decision has been corrected by a newer one. The update was not proposed.';
  }
  return reviewFailureText(cause);
}
