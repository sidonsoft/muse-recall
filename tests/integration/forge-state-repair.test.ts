import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { ForgeRepairResult, ForgeStateInspection } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const roots: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function appConfig(workspaceRoot: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath: ':memory:',
    wal: false,
    workspaceRoot,
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
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

const HTML = `<!doctype html>
<html><head><title>Surviving app</title></head>
<body><main><h1>Surviving application</h1></main>
<script>document.body.dataset.ready = 'yes';</script></body></html>`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'forge-repair-api-'));
  roots.push(root);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  const database = openDatabase({ path: ':memory:', wal: false });
  databases.push(database);
  const engine = new MemoryEngine(database.db);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: '/nonexistent/muse-for-repair-test',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
    now: () => new Date('2026-10-10T00:00:00.000Z'),
  });
  const app = await buildApp({
    config: appConfig(root),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    forgeManager: manager,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  return { root, workspace, app };
}

describe('state repair API (NEXT_STEPS.md P0 #3)', () => {
  it('inspect returns diagnosis for a corrupt state; repair rebuilds and the project works again', async () => {
    const { root, app } = await setup();
    try {
      // Seed an approved version, then damage the state file underneath it.
      await mkdir(join(root, 'forge', 'demo', 'versions', '1'), { recursive: true });
      await writeFile(join(root, 'forge', 'demo', 'versions', '1', 'index.html'), HTML);
      const damaged = '{"current_version": 1, "versions": [oops';
      await writeFile(join(root, 'forge', 'demo', 'state.json'), damaged);

      // The normal project view still refuses to present the corrupt project.
      const brokenView = await app.inject({ method: 'GET', url: '/api/forge/projects/demo' });
      expect(brokenView.statusCode).toBe(500);
      expect(brokenView.json().error.code).toBe('state_corrupt');

      // Inspection works even while the project is blocked.
      const inspection = await app.inject({
        method: 'GET',
        url: '/api/forge/projects/demo/recovery/state',
      });
      expect(inspection.statusCode).toBe(200);
      const view = inspection.json().data as ForgeStateInspection;
      expect(view.state_file.presence).toBe('invalid_json');
      expect(view.state_file.content).toBe(damaged);
      expect(view.repairable).toBe(true);
      expect(view.versions).toHaveLength(1);
      expect(view.versions[0]).toEqual(expect.objectContaining({ version: 1, usable: true }));

      // Repair archives the damaged bytes and rebuilds the state.
      const repair = await app.inject({
        method: 'POST',
        url: '/api/forge/projects/demo/recovery/repair',
      });
      expect(repair.statusCode).toBe(200);
      const result = repair.json().data as ForgeRepairResult;
      expect(result.adopted_versions).toEqual([1]);
      expect(result.archived_to).toMatch(/^state\.corrupt-/);
      expect(result.state.current_version).toBe(1);

      // The project view renders again and serves the surviving version bytes.
      const okView = await app.inject({ method: 'GET', url: '/api/forge/projects/demo' });
      expect(okView.statusCode).toBe(200);
      expect(okView.json().data.state.current_version).toBe(1);
      const artifact = await app.inject({
        method: 'GET',
        url: '/api/forge/projects/demo/artifact',
        headers: { host: '127.0.0.1' },
      });
      expect(artifact.statusCode).toBe(200);

      // A second repair on a valid state is refused, not a silent re-archive.
      const second = await app.inject({
        method: 'POST',
        url: '/api/forge/projects/demo/recovery/repair',
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('state_valid');
    } finally {
      await app.close();
    }
  });

  it('inspection reports a healthy project as ok and not repairable', async () => {
    const { app } = await setup();
    try {
      const inspection = await app.inject({
        method: 'GET',
        url: '/api/forge/projects/demo/recovery/state',
      });
      expect(inspection.statusCode).toBe(200);
      const view = inspection.json().data as ForgeStateInspection;
      expect(view.state_file.presence).toBe('ok');
      expect(view.repairable).toBe(false);
      expect(view.jobs).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('inspection of an unknown project reports missing, and repair gives it an empty state', async () => {
    const { root, app } = await setup();
    try {
      const unknown = randomUUID().slice(0, 8); // valid id shape, never created
      const inspection = await app.inject({
        method: 'GET',
        url: `/api/forge/projects/${unknown}x/recovery/state`,
      });
      expect(inspection.statusCode).toBe(200);
      expect(inspection.json().data.state_file.presence).toBe('missing');

      const repair = await app.inject({
        method: 'POST',
        url: `/api/forge/projects/${unknown}x/recovery/repair`,
      });
      expect(repair.statusCode).toBe(200);
      expect(repair.json().data.state.current_version).toBeNull();
      expect(repair.json().data.archived_to).toBeNull();
      void root;
    } finally {
      await app.close();
    }
  });
});
