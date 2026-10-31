import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryEngine, MIGRATIONS, openDatabase } from '@mml/memory-engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupDatabase,
  defaultBackupPath,
  resolveBackupDestination,
  restoreDatabase,
} from '../../apps/server/src/backup.js';

/**
 * The restore half of the backup story (roadmap §8): integrity-checked
 * restores, isolated targets, and an explicit force flag for deliberate
 * replacement. The standing end-to-end drill lives in `pnpm backup:drill`.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'backup-restore-'));
  dirs.push(dir);
  return dir;
}

async function seeded(path: string): Promise<void> {
  const database = openDatabase({ path, wal: true });
  const engine = new MemoryEngine(database.db);
  engine.ensureProject('alpha');
  engine.create({
    type: 'contextual_fact',
    scope: 'project',
    project_id: 'alpha',
    content: 'a fact that must survive restore',
    source: { session_id: null, reference: null },
    confidence: 0.8,
    validation_status: 'verified',
    expires_at: null,
    tags: [],
  } as never);
  database.close();
}

describe('restoreDatabase (roadmap §8)', () => {
  it('round-trips an online backup into an isolated target', async () => {
    const dir = workspace();
    const source = join(dir, 'live.db');
    await seeded(source);
    const backup = await backupDatabase(source, join(dir, 'snap.db'));
    const restored = restoreDatabase(backup.destination, join(dir, 'isolated.db'));
    expect(restored.counts['memories']).toBe(1);
    expect(restored.counts['projects']).toBe(1);
    expect(restored.schema_version).toBeGreaterThanOrEqual(6);
    const database = openDatabase({ path: restored.target, wal: false });
    const engine = new MemoryEngine(database.db);
    expect(engine.list({ all_projects: true }).items[0]?.content).toContain('survive restore');
    database.close();
  });

  it('refuses an existing target unless force is explicit', async () => {
    const dir = workspace();
    const source = join(dir, 'live.db');
    await seeded(source);
    const backup = await backupDatabase(source);
    const target = join(dir, 'existing.db');
    writeFileSync(target, 'do not clobber', 'utf8');

    expect(() => restoreDatabase(backup.destination, target)).toThrow(
      /Restore target already exists/,
    );
    expect(readFileSync(target, 'utf8')).toBe('do not clobber');

    const restored = restoreDatabase(backup.destination, target, { force: true });
    expect(restored.counts['memories']).toBe(1);
    expect(readFileSync(target, 'utf8')).not.toBe('do not clobber');
  });

  it('rejects a source that is not a SQLite database via the integrity check path', () => {
    const dir = workspace();
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'this is not a database\n', 'utf8');
    expect(() => restoreDatabase(junk, join(dir, 'target.db'))).toThrow();
  });

  it('names backups deterministically per timestamp and puts them in directories', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    expect(defaultBackupPath('/data/app.db', now)).toBe('/data/app.db.backup-20261030T120000Z');
    const dir = workspace();
    expect(resolveBackupDestination('/data/app.db', dir, now)).toBe(
      join(dir, 'app.db.backup-20261030T120000Z'),
    );
  });

  it('the restored file carries owner-only permissions', async () => {
    const dir = workspace();
    const source = join(dir, 'live.db');
    await seeded(source);
    const backup = await backupDatabase(source);
    const target = join(dir, 'mode.db');
    restoreDatabase(backup.destination, target);
    expect(existsSync(target)).toBe(true);
    // mode checked via stat through the restored record's existence; the
    // permission bits are asserted where the filesystem reports them.
    const { statSync } = await import('node:fs');
    expect(statSync(target).mode & 0o077).toBe(0);
  });

  /**
   * Regression pins for the two reproduced destructive failures (corrupt
   * force-restore overwriting a live target; force + source==target deleting
   * the backup) and every related alias/copy/replacement failure path: the
   * existing target keeps its original bytes and the source is never touched.
   */
  describe('failure paths preserve the target byte-for-byte', () => {
    function leftoverTemps(dir: string): string[] {
      return readdirSync(dir).filter(
        (name) => name.startsWith('.restore-') || name.includes('restore-previous'),
      );
    }

    it('a corrupt backup with force throws and leaves target and source bytes identical', async () => {
      const dir = workspace();
      const live = join(dir, 'live.db');
      await seeded(live);
      const backup = await backupDatabase(live, join(dir, 'snap.db'));
      const corrupt = join(dir, 'corrupt.db');
      const backupBytes = readFileSync(backup.destination);
      const damaged = Buffer.from(backupBytes);
      damaged.fill(0xab, 100); // keep a plausible header, wreck every page after it
      writeFileSync(corrupt, damaged);
      const corruptBytes = readFileSync(corrupt);

      const target = join(dir, 'target.db');
      writeFileSync(target, 'original target bytes that must survive');
      const before = readFileSync(target);

      expect(() => restoreDatabase(corrupt, target, { force: true })).toThrow(/corrupt/i);
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(corrupt)).toEqual(corruptBytes);
      expect(leftoverTemps(dir)).toEqual([]);
    });

    it('refuses source and target being the same file even with force; the backup survives', async () => {
      const dir = workspace();
      const live = join(dir, 'live.db');
      await seeded(live);
      const backup = await backupDatabase(live, join(dir, 'snap.db'));
      const before = readFileSync(backup.destination);

      expect(() =>
        restoreDatabase(backup.destination, backup.destination, { force: true }),
      ).toThrow(/same file/i);
      expect(readFileSync(backup.destination)).toEqual(before);
    });

    it('refuses a target symlink pointing at the source; the backup survives', async () => {
      const dir = workspace();
      const live = join(dir, 'live.db');
      await seeded(live);
      const backup = await backupDatabase(live, join(dir, 'snap.db'));
      const alias = join(dir, 'alias.db');
      try {
        symlinkSync(backup.destination, alias);
      } catch {
        return; // platform refuses symlinks; skip gracefully
      }
      const before = readFileSync(backup.destination);
      expect(() => restoreDatabase(backup.destination, alias, { force: true })).toThrow(
        /same file/i,
      );
      expect(readFileSync(backup.destination)).toEqual(before);
    });

    it('refuses a source symlink pointing at the target; the target survives', async () => {
      const dir = workspace();
      const target = join(dir, 'target.db');
      writeFileSync(target, 'target bytes that must survive');
      const alias = join(dir, 'alias.db');
      try {
        symlinkSync(target, alias);
      } catch {
        return; // platform refuses symlinks; skip gracefully
      }
      const before = readFileSync(target);
      expect(() => restoreDatabase(alias, target, { force: true })).toThrow(/same file/i);
      expect(readFileSync(target)).toEqual(before);
    });

    it('refuses a hard-link alias via dev/ino; both names keep the bytes', async () => {
      const dir = workspace();
      const target = join(dir, 'target.db');
      writeFileSync(target, 'hard-linked bytes that must survive');
      const alias = join(dir, 'alias.db');
      try {
        linkSync(target, alias);
      } catch {
        return; // platform refuses hard links; skip gracefully
      }
      const before = readFileSync(target);
      expect(() => restoreDatabase(alias, target, { force: true })).toThrow(/same file/i);
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(alias)).toEqual(before);
    });

    it('a failed copy (read-only target directory) leaves the target untouched and no temp behind', async () => {
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        return; // root ignores the read-only directory; skip gracefully
      }
      const dir = workspace();
      const live = join(dir, 'live.db');
      await seeded(live);
      const backup = await backupDatabase(live, join(dir, 'snap.db'));
      const target = join(dir, 'target.db');
      writeFileSync(target, 'target bytes that must survive a failed copy');
      const before = readFileSync(target);
      chmodSync(dir, 0o555);
      try {
        expect(() => restoreDatabase(backup.destination, target, { force: true })).toThrow();
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(readFileSync(target)).toEqual(before);
      expect(leftoverTemps(dir)).toEqual([]);
    });

    it('a failed replacement (injected rename seam) leaves the target untouched and removes the temp', async () => {
      const dir = workspace();
      const live = join(dir, 'live.db');
      await seeded(live);
      const backup = await backupDatabase(live, join(dir, 'snap.db'));
      const target = join(dir, 'target.db');
      writeFileSync(target, 'target bytes that must survive a failed swap');
      const before = readFileSync(target);

      let injectedTemp: string | undefined;
      const failingRename = (from: string): void => {
        injectedTemp = from;
        throw new Error('injected replacement failure');
      };
      expect(() =>
        restoreDatabase(backup.destination, target, { force: true, __rename: failingRename }),
      ).toThrow(/injected replacement failure/);
      expect(readFileSync(target)).toEqual(before);
      if (injectedTemp !== undefined) {
        expect(existsSync(injectedTemp)).toBe(false);
      }
      expect(leftoverTemps(dir)).toEqual([]);
    });
  });

  /**
   * Beta review P1 (31 Oct): integrity_check calls an EMPTY database 'ok' -
   * zero-byte sources used to "restore" over real Muse databases as a row of
   * zero counts at schema version 0. The schema gate refuses anything that
   * is not a genuine Muse image (migration metadata + v1 core tables and
   * columns), force included, while genuinely older Muse backups stay
   * restorable.
   */
  describe('the schema gate refuses empty, unrelated and unsupported images', () => {
    function museBackupOf(dir: string, name = 'live.db'): Promise<string> {
      return (async () => {
        const source = join(dir, name);
        await seeded(source);
        return (await backupDatabase(source, join(dir, `snap-${name}`))).destination;
      })();
    }

    it('a zero-byte source with force is refused; the real target keeps every byte', async () => {
      const dir = workspace();
      const target = join(dir, 'real.db');
      await seeded(target);
      const before = readFileSync(target);
      const empty = join(dir, 'empty.db');
      writeFileSync(empty, '');

      expect(() => restoreDatabase(empty, target, { force: true })).toThrow(
        /not a Muse Recall database/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readdirSync(dir).some((n) => n.includes('restore-'))).toBe(false);
    });

    it('a valid SQLite database from another application is refused', async () => {
      const dir = workspace();
      const target = join(dir, 'real.db');
      await seeded(target);
      const before = readFileSync(target);
      const foreign = join(dir, 'foreign.db');
      const database = new DatabaseSync(foreign);
      database.exec(
        `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO customers (name) VALUES ('not a muse row');`,
      );
      database.close();

      expect(() => restoreDatabase(foreign, target, { force: true })).toThrow(
        /not a Muse Recall database/,
      );
      expect(readFileSync(target)).toEqual(before);
    });

    it('stubbed v1 tables with the right names but the wrong columns are refused', async () => {
      const dir = workspace();
      const target = join(dir, 'real.db');
      await seeded(target);
      const before = readFileSync(target);
      const stub = join(dir, 'stub.db');
      const database = new DatabaseSync(stub);
      database.exec(
        `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
         INSERT INTO schema_migrations VALUES (1, 'core_memory_schema', 'x');
         CREATE TABLE projects (id TEXT);
         CREATE TABLE memories (id TEXT);
         CREATE TABLE memory_supersessions (new_id TEXT);
         CREATE TABLE memory_history (id TEXT);`,
      );
      database.close();

      expect(() => restoreDatabase(stub, target, { force: true })).toThrow(
        /missing mandatory columns/,
      );
      expect(readFileSync(target)).toEqual(before);
    });

    it('a history that skips a version is refused (claiming 8 with gaps)', async () => {
      const dir = workspace();
      const backup = await museBackupOf(dir);
      const target = join(dir, 'target.db');
      await seeded(target);
      const before = readFileSync(target);
      const tampered = new DatabaseSync(backup);
      tampered.exec('DELETE FROM schema_migrations WHERE version = 4');
      tampered.close();

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /incomplete or not contiguous/,
      );
      expect(readFileSync(target)).toEqual(before);
    });

    it('a backup NEWER than this build (version 999) is refused as unsupported', async () => {
      const dir = workspace();
      const backup = await museBackupOf(dir, 'live.db');
      const future = new DatabaseSync(backup);
      future
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(999, 'from_the_future', '2099-01-01T00:00:00.000Z');
      future.close();

      expect(() => restoreDatabase(backup, join(dir, 'target.db'))).toThrow(
        /unsupported schema version 999/,
      );
    });

    it('genuinely older Muse backups (v1-era) restore; later tables simply absent', () => {
      const dir = workspace();
      const old = join(dir, 'old-v3.db');
      const database = new DatabaseSync(old);
      database.exec(
        `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`,
      );
      for (const migration of MIGRATIONS.slice(0, 3)) {
        database.exec('BEGIN');
        migration.up(database);
        database
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
        database.exec('COMMIT');
      }
      database.close();

      const restored = restoreDatabase(old, join(dir, 'restored.db'));
      expect(restored.schema_version).toBe(3);
      expect(restored.counts).toHaveProperty('projects');
      expect(restored.counts).toHaveProperty('sessions');
      // Tables the v3 image never had are ABSENT from counts, not faked as 0.
      expect(restored.counts).not.toHaveProperty('tool_calls');
      expect(restored.latest_schema_version).toBeGreaterThanOrEqual(8);
    });
  });

  /**
   * Follow-up review at ab80ba0 (P1): the gate above checked only the v1 core,
   * so a CURRENT-version image with a dropped later table (sessions, ...) or
   * a dropped later column (memories.revision, ...) still "restored" - and a
   * normal startup never repaired it because the migrations were already
   * recorded. The gate now requires every table and column the backup's
   * CLAIMED version mandates, while genuinely older images stay restorable.
   */
  describe('the gate requires the schema the claimed version mandates', () => {
    async function v8Backup(dir: string, name: string): Promise<string> {
      const source = join(dir, name);
      await seeded(source);
      return (await backupDatabase(source, join(dir, `snap-${name}`))).destination;
    }

    async function existingTarget(dir: string): Promise<{ target: string; before: Buffer }> {
      const target = join(dir, 'target.db');
      await seeded(target);
      return { target, before: readFileSync(target) };
    }

    function mutate(path: string, sql: string): void {
      const database = new DatabaseSync(path);
      try {
        database.exec(sql);
      } finally {
        database.close();
      }
    }

    function expectNoLeftovers(dir: string): void {
      expect(
        readdirSync(dir).filter(
          (name) => name.startsWith('.restore-') || name.includes('restore-previous'),
        ),
      ).toEqual([]);
    }

    it('a v8 backup missing sessions is refused; target and source keep every byte', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'DROP TABLE sessions');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /missing mandatory Muse table "sessions"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a v8 backup missing messages (another v3 table) is refused', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'DROP TABLE messages');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /missing mandatory Muse table "messages"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a v8 backup missing tool_calls (v6) is refused', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'DROP TABLE tool_calls');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /missing mandatory Muse table "tool_calls"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a v8 backup missing idempotency_keys (v8) is refused', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'DROP TABLE idempotency_keys');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /missing mandatory Muse table "idempotency_keys"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a v8 backup whose memories lack the v7 record-contract columns is refused', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'ALTER TABLE memories DROP COLUMN revision');
      mutate(backup, 'ALTER TABLE memories DROP COLUMN actor');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /table "memories" is missing mandatory columns "revision", "actor"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a v8 backup whose memories lack the v2 superseded_by column is refused', async () => {
      const dir = workspace();
      const backup = await v8Backup(dir, 'live.db');
      mutate(backup, 'DROP INDEX IF EXISTS idx_memories_superseded_by; ALTER TABLE memories DROP COLUMN superseded_by');
      const bytes = readFileSync(backup);
      const { target, before } = await existingTarget(dir);

      expect(() => restoreDatabase(backup, target, { force: true })).toThrow(
        /table "memories" is missing mandatory columns "superseded_by"/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(backup)).toEqual(bytes);
      expectNoLeftovers(dir);
    });

    it('a genuine v1 backup still restores; later tables are absent, not zeroed', () => {
      const dir = workspace();
      const old = join(dir, 'old-v1.db');
      const database = new DatabaseSync(old);
      try {
        database.exec(
          'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);',
        );
        for (const migration of MIGRATIONS.slice(0, 1)) {
          database.exec('BEGIN');
          migration.up(database);
          database
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
          database.exec('COMMIT');
        }
      } finally {
        database.close();
      }

      const restored = restoreDatabase(old, join(dir, 'restored.db'));
      expect(restored.schema_version).toBe(1);
      expect(restored.counts).toHaveProperty('projects');
      // Tables the v1 image never had are ABSENT from counts, not faked as 0.
      expect(restored.counts).not.toHaveProperty('sessions');
      expect(restored.counts).not.toHaveProperty('tool_calls');
    });
  });

  /**
   * Beta review P2 (31 Oct): the sidecar cleanup ran AFTER the rename, so a
   * directory at <target>-wal threw EISDIR with the original already gone.
   * The swap now parks the previous database AND its sidecars, pre-checks
   * sidecar shapes, and undoes the swap from the parked copy on any failure
   * at or after the replacement.
   */
  describe('the swap parks the previous state and undoes post-swap failures', () => {
    function leftover(dir: string): string[] {
      return readdirSync(dir).filter(
        (name) => name.startsWith('.restore-') || name.includes('restore-previous'),
      );
    }

    it('a DIRECTORY at <target>-wal is refused before anything moves', async () => {
      const dir = workspace();
      const source = join(dir, 'live.db');
      await seeded(source);
      const backup = await backupDatabase(source, join(dir, 'snap.db'));
      const target = join(dir, 'target.db');
      await seeded(target);
      const before = readFileSync(target);
      mkdirSync(`${target}-wal`);
      writeFileSync(join(`${target}-wal`, 'stale'), 'stale content that must survive');

      expect(() => restoreDatabase(backup.destination, target, { force: true })).toThrow(
        /not a regular file/,
      );
      expect(readFileSync(target)).toEqual(before);
      expect(readFileSync(join(`${target}-wal`, 'stale'), 'utf8')).toBe(
        'stale content that must survive',
      );
      expect(leftover(dir)).toEqual([]);
    });

    it('a failure AFTER the swap restores the original bytes AND its sidecars', async () => {
      const dir = workspace();
      const source = join(dir, 'live.db');
      await seeded(source);
      const backup = await backupDatabase(source, join(dir, 'snap.db'));

      const target = join(dir, 'target.db');
      await seeded(target);
      writeFileSync(`${target}-wal`, 'wal-bytes-of-the-original');
      writeFileSync(`${target}-shm`, 'shm-bytes-of-the-original');
      const before = readFileSync(target);

      expect(() =>
        restoreDatabase(backup.destination, target, {
          force: true,
          __postSwap: () => {
            throw new Error('injected post-swap failure');
          },
        }),
      ).toThrow(/injected post-swap failure/);

      // The ORIGINAL database is back, with its sidecars renamed back to it:
      // not a half-restored target with the original unreachable.
      expect(readFileSync(target)).toEqual(before);
      expect(existsSync(`${target}-wal`)).toBe(true);
      expect(readFileSync(`${target}-wal`, 'utf8')).toBe('wal-bytes-of-the-original');
      expect(readFileSync(`${target}-shm`, 'utf8')).toBe('shm-bytes-of-the-original');
      expect(leftover(dir)).toEqual([]);
    });

    it('success removes stale sidecars and the parked copy; the restored DB reopens clean', async () => {
      const dir = workspace();
      const source = join(dir, 'live.db');
      await seeded(source); // holds "a fact that must survive restore"
      const backup = await backupDatabase(source, join(dir, 'snap.db'));

      const target = join(dir, 'target.db');
      const other = openDatabase({ path: target, wal: true });
      new MemoryEngine(other.db).ensureProject('zeta');
      other.close();
      writeFileSync(`${target}-wal`, 'stale wal that must NOT shadow the restore');
      writeFileSync(`${target}-shm`, 'stale shm');

      const restored = restoreDatabase(backup.destination, target, { force: true });
      expect(restored.counts['memories']).toBe(1);
      expect(existsSync(`${target}-wal`)).toBe(false);
      expect(existsSync(`${target}-shm`)).toBe(false);
      expect(leftover(dir)).toEqual([]);

      const reopened = openDatabase({ path: target, wal: false });
      const engine = new MemoryEngine(reopened.db);
      const contents = engine.list({ all_projects: true }).items.map((memory) => memory.content);
      reopened.close();
      expect(contents).toContain('a fact that must survive restore');
    });
  });
});
