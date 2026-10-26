import type { ServiceMeta } from '@mml/shared';
import { VIEWS, type ViewId } from '../views.ts';
import { Icon } from './Icon.tsx';

export function Sidebar({
  current,
  onSelect,
  meta,
  backendReachable,
}: {
  current: ViewId;
  onSelect: (view: ViewId) => void;
  meta: ServiceMeta | null;
  backendReachable: boolean;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-surface/60">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="relative flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-dim text-base shadow-lg shadow-accent/20">
          <Icon name="memory" className="size-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold tracking-tight text-ink">
            Muse Memory Lab
          </p>
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted">
            memory companion
          </p>
        </div>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-2" aria-label="Primary">
        {VIEWS.map((view) => {
          const active = view.id === current;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelect(view.id)}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                active
                  ? 'bg-surface-2 text-ink ring-1 ring-line'
                  : 'text-ink-dim hover:bg-surface-2/60 hover:text-ink'
              }`}
            >
              <Icon
                name={view.icon}
                className={`size-4 ${active ? 'text-accent' : 'text-muted group-hover:text-ink-dim'}`}
              />
              <span className="flex-1 truncate">{view.label}</span>
              {!view.implemented ? (
                <span className="rounded border border-line px-1 py-px font-mono text-[9px] text-muted">
                  P{view.phase}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-line px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Provider</span>
          <span
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${
              backendReachable ? 'text-ink-dim' : 'text-muted'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${backendReachable ? 'bg-ok' : 'bg-err'}`}
              aria-hidden="true"
            />
            {meta?.provider.id ?? 'unknown'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Version</span>
          <span className="font-mono text-[10px] text-ink-dim">
            v{meta?.version ?? '0.0.0'} · phase {meta?.phase ?? 1}
          </span>
        </div>
      </div>
    </aside>
  );
}
