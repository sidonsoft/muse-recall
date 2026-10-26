import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractInlineScripts,
  ForgeError,
  ForgeWorkspace,
  unifiedDiff,
} from '../../apps/server/src/forge/workspace.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const HTML = `<!doctype html><html><body><canvas id="game"></canvas>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<script>const score = 0; console.log(score);</script></body></html>`;

let root: string;
let workspace: ForgeWorkspace;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-ws-'));
  workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo-game');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('containment', () => {
  it('rejects traversal in project ids', () => {
    for (const id of ['../evil', 'evil/../x', '/etc', 'UPPER', 'a']) {
      expect(() => workspace.projectDir(id)).toThrow(ForgeError);
    }
  });

  it('rejects a staged index.html that is a symlink', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await symlink('/etc/passwd', join(staging, 'index.html'));
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/symlink/);
  });

  it('rejects a staging directory that resolves outside the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'forge-outside-'));
    await writeFile(join(outside, 'index.html'), HTML);
    const staging = await workspace.createStaging('demo-game', JOB);
    await rm(staging, { recursive: true, force: true });
    await symlink(outside, staging);
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/escapes|symlink|regular file/);
    await rm(outside, { recursive: true, force: true });
  });
});

describe('versioning', () => {
  it('validates, promotes, and rolls back atomically', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation).toEqual({ ok: true, issues: [] });

    const first = await workspace.promote('demo-game', JOB, 'initial game');
    expect(first).toEqual({ version: 1, previous: null });
    expect(await workspace.currentHtml('demo-game')).toContain('const score = 0;');

    const second = '22222222-2222-4222-8222-222222222222';
    const staging2 = await workspace.createStaging('demo-game', second);
    await writeFile(
      join(staging2, 'index.html'),
      HTML.replace('const score = 0;', 'const score = 1;'),
    );
    await workspace.promote('demo-game', second, 'score change');

    const state = await workspace.state('demo-game');
    expect(state.current_version).toBe(2);
    expect(state.can_rollback).toBe(true);

    const rolled = await workspace.rollback('demo-game');
    expect(rolled).toEqual({ version: 1, previous: 2 });
    expect(await workspace.currentHtml('demo-game')).toContain('const score = 0;');
    expect((await workspace.state('demo-game')).can_rollback).toBe(false);
  });

  it('refuses rollback before a second version exists', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    await workspace.promote('demo-game', JOB, 'only version');
    await expect(workspace.rollback('demo-game')).rejects.toMatchObject({
      code: 'nothing_to_rollback',
    });
  });

  it('rejects a change without touching the approved version', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    await workspace.promote('demo-game', JOB, 'v1');
    const before = await workspace.currentHtml('demo-game');

    const bad = '33333333-3333-4333-8333-333333333333';
    await workspace.createStaging('demo-game', bad);
    await workspace.reject('demo-game', bad);

    expect(await workspace.currentHtml('demo-game')).toBe(before);
    expect((await workspace.state('demo-game')).current_version).toBe(1);
  });

  it('fails validation for HTML that is not a Phaser game', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), '<html><body>hello</body></html>');
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/canvas|Phaser/);
  });
});

describe('diff helpers', () => {
  it('extracts only inline scripts', () => {
    const scripts = extractInlineScripts(
      '<script src="x.js"></script><script>let a = 1;</script><script type="module">let b=2;</script>',
    );
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain('let a = 1');
  });

  it('renders additions and removals around the changed block', () => {
    const diff = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(diff).toContain('-b');
    expect(diff).toContain('+B');
    expect(diff).toContain(' a');
  });
});
