import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type Memory,
  type MemoryCorrectionInput,
  MemoryCorrectionInputSchema,
  type MemoryCorrectionResult,
  type MemoryCreateInput,
  MemoryCreateInputSchema,
  type MemoryCreateResult,
  type MemoryDetail,
  type MemoryHistoryEntry,
  MemoryHistoryEntrySchema,
  type MemoryListResponse,
  type MemoryQuery,
  MemoryQuerySchema,
  type MemoryStats,
  type MemoryUpdateInput,
  MemoryUpdateInputSchema,
  type Project,
  ProjectSchema,
} from '@mml/shared';
import { memoryContentHash } from './content-hash.js';
import { formatMemoryContext } from './context.js';
import { MemoryConflictError, MemoryNotFoundError } from './errors.js';
import { toFtsQuery } from './fts.js';
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

    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // A rollback failure must never mask the original error.
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
              content_hash, tags, superseded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL)`,
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

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(id: string, input: MemoryUpdateInput, actor: MemoryActor = 'user'): Memory {
    const parsed = MemoryUpdateInputSchema.parse(input);

    return this.transaction(() => {
      const current = this.requireMemory(id);
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
             tags = ?, expires_at = ?, updated_at = ?
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
                content_hash, tags, superseded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, NULL)`,
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
             SET status = 'superseded', superseded_by = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(replacement.id, now, target.id);

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
        .prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ?")
        .run(now, id);

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
          .prepare("UPDATE memories SET status = 'expired', updated_at = ? WHERE id = ?")
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
      active: byStatus.get('active') ?? 0,
      superseded: byStatus.get('superseded') ?? 0,
      expired: byStatus.get('expired') ?? 0,
      deleted: byStatus.get('deleted') ?? 0,
      by_type: byType as MemoryStats['by_type'],
    };
  }
}
