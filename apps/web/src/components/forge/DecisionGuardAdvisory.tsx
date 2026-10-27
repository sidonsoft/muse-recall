import type {
  DecisionGuardAdvisory,
  DecisionGuardAssessment,
  DecisionGuardFinding,
  DecisionGuardUnverified,
} from '@mml/shared';
import { Icon } from '../Icon.tsx';

/**
 * Decision Guard — Advisory.
 *
 * Presentational only. It never renders an approval control and never receives
 * `validation`; the server records the advisory separately so no UI state can
 * turn a finding into a blocking error.
 *
 * Every field from the advisory is untrusted (it may quote generated source),
 * so it is rendered as a text child. There is deliberately no
 * `dangerouslySetInnerHTML` in this file: React escapes the evidence excerpt.
 *
 * Phase 12E: the panel reports an explicit assessment. A passing supported
 * check is shown as "no violation detected by supported checks", never as a
 * compliance certificate, and never with a green PASS badge.
 */

const SUPPORTED_CHECKS =
  'countdown mechanics, flashing effects, mistake penalties, superseded palette, colour-only cues';

function assessmentLabel(assessment: DecisionGuardAssessment | undefined | null): string {
  switch (assessment) {
    case 'violation_detected':
      return 'VIOLATION DETECTED';
    case 'no_violation_detected':
      return 'NO VIOLATION DETECTED · SUPPORTED CHECKS';
    case 'not_verified':
      return 'NOT VERIFIED';
    case 'evaluation_unavailable':
      return 'EVALUATION UNAVAILABLE';
    default:
      return 'NOT VERIFIED';
  }
}

function assessmentTone(advisory: DecisionGuardAdvisory | null): string {
  if (!advisory) return 'bg-surface-2 text-muted';
  switch (advisory.assessment) {
    case 'violation_detected':
      return 'bg-warn/10 text-warn';
    case 'evaluation_unavailable':
      return 'bg-warn/10 text-warn';
    case 'no_violation_detected':
      // Deliberately neutral: this is not a green compliance claim.
      return 'bg-surface text-ink-dim';
    default:
      return 'bg-surface-2 text-ink-dim';
  }
}

function shortId(id: string | null): string {
  if (!id) return 'decision set';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function FindingRow({ finding }: { finding: DecisionGuardFinding }) {
  return (
    <li className="rounded-md border border-warn/30 bg-warn/5 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
        <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-warn">{finding.rule}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-ink-dim">
          severity: {finding.severity}
        </span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 uppercase tracking-wide text-warn">
          detected violation
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
        <span className="text-muted">Decision </span>
        <code className="break-all font-mono text-[9px] text-ink-dim">{finding.decision_id}</code>
        <span className="text-muted"> — </span>
        {finding.decision_ref}
      </p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-ink">{finding.explanation}</p>
      <p className="mt-1 text-[9px] uppercase tracking-wide text-muted">Evidence excerpt</p>
      <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-1.5 font-mono text-[9px] leading-relaxed text-ink-dim">
        {finding.evidence}
      </pre>
    </li>
  );
}

function UnverifiedRow({ entry }: { entry: DecisionGuardUnverified }) {
  return (
    <li className="rounded-md border border-line bg-surface-2 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink-dim">
          {entry.rule}
        </span>
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-muted">severity: —</span>
        <span className="rounded bg-surface px-1.5 py-0.5 uppercase tracking-wide text-muted">
          constraint not verified
        </span>
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-muted">{entry.code}</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
        <span className="text-muted">Decision </span>
        <code className="break-all font-mono text-[9px] text-ink-dim">
          {shortId(entry.decision_id)}
        </code>
        <span className="text-muted"> — </span>
        {entry.decision_ref || 'decision guard'}
      </p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{entry.reason}</p>
    </li>
  );
}

export function DecisionGuardPanel({ advisory }: { advisory: DecisionGuardAdvisory | null }) {
  const findings = advisory?.findings ?? [];
  const unverified = advisory?.unverified ?? [];

  return (
    <section
      aria-label="Decision Guard advisory"
      data-testid="decision-guard"
      className="mt-2 rounded-lg border border-line bg-surface-2/60 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
          <Icon name="alert" className="size-3.5 text-warn" /> Decision Guard — Advisory
        </h4>
        <span
          className={`ml-auto rounded px-1.5 py-0.5 text-[9px] ${assessmentTone(advisory)}`}
          data-testid="decision-guard-assessment"
        >
          {advisory ? assessmentLabel(advisory.assessment) : 'NOT EVALUATED'}
        </span>
      </div>
      <p className="mt-1 text-[10px] font-medium text-ink-dim">
        Findings do not block approval in this version.
      </p>
      <p className="mt-1 text-[9px] leading-relaxed text-muted" data-testid="decision-guard-scope">
        Supported checks only: {SUPPORTED_CHECKS}. A passing supported check is not a compliance
        certification, and constraints outside these checks are not verified.
      </p>

      {advisory ? (
        <>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
            {advisory.assessment_reason}
          </p>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-muted">
            engine {advisory.engine_version} · source{' '}
            {advisory.source_sha256 ? advisory.source_sha256.slice(0, 12) : 'unknown'} ·{' '}
            {advisory.runtime_verified
              ? 'after runtime verification'
              : 'pre-runtime review snapshot'}{' '}
            · {advisory.evaluated_memory_ids.length} active decision
            {advisory.evaluated_memory_ids.length === 1 ? '' : 's'} · {findings.length} finding
            {findings.length === 1 ? '' : 's'} · {unverified.length} unverified
          </p>

          {findings.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5" data-testid="decision-guard-findings">
              {findings.map((finding, index) => (
                <FindingRow
                  key={`${finding.decision_id}:${finding.rule}:${String(index)}`}
                  finding={finding}
                />
              ))}
            </ul>
          ) : null}

          {unverified.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5" data-testid="decision-guard-unverified">
              {unverified.map((entry, index) => (
                <UnverifiedRow
                  key={`${entry.code}:${entry.decision_id ?? 'set'}:${String(index)}`}
                  entry={entry}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-[10px] text-muted">
          No advisory snapshot was recorded for this change, so compliance was not checked.
        </p>
      )}
    </section>
  );
}
