import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
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
      return readdirSync(dir).filter((name) => name.startsWith('.restore-'));
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
});
