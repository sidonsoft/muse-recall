/**
 * Batch E — decision references and old/new memory comparison.
 *
 * A Forge job records which decisions it was given. This module turns that
 * stored reference into an auditable comparison against what the memory store
 * holds now, and labels each past generation with one of exactly two honest
 * stale-guidement labels:
 *
 * - `received_previous_decision` — the record proves the generation was given
 *   text that is no longer current (revised in place, superseded, or withdrawn).
 * - `potentially_affected` — the generation could not have received decisions
 *   that were created after it ran, or no reference was stored for it, so the
 *   relationship is unknown rather than proven.
 *
 * Neither label claims causal influence. That disclaimer travels with the data
 * (`limits`) so no surface can render the label without it.
 */
import { createHash } from 'node:crypto';
import type {
  ForgeDecisionDrift,
  ForgeDecisionReference,
  ForgeGeneration,
  ForgeGenerationComparison,
  ForgeGenerationList,
  ForgeJob,
  ForgeState,
  Memory,
  RetrievedMemory,
} from '@mml/shared';
import { redactSecrets } from '@mml/shared';

export const GENERATION_COMPARISON_LIMITS: readonly string[] = [
  'Labels describe which decisions a generation was given; they are not evidence that the model followed, was guided by, or was caused by any decision.',
  'A decision corrected after a generation ran does not change that generation — only a new job can use current guidance.',
];

const EXCERPT_LIMIT = 200;

export function decisionContentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const REDACTION_MARKER = /\[REDACTED(?::[^\]]*)?\]/g;

/**
 * One-line, whitespace-collapsed prefix used for side-by-side inspection.
 *
 * A decision is user text, so it can carry a credential the user pasted in.
 * The redaction the Decision Guard applies to `decision_ref` runs here before
 * truncation, so neither a full nor a truncated excerpt can echo a secret back
 * through the generations listing. The content hash stays over the raw text: a
 * digest does not reveal a credential, and it is what makes an in-place edit
 * detectable.
 */
export function decisionExcerpt(content: string, limit = EXCERPT_LIMIT): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return '(empty decision)';
  const redacted = redactSecrets(collapsed);
  if (redacted.length <= limit) return redacted;
  // Never cut through a redaction marker: back off to before the whole marker.
  let cut = limit - 1;
  for (const match of redacted.matchAll(REDACTION_MARKER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < cut && end > cut) {
      cut = start;
      break;
    }
  }
  return `${redacted.slice(0, Math.max(0, cut)).trimEnd()}…`;
}

/** Snapshot the exact decision content a generation is about to receive. */
export function decisionReference(memory: Memory, userSelected = false): ForgeDecisionReference {
  return {
    memory_id: memory.id,
    revision: memory.revision,
    content_sha256: decisionContentSha256(memory.content),
    excerpt: decisionExcerpt(memory.content),
    type: memory.type,
    user_selected: userSelected,
  };
}

/**
 * A user-selected decision, injected into the prompt alongside retrieval
 * results. `pinned: true` with an explicit evidence string, so the memory
 * inspector shows why it was in context instead of implying it ranked.
 */
export function pinnedRetrieved(memory: Memory): RetrievedMemory {
  return {
    memory,
    injected_content: memory.content,
    truncated: false,
    pinned: true,
    score: 1,
    rank_components: {
      relevance: 1,
      scope: 1,
      confidence: 1,
      validation: 1,
      recency: 1,
      type_priority: 1,
    },
    evidence: 'selected by the user for this change',
  };
}

export interface ComparisonContext {
  /** The stored reference, or null when the generation predates references. */
  reference: ForgeDecisionReference[] | null;
  /** Current record for an id, or null when it is gone. */
  currentOf(memoryId: string): Memory | null;
  /** Decisions active for the project right now. */
  activeDecisions: Memory[];
}

/** Compare one generation's stored guidance with the current decision set. */
export function compareGeneration(context: ComparisonContext): ForgeGenerationComparison {
  const base = {
    limits: [...GENERATION_COMPARISON_LIMITS],
    drift: [] as ForgeDecisionDrift[],
    added_since: [] as ForgeDecisionReference[],
    unchanged: [] as ForgeDecisionReference[],
  };

  if (context.reference === null) {
    return {
      ...base,
      label: 'potentially_affected',
      reason:
        'No stored decision reference for this generation: the record predates decision references, so which revision each decision had is unknown. Treat any relationship to current guidance as unknown.',
    };
  }

  const suppliedIds = new Set(context.reference.map((entry) => entry.memory_id));
  const drift: ForgeDecisionDrift[] = [];
  const unchanged: ForgeDecisionReference[] = [];
  for (const entry of context.reference) {
    const current = context.currentOf(entry.memory_id);
    if (current === null) {
      drift.push({
        memory_id: entry.memory_id,
        supplied_revision: entry.revision,
        supplied_excerpt: entry.excerpt,
        current_revision: null,
        current_excerpt: null,
        superseded_by: null,
        change: 'withdrawn',
      });
      continue;
    }
    if (current.superseded_by !== null) {
      const successor = context.currentOf(current.superseded_by);
      drift.push({
        memory_id: entry.memory_id,
        supplied_revision: entry.revision,
        supplied_excerpt: entry.excerpt,
        current_revision: current.revision,
        current_excerpt: successor === null ? null : decisionExcerpt(successor.content),
        superseded_by: current.superseded_by,
        change: 'superseded',
      });
      continue;
    }
    const sameContent = decisionContentSha256(current.content) === entry.content_sha256;
    if (!sameContent || current.revision !== entry.revision) {
      drift.push({
        memory_id: entry.memory_id,
        supplied_revision: entry.revision,
        supplied_excerpt: entry.excerpt,
        current_revision: current.revision,
        current_excerpt: decisionExcerpt(current.content),
        superseded_by: current.superseded_by,
        change: 'revised_in_place',
      });
      continue;
    }
    unchanged.push(entry);
  }

  const addedSince = context.activeDecisions
    .filter((memory) => !suppliedIds.has(memory.id))
    .map((memory) => decisionReference(memory, false));

  if (drift.length > 0) {
    return {
      ...base,
      drift,
      unchanged,
      added_since: addedSince,
      label: 'received_previous_decision',
      reason:
        `This generation was given ${String(drift.length)} decision${drift.length === 1 ? '' : 's'} whose stored text has since changed (revised, superseded, or withdrawn). ` +
        'The comparison below shows the wording it received next to the current wording.',
    };
  }
  if (addedSince.length > 0) {
    return {
      ...base,
      unchanged,
      added_since: addedSince,
      label: 'potentially_affected',
      reason: `Every decision this generation received is still current, but ${String(addedSince.length)} decision${addedSince.length === 1 ? '' : 's'} active now did not exist when it ran, so it could not have received them. That is a coverage gap, not a proven influence.`,
    };
  }
  return {
    ...base,
    unchanged,
    label: 'matched_current_decision',
    reason:
      'Every decision reference stored for this generation still matches the current record, and no project decision has been added since. This says nothing about whether the generation followed them.',
  };
}

/** Active, project-scoped decisions (the set a new job is expected to use). */
export function isActiveProjectDecision(memory: Memory, projectId: string): boolean {
  return (
    (memory.project_id === projectId || memory.project_id === null) &&
    memory.status === 'active' &&
    memory.superseded_by === null
  );
}

/**
 * Prior generations, newest first, each with the memory reference it was
 * created with and the honest old/new comparison. Versions are the durable
 * record; the job record supplies the reference and status.
 */
export function buildGenerationList(input: {
  projectId: string;
  state: ForgeState;
  jobs: ForgeJob[];
  activeDecisions: Memory[];
  currentOf(memoryId: string): Memory | null;
  limit?: number;
}): ForgeGenerationList {
  const limit = Math.max(1, Math.min(64, input.limit ?? 64));
  const byId = new Map(input.jobs.map((job) => [job.id, job]));
  const ordered = [...input.state.versions].sort((a, b) => b.version - a.version);
  const items: ForgeGeneration[] = ordered.slice(0, limit).map((version) => {
    const job =
      version.job_id === undefined || version.job_id === null
        ? undefined
        : byId.get(version.job_id);
    const reference = job?.memory_reference ?? null;
    return {
      version: version.version,
      created_at: version.created_at,
      summary: version.summary,
      base_version: version.base_version ?? null,
      job_id: version.job_id ?? null,
      job_status: job?.status ?? null,
      job_kind: job?.kind ?? null,
      memory_reference: reference,
      comparison: compareGeneration({
        reference,
        currentOf: input.currentOf,
        activeDecisions: input.activeDecisions,
      }),
    };
  });
  return {
    project_id: input.projectId,
    current_version: input.state.current_version,
    items,
    truncated: ordered.length > items.length,
  };
}
