/**
 * @mml/memory-engine — persistent, correctable memory storage.
 *
 * Phase 1 delivers the durable foundation: connection handling, a versioned
 * migration runner, the core schema (memories, supersession edges, audit
 * history, FTS5 index), and a health probe. Retrieval, deduplication, and the
 * correction workflow land in Phase 2 on top of these tables.
 */

export type { OpenDatabaseOptions, OpenedDatabase } from './db.js';
export { openDatabase, sqliteVersion } from './db.js';
export type { DatabaseProbe } from './health.js';
export { probeDatabase } from './health.js';
export type { Migration } from './migrations.js';
export {
  currentSchemaVersion,
  latestVersion,
  MIGRATIONS,
  runMigrations,
} from './migrations.js';
