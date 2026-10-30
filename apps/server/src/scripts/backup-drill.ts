import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { MemoryCorrectionRequestSchema, MemoryCreateInputSchema } from '@mml/shared';
import { backupDatabase, restoreDatabase } from '../backup.js';

/**
 * `pnpm backup:drill` — a standing restore drill (roadmap §8).
 *
 * Creates a throwaway seeded database, takes an online backup, destroys the
 * original, restores into an isolated target, and verifies record parity —
 * then round-trips the export envelope into a second fresh database. Nothing
 * here touches the configured DATABASE_PATH; the drill is self-contained and
 * safe to run any time, on the documented schedule or ad hoc.
 *
 * It measures wall time for the restore+verify leg against the roadmap's
 * recovery-time target: for a local single-file database the drill finishes
 * in seconds, which says nothing about the ≤4h incident-window target for a
 * hosted deployment — do not quote this number as if it satisfied that row.
 */

function seed(dir: string): { path: string; engine: MemoryEngine; close: () => void } {
  const path = join(dir, 'drill.db');
  const database = openDatabase({ path, wal: true });
  const engine = new MemoryEngine(database.db);
  engine.ensureProject('drill');
  engine.create(
    MemoryCreateInputSchema.parse({
      type: 'technical_decision',
      scope: 'project',
      project_id: 'drill',
      content: 'The drill database stores one real supersession chain.',
    }),
  );
  engine.create(
    MemoryCreateInputSchema.parse({
      type: 'contextual_fact',
      scope: 'project',
      project_id: 'drill',
      content: 'This fact survives backup and restore.',
    }),
  );
  const list = engine.list({ all_projects: true });
  const target = list.items.find((memory) => memory.content.includes('supersession chain'));
  if (!target) throw new Error('drill seed failed');
  engine.correct(
    {
      ...MemoryCorrectionRequestSchema.parse({
        type: 'technical_decision',
        scope: 'project',
        project_id: 'drill',
        content: 'Corrected: the chain is created by correcting, not by deletion.',
      }),
      supersedes: [target.id],
    },
    'user',
  );
  return { path, engine, close: () => database.close() };
}

function fingerprint(engine: MemoryEngine): string[] {
  return engine
    .list({ all_projects: true, status: ['active', 'superseded'] })
    .items.map((memory) => `${memory.validation_status}:${memory.status}:${memory.content}`)
    .sort();
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mml-backup-drill-'));
  try {
    const source = seed(dir);
    const expected = fingerprint(source.engine);
    const envelope = source.engine.exportMemories();
    source.close();

    const backup = await backupDatabase(source.path, join(dir, 'backups'));

    // Destroy the "production" file set — the whole point of a drill.
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${source.path}${suffix}`, { force: true });

    // Guard: restoring over an existing target must be refused by default.
    const guarded = join(dir, 'guarded.db');
    writeFileSync(guarded, 'existing data, must not be clobbered silently\n', 'utf8');
    let refused = false;
    try {
      restoreDatabase(backup.destination, guarded);
    } catch (error) {
      refused = error instanceof Error && /Restore target already exists/.test(error.message);
    }
    if (!refused) throw new Error('restore did not refuse an existing target');
    if (!readFileSync(guarded, 'utf8').includes('must not be clobbered')) {
      throw new Error('refused restore modified the existing target');
    }

    const started = Date.now();
    const restored = restoreDatabase(backup.destination, join(dir, 'restored.db'));
    const restoredMemories = restored.counts['memories'] ?? 0;
    if (restoredMemories < expected.length) {
      throw new Error(
        `restored memory count ${restoredMemories} below expected ${expected.length}`,
      );
    }
    if (restored.schema_version < restored.latest_schema_version) {
      throw new Error(
        `restored schema v${restored.schema_version} behind latest v${restored.latest_schema_version}`,
      );
    }
    const restoredDatabase = openDatabase({ path: restored.target, wal: false });
    const restoredFingerprint = fingerprint(new MemoryEngine(restoredDatabase.db));
    restoredDatabase.close();
    if (JSON.stringify(restoredFingerprint) !== JSON.stringify(expected)) {
      throw new Error('restored records do not match the pre-backup fingerprint');
    }
    const elapsedMs = Date.now() - started;

    // Second modality: the portable export envelope into a fresh database.
    const importedPath = join(dir, 'imported.db');
    const importedDatabase = openDatabase({ path: importedPath, wal: false });
    const importedEngine = new MemoryEngine(importedDatabase.db);
    const importResult = importedEngine.importExport(JSON.parse(JSON.stringify(envelope)));
    const envelopeRecords = envelope.records.length;
    if (importResult.records_imported !== envelopeRecords || importResult.history_imported === 0) {
      throw new Error(
        `export import mismatch: ${String(importResult.records_imported)} records imported ` +
          `of ${envelopeRecords}, ${String(importResult.history_imported)} history entries`,
      );
    }
    importedDatabase.close();

    console.log('backup drill: PASS');
    console.log(`  backup file:      ${backup.destination}`);
    console.log(
      `  restored records: ${restoredMemories} memories, schema v${restored.schema_version}`,
    );
    console.log(
      `  restore+verify:   ${elapsedMs}ms (single local file; not evidence for hosted RTO)`,
    );
    console.log(`  export envelope:  ${envelopeRecords} records imported to a fresh database`);
    console.log(`  clobber guard:    refusing an existing target without --force: verified`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('Backup drill FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
