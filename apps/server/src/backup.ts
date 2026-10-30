import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
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

export function restoreDatabase(
  backupFile: string,
  target: string,
  options: { force?: boolean } = {},
): DatabaseRestore {
  const source = resolve(backupFile);
  if (!existsSync(source)) throw new Error(`Backup not found: ${source}`);
  const destination = resolve(target);
  if (existsSync(destination)) {
    if (!options.force) {
      throw new Error(
        `Restore target already exists: ${destination}. Restore into an isolated path, or pass force to replace it.`,
      );
    }
    rmSync(destination, { force: true });
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);

  const database = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined;
    if (integrity?.integrity_check !== 'ok') {
      throw new Error(
        `Restored backup failed integrity check: ${integrity?.integrity_check ?? 'unknown result'}`,
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
    return {
      source,
      target: destination,
      schema_version: currentSchemaVersion(database),
      latest_schema_version: latestVersion(),
      counts,
    };
  } finally {
    database.close();
  }
}
