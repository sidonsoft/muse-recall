import type { ForgeApprovalVerification, ForgeDiff, ForgeJob, ForgeState } from '@mml/shared';
import { useState } from 'react';
import { formatBytes, formatDateTime, shortSha } from '../../lib/format.ts';
import { DecisionGuardPanel } from '../forge/DecisionGuardAdvisory.tsx';
import { Icon } from '../Icon.tsx';

/**
 * The review rail.
 *
 * Generation and review are deliberately separate: a staged diff can be read,
 * rejected, or approved, but nothing is current until the human acts. The
 * Decision Guard is advisory, so it is shown with the evidence — never as a
 * gate around the action.
 */
export function ReviewPanel({
  state,
  diff,
  job,
  projectDecisionCount,
  busy,
  previewError,
  captureMemory,
  onCaptureMemory,
  decision,
  onDecision,
  onApprove,
  onReject,
  onRollback,
  onOpenSource,
}: {
  state: ForgeState | null;
  diff: ForgeDiff | null;
  job: ForgeJob | null;
  /** null while project memory is loading; 0 means no stored decisions. */
  projectDecisionCount: number | null;
  busy: boolean;
  previewError: string | null;
  captureMemory: boolean;
  onCaptureMemory: (value: boolean) => void;
  decision: string;
  onDecision: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRollback: () => void;
  onOpenSource: () => void;
}) {
  const currentVersion = state?.current_version ?? 0;
  // Version numbers are monotonic, not `current + 1`: a rollback can move the
  // pointer backwards while newer versions remain in history.
  const nextVersion = Math.max(0, ...(state?.versions ?? []).map((entry) => entry.version)) + 1;
  const proposed = diff ? nextVersion : null;
  const validation = diff?.validation ?? null;
  const change = changeScale(diff);
  const approvalBlocked = Boolean(
    busy ||
      !validation?.ok ||
      previewError !== null ||
      (captureMemory && decision.trim().length === 0),
  );
  const blockedReason = previewError
    ? 'Approve is disabled while the preview reports a runtime error.'
    : validation && !validation.ok
      ? 'Approve is disabled because the syntax/structure checks failed.'
      : captureMemory && decision.trim().length === 0
        ? 'Write the decision you want to remember before approving.'
        : null;

  return (
    <section aria-label="Review" className="panel flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="check" className="size-3.5 text-accent" />
          Review
        </h2>
        {diff ? (
          <span className="chip border-warn/35 bg-warn/10 text-warn">staged v{proposed}</span>
        ) : (
          <span className="chip">
            {currentVersion > 0 ? `v${currentVersion} current` : 'empty'}
          </span>
        )}
      </div>

      {diff ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[12.5px] font-medium text-ink">
                  {currentVersion > 0 ? `Proposed v${proposed}` : 'First version'}
                </p>
                <span
                  className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                    validation?.ok ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err'
                  }`}
                >
                  <Icon name={validation?.ok ? 'check' : 'alert'} className="size-3" />
                  {validation?.ok ? 'Syntax/structure passed' : 'Syntax/structure failed'}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{diff.summary}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                These are automated syntax, structure and load checks. They do not prove gameplay or
                design correctness; reading the diff and playing the preview is still your review.
              </p>

              {change.large ? (
                <div className="mt-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2">
                  <p className="text-[10.5px] font-medium text-warn">Large rewrite</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
                    {change.added} added and {change.removed} removed lines. Most of the application
                    changed, so read the staged source before approving.
                  </p>
                </div>
              ) : null}

              {validation && validation.issues.length > 0 ? (
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-err">
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={onOpenSource}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink-dim"
              >
                Inspect staged source <Icon name="chevronRight" className="size-3" />
              </button>
            </div>

            <DecisionGuardPanel
              advisory={diff.decision_guard}
              projectDecisionCount={projectDecisionCount}
            />
            <Provenance job={job} />
            <VersionHistory state={state} busy={busy} onRollback={onRollback} />
          </div>

          <div className="shrink-0 space-y-2 border-t border-line bg-surface p-3">
            <label className="flex items-center gap-2 text-[11.5px] text-ink-dim">
              <input
                type="checkbox"
                checked={captureMemory}
                onChange={(event) => onCaptureMemory(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Remember this decision
              <span
                className="text-[10px] text-muted"
                title="Saves your note as a project decision. The model's summary is never promoted automatically."
              >
                (optional)
              </span>
            </label>
            {captureMemory ? (
              <div>
                <label htmlFor="studio-decision" className="sr-only">
                  Decision note
                </label>
                <input
                  id="studio-decision"
                  value={decision}
                  onChange={(event) => onDecision(event.target.value)}
                  placeholder="Decision (required), e.g. Keep the ocean palette"
                  maxLength={500}
                  aria-label="Decision note"
                  className="field"
                />
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onApprove}
                disabled={approvalBlocked}
                className="btn btn-ok flex-1"
                title={blockedReason ?? 'Promote the staged file to the current version'}
              >
                <Icon name="check" className="size-3.5" />
                {busy
                  ? 'Working…'
                  : currentVersion > 0
                    ? `Approve & publish v${proposed}`
                    : 'Approve v1'}
              </button>
              <button type="button" onClick={onReject} disabled={busy} className="btn">
                Reject
              </button>
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted">
              {blockedReason ??
                (currentVersion > 0
                  ? `v${currentVersion} stays recoverable after approval.`
                  : 'Approval publishes the first version of this project.')}
            </p>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center">
            <Icon name="check" className="mx-auto size-4 text-muted" />
            <p className="mt-1.5 text-[12px] font-medium text-ink">No staged change</p>
            <p className="mx-auto mt-1 max-w-[250px] text-[11px] leading-relaxed text-muted">
              {currentVersion > 0
                ? `v${currentVersion} is the approved application. A generated change waits here for your decision.`
                : 'Ask Studio generation for a first version. It will wait here until you approve it.'}
            </p>
          </div>

          <DecisionGuardPanel advisory={null} projectDecisionCount={projectDecisionCount} />

          {job ? <Provenance job={job} /> : null}
          <VersionHistory state={state} busy={busy} onRollback={onRollback} />
        </div>
      )}
    </section>
  );
}

function changeScale(diff: ForgeDiff | null): { added: number; removed: number; large: boolean } {
  const file = diff?.files[0];
  if (!diff || !file) return { added: 0, removed: 0, large: false };
  const lines = file.diff.split('\n');
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  const total = Math.max(file.before.split('\n').length, file.after.split('\n').length, 1);
  return { added, removed, large: added > total * 0.5 || removed > total * 0.5 };
}

function Provenance({ job }: { job: ForgeJob | null }) {
  if (!job) return null;
  return (
    <details className="rounded-lg border border-line bg-surface-2/30 px-3 py-2 text-[11px]">
      <summary className="cursor-pointer select-none text-muted hover:text-ink-dim">
        Provenance
      </summary>
      <dl className="mt-1.5 space-y-1 text-[10.5px]">
        <Row label="job" value={job.id.slice(0, 13)} mono />
        <Row label="base" value={job.base_version ? `v${job.base_version}` : 'none'} />
        <Row label="memories" value={`${job.memory_ids.length} supplied`} />
        <Row
          label="syntax/structure"
          value={job.validation ? (job.validation.ok ? 'passed' : 'failed') : 'pending'}
        />
        {job.usage ? (
          <>
            <Row label="calls" value={String(job.usage.calls)} />
            <Row
              label="tokens"
              value={`${job.usage.input_tokens.toLocaleString()} in / ${job.usage.output_tokens.toLocaleString()} out`}
            />
            <Row label="runtime" value={`${(job.usage.runtime_ms / 1000).toFixed(1)}s`} />
          </>
        ) : null}
        {job.prompt_sha256 ? (
          <Row label="prompt" value={shortSha(job.prompt_sha256, 10)} mono />
        ) : null}
      </dl>
      {job.logs.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10.5px] text-muted hover:text-ink-dim">
            Job log ({job.logs.length})
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-base/70 p-2 font-mono text-[10px] leading-relaxed text-muted">
            {job.logs.join('\n')}
          </pre>
        </details>
      ) : null}
      <p className="mt-1 text-[10px] leading-relaxed text-muted">
        Token counts are observational; only wall-clock time and model calls are hard budgets.
      </p>
    </details>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`truncate text-right text-ink-dim ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * The version a rollback will restore.
 *
 * Mirrors the server's recorded-ancestry rule: the current version's
 * `base_version` wins when it names an older version that still exists;
 * otherwise the immediately preceding version is used. Array adjacency is not
 * ancestry, so the UI must not label rollback as `current - 1` blindly.
 */
function rollbackTarget(state: ForgeState | null) {
  if (!state || state.current_version === null) return null;
  const current = state.versions.find((entry) => entry.version === state.current_version);
  if (!current) return null;
  const recorded =
    current.base_version !== null && current.base_version !== undefined
      ? state.versions.find(
          (entry) => entry.version === current.base_version && entry.version < current.version,
        )
      : undefined;
  if (recorded) return recorded;
  return (
    state.versions
      .filter((entry) => entry.version < current.version)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export function VersionHistory({
  state,
  busy,
  onRollback,
  className = '',
}: {
  state: ForgeState | null;
  busy: boolean;
  onRollback: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const versions = [...(state?.versions ?? [])].sort((a, b) => b.version - a.version);
  const current = state?.current_version ?? null;
  const target = rollbackTarget(state);

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
          <Icon name="history" className="size-3.5" />
          Version history
        </h3>
        {state?.can_rollback ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || confirming}
            className="ml-auto text-[10.5px] text-muted underline-offset-2 hover:text-ink-dim hover:underline disabled:opacity-40"
          >
            Undo last change
          </button>
        ) : null}
      </div>

      {confirming && target ? (
        <div className="mt-2 rounded-lg border border-warn/35 bg-warn/5 p-2.5">
          <p className="text-[11px] font-medium text-warn">
            Restore v{target.version} as the current version?
          </p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
            v{current} stays in the list as an auditable version. The restore itself cannot be
            undone from this screen.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRollback();
              }}
              disabled={busy}
              className="btn btn-sm"
            >
              Restore v{target.version}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn btn-sm btn-quiet"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {versions.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-2.5 py-3 text-[11px] text-muted">
          No approved version yet.
        </p>
      ) : (
        <ol className="mt-1.5 space-y-1.5">
          {versions.map((version) => {
            const isCurrent = version.version === current;
            return (
              <li
                key={version.version}
                className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
                  isCurrent ? 'border-accent/30 bg-accent/5' : 'border-line bg-surface-2/40'
                }`}
              >
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10.5px] ${
                    isCurrent ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'
                  }`}
                >
                  v{version.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-snug text-ink-dim">
                    {displayVersionSummary(version.summary)}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">
                    {formatDateTime(version.created_at)}
                    {version.sha256 ? ` · ${shortSha(version.sha256, 7)}` : ''}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer select-none text-[10px] text-muted hover:text-ink-dim">
                      Approval checks
                    </summary>
                    <ApprovalChecks verification={version.approval_verification} />
                  </details>
                </div>
                {isCurrent ? (
                  <span className="chip border-accent/30 text-accent">current</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {state?.can_rollback && target ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          Undo restores v{target.version} (the recorded parent) and keeps the list for audit.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Historical versions may contain generic model text such as
 * "Application updated." Display a neutral fallback without rewriting the
 * immutable version record.
 */
function displayVersionSummary(summary: string): string {
  const normalized = summary.trim();
  if (
    normalized.length === 0 ||
    /^(?:application|game|app) updated\.?$/i.test(normalized) ||
    /^(?:app )?(?:generated|modified)\.?$/i.test(normalized) ||
    /^copied\.?$/i.test(normalized)
  ) {
    return 'Version recorded without a descriptive summary.';
  }
  return summary;
}

/**
 * Approval-time checks recorded with a version.
 *
 * Missing fields are rendered as "not recorded" — never as passed — so an old
 * version cannot inherit a verification claim it never had.
 */
function ApprovalChecks({ verification }: { verification: ForgeApprovalVerification | undefined }) {
  const runtime = verification?.runtime;
  const syntax = verification?.syntax_structure;
  const selection = runtime?.browser_selection;
  const rows: Array<[string, string]> = [
    ['Syntax/structure', syntax ? (syntax.ok ? 'passed' : 'failed') : 'not recorded'],
    ['Runtime load check', runtime ? (runtime.ok ? 'passed' : 'failed') : 'not recorded'],
    [
      'Checked artifact',
      runtime?.artifact_sha256 ? `sha ${shortSha(runtime.artifact_sha256, 12)}` : 'not recorded',
    ],
    ['Checked at', runtime ? formatDateTime(runtime.checked_at) : 'not recorded'],
    ['Browser', runtime?.browser ?? 'not recorded'],
    ['Browser policy', selection?.policy ?? 'not recorded'],
    ['Browser attempted', selection?.attempted ?? 'not recorded'],
    ['Browser selected', selection ? (selection.selected ?? 'none') : 'not recorded'],
    ['Launch failure', selection ? (selection.failure ?? 'none') : 'not recorded'],
  ];

  return (
    <div
      className="mt-1 rounded border border-line bg-surface-2/50 px-2 py-1.5"
      data-testid="approval-checks"
    >
      {verification ? null : (
        <p className="mb-1 text-[10px] text-warn">
          Approval verification was not recorded for this version.
        </p>
      )}
      <dl className="space-y-0.5 text-[10px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3" data-check={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="truncate text-right font-mono text-ink-dim" data-check-value={label}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {runtime && runtime.errors.length > 0 ? (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] text-err">
          {runtime.errors.map((error, index) => (
            <li key={`${String(index)}:${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
        This is a load-time browser check only. Interactions, gameplay and design are not
        automatically verified; human review remains separate.
      </p>
    </div>
  );
}

/** Compact metadata line for the studio footer. */
export function ArtifactFooter({
  artifact,
  model,
  offline,
}: {
  artifact: {
    lines: number;
    bytes: number;
    sha256: string;
    staged: boolean;
    version: number | null;
  } | null;
  model: string | null;
  offline: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-[10.5px] text-muted">
      <span>
        {artifact
          ? `${artifact.lines} lines · ${formatBytes(artifact.bytes)}`
          : 'No artifact loaded'}
      </span>
      <span className="text-line-bright" aria-hidden="true">
        |
      </span>
      <span className="font-mono">sha {shortSha(artifact?.sha256, 10)}</span>
      <span
        className="ml-auto inline-flex items-center gap-1.5"
        title="Configured HTML Studio generation identity. Execution identity is not independently recorded."
      >
        <Icon name="spark" className="size-3 text-accent" />
        <span className={offline ? 'text-warn' : 'text-ink-dim'}>
          {offline ? 'Studio generation · echo (offline)' : 'Studio generation'}
        </span>
        {model ? (
          <span className="font-mono">{model} (configured)</span>
        ) : (
          <span>CLI default (configured)</span>
        )}
      </span>
    </div>
  );
}
