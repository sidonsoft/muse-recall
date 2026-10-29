import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';

export interface OpenDatabaseOptions {
  /** File path, or `:memory:` for an ephemeral database. */
  path: string;
  /** Enable WAL journaling. Ignored for in-memory databases. */
  wal?: boolean;
}

export interface OpenedDatabase {
  db: DatabaseSync;
  path: string;
  close: () => void;
}

function ensurePrivateDirectory(directory: string): void {
  // A caller may deliberately point DATABASE_PATH into an existing shared
  // directory. Only a directory this code creates may be chmodded.
  if (existsSync(directory)) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function ensurePrivateFile(file: string): void {
  closeSync(openSync(file, 'a', 0o600));
  chmodSync(file, 0o600);
}

function chmodIfExists(file: string): void {
  try {
    chmodSync(file, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Run synchronous filesystem work with an owner-only umask.
 *
 * SQLite creates `-wal`/`-shm` beside the database without letting us pass a
 * mode. The temporary umask closes the window before the files are chmodded.
 */
function withPrivateUmask<T>(operation: () => T): T {
  const previous = process.umask(0o077);
  try {
    return operation();
  } finally {
    process.umask(previous);
  }
}

/**
 * Open a SQLite database with the pragmas this application depends on.
 *
 * `node:sqlite` is used deliberately instead of a native add-on: it ships
 * with Node (>= 22.5), bundles FTS5, and needs no compilation step, which
 * keeps a hackathon checkout to a single `pnpm install` on any machine.
 *
 * Memory content is private data, so the database and its WAL/SHM sidecars are
 * owner-only, and a parent directory this code creates is 0700. An existing
 * parent is left untouched because it may be shared or system-owned. The app
 * opens one connection, and SQLite keeps the sidecars for the lifetime of that
 * connection.
 */
export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
  const isFile = options.path !== ':memory:';
  if (isFile) {
    ensurePrivateDirectory(dirname(options.path));
    ensurePrivateFile(options.path);
  }

  const db = withPrivateUmask(() => {
    const database = new DatabaseSync(options.path);

    // Durability and concurrency settings. These must be set before any
    // statement runs, so they live here rather than in a migration.
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA busy_timeout = 5000');
    if (options.path !== ':memory:' && options.wal !== false) {
      database.exec('PRAGMA journal_mode = WAL');
      database.exec('PRAGMA synchronous = NORMAL');
    }

    runMigrations(database);
    return database;
  });

  if (isFile) {
    chmodIfExists(options.path);
    if (options.wal !== false) {
      chmodIfExists(`${options.path}-wal`);
      chmodIfExists(`${options.path}-shm`);
    }
  }

  return {
    db,
    path: options.path,
    close: () => {
      db.close();
    },
  };
}

/** Engine identity reported in health checks. */
export function sqliteVersion(db: DatabaseSync): string {
  const row = db.prepare('SELECT sqlite_version() AS version').get() as
    | { version: string }
    | undefined;
  return row?.version ?? 'unknown';
}
