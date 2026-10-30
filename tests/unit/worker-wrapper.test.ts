import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyWorkerWrapper,
  probeWorkerWrapper,
  resolveWorkerWrapper,
} from '../../apps/server/src/forge/worker-wrapper.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function executable(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

describe('worker wrapper resolution (G-2)', () => {
  it('unset or blank means no wrapper and no error', () => {
    expect(resolveWorkerWrapper({})).toEqual({ wrapper: null, error: null });
    expect(resolveWorkerWrapper({ FORGE_WORKER_WRAPPER: '   ' })).toEqual({
      wrapper: null,
      error: null,
    });
  });

  it('rejects relative paths and non-executable targets with actionable errors', () => {
    expect(resolveWorkerWrapper({ FORGE_WORKER_WRAPPER: 'bin/wrap.sh' }).error).toMatch(
      /must be an absolute path/,
    );
    expect(resolveWorkerWrapper({ FORGE_WORKER_WRAPPER: '/no/such/wrapper' }).error).toMatch(
      /not an executable file/,
    );
  });

  it('accepts an absolute executable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-unit-'));
    dirs.push(dir);
    const path = await executable(dir, 'wrap.sh', 'exec "$@"');
    expect(resolveWorkerWrapper({ FORGE_WORKER_WRAPPER: path })).toEqual({
      wrapper: { path },
      error: null,
    });
  });
});

describe('worker wrapper probe (G-2)', () => {
  it('passes when the wrapper executes its argv', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-unit-'));
    dirs.push(dir);
    const path = await executable(dir, 'wrap.sh', 'exec "$@"');
    expect(probeWorkerWrapper({ path })).toBeNull();
  });

  it('reports the exit code when the wrapper breaks pass-through', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-unit-'));
    dirs.push(dir);
    const path = await executable(dir, 'noexec.sh', 'exit 7');
    expect(probeWorkerWrapper({ path })).toMatch(/failed the pass-through probe with exit code 7/);
  });

  it('reports a wrapper that cannot start at all', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'worker-wrapper-unit-')), 'gone.sh');
    expect(probeWorkerWrapper({ path })).toMatch(/could not start/);
  });
});

describe('spawn composition (G-2)', () => {
  it('without a wrapper the CLI launches directly', () => {
    expect(applyWorkerWrapper(null, 'muse', ['a'])).toEqual({ command: 'muse', argv: ['a'] });
  });

  it('with a wrapper the CLI becomes the wrapper argv head', () => {
    expect(applyWorkerWrapper({ path: '/usr/local/bin/setpriv-wrap' }, 'muse', ['a', 'b'])).toEqual(
      {
        command: '/usr/local/bin/setpriv-wrap',
        argv: ['muse', 'a', 'b'],
      },
    );
  });
});
