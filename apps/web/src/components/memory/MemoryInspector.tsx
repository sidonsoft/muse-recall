import {
  MEMORY_TYPES,
  type Memory,
  type MemoryDetail,
  type MemoryStats,
  type MemoryType,
  type Project,
  type ServiceMeta,
  type ValidationStatus,
} from '@mml/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import { StatusPill, type Tone } from '../ui.tsx';
import {
  type CorrectionSubmission,
  type EditSubmission,
  MemoryDetailPanel,
} from './MemoryDetailPanel.tsx';
import { RetrievalExplainer } from './RetrievalExplainer.tsx';

const STATUS_OPTIONS = [
  { value: 'visible', label: 'All visible' },
  { value: 'active', label: 'Active only' },
  { value: 'proposed', label: 'Proposals' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'expired', label: 'Expired' },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

const STATUS_TONE: Record<Memory['status'], Tone> = {
  proposed: 'accent',
  active: 'ok',
  superseded: 'accent',
  expired: 'warn',
  deleted: 'err',
};

const VALIDATION_TONE: Record<ValidationStatus, Tone> = {
  verified: 'ok',
  unverified: 'warn',
  disputed: 'err',
};

type Notice = { tone: 'ok' | 'err'; text: string } | null;

function describeError(cause: unknown): string {
  return cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause);
}

/**
 * Memory Inspector.
 *
 * Search and filter the stored memories, inspect provenance and history, make
 * corrections that supersede, delete, and ask the retrieval engine to explain
 * itself. Everything here reads and writes through the real API — there is no
 * client-side shadow copy of the memory state.
 */
export function MemoryInspector({
  meta,
  focus = null,
  onFocusHandled,
}: {
  meta: ServiceMeta | null;
  focus?: { id: string; projectId: string } | null;
  onFocusHandled?: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [items, setItems] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('visible');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [panel, setPanel] = useState<'detail' | 'retrieval'>('detail');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [creating, setCreating] = useState(false);

  const flash = useCallback((tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = status === 'visible' ? 'active,superseded,expired' : status;
      const response = await api.listMemories({
        ...(project === 'all'
          ? { all_projects: true }
          : { project_id: project, include_global: true }),
        status: statusParam,
        ...(type ? { type } : {}),
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        limit: 100,
      });
      setItems(response.items);
      setTotal(response.total);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [project, status, type, debouncedSearch]);

  const loadSideData = useCallback(async () => {
    try {
      const [nextProjects, nextStats] = await Promise.all([api.projects(), api.memoryStats()]);
      setProjects(nextProjects);
      setStats(nextStats);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadSideData();
  }, [loadSideData]);

  // Deep link from HTML Studio: select the decision that was just inspected.
  useEffect(() => {
    if (!focus) return;
    setProject(focus.projectId);
    setPanel('detail');
    setSelectedId(focus.id);
    onFocusHandled?.();
  }, [focus, onFocusHandled]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api
      .memory(selectedId)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setDetail(null);
          setError(describeError(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refresh = useCallback(async () => {
    await Promise.all([loadList(), loadSideData()]);
  }, [loadList, loadSideData]);

  const activeProject = project === 'all' ? (projects[0]?.id ?? '') : project;

  async function handleCorrect(submission: CorrectionSubmission) {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.correctMemory(detail.memory.id, {
        type: submission.type,
        scope: detail.memory.scope,
        project_id: detail.memory.project_id,
        content: submission.content,
        confidence: submission.confidence,
        validation_status: submission.validation_status,
        reason: submission.reason.trim() || undefined,
      });
      await refresh();
      setSelectedId(result.memory.id);
      flash(
        'ok',
        result.created
          ? `Correction stored. ${result.superseded.length} earlier record(s) superseded.`
          : 'That correction already existed; the current record was kept.',
      );
    } catch (cause) {
      flash('err', describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(submission: EditSubmission) {
    if (!detail) return;
    setBusy(true);
    try {
      await api.updateMemory(detail.memory.id, {
        content: submission.content,
        confidence: submission.confidence,
        validation_status: submission.validation_status,
      });
      await refresh();
      setDetail(await api.memory(detail.memory.id));
      flash('ok', 'Memory updated; the change is recorded in its history.');
    } catch (cause) {
      flash('err', describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(reason: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteMemory(detail.memory.id, reason.trim() || undefined);
      setSelectedId(null);
      setDetail(null);
      await refresh();
      flash('ok', 'Memory deleted and removed from the retrieval index.');
    } catch (cause) {
      flash('err', describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const projectOptions = useMemo(
    () => projects.map((entry) => entry.id).sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  // Active decisions are what Recall can supply; candidates needing a user
  // decision follow immediately, then superseded history.
  const orderedItems = useMemo(() => {
    const rank: Record<Memory['status'], number> = {
      active: 0,
      proposed: 1,
      superseded: 2,
      expired: 3,
      deleted: 4,
    };
    return [...items].sort(
      (a, b) => rank[a.status] - rank[b.status] || b.updated_at.localeCompare(a.updated_at),
    );
  }, [items]);

  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || selectedId || orderedItems.length === 0) return;
    autoSelected.current = true;
    const first = orderedItems.find((memory) => memory.status === 'active') ?? orderedItems[0];
    if (first) setSelectedId(first.id);
  }, [orderedItems, selectedId]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* ---------------- List column ---------------- */}
      <div className="min-w-0 space-y-3">
        <div className="panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search memories…"
                aria-label="Search memories"
                maxLength={500}
                className="w-full rounded-lg border border-line bg-base/70 py-1.5 pl-8 pr-2.5 text-[12px] text-ink placeholder:text-muted focus:border-line-bright focus:outline-none"
              />
            </div>

            <select
              value={project}
              onChange={(event) => setProject(event.target.value)}
              aria-label="Filter by project"
              className="rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[11px] text-ink focus:outline-none"
            >
              <option value="all">All projects</option>
              {projectOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[11px] text-ink focus:outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              aria-label="Filter by type"
              className="rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[11px] text-ink focus:outline-none"
            >
              <option value="">All types</option>
              {MEMORY_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setCreating((current) => !current)}
              title="Add a memory"
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-accent-dim disabled:opacity-40"
            >
              <Icon name={creating ? 'close' : 'plus'} className="size-3.5" />
              {creating ? 'Cancel' : 'New'}
            </button>
          </div>

          {stats ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10px] text-muted">
              <span>
                <span className="font-mono text-ink-dim">{total}</span> shown
              </span>
              <span>
                <span className="font-mono text-ok">{stats.active}</span> active
              </span>
              <span>
                <span className="font-mono text-accent">{stats.superseded}</span> superseded
              </span>
              <span>
                <span className="font-mono text-warn">{stats.expired}</span> expired
              </span>
              <span>
                <span className="font-mono text-muted">{stats.deleted}</span> deleted
              </span>
            </div>
          ) : null}
        </div>

        {creating ? (
          <CreateMemoryForm
            initialProjectId={activeProject}
            onCancel={() => setCreating(false)}
            onCreated={async (created) => {
              setCreating(false);
              await refresh();
              setSelectedId(created.id);
              flash('ok', 'Memory stored with provenance and scope.');
            }}
            onError={(message) => flash('err', message)}
          />
        ) : null}

        {notice ? (
          <p
            className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
              notice.tone === 'ok'
                ? 'border-ok/30 bg-ok/5 text-ok'
                : 'border-err/30 bg-err/5 text-err'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-err/30 bg-err/5 px-3 py-2 font-mono text-[11px] text-err">
            {error}
          </p>
        ) : null}

        <div className="space-y-2">
          {loading && items.length === 0 ? (
            <p className="text-xs text-muted">Loading memories…</p>
          ) : null}

          {!loading && orderedItems.length === 0 ? (
            <div className="panel p-6 text-center">
              <p className="text-xs font-medium text-ink">No memories match this view</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted">
                Memory is written by the agent and the API, not dumped from conversations. Use{' '}
                <span className="font-mono">New</span> to store one, or clear the filters.
              </p>
            </div>
          ) : null}

          {orderedItems.map((memory) => {
            const selected = memory.id === selectedId;
            return (
              <button
                key={memory.id}
                type="button"
                onClick={() => {
                  setPanel('detail');
                  setSelectedId(memory.id);
                }}
                className={`block w-full rounded-xl border p-3 text-left transition ${
                  selected
                    ? 'border-accent/40 bg-surface-2 ring-1 ring-accent/30'
                    : 'border-line bg-surface hover:border-line-bright'
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone={STATUS_TONE[memory.status]}>{memory.status}</StatusPill>
                  <StatusPill tone={VALIDATION_TONE[memory.validation_status]}>
                    {memory.validation_status}
                  </StatusPill>
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {memory.type}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted">
                    {memory.scope === 'global' ? 'global' : memory.project_id}
                  </span>
                </div>

                <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink-dim">
                  {memory.content}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                  <span>conf {memory.confidence.toFixed(2)}</span>
                  <span>·</span>
                  <span>{formatDateTime(memory.updated_at)}</span>
                  {memory.tags.length > 0 ? (
                    <>
                      <span>·</span>
                      <span className="truncate">
                        {memory.tags.map((tag) => `#${tag}`).join(' ')}
                      </span>
                    </>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {orderedItems.length > 0 ? (
          <p className="px-1 text-[10.5px] leading-relaxed text-muted">
            Recall supplies active decisions to Muse Spark during HTML Studio generations. Retrieval
            is context, not proof that a specific decision changed model output.
          </p>
        ) : null}

        <section className="panel p-4" aria-label="How Recall uses memory">
          <p className="eyebrow">How Recall uses memory</p>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[11.5px] font-medium text-ink-dim">Project-scoped</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                Decisions belong to a project, not to a chat transcript. A new conversation keeps
                the same memory.
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-ink-dim">Correctable</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                A correction supersedes the old decision and keeps its history, so the reason stays
                auditable.
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-ink-dim">Bounded</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                Recall supplies a configured budget, not the whole archive. The job row shows how
                many decisions were used.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- Right panel ---------------- */}
      <aside className="min-w-0 space-y-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          <TabButton active={panel === 'detail'} onClick={() => setPanel('detail')}>
            Detail
          </TabButton>
          <TabButton active={panel === 'retrieval'} onClick={() => setPanel('retrieval')}>
            Retrieval explanation
          </TabButton>
        </div>

        {panel === 'detail' ? (
          detailLoading && !detail ? (
            <div className="panel p-4 text-xs text-muted">Loading detail…</div>
          ) : detail ? (
            <MemoryDetailPanel
              key={detail.memory.id}
              detail={detail}
              busy={busy}
              onCorrect={(submission) => void handleCorrect(submission)}
              onEdit={(submission) => void handleEdit(submission)}
              onDelete={(reason) => void handleDelete(reason)}
              onSelect={setSelectedId}
            />
          ) : (
            <div className="panel p-5 text-center">
              <div className="mx-auto flex size-9 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-line">
                <Icon name="memory" className="size-4" />
              </div>
              <p className="mt-2 text-xs font-medium text-ink">Select a memory</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Provenance, supersession chain, and the full history appear here.
              </p>
            </div>
          )
        ) : (
          <section className="panel p-3" aria-label="Retrieval explanation">
            <RetrievalExplainer
              projects={projects}
              defaultProject={project === 'all' ? (projects[0]?.id ?? null) : project}
              meta={meta?.memory.default_budget ?? null}
            />
          </section>
        )}
      </aside>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active ? 'bg-surface-2 text-ink ring-1 ring-line' : 'text-muted hover:text-ink-dim'
      }`}
    >
      {children}
    </button>
  );
}

function CreateMemoryForm({
  initialProjectId,
  onCancel,
  onCreated,
  onError,
}: {
  initialProjectId: string;
  onCancel: () => void;
  onCreated: (memory: Memory) => void;
  onError: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId || 'demo-game');
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('technical_decision');
  const [confidence, setConfidence] = useState(0.8);
  const [validation, setValidation] = useState<ValidationStatus>('unverified');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="panel space-y-2.5 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || content.trim().length === 0) return;
        setBusy(true);
        try {
          const result = await api.createMemory({
            type,
            scope: 'project',
            project_id: projectId.trim(),
            content: content.trim(),
            confidence,
            validation_status: validation,
            source: { session_id: null, reference: 'inspector' },
          });
          onCreated(result.memory);
        } catch (cause) {
          onError(describeError(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          New memory
        </h3>
        <input
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-label="Project id"
          maxLength={128}
          placeholder="project id"
          className="w-32 rounded-md border border-line bg-base/70 px-2 py-1 text-right font-mono text-[10px] text-ink-dim focus:outline-none"
        />
      </div>

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        maxLength={8_000}
        placeholder="What should be remembered?"
        aria-label="Memory content"
        className="w-full resize-none rounded-lg border border-line bg-base/70 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-muted focus:outline-none"
      />

      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(event) => setType(event.target.value as MemoryType)}
          aria-label="Memory type"
          className="rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[11px] text-ink focus:outline-none"
        >
          {MEMORY_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={validation}
          onChange={(event) => setValidation(event.target.value as ValidationStatus)}
          aria-label="Validation status"
          className="rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[11px] text-ink focus:outline-none"
        >
          {(['unverified', 'verified', 'disputed'] as const).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted">conf {confidence.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value))}
          aria-label="Confidence"
          className="flex-1 accent-[var(--color-accent)]"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || content.trim().length === 0}
          className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dim disabled:opacity-50"
        >
          {busy ? 'Storing…' : 'Store memory'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-dim transition hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
