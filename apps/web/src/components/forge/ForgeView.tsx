import type { ForgeDiff, ForgeJob, ForgeProjectView } from '@mml/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { Icon } from '../Icon.tsx';

/**
 * Muse Forge — generate a game, play it, change it from a screenshot, review the
 * diff, and approve or undo. Generated HTML lives in a sandboxed iframe with an
 * opaque origin; only the capture bridge talks to this page.
 */

const TERMINAL = ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'];

function messageOf(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_PROMPT =
  'A colourful farmyard memory-matching game for children aged 4-7. Twelve cards (six pairs), large touch targets, score and moves, restart, a win overlay, and a responsive layout.';

export function ForgeView() {
  const [projectId, setProjectId] = useState('montys-memory-meadow');
  const [project, setProject] = useState<ForgeProjectView | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [change, setChange] = useState(
    'Make the animal cards larger and change the background to a warm sunset.',
  );
  const [job, setJob] = useState<ForgeJob | null>(null);
  const [diff, setDiff] = useState<ForgeDiff | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [captureMemory, setCaptureMemory] = useState(true);
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const refresh = useCallback(
    async (id = projectId) => {
      const next = await api.forgeState(id);
      setProject(next);
      return next;
    },
    [projectId],
  );

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(messageOf(cause)));
  }, [refresh]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; dataUrl?: string | null; error?: string } | null;
      if (data?.type !== 'forge:screenshot') return;
      if (data.dataUrl) {
        setScreenshot(data.dataUrl);
        setNotice('Preview captured. Describe the visual change you want.');
        setError(null);
      } else {
        setError(data.error ?? 'The preview has no canvas to capture.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function waitForFinish(id: string): Promise<ForgeJob> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const current = await api.forgeJob(id);
      setJob(current);
      if (TERMINAL.includes(current.status)) return current;
      await delay(1500);
    }
    throw new Error('The job did not finish in time.');
  }

  async function openProject(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setJob(null);
    setDiff(null);
    setPreviewJobId(null);
    setScreenshot(null);
    try {
      await api.forgeProject(projectId, projectId);
      await refresh(projectId);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setDiff(null);
    setScreenshot(null);
    setPreviewJobId(null);
    try {
      const created = await api.forgeGenerate(projectId, prompt);
      setJob(created);
      const finished = await waitForFinish(created.id);
      if (finished.status === 'succeeded') {
        setPreviewJobId(finished.id);
        setDiff(await api.forgeDiff(finished.id));
        setNotice('Game generated. Play it, then review and approve the change.');
      } else {
        setError(finished.error ?? `Generation ${finished.status}.`);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  }

  async function modify(): Promise<void> {
    if (!screenshot) {
      setError('Capture the preview first — the change request is grounded in the screenshot.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setDiff(null);
    try {
      const created = await api.forgeModify(projectId, change, screenshot);
      setJob(created);
      const finished = await waitForFinish(created.id);
      if (finished.status === 'succeeded') {
        setPreviewJobId(finished.id);
        setDiff(await api.forgeDiff(finished.id));
        setNotice('Change staged. Review the diff before applying it.');
      } else {
        setError(finished.error ?? `Change ${finished.status}.`);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    try {
      setJob(await api.forgeCancel(job.id));
      setNotice('Cancellation requested. The staged change will not be applied.');
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function approve(): Promise<void> {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgeApprove(job.id, captureMemory, decision.trim() || undefined);
      setNotice(
        captureMemory
          ? 'Change approved and saved as a project decision.'
          : 'Change approved. The previous version is preserved.',
      );
      setDiff(null);
      setPreviewJobId(null);
      setScreenshot(null);
      setDecision('');
      await refresh();
      setReload((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgeReject(job.id);
      setNotice('Change rejected. The approved game is untouched.');
      setDiff(null);
      setPreviewJobId(null);
      setScreenshot(null);
      await refresh();
      setReload((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.forgeRollback(projectId);
      await refresh();
      setPreviewJobId(null);
      setDiff(null);
      setReload((value) => value + 1);
      setNotice('Restored the previous approved version.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  function capture(): void {
    iframeRef.current?.contentWindow?.postMessage({ type: 'forge:capture' }, '*');
  }

  const state = project?.state;
  const hasGame = state?.current_version !== null;
  const running = job?.status === 'running' || job?.status === 'queued';
  const previewSrc = api.forgePreviewUrl(projectId, previewJobId ?? undefined);
  const previewKey = `${previewJobId ?? state?.current_version ?? 'none'}-${device}-${reload}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately reset per preview key
  useEffect(() => {
    setPreviewReady(false);
  }, [previewKey]);

  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Forge project
          </span>
          <input
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="w-64 rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs text-ink"
            aria-label="Forge project id"
          />
        </label>
        <button
          type="button"
          onClick={() => void openProject()}
          disabled={busy}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink hover:border-accent disabled:opacity-50"
        >
          Open project
        </button>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          <span>
            approved:{' '}
            <span className="font-mono text-ink-dim">
              {state?.current_version ? `v${state.current_version}` : 'none'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void rollback()}
            disabled={busy || !state?.can_rollback}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim hover:border-accent disabled:opacity-40"
          >
            Undo last change
          </button>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-xs text-ok">{notice}</p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <section className="rounded-xl border border-line bg-surface p-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Icon name="spark" className="size-3.5 text-accent" /> Describe the game
            </h3>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink"
              aria-label="Game description"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy || running || prompt.trim().length < 10}
                className="rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent disabled:opacity-40"
              >
                {busy && running ? 'Generating…' : 'Generate game'}
              </button>
              {running ? (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  className="rounded-md border border-line px-3 py-1.5 text-[11px] text-muted"
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Real Muse writes <span className="font-mono">index.html</span> into a staging copy.
              Nothing touches the approved game until you approve the diff.
            </p>
          </section>

          {job ? (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <StatusDot status={job.status} />
                <span className="text-xs font-semibold text-ink">{job.kind}</span>
                <span className="ml-auto font-mono text-[10px] text-muted">{job.status}</span>
              </div>
              {job.usage ? (
                <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">
                  {job.usage.calls} calls · {job.usage.input_tokens.toLocaleString()} in /{' '}
                  {job.usage.output_tokens.toLocaleString()} out tokens (observational) ·{' '}
                  {(job.usage.runtime_ms / 1000).toFixed(1)}s
                </p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted">
                {job.memory_ids.length} project memories used
                {job.validation ? ` · validation ${job.validation.ok ? 'passed' : 'failed'}` : ''}
              </p>
              {job.error ? <p className="mt-1 text-[11px] text-err">{job.error}</p> : null}
              {job.validation && !job.validation.ok ? (
                <ul className="mt-1 list-inside list-disc text-[10px] text-err">
                  {job.validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
              {job.logs.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-muted">Job log</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[9px] leading-relaxed text-ink-dim">
                    {job.logs.join('\n')}
                  </pre>
                </details>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-line bg-surface p-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Icon name="edit" className="size-3.5 text-accent" /> Change from a screenshot
            </h3>
            <div className="mt-2 flex items-center gap-2">
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="Captured preview"
                  className="h-14 w-24 rounded border border-line object-cover"
                />
              ) : (
                <div className="flex h-14 w-24 items-center justify-center rounded border border-dashed border-line text-[9px] text-muted">
                  no capture
                </div>
              )}
              <button
                type="button"
                onClick={capture}
                disabled={!previewReady || (!hasGame && !previewJobId)}
                className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[10px] text-ink-dim hover:border-accent disabled:opacity-40"
              >
                Capture preview
              </button>
            </div>
            <textarea
              value={change}
              onChange={(event) => setChange(event.target.value)}
              rows={3}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink"
              aria-label="Visual change request"
            />
            <button
              type="button"
              onClick={() => void modify()}
              disabled={busy || running || !screenshot || change.trim().length < 3}
              className="mt-2 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent disabled:opacity-40"
            >
              Generate change
            </button>
            <p className="mt-1.5 text-[10px] text-muted">
              The screenshot is attached to the Muse request; the diff is staged separately.
            </p>
          </section>
        </div>

        <div className="space-y-3">
          <section className="rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
              <button
                type="button"
                onClick={() => setDevice('desktop')}
                className={`rounded px-2 py-1 text-[10px] ${device === 'desktop' ? 'bg-accent/15 text-accent' : 'text-muted'}`}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setDevice('mobile')}
                className={`rounded px-2 py-1 text-[10px] ${device === 'mobile' ? 'bg-accent/15 text-accent' : 'text-muted'}`}
              >
                Mobile
              </button>
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="rounded px-2 py-1 text-[10px] text-muted hover:text-ink"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={capture}
                disabled={!previewReady || (!hasGame && !previewJobId)}
                className="rounded px-2 py-1 text-[10px] text-muted hover:text-ink disabled:opacity-40"
              >
                Capture
              </button>
              {previewJobId ? (
                <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[9px] text-warn">
                  staged — not approved
                </span>
              ) : null}
              <span className="ml-auto font-mono text-[9px] text-muted">
                {previewJobId
                  ? 'staging'
                  : state?.current_version
                    ? `v${state.current_version}`
                    : 'empty'}
              </span>
            </div>
            <div className="flex justify-center bg-[#141019] p-3">
              {hasGame || previewJobId ? (
                <iframe
                  key={previewKey}
                  ref={iframeRef}
                  src={previewSrc}
                  title="Game preview"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  onLoad={() => setPreviewReady(true)}
                  className="h-[520px] rounded-lg border border-line bg-black"
                  style={{ width: device === 'mobile' ? 375 : '100%', maxWidth: '100%' }}
                />
              ) : (
                <div className="flex h-[520px] w-full flex-col items-center justify-center gap-2 text-center">
                  <Icon name="spark" className="size-6 text-muted" />
                  <p className="max-w-xs text-xs text-muted">
                    Generate a game to see it here. The preview runs in a sandboxed iframe with an
                    opaque origin.
                  </p>
                </div>
              )}
            </div>
          </section>

          {diff ? (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-ink">Review change</h3>
                <span className="font-mono text-[10px] text-muted">{diff.summary}</span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[9px] ${diff.validation.ok ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err'}`}
                >
                  {diff.validation.ok ? 'validation passed' : 'validation failed'}
                </span>
              </div>
              {diff.validation.issues.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-[10px] text-err">
                  {diff.validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[9px] leading-relaxed text-ink-dim">
                {diff.files.map((file) => file.diff).join('\n')}
              </pre>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                  <input
                    type="checkbox"
                    checked={captureMemory}
                    onChange={(event) => setCaptureMemory(event.target.checked)}
                  />
                  Save the decision to project memory
                </label>
                <input
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  placeholder="Decision note (optional)"
                  className="min-w-48 flex-1 rounded border border-line bg-surface-2 px-2 py-1 text-[10px] text-ink"
                  aria-label="Decision note"
                />
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={busy || !diff.validation.ok}
                  className="rounded-md border border-ok/40 bg-ok/10 px-3 py-1.5 text-[11px] text-ok disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void reject()}
                  disabled={busy}
                  className="rounded-md border border-line px-3 py-1.5 text-[11px] text-muted"
                >
                  Reject
                </button>
              </div>
            </section>
          ) : null}

          {project && project.jobs.length > 0 ? (
            <section className="rounded-xl border border-line bg-surface p-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Recent jobs
              </h3>
              <ul className="mt-1 space-y-1">
                {project.jobs.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 text-[10px] text-ink-dim">
                    <StatusDot status={entry.status} />
                    <span className="font-mono">{entry.kind}</span>
                    <span className="text-muted">{entry.status}</span>
                    {entry.version ? <span className="text-ok">v{entry.version}</span> : null}
                    <span className="ml-auto font-mono text-[9px] text-muted">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'succeeded'
      ? 'bg-ok'
      : status === 'failed' || status === 'budget_exceeded'
        ? 'bg-err'
        : status === 'cancelled' || status === 'rejected'
          ? 'bg-muted'
          : 'bg-warn';
  return <span className={`inline-block size-1.5 rounded-full ${tone}`} aria-hidden="true" />;
}
