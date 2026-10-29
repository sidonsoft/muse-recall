import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDatabase } from '../../apps/server/src/backup.js';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mml-data-at-rest-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('data at rest', () => {
  it.skipIf(process.platform === 'win32')(
    'creates the database, WAL sidecars, and parent directory owner-only',
    async () => {
      const root = await temporaryDirectory();
      const directory = join(root, 'private');
      const path = join(directory, 'memory.db');
      const opened = openDatabase({ path });
      try {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        for (const file of [path, `${path}-wal`, `${path}-shm`]) {
          expect((await stat(file)).mode & 0o777).toBe(0o600);
        }
      } finally {
        opened.close();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'creates every missing parent directory level owner-only',
    async () => {
      const root = await temporaryDirectory();
      const first = join(root, 'new');
      const second = join(first, 'deep');
      const path = join(second, 'memory.db');
      const opened = openDatabase({ path });
      try {
        for (const directory of [first, second]) {
          expect((await stat(directory)).mode & 0o777).toBe(0o700);
        }
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      } finally {
        opened.close();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'leaves an existing parent directory mode alone',
    async () => {
      const root = await temporaryDirectory();
      const directory = join(root, 'shared');
      await mkdir(directory, { mode: 0o755 });
      await chmod(directory, 0o755);
      const path = join(directory, 'memory.db');
      const opened = openDatabase({ path });
      try {
        expect((await stat(directory)).mode & 0o777).toBe(0o755);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      } finally {
        opened.close();
      }
    },
  );

  it('backs up a live WAL database with the same rows', async () => {
    const root = await temporaryDirectory();
    const source = openDatabase({ path: join(root, 'source.db') });
    const engine = new MemoryEngine(source.db);
    try {
      engine.create({
        type: 'technical_decision',
        scope: 'project',
        project_id: 'backup-test',
        content: 'Keep the backup consistent with the live database.',
      });
      engine.create({
        type: 'constraint',
        scope: 'global',
        project_id: null,
        content: 'Backups must not expose world-readable files.',
      });

      // The source stays open so at least one row lives only in the WAL when
      // the online backup starts.
      const backup = await backupDatabase(source.path);
      expect(backup.destination).toContain(`${source.path}.backup-`);

      const copy = openDatabase({ path: backup.destination, wal: false });
      try {
        const rows = copy.db
          .prepare('SELECT content FROM memories ORDER BY content ASC')
          .all() as unknown as { content: string }[];
        expect(rows.map((row) => row.content)).toEqual([
          'Backups must not expose world-readable files.',
          'Keep the backup consistent with the live database.',
        ]);
      } finally {
        copy.close();
      }

      if (process.platform !== 'win32') {
        expect((await stat(backup.destination)).mode & 0o777).toBe(0o600);
      }
    } finally {
      source.close();
    }
  });
});
