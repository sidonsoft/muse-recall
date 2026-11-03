import { Icon } from '../Icon.tsx';
import { type DependencyView, STATUS_LABELS } from './dependency-view.ts';

/**
 * Dependency disclosure in the human approval rail (KI-74).
 *
 * D059 made the product carry its own copy of the one engine it knows how to
 * carry, and it refuses — on purpose — to swap any other remote reference. So the
 * person approving a change has to tell three situations apart from the bytes in
 * front of them: a library the product bundles, a library the application will
 * fetch from a remote host when it runs, and a remote host that verification
 * refuses, so the dependency never arrived during the check that passed.
 *
 * Those facts were already recorded server-side (`vendor_gaps`, `network_policy`,
 * the preview header) and no surface a person read showed any of them. This rail
 * shows them, measured from the exact bytes promotion would write. The sentences
 * are pinned in `dependency-view.ts`, and nothing here renders a verdict: whether
 * a remote dependency is acceptable is the reviewer's decision, not the
 * product's.
 */

const TONES: Record<DependencyView['rows'][number]['kind'], string> = {
  // Neutral on purpose: a bundled copy is neither good nor bad, it is a fact.
  bundled: 'bg-surface text-ink-dim',
  fetched: 'bg-warn/10 text-warn',
  blocked: 'bg-warn/15 text-warn',
};

function Row({ row }: { row: DependencyView['rows'][number] }) {
  return (
    <li
      className="rounded-md border border-line bg-surface px-2.5 py-2"
      data-dependency-kind={row.kind}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={`rounded px-1.5 py-0.5 uppercase tracking-wide ${TONES[row.kind]}`}
          data-dependency-status={row.kind}
        >
          {row.status}
        </span>
        <span className="font-mono text-[10px] text-ink-dim">{row.subject}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{row.explanation}</p>
      <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-muted">
        {row.source}
      </p>
    </li>
  );
}

export function DependencyDisclosure({ view }: { view: DependencyView }) {
  return (
    <section
      aria-label="Dependencies these bytes will use"
      data-testid="dependency-disclosure"
      className="rounded-lg border border-line bg-surface-2/60 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="layers" className="size-4 text-muted" /> Dependencies
        </h4>
        <span
          className="ml-auto rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-dim"
          data-testid="dependency-policy"
        >
          {view.policy === '' ? 'policy not recorded' : view.policy}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] font-medium text-ink-dim" data-testid="dependency-summary">
        {view.summary}
      </p>
      {view.rows.length > 0 ? (
        <ul className="mt-2 space-y-2" data-testid="dependency-rows">
          {view.rows.map((row, index) => (
            <Row key={`${row.kind}-${row.subject}-${String(index)}`} row={row} />
          ))}
        </ul>
      ) : null}
      {view.notes.length > 0 ? (
        <div className="mt-2 space-y-1.5" data-testid="dependency-notes">
          {view.notes.map((note) => (
            <p className="text-[10.5px] leading-relaxed text-muted" key={note}>
              {note}
            </p>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted" data-testid="dependency-scope">
        Counted from the bytes that would be promoted, not from what the model said it used.{' '}
        {STATUS_LABELS.fetched} means the host must answer when the artifact runs;{' '}
        {STATUS_LABELS.blocked} means the policy in force refuses that origin — and where the
        verification browser actually recorded a request for it being refused, the row says so in
        those words. The product swaps no dependency silently: a version it does not carry is left
        exactly as written and named here. A reading of the file is not a record of what ran; the
        notes state what this reading cannot see.
      </p>
    </section>
  );
}
