import { createHash } from 'node:crypto';
import {
  evaluateDecisions,
  GUARD_VERSION,
  type GuardDecision,
  type GuardResult,
} from '@mml/decision-guard';
import {
  type DecisionGuardAdvisory,
  DecisionGuardAdvisorySchema,
  type DecisionGuardFinding,
  type DecisionGuardUnverified,
  type DecisionGuardUnverifiedCode,
  type Memory,
} from '@mml/shared';

/**
 * Phase 12C — Decision Guard advisory adapter.
 *
 * The pure engine (`@mml/decision-guard`) receives only plain data. This module
 * is the production boundary that:
 *
 * 1. resolves the job's *recorded* memory ids into an auditable decision set
 *    (same project only, active only, superseded history resolved separately),
 * 2. calls the engine on the exact staged source,
 * 3. projects the result into the bounded, advisory-only API contract.
 *
 * It never sets `validation.ok`, never authorises or denies approval, and never
 * throws into the Forge pipeline: an unusable snapshot degrades to an explicit
 * `internal_error` limitation rather than to compliance.
 */

/** Hard bounds on the serialised advisory (see docs/PHASE12C_GUARD_INTEGRATION.md). */
export const MAX_EVALUATED_DECISIONS = 32;
export const MAX_ADVISORY_FINDINGS = 32;
export const MAX_ADVISORY_UNVERIFIED = 32;
export const MAX_ADVISORY_BYTES = 48 * 1024;
const MAX_REFERENCE_CHARS = 160;
const MAX_EVIDENCE_CHARS = 240;
const MAX_EXPLANATION_CHARS = 400;
const MAX_REASON_CHARS = 400;

const NONE_APPLICABLE = 'none-applicable';

/** Replace C0 (except whitespace), DEL and C1 controls with spaces. */
function stripControlCharacters(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const keepsWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    const control = (code < 0x20 && !keepsWhitespace) || (code >= 0x7f && code <= 0x9f);
    out += control ? ' ' : character;
  }
  return out;
}

/** Flatten untrusted text to one bounded, control-free line. */
export function plainText(value: string, limit: number): string {
  const flat = stripControlCharacters(value).replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, Math.max(0, limit - 1))}…`;
}

function toGuardDecision(memory: Memory): GuardDecision {
  return {
    id: memory.id,
    content: memory.content,
    status: memory.status,
    supersedes: [...memory.supersedes],
  };
}

function limitation(
  code: DecisionGuardUnverifiedCode,
  input: {
    decisionId?: string | null;
    decisionRef?: string;
    rule?: string;
    reason: string;
  },
): DecisionGuardUnverified {
  return {
    kind: 'unverified',
    decision_id: input.decisionId ?? null,
    decision_ref: plainText(input.decisionRef ?? 'decision guard', MAX_REFERENCE_CHARS),
    rule: input.rule ?? NONE_APPLICABLE,
    severity: null,
    code,
    reason: plainText(input.reason, MAX_REASON_CHARS) || code,
  };
}

export interface DecisionResolution {
  /** Active, same-project decisions that may act as constraints. */
  active: GuardDecision[];
  /** Superseded decisions resolved separately for correction rules. */
  superseded: GuardDecision[];
  /** Explicit limitations — never silently treated as compliance. */
  unverified: DecisionGuardUnverified[];
  evaluatedMemoryIds: string[];
  supersededMemoryIds: string[];
}

export interface ResolveDecisionInput {
  projectId: string;
  /** The ids recorded on the job when it was created. */
  memoryIds: readonly string[];
  /** Memory lookup, injectable for tests. Must not return cross-project rows. */
  getMemory: (id: string) => Memory | null;
}

function lookup(getMemory: (id: string) => Memory | null, id: string): { memory: Memory | null } {
  try {
    return { memory: getMemory(id) };
  } catch {
    return { memory: null };
  }
}

/**
 * Resolve the job's recorded memory ids into an auditable decision set.
 *
 * Eligibility is deliberately strict: only `scope: 'project'` memories owned by
 * this project and still `active` may constrain the generated source. Deleted,
 * superseded, expired, global, or cross-project records are recorded as
 * limitations instead of being used or dropped silently.
 */
export function resolveDecisionContext(input: ResolveDecisionInput): DecisionResolution {
  const unverified: DecisionGuardUnverified[] = [];
  const active: GuardDecision[] = [];
  const superseded: GuardDecision[] = [];
  const supersededIds: string[] = [];
  const supersededSeen = new Set<string>();
  const nonActive = new Map<string, Memory>();
  const evaluatedIds: string[] = [];

  // Deterministic order: dedupe and sort the recorded ids.
  const ids = [...new Set(input.memoryIds)].sort();

  for (const id of ids) {
    const { memory } = lookup(input.getMemory, id);
    if (!memory) {
      unverified.push(
        limitation('memory_unresolved', {
          decisionId: id,
          decisionRef: `Memory ${id}`,
          reason:
            'referenced memory could not be resolved (missing, deleted, or unavailable); the constraint was not evaluated',
        }),
      );
      continue;
    }
    if (memory.scope === 'global') {
      unverified.push(
        limitation('global_scope', {
          decisionId: id,
          decisionRef: plainText(memory.content, MAX_REFERENCE_CHARS),
          reason:
            'global-scope memory is outside the project-scoped decision set; it was not evaluated',
        }),
      );
      continue;
    }
    if (memory.project_id !== input.projectId) {
      unverified.push(
        limitation('cross_project', {
          decisionId: id,
          decisionRef: `Memory ${id}`,
          reason:
            'memory belongs to a different project; it was excluded to preserve project isolation',
        }),
      );
      continue;
    }
    if (memory.status !== 'active') {
      nonActive.set(id, memory);
      unverified.push(
        limitation('decision_not_active', {
          decisionId: id,
          decisionRef: plainText(memory.content, MAX_REFERENCE_CHARS),
          reason: `referenced decision status is "${memory.status}"; it was not applied as an active constraint`,
        }),
      );
      continue;
    }
    if (active.length >= MAX_EVALUATED_DECISIONS) {
      unverified.push(
        limitation('decision_limit_exceeded', {
          decisionId: id,
          decisionRef: `Memory ${id}`,
          reason: `more than ${MAX_EVALUATED_DECISIONS} active decisions; this one was not evaluated`,
        }),
      );
      continue;
    }
    active.push(toGuardDecision(memory));
    evaluatedIds.push(memory.id);
  }

  // Correction rules need the replaced text. Resolve it separately from the
  // active constraint set, still enforcing same-project ownership.
  for (const decision of active) {
    for (const oldId of decision.supersedes) {
      if (supersededSeen.has(oldId)) continue;
      if (superseded.length >= MAX_EVALUATED_DECISIONS) {
        unverified.push(
          limitation('decision_limit_exceeded', {
            decisionId: oldId,
            decisionRef: `Memory ${oldId}`,
            rule: 'superseded-palette',
            reason: `more than ${MAX_EVALUATED_DECISIONS} superseded decisions; this history was not resolved`,
          }),
        );
        break;
      }
      const cached = nonActive.get(oldId);
      const { memory } = cached ? { memory: cached } : lookup(input.getMemory, oldId);
      if (!memory) {
        unverified.push(
          limitation('superseded_unresolved', {
            decisionId: oldId,
            decisionRef: `Memory ${oldId}`,
            rule: 'superseded-palette',
            reason:
              'superseded decision referenced by an active correction could not be resolved; the replacement rule cannot be checked',
          }),
        );
        supersededSeen.add(oldId);
        continue;
      }
      if (memory.scope !== 'project' || memory.project_id !== input.projectId) {
        unverified.push(
          limitation('cross_project', {
            decisionId: oldId,
            decisionRef: `Memory ${oldId}`,
            rule: 'superseded-palette',
            reason:
              'superseded decision belongs to a different project or scope; its text was not used',
          }),
        );
        supersededSeen.add(oldId);
        continue;
      }
      superseded.push(toGuardDecision(memory));
      supersededIds.push(memory.id);
      supersededSeen.add(oldId);
    }
  }

  const usedAsHistory = new Set(supersededIds);
  return {
    active,
    superseded,
    // A superseded record that is used as the *history* of a correction is not a
    // limitation: it was resolved for exactly the purpose the rule needs.
    unverified: unverified.filter(
      (entry) =>
        !(entry.code === 'decision_not_active' && entry.decision_id !== null) ||
        !usedAsHistory.has(entry.decision_id ?? ''),
    ),
    evaluatedMemoryIds: evaluatedIds,
    supersededMemoryIds: supersededIds,
  };
}

function warningReason(warning: string): { code: DecisionGuardUnverifiedCode; reason: string } {
  if (warning === 'source_oversized') {
    return {
      code: 'input_warning',
      reason: 'generated source exceeds the engine size bound; no rule was evaluated',
    };
  }
  if (warning === 'malformed_input:source_not_string') {
    return {
      code: 'input_warning',
      reason: 'staged source was not readable text; no rule was evaluated',
    };
  }
  if (warning.startsWith('malformed_input')) {
    return {
      code: 'input_warning',
      reason: 'the engine rejected malformed decision input; no compliance is claimed',
    };
  }
  if (warning.startsWith('decision_limit_exceeded')) {
    return {
      code: 'decision_limit_exceeded',
      reason: 'the engine decision bound was reached; decisions beyond it were not evaluated',
    };
  }
  if (warning === 'finding_limit_exceeded') {
    return {
      code: 'truncated',
      reason: 'the engine finding bound was reached; additional findings were dropped',
    };
  }
  return { code: 'input_warning', reason: `engine warning: ${warning}` };
}

/**
 * Enforce the serialised size ceiling without ever hiding that something was
 * dropped. Violations are kept ahead of limitations; a truncation note always
 * survives, because a silently empty advisory would read as compliance.
 */
function boundByBytes(advisory: DecisionGuardAdvisory): DecisionGuardAdvisory {
  const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size(advisory) <= MAX_ADVISORY_BYTES) return advisory;

  const note = limitation('truncated', {
    decisionRef: 'decision guard',
    reason: 'advisory exceeded its serialised size bound; less important entries were omitted',
  });
  const findings = [...advisory.findings];
  const unverified = advisory.unverified.slice(0, MAX_ADVISORY_UNVERIFIED - 1);
  const withNote = (): DecisionGuardAdvisory => ({
    ...advisory,
    findings: [...findings],
    unverified: [...unverified, note],
  });

  while (size(withNote()) > MAX_ADVISORY_BYTES && unverified.length > 0) unverified.pop();
  while (size(withNote()) > MAX_ADVISORY_BYTES && findings.length > 0) findings.pop();
  const bounded = withNote();
  if (size(bounded) <= MAX_ADVISORY_BYTES) return bounded;
  return { ...advisory, findings: [], unverified: [note] };
}

export interface EvaluateAdvisoryInput {
  projectId: string;
  memoryIds: readonly string[];
  source: string;
  getMemory: (id: string) => Memory | null;
  evaluatedAt: Date;
  /** True only when the blocking runtime check passed for this exact source. */
  runtimeVerified: boolean;
}

function degradedAdvisory(
  input: EvaluateAdvisoryInput,
  sourceSha256: string | null,
  engineVersion: string,
  reason: string,
): DecisionGuardAdvisory {
  return {
    mode: 'advisory',
    engine_version: plainText(engineVersion, 32) || 'unknown',
    engine_verdict: 'UNVERIFIED',
    findings: [],
    unverified: [
      limitation('internal_error', {
        decisionRef: 'decision guard',
        reason,
      }),
    ],
    evaluated_memory_ids: [],
    superseded_memory_ids: [],
    source_sha256: sourceSha256,
    runtime_verified: input.runtimeVerified,
    evaluated_at: input.evaluatedAt.toISOString(),
  };
}

/**
 * Evaluate the advisory snapshot for one staged source.
 *
 * Pure with respect to the workspace: the caller passes the exact staged bytes
 * and the job's recorded memory ids. The result is validated and size-bounded,
 * and never affects approval.
 */
export function evaluateDecisionGuardAdvisory(input: EvaluateAdvisoryInput): DecisionGuardAdvisory {
  let sourceSha256: string | null = null;
  try {
    sourceSha256 = createHash('sha256').update(input.source).digest('hex');
  } catch {
    sourceSha256 = null;
  }

  let resolution: DecisionResolution;
  try {
    resolution = resolveDecisionContext(input);
  } catch {
    return degradedAdvisory(
      input,
      sourceSha256,
      GUARD_VERSION,
      'decision provenance could not be resolved; no compliance is claimed',
    );
  }

  let result: GuardResult;
  try {
    result = evaluateDecisions(resolution.active, input.source, {
      supersededDecisions: resolution.superseded,
    });
  } catch {
    return degradedAdvisory(
      input,
      sourceSha256,
      GUARD_VERSION,
      'decision engine evaluation failed; no compliance is claimed',
    );
  }

  const decisionById = new Map(resolution.active.map((decision) => [decision.id, decision]));
  const decisionRef = (decisionId: string): string => {
    const decision = decisionById.get(decisionId);
    return decision ? plainText(decision.content, MAX_REFERENCE_CHARS) : `Memory ${decisionId}`;
  };

  const findings: DecisionGuardFinding[] = [];
  let truncated = false;
  for (const finding of result.findings) {
    // Defence in depth: only a decision this call actually resolved may be
    // cited. Anything else is an engine/caller contract violation.
    if (!decisionById.has(finding.decision_id)) {
      truncated = true;
      continue;
    }
    if (findings.length >= MAX_ADVISORY_FINDINGS) {
      truncated = true;
      break;
    }
    findings.push({
      kind: 'violation',
      decision_id: finding.decision_id,
      decision_ref: decisionRef(finding.decision_id),
      rule: finding.rule,
      severity: finding.severity,
      evidence: plainText(finding.evidence, MAX_EVIDENCE_CHARS),
      explanation: plainText(finding.explanation, MAX_EXPLANATION_CHARS),
    });
  }

  const unverified: DecisionGuardUnverified[] = [...resolution.unverified];

  for (const excludedId of result.excluded_decision_ids) {
    unverified.push(
      limitation('decision_not_active', {
        decisionId: excludedId,
        decisionRef: decisionRef(excludedId),
        reason: 'the engine excluded this decision because it is not active',
      }),
    );
  }

  for (const evaluation of result.evaluations) {
    if (evaluation.verdict !== 'UNVERIFIED') continue;
    unverified.push(
      limitation(evaluation.rule === NONE_APPLICABLE ? 'unsupported_decision' : 'rule_unverified', {
        decisionId: evaluation.decision_id,
        decisionRef: decisionRef(evaluation.decision_id),
        rule: evaluation.rule,
        reason: evaluation.reason,
      }),
    );
  }

  for (const warning of result.input_warnings) {
    const mapped = warningReason(warning);
    unverified.push(
      limitation(mapped.code, {
        decisionRef: 'decision set',
        reason: mapped.reason,
      }),
    );
  }

  if (input.memoryIds.length === 0) {
    unverified.push(
      limitation('no_decisions', {
        decisionRef: 'decision set',
        reason:
          'no project memories were recorded for this job; no decision was verified and no compliance is claimed',
      }),
    );
  }

  let boundedUnverified = unverified;
  if (boundedUnverified.length > MAX_ADVISORY_UNVERIFIED) {
    boundedUnverified = boundedUnverified.slice(0, MAX_ADVISORY_UNVERIFIED);
    truncated = true;
  }
  if (truncated) {
    // Always keep the truncation note visible: silence would read as compliance.
    boundedUnverified = [
      ...boundedUnverified.slice(0, MAX_ADVISORY_UNVERIFIED - 1),
      limitation('truncated', {
        decisionRef: 'decision guard',
        reason: 'advisory output reached its reporting bound; some entries were not shown',
      }),
    ];
  }

  const candidate: DecisionGuardAdvisory = {
    mode: 'advisory',
    engine_version: result.engine_version,
    engine_verdict: result.verdict,
    findings,
    unverified: boundedUnverified,
    evaluated_memory_ids: resolution.evaluatedMemoryIds.slice(0, MAX_EVALUATED_DECISIONS),
    superseded_memory_ids: resolution.supersededMemoryIds.slice(0, MAX_EVALUATED_DECISIONS),
    source_sha256: sourceSha256,
    runtime_verified: input.runtimeVerified,
    evaluated_at: input.evaluatedAt.toISOString(),
  };

  const parsed = DecisionGuardAdvisorySchema.safeParse(candidate);
  if (!parsed.success) {
    return degradedAdvisory(
      input,
      sourceSha256,
      result.engine_version,
      'advisory snapshot failed contract validation; no compliance is claimed',
    );
  }
  return boundByBytes(parsed.data);
}
