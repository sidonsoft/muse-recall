import { type Memory, MemorySchema } from '@mml/shared';

/** Raw SQLite row shape for `memories`. Snake case mirrors the schema. */
export interface MemoryRow {
  id: string;
  type: string;
  scope: string;
  project_id: string | null;
  content: string;
  source_session_id: string | null;
  source_reference: string | null;
  confidence: number;
  validation_status: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  content_hash: string;
  tags: string;
  superseded_by: string | null;
  /** Monotonic edit counter; the migration backfills it to 1. */
  revision: number;
  /** Actor of the latest change to this row. */
  actor: string;
  /** JSON array of ids this record replaced, from a correlated subquery. */
  supersedes_json: string;
}

/**
 * Columns selected for every `memories` read.
 *
 * Queries must alias the `memories` table as `m`. The supersession list is
 * aggregated in the same round-trip rather than fetched per row, so a list of
 * 200 memories stays one query.
 */
export const MEMORY_SELECT_COLUMNS = `
  m.id, m.type, m.scope, m.project_id, m.content, m.source_session_id,
  m.source_reference, m.confidence, m.validation_status, m.status,
  m.created_at, m.updated_at, m.expires_at, m.content_hash, m.tags,
  m.superseded_by, m.revision, m.actor,
  COALESCE(
    (SELECT json_group_array(s.old_id) FROM memory_supersessions s WHERE s.new_id = m.id),
    '[]'
  ) AS supersedes_json
`;

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Map a row to the public `Memory` shape.
 *
 * The result is validated with the shared schema: a mismatch between storage
 * and contract surfaces here rather than as a malformed API response. JSON
 * columns are parsed defensively — a corrupt tag array degrades to "no tags"
 * rather than breaking every query that includes the row.
 */
export function rowToMemory(row: MemoryRow): Memory {
  let tags: unknown = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }

  return MemorySchema.parse({
    id: row.id,
    type: row.type,
    scope: row.scope,
    project_id: row.project_id,
    content: row.content,
    source: {
      session_id: row.source_session_id,
      reference: row.source_reference,
    },
    confidence: row.confidence,
    validation_status: row.validation_status,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    supersedes: parseStringArray(row.supersedes_json),
    superseded_by: row.superseded_by,
    tags: Array.isArray(tags) ? tags : [],
    // A pre-contract row (missing the columns entirely) still maps cleanly:
    // it started at revision 1 and only the HTTP user actor could have
    // written it. Storing the defaults in the migration keeps this path rare
    // rather than load-bearing, so a dropped column surfaces as a parse
    // failure instead of silently resetting history.
    revision: Number.isInteger(row.revision) && row.revision >= 1 ? row.revision : 1,
    actor: row.actor ?? 'user',
  });
}
