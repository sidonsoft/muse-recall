import type { ForgeJob, Memory } from '@mml/shared';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';

/**
 * Project memory, beside the prompt.
 *
 * A supplied memory is context, not proof of causation: the footer says so
 * explicitly and the "used" marker means the decision was included in the
 * prompt for this job, nothing stronger.
 */
export function StudioMemory({
  memories,
  loading,
  error,
  job,
  onOpenMemory,
  onOpenMemoryView,
}: {
  memories: Memory[] | null;
  loading: boolean;
  error: string | null;
  job: ForgeJob | null;
  onOpenMemory: (id: string) => void;
  onOpenMemoryView: () => void;
}) {
  const active = (memories ?? []).filter((memory) => memory.status === 'active');
  const superseded = (memories ?? []).filter((memory) => memory.status === 'superseded');
  const supplied = new Set(job?.memory_ids ?? []);
  const shown = [...active, ...superseded].slice(0, 4);

  return (
    <section aria-label="Project memory" className="panel flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="memory" className="size-3.5 text-accent" />
          Project memory
        </h2>
        <button
          type="button"
          onClick={onOpenMemoryView}
          className="text-[10.5px] text-muted underline-offset-2 hover:text-ink-dim hover:underline"
        >
          Open Memory
        </button>
      </div>

      <div className="max-h-[300px] min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading && memories === null ? (
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

        {!loading && !error && shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center">
            <p className="text-[11.5px] text-ink-dim">Recall has no decisions for this project.</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Approve a change with “Remember this decision” to start its memory.
            </p>
          </div>
        ) : null}

        <ul className="space-y-1.5">
          {shown.map((memory) => {
            const isSupplied = supplied.has(memory.id);
            return (
              <li key={memory.id}>
                <button
                  type="button"
                  onClick={() => onOpenMemory(memory.id)}
                  className="group block w-full rounded-lg border border-line bg-surface-2/40 px-2.5 py-2 text-left transition-colors hover:border-line-bright hover:bg-surface-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${
                        memory.status === 'active' ? 'text-ok' : 'text-muted'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          memory.status === 'active' ? 'bg-ok' : 'bg-muted'
                        }`}
                        aria-hidden="true"
                      />
                      {memory.status}
                    </span>
                    <span className="chip">{memory.type}</span>
                    {isSupplied ? (
                      <span
                        className="chip border-accent/30 bg-accent/5 text-accent"
                        title="Included in the prompt for this generation"
                      >
                        used
                      </span>
                    ) : null}
                    <span className="ml-auto text-[9.5px] text-muted">
                      {formatDateTime(memory.updated_at)}
                    </span>
                  </div>
                  <p
                    className={`mt-1 line-clamp-2 text-[11px] leading-relaxed ${
                      memory.status === 'superseded'
                        ? 'text-muted line-through decoration-line-bright/70'
                        : 'text-ink-dim'
                    }`}
                  >
                    {memory.content}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>

        {active.length + superseded.length > shown.length ? (
          <p className="mt-1.5 text-[10px] text-muted">
            +{active.length + superseded.length - shown.length} more in Memory
          </p>
        ) : null}
      </div>

      <div className="border-t border-line px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted">
          <span className="text-ink-dim">
            {job && job.memory_ids.length > 0
              ? `Recall supplied ${job.memory_ids.length} decision${job.memory_ids.length === 1 ? '' : 's'} to this generation.`
              : `${active.length} active decision${active.length === 1 ? '' : 's'} available to Recall.`}
          </span>{' '}
          Retrieved context, not proof that it changed a model decision.
        </p>
        {memories && memories.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const target = shown[0]?.id ?? memories[0]?.id;
              if (target) onOpenMemory(target);
            }}
            className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-accent hover:text-ink"
          >
            Open memory <Icon name="arrowRight" className="size-3" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
