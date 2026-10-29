import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCliAvailable } from '../../apps/server/src/forge/cli-lookup.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function binDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mml-cli-'));
  dirs.push(dir);
  const bin = join(dir, 'muse');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  return dir;
}

describe.skipIf(process.platform === 'win32')('isCliAvailable', () => {
  it('finds a bare name on PATH', () => {
    expect(isCliAvailable('muse', { PATH: binDir() })).toBe(true);
  });

  it('reports a missing CLI, as in a codespace without Muse', () => {
    expect(isCliAvailable('muse', { PATH: mkdtempSync(join(tmpdir(), 'mml-empty-')) })).toBe(false);
    expect(isCliAvailable('muse', {})).toBe(false);
  });

  it('checks an explicit path directly', () => {
    const dir = binDir();
    expect(isCliAvailable(join(dir, 'muse'), {})).toBe(true);
    expect(isCliAvailable(join(dir, 'missing'), {})).toBe(false);
  });

  it('ignores a file that is not executable', () => {
    const dir = binDir();
    chmodSync(join(dir, 'muse'), 0o644);
    expect(isCliAvailable('muse', { PATH: dir })).toBe(false);
  });
});
