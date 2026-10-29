import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_RETRIEVAL_BUDGET,
  DEFAULT_RETRIEVAL_WEIGHTS,
  type Memory,
  type MemoryType,
  type RankComponents,
  type RetrievalBudget,
  RetrievalBudgetSchema,
  type RetrievalExclusions,
  type RetrievalMetadata,
  type RetrievalRequest,
  RetrievalRequestSchema,
  type RetrievalResult,
  type RetrievalWeights,
  RetrievalWeightsSchema,
  type RetrievedMemory,
} from '@mml/shared';
import { memoryContentHash } from './content-hash.js';
import { renderedMemoryCharacters, renderMemoryLayout } from './context.js';
import { toFtsQuery } from './fts.js';
import { MEMORY_SELECT_COLUMNS, type MemoryRow, rowToMemory } from './rows.js';

/**
 * Retrieval.
 *
 * Three phases, in order:
 *   1. Hard filters in SQL — status, scope, expiry, type. Wrong-scope memories
 *      never enter the ranking at all.
 *   2. Scoring — six independently observable components, so a result can be
 *      explained rather than asserted.
 *   3. Budgeted selection — pinned memory types first, then by score,
 *      stopping at the memory and character caps.
 *
 * The function performs no writes and takes an injectable clock, so it is safe
 * to call from a preview endpoint, a test, or a benchmark.
 */

export interface RetrievalOptions {
  /** Injectable clock for deterministic recency scoring. */
  now?: Date;
  /** Override weights (benchmark sensitivity runs, experiments). */
  weights?: Partial<RetrievalWeights>;
  /**
   * Memory types force-included when active in scope, regardless of keyword
   * match. Defaults to constraints and goals; callers such as Forge may add
   * decision-like types their prompts depend on.
   */
  pinnedTypes?: readonly MemoryType[];
}

/** Upper bound on candidates considered before ranking. */
const MAX_CANDIDATES = 200;

/**
 * When a precise (AND) keyword query yields fewer candidates than this, the
 * query is re-run with OR semantics.
 *
 * Rationale: users ask multi-part questions ("what game, which engine, what
 * platform"), and no single memory contains every word. Requiring all tokens
 * would return nothing, which is a worse failure than a slightly wider
 * candidate set — bm25 still decides the ordering.
 */
const MIN_PRECISE_CANDIDATES = 3;

/**
 * Recency half-life per memory type, in days.
 *
 * A technical decision stays relevant longer than a passing contextual fact; a
 * constraint is effectively permanent. Half-lives are data, not logic, so
 * tuning them never changes retrieval code.
 */
export const RECENCY_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  preference: 180,
  project: 60,
  technical_decision: 30,
  constraint: 365,
  verified_solution: 90,
  failed_approach: 90,
  unfinished_task: 14,
  goal: 180,
  correction: 30,
  contextual_fact: 7,
};

/**
 * Intrinsic importance by type. Constraints and goals lead: violating a
 * constraint costs more than omitting a trivia fact.
 */
export const TYPE_PRIORITY: Record<MemoryType, number> = {
  constraint: 1,
  goal: 0.9,
  technical_decision: 0.8,
  preference: 0.8,
  project: 0.7,
  verified_solution: 0.7,
  unfinished_task: 0.7,
  failed_approach: 0.6,
  correction: 0.6,
  contextual_fact: 0.4,
};

/** Default types force-included when active in scope, regardless of keyword match. */
export const DEFAULT_PINNED_TYPES: readonly MemoryType[] = ['constraint', 'goal'];

/**
 * How many slots are reserved for pinned memories.
 *
 * A pinned decision must not be lost because the user's wording did not match
 * it, but pinning every such memory ahead of relevance would let a project
 * with ten constraints crowd out the memory that actually answers the
 * question. Two reserved slots is the compromise: the guarantee is real, the
 * budget is not consumed by it. Any further pinned memories still compete on
 * score, and the normal count/character checks still apply.
 */
const PINNED_RESERVE = 2;

const VALIDATION_SCORE = { verified: 1, unverified: 0.6, disputed: 0.2 } as const;

const MS_PER_DAY = 86_400_000;

type SqlValue = string | number | null;

interface Candidate {
  memory: Memory;
  bm25: number | null;
}

interface ScoredCandidate extends Candidate {
  pinned: boolean;
  components: RankComponents;
  evidence: string;
  score: number;
}

/**
 * Retrieve memories relevant to a task within a scope and a context budget.
 *
 * Never returns the whole database: candidate generation is bounded, selection
 * is capped by count and characters, and the metadata reports exactly how much
 * was injected and what was left out.
 */
export function retrieveMemories(
  db: DatabaseSync,
  request: RetrievalRequest,
  options: RetrievalOptions = {},
): RetrievalResult {
  const startedAt = performance.now();
  const parsed = RetrievalRequestSchema.parse(request);
  const budget: RetrievalBudget = RetrievalBudgetSchema.parse({
    ...DEFAULT_RETRIEVAL_BUDGET,
    ...(parsed.budget ?? {}),
  });
  const requestedWeights: RetrievalWeights = RetrievalWeightsSchema.parse({
    ...DEFAULT_RETRIEVAL_WEIGHTS,
    ...(parsed.weights ?? {}),
    ...(options.weights ?? {}),
  });
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const pinnedTypes = options.pinnedTypes ?? DEFAULT_PINNED_TYPES;
  const pinnedTypeSet = new Set(pinnedTypes);
  const preciseQuery = parsed.query.trim().length > 0 ? toFtsQuery(parsed.query, 'and') : null;
  const broadQuery = parsed.query.trim().length > 0 ? toFtsQuery(parsed.query, 'or') : null;
  const hasQuery = preciseQuery !== null;

  // Without search text, relevance is undefined, so its weight is dropped and
  // the remaining weights renormalise. Scores stay comparable across modes.
  const weights = hasQuery ? requestedWeights : withoutRelevance(requestedWeights);

  const exclusions: RetrievalExclusions = { count_budget: 0, character_budget: 0, duplicate: 0 };

  // Progressive relaxation: precise first, broad only when precision starves
  // the candidate set. The chosen strategy is reported in the metadata so the
  // inspector can explain a weak match.
  let scopedRows = preciseQuery
    ? loadCandidates(db, {
        projectId: parsed.project_id,
        includeGlobal: parsed.include_global,
        types: parsed.types,
        ftsQuery: preciseQuery,
        nowIso,
      })
    : loadCandidates(db, {
        projectId: parsed.project_id,
        includeGlobal: parsed.include_global,
        types: parsed.types,
        ftsQuery: null,
        nowIso,
      });

  let queryMode: 'precise' | 'relaxed' | 'fallback' | 'none' = preciseQuery ? 'precise' : 'none';
  if (preciseQuery && broadQuery && scopedRows.length < MIN_PRECISE_CANDIDATES) {
    const broadRows = loadCandidates(db, {
      projectId: parsed.project_id,
      includeGlobal: parsed.include_global,
      types: parsed.types,
      ftsQuery: broadQuery,
      nowIso,
    });
    const merged = new Map(scopedRows.map((row) => [row.id, row]));
    for (const row of broadRows) {
      const existing = merged.get(row.id);
      // Keep the better (more negative) bm25 score for rows found by both.
      if (!existing || (row.bm25 ?? 0) < (existing.bm25 ?? 0)) merged.set(row.id, row);
    }
    scopedRows = [...merged.values()];
    queryMode = 'relaxed';
  }

  // Last resort: the question shares no vocabulary with any stored memory
  // ("what platform are we targeting?" after the fact was stored as "desktop
  // browsers"). Returning nothing guarantees a memory-less answer, so fall back
  // to recent active memories in scope and let the evidence say "no keyword
  // match". The budget still bounds what is injected.
  if (preciseQuery && scopedRows.length === 0) {
    scopedRows = loadCandidates(db, {
      projectId: parsed.project_id,
      includeGlobal: parsed.include_global,
      types: parsed.types,
      ftsQuery: null,
      nowIso,
    });
    queryMode = scopedRows.length > 0 ? 'fallback' : 'none';
  }

  // Pinned memories are candidates even when the keyword query misses them.
  const pinnedRows = loadPinned(db, {
    projectId: parsed.project_id,
    includeGlobal: parsed.include_global,
    types: parsed.types,
    nowIso,
    pinnedTypes,
    excludeIds: new Set(scopedRows.map((entry) => entry.id)),
  });

  const candidates: Candidate[] = [
    ...scopedRows.map((entry) => ({ memory: rowToMemory(entry.row), bm25: entry.bm25 })),
    ...pinnedRows.map((row) => ({ memory: rowToMemory(row), bm25: null })),
  ];
  const candidateCount = candidates.length;

  const maxBm25 = candidates.reduce(
    (max, candidate) => (candidate.bm25 === null ? max : Math.max(max, -candidate.bm25)),
    0,
  );

  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const components = scoreComponents(candidate, { now, maxBm25 });
    return {
      ...candidate,
      pinned: pinnedTypeSet.has(candidate.memory.type),
      components,
      evidence: '',
      score: combine(components, weights),
    };
  });

  // Deduplicate by content fingerprint: two records making the same claim must
  // not consume two slots. Highest-scoring copy wins.
  const seenHashes = new Set<string>();
  const unique: ScoredCandidate[] = [];
  for (const candidate of scored) {
    const hash = memoryContentHash(candidate.memory);
    if (seenHashes.has(hash)) {
      exclusions.duplicate += 1;
      continue;
    }
    seenHashes.add(hash);
    candidate.evidence = buildEvidence(candidate, hasQuery);
    unique.push(candidate);
  }

  // Reserve a couple of slots for pinned memories, then fill the rest by
  // score. Reserved entries are still selected through the same budget checks.
  unique.sort(compareScored);
  const pinnedSorted = unique.filter((candidate) => candidate.pinned);
  const reserved = pinnedSorted.slice(0, PINNED_RESERVE);
  const reservedIds = new Set(reserved.map((candidate) => candidate.memory.id));
  const ordered = [
    ...reserved,
    ...unique.filter((candidate) => !reservedIds.has(candidate.memory.id)),
  ];

  const selected: RetrievedMemory[] = [];
  let truncatedCount = 0;

  for (const candidate of ordered) {
    if (selected.length >= budget.max_memories) {
      exclusions.count_budget += 1;
      continue;
    }

    const { text, truncated } = truncate(candidate.memory.content, budget.max_memory_characters);
    const entry = retrievedEntry(candidate, text, truncated);
    // `max_characters` is a rendered-context budget, not a raw-content sum.
    // Account for escaping, per-record provenance headers, delimiters, safety
    // wording, and the two-block layouts used by chat and Forge. A record that
    // does not fit is skipped; rendered text is never sliced through an entity.
    if (renderedMemoryCharacters([...selected, entry]) > budget.max_characters) {
      exclusions.character_budget += 1;
      continue;
    }

    if (truncated) truncatedCount += 1;
    selected.push(entry);
  }

  // Escaping can expand every stored character (for example `&` -> `&amp;`).
  // If that makes every record too large to include whole, keep the
  // highest-priority record as a safely truncated prefix instead of returning
  // an empty memory context. Truncation happens on raw text before escaping,
  // so it can never split an entity, and the safety wrapper is still complete.
  if (selected.length === 0 && ordered.length > 0) {
    for (const candidate of ordered) {
      const fitted = fitEntryToRenderedBudget(
        candidate,
        budget.max_characters,
        budget.max_memory_characters,
      );
      if (!fitted) continue;
      exclusions.character_budget = Math.max(0, exclusions.character_budget - 1);
      truncatedCount += 1;
      selected.push(fitted);
      break;
    }
  }

  // Reserved pins were *selected* first to guarantee their inclusion, but the
  // returned order should reflect relevance so a caller reading the top result
  // sees the best match rather than a constraint.
  selected.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byUpdated = b.memory.updated_at.localeCompare(a.memory.updated_at);
    if (byUpdated !== 0) return byUpdated;
    return a.memory.id.localeCompare(b.memory.id);
  });

  // Report the exact canonical block the preview injects. The selection above
  // used the larger upper bound across supported layouts, so this can never
  // exceed the configured budget.
  const charactersUsed = renderMemoryLayout(selected, 'canonical').length;

  const metadata: RetrievalMetadata = {
    query: parsed.query,
    project_id: parsed.project_id,
    candidate_count: candidateCount,
    selected_count: selected.length,
    excluded_count: Math.max(0, candidateCount - selected.length),
    excluded_by: exclusions,
    characters_used: charactersUsed,
    character_budget: budget.max_characters,
    memory_budget: budget.max_memories,
    truncated_count: truncatedCount,
    memory_ids: selected.map((entry) => entry.memory.id),
    latency_ms: round(performance.now() - startedAt, 3),
    weights,
    query_mode: queryMode,
  };

  return { results: selected, metadata };
}

// ---------------------------------------------------------------------------
// Candidate loading
// ---------------------------------------------------------------------------

interface ScopeFilters {
  projectId: string | null;
  includeGlobal: boolean;
  types?: MemoryType[] | undefined;
  nowIso: string;
}

function scopeConditions(filters: ScopeFilters, conditions: string[], params: SqlValue[]): void {
  conditions.push("m.status = 'active'");
  conditions.push('(m.expires_at IS NULL OR m.expires_at > ?)');
  params.push(filters.nowIso);

  if (filters.projectId) {
    if (filters.includeGlobal) {
      conditions.push("(m.project_id = ? OR m.scope = 'global')");
    } else {
      conditions.push("m.project_id = ? AND m.scope = 'project'");
    }
    params.push(filters.projectId);
  } else {
    // No scope supplied means global memory only: a prompt assembled without a
    // project must never receive another project's facts.
    conditions.push("m.scope = 'global'");
  }

  if (filters.types && filters.types.length > 0) {
    conditions.push(`m.type IN (${filters.types.map(() => '?').join(', ')})`);
    params.push(...filters.types);
  }
}

function loadCandidates(
  db: DatabaseSync,
  filters: ScopeFilters & { ftsQuery: string | null },
): { id: string; row: MemoryRow; bm25: number | null }[] {
  const conditions: string[] = [];
  const params: SqlValue[] = [];
  scopeConditions(filters, conditions, params);
  const where = conditions.join(' AND ');

  if (filters.ftsQuery) {
    const rows = db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS}, bm25(memory_fts, 1.0, 0.5) AS bm25_score
         FROM memories m
         JOIN memory_fts ON memory_fts.memory_id = m.id
         WHERE memory_fts MATCH ? AND ${where}
         ORDER BY bm25_score ASC
         LIMIT ?`,
      )
      .all(filters.ftsQuery, ...params, MAX_CANDIDATES) as unknown as (MemoryRow & {
      bm25_score: number;
    })[];

    return rows.map((row) => ({ id: row.id, row, bm25: row.bm25_score }));
  }

  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
       WHERE ${where}
       ORDER BY m.updated_at DESC, m.id ASC
       LIMIT ?`,
    )
    .all(...params, MAX_CANDIDATES) as unknown as MemoryRow[];

  return rows.map((row) => ({ id: row.id, row, bm25: null }));
}

function loadPinned(
  db: DatabaseSync,
  filters: ScopeFilters & { pinnedTypes: readonly MemoryType[]; excludeIds: Set<string> },
): MemoryRow[] {
  if (filters.pinnedTypes.length === 0) return [];

  const conditions: string[] = [];
  const params: SqlValue[] = [];
  scopeConditions(filters, conditions, params);
  conditions.push(`m.type IN (${filters.pinnedTypes.map(() => '?').join(', ')})`);
  params.push(...filters.pinnedTypes);

  const rows = db
    .prepare(
      `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.confidence DESC, m.updated_at DESC, m.id ASC
       LIMIT 20`,
    )
    .all(...params) as unknown as MemoryRow[];

  return rows.filter((row) => !filters.excludeIds.has(row.id));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreComponents(
  candidate: Candidate,
  context: { now: Date; maxBm25: number },
): RankComponents {
  const { memory } = candidate;

  const relevance =
    candidate.bm25 === null || context.maxBm25 <= 0
      ? 0
      : clamp01(-candidate.bm25 / context.maxBm25);

  const ageDays = Math.max(0, (context.now.getTime() - Date.parse(memory.updated_at)) / MS_PER_DAY);
  const halfLife = RECENCY_HALF_LIFE_DAYS[memory.type] ?? 30;

  return {
    relevance,
    scope: memory.scope === 'project' ? 1 : 0.65,
    confidence: clamp01(memory.confidence),
    validation: VALIDATION_SCORE[memory.validation_status] ?? 0.5,
    // Exponential decay: 1.0 when just updated, 0.5 at one half-life.
    recency: clamp01(0.5 ** (ageDays / halfLife)),
    type_priority: TYPE_PRIORITY[memory.type] ?? 0.5,
  };
}

function combine(components: RankComponents, weights: RetrievalWeights): number {
  return clamp01(
    components.relevance * weights.relevance +
      components.scope * weights.scope +
      components.confidence * weights.confidence +
      components.validation * weights.validation +
      components.recency * weights.recency +
      components.type_priority * weights.type_priority,
  );
}

/**
 * Drop the relevance weight and renormalise the rest.
 *
 * Used when a request has no search text: relevance is undefined rather than
 * zero, and leaving its weight idle would shrink every score by 40% and make
 * scores incomparable between query and non-query retrievals.
 */
function withoutRelevance(weights: RetrievalWeights): RetrievalWeights {
  const remaining =
    weights.scope +
    weights.confidence +
    weights.validation +
    weights.recency +
    weights.type_priority;

  if (remaining <= 0) {
    return {
      relevance: 0,
      scope: 0.25,
      confidence: 0.2,
      validation: 0.2,
      recency: 0.2,
      type_priority: 0.15,
    };
  }

  const scale = 1 / remaining;
  return {
    relevance: 0,
    scope: round(weights.scope * scale),
    confidence: round(weights.confidence * scale),
    validation: round(weights.validation * scale),
    recency: round(weights.recency * scale),
    type_priority: round(weights.type_priority * scale),
  };
}

/**
 * Build a human-readable justification from the same components that produced
 * the score, so the explanation cannot drift from the ranking.
 */
function buildEvidence(candidate: ScoredCandidate, hasQuery: boolean): string {
  const parts: string[] = [];

  if (candidate.pinned) parts.push(`pinned active ${candidate.memory.type}`);

  if (!hasQuery) {
    parts.push('no query text; relevance excluded');
  } else if (candidate.components.relevance > 0) {
    parts.push(`keyword match (${Math.round(candidate.components.relevance * 100)}% of best)`);
  } else {
    parts.push('no keyword match');
  }

  parts.push(candidate.components.scope === 1 ? 'project scope' : 'global scope');
  parts.push(candidate.memory.validation_status);
  parts.push(`confidence ${candidate.components.confidence.toFixed(2)}`);

  const ageDays = candidate.components.recency;
  if (ageDays >= 0.9) parts.push('fresh');
  else if (ageDays >= 0.5) parts.push('recent');
  else parts.push('older');

  return parts.join(' · ');
}

function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  // Deterministic tie-breaks: newer first, then id. Without this, two equally
  // scored memories could swap places between runs.
  const byUpdated = b.memory.updated_at.localeCompare(a.memory.updated_at);
  if (byUpdated !== 0) return byUpdated;
  return a.memory.id.localeCompare(b.memory.id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function retrievedEntry(
  candidate: ScoredCandidate,
  text: string,
  truncated: boolean,
): RetrievedMemory {
  return {
    memory: candidate.memory,
    injected_content: text,
    truncated,
    pinned: candidate.pinned,
    score: round(candidate.score),
    rank_components: roundComponents(candidate.components),
    evidence: truncated ? `${candidate.evidence} · truncated for injection` : candidate.evidence,
  };
}

/**
 * Find the longest raw prefix whose rendered record fits one empty-ish budget.
 * Used only when no record fits whole; the normal path never truncates merely
 * because a lower-priority record consumed the remaining budget.
 */
function fitEntryToRenderedBudget(
  candidate: ScoredCandidate,
  budget: number,
  maxMemoryCharacters: number,
): RetrievedMemory | null {
  const capped = truncate(candidate.memory.content, maxMemoryCharacters).text;
  if (capped.length <= 1) return null;

  let low = 1;
  let high = capped.length;
  let best: number | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const { text, truncated } = truncate(capped, middle);
    const entry = retrievedEntry(candidate, text, truncated);
    if (renderedMemoryCharacters([entry]) <= budget) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best === null || best < 2) return null;
  const { text, truncated } = truncate(capped, best);
  return retrievedEntry(candidate, text, truncated);
}

function truncate(content: string, max: number): { text: string; truncated: boolean } {
  if (content.length <= max) return { text: content, truncated: false };
  let end = Math.max(0, max - 1);
  // Do not split a surrogate pair when the cap lands between its halves.
  const code = content.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: `${content.slice(0, end)}…`, truncated: true };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundComponents(components: RankComponents): RankComponents {
  return {
    relevance: round(components.relevance),
    scope: round(components.scope),
    confidence: round(components.confidence),
    validation: round(components.validation),
    recency: round(components.recency),
    type_priority: round(components.type_priority),
  };
}
