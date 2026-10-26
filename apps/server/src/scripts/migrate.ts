import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { currentSchemaVersion, latestVersion, openDatabase } from '@mml/memory-engine';
import { loadConfig, loadDotEnv } from '../config.js';

/**
 * Apply pending migrations and report what happened.
 *
 * Prints a stable, greppable summary so CI and the demo script can assert on
 * the schema state instead of scraping prose.
 */
function main(): void {
  loadDotEnv();
  const config = loadConfig();

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openDatabase({ path: config.databasePath, wal: config.wal });

  try {
    const version = currentSchemaVersion(database.db);
    const expected = latestVersion();
    console.log(`database: ${config.databasePath}`);
    console.log(`schema_version: ${version}`);
    console.log(`expected_version: ${expected}`);
    console.log(version === expected ? 'migrations: up to date' : 'migrations: DRIFT DETECTED');
    if (version !== expected) process.exitCode = 1;
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
