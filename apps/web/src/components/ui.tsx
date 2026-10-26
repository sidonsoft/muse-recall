import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

export type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'accent';

const TONE_STYLES: Record<Tone, { dot: string; text: string; ring: string; icon?: IconName }> = {
  ok: { dot: 'bg-ok', text: 'text-ok', ring: 'ring-ok/25' },
  warn: { dot: 'bg-warn', text: 'text-warn', ring: 'ring-warn/25' },
  err: { dot: 'bg-err', text: 'text-err', ring: 'ring-err/25' },
  idle: { dot: 'bg-muted', text: 'text-muted', ring: 'ring-line-bright' },
  accent: { dot: 'bg-accent', text: 'text-accent', ring: 'ring-accent/25' },
};

export function StatusPill({
  tone,
  children,
  pulse = false,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium ring-1 ${style.ring} ${style.text}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot} ${pulse ? 'animate-pulse' : ''}`} />
      {children}
    </span>
  );
}

export function SectionTitle({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-surface-2 text-accent ring-1 ring-line">
          <Icon name={icon} className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`panel p-4 ${className}`}>{children}</section>;
}

export function DataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-xs text-ink-dim ${
          mono ? 'font-mono text-[11px]' : ''
        }`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
