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
): Promise<DatabaseBackup> {
  if (!existsSync(source)) {
    throw new Error(`Database not found: ${source}`);
  }

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

    const pages = await backup(database, target);
    return { source, destination: target, pages };
  } catch (error) {
    if (created) rmSync(target, { force: true });
    throw error;
  } finally {
    database.close();
    if (created && existsSync(target)) chmodSync(target, 0o600);
  }
}

/**
 * Restore a backup into an ISOLATED target (roadmap §8: "restore into an
 * isolated environment"). The target is where the drill verifies the copy —
 * never the running database by default. Overwriting an existing target
 * requires an explicit force flag; the operator then swaps deliberately.
 *
 * Ordering is the whole safety story (both reproduced review failures were
 * destructive orderings): the source is rejected if it is the same file as
 * the target by any route, then validated as intact BEFORE anything touches
 * the target, then copied to a temp file beside the target and verified —
 * only the validated temp copy is ever renamed onto the target. Every
 * failure path leaves the existing target and the source byte-for-byte as
 * they were; the source is never deleted or modified.
 */
export interface DatabaseRestore {
  source: string;
  target: string;
  schema_version: number;
  latest_schema_version: number;
  counts: Record<string, number>;
}

const RESTORE_TABLES = [
  'projects',
  'memories',
  'memory_history',
  'sessions',
  'tool_calls',
] as const;

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
 * Validate the SOURCE before any copy: open read-only, integrity check must
 * be 'ok'. Throws naming the backup corrupt.
 */
function assertBackupIntact(source: string): void {
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
  } finally {
    database.close();
  }
}

export function restoreDatabase(
  backupFile: string,
  target: string,
  options: {
    force?: boolean;
    /**
     * TEST-ONLY SEAM: overrides the final rename that swaps the validated
     * temp copy onto the target, so tests can inject a replacement failure.
     * Never set this in production code.
     */
    __rename?: (from: string, to: string) => void;
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

  // Validate the source BEFORE touching the target in any way.
  assertBackupIntact(source);

  // Copy to a temp file in the SAME directory as the target, then verify the
  // temp copy — validating the bytes that actually landed, not the source.
  const temp = join(
    dirname(destination),
    `.restore-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
  );
  const rename = options.__rename ?? renameSync;
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
      const counts: Record<string, number> = {};
      for (const table of RESTORE_TABLES) {
        try {
          const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
            | { count: number }
            | undefined;
          counts[table] = row?.count ?? 0;
        } catch {
          counts[table] = 0;
        }
      }
      result = {
        source,
        target: destination,
        schema_version: currentSchemaVersion(database),
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

    // Only now replace the target. rename is an atomic replacement on POSIX,
    // so the existing target is never removed before the swap succeeds; a
    // failed replacement leaves its original bytes in place.
    rename(temp, destination);
    // Drop any sidecars at the target path that would shadow the restored
    // file with stale WAL state from the replaced database.
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
    return result;
  } catch (error) {
    // Any failure after (or during) the temp copy: remove the temp file and
    // any sidecars it grew, leaving the existing target and the source
    // exactly as they were.
    rmSync(temp, { force: true });
    rmSync(`${temp}-wal`, { force: true });
    rmSync(`${temp}-shm`, { force: true });
    throw error;
  }
}
