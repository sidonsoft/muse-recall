import type { ForgeGeneration, ForgeGenerationList } from '@mml/shared';
import { useState } from 'react';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import {
  comparisonLimits,
  decisionReferenceLine,
  driftRowView,
  generationLabelView,
} from './generation-view.ts';

/**
 * Prior generations and the decisions each one was actually given.
 *
 * This panel is a reader, never a writer: it lists what the server recorded, and
 * the wording says so. The labels come from the stored decision reference, not
 * from a guess, and the comparison limits travel with every generation so a
 * stale label can never be read as evidence that a decision influenced the
 * result. A generation whose references predate this feature is reported as
 * missing, not reconstructed.
 */
export function GenerationsPanel({
  generations,
  loading,
  error,
  onRefresh,
}: {
  generations: ForgeGenerationList | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = generations?.items ?? [];
  const limits = comparisonLimits(
    Array.from(new Set(items.flatMap((item) => item.comparison.limits))),
  );

  return (
    <section aria-label="Generations and decisions" className="panel flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="history" className="size-3.5 text-accent" />
          Generations
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[10.5px] text-muted underline-offset-2 hover:text-ink-dim hover:underline"
        >
          {loading ? 'Reloading…' : 'Reload'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading && generations === null ? (
          <div className="space-y-1.5" aria-busy="true">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-full" />
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-err/30 bg-err/5 px-2 py-1.5 text-[10.5px] text-err">
            {error}
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="text-[10.5px] leading-relaxed text-muted">
            No approved generations yet. Approving a version records the decisions it was given.
          </p>
        ) : null}

        <ul className="space-y-1.5">
          {items.map((generation) => (
            <GenerationRow
              key={`${String(generation.version)}-${generation.job_id ?? 'none'}`}
              generation={generation}
              open={openId === `${String(generation.version)}-${generation.job_id ?? 'none'}`}
              onToggle={() =>
                setOpenId((current) =>
                  current === `${String(generation.version)}-${generation.job_id ?? 'none'}`
                    ? null
                    : `${String(generation.version)}-${generation.job_id ?? 'none'}`,
                )
              }
            />
          ))}
        </ul>

        {generations?.truncated === true ? (
          <p className="mt-1.5 text-[10px] text-muted">
            Showing the most recent {String(items.length)} generations.
          </p>
        ) : null}
      </div>

      <div className="border-t border-line px-3 py-2">
        <ul className="space-y-1">
          {limits.map((limit) => (
            <li key={limit} className="text-[9.5px] leading-relaxed text-muted">
              {limit}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function GenerationRow({
  generation,
  open,
  onToggle,
}: {
  generation: ForgeGeneration;
  open: boolean;
  onToggle: () => void;
}) {
  const label = generationLabelView(generation.comparison.label);
  const toneClass =
    label.tone === 'stale'
      ? 'border-warn/30 bg-warn/5 text-warn'
      : label.tone === 'unknown'
        ? 'border-line-bright bg-surface-2 text-muted'
        : 'border-ok/30 bg-ok/5 text-ok';
  const references = generation.memory_reference;

  return (
    <li className="rounded-lg border border-line bg-surface-2/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-ink">v{String(generation.version)}</span>
        {generation.job_kind ? (
          <span className="chip">{generation.job_kind}</span>
        ) : (
          <span className="chip">no job record</span>
        )}
        <span className={`chip ${toneClass}`}>{label.title}</span>
        <span className="ml-auto text-[9.5px] text-muted">
          {formatDateTime(generation.created_at)}
        </span>
      </div>

      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-dim">
        {generation.summary}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted">{generation.comparison.reason}</p>

      {generation.comparison.drift.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {generation.comparison.drift.map((drift) => {
            const view = driftRowView(drift);
            return (
              <li
                key={`head-${drift.memory_id}-${String(drift.supplied_revision)}`}
                className="text-[9.5px] leading-relaxed text-warn"
              >
                decision {view.change}
                {view.retired && drift.current_status !== null ? ` (${drift.current_status})` : ''}
              </li>
            );
          })}
        </ul>
      ) : null}

      {generation.comparison.added_since.length > 0 ? (
        <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
          {String(generation.comparison.added_since.length)} decision
          {generation.comparison.added_since.length === 1 ? '' : 's'} accepted after this generation
          ran — it could not have received{' '}
          {generation.comparison.added_since.length === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      {references === null ? (
        <p className="mt-1 text-[9.5px] leading-relaxed text-warn">
          No decision reference was stored for this generation. Its relationship to current
          decisions is unknown, not absent.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-accent hover:text-ink"
      >
        {open ? 'Hide' : 'Show'} the decisions it was given
        <Icon name={open ? 'chevronDown' : 'chevronRight'} className="size-3" />
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5 border-t border-line pt-1.5">
          {(references ?? []).length === 0 ? (
            <p className="text-[9.5px] text-muted">
              The record shows no decisions supplied to this generation.
            </p>
          ) : null}
          {(references ?? []).map((entry) => (
            <div
              key={`${entry.memory_id}-${String(entry.revision)}`}
              className="rounded border border-line bg-base/50 px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip">{entry.type}</span>
                <span className="text-[9.5px] text-muted">{decisionReferenceLine(entry)}</span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
                {entry.injected_excerpt ?? entry.excerpt}
              </p>
            </div>
          ))}

          {generation.comparison.drift.map((drift) => {
            const view = driftRowView(drift);
            return (
              <div
                key={`${drift.memory_id}-${String(drift.supplied_revision)}`}
                className="rounded border border-warn/25 bg-warn/5 px-2 py-1.5"
              >
                <p className="text-[9.5px] uppercase tracking-wide text-warn">
                  decision {view.change}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
                  <span className="text-muted">Given: </span>
                  {drift.supplied_excerpt}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink-dim">
                  <span className="text-muted">
                    {view.retired ? 'Retired record: ' : 'Now reads: '}
                  </span>
                  {view.current}
                </p>
                <p className="mt-0.5 text-[9.5px] text-muted">{view.currentMeta}</p>
              </div>
            );
          })}

          {generation.comparison.added_since.length > 0 ? (
            <p className="text-[9.5px] leading-relaxed text-muted">
              {String(generation.comparison.added_since.length)} decision
              {generation.comparison.added_since.length === 1 ? '' : 's'} accepted after this
              generation ran. It could not have received{' '}
              {generation.comparison.added_since.length === 1 ? 'it' : 'them'}; only a new job can
              use current guidance.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
