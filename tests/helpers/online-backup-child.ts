/**
 * Runs the product's online backup step in a plain Node process — the shape the server and
 * `pnpm backup:drill` actually use — and prints one JSON line on stdout.
 *
 * This exists because node:sqlite's asynchronous `backup()` promise does not settle inside a
 * Vitest worker once the whole suite is running (KI-56): the same call returns in 1-4 ms in a
 * plain process and in a single-file worker, and stalls past the 15 s deadline in a full-suite
 * worker. The online API is therefore measured where it ships, while the restore half stays
 * under test in-process.
 *
 * Usage: node --import tsx tests/helpers/online-backup-child.ts <dir> [destination]
 * The caller owns `<dir>` and is responsible for removing it.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from '../../apps/server/src/backup.js';
import { MemoryEngine, openDatabase } from '../../packages/memory-engine/src/index.js';

const argDir = process.argv[2];
const destination = process.argv[3];
const dir = argDir ?? mkdtempSync(join(tmpdir(), 'online-backup-child-'));
if (argDir !== undefined) mkdirSync(dir, { recursive: true });

const source = join(dir, 'live.db');
const database = openDatabase({ path: source, wal: true });
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
});
database.close();

const backup = await backupDatabase(source, destination);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    source,
    destination: backup.destination,
    pages: backup.pages,
  })}\n`,
);
