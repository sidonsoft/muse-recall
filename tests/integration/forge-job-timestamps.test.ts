import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import type { ForgeJob } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));

const roots: string[] = [];
const databases: Array<{ close: () => void }> = [];
const managers: ForgeJobManager[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    await manager.shutdown().catch(() => undefined);
  }
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup(
  runtimeCheck: (html: string) => Promise<{
    ok: boolean;
    errors: string[];
    browser?: string | null;
  }> = async () => ({ ok: true, errors: [] }),
) {
  const root = await mkdtemp(join(tmpdir(), 'forge-timestamps-'));
  roots.push(root);
  const database = openDatabase({ path: ':memory:', wal: false });
  databases.push(database);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  const engine = new MemoryEngine(database.db);

  let current = new Date('2026-11-01T08:00:00.000Z');
  const clock = {
    advance(iso: string): void {
      current = new Date(iso);
    },
    now: (): Date => new Date(current),
  };

  const createManager = (): ForgeJobManager => {
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
      now: clock.now,
      shutdownGraceMs: 100,
    });
    managers.push(manager);
    return manager;
  };

  return { root, workspace, engine, clock, createManager };
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

async function persistedJob(root: string, jobId: string): Promise<ForgeJob> {
  return JSON.parse(
    await readFile(join(root, 'forge', 'demo', 'jobs', `${jobId}.json`), 'utf8'),
  ) as ForgeJob;
}

async function startGenerated(manager: ForgeJobManager): Promise<ForgeJob> {
  const created = await manager.start({
    projectId: 'demo',
    kind: 'generate',
    prompt: 'A small accessible task list for the timestamp test.',
  });
  const finished = await waitForFinish(manager, created.id);
  expect(finished.status).toBe('succeeded');
  expect(finished.finished_at).not.toBeNull();
  return finished;
}

describe('Forge job completion timestamps', () => {
  it('preserves generation completion through approval and a durable reload', async () => {
    const { root, clock, createManager } = await setup();
    const manager = createManager();
    const finished = await startGenerated(manager);
    const generationFinishedAt = finished.finished_at;

    expect((await persistedJob(root, finished.id)).finished_at).toBe(generationFinishedAt);

    clock.advance('2026-11-02T09:30:00.000Z');
    const approved = await manager.approve(finished.id, { captureMemory: false });

    expect(approved.job.finished_at).toBe(generationFinishedAt);
    // Approval time is still observable where it belongs.
    expect(approved.job.approval_verification?.recorded_at).toBe('2026-11-02T09:30:00.000Z');
    expect((await persistedJob(root, finished.id)).finished_at).toBe(generationFinishedAt);

    const reloaded = createManager();
    await reloaded.recover();
    const durable = reloaded.get(finished.id);
    expect(durable?.status).toBe('succeeded');
    expect(durable?.version).toBe(1);
    expect(durable?.finished_at).toBe(generationFinishedAt);
  });

  it('preserves generation completion through rejection and a durable reload', async () => {
    const { root, clock, createManager } = await setup();
    const manager = createManager();
    const finished = await startGenerated(manager);
    const generationFinishedAt = finished.finished_at;

    clock.advance('2026-11-03T10:15:00.000Z');
    const rejected = await manager.reject(finished.id);

    expect(rejected.status).toBe('rejected');
    expect(rejected.finished_at).toBe(generationFinishedAt);
    expect((await persistedJob(root, finished.id)).finished_at).toBe(generationFinishedAt);

    const reloaded = createManager();
    await reloaded.recover();
    const durable = reloaded.get(finished.id);
    expect(durable?.status).toBe('rejected');
    expect(durable?.finished_at).toBe(generationFinishedAt);
  });

  it('uses the failure time when approval turns a completed job into a failure', async () => {
    const { root, clock, createManager } = await setup(async () => ({
      ok: false,
      errors: ['runtime boom'],
    }));
    const manager = createManager();
    const finished = await startGenerated(manager);
    const generationFinishedAt = finished.finished_at;

    clock.advance('2026-11-04T12:00:00.000Z');
    await expect(manager.approve(finished.id, { captureMemory: false })).rejects.toMatchObject({
      code: 'runtime_failed',
    });

    const failed = await persistedJob(root, finished.id);
    expect(failed.status).toBe('failed');
    expect(failed.finished_at).toBe('2026-11-04T12:00:00.000Z');
    expect(failed.finished_at).not.toBe(generationFinishedAt);
  });
});
