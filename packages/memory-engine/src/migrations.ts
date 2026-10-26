import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

/**
 * Ordered, append-only schema history.
 *
 * Rules for adding a migration:
 *   1. Never edit a migration that has shipped — add a new one.
 *   2. Versions must be strictly increasing and contiguous from 1.
 *   3. `up` runs inside a transaction; do not manage one yourself.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core_memory_schema',
    up: (db) => {
      db.exec(`
        -- Projects give project-scoped memories a stable anchor.
        CREATE TABLE projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        -- Memories: the durable unit of knowledge.
        CREATE TABLE memories (
          id                TEXT PRIMARY KEY,
          type              TEXT NOT NULL,
          scope             TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
          content           TEXT NOT NULL,
          source_session_id TEXT,
          source_reference  TEXT,
          confidence        REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          validation_status TEXT NOT NULL CHECK (
                              validation_status IN ('unverified', 'verified', 'disputed')
                            ),
          status            TEXT NOT NULL CHECK (
                              status IN ('active', 'superseded', 'deleted', 'expired')
                            ),
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          expires_at        TEXT,
          -- Normalised content fingerprint used to reject duplicates.
          content_hash      TEXT NOT NULL,
          tags              TEXT NOT NULL DEFAULT '[]',
          -- A project-scoped row must name its project.
          CHECK (scope = 'global' OR project_id IS NOT NULL)
        );

        CREATE INDEX idx_memories_project_status
          ON memories (project_id, status);
        CREATE INDEX idx_memories_type
          ON memories (type);
        CREATE INDEX idx_memories_hash
          ON memories (content_hash);
        CREATE INDEX idx_memories_status_expiry
          ON memories (status, expires_at);

        -- Append-only supersession edges: new_id replaced old_id.
        -- Separate from memories so a correction never mutates the history
        -- it depends on, and multiple records can be replaced at once.
        CREATE TABLE memory_supersessions (
          new_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          old_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (new_id, old_id)
        );

        CREATE INDEX idx_supersessions_old ON memory_supersessions (old_id);

        -- Audit trail: one row per lifecycle transition.
        CREATE TABLE memory_history (
          id              TEXT PRIMARY KEY,
          memory_id       TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          action          TEXT NOT NULL CHECK (
                            action IN ('created', 'updated', 'superseded',
                                       'deleted', 'expired', 'purged')
                          ),
          previous_status TEXT,
          next_status     TEXT NOT NULL,
          reason          TEXT,
          actor           TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
          at              TEXT NOT NULL
        );

        CREATE INDEX idx_history_memory ON memory_history (memory_id, at);

        -- Full-text index for keyword retrieval. Kept in sync by triggers for
        -- inserts, content changes, and hard deletes; a soft delete removes
        -- its row explicitly so tombstoned memories can never be retrieved.
        CREATE VIRTUAL TABLE memory_fts USING fts5(
          content,
          tags,
          memory_id UNINDEXED,
          tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
          INSERT INTO memory_fts (content, tags, memory_id)
          VALUES (new.content, new.tags, new.id);
        END;

        CREATE TRIGGER memories_fts_content_update AFTER UPDATE OF content, tags ON memories BEGIN
          DELETE FROM memory_fts WHERE memory_id = old.id;
          INSERT INTO memory_fts (content, tags, memory_id)
          VALUES (new.content, new.tags, new.id);
        END;

        CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
          DELETE FROM memory_fts WHERE memory_id = old.id;
        END;
      `);
    },
  },
  {
    version: 2,
    name: 'supersession_pointer_and_retrieval_indexes',
    up: (db) => {
      db.exec(`
        -- The active record that replaced this one. The supersession edge
        -- table stays authoritative for the full chain; this column makes the
        -- common "what replaced this?" lookup a single row read.
        ALTER TABLE memories ADD COLUMN superseded_by TEXT
          REFERENCES memories(id) ON DELETE SET NULL;

        CREATE INDEX idx_memories_superseded_by ON memories (superseded_by);

        -- Retrieval filters on status + scope first, then ranks. This index
        -- matches that access pattern so scope isolation stays cheap as the
        -- memory count grows.
        CREATE INDEX idx_memories_scope_status
          ON memories (scope, project_id, status);

        -- Recency ordering for the no-query candidate path.
        CREATE INDEX idx_memories_status_updated
          ON memories (status, updated_at DESC);

        -- Reverse edge lookup: "what did this record supersede?"
        CREATE INDEX idx_supersessions_new ON memory_supersessions (new_id);
      `);
    },
  },
];

/** Highest migration version defined in code. */
export function latestVersion(): number {
  return MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
}

/** Version applied in the database, or 0 when uninitialised. */
export function currentSchemaVersion(db: DatabaseSync): number {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`)
    .get();
  if (!exists) return 0;
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/**
 * Apply every pending migration in order, each in its own transaction.
 * Returns the versions that were applied by this call.
 */
export function runMigrations(db: DatabaseSync): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  );

  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      ran.push(migration.version);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  return ran;
}
