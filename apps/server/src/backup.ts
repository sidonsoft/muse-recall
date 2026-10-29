import { chmodSync, closeSync, existsSync, openSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

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
