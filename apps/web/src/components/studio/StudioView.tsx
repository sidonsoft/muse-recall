import type {
  ForgeArtifact,
  ForgeDiff,
  ForgeJob,
  ForgeProjectView,
  Memory,
  Project,
  ServiceMeta,
} from '@mml/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { humanizeId } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import { ProjectSwitcher } from './ProjectSwitcher.tsx';
import { jobLabel, type PromptMode, PromptPanel } from './PromptPanel.tsx';
import { ArtifactFooter, ReviewPanel } from './ReviewPanel.tsx';
import { DiffPanel, PanelEmpty, SourcePanel } from './SourceAndDiff.tsx';
import { StudioActivity } from './StudioActivity.tsx';
import { StudioMemory } from './StudioMemory.tsx';

const DEMO_PROJECT_ID = 'forge-demo';
const PROJECT_KEY = 'muse-recall.project';
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'];

const DEFAULT_PROMPT =
  'A colourful farmyard memory-matching game for children aged 4-7. Twelve cards (six pairs), large touch targets, score and moves, restart, a win overlay, and a responsive layout.';

const DEFAULT_CHANGE = 'Make the animal cards larger and keep the ocean palette.';

type StudioTab = 'preview' | 'source' | 'diff';
type Action = 'open' | 'generate' | 'modify' | 'approve' | 'reject' | 'rollback' | null;
type Notice = { tone: 'ok' | 'warn' | 'err'; text: string } | null;

function messageOf(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * HTML Studio.
 *
 * The center is the artifact: a sandboxed preview, its source, or the staged
 * diff. Development asks Muse Spark for work; Review decides whether that work
 * becomes current. Approval, rejection, and rollback all go through the
 * existing Forge API — this view adds presentation and navigation, not a
 * second generation pipeline.
 */
export function StudioView({
  meta,
  onOpenMemory,
  onOpenMemoryView,
}: {
  meta: ServiceMeta | null;
  onOpenMemory: (memoryId: string, projectId: string) => void;
  onOpenMemoryView: () => void;
}) {
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? DEMO_PROJECT_ID;
    } catch {
      return DEMO_PROJECT_ID;
    }
  });
  const [project, setProject] = useState<ForgeProjectView | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(true);

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [change, setChange] = useState(DEFAULT_CHANGE);
  const [promptMode, setPromptMode] = useState<PromptMode>('change');
  const [job, setJob] = useState<ForgeJob | null>(null);
  const [diff, setDiff] = useState<ForgeDiff | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ForgeArtifact | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const [tab, setTab] = useState<StudioTab>('preview');
  const [previewMode, setPreviewMode] = useState<'approved' | 'staged'>('approved');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const [captureMemory, setCaptureMemory] = useState(false);
  const [decision, setDecision] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const artifactRequest = useRef(0);

  const message = useCallback((tone: 'ok' | 'warn' | 'err', text: string) => {
    setNotice({ tone, text });
  }, []);

  const loadArtifact = useCallback(async (id: string, jobId?: string) => {
    const request = ++artifactRequest.current;
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      const next = await api.forgeArtifact(id, jobId);
      if (request !== artifactRequest.current) return;
      setArtifact(next);
      setArtifactError(null);
    } catch (cause) {
      if (request !== artifactRequest.current) return;
      setArtifact(null);
      const description = messageOf(cause);
      setArtifactError(description);
    } finally {
      if (request === artifactRequest.current) setArtifactLoading(false);
    }
  }, []);

  const loadMemories = useCallback(async (id: string) => {
    setMemoriesLoading(true);
    setMemoryError(null);
    try {
      const response = await api.listMemories({
        project_id: id,
        include_global: true,
        status: 'active,superseded',
        limit: 50,
      });
      setMemories(response.items);
    } catch (cause) {
      setMemoryError(messageOf(cause));
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  const loadProject = useCallback(
    async (id: string, restoreStaged: boolean) => {
      setLoadingProject(true);
      try {
        const next = await api.forgeState(id);
        setProject(next);
        setError(null);
        if (next.state.current_version !== null) {
          void loadArtifact(id);
        } else {
          setArtifact(null);
        }

        if (restoreStaged) {
          const pending = next.jobs.find(
            (entry) =>
              entry.status === 'succeeded' &&
              entry.version === null &&
              entry.base_version === next.state.current_version,
          );
          if (pending) {
            try {
              const staged = await api.forgeDiff(pending.id);
              setActiveJobId(pending.id);
              setDiff(staged);
              setJob(pending);
              setPreviewMode('staged');
              setTab('preview');
              void loadArtifact(id, pending.id);
              message('warn', 'A staged change is waiting for review.');
            } catch {
              // The staging file may already be gone; the approved version is still valid.
            }
          }
        }
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setLoadingProject(false);
      }
    },
    [loadArtifact, message],
  );

  // Initial load, and any deliberate project switch.
  useEffect(() => {
    // Clear the previous project's artifact before fetching the next one. Without
    // this, a switch briefly renders the old title/preview against the new id and
    // requests a preview that does not exist yet.
    setProject(null);
    setMemories(null);
    setJob(null);
    setDiff(null);
    setActiveJobId(null);
    setArtifact(null);
    setArtifactError(null);
    setScreenshot(null);
    setPreviewMode('approved');
    setTab('preview');
    setPreviewError(null);
    setPreviewReady(false);
    setNotice(null);
    setError(null);
    setCaptureMemory(false);
    setDecision('');
    void loadProject(projectId, true);
    void loadMemories(projectId);
    void api
      .projects()
      .then(setProjects)
      .catch(() => undefined);
  }, [projectId, loadProject, loadMemories]);

  useEffect(() => {
    if (!notice || notice.tone === 'err') return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // The sandbox gives the preview an opaque origin, so identity — not
      // `event.origin` — is what proves the message came from our iframe.
      if (!event.source || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        dataUrl?: string | null;
        error?: string;
        message?: string;
      } | null;
      if (data?.type === 'forge:preview-error') {
        setPreviewError(data.message ?? 'The application threw an error at runtime.');
        return;
      }
      if (data?.type !== 'forge:screenshot') return;
      if (data.dataUrl) {
        setScreenshot(data.dataUrl);
        setNotice({ tone: 'ok', text: 'Preview captured. Describe the change you want.' });
        setError(null);
      } else {
        setError(data.error ?? 'The preview has no canvas to capture.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const previewKey = `${previewMode}-${activeJobId ?? project?.state.current_version ?? 'none'}-${device}-${reload}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the rendered document changes
  useEffect(() => {
    setPreviewReady(false);
    setPreviewError(null);
  }, [previewKey]);

  async function waitForFinish(id: string): Promise<ForgeJob> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const current = await api.forgeJob(id);
      setJob(current);
      if (TERMINAL.includes(current.status)) return current;
      await delay(1200);
    }
    throw new Error('The job did not finish in time.');
  }

  async function openProject(id: string) {
    setAction('open');
    setError(null);
    try {
      await api.forgeProject(id, id);
      try {
        localStorage.setItem(PROJECT_KEY, id);
      } catch {
        // Private browsing; the session still works.
      }
      setProjectId(id);
      const list = await api.projects().catch(() => null);
      if (list) setProjects(list);
      if (id === projectId) {
        void loadProject(id, true);
        void loadMemories(id);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
    }
  }

  async function generate() {
    setAction('generate');
    setError(null);
    setNotice(null);
    setDiff(null);
    setActiveJobId(null);
    setScreenshot(null);
    setPreviewMode('approved');
    setTab('preview');
    try {
      const created = await api.forgeGenerate(projectId, prompt);
      setJob(created);
      const finished = await waitForFinish(created.id);
      if (finished.status === 'succeeded') {
        const staged = await api.forgeDiff(finished.id);
        setJob(finished);
        setDiff(staged);
        setActiveJobId(finished.id);
        setPreviewMode('staged');
        setTab('diff');
        void loadArtifact(projectId, finished.id);
        message(
          'warn',
          'Muse Spark staged an HTML version. Review the change, then approve or reject.',
        );
      } else {
        setError(finished.error ?? `Generation ${finished.status.replace('_', ' ')}.`);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
      await api
        .forgeState(projectId)
        .then(setProject)
        .catch(() => undefined);
    }
  }

  async function modify() {
    setAction('modify');
    setError(null);
    setNotice(null);
    setDiff(null);
    setActiveJobId(null);
    setPreviewMode('approved');
    setTab('preview');
    try {
      const created = await api.forgeModify(projectId, change, screenshot);
      setJob(created);
      const finished = await waitForFinish(created.id);
      if (finished.status === 'succeeded') {
        const staged = await api.forgeDiff(finished.id);
        setJob(finished);
        setDiff(staged);
        setActiveJobId(finished.id);
        setPreviewMode('staged');
        setTab('preview');
        void loadArtifact(projectId, finished.id);
        message('warn', 'Change staged. Review the diff, then approve or reject it.');
      } else {
        setError(finished.error ?? `Change ${finished.status.replace('_', ' ')}.`);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
      await api
        .forgeState(projectId)
        .then(setProject)
        .catch(() => undefined);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      const cancelled = await api.forgeCancel(job.id);
      setJob(cancelled);
      message('warn', 'Cancellation requested. Nothing will be published.');
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function approve() {
    if (!diff) return;
    setAction('approve');
    setError(null);
    try {
      const result = await api.forgeApprove(
        diff.job_id,
        captureMemory,
        decision.trim() || undefined,
      );
      setProject((current) => (current ? { state: result.state, jobs: current.jobs } : current));
      setDiff(null);
      setActiveJobId(null);
      setJob(null);
      setScreenshot(null);
      setCaptureMemory(false);
      setDecision('');
      setTab('preview');
      setPreviewMode('approved');
      setReload((value) => value + 1);
      void loadArtifact(projectId);
      void loadMemories(projectId);
      message(
        'ok',
        `Approved v${result.state.current_version ?? ''}. The previous version stays in history.`,
      );
      await api
        .forgeState(projectId)
        .then(setProject)
        .catch(() => undefined);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
    }
  }

  async function reject() {
    if (!diff) return;
    setAction('reject');
    setError(null);
    try {
      await api.forgeReject(diff.job_id);
      setDiff(null);
      setActiveJobId(null);
      setJob(null);
      setScreenshot(null);
      setPreviewMode('approved');
      setTab('preview');
      setReload((value) => value + 1);
      message('ok', 'Change rejected. The approved application is untouched.');
      await api
        .forgeState(projectId)
        .then(setProject)
        .catch(() => undefined);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
    }
  }

  async function rollback() {
    setAction('rollback');
    setError(null);
    try {
      const next = await api.forgeRollback(projectId);
      setDiff(null);
      setActiveJobId(null);
      setJob(null);
      setPreviewMode('approved');
      setReload((value) => value + 1);
      void loadArtifact(projectId);
      message('ok', `Restored v${next.current_version ?? ''} as the current version.`);
      await api
        .forgeState(projectId)
        .then(setProject)
        .catch(() => undefined);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAction(null);
    }
  }

  function capture() {
    iframeRef.current?.contentWindow?.postMessage({ type: 'forge:capture' }, '*');
  }

  function restartGame() {
    iframeRef.current?.contentWindow?.postMessage({ type: 'forge:restart' }, '*');
  }

  async function download() {
    const wantedJob = previewMode === 'staged' ? activeJobId : null;
    let source = artifact;
    try {
      if (!source || (wantedJob ? source.job_id !== wantedJob : source.job_id !== null)) {
        source = await api.forgeArtifact(projectId, wantedJob ?? undefined);
      }
    } catch (cause) {
      setError(messageOf(cause));
      return;
    }
    const name = `${slugify(source.title || projectId) || 'muse-recall'}-${
      source.staged ? `staged-${source.job_id?.slice(0, 8) ?? 'review'}` : `v${source.version ?? 1}`
    }.html`;
    const blob = new Blob([source.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    message(
      'ok',
      `Downloaded ${name}. It is a standalone HTML file; any external CDN scripts still need network access.`,
    );
  }

  function switchPreview(mode: 'approved' | 'staged') {
    if (mode === 'staged' && !activeJobId) return;
    setPreviewMode(mode);
    const wanted = mode === 'staged' ? (activeJobId ?? undefined) : undefined;
    if (!artifact || (wanted ? artifact.job_id !== wanted : artifact.job_id !== null)) {
      void loadArtifact(projectId, wanted);
    }
  }

  const state = project?.state ?? null;
  const hasGame = (state?.current_version ?? null) !== null;
  const running = job?.status === 'running' || job?.status === 'queued';
  const busy = action !== null;
  const stagedVersion =
    diff && state ? Math.max(0, ...state.versions.map((entry) => entry.version)) + 1 : null;
  const previewJobId = previewMode === 'staged' ? activeJobId : null;
  const previewSrc = api.forgePreviewUrl(projectId, previewJobId ?? undefined);
  const title = artifact?.title ?? humanizeId(projectId);
  const offline = meta?.provider.id !== 'muse-cli';
  const model = meta?.provider.configured_model ?? null;
  const canCapture = (hasGame || previewJobId !== null) && previewReady;

  const tabs: { id: StudioTab; label: string; badge?: string }[] = [
    { id: 'preview', label: 'Preview' },
    { id: 'source', label: 'Source' },
    { id: 'diff', label: 'Changes', ...(diff ? { badge: 'staged' } : {}) },
  ];

  if (loadingProject && !project) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
        <div className="skeleton h-10 w-full" />
        <div className="grid flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_330px]">
          <div className="skeleton h-full min-h-64" />
          <div className="skeleton h-full min-h-64" />
          <div className="skeleton h-full min-h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface/40 px-4 py-2.5">
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Icon name="spark" className="size-3.5 text-accent" />
          <span className="eyebrow text-accent/90">HTML Studio</span>
        </span>
        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-ink">{title}</h1>
          <p className="meta truncate">
            {projectId} · index.html · from prompt to working browser application
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {state?.current_version ? (
            <span className="chip border-ok/30 bg-ok/5 text-ok">
              v{state.current_version} approved
            </span>
          ) : (
            <span className="chip">no approved version</span>
          )}
          {stagedVersion ? (
            <span className="chip border-warn/35 bg-warn/10 text-warn">
              v{stagedVersion} staged
            </span>
          ) : null}
          {running ? (
            <span className="chip border-accent/30 bg-accent/5 text-accent">
              <span className="spinner" aria-hidden="true" /> {jobLabel(job?.status ?? 'running')}
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ProjectSwitcher
            projectId={projectId}
            projects={projects}
            onOpen={(id) => void openProject(id)}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void download()}
            disabled={!hasGame && !activeJobId}
            className="btn btn-sm"
            title="Download the HTML artifact you are viewing"
          >
            <Icon name="download" className="size-3.5" />
            Download HTML
          </button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-err/30 bg-err/5 px-4 py-2" role="alert">
          <div className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-err" />
            <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-err">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-err/80 hover:text-err"
              aria-label="Dismiss error"
            >
              <Icon name="x" className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`border-b px-4 py-2 ${
            notice.tone === 'ok'
              ? 'border-ok/25 bg-ok/5 text-ok'
              : notice.tone === 'warn'
                ? 'border-warn/25 bg-warn/5 text-warn'
                : 'border-err/30 bg-err/5 text-err'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-2">
            <Icon
              name={notice.tone === 'ok' ? 'check' : 'alert'}
              className="mt-0.5 size-3.5 shrink-0"
            />
            <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed">{notice.text}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss message"
            >
              <Icon name="x" className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[280px_minmax(0,1fr)_334px] xl:overflow-hidden">
        <div className="flex min-h-0 flex-col gap-3 xl:overflow-y-auto">
          <PromptPanel
            mode={promptMode}
            onMode={setPromptMode}
            hasGame={hasGame}
            prompt={prompt}
            onPrompt={setPrompt}
            change={change}
            onChange={setChange}
            screenshot={screenshot}
            previewReady={previewReady}
            canCapture={hasGame || previewJobId !== null}
            onCapture={capture}
            onGenerate={() => void generate()}
            onModify={() => void modify()}
            running={running}
            busy={busy}
            job={job}
            diff={diff}
            onCancel={() => void cancel()}
          />
          <StudioMemory
            memories={memories}
            loading={memoriesLoading}
            error={memoryError}
            job={job}
            onOpenMemory={(id) => onOpenMemory(id, projectId)}
            onOpenMemoryView={onOpenMemoryView}
          />
          {project ? (
            <div className="hidden 2xl:block">
              <StudioActivity jobs={project.jobs} />
            </div>
          ) : null}
          {!state?.current_version && !activeJobId ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[10.5px] leading-relaxed text-muted">
              This project has no approved HTML yet. Generate a first version; approval publishes
              it.
            </p>
          ) : null}
        </div>

        <section
          aria-label="HTML application"
          className="panel flex min-h-[460px] flex-col overflow-hidden xl:min-h-0"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-1.5">
            <div role="tablist" aria-label="Artifact view" className="flex items-center gap-0.5">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  aria-controls={`studio-panel-${entry.id}`}
                  id={`studio-tab-${entry.id}`}
                  onClick={() => {
                    setTab(entry.id);
                    if (entry.id === 'source' || entry.id === 'diff') {
                      const wanted =
                        previewMode === 'staged' ? (activeJobId ?? undefined) : undefined;
                      if (
                        !artifact ||
                        (wanted ? artifact.job_id !== wanted : artifact.job_id !== null)
                      ) {
                        void loadArtifact(projectId, wanted);
                      }
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                    event.preventDefault();
                    const index = tabs.findIndex((item) => item.id === tab);
                    const nextIndex =
                      event.key === 'ArrowRight'
                        ? (index + 1) % tabs.length
                        : (index - 1 + tabs.length) % tabs.length;
                    const next = tabs[nextIndex];
                    if (next) {
                      setTab(next.id);
                      document.getElementById(`studio-tab-${next.id}`)?.focus();
                    }
                  }}
                  className="tab"
                >
                  {entry.label}
                  {entry.badge ? (
                    <span className="rounded bg-warn/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-warn">
                      {entry.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {activeJobId ? (
              <div className="ml-auto flex items-center rounded-md border border-line bg-base/50 p-0.5">
                <button
                  type="button"
                  aria-pressed={previewMode === 'approved'}
                  onClick={() => switchPreview('approved')}
                  className={`rounded px-2 py-1 text-[10.5px] font-medium transition-colors ${
                    previewMode === 'approved'
                      ? 'bg-surface-2 text-ink'
                      : 'text-muted hover:text-ink-dim'
                  }`}
                >
                  Approved v{state?.current_version ?? 1}
                </button>
                <button
                  type="button"
                  aria-pressed={previewMode === 'staged'}
                  onClick={() => switchPreview('staged')}
                  className={`rounded px-2 py-1 text-[10.5px] font-medium transition-colors ${
                    previewMode === 'staged'
                      ? 'bg-warn/15 text-warn'
                      : 'text-muted hover:text-ink-dim'
                  }`}
                >
                  Staged v{stagedVersion ?? ''}
                </button>
              </div>
            ) : null}
          </div>

          {tab === 'preview' ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1">
              <div className="flex items-center rounded border border-line bg-base/50 p-0.5">
                {(['desktop', 'mobile'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDevice(option)}
                    aria-pressed={device === option}
                    className={`rounded px-2 py-0.5 text-[10.5px] capitalize transition-colors ${
                      device === option ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink-dim'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="btn btn-sm btn-quiet"
              >
                <Icon name="refresh" className="size-3.5" /> Reload
              </button>
              <button
                type="button"
                onClick={restartGame}
                disabled={!previewReady}
                className="btn btn-sm btn-quiet"
              >
                <Icon name="play" className="size-3.5" /> Restart
              </button>
              <button
                type="button"
                onClick={capture}
                disabled={!canCapture}
                className="btn btn-sm btn-quiet"
              >
                <Icon name="system" className="size-3.5" /> Capture
              </button>
              {previewError ? (
                <span className="chip border-err/30 bg-err/10 text-err">runtime error</span>
              ) : null}
              {previewMode === 'staged' ? (
                <span className="chip border-warn/30 bg-warn/10 text-warn">
                  staged — not approved
                </span>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-muted">
                {previewJobId
                  ? `staging ${previewJobId.slice(0, 8)}`
                  : state?.current_version
                    ? `v${state.current_version}`
                    : 'no version'}
              </span>
            </div>
          ) : null}

          <div
            role="tabpanel"
            id={`studio-panel-${tab}`}
            aria-labelledby={`studio-tab-${tab}`}
            className="min-h-0 flex-1"
          >
            <div
              className={
                tab === 'preview'
                  ? 'relative flex h-full min-h-0 items-stretch justify-center overflow-hidden bg-[#0b0e14] p-2.5'
                  : 'hidden'
              }
            >
              {hasGame || previewJobId ? (
                <>
                  <iframe
                    key={previewKey}
                    ref={iframeRef}
                    src={previewSrc}
                    title="HTML application preview"
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    onLoad={() => setPreviewReady(true)}
                    className={`h-full rounded-md border border-line bg-white ${
                      device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'
                    }`}
                  />
                  {!previewReady ? (
                    <div className="absolute inset-2.5 flex items-center justify-center rounded-md bg-base/70">
                      <span className="flex items-center gap-2 text-[11.5px] text-muted">
                        <span className="spinner" aria-hidden="true" /> Loading preview…
                      </span>
                    </div>
                  ) : null}
                  {previewError ? (
                    <div className="absolute inset-x-2.5 bottom-2.5 rounded-md border border-err/40 bg-base/95 px-3 py-2">
                      <p className="text-[11px] font-medium text-err">Preview runtime error</p>
                      <p className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-err/90">
                        {previewError}
                      </p>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setReload((value) => value + 1)}
                          className="btn btn-sm"
                        >
                          Reload preview
                        </button>
                        <span className="self-center text-[10px] text-muted">
                          Approval is disabled while the preview fails.
                        </span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <PanelEmpty
                  icon="spark"
                  title="No HTML application yet"
                  body="Describe the application on the left. Muse Spark writes a staged index.html; you approve it before it becomes current."
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setPromptMode('new');
                        requestAnimationFrame(() => {
                          document.getElementById('studio-prompt')?.focus();
                        });
                      }}
                      className="btn btn-sm mt-1"
                    >
                      <Icon name="spark" className="size-3.5" /> Write the first prompt
                    </button>
                  }
                />
              )}
            </div>

            {tab === 'source' ? (
              <SourcePanel artifact={artifact} loading={artifactLoading} error={artifactError} />
            ) : null}

            {tab === 'diff' ? (
              <DiffPanel diff={diff} onOpenSource={() => setTab('source')} />
            ) : null}
          </div>

          <ArtifactFooter artifact={artifact} model={model} offline={offline} />
        </section>

        <div className="flex min-h-0 flex-col xl:overflow-hidden">
          <ReviewPanel
            state={state}
            diff={diff}
            job={job}
            busy={busy}
            previewError={previewError}
            captureMemory={captureMemory}
            onCaptureMemory={setCaptureMemory}
            decision={decision}
            onDecision={setDecision}
            onApprove={() => void approve()}
            onReject={() => void reject()}
            onRollback={() => void rollback()}
            onOpenSource={() => setTab('source')}
          />
        </div>
      </div>
    </div>
  );
}
