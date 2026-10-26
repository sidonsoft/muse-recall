import type { HealthResponse, ModelResponse, ServiceMeta } from '@mml/shared';
import type { ReactNode } from 'react';
import { formatLatency, formatTokens } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { DataRow } from './ui.tsx';

/**
 * The right rail.
 *
 * Its job is to answer "what is the agent doing, and why?" at a glance. In
 * Phase 1 most of those answers are honestly "nothing yet" — the rail shows
 * retrieval and tool activity only once those subsystems exist, rather than
 * fabricating plausible-looking numbers.
 */
export function ContextInspector({
  health,
  meta,
  lastCall,
}: {
  health: HealthResponse | null;
  meta: ServiceMeta | null;
  lastCall: ModelResponse | null;
}) {
  const provider = health?.provider;
  const capabilities = meta?.provider.capabilities;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto border-l border-line bg-surface/40">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Icon name="bolt" className="size-3.5 text-accent" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          Context inspector
        </h2>
      </div>

      <div className="space-y-4 px-4 py-4">
        <InspectorSection label="Agent state">
          <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
            <p className="text-xs text-ink-dim">Idle — no agent session open.</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              The conversational harness lands in Phase 3. Until then the only live path is the
              provider bench.
            </p>
          </div>
        </InspectorSection>

        <InspectorSection label="Retrieved memories">
          <div className="rounded-lg border border-dashed border-line px-3 py-2.5">
            <p className="text-xs text-muted">No agent turn yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Retrieval runs on demand in the Memory inspector. Injecting it into a prompt is Phase
              3 work, so nothing is counted here yet.
            </p>
          </div>
        </InspectorSection>

        <InspectorSection label="Tool activity">
          <p className="text-[11px] text-muted">
            No tools registered. Approval policy:{' '}
            <span className="font-mono text-ink-dim">
              {meta?.safety.tool_approval_policy ?? '—'}
            </span>
          </p>
        </InspectorSection>

        <InspectorSection label="Last model call">
          {lastCall ? (
            <dl className="divide-y divide-line/70">
              <DataRow label="model" value={lastCall.model} mono />
              <DataRow label="input" value={`${formatTokens(lastCall.usage.input_tokens)} tok`} />
              <DataRow label="output" value={`${formatTokens(lastCall.usage.output_tokens)} tok`} />
              <DataRow
                label="reasoning"
                value={`${formatTokens(lastCall.usage.reasoning_tokens)} tok`}
              />
              <DataRow label="latency" value={formatLatency(lastCall.latency_ms)} />
            </dl>
          ) : (
            <p className="text-[11px] text-muted">
              No call in this page session. Token accounting appears here after the first request.
            </p>
          )}
        </InspectorSection>

        <InspectorSection label="Provider">
          <dl className="divide-y divide-line/70">
            <DataRow label="adapter" value={provider?.provider_id ?? '—'} mono />
            <DataRow label="model" value={provider?.model ?? '—'} mono />
            <DataRow
              label="verified"
              value={provider?.verified_with_live_call ? 'live call' : 'not yet'}
            />
            <DataRow
              label="context"
              value={capabilities ? `${formatTokens(capabilities.max_context_tokens)} tok` : '—'}
            />
          </dl>
        </InspectorSection>

        <InspectorSection label="Safety posture">
          <ul className="space-y-1.5 text-[11px] text-muted">
            <SafetyLine label="Generated code execution" value="disabled" ok />
            <SafetyLine label="Secrets in browser" value="none" ok />
            <SafetyLine
              label="Tool approval"
              value={meta?.safety.tool_approval_policy ?? 'always'}
              ok
            />
            <SafetyLine label="Sandbox" value="not yet required" ok={false} neutral />
          </ul>
        </InspectorSection>
      </div>
    </aside>
  );
}

function InspectorSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </h3>
      {children}
    </section>
  );
}

function SafetyLine({
  label,
  value,
  ok,
  neutral = false,
}: {
  label: string;
  value: string;
  ok: boolean;
  neutral?: boolean;
}) {
  const tone = neutral ? 'text-muted' : ok ? 'text-ok' : 'text-warn';
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="truncate">{label}</span>
      <span className={`shrink-0 font-mono text-[10px] ${tone}`}>{value}</span>
    </li>
  );
}
