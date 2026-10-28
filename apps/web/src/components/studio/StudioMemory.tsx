import type { ForgeJob, Memory, MemoryType } from '@mml/shared';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';

/**
 * Project memory, beside the prompt.
 *
 * A supplied memory is context, not proof of causation: the footer says so
 * explicitly and the "used" marker means the decision was included in the
 * prompt for this job, nothing stronger.
 *
 * Creation is explicit: the form is the same validated memory API used by the
 * inspector, scoped to this Studio project. Suggestions and model summaries
 * are never written automatically.
 */
export function StudioMemory({
  projectId,
  memories,
  loading,
  error,
  job,
  onCreated,
  onOpenMemory,
  onOpenMemoryView,
}: {
  projectId: string;
  memories: Memory[] | null;
  loading: boolean;
  error: string | null;
  job: ForgeJob | null;
  onCreated: () => Promise<void> | void;
  onOpenMemory: (id: string) => void;
  onOpenMemoryView: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('technical_decision');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const active = (memories ?? []).filter((memory) => memory.status === 'active');
  const superseded = (memories ?? []).filter((memory) => memory.status === 'superseded');
  const supplied = new Set(job?.memory_ids ?? []);
  const shown = [...active, ...superseded].slice(0, 4);

  function messageOf(cause: unknown): string {
    if (cause instanceof ApiError) return cause.message;
    if (cause instanceof Error) return cause.message;
    return String(cause);
  }

  function openForm(): void {
    setAdding(true);
    setCreateError(null);
    setSaveNotice(null);
  }

  async function createDecision(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = content.trim();
    if (busy || text.length === 0) return;
    setBusy(true);
    setCreateError(null);
    setSaveNotice(null);
    try {
      const result = await api.createMemory({
        type,
        scope: 'project',
        project_id: projectId,
        content: text,
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: 'studio:project-memory' },
      });
      setContent('');
      setAdding(false);
      setSaveNotice(
        result.created
          ? 'Decision saved to this project.'
          : 'That decision already exists in this project.',
      );
      await onCreated();
    } catch (cause) {
      setCreateError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Project memory" className="panel flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="memory" className="size-3.5 text-accent" />
          Project memory
        </h2>
        <div className="flex items-center gap-2">
          {!adding ? (
            <button
              type="button"
              onClick={openForm}
              className="text-[10.5px] text-accent underline-offset-2 hover:text-ink hover:underline"
            >
              Add decision
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenMemoryView}
            className="text-[10.5px] text-muted underline-offset-2 hover:text-ink-dim hover:underline"
          >
            Open Memory
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {adding ? (
          <form
            onSubmit={(event) => void createDecision(event)}
            aria-label="Add project decision form"
            className="mb-2 rounded-lg border border-accent/30 bg-accent/5 p-2.5"
          >
            <label htmlFor="studio-memory-content" className="eyebrow block">
              Project decision
            </label>
            <textarea
              id="studio-memory-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={3}
              maxLength={1_000}
              placeholder="A decision or constraint Recall should apply, e.g. Never use countdown timers."
              aria-label="Project decision"
              className="field mt-1 resize-y text-[11px]"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <label htmlFor="studio-memory-type" className="text-[10px] text-muted">
                Type
              </label>
              <select
                id="studio-memory-type"
                value={type}
                onChange={(event) => setType(event.target.value as MemoryType)}
                aria-label="Decision type"
                className="rounded border border-line bg-base/70 px-1.5 py-1 text-[10px] text-ink-dim"
              >
                <option value="technical_decision">Decision</option>
                <option value="constraint">Constraint</option>
                <option value="preference">Preference</option>
              </select>
            </div>
            {createError ? (
              <p className="mt-1.5 text-[10px] leading-relaxed text-err" role="alert">
                {createError}
              </p>
            ) : null}
            <div className="mt-2 flex gap-1.5">
              <button
                type="submit"
                disabled={busy || content.trim().length === 0}
                className="btn btn-sm flex-1"
              >
                {busy ? 'Saving…' : 'Save decision'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setCreateError(null);
                }}
                disabled={busy}
                className="btn btn-sm btn-quiet"
              >
                Cancel
              </button>
            </div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
              Saved with the existing memory validation path and scoped to this project.
            </p>
          </form>
        ) : null}

        {saveNotice ? (
          <p
            className="mb-2 rounded-md border border-ok/30 bg-ok/5 px-2 py-1.5 text-[10px] text-ok"
            role="status"
          >
            {saveNotice}
          </p>
        ) : null}

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

        {!loading && !error && shown.length === 0 && !adding ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center">
            <p className="text-[11.5px] text-ink-dim">No project decisions yet.</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Add a constraint or decision so Recall and Decision Guard have project context.
            </p>
            <button type="button" onClick={openForm} className="btn btn-sm mt-2">
              Add project decision
            </button>
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
