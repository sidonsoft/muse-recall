import type { HealthResponse, ModelResponse, ServiceMeta } from '@mml/shared';
import { useCallback, useEffect, useState } from 'react';
import { ContextInspector } from './components/ContextInspector.tsx';
import { Icon } from './components/Icon.tsx';
import { MemoryInspector } from './components/memory/MemoryInspector.tsx';
import { Overview } from './components/Overview.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { StatusPill } from './components/ui.tsx';
import { ApiError, api } from './lib/api.ts';
import { VIEWS, type ViewId, viewById } from './views.ts';

export function App() {
  const [view, setView] = useState<ViewId>('overview');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [meta, setMeta] = useState<ServiceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [lastCall, setLastCall] = useState<ModelResponse | null>(null);

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

  const current = viewById(view);
  const reachable = health !== null;

  return (
    <div className="grid h-dvh grid-cols-1 overflow-hidden bg-base md:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_312px]">
      <div className="hidden md:block">
        <Sidebar current={view} onSelect={setView} meta={meta} backendReachable={reachable} />
      </div>

      <main className="canvas-grid flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-base/80 px-5 py-3 backdrop-blur">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-ink">{current.label}</h1>
            <p className="mt-0.5 truncate text-[11px] text-muted">{current.description}</p>
          </div>
          <div className="flex items-center gap-2">
            {health ? (
              <StatusPill
                tone={health.status === 'ok' ? 'ok' : health.status === 'degraded' ? 'warn' : 'err'}
              >
                {health.status === 'ok'
                  ? 'healthy'
                  : health.status === 'degraded'
                    ? 'degraded'
                    : 'error'}
              </StatusPill>
            ) : (
              <StatusPill tone={loading ? 'idle' : 'err'}>
                {loading ? 'connecting' : 'offline'}
              </StatusPill>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex size-7 items-center justify-center rounded-md border border-line bg-surface-2 text-muted transition hover:text-ink"
              aria-label="Refresh status"
            >
              <Icon name="refresh" className="size-3.5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && !health ? (
            <ConnectionError message={error} onRetry={() => void refresh()} />
          ) : null}

          {!health && loading ? <p className="text-xs text-muted">Connecting to the API…</p> : null}

          {health && view === 'overview' ? (
            <Overview
              health={health}
              meta={meta}
              probing={probing}
              onProbe={() => void runProbe()}
              onBenchResult={setLastCall}
            />
          ) : null}

          {health && view === 'memories' ? <MemoryInspector meta={meta} /> : null}

          {health && view !== 'overview' && view !== 'memories' ? (
            <PlannedView viewId={view} />
          ) : null}

          {error && health ? (
            <p className="mt-3 rounded-lg border border-err/30 bg-err/5 px-3 py-2 font-mono text-[11px] text-err">
              {error}
            </p>
          ) : null}
        </div>
      </main>

      <div className="hidden xl:block">
        <ContextInspector health={health} meta={meta} lastCall={lastCall} />
      </div>
    </div>
  );
}

function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="panel mx-auto mt-10 max-w-lg p-6 text-center">
      <div className="mx-auto flex size-9 items-center justify-center rounded-xl bg-err/10 text-err">
        <Icon name="alert" className="size-4.5" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-ink">The API is not reachable</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{message}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-base/70 px-3 py-2 text-left font-mono text-[11px] text-ink-dim">
        pnpm dev:server
      </pre>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dim"
      >
        Retry connection
      </button>
    </div>
  );
}

/**
 * Placeholder for a section whose delivery phase has not started.
 *
 * It states the phase and what the section will contain. This is a deliberate
 * honesty mechanism: the navigation shows the product's shape without
 * pretending the capability exists.
 */
function PlannedView({ viewId }: { viewId: ViewId }) {
  const planned = VIEWS.filter((entry) => !entry.implemented && entry.phase > 1).sort(
    (a, b) => a.phase - b.phase,
  );

  return (
    <div className="space-y-4">
      <div className="panel p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-line">
            <Icon name={viewById(viewId).icon} className="size-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {viewById(viewId).label} is scheduled for Phase {viewById(viewId).phase}
            </h2>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
              {viewById(viewId).description}
            </p>
            <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-muted">
              Phase 1 ships the foundation only: workspace, API, database, shared contracts, and a
              verified Muse provider. This screen is a placeholder, not a working feature.
            </p>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          Delivery order
        </h3>
        <ol className="mt-3 space-y-2">
          {planned.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3">
              <span className="w-10 shrink-0 rounded border border-line px-1 py-px text-center font-mono text-[9px] text-muted">
                P{entry.phase}
              </span>
              <span className="text-xs text-ink-dim">{entry.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
