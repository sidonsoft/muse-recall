import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { loadConfig, loadDotEnv } from '../config.js';

interface PurgeRow {
  id: string;
  status: string;
}

/**
 * `pnpm db:purge --yes`
 *
 * Soft delete only hides a memory; its bytes remain in the database until this
 * explicit hard delete runs. There is deliberately no HTTP route.
 */
function main(): void {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to purge without --yes.');
    console.error('Usage: pnpm db:purge --yes');
    process.exitCode = 1;
    return;
  }

  loadDotEnv();
  const config = loadConfig();
  const database = openDatabase({ path: config.databasePath, wal: config.wal });

  try {
    const rows = database.db
      .prepare(
        `SELECT id, status FROM memories
         WHERE status IN ('deleted', 'expired')
         ORDER BY updated_at ASC, id ASC`,
      )
      .all() as unknown as PurgeRow[];

    if (rows.length === 0) {
      console.log(`purged: 0 memories from ${config.databasePath}`);
      return;
    }

    const engine = new MemoryEngine(database.db);
    for (const row of rows) {
      engine.purge(row.id);
      console.log(`purged ${row.id} [${row.status}]`);
    }
    console.log(`purged: ${rows.length} memories from ${config.databasePath}`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error('Purge failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
