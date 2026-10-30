import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  for (const manager of managers.splice(0)) {
    await manager.shutdown().catch(() => undefined);
  }
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function writeWrapper(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

async function setup(workerWrapper?: string | null) {
  const root = await mkdtemp(join(tmpdir(), 'forge-wrapper-'));
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
    runtimeCheck: async () => ({ ok: true, errors: [] }),
    shutdownGraceMs: 100,
    ...(workerWrapper === undefined ? {} : { workerWrapper }),
  });
  managers.push(manager);
  return { manager };
}

describe('Forge worker wrapper (G-2 isolation seam)', () => {
  it('launches the CLI through the wrapper and passes argv through unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-wrapper-script-'));
    roots.push(dir);
    const logPath = join(dir, 'argv.log');
    const wrapper = await writeWrapper(
      dir,
      'wrap.sh',
      `printf '%s\\n' "$@" > '${logPath}'\nexec "$@"`,
    );

    const { manager } = await setup(wrapper);
    expect(manager.workerWrapper?.path).toBe(wrapper);

    const created = await manager.start({
      projectId: 'demo',
      kind: 'generate',
      prompt: 'A small accessible task list behind a wrapper.',
    });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const job = manager.get(created.id);
      if (job && ['succeeded', 'failed'].includes(job.status)) {
        expect(job.status).toBe('succeeded');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const recorded = await readFile(logPath, 'utf8');
    expect(recorded.split('\n')[0]).toBe(FIXTURE);
    expect(recorded).toContain('--max-model-steps');
  });

  it('refuses boot when the wrapper path is not an executable file', async () => {
    await expect(setup('/nonexistent/wrapper-for-test')).rejects.toThrow(/not an executable file/);
  });

  it('refuses boot when the configured wrapper fails the pass-through probe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-wrapper-bad-'));
    roots.push(dir);
    const wrapper = await writeWrapper(dir, 'exit3.sh', 'exit 3');
    await expect(setup(wrapper)).rejects.toThrow(/failed the pass-through probe with exit code 3/);
  });

  it('refuses boot for a relative wrapper path', async () => {
    await expect(setup('relative/wrapper')).rejects.toThrow(/must be an absolute path/);
  });

  it('workerWrapper: null ignores an inherited FORGE_WORKER_WRAPPER env value', () => {
    const previous = process.env.FORGE_WORKER_WRAPPER;
    process.env.FORGE_WORKER_WRAPPER = '/nonexistent/leaked-wrapper';
    try {
      // Construction must NOT throw and must stay unwrapped: the explicit
      // null disables the env value (mirrors how tests opt out of a host
      // operator's wrapper).
      const database = openDatabase({ path: ':memory:', wal: false });
      databases.push(database);
      const manager = new ForgeJobManager({
        workspace: new ForgeWorkspace('/tmp/unused-for-construction-test'),
        engine: new MemoryEngine(database.db),
        museBin: FIXTURE,
        workerWrapper: null,
      });
      managers.push(manager);
      expect(manager.workerWrapper).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.FORGE_WORKER_WRAPPER;
      else process.env.FORGE_WORKER_WRAPPER = previous;
    }
  });
});
