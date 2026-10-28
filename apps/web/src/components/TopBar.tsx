import type { HealthResponse, ServiceMeta } from '@mml/shared';
import { VIEWS, type ViewId } from '../views.ts';
import { Icon } from './Icon.tsx';

/**
 * Application chrome.
 *
 * The header carries the product identity, the four working surfaces, and the
 * live engine status. Project identity lives inside HTML Studio, where it
 * belongs to the artifact rather than to the application shell.
 */
export function TopBar({
  current,
  onSelect,
  health,
  meta,
  loading,
}: {
  current: ViewId;
  onSelect: (view: ViewId) => void;
  health: HealthResponse | null;
  meta: ServiceMeta | null;
  loading: boolean;
}) {
  const providerId = meta?.provider.id ?? null;
  const liveMuse = providerId === 'muse-cli';
  const model = meta?.provider.configured_model ?? null;
  const chatLabel = liveMuse
    ? 'Chat · Muse CLI'
    : providerId
      ? `Chat · ${providerId} (offline)`
      : 'Chat · no provider';
  const healthTone =
    health?.status === 'ok'
      ? 'ok'
      : health?.status === 'degraded'
        ? 'warn'
        : health
          ? 'err'
          : 'idle';

  return (
    <header className="flex h-[58px] shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface/70 px-4 backdrop-blur md:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-accent/35 bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-[18px]">
            <title>Muse Recall</title>
            <path
              d="M12 3.2 20.8 12 12 20.8 3.2 12 12 3.2Z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.16em] text-ink">
            Muse Recall
          </p>
          <p className="hidden truncate text-[10.5px] text-muted lg:block">
            Build with Muse Spark. Remember what matters.
          </p>
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="order-3 flex w-full items-center gap-0.5 md:order-none md:w-auto"
      >
        {VIEWS.map((view) => {
          const active = view.id === current;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelect(view.id)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                active
                  ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
                  : 'text-muted hover:bg-surface-2/60 hover:text-ink-dim'
              }`}
            >
              <Icon
                name={view.icon}
                className={`size-3.5 ${active ? 'text-accent' : 'text-muted'}`}
              />
              {view.label}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2.5">
        <span
          className="hidden items-center gap-1.5 text-[11px] text-muted sm:inline-flex"
          title={`Provider: ${meta?.provider.name ?? 'unknown'}`}
        >
          <span
            className={`size-1.5 rounded-full ${
              healthTone === 'ok'
                ? 'bg-ok'
                : healthTone === 'warn'
                  ? 'bg-warn'
                  : healthTone === 'err'
                    ? 'bg-err'
                    : 'bg-muted'
            }`}
            aria-hidden="true"
          />
          <span className="sr-only">API status: </span>
          {health
            ? health.status === 'ok'
              ? 'Healthy'
              : health.status
            : loading
              ? 'Connecting'
              : 'Offline'}
        </span>

        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />

        <span
          className="inline-flex items-center gap-1.5 text-[11px]"
          title="General conversation provider. HTML Studio generation is configured separately."
        >
          <Icon name="spark" className="size-3.5 text-accent" />
          <span className={liveMuse ? 'text-ink-dim' : 'text-warn'}>{chatLabel}</span>
          {model ? (
            <span className="hidden font-mono text-[10.5px] text-muted xl:inline">{model}</span>
          ) : null}
        </span>
      </div>
    </header>
  );
}
