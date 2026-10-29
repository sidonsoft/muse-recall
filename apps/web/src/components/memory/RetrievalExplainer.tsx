import {
  DEFAULT_RETRIEVAL_BUDGET,
  FORGE_RETRIEVAL_BUDGET,
  type Project,
  type RetrievalMode,
  type RetrievalPreview,
} from '@mml/shared';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { formatLatency } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import { DataRow, StatusPill } from '../ui.tsx';

/**
 * Retrieval explanation panel.
 *
 * Runs the real retrieval path and shows what would be injected into a prompt:
 * the ranked memories, each component score, the evidence sentence, and the
 * budget outcome. This is the answer to "why did the agent know that?".
 */
export function RetrievalExplainer({
  projects,
  defaultProject,
  meta,
}: {
  projects: Project[];
  defaultProject: string | null;
  meta: { max_memories: number; max_characters: number; max_memory_characters: number } | null;
}) {
  const [projectId, setProjectId] = useState<string>(defaultProject ?? '');
  const [query, setQuery] = useState('storage decision');
  const [mode, setMode] = useState<RetrievalMode>('forge');
  const [maxMemories, setMaxMemories] = useState(FORGE_RETRIEVAL_BUDGET.max_memories);
  const [maxCharacters, setMaxCharacters] = useState(FORGE_RETRIEVAL_BUDGET.max_characters);
  const [result, setResult] = useState<RetrievalPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);

  function selectMode(next: RetrievalMode): void {
    setMode(next);
    const defaults = next === 'forge' ? FORGE_RETRIEVAL_BUDGET : (meta ?? DEFAULT_RETRIEVAL_BUDGET);
    setMaxMemories(defaults.max_memories);
    setMaxCharacters(defaults.max_characters);
    setResult(null);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    try {
      setResult(
        await api.retrievalPreview({
          project_id: projectId || null,
          query,
          mode,
          budget: { max_memories: maxMemories, max_characters: maxCharacters },
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={run} className="space-y-2">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={500}
              placeholder="What would the agent ask?"
              aria-label="Retrieval query"
              className="w-full rounded-lg border border-line bg-base/70 py-1.5 pl-8 pr-2.5 text-[12px] text-ink placeholder:text-muted focus:border-line-bright focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dim disabled:opacity-50"
          >
            {loading ? 'Running…' : 'Explain'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="block text-[10px] text-muted">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full rounded-md border border-line bg-base/70 px-1.5 py-1 text-[11px] text-ink focus:outline-none"
            >
              <option value="">global only</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.id}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] text-muted">Mode</span>
            <select
              value={mode}
              onChange={(event) => selectMode(event.target.value as RetrievalMode)}
              aria-label="Retrieval mode"
              className="w-full rounded-md border border-line bg-base/70 px-1.5 py-1 text-[11px] text-ink focus:outline-none"
            >
              <option value="forge">Forge (Studio)</option>
              <option value="default">Default</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] text-muted">Max memories</span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxMemories}
              onChange={(event) => setMaxMemories(Number(event.target.value))}
              className="w-full rounded-md border border-line bg-base/70 px-1.5 py-1 text-[11px] text-ink focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] text-muted">Max chars</span>
            <input
              type="number"
              min={200}
              max={50_000}
              step={100}
              value={maxCharacters}
              onChange={(event) => setMaxCharacters(Number(event.target.value))}
              className="w-full rounded-md border border-line bg-base/70 px-1.5 py-1 text-[11px] text-ink focus:outline-none"
            />
          </label>
        </div>
        <p className="text-[10px] leading-relaxed text-muted">
          {mode === 'forge'
            ? 'Forge mode starts from the same pinned decision types and count/character budget as HTML Studio generation; edits above override it for this preview.'
            : 'Default mode uses the installation retrieval budget and pins only constraints and goals.'}
        </p>
      </form>

      {error ? <p className="font-mono text-[11px] leading-relaxed text-err">{error}</p> : null}

      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4">
            <dl className="divide-y divide-line/70">
              <DataRow
                label="candidates"
                value={String(result.retrieval.metadata.candidate_count)}
              />
              <DataRow label="selected" value={String(result.retrieval.metadata.selected_count)} />
              <DataRow label="excluded" value={String(result.retrieval.metadata.excluded_count)} />
            </dl>
            <dl className="divide-y divide-line/70">
              <DataRow
                label="rendered chars"
                value={`${result.retrieval.metadata.characters_used} / ${result.retrieval.metadata.character_budget}`}
                mono
              />
              <DataRow
                label="truncated"
                value={String(result.retrieval.metadata.truncated_count)}
              />
              <DataRow
                label="latency"
                value={formatLatency(result.retrieval.metadata.latency_ms)}
              />
            </dl>
          </div>

          {result.retrieval.results.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[11px] text-muted">
              Nothing would be injected for this query in this scope.
            </p>
          ) : (
            <ol className="space-y-2">
              {result.retrieval.results.map((entry, index) => (
                <li
                  key={entry.memory.id}
                  className="rounded-lg border border-line bg-surface-2/40 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted">#{index + 1}</span>
                      <span className="truncate font-mono text-[10px] text-ink-dim">
                        {entry.memory.type}
                      </span>
                      {entry.pinned ? <StatusPill tone="accent">pinned</StatusPill> : null}
                      {entry.truncated ? <StatusPill tone="warn">truncated</StatusPill> : null}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-accent">
                      {entry.score.toFixed(3)}
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-ink-dim">
                    {entry.injected_content}
                  </p>

                  <p className="mt-1.5 text-[10px] leading-relaxed text-muted">{entry.evidence}</p>

                  <div className="mt-2 space-y-1">
                    {Object.entries(entry.rank_components).map(([component, value]) => (
                      <div key={component} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-[9px] uppercase tracking-wide text-muted">
                          {component.replace('_', ' ')}
                        </span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                          <span
                            className="block h-full rounded-full bg-accent/70"
                            style={{ width: `${Math.round(value * 100)}%` }}
                          />
                        </span>
                        <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">
                          {value.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {result.context ? (
            <div>
              <button
                type="button"
                onClick={() => setShowContext((current) => !current)}
                className="flex w-full items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-dim transition hover:border-line-bright"
              >
                <span>
                  Prompt block · {result.context.characters} chars ≈{' '}
                  {result.context.estimated_tokens} tokens (estimated)
                </span>
                <Icon
                  name="chevronDown"
                  className={`size-3.5 transition ${showContext ? 'rotate-180' : ''}`}
                />
              </button>
              {showContext ? (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-base/70 p-2.5 font-mono text-[10px] leading-relaxed text-ink-dim">
                  {result.context.text}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted">
          Runs the real retrieval path — same scoring, budgets and evidence the agent will use — and
          shows exactly what would be injected. No model is called.
        </p>
      )}
    </div>
  );
}
