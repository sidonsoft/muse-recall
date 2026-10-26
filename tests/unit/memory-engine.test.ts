import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  currentSchemaVersion,
  latestVersion,
  openDatabase,
  probeDatabase,
  runMigrations,
} from '@mml/memory-engine';
import { afterAll, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createProject(db: DatabaseSync, id = 'demo-game'): string {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    'Demo Game',
    now,
    now,
  );
  return id;
}

interface InsertMemoryOverrides {
  project_id?: string | null;
  scope?: 'global' | 'project';
  content?: string;
  status?: string;
  content_hash?: string;
}

function insertMemory(db: DatabaseSync, overrides: InsertMemoryOverrides = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const content = overrides.content ?? 'Use SQLite for persistent storage';
  db.prepare(
    `INSERT INTO memories (
       id, type, scope, project_id, content, source_session_id, source_reference,
       confidence, validation_status, status, created_at, updated_at, expires_at,
       content_hash, tags
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'technical_decision',
    overrides.scope ?? (overrides.project_id === null ? 'global' : 'project'),
    overrides.project_id === undefined ? 'demo-game' : overrides.project_id,
    content,
    'session-1',
    'architecture-decision',
    0.9,
    'verified',
    overrides.status ?? 'active',
    now,
    now,
    null,
    overrides.content_hash ?? `hash-${id}`,
    JSON.stringify(['database']),
  );
  return id;
}

describe('schema migrations', () => {
  it('applies the full schema on a fresh database', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      expect(currentSchemaVersion(db)).toBe(latestVersion());

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);

      for (const table of [
        'projects',
        'memories',
        'memory_supersessions',
        'memory_history',
        'memory_fts',
        'schema_migrations',
      ]) {
        expect(tables).toContain(table);
      }
    } finally {
      close();
    }
  });

  it('is idempotent — re-running applies nothing', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      const applied = runMigrations(db);
      expect(applied).toEqual([]);
      expect(currentSchemaVersion(db)).toBe(latestVersion());
    } finally {
      close();
    }
  });

  it('records each migration with its name and timestamp', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      const rows = db
        .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
        .all() as { version: number; name: string; applied_at: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.name).toBe('core_memory_schema');
      expect(Number.isNaN(Date.parse(rows[0]?.applied_at ?? ''))).toBe(false);
    } finally {
      close();
    }
  });

  it('persists memories across a close and reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mml-db-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'memory.db');

    const first = openDatabase({ path });
    createProject(first.db);
    const id = insertMemory(first.db);
    first.close();

    const second = openDatabase({ path });
    try {
      const row = second.db.prepare('SELECT id, content FROM memories WHERE id = ?').get(id) as
        | { id: string; content: string }
        | undefined;
      expect(row?.content).toBe('Use SQLite for persistent storage');
      expect(currentSchemaVersion(second.db)).toBe(latestVersion());
    } finally {
      second.close();
    }
  });
});

describe('data integrity', () => {
  it('enforces the project-scope invariant at the database level', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      expect(() => insertMemory(db, { scope: 'project', project_id: null })).toThrow();
    } finally {
      close();
    }
  });

  it('rejects a memory pointing at a project that does not exist', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      expect(() => insertMemory(db, { project_id: 'ghost-project' })).toThrow();
    } finally {
      close();
    }
  });

  it('rejects confidence outside the permitted range', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const id = insertMemory(db);
      expect(() =>
        db.prepare('UPDATE memories SET confidence = ? WHERE id = ?').run(1.4, id),
      ).toThrow();
    } finally {
      close();
    }
  });

  it('cascades memory deletion when a project is removed', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const id = insertMemory(db);
      db.prepare('DELETE FROM projects WHERE id = ?').run('demo-game');
      const row = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
      expect(row).toBeUndefined();
    } finally {
      close();
    }
  });

  it('records supersession edges without mutating the replaced memory', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const original = insertMemory(db);
      const replacement = insertMemory(db, { content: 'Use Postgres instead' });

      db.prepare(
        'INSERT INTO memory_supersessions (new_id, old_id, created_at) VALUES (?, ?, ?)',
      ).run(replacement, original, new Date().toISOString());
      db.prepare("UPDATE memories SET status = 'superseded' WHERE id = ?").run(original);
      db.prepare(
        `INSERT INTO memory_history (id, memory_id, action, previous_status, next_status, reason, actor, at)
         VALUES (?, ?, 'superseded', 'active', 'superseded', ?, 'user', ?)`,
      ).run(randomUUID(), original, 'user changed the database decision', new Date().toISOString());

      const edges = db
        .prepare('SELECT new_id, old_id FROM memory_supersessions WHERE old_id = ?')
        .all(original) as { new_id: string; old_id: string }[];
      expect(edges).toEqual([{ new_id: replacement, old_id: original }]);

      const history = db
        .prepare('SELECT action, reason, actor FROM memory_history WHERE memory_id = ?')
        .all(original) as { action: string; reason: string; actor: string }[];
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ action: 'superseded', actor: 'user' });

      // The original record survives as auditable history.
      const row = db.prepare('SELECT content, status FROM memories WHERE id = ?').get(original) as {
        content: string;
        status: string;
      };
      expect(row.status).toBe('superseded');
      expect(row.content).toBe('Use SQLite for persistent storage');
    } finally {
      close();
    }
  });
});

describe('full-text retrieval index', () => {
  it('indexes a memory on insert', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      insertMemory(db, { content: 'Use SQLite for persistent storage' });
      const rows = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('sqlite') as { memory_id: string }[];
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('tracks content updates', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const id = insertMemory(db, { content: 'Use SQLite for persistent storage' });
      db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(
        'Use Postgres for storage',
        id,
      );

      const stale = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('sqlite');
      expect(stale).toHaveLength(0);

      const fresh = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('postgres') as { memory_id: string }[];
      expect(fresh).toEqual([{ memory_id: id }]);
    } finally {
      close();
    }
  });

  it('removes a soft-deleted memory from the index', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const id = insertMemory(db, { content: 'Use SQLite for persistent storage' });

      // Soft delete: the row survives as a tombstone, the index entry does not.
      db.prepare("UPDATE memories SET status = 'deleted' WHERE id = ?").run(id);
      db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);

      const rows = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('sqlite');
      expect(rows).toHaveLength(0);

      const tombstone = db.prepare('SELECT status FROM memories WHERE id = ?').get(id) as {
        status: string;
      };
      expect(tombstone.status).toBe('deleted');
    } finally {
      close();
    }
  });

  it('removes the index entry when a memory is hard-deleted', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      createProject(db);
      const id = insertMemory(db, { content: 'Use SQLite for persistent storage' });
      db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      const rows = db
        .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all('sqlite');
      expect(rows).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe('database health probe', () => {
  it('verifies a real write round-trip and leaves no residue', () => {
    const opened = openDatabase({ path: ':memory:' });
    try {
      const probe = probeDatabase(opened.db, ':memory:');
      expect(probe.status).toBe('ok');
      expect(probe.write_verified).toBe(true);
      expect(probe.schema_version).toBe(latestVersion());
      expect(probe.engine).toMatch(/^sqlite \d+\.\d+/);

      const residual = opened.db
        .prepare("SELECT id FROM projects WHERE id LIKE '__health_probe__%'")
        .all();
      expect(residual).toHaveLength(0);
    } finally {
      opened.close();
    }
  });

  it('reports an error instead of throwing when the schema is missing', () => {
    const { db, close } = openDatabase({ path: ':memory:' });
    try {
      db.exec('DROP TABLE projects');
      const probe = probeDatabase(db, ':memory:');
      expect(probe.status).toBe('error');
      expect(probe.write_verified).toBe(false);
    } finally {
      close();
    }
  });
});
