import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ComponentStatus } from '@mml/shared';
import { sqliteVersion } from './db.js';
import { currentSchemaVersion, latestVersion } from './migrations.js';

export interface DatabaseProbe {
  status: ComponentStatus;
  detail: string;
  latency_ms: number;
  engine: string;
  path: string;
  schema_version: number;
  write_verified: boolean;
}

export interface DatabaseProbeOptions {
  /** Verify reads only and skip the write round-trip. */
  readOnly?: boolean;
}

/**
 * Prove the database is genuinely usable, not merely present.
 *
 * A connection that opened but cannot write is a common failure (read-only
 * file, full disk, wrong owner). Liveness pings hide that until the demo, so
 * this probe performs a real write/read cycle against the schema inside a
 * transaction and rolls it back, leaving no residue.
 *
 * With `readOnly`, the schema version and a read from the projects table are
 * still checked, but nothing is written and `write_verified` is false.
 */
export function probeDatabase(
  db: DatabaseSync,
  path: string,
  options: DatabaseProbeOptions = {},
): DatabaseProbe {
  const readOnly = options.readOnly ?? false;
  const startedAt = performance.now();
  const engine = `sqlite ${sqliteVersion(db)}`;

  let schemaVersion = 0;
  let writeVerified = false;
  let status: ComponentStatus = 'ok';
  let detail = readOnly ? 'read verified (write check skipped)' : 'read and write verified';

  try {
    schemaVersion = currentSchemaVersion(db);

    if (readOnly) {
      // Still touch the schema so a missing or renamed table is reported.
      db.prepare('SELECT id FROM projects LIMIT 1').get();
    } else {
      db.exec('BEGIN');
      try {
        const now = new Date().toISOString();
        const probeId = `__health_probe__${randomUUID()}`;
        db.prepare(
          'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ).run(probeId, 'health probe', now, now);
        const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(probeId) as
          | { name: string }
          | undefined;
        writeVerified = row?.name === 'health probe';
      } finally {
        db.exec('ROLLBACK');
      }
    }

    const expected = latestVersion();
    if (schemaVersion !== expected) {
      status = 'degraded';
      detail = `schema drift: database at v${schemaVersion}, code expects v${expected}`;
    }
  } catch (error) {
    status = 'error';
    detail = `database probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (status === 'ok' && !readOnly && !writeVerified) {
    status = 'error';
    detail = 'read succeeded but the write round-trip did not';
  }

  return {
    status,
    detail,
    latency_ms: Math.round(performance.now() - startedAt),
    engine,
    path,
    schema_version: schemaVersion,
    write_verified: writeVerified,
  };
}
