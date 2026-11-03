import { restoreDatabase } from '../backup.js';
import { loadConfig, loadDotEnv } from '../config.js';

/**
 * `pnpm db:restore <backup-file> --into <isolated-target> [--force]`
 *
 * Restores a backup copy for verification or disaster rehearsal. The live
 * database is never the implicit target: `--into` is required, and
 * replacing an existing target additionally requires `--force`.
 *
 * Guarantees (beta review, in order):
 *  - the source must be an INTACT **and genuine Muse** database: integrity
 *    check plus a schema gate (contiguous `schema_migrations` history at a
 *    supported version >= 1 and the v1 core tables/columns). Empty files,
 *    unrelated SQLite images, hand-made stubs and unsupported versions are
 *    refused before anything is touched;
 *  - a source that is the same file as the target (path, symlink alias, or
 *    hard link) is always refused, `--force` included;
 *  - the validated copy is staged in a temp file beside the target and
 *    re-verified there; a pre-existing target plus its WAL/SHM sidecars is
 *    parked to a `.restore-previous-*` set first, so a failure at or after
 *    the swap puts the ORIGINAL bytes and sidecars back instead of leaving
 *    a half-restored target. If even the automatic undo fails, the error
 *    names the parked copy for a manual restore;
 *  - stale WAL/SHM at the target path are cleared with the replacement, and
 *    anything that is not a regular file there (directory, fifo) is refused
 *    up front rather than discovered mid-swap;
 *  - on success the parked previous copy is removed (that is what `--force`
 *    means). Nothing here deletes or modifies the backup source.
 *
 * The database-plus-sidecar set is NOT claimed atomic: consistency rests on
 * the stop-application requirement plus park/undo, not on a single rename.
 * **Stop the application before `--force`**: a running server keeps the WAL
 * open and can rewrite files after the swap.
 */
function main(): void {
  loadDotEnv();
  const argv = process.argv.slice(2);
  let backupFile = '';
  let into = '';
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--into') {
      into = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--force') {
      force = true;
    } else if (!arg.startsWith('--') && !backupFile) {
      backupFile = arg;
    } else {
      throw new Error(`unexpected argument "${arg}"`);
    }
  }
  if (!backupFile) throw new Error('usage: db:restore <backup-file> --into <target> [--force]');
  if (!into) {
    throw new Error(
      'db:restore requires --into <isolated-target>; the live database is never an implicit restore target',
    );
  }
  void loadConfig(); // keeps env validation honest without changing the rule
  const result = restoreDatabase(backupFile, into, { force });
  console.log(`backup:  ${result.source}`);
  console.log(`target:  ${result.target}`);
  console.log(`schema:  v${result.schema_version} (latest v${result.latest_schema_version})`);
  for (const [table, count] of Object.entries(result.counts)) {
    console.log(`  ${table}: ${count}`);
  }
}

try {
  main();
} catch (error: unknown) {
  console.error('Restore failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
