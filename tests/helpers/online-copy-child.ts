/**
 * Copy an **existing** SQLite database with the product's online backup API, in a plain Node
 * process, and print one JSON line on stdout (KI-56).
 *
 * `online-backup-child.ts` seeds its own database; this one takes a source the caller already
 * prepared, which is what "back up a live WAL database" tests need: the caller keeps the
 * writer open, so some rows live only in the WAL at copy time.
 *
 * Usage: node --import tsx tests/helpers/online-copy-child.ts <source> <destination>
 */
import { existsSync } from 'node:fs';
import { backupDatabase } from '../../apps/server/src/backup.js';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('usage: online-copy-child.ts <source> <destination>');
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`no such source database: ${source}`);
  process.exit(2);
}

const backup = await backupDatabase(source, destination);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    source: backup.source,
    destination: backup.destination,
    pages: backup.pages,
  })}\n`,
);
