import type { ForgeHealthSummary, HealthResponse, ServiceMeta } from '@mml/shared';
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
}: {
  health: HealthResponse;
  meta: ServiceMeta | null;
  probing: boolean;
  onProbe: () => void;
}) {
  const { database, provider } = health;
  const offline = meta?.provider.id !== 'muse-cli';

  return (
    <div className="space-y-4">
      {offline ? (
        <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3">
          <p className="text-xs font-medium text-warn">
            The deterministic offline provider is active — this is not Muse Spark.
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
              label="read test"
              value={
                <span className={database.status === 'ok' ? 'text-ok' : 'text-err'}>
                  {database.status !== 'ok'
                    ? 'failed'
                    : database.write_verified
                      ? 'round-trip verified'
                      : 'read verified'}
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

      {health.forge ? <RecoverySummary forge={health.forge} /> : null}

      <Panel>
        <section aria-label="Alert signals">
          <SectionTitle
            icon="bolt"
            title="Alert signals"
            hint="The states pnpm ops:alert-prober consumes (D050/D051). The UI mirrors them; nothing here pages a human by itself."
          />
          {health.alerts ? (
            <dl className="mt-3 divide-y divide-line/70">
              <DataRow
                label="backup"
                value={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={
                        health.alerts.backup.state === 'ok'
                          ? 'ok'
                          : health.alerts.backup.state === 'disabled'
                            ? 'idle'
                            : 'warn'
                      }
                    >
                      {health.alerts.backup.state === 'ok'
                        ? `fresh · ${health.alerts.backup.age_hours?.toFixed(1) ?? '?'}h old (limit ${health.alerts.backup.max_age_hours}h)`
                        : health.alerts.backup.state === 'stale'
                          ? `stale · ${health.alerts.backup.age_hours?.toFixed(1) ?? '?'}h > ${health.alerts.backup.max_age_hours}h`
                          : health.alerts.backup.state === 'missing'
                            ? 'no backups found next to the database'
                            : 'watching disabled'}
                    </StatusPill>
                    <span className="text-[11px] text-muted">
                      {health.alerts.backup.backup_count} backup file(s)
                    </span>
                  </span>
                }
              />
              <DataRow
                label="storage"
                value={
                  <StatusPill tone={health.alerts.storage.ok ? 'ok' : 'warn'}>
                    {health.alerts.storage.ok
                      ? 'clear'
                      : `${health.alerts.storage.unacknowledged_issues} unacknowledged issue(s)`}
                  </StatusPill>
                }
              />
              <DataRow
                label="provider"
                value={
                  <StatusPill
                    tone={
                      health.alerts.provider.state === 'ok'
                        ? 'ok'
                        : health.alerts.provider.state === 'error'
                          ? 'err'
                          : 'idle'
                    }
                  >
                    {health.alerts.provider.state === 'ok'
                      ? 'reachable'
                      : health.alerts.provider.state === 'error'
                        ? 'failing'
                        : 'unverified'}
                  </StatusPill>
                }
              />
            </dl>
          ) : (
            <p className="mt-3 text-[11px] text-muted">
              This server build predates alert signals; upgrade to see backup freshness and
              storage/provider states here (the prober reports the same as a stale-deployment
              finding).
            </p>
          )}
        </section>
      </Panel>

      <Panel>
        <SectionTitle
          icon="bolt"
          title="Provider bench"
          hint="A real, bounded model call — the fastest way to confirm inference works here"
        />
        <div className="mt-3">
          <ProviderBench />
        </div>
      </Panel>

      <RealityCheck meta={meta} />
    </div>
  );
}

/**
 * Read-only store-wide Forge recovery summary (NEXT_STEPS P1 #8), so an
 * operator sees outstanding job-interruption and storage notices without
 * opening a project. Acknowledgement and repair stay in the Studio view.
 */
function RecoverySummary({ forge }: { forge: ForgeHealthSummary }) {
  const clean =
    forge.storage_ok && forge.unacknowledged_issues === 0 && forge.interrupted_jobs_current === 0;
  return (
    <Panel>
      <SectionTitle
        icon="system"
        title="Forge recovery"
        hint="Store-wide · read-only here; open HTML Studio to acknowledge or repair"
      />
      <dl className="mt-3 divide-y divide-line/70">
        <DataRow
          label="storage"
          value={
            <span className={forge.storage_ok ? 'text-ok' : 'text-err'}>
              {forge.storage_ok ? 'healthy' : 'a write check failed'}
            </span>
          }
        />
        <DataRow
          label="open notices"
          value={
            <span className={forge.unacknowledged_issues === 0 ? 'text-ok' : 'text-warn'}>
              {forge.unacknowledged_issues}
            </span>
          }
        />
        <DataRow label="interrupted now" value={String(forge.interrupted_jobs_current)} />
        <DataRow
          label="startup"
          value={`recovered ${forge.loaded_jobs_startup} job record${forge.loaded_jobs_startup === 1 ? '' : 's'} · ${forge.interrupted_jobs_startup} interrupted`}
        />
        <DataRow label="acknowledged" value={String(forge.acknowledged_issues)} />
      </dl>
      {forge.issues.length > 0 ? (
        <ul className="mt-2 list-inside list-disc space-y-0.5 font-mono text-[10px] text-warn/90">
          {forge.issues.map((issue) => (
            <li key={issue.id}>
              {issue.project_id} · {issue.file}: {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] text-muted">
          {clean ? 'No open recovery notices; every Forge write check passed.' : 'Details above.'}
        </p>
      )}
    </Panel>
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
      label: 'Local API and SQLite',
      status: 'complete',
      note: 'Health checks the local database read-only; memories persist on this machine.',
    },
    {
      label: 'Muse Spark integration',
      status: modules?.muse_integration ?? 'partial',
      note: 'Headless calls stream to the UI and report token usage. The provider row above shows what is configured.',
    },
    {
      label: 'Persistent project memory',
      status: modules?.memory_engine ?? 'partial',
      note: 'Retrieval with budgets, corrections that supersede, deletion, and full history.',
    },
    {
      label: 'HTML Studio',
      status: 'available',
      note: 'Muse Spark writes index.html into staging; approval promotes an immutable version.',
    },
    {
      label: 'Decision Guard',
      status: 'advisory',
      note: 'Independent, advisory checks against remembered decisions. Findings never block approval.',
    },
    {
      label: 'Agent conversations',
      status: modules?.agent_runtime ?? 'partial',
      note: 'Streaming turns, bounded context, and per-turn retrieval evidence.',
    },
    {
      label: 'Agent tools',
      status: modules?.agent_tools ?? 'partial',
      note: 'Reads run automatically; writes wait for explicit approval.',
    },
    {
      label: 'Evaluation harness',
      status: modules?.evaluation ?? 'partial',
      note: 'Baseline comparisons and recorded trial results live outside the app.',
    },
  ];

  return (
    <Panel>
      <SectionTitle
        icon="check"
        title="What is actually working"
        hint="Server-reported module states, plus the surfaces shipped in this build"
      />
      <ul className="mt-3 divide-y divide-line/70">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-3 py-2">
            <span className="mt-0.5">
              <ModuleBadge status={row.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink-dim">{row.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{row.note}</p>
            </div>
            <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-muted">{row.status}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ModuleBadge({ status }: { status: string }) {
  if (status === 'complete' || status === 'available') {
    return (
      <span className="flex size-4 items-center justify-center rounded-full bg-ok/15 text-ok">
        <Icon name="check" className="size-2.5" />
      </span>
    );
  }
  if (status === 'partial' || status === 'schema_only' || status === 'advisory') {
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
