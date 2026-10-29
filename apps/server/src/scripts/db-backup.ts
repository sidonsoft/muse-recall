import { backupDatabase } from '../backup.js';
import { loadConfig, loadDotEnv } from '../config.js';

/**
 * `pnpm db:backup [destination]`
 *
 * Resolves the database exactly like the server (`loadDotEnv` + `loadConfig`
 * from this package's working directory). With no argument the timestamped
 * copy sits next to the database; a directory argument puts it inside that
 * directory.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const destination = process.argv[2];
  const backup = await backupDatabase(config.databasePath, destination);
  console.log(`database: ${backup.source}`);
  console.log(`backup: ${backup.destination}`);
  console.log(`pages: ${backup.pages}`);
}

main().catch((error: unknown) => {
  console.error('Backup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
