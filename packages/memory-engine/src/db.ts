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

/**
 * Open a SQLite database with the pragmas this application depends on.
 *
 * `node:sqlite` is used deliberately instead of a native add-on: it ships
 * with Node (>= 22.5), bundles FTS5, and needs no compilation step, which
 * keeps a hackathon checkout to a single `pnpm install` on any machine.
 */
export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
  const db = new DatabaseSync(options.path);

  // Durability and concurrency settings. These must be set before any
  // statement runs, so they live here rather than in a migration.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (options.path !== ':memory:' && options.wal !== false) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }

  runMigrations(db);

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
