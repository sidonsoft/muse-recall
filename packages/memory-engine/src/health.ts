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

/**
 * Prove the database is genuinely usable, not merely present.
 *
 * A connection that opened but cannot write is a common failure (read-only
 * file, full disk, wrong owner). Liveness pings hide that until the demo, so
 * this probe performs a real write/read cycle against the schema inside a
 * transaction and rolls it back, leaving no residue.
 */
export function probeDatabase(db: DatabaseSync, path: string): DatabaseProbe {
  const startedAt = performance.now();
  const engine = `sqlite ${sqliteVersion(db)}`;

  let schemaVersion = 0;
  let writeVerified = false;
  let status: ComponentStatus = 'ok';
  let detail = 'read and write verified';

  try {
    schemaVersion = currentSchemaVersion(db);

    db.exec('BEGIN');
    try {
      const now = new Date().toISOString();
      const probeId = `__health_probe__${randomUUID()}`;
      db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        probeId,
        'health probe',
        now,
        now,
      );
      const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(probeId) as
        | { name: string }
        | undefined;
      writeVerified = row?.name === 'health probe';
    } finally {
      db.exec('ROLLBACK');
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

  if (status === 'ok' && !writeVerified) {
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
