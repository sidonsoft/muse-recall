import type { MediaVisualReviewResponse, Memory } from '@mml/shared';
import { Icon } from '../Icon.tsx';
import { reviewFindingRowView } from './generation-view.ts';

/**
 * Advisory screenshot review against the decisions the user picks.
 *
 * Three things are deliberate in this surface:
 *
 * - the review is opt-in, and its result changes nothing. The panel says so on
 *   the same screen that shows the findings, next to a fingerprint of the exact
 *   frame that was reviewed;
 * - every finding carries the evidence and uncertainty the model reported, and a
 *   decision the answer skipped is listed as "not assessed" rather than quietly
 *   treated as consistent;
 * - selecting decisions here is what the *next* update proposal will pin. It is
 *   not an approval, and no proposal is sent from this panel.
 */
export function DecisionReviewPanel({
  decisions,
  loading,
  error,
  selected,
  onToggle,
  review,
  reviewBusy,
  reviewError,
  reviewNotice,
  onReview,
  canReview,
  suppliedLine,
}: {
  decisions: Memory[] | null;
  loading: boolean;
  error: string | null;
  selected: readonly string[];
  onToggle: (memoryId: string, checked: boolean) => void;
  review: MediaVisualReviewResponse | null;
  reviewBusy: boolean;
  reviewError: string | null;
  reviewNotice: string | null;
  onReview: () => void;
  canReview: boolean;
  suppliedLine: string | null;
}) {
  const shown = decisions ?? [];
  const selectedCount = selected.length;

  return (
    <section aria-label="Decision review" className="panel flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="spark" className="size-3.5 text-accent" />
          Decision review
        </h2>
        <span className="chip">advisory</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading && decisions === null ? (
          <div className="space-y-1.5" aria-busy="true">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-err/30 bg-err/5 px-2 py-1.5 text-[10.5px] text-err">
            {error}
          </p>
        ) : null}

        {!loading && !error && shown.length === 0 ? (
          <p className="text-[10.5px] leading-relaxed text-muted">
            No accepted project decisions to review against. Add one in Project memory first.
          </p>
        ) : null}

        {shown.length > 0 ? (
          <fieldset className="space-y-1.5">
            <legend className="eyebrow">Review against</legend>
            {shown.map((memory) => {
              const checked = selected.includes(memory.id);
              return (
                <label
                  key={memory.id}
                  className={`block cursor-pointer rounded-lg border px-2.5 py-2 transition-colors ${
                    checked
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-line bg-surface-2/40 hover:border-line-bright'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => onToggle(memory.id, event.target.checked)}
                      aria-label={`Select decision ${memory.type}`}
                      className="size-3.5 accent-[var(--accent)]"
                    />
                    <span className="chip">{memory.type}</span>
                    <span className="text-[9.5px] text-muted">rev {String(memory.revision)}</span>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-ink-dim">
                    {memory.content}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        <div className="mt-2">
          <button
            type="button"
            onClick={onReview}
            disabled={!canReview || selectedCount === 0 || reviewBusy}
            className="btn btn-sm w-full"
          >
            {reviewBusy ? 'Reviewing screenshot…' : 'Review this screenshot'}
          </button>
          <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
            {canReview
              ? `Reviews the captured frame against ${selectedCount === 0 ? 'no decision yet — select at least one' : `${String(selectedCount)} selected decision${selectedCount === 1 ? '' : 's'}`}. Advisory feedback only: it changes no file and approves nothing. Reviewing the same frame and selection again returns the stored answer rather than asking the model twice — capture a new frame for a fresh look.`
              : 'Capture a screenshot from the preview to review it.'}
          </p>
        </div>

        {reviewError ? (
          <p
            className="mt-2 rounded-md border border-err/30 bg-err/5 px-2 py-1.5 text-[10px] leading-relaxed text-err"
            role="alert"
          >
            {reviewError}
          </p>
        ) : null}

        {reviewNotice ? (
          <p
            className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-[10px] leading-relaxed text-accent"
            role="status"
          >
            {reviewNotice}
          </p>
        ) : null}

        {review ? (
          <section className="mt-2 space-y-1.5" aria-label="Screenshot review feedback">
            <p className="text-[9.5px] leading-relaxed text-muted">
              Frame <code className="text-ink-dim">{review.screenshot_sha256.slice(0, 12)}</code> ·
              artifact unchanged: {review.artifact_changed ? 'no' : 'yes'}
              {review.generation
                ? ` · generation v${String(review.generation.version)} (${review.generation.kind})`
                : ' · not attached to a generation'}
            </p>

            {review.findings.length === 0 && review.unverified.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-muted">
                The review returned no findings. That is not a clean result: it means nothing was
                established.
              </p>
            ) : null}

            <ul className="space-y-1.5">
              {[
                ...review.findings.map((finding) => ({ kind: 'finding' as const, finding })),
                ...review.unverified.map((entry) => ({ kind: 'unverified' as const, entry })),
              ].map((row) => {
                const item = row.kind === 'finding' ? row.finding : row.entry;
                const view = reviewFindingRowView(item);
                const verdict = row.kind === 'finding' ? row.finding.verdict : undefined;
                return (
                  <li
                    key={`${item.decision_id}-${String(item.decision_revision)}`}
                    className="rounded-lg border border-line bg-surface-2/40 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`chip ${
                          view.unverified
                            ? 'border-line-bright bg-base/60 text-muted'
                            : verdict === 'possible_conflict'
                              ? 'border-warn/30 bg-warn/5 text-warn'
                              : verdict === 'consistent'
                                ? 'border-ok/30 bg-ok/5 text-ok'
                                : 'border-line-bright bg-base/60 text-muted'
                        }`}
                      >
                        {view.headline}
                      </span>
                      <span className="text-[9.5px] text-muted">
                        rev {String(item.decision_revision)}
                      </span>
                      <span className="ml-auto text-[9.5px] text-muted">{view.confidence}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
                      <span className="text-muted">In the decision: </span>
                      {item.decision_excerpt}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-ink-dim">
                      <span className="text-muted">
                        {view.unverified ? 'Why not: ' : 'In the frame: '}
                      </span>
                      {view.evidence}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                      <span>Still uncertain: </span>
                      {view.uncertainty}
                    </p>
                  </li>
                );
              })}
            </ul>

            {review.ignored_entries > 0 ? (
              <p className="text-[9.5px] leading-relaxed text-warn">
                {String(review.ignored_entries)} entr
                {review.ignored_entries === 1 ? 'y' : 'ies'} in the model answer described a
                decision that was not selected and was dropped, not counted as feedback.
              </p>
            ) : null}

            <ul className="space-y-1 border-t border-line pt-1.5">
              {review.limits.map((limit) => (
                <li key={limit} className="text-[9.5px] leading-relaxed text-muted">
                  {limit}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="border-t border-line px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted">
          {suppliedLine ??
            'Selected decisions travel with the next update proposal from the prompt panel, pinned to the revisions shown above.'}
        </p>
        <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted">
          Nothing here approves a change. A proposal still has to be reviewed and approved by you.
        </p>
      </div>
    </section>
  );
}
