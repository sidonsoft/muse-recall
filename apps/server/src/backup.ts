import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { currentSchemaVersion, latestVersion } from '@mml/memory-engine';

/**
 * Online SQLite backup.
 *
 * `node:sqlite`'s backup API copies a consistent snapshot while the server is
 * writing; committed frames still in the WAL are included. Timestamps make the
 * default name collision-free, and the destination is created 0600 before
 * SQLite touches it.
 */

export interface DatabaseBackup {
  source: string;
  destination: string;
  pages: number;
}

/**
 * How long an online backup may take before the caller gives up on it. Configurable because
 * a real database on slow storage legitimately needs more than a laptop-sized default; the
 * default exists so that a stalled copy becomes a named failure instead of an open-ended
 * await (KI-56).
 */
export const DEFAULT_BACKUP_TIMEOUT_MS = Number(process.env.FORGE_BACKUP_TIMEOUT_MS ?? '15000');

export interface BackupOptions {
  /**
   * Bound on the online copy. `node:sqlite`'s backup promise has no abort path, and on
   * 2 Nov a full-suite run left it unsettled long enough to consume the whole 30 s test
   * timeout (KI-56) with nothing to show but "Test timed out". An unbounded await turns a
   * stall into a hang, and a hang in a release drill silently blocks the drill.
   */
  timeoutMs?: number;
  /** Seam for tests: the SQLite copy itself. */
  copy?: (source: DatabaseSync, destination: string) => Promise<number>;
}

/**
 * A copy that never finished is never kept at its destination path. It is parked under a
 * different name first: the SQLite handle is still attached to that file, so deleting the
 * destination outright would let a late-finishing copy recreate the path with a truncated
 * database and a name that reads like a backup.
 */
function parkUnfinished(destination: string): string {
  const parked = `${destination}.unfinished-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(destination, parked);
  } catch {
    // Nothing to park: the copy failed before it created anything, or the path is gone.
    return destination;
  }
  try {
    rmSync(parked, { force: true });
  } catch {
    /* the handle may still hold it; it is out of the backup namespace either way */
  }
  return parked;
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function defaultBackupPath(source: string, now: Date = new Date()): string {
  return `${source}.backup-${timestamp(now)}`;
}

export function resolveBackupDestination(
  source: string,
  destination?: string,
  now: Date = new Date(),
): string {
  if (!destination) return defaultBackupPath(source, now);
  const resolved = resolve(destination);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return join(resolved, `${basename(source)}.backup-${timestamp(now)}`);
  }
  return resolved;
}

export async function backupDatabase(
  source: string,
  destination?: string,
  options: BackupOptions = {},
): Promise<DatabaseBackup> {
  if (!existsSync(source)) {
    throw new Error(`Database not found: ${source}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_TIMEOUT_MS;
  const copy = options.copy ?? ((db: DatabaseSync, path: string) => backup(db, path));
  const target = resolveBackupDestination(source, destination);
  const database = new DatabaseSync(source, { readOnly: true });
  let created = false;
  try {
    if (existsSync(target)) {
      throw new Error(`Backup destination already exists: ${target}`);
    }

    // Create the destination with owner-only permissions before SQLite opens it.
    closeSync(openSync(target, 'wx', 0o600));
    created = true;

    let pages: number;
    const started = performance.now();
    try {
      pages = await settledWithin(copy(database, target), timeoutMs);
    } catch (error) {
      const parked = created ? parkUnfinished(target) : target;
      const why = error instanceof BackupDeadlineError ? error.message : String(error);
      throw new Error(
        `online backup of ${source} did not produce a usable copy after ` +
          `${(performance.now() - started).toFixed(0)}ms (${why}); the partial copy was parked as ` +
          `${parked} rather than left under the backup name`,
      );
    }
    return { source, destination: target, pages };
  } catch (error) {
    if (created && existsSync(target)) rmSync(target, { force: true });
    throw error;
  } finally {
    database.close();
    if (created && existsSync(target)) chmodSync(target, 0o600);
  }
}

class BackupDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`the online copy was still running after ${String(timeoutMs)}ms and was given up on`);
    this.name = 'BackupDeadlineError';
  }
}

/**
 * Settle with the copy's page count, or fail at the deadline. The abandoned promise is left
 * attached to the parked file, which is why the parked name matters more than the timer.
 */
function settledWithin(promise: Promise<number>, timeoutMs: number): Promise<number> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<number>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new BackupDeadlineError(timeoutMs));
    }, timeoutMs);
    promise.then(
      (pages) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(pages);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Restore a backup into an ISOLATED target (roadmap §8: "restore into an
 * isolated environment"). The target is where the drill verifies the copy —
 * never the running database by default. Overwriting an existing target
 * requires an explicit force flag; the operator then swaps deliberately.
 *
 * Ordering is the whole safety story (both reproduced review failures were
 * destructive orderings): the source is rejected if it is the same file as
 * the target by any route, then validated as intact AND as a real Muse
 * schema (migration metadata + v1 core tables/columns; empty, unrelated,
 * incomplete or unsupported images are refused) BEFORE anything touches the
 * target, then copied to a temp file beside the target and re-verified —
 * only the validated temp copy is ever swapped onto the target.
 *
 * The swap itself is parked, not blind: the previous target and its WAL/SHM
 * sidecars are first renamed to a `.restore-previous-*` set (sidecar shapes
 * are pre-checked; non-regular sidecars are refused before any move), the
 * temp copy is renamed into place, and the parked previous is discarded
 * only after the swap and post-swap steps succeed. Any failure after the
 * swap renames the parked set back, restoring the target byte-for-byte; if
 * even that undo fails, the error names the parked copy. Guarantees hold
 * for the application being STOPPED (a live server keeps the WAL open and
 * can rewrite files after the swap). The database-plus-sidecar set is not
 * one atomic object — consistency is established by the stop requirement
 * plus park/undo, not claimed as atomicity.
 */
export interface DatabaseRestore {
  source: string;
  target: string;
  schema_version: number;
  latest_schema_version: number;
  counts: Record<string, number>;
}

/**
 * Reporting tables: counts for tables this surface knows about. Tables the
 * backup's schema version does not have yet are OMITTED (absent != zero:
 * swallowing a missing mandatory table as a `0` count is exactly the bug
 * the schema gate below refuses).
 */
const RESTORE_TABLES = [
  'projects',
  'memories',
  'memory_history',
  'sessions',
  'tool_calls',
] as const;

/**
 * Tables and anchor columns created by migration 1. Every genuine Muse
 * backup - at ANY supported version - has them; an empty file, an unrelated
 * SQLite database, or a hand-made stub does not. Column checks are anchors,
 * not the full schema: enough to refuse "tables with the right names but
 * the wrong shape" without pinning every historical column.
 */
const CORE_TABLE_COLUMNS: Record<string, readonly string[]> = {
  projects: ['id', 'name', 'created_at', 'updated_at'],
  memories: ['id', 'type', 'scope', 'content', 'content_hash', 'status', 'validation_status'],
  memory_supersessions: ['new_id', 'old_id'],
  memory_history: ['id', 'memory_id', 'action', 'next_status', 'actor', 'at'],
};

/**
 * Follow-up review at ab80ba0 (P1): checking only the v1 core let a
 * CURRENT-version image with a dropped later table (DROP TABLE sessions on
 * an otherwise healthy v8 database) pass the gate - and a normal startup
 * never repaired it because every migration was already recorded, so the
 * first sessions query failed with `no such table: sessions`. This is
 * detectable missing schema, not the disclosed undetectable-content
 * limitation.
 *
 * The gate therefore requires every table the backup's CLAIMED version
 * mandates. Each table maps to the migration that introduced it; tables
 * from later migrations than the claimed version are legitimately absent
 * (genuinely older backups stay restorable) and are simply omitted from
 * the count report. Anchor columns per table catch "right name, wrong
 * shape" stubs at every version, not just v1.
 */
const TABLE_INTRODUCED_IN: Record<string, number> = {
  projects: 1,
  memories: 1,
  memory_supersessions: 1,
  memory_history: 1,
  memory_fts: 1,
  sessions: 3,
  messages: 3,
  turn_memories: 3,
  ui_surfaces: 5,
  ui_events: 5,
  project_tasks: 6,
  tool_calls: 6,
  idempotency_keys: 8,
};

/** Anchor columns each versioned table must carry. */
const REQUIRED_TABLE_COLUMNS: Record<string, readonly string[]> = {
  ...CORE_TABLE_COLUMNS,
  // memories gains columns in later migrations (v2 superseded_by; v7
  // record-contract revision/actor): the full anchor set applies at the
  // claimed version via the per-column map below, older claims skip them.
  memories: [...(CORE_TABLE_COLUMNS.memories ?? []), 'superseded_by', 'revision', 'actor'],
  memory_fts: ['content', 'tags', 'memory_id'],
  sessions: ['id', 'project_id', 'status', 'created_at', 'updated_at'],
  messages: ['id', 'session_id', 'sequence', 'role', 'content', 'status', 'created_at'],
  turn_memories: ['message_id', 'memory_id', 'score', 'evidence', 'memory_type', 'scope'],
  ui_surfaces: ['id', 'session_id', 'title', 'spec_json', 'status', 'created_at'],
  ui_events: ['id', 'surface_id', 'action_id', 'values_json', 'created_at'],
  project_tasks: ['id', 'project_id', 'title', 'status', 'created_at', 'updated_at'],
  tool_calls: ['id', 'session_id', 'tool_id', 'arguments_json', 'status', 'created_at'],
  idempotency_keys: ['route', 'key', 'status', 'response', 'created_at'],
};

/**
 * `memories` is the only table that gains columns in later migrations
 * (v2 `superseded_by`; v7 record-contract `revision`/`actor`). Every other
 * versioned table is created whole by its migration, so its full anchor set
 * applies from its introduction version on.
 */
const MEMORIES_COLUMN_INTRODUCED_IN: Record<string, number> = {
  superseded_by: 2,
  revision: 7,
  actor: 7,
};

/**
 * Resolve a path through every symlink that exists on the way down, even when
 * the final component does not exist yet (realpathSync refuses those). This is
 * what catches "target resolves onto the source via an existing directory
 * symlink" style aliases before anything is written.
 */
function resolveUnderlyingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // The final component (or an intermediate one) does not exist yet.
  }
  const missing: string[] = [];
  let cursor = path;
  for (;;) {
    const parent = dirname(cursor);
    if (parent === cursor) return path;
    missing.unshift(basename(cursor));
    cursor = parent;
    try {
      return join(realpathSync(cursor), ...missing);
    } catch {
      // Keep walking up until an existing ancestor is found.
    }
  }
}

function integrityCheck(database: DatabaseSync): string {
  // A malformed image can make the PRAGMA itself throw instead of returning
  // a row; both shapes are "not ok", reported with the driver's message.
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined;
    return row?.integrity_check ?? 'unknown result';
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown result';
  }
}

/**
 * Validate the SOURCE before any copy: open read-only, integrity must be
 * 'ok' AND the image must pass the Muse schema gate. Returns the backup's
 * schema version. Throws naming the backup corrupt or unrestorable.
 */
function assertBackupUsable(source: string): number {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(source, { readOnly: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Backup is corrupt (not a readable SQLite database): ${source}: ${reason}`);
  }
  try {
    const result = integrityCheck(database);
    if (result !== 'ok') {
      throw new Error(`Backup is corrupt (integrity check failed): ${source}: ${result}`);
    }
    return assertRestorableMuseSchema(database, source);
  } finally {
    database.close();
  }
}

function tableNames(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`)
    .all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function columnNames(database: DatabaseSync, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

/**
 * The schema gate (beta review, P1; hardened at the ab80ba0 follow-up): SQLite's
 * integrity_check happily calls an EMPTY database 'ok' - zero application
 * tables read as zero counts and missing migration metadata reads as version
 * 0, so a forced restore of an empty or unrelated database "succeeded" and
 * destroyed a real one. Requiring only the v1 core was the second hole: a
 * current-version image missing a later table passed, and startup could not
 * repair it because the migrations were already recorded.
 *
 * A database is restorable here only if it carries the Muse migration
 * metadata (`schema_migrations` with a contiguous history at a supported
 * version >= 1) AND every table its CLAIMED version mandates with the
 * required anchor columns. Genuinely older Muse backups (any version >= 1)
 * pass because tables from later migrations are legitimately absent; empty
 * files, foreign SQLite images, hand-made stubs, incomplete histories,
 * current-version images with dropped tables/columns, and
 * future/unsupported versions are refused BEFORE anything touches the
 * target.
 */
function assertRestorableMuseSchema(database: DatabaseSync, origin: string): number {
  const names = tableNames(database);
  if (!names.has('schema_migrations')) {
    throw new Error(
      `Restore refused: not a Muse Recall database (no schema_migrations table): ${origin}`,
    );
  }
  let version = 0;
  let recorded = 0;
  try {
    version = currentSchemaVersion(database);
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version >= 1')
      .get() as { count: number } | undefined;
    recorded = row?.count ?? 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Restore refused: unreadable schema_migrations metadata: ${origin}: ${reason}`);
  }
  if (version < 1 || recorded < 1) {
    throw new Error(
      `Restore refused: database has no applied Muse migrations (schema version ${version}): ` +
        `${origin} - empty or unrelated images are never restorable over a Muse database`,
    );
  }
  // A future version is checked before contiguity: a v999 image is first and
  // foremost UNSUPPORTED, and reporting it as "incomplete history" misleads.
  const latest = latestVersion();
  if (version > latest) {
    throw new Error(
      `Restore refused: unsupported schema version ${version} (this build supports ` +
        `1..${latest}); restore with a build that knows this schema`,
    );
  }
  // History must be contiguous from 1..version: a database claiming version
  // 8 with only rows {1, 8} is not a Muse image this migrator can trust.
  let contiguous = 0;
  try {
    const row = database
      .prepare(
        'SELECT COUNT(DISTINCT version) AS count FROM schema_migrations WHERE version BETWEEN 1 AND ?',
      )
      .get(version) as { count: number } | undefined;
    contiguous = row?.count ?? 0;
  } catch {
    contiguous = -1;
  }
  if (contiguous !== version) {
    throw new Error(
      `Restore refused: schema_migrations history is incomplete or not contiguous ` +
        `(version ${version} claims ${Math.max(contiguous, 0)} predecessor rows): ${origin}`,
    );
  }
  for (const [table, anchors] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    if ((TABLE_INTRODUCED_IN[table] ?? 1) > version) continue; // genuinely older: legitimately absent
    if (!names.has(table)) {
      throw new Error(
        `Restore refused: backup claims schema version ${version} but is missing mandatory Muse table "${table}" (introduced in migration ${TABLE_INTRODUCED_IN[table] ?? 1}): ${origin}`,
      );
    }
    const columns = columnNames(database, table);
    const missing = anchors.filter((column) => {
      if (table === 'memories') {
        // v1 anchors always apply; later columns only from their versions.
        const introduced = MEMORIES_COLUMN_INTRODUCED_IN[column];
        if (introduced !== undefined && introduced > version) return false;
      }
      return !columns.has(column);
    });
    if (missing.length > 0) {
      throw new Error(
        `Restore refused: table "${table}" is missing mandatory columns ` +
          `${missing.map((column) => `"${column}"`).join(', ')}: ${origin}`,
      );
    }
  }
  return version;
}

export function restoreDatabase(
  backupFile: string,
  target: string,
  options: {
    force?: boolean;
    /**
     * TEST-ONLY SEAMS: `__rename` overrides the final rename that swaps the
     * validated temp copy onto the target; `__postSwap` runs (and may throw)
     * immediately AFTER the swap, so tests can prove the park/undo boundary.
     * Never set these in production code.
     */
    __rename?: (from: string, to: string) => void;
    __postSwap?: (destination: string) => void;
  } = {},
): DatabaseRestore {
  const source = resolve(backupFile);
  if (!existsSync(source)) throw new Error(`Backup not found: ${source}`);
  const destination = resolve(target);

  // Same-file refusal, regardless of force: identical realpath (this covers
  // symlink aliases both directions, including directory-symlink routes that
  // land on the source), or identical dev/ino (hard links).
  const sourceUnderlying = resolveUnderlyingPath(source);
  const targetUnderlying = resolveUnderlyingPath(destination);
  const aliased =
    sourceUnderlying === targetUnderlying ||
    (existsSync(source) &&
      existsSync(destination) &&
      (() => {
        const sourceStat = statSync(source);
        const targetStat = statSync(destination);
        return sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino;
      })());
  if (aliased) {
    throw new Error(
      `Restore refused: source and target are the same file (alias/hard link detected): ${source} -> ${destination}`,
    );
  }

  const targetExisted = existsSync(destination);
  if (targetExisted && !options.force) {
    throw new Error(
      `Restore target already exists: ${destination}. Restore into an isolated path, or pass force to replace it (an existing target is replaced only after the backup validates into a temp copy beside it).`,
    );
  }

  // Validate the source BEFORE touching the target in any way: integrity
  // plus the Muse schema gate (empty/unrelated/unsupported images never get
  // a chance to become "zero counts" at a swap).
  assertBackupUsable(source);

  // Sidecar shape pre-check (beta review, P2): stale WAL/SHM at the target
  // path MUST be cleared when the database is replaced - but only if they
  // are regular files we can move or remove. A directory, fifo or other
  // oddity at `<target>-wal` used to throw EISDIR AFTER the replacement;
  // now it is refused here, before any move, target untouched.
  if (targetExisted) {
    for (const sidecar of [`${destination}-wal`, `${destination}-shm`]) {
      if (!existsSync(sidecar)) continue;
      let regular = false;
      try {
        regular = statSync(sidecar).isFile();
      } catch {
        regular = false;
      }
      if (!regular) {
        throw new Error(
          `Restore refused: ${sidecar} exists and is not a regular file; stale WAL state ` +
            'cannot be cleared safely. With the application stopped, remove it manually and retry.',
        );
      }
    }
  }

  const tag = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const temp = join(dirname(destination), `.restore-${tag}.tmp`);
  // Parked previous state: the original database plus its WAL/SHM, kept
  // until the swap provably succeeds. Restored back on any later failure.
  const previous = `${destination}.restore-previous-${tag}`;
  const rename = options.__rename ?? renameSync;

  /** Moves recorded while parking, so an aborted park unwinds exactly. */
  const parkedMoves: Array<{ from: string; to: string }> = [];
  const park = (): void => {
    renameSync(destination, previous);
    parkedMoves.push({ from: destination, to: previous });
    for (const suffix of ['-wal', '-shm']) {
      const side = `${destination}${suffix}`;
      if (existsSync(side)) {
        renameSync(side, `${previous}${suffix}`);
        parkedMoves.push({ from: side, to: `${previous}${suffix}` });
      }
    }
  };
  const unpark = (): void => {
    for (const move of parkedMoves.reverse()) {
      try {
        renameSync(move.to, move.from);
      } catch {
        // Best-effort unwind; the caller's error will name the parked path.
      }
    }
    parkedMoves.length = 0;
  };

  try {
    copyFileSync(source, temp);
    chmodSync(temp, 0o600);

    const database = new DatabaseSync(temp, { readOnly: true });
    let result: DatabaseRestore;
    try {
      const integrity = integrityCheck(database);
      if (integrity !== 'ok') {
        throw new Error(
          `Restored backup failed integrity check: ${integrity} (temp copy at ${temp})`,
        );
      }
      // Re-run the full gate on the bytes that ACTUALLY landed, not on the
      // source file (a copy can be truncated mid-write on a full disk).
      const schemaVersion = assertRestorableMuseSchema(database, temp);
      const names = tableNames(database);
      const counts: Record<string, number> = {};
      for (const table of RESTORE_TABLES) {
        if (!names.has(table)) continue; // absent != zero; the gate above refuses missing MANDATORY tables
        const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
          | { count: number }
          | undefined;
        counts[table] = row?.count ?? 0;
      }
      result = {
        source,
        target: destination,
        schema_version: schemaVersion,
        latest_schema_version: latestVersion(),
        counts,
      };
    } finally {
      database.close();
      // A WAL-mode image leaves -wal/-shm beside the temp file from the
      // verification open; they are verification artifacts, never shipped.
      rmSync(`${temp}-wal`, { force: true });
      rmSync(`${temp}-shm`, { force: true });
    }

    // Park the previous target (database + sidecars together) so a later
    // failure can put the whole picture back. Only then swap the validated
    // temp copy in: rename is an atomic replacement on POSIX, so there is
    // never a moment where the target path holds nothing.
    if (targetExisted) {
      try {
        park();
      } catch (error) {
        unpark(); // unwind exactly what was moved before the abort
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Restore aborted before replacing ${destination}: could not park the existing ` +
            `target (${reason}); unwound, the target is intact at its original path`,
        );
      }
    }

    try {
      rename(temp, destination);
      options.__postSwap?.(destination);
    } catch (failure) {
      // Failure at or after the swap (beta review, P2): the replacement may
      // already be in place; undo it with the parked original, sidecars and
      // all, instead of reporting a failure that destroyed the target.
      let undone = true;
      try {
        rmSync(destination, { force: true });
        rmSync(`${destination}-wal`, { force: true });
        rmSync(`${destination}-shm`, { force: true });
        for (const move of [...parkedMoves].reverse()) {
          renameSync(move.to, move.from);
        }
        parkedMoves.length = 0;
      } catch (undoError) {
        undone = false;
        const reason = undoError instanceof Error ? undoError.message : String(undoError);
        throw new Error(
          `Restore of ${source} onto ${destination} failed (${
            failure instanceof Error ? failure.message : String(failure)
          }) AND the automatic undo failed (${reason}). The ORIGINAL database is preserved ` +
            `at ${previous} (with its -wal/-shm sidecars): with the application stopped, ` +
            `rename it back to ${destination} yourself`,
          { cause: failure },
        );
      }
      const reason = failure instanceof Error ? failure.message : String(failure);
      throw new Error(
        `Restore of ${source} onto ${destination} failed (${reason}); target restored to its ` +
          `previous bytes${undone ? '' : ' via partial undo - check the parked copy'}`,
        { cause: failure },
      );
    }

    // Commit point reached: the restored database is in place and readable.
    // Stale sidecars of the ORIGINAL database were parked with it, so the
    // replacement can never be shadowed by the previous WAL state; now the
    // parked set is discarded (deliberately: force was required to get here).
    rmSync(previous, { force: true });
    rmSync(`${previous}-wal`, { force: true });
    rmSync(`${previous}-shm`, { force: true });
    return result;
  } catch (error) {
    // Any failure before (or during) the copy/park/swap attempt: remove the
    // temp file and any sidecars it grew, leaving the existing target (or
    // its parked-then-restored original) and the source exactly as they were.
    rmSync(temp, { force: true });
    rmSync(`${temp}-wal`, { force: true });
    rmSync(`${temp}-shm`, { force: true });
    throw error;
  }
}
