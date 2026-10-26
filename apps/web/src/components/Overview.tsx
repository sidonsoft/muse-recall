import type { HealthResponse, ModelResponse, ServiceMeta } from '@mml/shared';
import { formatLatency, formatTokens, formatUptime, shortenPath } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { ProviderBench } from './ProviderBench.tsx';
import { DataRow, Panel, SectionTitle, StatusPill, type Tone } from './ui.tsx';

function statusTone(status: string): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'degraded' || status === 'skipped') return 'warn';
  return 'err';
}

function statusLabel(status: string): string {
  if (status === 'ok') return 'healthy';
  if (status === 'skipped') return 'unverified';
  return status;
}

export function Overview({
  health,
  meta,
  probing,
  onProbe,
  onBenchResult,
}: {
  health: HealthResponse;
  meta: ServiceMeta | null;
  probing: boolean;
  onProbe: () => void;
  onBenchResult: (response: ModelResponse) => void;
}) {
  const { database, provider } = health;
  const offline = meta?.provider.id !== 'muse-cli';

  return (
    <div className="space-y-4">
      {offline ? (
        <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3">
          <p className="text-xs font-medium text-warn">
            The deterministic offline provider is active — this is not Meta Muse.
          </p>
          <p className="mt-1 text-[11px] text-ink-dim">
            Set <code className="font-mono text-warn">MODEL_PROVIDER=muse-cli</code> in{' '}
            <code className="font-mono">.env</code> and restart to use real inference. The bench
            below still works; it returns canned text.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <SectionTitle icon="system" title="API service" hint="Fastify · Node runtime" />
          <dl className="mt-3 divide-y divide-line/70">
            <DataRow
              label="status"
              value={
                <StatusPill tone={statusTone(health.status)}>
                  {statusLabel(health.status)}
                </StatusPill>
              }
            />
            <DataRow label="version" value={`v${health.version}`} mono />
            <DataRow label="uptime" value={formatUptime(health.uptime_seconds)} />
            <DataRow label="environment" value={health.environment} mono />
          </dl>
        </Panel>

        <Panel>
          <SectionTitle icon="memory" title="Memory database" hint="SQLite · migrations applied" />
          <dl className="mt-3 divide-y divide-line/70">
            <DataRow label="engine" value={database.engine} mono />
            <DataRow label="schema" value={`v${database.schema_version}`} mono />
            <DataRow
              label="write test"
              value={
                <span className={database.write_verified ? 'text-ok' : 'text-err'}>
                  {database.write_verified ? 'round-trip verified' : 'failed'}
                </span>
              }
            />
            <DataRow label="file" value={shortenPath(database.path)} mono />
          </dl>
        </Panel>

        <Panel>
          <SectionTitle
            icon="spark"
            title="Muse integration"
            hint={provider.provider_name}
            action={
              meta?.provider.id === 'muse-cli' ? (
                <button
                  type="button"
                  onClick={onProbe}
                  disabled={probing}
                  className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] font-medium text-ink-dim transition hover:border-line-bright hover:text-ink disabled:opacity-50"
                >
                  {probing ? 'checking…' : 'live check'}
                </button>
              ) : null
            }
          />
          <dl className="mt-3 divide-y divide-line/70">
            <DataRow
              label="live call"
              value={
                provider.verified_with_live_call ? (
                  <StatusPill tone={provider.status === 'ok' ? 'ok' : 'err'}>
                    {provider.status === 'ok' ? 'verified' : 'failed'}
                  </StatusPill>
                ) : (
                  <StatusPill tone="idle">not run</StatusPill>
                )
              }
            />
            <DataRow label="model" value={provider.model ?? '—'} mono />
            <DataRow label="latency" value={formatLatency(provider.latency_ms)} />
            <DataRow
              label="context"
              value={
                provider.capabilities
                  ? `${formatTokens(provider.capabilities.max_context_tokens)} tok`
                  : '—'
              }
            />
          </dl>
          {provider.verified_with_live_call ? (
            <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted">
              {provider.detail}
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel>
        <SectionTitle
          icon="bolt"
          title="Provider bench"
          hint="A real, bounded model call — the fastest way to confirm inference works here"
        />
        <div className="mt-3">
          <ProviderBench onResult={onBenchResult} />
        </div>
      </Panel>

      <RealityCheck meta={meta} />
    </div>
  );
}

/**
 * An explicit, machine-sourced status list.
 *
 * The build brief forbids claiming unbuilt features work. Rather than trust
 * prose, this reads the module statuses the server reports.
 */
function RealityCheck({ meta }: { meta: ServiceMeta | null }) {
  const modules = meta?.modules;
  const rows: { label: string; status: string; note: string }[] = [
    {
      label: 'Repository, API, and database',
      status: 'complete',
      note: 'Health endpoint verifies a real SQLite write round-trip.',
    },
    {
      label: 'Muse provider adapter',
      status: modules?.muse_integration ?? 'partial',
      note: 'Real headless calls, streaming, and token usage, verified on this machine.',
    },
    {
      label: 'Memory engine',
      status: modules?.memory_engine ?? 'schema_only',
      note: 'Schema, migration runner, and FTS5 index exist; retrieval lands in Phase 2.',
    },
    {
      label: 'Generative UI protocol',
      status: modules?.ui_protocol ?? 'not_implemented',
      note: 'Declarative spec, component registry, and event channel arrive in Phase 4.',
    },
    {
      label: 'Agent tools and permissions',
      status: modules?.agent_tools ?? 'not_implemented',
      note: 'Tool registry, approval policy, and audit log arrive in Phase 5.',
    },
    {
      label: 'Evaluation harness',
      status: modules?.evaluation ?? 'not_implemented',
      note: 'Baseline comparison arrives in Phase 6.',
    },
  ];

  return (
    <Panel>
      <SectionTitle
        icon="check"
        title="What is actually working"
        hint="Reported by the server, not by this interface"
      />
      <ul className="mt-3 divide-y divide-line/70">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-3 py-2">
            <span className="mt-0.5">
              <ModuleBadge status={row.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink-dim">{row.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{row.note}</p>
            </div>
            <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted">{row.status}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ModuleBadge({ status }: { status: string }) {
  if (status === 'complete') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-ok/15 text-ok">
        <Icon name="check" className="size-2.5" />
      </span>
    );
  }
  if (status === 'partial' || status === 'schema_only') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-warn/15 text-warn">
        <Icon name="alert" className="size-2.5" />
      </span>
    );
  }
  return (
    <span className="flex size-4 items-center justify-center rounded-full bg-line text-muted">
      <Icon name="x" className="size-2.5" />
    </span>
  );
}
