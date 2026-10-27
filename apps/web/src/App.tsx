import type { HealthResponse, ServiceMeta } from '@mml/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ConversationsView } from './components/conversations/ConversationsView.tsx';
import { Icon } from './components/Icon.tsx';
import { MemoryInspector } from './components/memory/MemoryInspector.tsx';
import { Overview } from './components/Overview.tsx';
import { StudioView } from './components/studio/StudioView.tsx';
import { TopBar } from './components/TopBar.tsx';
import { ApiError, api } from './lib/api.ts';
import { type ViewId, viewById } from './views.ts';

interface MemoryFocus {
  id: string;
  projectId: string;
}

/**
 * Muse Recall application shell.
 *
 * Four working surfaces, one identity bar. HTML Studio is the landing view
 * because the generated application — not a chat transcript — is the product's
 * visual center.
 */
export function App() {
  const [view, setView] = useState<ViewId>('studio');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [meta, setMeta] = useState<ServiceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [memoryFocus, setMemoryFocus] = useState<MemoryFocus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextHealth, nextMeta] = await Promise.all([api.health(), api.meta()]);
      setHealth(nextHealth);
      setMeta(nextMeta);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      await api.probeProvider();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProbing(false);
    }
  }, [refresh]);

  const openMemory = useCallback((memoryId: string, projectId: string) => {
    setMemoryFocus({ id: memoryId, projectId });
    setView('memories');
  }, []);

  const current = viewById(view);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-base">
      <TopBar current={view} onSelect={setView} health={health} meta={meta} loading={loading} />

      {!health && loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <span className="spinner" aria-hidden="true" />
          <p className="text-[12px] text-muted">Connecting to the local API…</p>
        </div>
      ) : null}

      {!health && !loading ? (
        <ConnectionError
          message={error ?? 'The API did not respond.'}
          onRetry={() => void refresh()}
        />
      ) : null}

      {health ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error ? (
            <div
              className="flex items-center gap-2 border-b border-err/30 bg-err/5 px-4 py-2"
              role="alert"
            >
              <Icon name="alert" className="size-3.5 shrink-0 text-err" />
              <p className="min-w-0 flex-1 text-[11.5px] text-err">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-err/80 hover:text-err"
                aria-label="Dismiss error"
              >
                <Icon name="x" className="size-3.5" />
              </button>
            </div>
          ) : null}

          {view === 'studio' ? (
            <StudioView
              meta={meta}
              onOpenMemory={openMemory}
              onOpenMemoryView={() => {
                setMemoryFocus(null);
                setView('memories');
              }}
            />
          ) : null}

          {view !== 'studio' ? (
            <ViewFrame label={current.label} description={current.description}>
              {view === 'memories' ? (
                <MemoryInspector
                  meta={meta}
                  focus={memoryFocus}
                  onFocusHandled={() => setMemoryFocus(null)}
                />
              ) : null}
              {view === 'conversations' ? <ConversationsView meta={meta} /> : null}
              {view === 'system' ? (
                <Overview
                  health={health}
                  meta={meta}
                  probing={probing}
                  onProbe={() => void runProbe()}
                />
              ) : null}
            </ViewFrame>
          ) : null}
        </main>
      ) : null}
    </div>
  );
}

function ViewFrame({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-surface/30 px-5 py-3">
        <h1 className="text-[16px] font-semibold text-ink">{label}</h1>
        <p className="text-[11.5px] text-muted">{description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">{children}</div>
    </div>
  );
}

function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="panel w-full max-w-lg p-6">
        <span className="flex size-9 items-center justify-center rounded-xl border border-err/30 bg-err/10 text-err">
          <Icon name="alert" className="size-4" />
        </span>
        <h1 className="mt-3 text-[15px] font-semibold text-ink">
          Muse Recall cannot reach its local API
        </h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">
          The workspace is local-first: the browser talks only to the API on this machine.
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          Start the server, then retry. The default local API is http://127.0.0.1:8787; if you
          changed <span className="font-mono">PORT</span>, use that port.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-base/70 px-3 py-2 font-mono text-[11px] text-ink-dim">
          pnpm dev:server
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onRetry} className="btn btn-primary">
            <Icon name="refresh" className="size-3.5" /> Retry connection
          </button>
        </div>
        <details className="mt-3 border-t border-line pt-2 text-[10.5px] text-muted">
          <summary className="cursor-pointer select-none hover:text-ink-dim">
            Technical detail
          </summary>
          <p className="mt-1 break-words font-mono leading-relaxed">{message}</p>
        </details>
      </div>
    </div>
  );
}
