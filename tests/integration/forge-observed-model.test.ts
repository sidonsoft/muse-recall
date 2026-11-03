import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));

const roots: string[] = [];
const databases: Array<{ close: () => void }> = [];
const managers: ForgeJobManager[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown().catch(() => undefined);
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

interface SetupOptions {
  model?: string;
  fallbackApiKey?: string;
  fallbackModel?: string;
}

async function setup(mode: string, options: SetupOptions | string = {}) {
  const opts: SetupOptions = typeof options === 'string' ? { model: options } : options;
  const root = await mkdtemp(join(tmpdir(), 'forge-observed-'));
  roots.push(root);
  const database = openDatabase({ path: ':memory:', wal: false });
  databases.push(database);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  const manager = new ForgeJobManager({
    workspace,
    engine: new MemoryEngine(database.db),
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: mode },
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.fallbackApiKey ? { fallbackApiKey: opts.fallbackApiKey } : {}),
    ...(opts.fallbackModel ? { fallbackModel: opts.fallbackModel } : {}),
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
    shutdownGraceMs: 100,
  });
  managers.push(manager);
  return { manager };
}

async function waitForFinish(manager: ForgeJobManager, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = manager.get(jobId);
    if (job && ['succeeded', 'failed', 'cancelled', 'budget_exceeded'].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('job did not finish');
}

describe('Forge observed model identity (P1#6)', () => {
  it('records the model id the CLI reported, on the job record', async () => {
    const { manager } = await setup('auto');
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'Observed-model identity probe generation.',
    });
    const finished = await waitForFinish(manager, created.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.model_observed).toBe('fake-muse-resolved-1');
    await manager.flush();
    expect(manager.get(created.id)?.model_observed).toBe('fake-muse-resolved-1');
  });

  it('echoes the resolved model when one is requested (fake CLI behaves like the real one)', async () => {
    const { manager } = await setup('auto', 'fake-muse-requested-x');
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'Observed-model echo probe generation.',
    });
    const finished = await waitForFinish(manager, created.id);
    expect(finished.model_observed).toBe('fake-muse-requested-x');
    expect(manager.lastObservedModel()).toBe('fake-muse-requested-x');
  });

  it('failure modes that never reach a model run record no observation', async () => {
    const { manager } = await setup('auth-fail');
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'Auth-fail probe generation.',
    });
    const finished = await waitForFinish(manager, created.id);
    expect(finished.status).toBe('failed');
    expect(finished.model_observed).toBeNull();
    expect(manager.lastObservedModel()).toBeNull();
  });

  it('a fallback attempt reports the second attempt model, last frame wins', async () => {
    const { manager } = await setup('quota-corrupt', {
      model: 'fake-muse-primary-x',
      fallbackApiKey: 'test-fallback-key',
      fallbackModel: 'fake-muse-fallback-y',
    });
    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'Fallback attempt observed-model probe.',
    });
    const finished = await waitForFinish(manager, created.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.model_observed).toBe('fake-muse-fallback-y');
  });
});
