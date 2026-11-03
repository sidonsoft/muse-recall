import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  MEMORY_EXPORT_FORMAT,
  MEMORY_EXPORT_FORMAT_VERSION,
  type Memory,
  type MemoryCorrectionInput,
  MemoryCorrectionInputSchema,
  type MemoryCorrectionResult,
  type MemoryCreateInput,
  MemoryCreateInputSchema,
  type MemoryCreateResult,
  type MemoryDetail,
  type MemoryExportEnvelope,
  MemoryExportEnvelopeSchema,
  type MemoryExportRecord,
  type MemoryHistoryEntry,
  MemoryHistoryEntrySchema,
  type MemoryImportResult,
  type MemoryListResponse,
  type MemoryQuery,
  MemoryQuerySchema,
  type MemoryStats,
  type MemorySupersessionEdge,
  type MemoryUpdateInput,
  MemoryUpdateInputSchema,
  type Project,
  ProjectSchema,
  type ReviewItem,
  type ReviewQueue,
  type ReviewQueueQuery,
  ReviewQueueQuerySchema,
} from '@mml/shared';
import { ZodError } from 'zod';
import { memoryContentHash } from './content-hash.js';
import { formatMemoryContext } from './context.js';
import { MemoryConflictError, MemoryError, MemoryNotFoundError } from './errors.js';
import { toFtsQuery } from './fts.js';
import { currentSchemaVersion } from './migrations.js';
import { type RetrievalOptions, retrieveMemories } from './retrieval.js';
import { MEMORY_SELECT_COLUMNS, type MemoryRow, rowToMemory } from './rows.js';

export interface MemoryEngineOptions {
  /** Clock injection, so retention and recency are testable. */
  now?: () => Date;
}

export type MemoryActor = 'user' | 'agent' | 'system';

interface HistoryRow {
  id: string;
  memory_id: string;
  action: string;
  previous_status: string | null;
  next_status: string;
  reason: string | null;
  actor: string;
  at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

type SqlValue = string | number | null;

/**
 * The persistent memory engine.
 *
 * Every mutation runs inside a `BEGIN IMMEDIATE` transaction: the write lock is
 * taken up front, so a duplicate check followed by an insert cannot interleave
 * with another writer. That is what makes deduplication and supersession
 * race-safe without relying on a unique index that would break legitimate
 * correction chains.
 *
 * Reads never expose deleted content. `get(..., { includeDeleted: true })`
 * exists only for maintenance (purge) and for tests that assert the guarantee.
 */
export class MemoryEngine {
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;
  private transactionDepth = 0;

  constructor(db: DatabaseSync, options: MemoryEngineOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => new Date());
  }

  /**
   * Read-only access to the underlying connection.
   *
   * Used by adjacent stores (sessions, messages) that live in the same
   * database but are not part of the memory domain.
   */
  get connection(): DatabaseSync {
    return this.db;
  }

  // -------------------------------------------------------------------------
  // Infrastructure
  // -------------------------------------------------------------------------

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();

    this.transactionDepth += 1;
    try {
      // BEGIN itself is inside the try: a connection that dies between
      // "alive at startup" and "this write" must surface as
      // memory_storage_failed, not slip past the wrap unlabelled.
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // A rollback failure must never mask the original error.
      }
      // Anything below the domain layer (node:sqlite errors, I/O faults) is a
      // STORAGE failure, not a request failure: wrap it under a stable code so
      // the HTTP layer answers 5xx without exposing driver internals. Domain
      // errors and input schema errors pass through untouched.
      if (!MemoryError.isMemoryError(error) && !(error instanceof ZodError)) {
        // DryRunAbort is engine-internal control flow, not a storage fault.
        if (error instanceof DryRunAbort) throw error;
        const wrapped = new MemoryError('memory_storage_failed', 'Durable storage write failed.', {
          cause: error instanceof Error ? error.name : String(error),
        });
        // Keep the original error (and its stack) chained for engine-level
        // debugging; the HTTP layer sends only the class name above.
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private findRow(id: string): MemoryRow | null {
    const row = this.db
      .prepare(`SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m WHERE m.id = ?`)
      .get(id) as MemoryRow | undefined;
    return row ?? null;
  }

  private requireMemory(id: string): Memory {
    const row = this.findRow(id);
    if (!row || row.status === 'deleted') throw new MemoryNotFoundError(id);
    return rowToMemory(row);
  }

  private appendHistory(entry: {
    memoryId: string;
    action: MemoryHistoryEntry['action'];
    previousStatus: Memory['status'] | null;
    nextStatus: Memory['status'];
    reason: string | null;
    actor: MemoryActor;
  }): void {
    this.db
      .prepare(
        `INSERT INTO memory_history
           (id, memory_id, action, previous_status, next_status, reason, actor, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.memoryId,
        entry.action,
        entry.previousStatus,
        entry.nextStatus,
        entry.reason,
        entry.actor,
        this.nowIso(),
      );
  }

  private findActiveByHash(hash: string): Memory | null {
    const row = this.db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
         WHERE m.content_hash = ? AND m.status = 'active'
         ORDER BY m.updated_at DESC, m.id ASC LIMIT 1`,
      )
      .get(hash) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  // -------------------------------------------------------------------------
  // Projects (scope anchors)
  // -------------------------------------------------------------------------

  /**
   * Ensure a project row exists.
   *
   * Phase 2 has no project management UI; project ids arrive with the first
   * memory written in that scope. Creating the anchor here keeps the foreign
   * key meaningful without asking the user to register a project first.
   */
  ensureProject(id: string, name?: string): Project {
    const now = this.nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, name ?? id, now, now);

    const row = this.db
      .prepare('SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    if (!row) throw new Error(`failed to ensure project ${id}`);
    return ProjectSchema.parse(row);
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare('SELECT id, name, description, created_at, updated_at FROM projects ORDER BY id')
      .all() as unknown as ProjectRow[];
    return rows.map((row) => ProjectSchema.parse(row));
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Retrieve relevant memories within a scope and budget.
   *
   * Reads only — safe to call from an HTTP preview or a benchmark loop.
   */
  retrieve(
    request: Parameters<typeof retrieveMemories>[1],
    options: RetrievalOptions = {},
  ): ReturnType<typeof retrieveMemories> {
    return retrieveMemories(this.db, request, options);
  }

  /** Render a retrieval result as a delimited, cost-accounted prompt block. */
  renderContext(
    request: Parameters<typeof retrieveMemories>[1],
    options: RetrievalOptions = {},
  ): ReturnType<typeof formatMemoryContext> {
    return formatMemoryContext(this.retrieve(request, options));
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  create(input: MemoryCreateInput, actor: MemoryActor = 'user'): MemoryCreateResult {
    const parsed = MemoryCreateInputSchema.parse(input);

    return this.transaction(() => {
      if (parsed.scope === 'project' && parsed.project_id) {
        this.ensureProject(parsed.project_id);
      }

      const hash = memoryContentHash(parsed);
      const duplicate = this.findActiveByHash(hash);
      if (duplicate) {
        // Idempotent: the claim already exists as current fact. Returning it
        // makes retried requests harmless instead of creating a duplicate row.
        return { memory: duplicate, created: false };
      }

      const id = randomUUID();
      const now = this.nowIso();
      this.db
        .prepare(
          `INSERT INTO memories
             (id, type, scope, project_id, content, source_session_id, source_reference,
              confidence, validation_status, status, created_at, updated_at, expires_at,
              content_hash, tags, superseded_by, revision, actor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, 1, ?)`,
        )
        .run(
          id,
          parsed.type,
          parsed.scope,
          parsed.project_id,
          parsed.content,
          parsed.source.session_id,
          parsed.source.reference,
          parsed.confidence,
          parsed.validation_status,
          now,
          now,
          parsed.expires_at,
          hash,
          JSON.stringify(parsed.tags),
          actor,
        );

      this.appendHistory({
        memoryId: id,
        action: 'created',
        previousStatus: null,
        nextStatus: 'active',
        reason: null,
        actor,
      });

      return { memory: this.requireMemory(id), created: true };
    });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  get(id: string, options: { includeDeleted?: boolean } = {}): Memory | null {
    const row = this.findRow(id);
    if (!row) return null;
    if (row.status === 'deleted' && options.includeDeleted !== true) return null;
    return rowToMemory(row);
  }

  getDetail(id: string): MemoryDetail {
    const memory = this.requireMemory(id);

    const superseded = this.db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
         JOIN memory_supersessions s ON s.old_id = m.id
         WHERE s.new_id = ? AND m.status != 'deleted'
         ORDER BY m.created_at ASC, m.id ASC`,
      )
      .all(id) as unknown as MemoryRow[];

    const replacement = memory.superseded_by ? this.findRow(memory.superseded_by) : null;

    return {
      memory,
      history: this.history(id),
      supersedes: superseded.map(rowToMemory),
      superseded_by:
        replacement && replacement.status !== 'deleted' ? rowToMemory(replacement) : null,
    };
  }

  /**
   * Relationship graph + timeline over the supersession edges (D052).
   * Nodes are bounded excerpts, never full records; deleted memories are
   * excluded everywhere so a purge cannot be undone by walking a graph.
   * When `projectId` is set, nodes are that project's plus global memories —
   * the same scoping rule as list().
   */
  graph(options: { projectId?: string; limit?: number } = {}): {
    nodes: {
      id: string;
      type: Memory['type'];
      scope: 'global' | 'project';
      project_id: string | null;
      excerpt: string;
      status: 'active' | 'superseded' | 'expired';
      revision: number;
      created_at: string;
      updated_at: string;
    }[];
    edges: { new_id: string; old_id: string; at: string }[];
    events: { at: string; kind: 'created' | 'corrected'; memory_id: string }[];
    truncated: boolean;
    observed_at: string;
  } {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
    const params: string[] = [];
    let where = "status != 'deleted'";
    if (options.projectId) {
      where += " AND (scope = 'global' OR project_id = ?)";
      params.push(options.projectId);
    }
    const rows = this.db
      .prepare(
        `SELECT id, type, scope, project_id, content, status, revision, created_at, updated_at
         FROM memories WHERE ${where}
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as {
      id: string;
      type: Memory['type'];
      scope: 'global' | 'project';
      project_id: string | null;
      content: string;
      status: string;
      revision: number;
      created_at: string;
      updated_at: string;
    }[];
    const truncated = rows.length > limit;
    const kept = rows.slice(0, limit);
    const nodes = kept
      .map((row) => ({
        id: row.id,
        type: row.type,
        scope: row.scope,
        project_id: row.project_id,
        excerpt: row.content.length > 140 ? `${row.content.slice(0, 137)}...` : row.content,
        status: (row.status === 'active' || row.status === 'superseded' || row.status === 'expired'
          ? row.status
          : 'active') as 'active' | 'superseded' | 'expired',
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
      .sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      );

    const ids = new Set(nodes.map((node) => node.id));
    const edges = (
      this.db
        .prepare(
          `SELECT new_id, old_id, created_at FROM memory_supersessions
           ORDER BY created_at DESC, rowid DESC LIMIT 4000`,
        )
        .all() as unknown as { new_id: string; old_id: string; created_at: string }[]
    )
      .filter((edge) => ids.has(edge.new_id) && ids.has(edge.old_id))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map((edge) => ({ new_id: edge.new_id, old_id: edge.old_id, at: edge.created_at }));

    const events = [
      ...nodes.map((node) => ({
        at: node.created_at,
        kind: 'created' as const,
        memory_id: node.id,
      })),
      ...edges.map((edge) => ({ at: edge.at, kind: 'corrected' as const, memory_id: edge.new_id })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 200);

    return { nodes, edges, events, truncated, observed_at: new Date().toISOString() };
  }

  history(id: string): MemoryHistoryEntry[] {
    // A deleted memory is not addressable through the API, so its history is
    // not reachable either.
    const row = this.findRow(id);
    if (!row || row.status === 'deleted') throw new MemoryNotFoundError(id);

    const rows = this.db
      .prepare(
        `SELECT id, memory_id, action, previous_status, next_status, reason, actor, at
         FROM memory_history WHERE memory_id = ? ORDER BY at ASC, rowid ASC`,
      )
      .all(id) as unknown as HistoryRow[];

    return rows.map((entry) =>
      MemoryHistoryEntrySchema.parse({
        id: entry.id,
        memory_id: entry.memory_id,
        action: entry.action,
        previous_status: entry.previous_status,
        next_status: entry.next_status,
        reason: entry.reason,
        actor: entry.actor,
        at: entry.at,
      }),
    );
  }

  list(query: Partial<MemoryQuery> = {}): MemoryListResponse {
    const parsed = MemoryQuerySchema.parse(query);
    const requested = parsed.status.filter((status) => status !== 'deleted');

    // Deleted rows are never returned, even when explicitly requested.
    if (requested.length === 0) {
      return { items: [], total: 0, limit: parsed.limit, offset: parsed.offset };
    }

    const conditions: string[] = ["m.status != 'deleted'"];
    const params: SqlValue[] = [];

    if (!parsed.all_projects) {
      if (parsed.project_id) {
        if (parsed.include_global) {
          conditions.push("(m.project_id = ? OR m.scope = 'global')");
        } else {
          conditions.push('m.project_id = ?');
        }
        params.push(parsed.project_id);
      } else {
        conditions.push("m.scope = 'global'");
      }
    }

    conditions.push(`m.status IN (${requested.map(() => '?').join(', ')})`);
    params.push(...requested);

    if (parsed.types && parsed.types.length > 0) {
      conditions.push(`m.type IN (${parsed.types.map(() => '?').join(', ')})`);
      params.push(...parsed.types);
    }

    if (parsed.text && parsed.text.trim().length > 0) {
      const ftsQuery = toFtsQuery(parsed.text);
      if (ftsQuery) {
        conditions.push('m.id IN (SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?)');
        params.push(ftsQuery);
      }
    }

    const where = conditions.join(' AND ');

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM memories m WHERE ${where}`)
      .get(...params) as { count: number } | undefined;

    const rows = this.db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
         WHERE ${where}
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, parsed.limit, parsed.offset) as unknown as MemoryRow[];

    return {
      items: rows.map(rowToMemory),
      total: totalRow?.count ?? 0,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  }

  /**
   * The review queue (roadmap §7 / gap G-9): memories that need a
   * human decision — unverified, disputed, past expiry, or expiring within
   * the horizon. Derived against the moment of the call, never stored.
   */
  reviewQueue(query: Partial<ReviewQueueQuery> = {}): ReviewQueue {
    const parsed = ReviewQueueQuerySchema.parse(query);
    const now = this.nowIso();
    const horizon = new Date(Date.parse(now) + parsed.horizon_days * 86_400_000).toISOString();

    const conditions: string[] = [
      "m.status IN ('active', 'expired')",
      "(m.validation_status IN ('unverified', 'disputed') OR (m.expires_at IS NOT NULL AND m.expires_at <= ?))",
    ];
    const params: SqlValue[] = [horizon];

    // A named project always scopes the queue; without one it spans projects.
    if (parsed.project_id) {
      conditions.push('m.project_id = ?');
      params.push(parsed.project_id);
    }

    const where = conditions.join(' AND ');

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM memories m WHERE ${where}`)
      .get(...params) as { count: number } | undefined;

    const rows = this.db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
         WHERE ${where}
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, parsed.limit, parsed.offset) as unknown as MemoryRow[];

    const items: ReviewItem[] = rows.map((row) => {
      const memory = rowToMemory(row);
      const reasons: ReviewItem['reasons'] = [];
      if (memory.validation_status === 'unverified') reasons.push('unverified');
      if (memory.validation_status === 'disputed') reasons.push('disputed');
      let days: number | null = null;
      if (memory.expires_at) {
        const diffDays = Math.ceil((Date.parse(memory.expires_at) - Date.parse(now)) / 86_400_000);
        days = diffDays;
        if (diffDays < 0) reasons.push('expired');
        else reasons.push('expiring');
      }
      return {
        memory,
        reasons: reasons.length > 0 ? reasons : ['unverified'],
        days_until_expiry: days,
      };
    });

    return { items, total: totalRow?.count ?? 0, horizon_days: parsed.horizon_days };
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(id: string, input: MemoryUpdateInput, actor: MemoryActor = 'user'): Memory {
    const parsed = MemoryUpdateInputSchema.parse(input);

    return this.transaction(() => {
      const current = this.requireMemory(id);

      // Optimistic-concurrency guard (roadmap §6 "Make changes safe"): a
      // stale read must surface as an actionable conflict, never a silent
      // overwrite of someone else's edit.
      if (parsed.expected_revision !== undefined && parsed.expected_revision !== current.revision) {
        throw new MemoryConflictError(
          `This memory is at revision ${current.revision}; the update was written against revision ${parsed.expected_revision}. Re-read it and reapply the change.`,
          { id, expected_revision: parsed.expected_revision, current_revision: current.revision },
        );
      }

      const now = this.nowIso();

      const nextContent = parsed.content ?? current.content;
      const nextHash =
        parsed.content === undefined
          ? memoryContentHash(current)
          : memoryContentHash({ ...current, content: nextContent });

      if (parsed.content !== undefined) {
        const collision = this.findActiveByHash(nextHash);
        if (collision && collision.id !== id) {
          throw new MemoryConflictError(
            'An active memory already has this content; use a correction to supersede it instead.',
            { existing_id: collision.id },
          );
        }
      }

      this.db
        .prepare(
          `UPDATE memories SET
             content = ?, content_hash = ?, confidence = ?, validation_status = ?,
             tags = ?, expires_at = ?, updated_at = ?, revision = revision + 1, actor = ?
           WHERE id = ?`,
        )
        .run(
          nextContent,
          nextHash,
          parsed.confidence ?? current.confidence,
          parsed.validation_status ?? current.validation_status,
          JSON.stringify(parsed.tags ?? current.tags),
          parsed.expires_at === undefined ? current.expires_at : parsed.expires_at,
          now,
          actor,
          id,
        );

      this.appendHistory({
        memoryId: id,
        action: 'updated',
        previousStatus: current.status,
        nextStatus: current.status,
        reason: null,
        actor,
      });

      return this.requireMemory(id);
    });
  }

  // -------------------------------------------------------------------------
  // Correction / supersession
  // -------------------------------------------------------------------------

  /**
   * Replace one or more memories with a new fact.
   *
   * Runs as one transaction: insert (or reuse) the replacement, record the
   * supersession edges, flip the old rows to `superseded`, and append history.
   * A failure at any point leaves the database untouched.
   *
   * Idempotency: if every target is already superseded and an active memory
   * covers them all, that memory is returned with `created: false` — a retried
   * request cannot build a second identical chain.
   */
  correct(input: MemoryCorrectionInput, actor: MemoryActor = 'user'): MemoryCorrectionResult {
    const parsed = MemoryCorrectionInputSchema.parse(input);

    return this.transaction(() => {
      const targetIds = [...new Set(parsed.supersedes)];
      const targets: Memory[] = [];
      for (const targetId of targetIds) {
        const row = this.findRow(targetId);
        if (!row || row.status === 'deleted') throw new MemoryNotFoundError(targetId);
        targets.push(rowToMemory(row));
      }

      // A correction replaces facts inside one visibility boundary. Without
      // this guard a replacement in project-a could supersede project-b's
      // memory and silently remove project-b's active rule from retrieval.
      const consistentScope = targets.every(
        (target) => target.scope === parsed.scope && target.project_id === parsed.project_id,
      );
      if (!consistentScope) {
        throw new MemoryConflictError(
          'A correction must stay within one scope: every target and the replacement must share the same scope and project_id.',
          {
            supersedes: targetIds,
            scope: parsed.scope,
            project_id: parsed.project_id,
            targets: targets.map((target) => ({
              id: target.id,
              scope: target.scope,
              project_id: target.project_id,
            })),
          },
        );
      }

      const activeTargets = targets.filter((target) => target.status === 'active');
      const hash = memoryContentHash(parsed);

      if (activeTargets.length === 0) {
        const replay = this.findReplacementCovering(targetIds);

        // A retried request is only a replay when it asks for the same fact.
        // Returning an unrelated replacement would silently ignore the user's
        // intent, so a different correction against an inactive target is a
        // conflict: the caller should correct the replacement instead.
        if (replay && memoryContentHash(replay) === hash) {
          return {
            memory: replay,
            // Re-read even on replay so the response always reflects persisted
            // lifecycle fields rather than a caller's earlier snapshot.
            superseded: targetIds.map((targetId) => this.requireMemory(targetId)),
            created: false,
          };
        }

        throw new MemoryConflictError(
          replay
            ? `These memories were already superseded by ${replay.id}; correct that memory instead.`
            : 'Every memory in this correction is already inactive and no single replacement covers them.',
          { supersedes: targetIds, replacement_id: replay?.id ?? null },
        );
      }

      if (activeTargets.length !== targets.length) {
        throw new MemoryConflictError(
          'A correction cannot mix active and already-superseded memories.',
          { supersedes: targetIds },
        );
      }

      if (parsed.scope === 'project' && parsed.project_id) {
        this.ensureProject(parsed.project_id);
      }

      const existing = this.findActiveByHash(hash);
      const reuseExisting = existing !== null && !targetIds.includes(existing.id);

      let replacement: Memory;
      let created = false;
      if (reuseExisting) {
        replacement = existing;
      } else {
        const now = this.nowIso();
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO memories
               (id, type, scope, project_id, content, source_session_id, source_reference,
                confidence, validation_status, status, created_at, updated_at, expires_at,
                content_hash, tags, superseded_by, revision, actor)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, NULL, 1, ?)`,
          )
          .run(
            id,
            parsed.type,
            parsed.scope,
            parsed.project_id,
            parsed.content,
            parsed.source.session_id,
            parsed.source.reference,
            parsed.confidence,
            parsed.validation_status,
            now,
            now,
            hash,
            JSON.stringify(parsed.tags),
            actor,
          );
        this.appendHistory({
          memoryId: id,
          action: 'created',
          previousStatus: null,
          nextStatus: 'active',
          reason: 'created by correction',
          actor,
        });
        replacement = this.requireMemory(id);
        created = true;
      }

      const now = this.nowIso();
      for (const target of targets) {
        this.db
          .prepare(
            `INSERT INTO memory_supersessions (new_id, old_id, created_at)
             VALUES (?, ?, ?) ON CONFLICT(new_id, old_id) DO NOTHING`,
          )
          .run(replacement.id, target.id, now);

        this.db
          .prepare(
            `UPDATE memories
             SET status = 'superseded', superseded_by = ?, updated_at = ?,
                 revision = revision + 1, actor = ?
             WHERE id = ?`,
          )
          .run(replacement.id, now, actor, target.id);

        this.appendHistory({
          memoryId: target.id,
          action: 'superseded',
          previousStatus: target.status,
          nextStatus: 'superseded',
          // The replacement link lives in `superseded_by`; repeating a UUID in
          // prose only makes the audit trail harder to read.
          reason: parsed.reason ?? null,
          actor,
        });
      }

      // The rows loaded before the UPDATEs were still `active` and had no
      // `superseded_by`. Re-read them after the writes so the immediate response
      // is identical to a fresh GET, including `updated_at`.
      const superseded = targetIds.map((targetId) => this.requireMemory(targetId));

      return { memory: this.requireMemory(replacement.id), superseded, created };
    });
  }

  /** Find an active memory whose supersession edges cover every given id. */
  private findReplacementCovering(targetIds: string[]): Memory | null {
    const placeholders = targetIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT new_id, COUNT(*) AS covered
         FROM memory_supersessions
         WHERE old_id IN (${placeholders})
         GROUP BY new_id
         HAVING covered = ?`,
      )
      .all(...targetIds, targetIds.length) as unknown as { new_id: string; covered: number }[];

    for (const row of rows) {
      const candidate = this.get(row.new_id);
      if (candidate && candidate.status === 'active') return candidate;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Proposals (roadmap §6: candidates kept apart from established facts)
  // -------------------------------------------------------------------------

  /**
   * Record a candidate without making it a fact.
   *
   * `proposed` rows are invisible to retrieval and to the default inspector
   * query; they exist to be reviewed. Idempotency matches `create`: the same
   * content already established (active) or already awaiting review is
   * returned with `created: false` instead of piling up duplicates.
   */
  propose(input: MemoryCreateInput, actor: MemoryActor = 'agent'): MemoryCreateResult {
    const parsed = MemoryCreateInputSchema.parse(input);

    return this.transaction(() => {
      if (parsed.scope === 'project' && parsed.project_id) {
        this.ensureProject(parsed.project_id);
      }

      const hash = memoryContentHash(parsed);
      const established = this.findActiveByHash(hash);
      if (established) return { memory: established, created: false };

      const pending = this.findProposedByHash(hash);
      if (pending) return { memory: pending, created: false };

      const id = randomUUID();
      const now = this.nowIso();
      this.db
        .prepare(
          `INSERT INTO memories
             (id, type, scope, project_id, content, source_session_id, source_reference,
              confidence, validation_status, status, created_at, updated_at, expires_at,
              content_hash, tags, superseded_by, revision, actor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, NULL, 1, ?)`,
        )
        .run(
          id,
          parsed.type,
          parsed.scope,
          parsed.project_id,
          parsed.content,
          parsed.source.session_id,
          parsed.source.reference,
          parsed.confidence,
          parsed.validation_status,
          now,
          now,
          parsed.expires_at,
          hash,
          JSON.stringify(parsed.tags),
          actor,
        );

      this.appendHistory({
        memoryId: id,
        action: 'created',
        previousStatus: null,
        nextStatus: 'proposed',
        reason: null,
        actor,
      });

      return { memory: this.requireMemory(id), created: true };
    });
  }

  /** Promote a proposal to an established fact. */
  acceptProposal(id: string, options: { reason?: string; actor?: MemoryActor } = {}): Memory {
    const actor = options.actor ?? 'user';
    return this.transaction(() => {
      const current = this.requireMemory(id);
      if (current.status !== 'proposed') {
        throw new MemoryConflictError(
          current.status === 'active'
            ? 'This memory is already accepted.'
            : `Only proposed memories can be accepted; this one is ${current.status}.`,
          { id, status: current.status },
        );
      }
      // Accepting must not create two active records of the same fact; the
      // proposal should be superseded by the established one instead.
      const collision = this.findActiveByHash(memoryContentHash(current));
      if (collision && collision.id !== id) {
        throw new MemoryConflictError(
          'An active memory already has this content; supersede the proposal instead of accepting it.',
          { id, existing_id: collision.id },
        );
      }

      this.db
        .prepare(
          `UPDATE memories
           SET status = 'active', updated_at = ?, revision = revision + 1, actor = ?
           WHERE id = ?`,
        )
        .run(this.nowIso(), actor, id);

      this.appendHistory({
        memoryId: id,
        action: 'accepted',
        previousStatus: 'proposed',
        nextStatus: 'active',
        reason: options.reason ?? null,
        actor,
      });

      return this.requireMemory(id);
    });
  }

  /**
   * Reject a proposal: it becomes a tombstone exactly like a soft delete
   * (content leaves FTS in the same transaction, the row survives for audit),
   * but the history action distinguishes rejection from deletion.
   */
  rejectProposal(id: string, options: { reason?: string; actor?: MemoryActor } = {}): void {
    const actor = options.actor ?? 'user';
    this.transaction(() => {
      const current = this.requireMemory(id);
      if (current.status !== 'proposed') {
        throw new MemoryConflictError(
          `Only proposed memories can be rejected; this one is ${current.status}.`,
          { id, status: current.status },
        );
      }

      const now = this.nowIso();
      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);
      this.db
        .prepare(
          `UPDATE memories
           SET status = 'deleted', updated_at = ?, revision = revision + 1, actor = ?
           WHERE id = ?`,
        )
        .run(now, actor, id);

      this.appendHistory({
        memoryId: id,
        action: 'rejected',
        previousStatus: 'proposed',
        nextStatus: 'deleted',
        reason: options.reason ?? null,
        actor,
      });
    });
  }

  private findProposedByHash(hash: string): Memory | null {
    const row = this.db
      .prepare(
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m
         WHERE m.content_hash = ? AND m.status = 'proposed'
         ORDER BY m.updated_at DESC, m.id ASC LIMIT 1`,
      )
      .get(hash) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  // -------------------------------------------------------------------------
  // Deletion
  // -------------------------------------------------------------------------

  /**
   * Soft delete.
   *
   * The row survives as a tombstone for integrity, but its content leaves the
   * FTS index in the same transaction and every read path filters `deleted`
   * out. Deletion is therefore final from the API's point of view.
   */
  softDelete(id: string, options: { reason?: string; actor?: MemoryActor } = {}): void {
    this.transaction(() => {
      const current = this.requireMemory(id);
      const now = this.nowIso();

      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);
      this.db
        .prepare(
          `UPDATE memories
           SET status = 'deleted', updated_at = ?, revision = revision + 1, actor = ?
           WHERE id = ?`,
        )
        .run(now, options.actor ?? 'user', id);

      this.appendHistory({
        memoryId: id,
        action: 'deleted',
        previousStatus: current.status,
        nextStatus: 'deleted',
        reason: options.reason ?? null,
        actor: options.actor ?? 'user',
      });
    });
  }

  /**
   * Hard delete, for retention jobs only.
   *
   * Restricted to records that were already deleted or expired, so a purge can
   * never destroy live knowledge by mistake. Cascades remove history and
   * supersession edges; the FTS trigger removes the index row.
   */
  purge(id: string): void {
    this.transaction(() => {
      const row = this.findRow(id);
      if (!row) throw new MemoryNotFoundError(id);
      if (row.status !== 'deleted' && row.status !== 'expired') {
        throw new MemoryConflictError('Only deleted or expired memories may be purged.', {
          id,
          status: row.status,
        });
      }
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    });
  }

  // -------------------------------------------------------------------------
  // Retention and aggregates
  // -------------------------------------------------------------------------

  /** Mark active memories past `expires_at` as expired. Returns the count. */
  expireStale(): number {
    return this.transaction(() => {
      const now = this.nowIso();
      const rows = this.db
        .prepare(
          `SELECT id FROM memories
           WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .all(now) as unknown as { id: string }[];

      for (const row of rows) {
        this.db
          .prepare(
            `UPDATE memories
             SET status = 'expired', updated_at = ?, revision = revision + 1, actor = 'system'
             WHERE id = ?`,
          )
          .run(now, row.id);
        this.appendHistory({
          memoryId: row.id,
          action: 'expired',
          previousStatus: 'active',
          nextStatus: 'expired',
          reason: 'expiry timestamp passed',
          actor: 'system',
        });
      }

      return rows.length;
    });
  }

  stats(): MemoryStats {
    const statusRows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM memories GROUP BY status')
      .all() as unknown as { status: string; count: number }[];

    const typeRows = this.db
      .prepare(
        "SELECT type, COUNT(*) AS count FROM memories WHERE status != 'deleted' GROUP BY type",
      )
      .all() as unknown as { type: string; count: number }[];

    const byStatus = new Map(statusRows.map((row) => [row.status, row.count]));
    const byType: Record<string, number> = {};
    for (const row of typeRows) byType[row.type] = row.count;

    return {
      total: statusRows.reduce((sum, row) => sum + row.count, 0),
      proposed: byStatus.get('proposed') ?? 0,
      active: byStatus.get('active') ?? 0,
      superseded: byStatus.get('superseded') ?? 0,
      expired: byStatus.get('expired') ?? 0,
      deleted: byStatus.get('deleted') ?? 0,
      by_type: byType as MemoryStats['by_type'],
    };
  }

  // -------------------------------------------------------------------------
  // Portable export / import (roadmap §6 "Make changes safe")
  // -------------------------------------------------------------------------

  /**
   * Snapshot the whole memory domain — records (including tombstones), audit
   * history, supersession edges and project anchors — into a portable
   * envelope. The result is parsed through the envelope schema on the way
   * out, so referential integrity violations in the snapshot are caught at
   * the source rather than surfacing as import failures later.
   */
  exportMemories(): MemoryExportEnvelope {
    const projects = (
      this.db
        .prepare(
          `SELECT id, name, description, created_at, updated_at
           FROM projects ORDER BY id`,
        )
        .all() as unknown as ProjectRow[]
    ).map((row) => ProjectSchema.parse(row));

    const records = (
      this.db
        .prepare(`SELECT ${MEMORY_SELECT_COLUMNS}, m.content_hash FROM memories m
                  ORDER BY m.created_at ASC, m.id ASC`)
        .all() as unknown as MemoryRow[]
    ).map((row) => ({ ...rowToMemory(row), content_hash: row.content_hash }));

    const history = (
      this.db
        .prepare(
          `SELECT id, memory_id, action, previous_status, next_status, reason, actor, at
           FROM memory_history ORDER BY memory_id ASC, at ASC, rowid ASC`,
        )
        .all() as unknown as HistoryRow[]
    ).map((entry) =>
      MemoryHistoryEntrySchema.parse({
        id: entry.id,
        memory_id: entry.memory_id,
        action: entry.action,
        previous_status: entry.previous_status,
        next_status: entry.next_status,
        reason: entry.reason,
        actor: entry.actor,
        at: entry.at,
      }),
    );

    const supersessions = this.db
      .prepare(
        'SELECT new_id, old_id, created_at FROM memory_supersessions ORDER BY new_id, old_id',
      )
      .all() as unknown as MemorySupersessionEdge[];

    return MemoryExportEnvelopeSchema.parse({
      format: MEMORY_EXPORT_FORMAT,
      format_version: MEMORY_EXPORT_FORMAT_VERSION,
      schema_version: currentSchemaVersion(this.db),
      exported_at: this.nowIso(),
      projects,
      records,
      history,
      supersessions,
    });
  }

  /**
   * Import an export envelope. The whole envelope lands in a single
   * transaction: an import that hits a foreign id holding different content
   * rolls back completely and reports every clashing id, because a half
   * imported snapshot is worse than no import at all.
   *
   * Replay is idempotent: a record whose stored row matches the envelope
   * byte-for-byte (same content hash, status, revision, actor and
   * timestamps) counts as replayed, not imported. Provenance rides along
   * with the data — history entries are inserted verbatim, and tombstones
   * stay out of the FTS index exactly as the live write path keeps them.
   */
  importExport(envelope: unknown, options: { dryRun?: boolean } = {}): MemoryImportResult {
    const parsed = MemoryExportEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new MemoryError('memory_invalid', 'The export envelope is not a valid snapshot.', {
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (parsed.data.format !== MEMORY_EXPORT_FORMAT) {
      throw new MemoryError('memory_invalid', 'Not a memory export envelope.', {
        format: parsed.data.format,
      });
    }
    if (parsed.data.format_version > MEMORY_EXPORT_FORMAT_VERSION) {
      throw new MemoryError(
        'memory_invalid',
        `Export format version ${parsed.data.format_version} is newer than this build supports (${MEMORY_EXPORT_FORMAT_VERSION}).`,
        {
          export_format_version: parsed.data.format_version,
          supported_format_version: MEMORY_EXPORT_FORMAT_VERSION,
        },
      );
    }

    try {
      return this.transaction(() => {
        const result = this.importEnvelope(parsed.data);
        if (options.dryRun) throw new DryRunAbort(result);
        return result;
      });
    } catch (error) {
      if (error instanceof DryRunAbort) return { ...error.result, dry_run: true };
      throw error;
    }
  }

  private importEnvelope(envelope: MemoryExportEnvelope): MemoryImportResult {
    const result: MemoryImportResult = {
      format_version: envelope.format_version,
      schema_version: envelope.schema_version,
      records_imported: 0,
      records_replayed: 0,
      history_imported: 0,
      edges_imported: 0,
      projects_ensured: 0,
      dry_run: false,
    };

    const insertProject = this.db.prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    for (const project of envelope.projects) {
      result.projects_ensured += Number(
        insertProject.run(
          project.id,
          project.name,
          project.description,
          project.created_at,
          project.updated_at,
        ).changes,
      );
    }

    const conflicts: { id: string; reason: string }[] = [];
    // A superseded row's `superseded_by` points at its replacement, so the
    // replacement must land first: insert in dependency order, one pass per
    // link of the correction chains (the envelope's integrity refine already
    // guarantees every referenced id is present in the snapshot).
    const envelopeIds = new Set(envelope.records.map((record) => record.id));
    const placed = new Set<string>();
    const insertRecord = this.db.prepare(
      `INSERT INTO memories (
         id, type, scope, project_id, content, source_session_id, source_reference,
         confidence, validation_status, status, created_at, updated_at, expires_at,
         content_hash, tags, superseded_by, revision, actor
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const unindex = this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?');

    let remaining = [...envelope.records];
    while (remaining.length > 0) {
      const ready = remaining.filter(
        (record) =>
          !record.superseded_by ||
          !envelopeIds.has(record.superseded_by) ||
          placed.has(record.superseded_by),
      );
      if (ready.length === 0) {
        throw new MemoryError('memory_invalid', 'The export contains a supersession cycle.', {
          ids: remaining.map((record) => record.id).slice(0, 5),
        });
      }
      for (const record of ready) {
        const existing = this.findRow(record.id);
        if (existing) {
          if (this.rowsMatch(existing, record)) {
            result.records_replayed += 1;
          } else {
            conflicts.push({
              id: record.id,
              reason: 'a different record is already stored under this id',
            });
          }
        } else {
          insertRecord.run(
            record.id,
            record.type,
            record.scope,
            record.project_id,
            record.content,
            record.source.session_id,
            record.source.reference,
            record.confidence,
            record.validation_status,
            record.status,
            record.created_at,
            record.updated_at,
            record.expires_at,
            record.content_hash,
            JSON.stringify(record.tags),
            record.superseded_by,
            record.revision,
            record.actor,
          );
          // Tombstones stay out of the search index, matching softDelete's
          // guarantee; the insert trigger has already indexed the row.
          if (record.status === 'deleted') unindex.run(record.id);
          result.records_imported += 1;
        }
        placed.add(record.id);
      }
      remaining = remaining.filter((record) => !placed.has(record.id));
    }

    if (conflicts.length > 0) {
      throw new MemoryConflictError(
        `${conflicts.length} record id(s) in the export already hold different content.`,
        { conflicts: conflicts.slice(0, 20) },
      );
    }

    const insertHistory = this.db.prepare(
      `INSERT INTO memory_history (
         id, memory_id, action, previous_status, next_status, reason, actor, at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    for (const entry of envelope.history) {
      result.history_imported += Number(
        insertHistory.run(
          entry.id,
          entry.memory_id,
          entry.action,
          entry.previous_status,
          entry.next_status,
          entry.reason,
          entry.actor,
          entry.at,
        ).changes,
      );
    }

    const insertEdge = this.db.prepare(
      `INSERT INTO memory_supersessions (new_id, old_id, created_at)
       VALUES (?, ?, ?) ON CONFLICT(new_id, old_id) DO NOTHING`,
    );
    for (const edge of envelope.supersessions) {
      result.edges_imported += Number(
        insertEdge.run(edge.new_id, edge.old_id, edge.created_at).changes,
      );
    }

    return result;
  }

  private rowsMatch(row: MemoryRow, record: MemoryExportRecord): boolean {
    let storedTags: unknown;
    try {
      storedTags = JSON.parse(row.tags);
    } catch {
      return false;
    }
    return (
      row.type === record.type &&
      row.scope === record.scope &&
      row.project_id === record.project_id &&
      row.content === record.content &&
      row.content_hash === record.content_hash &&
      row.source_session_id === record.source.session_id &&
      row.source_reference === record.source.reference &&
      row.confidence === record.confidence &&
      row.validation_status === record.validation_status &&
      row.status === record.status &&
      row.created_at === record.created_at &&
      row.updated_at === record.updated_at &&
      row.expires_at === record.expires_at &&
      row.superseded_by === record.superseded_by &&
      row.revision === record.revision &&
      row.actor === record.actor &&
      JSON.stringify(storedTags) === JSON.stringify(record.tags)
    );
  }
}

class DryRunAbort extends Error {
  constructor(readonly result: MemoryImportResult) {
    super('dry-run rollback');
  }
}
