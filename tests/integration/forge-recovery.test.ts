import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { type ForgeJob, ForgeJobSchema } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { type ForgeJobPersistence, ForgeJobStore } from '../../apps/server/src/forge/job-store.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));
const roots: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'forge-recovery-'));
  roots.push(root);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  const database = openDatabase({ path: ':memory:', wal: false });
  databases.push(database);
  const engine = new MemoryEngine(database.db);
  const store = new ForgeJobStore(workspace);
  return { root, workspace, engine, store, db: database.db };
}

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

function job(overrides: Partial<ForgeJob> = {}): ForgeJob {
  return ForgeJobSchema.parse({
    id: randomUUID(),
    project_id: 'demo',
    kind: 'generate',
    status: 'queued',
    prompt: 'A small application.',
    request: null,
    summary: null,
    error: null,
    created_at: '2026-10-01T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    logs: [],
    usage: null,
    memory_ids: [],
    base_version: null,
    validation: null,
    version: null,
    ...overrides,
  });
}

const VALID_HTML = `<!doctype html>
<html><head><title>Recovered app</title></head>
<body><main><h1>Recovered application</h1><button type="button">Start</button></main>
<script>document.body.dataset.ready = 'yes';</script></body></html>`;

function managerFor(
  workspace: ForgeWorkspace,
  engine: MemoryEngine,
  jobStore?: ForgeJobPersistence,
): ForgeJobManager {
  return new ForgeJobManager({
    workspace,
    engine,
    museBin: '/nonexistent/muse-for-recovery-test',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
    now: () => new Date('2026-10-10T00:00:00.000Z'),
    ...(jobStore ? { jobStore } : {}),
  });
}

class ControlledStore implements ForgeJobPersistence {
  readonly inner: ForgeJobStore;
  readonly failAfterFirstSave = new Set<string>();
  failLoads = false;
  failHealth = false;
  rootHealthOk = true;
  readonly projectHealthFailures = new Set<string>();
  private readonly saves = new Map<string, number>();

  constructor(workspace: ForgeWorkspace) {
    this.inner = new ForgeJobStore(workspace);
  }

  async save(job: ForgeJob): Promise<void> {
    const count = this.saves.get(job.project_id) ?? 0;
    this.saves.set(job.project_id, count + 1);
    if (this.failAfterFirstSave.has(job.project_id) && count >= 1) {
      throw Object.assign(new Error('injected project storage failure'), { code: 'ENOSPC' });
    }
    await this.inner.save(job);
  }

  async flush(jobId: string): Promise<void> {
    await this.inner.flush(jobId);
  }

  async loadAll() {
    if (this.failLoads) throw new Error('injected store-wide read failure');
    return this.inner.loadAll();
  }

  async healthCheck(projectId: string) {
    if (this.failHealth) throw new Error('injected health failure');
    const healthy = { ok: true, error: null };
    return {
      root: this.rootHealthOk ? healthy : { ok: false, error: 'injected root failure' },
      project: this.projectHealthFailures.has(projectId)
        ? { ok: false, error: 'injected project failure' }
        : healthy,
    };
  }
}

async function waitForPid(path: string, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // The child may not have written its pid yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`child pid file was not written: ${path}`);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('Forge restart recovery', () => {
  it('marks a queued/running job interrupted and never resumes it', async () => {
    const { workspace, engine, store } = await setup();
    const running = job({ status: 'running', started_at: '2026-10-01T00:01:00.000Z' });
    await store.save(running);

    const manager = managerFor(workspace, engine);
    const report = await manager.recover();

    expect(report.startup.loaded_jobs).toBe(1);
    expect(report.startup.interrupted_jobs).toBe(1);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: 'job_interrupted', kind: 'startup' });
    const incidentId = report.issues[0]?.id as string;
    const acknowledged = await manager.acknowledge('demo', [incidentId]);
    expect(acknowledged.issues).toEqual([]);
    expect(acknowledged.acknowledged_issues).toBe(1);
    expect(manager.get(running.id)?.status).toBe('interrupted');
    const recovered = manager.get(running.id);
    expect(recovered?.status).toBe('interrupted');
    expect(recovered?.error).toContain('not resumed');
    expect(recovered?.finished_at).toBe('2026-10-10T00:00:00.000Z');

    const persisted = JSON.parse(
      await readFile(join(workspace.projectDir('demo'), 'jobs', `${running.id}.json`), 'utf8'),
    ) as ForgeJob;
    expect(persisted.status).toBe('interrupted');
  });

  it('keeps a completed job and its staged artifact available after restart', async () => {
    const { workspace, engine, store } = await setup();
    const pending = job({ status: 'succeeded', validation: { ok: true, issues: [] } });
    await store.save(pending);
    const staging = join(workspace.projectDir('demo'), 'staging', pending.id);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, 'index.html'), VALID_HTML, 'utf8');

    const manager = managerFor(workspace, engine);
    const report = await manager.recover();

    expect(report.startup.loaded_jobs).toBe(1);
    expect(report.issues).toEqual([]);
    expect(manager.get(pending.id)?.status).toBe('succeeded');
    const diff = await manager.diff(pending.id);
    expect(diff.files[0]?.after).toBe(VALID_HTML);
    expect(diff.validation.ok).toBe(true);
  });

  it('reconciles a promotion that completed before the job record was written', async () => {
    const { workspace, engine, store } = await setup();
    const pending = job({ status: 'succeeded', validation: { ok: true, issues: [] } });
    await store.save(pending);
    const staging = join(workspace.projectDir('demo'), 'staging', pending.id);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, 'index.html'), VALID_HTML, 'utf8');
    const promoted = await workspace.promote('demo', pending.id, 'Recovered promotion', {
      baseVersion: null,
      jobId: pending.id,
    });

    const manager = managerFor(workspace, engine);
    await manager.recover();

    expect(promoted.version).toBe(1);
    expect(manager.get(pending.id)?.version).toBe(1);
    const persisted = JSON.parse(
      await readFile(join(workspace.projectDir('demo'), 'jobs', `${pending.id}.json`), 'utf8'),
    ) as ForgeJob;
    expect(persisted.version).toBe(1);
  });

  it('reports an unreadable job record while keeping readable jobs', async () => {
    const { workspace, engine, store } = await setup();
    const good = job({ status: 'succeeded' });
    await store.save(good);
    const staging = join(workspace.projectDir('demo'), 'staging', good.id);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, 'index.html'), VALID_HTML, 'utf8');
    await writeFile(
      join(workspace.projectDir('demo'), 'jobs', `${randomUUID()}.json`),
      '{broken',
      'utf8',
    );

    const manager = managerFor(workspace, engine);
    const report = await manager.recover();

    expect(manager.get(good.id)).toBeDefined();
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.code).toBe('job_unreadable');
  });

  it('surfaces a malformed state file instead of showing an empty project', async () => {
    const { workspace } = await setup();
    const statePath = join(workspace.projectDir('demo'), 'state.json');
    const malformed = '{ "current_version": 1, "versions": [';
    await writeFile(statePath, malformed, 'utf8');

    await expect(workspace.state('demo')).rejects.toMatchObject({ code: 'state_corrupt' });
    await expect(workspace.ensureProject('demo')).rejects.toMatchObject({
      code: 'state_corrupt',
    });
    expect(await readFile(statePath, 'utf8')).toBe(malformed);
  });

  it('refuses to start a job when the durable write fails', async () => {
    const { workspace, engine } = await setup();
    const failing: ForgeJobPersistence = {
      save: async () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
      flush: async () => undefined,
      loadAll: async () => ({ jobs: [], issues: [] }),
    };
    const manager = managerFor(workspace, engine, failing);

    await expect(
      manager.start({
        projectId: 'demo',
        kind: 'generate',
        prompt: 'A small application that must never reach a model.',
      }),
    ).rejects.toMatchObject({ code: 'persistence_failed' });

    expect(manager.list('demo')).toEqual([]);
    const report = manager.recovery('demo');
    // The failed start is removed with its job; it must not leave a permanent
    // active storage failure after the transient write failed.
    expect(report.storage.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('loads interrupted jobs through the HTTP startup path', async () => {
    const { root, workspace, engine, store, db } = await setup();
    const running = job({ status: 'running', started_at: '2026-10-01T00:01:00.000Z' });
    await store.save(running);
    const manager = managerFor(workspace, engine);
    const app = await buildApp({
      config: appConfig(root),
      db,
      dbPath: ':memory:',
      provider: new EchoProvider(),
      engine,
      forgeWorkspace: workspace,
      forgeManager: manager,
      providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/forge/projects/demo',
      });
      expect(response.statusCode).toBe(200);
      const view = response.json().data as {
        jobs: Array<{ id: string; status: string }>;
        recovery: {
          startup: { interrupted_jobs: number; loaded_jobs: number };
          storage: {
            ok: boolean;
            scope: string;
            root_ok: boolean;
            project_ok: boolean | null;
          };
        };
      };
      expect(view.jobs.find((entry) => entry.id === running.id)?.status).toBe('interrupted');
      expect(view.recovery.startup.loaded_jobs).toBe(1);
      expect(view.recovery.startup.interrupted_jobs).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('terminates an owned child on app.close and reloads a cancelled job', async () => {
    const { root, workspace, engine, db } = await setup();
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: FIXTURE,
      env: { FAKE_MUSE_MODE: 'ignore-term' },
      maxRuntimeMs: 30_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      shutdownGraceMs: 150,
      runtimeCheck: async () => ({ ok: true, errors: [] }),
      now: () => new Date('2026-10-10T00:00:00.000Z'),
    });
    const app = await buildApp({
      config: appConfig(root),
      db,
      dbPath: ':memory:',
      provider: new EchoProvider(),
      engine,
      forgeWorkspace: workspace,
      forgeManager: manager,
      providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
    });
    let closed = false;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/forge/projects/demo/generate',
        payload: { prompt: 'A small application that stays alive until shutdown.' },
      });
      expect(created.statusCode).toBe(202);
      const jobId = created.json().data.id as string;
      const pid = await waitForPid(
        join(workspace.projectDir('demo'), 'staging', jobId, 'child.pid'),
      );
      expect(processAlive(pid)).toBe(true);

      await app.close();
      closed = true;

      expect(processAlive(pid)).toBe(false);
      expect(manager.get(jobId)?.status).toBe('cancelled');
      expect(manager.get(jobId)?.error).toContain('shut down');

      const persisted = JSON.parse(
        await readFile(join(workspace.projectDir('demo'), 'jobs', `${jobId}.json`), 'utf8'),
      ) as ForgeJob;
      expect(persisted.status).toBe('cancelled');

      const first = manager.shutdown();
      expect(manager.shutdown()).toBe(first);
      await first;
      await expect(
        manager.start({
          projectId: 'demo',
          kind: 'generate',
          prompt: 'A job that must be refused during shutdown.',
        }),
      ).rejects.toMatchObject({ code: 'shutting_down' });

      const reopened = managerFor(workspace, engine);
      const report = await reopened.recover();
      expect(reopened.get(jobId)?.status).toBe('cancelled');
      expect(report.startup.interrupted_jobs).toBe(0);
      expect(report.issues).toEqual([]);
    } finally {
      if (!closed) await app.close().catch(() => undefined);
    }
  });

  it('terminates the fallback child after a quota failover', async () => {
    const { workspace, engine } = await setup();
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: FIXTURE,
      env: { FAKE_MUSE_MODE: 'ignore-term-fallback' },
      fallbackApiKey: 'test-fallback-key',
      fallbackModel: 'fake-fallback-model',
      maxRuntimeMs: 30_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      shutdownGraceMs: 150,
      runtimeCheck: async () => ({ ok: true, errors: [] }),
    });
    try {
      const job = await manager.start({
        projectId: 'demo',
        kind: 'generate',
        prompt: 'A job that fails over and then waits for shutdown.',
      });
      const pid = await waitForPid(
        join(workspace.projectDir('demo'), 'staging', job.id, 'child.pid'),
      );
      expect(processAlive(pid)).toBe(true);
      expect(manager.get(job.id)?.status).toBe('running');

      await manager.shutdown();
      expect(processAlive(pid)).toBe(false);
      expect(manager.get(job.id)?.status).toBe('cancelled');

      const reopened = managerFor(workspace, engine);
      const report = await reopened.recover();
      expect(reopened.get(job.id)?.status).toBe('cancelled');
      expect(report.startup.interrupted_jobs).toBe(0);
    } finally {
      await manager.shutdown().catch(() => undefined);
    }
  });

  it('keeps immutable startup counts separate from jobs created later', async () => {
    const { workspace, engine, store } = await setup();
    await store.save(job({ status: 'succeeded', validation: { ok: true, issues: [] } }));
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: FIXTURE,
      env: { FAKE_MUSE_MODE: 'auto' },
      maxRuntimeMs: 10_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      runtimeCheck: async () => ({ ok: true, errors: [] }),
      shutdownGraceMs: 100,
    });
    try {
      await manager.recover();
      const before = manager.recovery('demo');
      expect(before.startup.loaded_jobs).toBe(1);
      expect(before.current_jobs).toBe(1);

      const created = await manager.start({
        projectId: 'demo',
        kind: 'generate',
        prompt: 'A small accessible task list for the startup count test.',
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (manager.get(created.id)?.status === 'succeeded') break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const after = manager.recovery('demo');
      expect(after.startup.loaded_jobs).toBe(1);
      expect(after.current_jobs).toBe(2);
    } finally {
      await manager.shutdown();
    }
  });

  it('isolates project storage failures and clears only the checked project', async () => {
    const { workspace, engine } = await setup();
    await workspace.ensureProject('other');
    const store = new ControlledStore(workspace);
    store.failAfterFirstSave.add('other');
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: FIXTURE,
      env: { FAKE_MUSE_MODE: 'sleep' },
      maxRuntimeMs: 30_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      runtimeCheck: async () => ({ ok: true, errors: [] }),
      jobStore: store,
      shutdownGraceMs: 100,
    });
    try {
      await manager.start({
        projectId: 'other',
        kind: 'generate',
        prompt: 'A slow job that will hit an injected storage failure.',
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!manager.recovery('other').storage.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const other = manager.recovery('other');
      expect(other.storage.ok).toBe(false);
      expect(other.storage.scope).toBe('project');
      expect(manager.recovery('demo').storage.ok).toBe(true);

      // A successful save in a different project must not clear the failure.
      await manager.start({
        projectId: 'demo',
        kind: 'generate',
        prompt: 'A job in the healthy project that must not clear another failure.',
      });
      expect(manager.recovery('other').storage.ok).toBe(false);

      const checked = await manager.checkStorage('other');
      expect(checked.storage.ok).toBe(true);
      expect(checked.storage.scope).toBe('healthy');
    } finally {
      await manager.shutdown();
    }
  });

  it('treats a load failure as store-wide and clears it only with a successful health check', async () => {
    const { workspace, engine } = await setup();
    const store = new ControlledStore(workspace);
    store.failLoads = true;
    const manager = managerFor(workspace, engine, store);
    const report = await manager.recover();
    expect(report.storage.ok).toBe(false);
    expect(report.storage.scope).toBe('store');
    expect(report.issues[0]?.code).toBe('job_store_unreadable');

    const checked = await manager.checkStorage('demo');
    expect(checked.storage.ok).toBe(true);
    expect(checked.storage.scope).toBe('healthy');
    // The historical incident remains for audit until explicitly acknowledged.
    const incident = checked.issues.find((issue) => issue.code === 'job_store_unreadable');
    expect(incident).toBeDefined();
    const acknowledged = await manager.acknowledge('demo', [incident?.id as string]);
    expect(acknowledged.issues).toEqual([]);
    expect(acknowledged.acknowledged_issues).toBe(1);
  });

  it('persists acknowledgement across manager restarts without deleting the record', async () => {
    const { workspace, engine } = await setup();
    await writeFile(
      join(workspace.projectDir('demo'), 'jobs', `${randomUUID()}.json`),
      '{broken',
      'utf8',
    );
    const manager = managerFor(workspace, engine);
    const report = await manager.recover();
    const incident = report.issues.find((issue) => issue.code === 'job_unreadable');
    expect(incident).toBeDefined();
    await manager.acknowledge('demo', [incident?.id as string]);

    const reopened = managerFor(workspace, engine);
    const afterRestart = await reopened.recover();
    expect(afterRestart.issues).toEqual([]);
    expect(afterRestart.acknowledged_issues).toBe(1);
    // The malformed job file remains on disk; acknowledgement is not deletion.
    const files = await readdir(join(workspace.projectDir('demo'), 'jobs'));
    expect(files.some((name) => name.endsWith('.json'))).toBe(true);
  });

  it('does not publish an acknowledgement when the write fails', async () => {
    const { root, workspace, engine } = await setup();
    await writeFile(
      join(workspace.projectDir('demo'), 'jobs', `${randomUUID()}.json`),
      '{broken',
      'utf8',
    );
    const manager = managerFor(workspace, engine);
    const before = await manager.recover();
    const incident = before.issues.find((issue) => issue.code === 'job_unreadable');
    expect(incident).toBeDefined();

    // Make the ack target a directory so the atomic rename must fail.
    await mkdir(join(root, 'forge', '.recovery-ack.json'));
    await expect(manager.acknowledge('demo', [incident?.id as string])).rejects.toMatchObject({
      code: 'persistence_failed',
    });

    const after = manager.recovery('demo');
    expect(after.issues.some((issue) => issue.id === incident?.id)).toBe(true);
    expect(after.acknowledged_issues).toBe(0);
  });

  it('serialises overlapping acknowledgements without losing ids', async () => {
    const { workspace, engine } = await setup();
    for (let index = 0; index < 2; index += 1) {
      await writeFile(
        join(workspace.projectDir('demo'), 'jobs', `${randomUUID()}.json`),
        '{broken',
        'utf8',
      );
    }
    const manager = managerFor(workspace, engine);
    const report = await manager.recover();
    const incidents = report.issues.filter((issue) => issue.code === 'job_unreadable');
    expect(incidents).toHaveLength(2);

    await Promise.all([
      manager.acknowledge('demo', [incidents[0]?.id as string]),
      manager.acknowledge('demo', [incidents[1]?.id as string]),
    ]);

    const after = manager.recovery('demo');
    expect(after.issues).toEqual([]);
    expect(after.acknowledged_issues).toBe(2);

    const reopened = managerFor(workspace, engine);
    const recovered = await reopened.recover();
    expect(recovered.issues).toEqual([]);
    expect(recovered.acknowledged_issues).toBe(2);
  });

  it('does not allow an active storage failure to be acknowledged as history', async () => {
    const { workspace, engine } = await setup();
    await workspace.ensureProject('other');
    const store = new ControlledStore(workspace);
    store.failAfterFirstSave.add('other');
    const manager = new ForgeJobManager({
      workspace,
      engine,
      museBin: FIXTURE,
      env: { FAKE_MUSE_MODE: 'sleep' },
      maxRuntimeMs: 30_000,
      maxCalls: 10,
      maxInputTokens: 10_000_000,
      runtimeCheck: async () => ({ ok: true, errors: [] }),
      jobStore: store,
      shutdownGraceMs: 100,
    });
    try {
      await manager.start({
        projectId: 'other',
        kind: 'generate',
        prompt: 'A slow job that will hit an injected storage failure.',
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!manager.recovery('other').storage.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const active = manager.recovery('other').issues.find((issue) => issue.kind === 'active');
      expect(active).toBeDefined();
      const after = await manager.acknowledge('other', [active?.id as string]);
      expect(after.issues.some((issue) => issue.id === active?.id)).toBe(true);
      expect(after.acknowledged_issues).toBe(0);
      expect(after.storage.ok).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });

  it('clears root and project health failures only when each scope is retested', async () => {
    const { workspace, engine } = await setup();
    await workspace.ensureProject('good');
    await workspace.ensureProject('bad');
    const store = new ControlledStore(workspace);
    store.projectHealthFailures.add('bad');
    const manager = managerFor(workspace, engine, store);

    const bad = await manager.checkStorage('bad');
    expect(bad.storage).toMatchObject({
      ok: false,
      scope: 'project',
      root_ok: true,
      project_ok: false,
    });

    const good = await manager.checkStorage('good');
    expect(good.storage).toMatchObject({
      ok: true,
      scope: 'healthy',
      root_ok: true,
      project_ok: true,
    });
    // Checking a good project must not make the bad project healthy.
    expect(manager.recovery('bad').storage.scope).toBe('project');

    store.rootHealthOk = false;
    const rootFailure = await manager.checkStorage('good');
    expect(rootFailure.storage).toMatchObject({
      ok: false,
      scope: 'store',
      root_ok: false,
      project_ok: true,
    });
    // A root success later cannot clear the bad project's own failure.
    store.rootHealthOk = true;
    store.projectHealthFailures.delete('bad');
    expect((await manager.checkStorage('good')).storage.scope).toBe('healthy');
    expect((await manager.checkStorage('bad')).storage.scope).toBe('healthy');
  });

  it.runIf(process.platform !== 'win32')(
    'reports a real workspace-root check failure without clearing it via a project check',
    async () => {
      const { root, workspace, engine } = await setup();
      const manager = managerFor(workspace, engine);
      const forgeRoot = join(root, 'forge');
      await chmod(forgeRoot, 0o500);
      try {
        const report = await manager.checkStorage('demo');
        expect(report.storage).toMatchObject({
          ok: false,
          scope: 'store',
          root_ok: false,
          project_ok: true,
        });
        expect(report.storage.root_error?.length).toBeLessThanOrEqual(300);
      } finally {
        await chmod(forgeRoot, 0o700);
      }
      expect((await manager.checkStorage('demo')).storage.scope).toBe('healthy');
    },
  );

  it('reports a real project-directory failure independently of the root', async () => {
    const { root, workspace, engine } = await setup();
    await workspace.ensureProject('good');
    const jobs = join(root, 'forge', 'demo', 'jobs');
    await rm(jobs, { recursive: true, force: true });
    await writeFile(jobs, 'not a directory', 'utf8');
    const manager = managerFor(workspace, engine);

    const bad = await manager.checkStorage('demo');
    expect(bad.storage).toMatchObject({
      ok: false,
      scope: 'project',
      root_ok: true,
      project_ok: false,
    });
    expect(bad.storage.project_error?.length).toBeLessThanOrEqual(300);

    expect((await manager.checkStorage('good')).storage.scope).toBe('healthy');
    expect(manager.recovery('demo').storage.scope).toBe('project');
  });

  it('keeps a prior successful acknowledgement when a later write fails', async () => {
    const { root, workspace, engine } = await setup();
    for (let index = 0; index < 2; index += 1) {
      await writeFile(
        join(workspace.projectDir('demo'), 'jobs', `${randomUUID()}.json`),
        '{broken',
        'utf8',
      );
    }
    const manager = managerFor(workspace, engine);
    const report = await manager.recover();
    const incidents = report.issues.filter((issue) => issue.code === 'job_unreadable');
    expect(incidents).toHaveLength(2);
    await manager.acknowledge('demo', [incidents[0]?.id as string]);

    const ackPath = join(root, 'forge', '.recovery-ack.json');
    await rm(ackPath, { force: true });
    await mkdir(ackPath);
    await expect(manager.acknowledge('demo', [incidents[1]?.id as string])).rejects.toMatchObject({
      code: 'persistence_failed',
    });

    const after = manager.recovery('demo');
    expect(after.issues.some((issue) => issue.id === incidents[0]?.id)).toBe(false);
    expect(after.issues.some((issue) => issue.id === incidents[1]?.id)).toBe(true);
    expect(after.acknowledged_issues).toBe(1);
  });
});
