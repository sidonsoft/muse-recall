import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { HealthResponse } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { backupDatabase } from '../../apps/server/src/backup.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Alert signals inside GET /api/health (roadmap §8 groundwork, D050). The
 * health response gains an `alerts` block an EXTERNAL prober can watch;
 * liveness semantics deliberately do NOT change: a stale or missing backup
 * never flips `status`, because the server itself is still alive.
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function testConfig(workspaceRoot: string, databasePath: string, alertMaxAgeHours = 24): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8787,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath,
    wal: false,
    workspaceRoot,
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    alertBackupMaxAgeHours: alertMaxAgeHours,
    agent: {
      budgets: {
        max_history_messages: 8,
        max_history_characters: 6_000,
        max_memory_characters: 4_000,
        max_prompt_characters: 24_000,
        max_message_characters: 8_000,
        max_correction_history: 3,
      },
      autoCapture: 'suggest',
      includeCorrectionHistory: true,
      maxOutputTokens: 1_200,
      tools: { enabled: false, approvalPolicy: 'always', maxCallsPerTurn: 3, decisionMode: 'off' },
    },
    serviceVersion: SERVICE_VERSION,
  };
}

async function fileDbApp(alertMaxAgeHours = 24) {
  const dir = await mkdtemp(join(tmpdir(), 'health-alerts-'));
  roots.push(dir);
  const dbFile = join(dir, 'app.db');
  const database = openDatabase({ path: dbFile, wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config: testConfig(dir, dbFile, alertMaxAgeHours),
    db: database.db,
    dbPath: dbFile,
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  return { app, dbFile };
}

const HOST = { host: '127.0.0.1:8787' };

async function health(app: FastifyInstance): Promise<HealthResponse> {
  const response = await app.inject({ method: 'GET', url: '/api/health', headers: HOST });
  expect(response.statusCode).toBe(200);
  return response.json().data as HealthResponse;
}

describe('health alert signals (D050)', () => {
  it('fresh file database with no snapshots reports a missing backup, not an unhealthy server', async () => {
    const { app } = await fileDbApp();
    const payload = await health(app);
    expect(payload.status).toBe('ok');
    expect(payload.alerts?.backup).toMatchObject({ state: 'missing', backup_count: 0 });
    expect(payload.alerts?.storage).toEqual({ ok: true, unacknowledged_issues: 0 });
    expect(payload.alerts?.provider.state).toBe('skipped');
  });

  it('a real db:backup snapshot next to the DB flips the signal to ok', async () => {
    const { app, dbFile } = await fileDbApp();
    await backupDatabase(dbFile);
    const payload = await health(app);
    expect(payload.alerts?.backup.state).toBe('ok');
    expect(payload.alerts?.backup.backup_count).toBe(1);
    expect(payload.alerts?.backup.age_hours).toBeLessThanOrEqual(1);
  });

  it('an old snapshot is stale — and health status stays ok for liveness', async () => {
    const { app, dbFile } = await fileDbApp(1);
    const dir = dbFile.replace('/app.db', '');
    await writeFile(join(dir, 'app.db.backup-20200101T000000Z'), 'old', 'utf8');
    const payload = await health(app);
    expect(payload.alerts?.backup.state).toBe('stale');
    expect(payload.status, 'alerts are informational; liveness must not flip').toBe('ok');
  });
});
