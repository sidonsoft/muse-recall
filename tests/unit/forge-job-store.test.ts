import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ForgeJob, ForgeJobSchema } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeJobStore } from '../../apps/server/src/forge/job-store.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'forge-store-'));
  roots.push(root);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  return { root, workspace, store: new ForgeJobStore(workspace) };
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

class SlowStore extends ForgeJobStore {
  writes: ForgeJob[] = [];
  failAt: number | null = null;
  private count = 0;

  protected override async write(job: ForgeJob): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.count += 1;
    if (this.failAt !== null && this.count >= this.failAt) {
      throw Object.assign(new Error('injected slow write failure'), { code: 'ENOSPC' });
    }
    this.writes.push(job);
    await super.write(job);
  }
}

describe('ForgeJobStore', () => {
  it('round-trips a job and leaves no temporary file behind', async () => {
    const { workspace, store } = await setup();
    const record = job({ status: 'succeeded', version: 1 });
    await store.save(record);
    await store.flush(record.id);

    const loaded = await store.loadAll();
    expect(loaded.issues).toEqual([]);
    expect(loaded.jobs).toEqual([record]);

    const jobsDir = join(workspace.projectDir('demo'), 'jobs');
    expect(await readdir(jobsDir)).toEqual([`${record.id}.json`]);
    expect((await readFile(join(jobsDir, `${record.id}.json`), 'utf8')).endsWith('\n')).toBe(true);
  });

  it('serialises writes per job so the newest state wins', async () => {
    const { store } = await setup();
    const id = randomUUID();
    const running = job({ id, status: 'running', started_at: '2026-10-01T00:01:00.000Z' });
    const succeeded = job({
      id,
      status: 'succeeded',
      started_at: '2026-10-01T00:01:00.000Z',
      finished_at: '2026-10-01T00:02:00.000Z',
      validation: { ok: true, issues: [] },
    });
    await Promise.all([store.save(running), store.save(succeeded)]);
    await store.flush(id);

    const loaded = await store.loadAll();
    expect(loaded.jobs[0]?.status).toBe('succeeded');
    expect(loaded.jobs[0]?.validation?.ok).toBe(true);
  });

  it('reports malformed records instead of hiding the rest of the project', async () => {
    const { workspace, store } = await setup();
    const good = job({ status: 'succeeded' });
    await store.save(good);
    const jobsDir = join(workspace.projectDir('demo'), 'jobs');
    await writeFile(join(jobsDir, `${randomUUID()}.json`), '{ not json', 'utf8');

    const loaded = await store.loadAll();
    expect(loaded.jobs.map((entry) => entry.id)).toEqual([good.id]);
    expect(loaded.issues).toHaveLength(1);
    expect(loaded.issues[0]).toMatchObject({
      code: 'job_unreadable',
      project_id: 'demo',
    });
    expect(loaded.issues[0]?.file).toContain('/jobs/');
  });

  it('reports a job stored under the wrong file name', async () => {
    const { workspace, store } = await setup();
    const record = job();
    const jobsDir = join(workspace.projectDir('demo'), 'jobs');
    await mkdir(jobsDir, { recursive: true });
    await writeFile(
      join(jobsDir, `${randomUUID()}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );

    const loaded = await store.loadAll();
    expect(loaded.jobs).toEqual([]);
    expect(loaded.issues[0]?.code).toBe('job_project_mismatch');
  });

  it('coalesces a burst of intermediate snapshots and keeps the newest', async () => {
    const { workspace } = await setup();
    const store = new SlowStore(workspace);
    const id = randomUUID();
    await store.save(job({ id, logs: ['initial'] }), { required: true });
    const burst = Array.from({ length: 40 }, (_, index) =>
      job({ id, logs: [`log-${String(index)}`] }),
    );
    await Promise.all(burst.map((entry) => store.save(entry, { required: false })));
    await store.flush(id);

    // One in-flight write plus one coalesced replacement, not 40 rewrites.
    expect(store.writes.length).toBeLessThanOrEqual(3);
    const loaded = await store.loadAll();
    expect(loaded.issues).toEqual([]);
    expect(loaded.jobs[0]?.logs).toEqual(['log-39']);
  });

  it('reports the newest required snapshot and surfaces a failed write through flush', async () => {
    const { workspace } = await setup();
    const store = new SlowStore(workspace);
    const id = randomUUID();
    await store.save(job({ id, logs: ['initial'] }), { required: true });

    store.failAt = 2;
    const first = store.save(job({ id, logs: ['intermediate'] }), { required: false });
    const terminal = store.save(job({ id, logs: ['terminal'], status: 'succeeded' }), {
      required: true,
    });
    // The intermediate and required snapshots coalesce into one failed write;
    // both callers see the failure rather than a false success.
    await expect(first).rejects.toThrow('injected slow write failure');
    await expect(terminal).rejects.toThrow('injected slow write failure');
    await expect(store.flush(id)).rejects.toThrow('injected slow write failure');
  });
});
