import { restoreDatabase } from '../backup.js';
import { loadConfig, loadDotEnv } from '../config.js';

/**
 * `pnpm db:restore <backup-file> --into <isolated-target> [--force]`
 *
 * Restores a backup copy for verification or disaster rehearsal. The live
 * database is never the implicit target: `--into` is required, and
 * replacing an existing target additionally requires `--force`.
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
