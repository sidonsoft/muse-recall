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
  {
    version: 3,
    name: 'sessions_messages_and_turn_evidence',
    up: (db) => {
      db.exec(`
        -- A conversation. Sessions are independent: a new session never
        -- inherits another session's transcript, only project memory.
        CREATE TABLE sessions (
          id         TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          title      TEXT,
          status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_sessions_project ON sessions (project_id, updated_at DESC);
        CREATE INDEX idx_sessions_status ON sessions (status, updated_at DESC);

        -- Message ordering is enforced by (session_id, sequence) with a unique
        -- constraint, not by timestamps: two turns in the same millisecond must
        -- still have a deterministic order.
        CREATE TABLE messages (
          id              TEXT PRIMARY KEY,
          session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          sequence        INTEGER NOT NULL,
          role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content         TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'complete'
                            CHECK (status IN ('complete', 'interrupted', 'failed')),
          input_tokens    INTEGER NOT NULL DEFAULT 0,
          output_tokens   INTEGER NOT NULL DEFAULT 0,
          latency_ms      INTEGER,
          -- Assembled-context accounting for the turn that produced this message.
          context_json    TEXT,
          created_at      TEXT NOT NULL,
          UNIQUE (session_id, sequence)
        );

        CREATE INDEX idx_messages_session ON messages (session_id, sequence);

        -- Retrieval provenance for a turn.
        --
        -- memory_id deliberately has NO foreign key: purging a memory must not
        -- erase the record that it influenced an answer. No memory content is
        -- copied here — only the ranking evidence and shape needed to explain
        -- the turn. Content is resolved at read time, and disappears with the
        -- memory.
        CREATE TABLE turn_memories (
          message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          memory_id   TEXT NOT NULL,
          score       REAL NOT NULL,
          evidence    TEXT NOT NULL,
          memory_type TEXT NOT NULL,
          scope       TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
          truncated   INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
          characters  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          PRIMARY KEY (message_id, memory_id)
        );

        CREATE INDEX idx_turn_memories_memory ON turn_memories (memory_id);
      `);
    },
  },
  {
    version: 4,
    name: 'porter_stemming_for_keyword_retrieval',
    up: (db) => {
      // The unicode61 tokenizer treats "building" and "build" as different
      // words, which made ordinary questions miss obvious memories. Porter
      // stemming fixes the common inflection cases without any new dependency.
      // The index is rebuilt from the table, so no data is lost.
      db.exec(`
        DROP TRIGGER IF EXISTS memories_fts_insert;
        DROP TRIGGER IF EXISTS memories_fts_content_update;
        DROP TRIGGER IF EXISTS memories_fts_delete;
        DROP TABLE IF EXISTS memory_fts;

        CREATE VIRTUAL TABLE memory_fts USING fts5(
          content,
          tags,
          memory_id UNINDEXED,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );

        -- Deleted rows stay excluded from the index, matching the soft-delete
        -- guarantee: tombstones are never retrievable.
        INSERT INTO memory_fts (content, tags, memory_id)
          SELECT content, tags, id FROM memories WHERE status != 'deleted';

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
    version: 5,
    name: 'ui_surfaces_and_events',
    up: (db) => {
      db.exec(`
        -- A validated, declarative interface generated for a conversation.
        -- The spec is stored as JSON and re-validated on read, so a corrupted
        -- row can never be rendered.
        CREATE TABLE ui_surfaces (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          message_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
          title        TEXT NOT NULL,
          spec_json    TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'submitted', 'dismissed')),
          created_at   TEXT NOT NULL,
          submitted_at TEXT
        );

        CREATE INDEX idx_ui_surfaces_session ON ui_surfaces (session_id, created_at DESC);

        -- Append-only record of user submissions. Values are validated against
        -- the surface before they are written here.
        CREATE TABLE ui_events (
          id          TEXT PRIMARY KEY,
          surface_id  TEXT NOT NULL REFERENCES ui_surfaces(id) ON DELETE CASCADE,
          action_id   TEXT NOT NULL,
          values_json TEXT NOT NULL,
          created_at  TEXT NOT NULL
        );

        CREATE INDEX idx_ui_events_surface ON ui_events (surface_id, created_at ASC);
      `);
    },
  },
  {
    version: 6,
    name: 'project_tasks_and_tool_audit',
    up: (db) => {
      db.exec(`
        -- Project tasks. Created by tools only; there is no arbitrary SQL path.
        CREATE TABLE project_tasks (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title       TEXT NOT NULL,
          description TEXT,
          status      TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo', 'in_progress', 'done')),
          created_by  TEXT NOT NULL DEFAULT 'agent',
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE INDEX idx_project_tasks_project ON project_tasks (project_id, created_at DESC);

        -- Append-only audit of every requested tool call, including invalid and
        -- denied ones. Arguments and results are stored as JSON so a demo can be
        -- verified from the database.
        CREATE TABLE tool_calls (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          message_id            TEXT REFERENCES messages(id) ON DELETE SET NULL,
          project_id            TEXT,
          tool_id               TEXT NOT NULL,
          arguments_json        TEXT NOT NULL,
          status                TEXT NOT NULL
                                  CHECK (status IN ('pending', 'executed', 'failed', 'denied', 'invalid')),
          requires_confirmation INTEGER NOT NULL DEFAULT 0,
          result_json           TEXT,
          error                 TEXT,
          duration_ms           INTEGER,
          created_at            TEXT NOT NULL,
          decided_at            TEXT,
          executed_at           TEXT
        );

        CREATE INDEX idx_tool_calls_session ON tool_calls (session_id, created_at ASC);
        CREATE INDEX idx_tool_calls_status ON tool_calls (status);
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
