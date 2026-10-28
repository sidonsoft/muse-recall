import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import type { ForgeJob } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { type ForgeJobPersistence, ForgeJobStore } from '../../apps/server/src/forge/job-store.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));
const roots: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

class FaultStore implements ForgeJobPersistence {
  readonly inner: ForgeJobStore;
  constructor(
    workspace: ForgeWorkspace,
    private readonly shouldFail: (job: ForgeJob) => boolean,
  ) {
    this.inner = new ForgeJobStore(workspace);
  }
  async save(job: ForgeJob): Promise<void> {
    if (this.shouldFail(job))
      throw Object.assign(new Error('injected storage failure'), { code: 'ENOSPC' });
    await this.inner.save(job);
  }
  async flush(jobId: string): Promise<void> {
    await this.inner.flush(jobId);
  }
  async loadAll() {
    return this.inner.loadAll();
  }
  async healthCheck() {
    // These durability tests do not exercise the storage health-check path.
    return {
      root: { ok: true, error: null },
      project: { ok: true, error: null },
    };
  }
}

async function setup(
  failWhen: (job: ForgeJob) => boolean,
  runtimeCheck: (html: string) => Promise<{
    ok: boolean;
    errors: string[];
    browser?: string | null;
  }> = async () => ({ ok: true, errors: [] }),
) {
  const root = await mkdtemp(join(tmpdir(), 'forge-durability-'));
  roots.push(root);
  const database = openDatabase({ path: ':memory:', wal: false });
  databases.push(database);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  const engine = new MemoryEngine(database.db);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'auto' },
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck,
    jobStore: new FaultStore(workspace, failWhen),
    shutdownGraceMs: 100,
  });
  return { root, workspace, engine, manager };
}

async function waitForFinish(manager: ForgeJobManager, jobId: string): Promise<ForgeJob> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = manager.get(jobId);
    if (job && ['succeeded', 'failed', 'cancelled', 'budget_exceeded'].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('job did not finish');
}

describe('approval durability policy', () => {
  it('does not block approval on a separate advisory snapshot write', async () => {
    const { manager } = await setup(
      (job) =>
        job.status === 'succeeded' &&
        job.version === null &&
        job.decision_guard !== null &&
        job.decision_guard !== undefined,
    );
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'A small accessible task list for the durability test.',
    });
    const finished = await waitForFinish(manager, created.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.decision_guard).not.toBeNull();

    const approved = await manager.approve(created.id, { captureMemory: false });
    expect(approved.state.current_version).toBe(1);
    expect(approved.job.version).toBe(1);
    expect(approved.job.decision_guard).not.toBeNull();
    await manager.shutdown();
  });

  it('preserves runtime diagnostics when recording the failed approval also fails', async () => {
    const { manager } = await setup(
      (job) => job.status === 'failed',
      async () => ({ ok: false, errors: ['runtime boom'], browser: 'Chromium test' }),
    );
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'A small accessible task list for the durability test.',
    });
    await waitForFinish(manager, created.id);

    await expect(manager.approve(created.id, { captureMemory: false })).rejects.toMatchObject({
      code: 'persistence_failed',
      details: expect.arrayContaining([expect.stringContaining('runtime boom')]),
    });
    await manager.shutdown();
  });

  it('reports partial success when promotion succeeds but the job record cannot be written', async () => {
    const { manager, workspace } = await setup(
      (job) => job.status === 'succeeded' && job.version !== null,
    );
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'A small accessible task list for the durability test.',
    });
    await waitForFinish(manager, created.id);

    await expect(manager.approve(created.id, { captureMemory: false })).rejects.toMatchObject({
      code: 'persistence_failed',
      message: expect.stringContaining('now the approved version'),
    });
    expect((await workspace.state('demo')).current_version).toBe(1);
    expect(manager.get(created.id)?.version).toBe(1);
    await manager.shutdown();
  });
});
