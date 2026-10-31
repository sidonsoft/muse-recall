import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyWorkerWrapper,
  probeWorkerStagingAccess,
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

describe('worker wrapper staging-access probe (KI-49 beta fix)', () => {
  it('passes a pass-through wrapper and cleans its scratch tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-staging-'));
    dirs.push(dir);
    const path = await executable(dir, 'wrap.sh', 'exec "$@"');
    const scratchRoot = join(dir, 'workspace');
    expect(probeWorkerStagingAccess({ path }, { scratchRoot })).toBeNull();
    // The probe created its scratch tree INSIDE the provided root (proven by
    // the two negative controls below flipping this exact call to failure)
    // and removed every scratch it made, leaving only the empty root.
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it('fails with an actionable KI-49 message when the prompt becomes unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-staging-'));
    dirs.push(dir);
    // Simulates the cross-uid EACCES shape (KI-49) without needing setuid:
    // the wrapper revokes the 0600 prompt before exec'ing node.
    const path = await executable(dir, 'revoke.sh', 'chmod 000 "$4" 2>/dev/null\nexec "$@"');
    expect(probeWorkerStagingAccess({ path })).toMatch(/failed the staging-access probe/);
  });

  it('fails when the staging directory refuses writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-wrapper-staging-'));
    dirs.push(dir);
    // Two-stage (no exec) so the wrapper can restore the directory mode
    // before the probe cleans up: revoke write in cwd, run, restore, report.
    const path = await executable(
      dir,
      'readonly.sh',
      'parent=$(dirname "$4"); chmod 500 "$parent" 2>/dev/null; "$@"; rc=$?; chmod 700 "$parent"; exit $rc',
    );
    expect(probeWorkerStagingAccess({ path })).toMatch(/failed the staging-access probe/);
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
