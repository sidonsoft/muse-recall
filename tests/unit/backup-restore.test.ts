import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
