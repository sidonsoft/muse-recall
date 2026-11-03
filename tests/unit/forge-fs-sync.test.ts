import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncDirectory, syncFile } from '../../apps/server/src/forge/fs-utils.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-sync-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('syncFile', () => {
  it('succeeds on an existing file without changing its bytes', async () => {
    const file = join(root, 'state.json');
    await writeFile(file, '{"ok":true}\n');
    await expect(syncFile(file)).resolves.toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe('{"ok":true}\n');
  });

  it('propagates a genuine missing-file error so callers treat it as a write failure', async () => {
    await expect(syncFile(join(root, 'missing.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('syncDirectory', () => {
  it('succeeds on a real directory', async () => {
    await expect(syncDirectory(root)).resolves.toBeUndefined();
  });

  it('is best-effort: a missing directory does not fail the caller', async () => {
    await expect(syncDirectory(join(root, 'never-existed'))).resolves.toBeUndefined();
  });
});
