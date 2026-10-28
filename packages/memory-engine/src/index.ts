/**
 * @mml/memory-engine — persistent, correctable memory.
 *
 * Layers:
 *   engine.ts     storage, corrections, deletion, retention (writes)
 *   retrieval.ts  scoring, budgets, evidence (reads, no writes)
 *   context.ts    prompt rendering and cost accounting
 *   rows.ts       row → contract mapping
 *   migrations.ts versioned schema
 */

export { memoryContentHash, normaliseContent } from './content-hash.js';
export type { MemoryBlockLayout } from './context.js';
export {
  describeRetrieval,
  escapeMemoryText,
  formatMemoryContext,
  renderedMemoryCharacters,
  renderMemoryBlock,
  renderMemoryEntry,
  renderMemoryLayout,
} from './context.js';
export type { OpenDatabaseOptions, OpenedDatabase } from './db.js';
export { openDatabase, sqliteVersion } from './db.js';
export type { MemoryActor, MemoryEngineOptions } from './engine.js';
export { MemoryEngine } from './engine.js';
export { MemoryConflictError, MemoryError, MemoryNotFoundError } from './errors.js';
export { toFtsQuery, tokenizeSearchText } from './fts.js';
export type { DatabaseProbe } from './health.js';
export { probeDatabase } from './health.js';
export type { Migration } from './migrations.js';
export {
  currentSchemaVersion,
  latestVersion,
  MIGRATIONS,
  runMigrations,
} from './migrations.js';
export type { RetrievalOptions } from './retrieval.js';
export { RECENCY_HALF_LIFE_DAYS, retrieveMemories, TYPE_PRIORITY } from './retrieval.js';
