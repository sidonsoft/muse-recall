import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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

    const first = await workspace.promote('demo-game', JOB, 'initial game', {
      baseVersion: null,
      jobId: JOB,
    });
    expect(first).toMatchObject({ version: 1, previous: null });
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await workspace.currentHtml('demo-game')).toContain('const score = 0;');

    const second = '22222222-2222-4222-8222-222222222222';
    const staging2 = await workspace.createStaging('demo-game', second);
    await writeFile(
      join(staging2, 'index.html'),
      HTML.replace('const score = 0;', 'const score = 1;'),
    );
    await workspace.promote('demo-game', second, 'score change', { baseVersion: 1, jobId: second });

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
    await workspace.promote('demo-game', JOB, 'only version', { baseVersion: null, jobId: JOB });
    await expect(workspace.rollback('demo-game')).rejects.toMatchObject({
      code: 'nothing_to_rollback',
    });
  });

  it('rejects a change without touching the approved version', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    await workspace.promote('demo-game', JOB, 'v1', { baseVersion: null, jobId: JOB });
    const before = await workspace.currentHtml('demo-game');

    const bad = '33333333-3333-4333-8333-333333333333';
    await workspace.createStaging('demo-game', bad);
    await workspace.reject('demo-game', bad);

    expect(await workspace.currentHtml('demo-game')).toBe(before);
    expect((await workspace.state('demo-game')).current_version).toBe(1);
  });

  it('accepts a general HTML application that is not a Phaser game', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(staging, 'index.html'),
      `<!doctype html><html><body><main><h1>Focus timer</h1><button id="start">Start</button></main>
<script>document.getElementById('start').addEventListener('click', () => {});</script></body></html>`,
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it('still rejects a Phaser document without a canvas or game initialisation', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(staging, 'index.html'),
      `<!doctype html><html><body><p>Loading Phaser</p>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></body></html>`,
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/Phaser.*canvas|canvas.*Phaser/i);
  });

  it('rejects an empty HTML shell', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), '<!doctype html><html><body></body></html>');
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/renderable|body/i);
  });
});

describe('rollback ancestry', () => {
  let sequence = 0;
  function nextJob(): string {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  }

  async function promoteVersion(html: string, baseVersion: number | null): Promise<number> {
    const id = nextJob();
    const staging = await workspace.createStaging('demo-game', id);
    await writeFile(join(staging, 'index.html'), html);
    const result = await workspace.promote('demo-game', id, `v${String(sequence)}`, {
      baseVersion,
      jobId: id,
    });
    return result.version;
  }

  function versionHtml(marker: string): string {
    return HTML.replace('const score = 0;', `const score = 0; // ${marker}`);
  }

  async function writeRawState(state: unknown): Promise<void> {
    await writeFile(
      join(workspace.projectDir('demo-game'), 'state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
  }

  it('undoes along a linear history, one approved parent at a time', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    await promoteVersion(versionHtml('three'), 2);

    expect(await workspace.rollback('demo-game')).toEqual({ version: 2, previous: 3 });
    expect(await workspace.currentHtml('demo-game')).toContain('// two');
    expect(await workspace.rollback('demo-game')).toEqual({ version: 1, previous: 2 });
    expect(await workspace.currentHtml('demo-game')).toContain('// one');
  });

  it('restores the recorded parent, not the array neighbour', async () => {
    // Director reproduction: approve v1, approve v2, undo to v1, then approve
    // v3 from v1. Undoing v3 must restore v1 even though v2 sits between them.
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    expect(await workspace.rollback('demo-game')).toEqual({ version: 1, previous: 2 });

    await promoteVersion(versionHtml('three'), 1);
    const state = await workspace.state('demo-game');
    expect(state.current_version).toBe(3);
    expect(state.versions.find((entry) => entry.version === 3)?.base_version).toBe(1);

    expect(await workspace.rollback('demo-game')).toEqual({ version: 1, previous: 3 });
    expect(await workspace.currentHtml('demo-game')).toContain('// one');
    expect((await workspace.state('demo-game')).current_version).toBe(1);
  });

  it('undoes an approval, then a fresh approval, then that approval', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    await workspace.rollback('demo-game'); // back to v1

    await promoteVersion(versionHtml('three'), 1);
    expect((await workspace.state('demo-game')).current_version).toBe(3);
    expect((await workspace.state('demo-game')).can_rollback).toBe(true);
    expect(await workspace.rollback('demo-game')).toEqual({ version: 1, previous: 3 });
    await expect(workspace.rollback('demo-game')).rejects.toMatchObject({
      code: 'nothing_to_rollback',
    });
  });

  it('reports can_rollback from ancestry, not array position', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    await workspace.rollback('demo-game'); // v2 -> v1
    await promoteVersion(versionHtml('three'), 1);
    await workspace.rollback('demo-game'); // v3 -> v1
    // v1 is first in the array and has no recorded parent.
    expect((await workspace.state('demo-game')).can_rollback).toBe(false);
  });

  it('falls back to the older neighbour for a legacy record without base_version', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    await promoteVersion(versionHtml('three'), 2);

    const state = await workspace.state('demo-game');
    const legacy = {
      current_version: 2,
      versions: state.versions.map((entry) => {
        if (entry.version === 1) return { ...entry };
        const copy = { ...entry } as Record<string, unknown>;
        delete copy.base_version;
        return copy;
      }),
    };
    await writeRawState(legacy);

    expect(await workspace.rollback('demo-game')).toEqual({ version: 1, previous: 2 });
  });

  it('falls back safely when a recorded parent does not exist', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);
    await promoteVersion(versionHtml('three'), 2);

    const state = await workspace.state('demo-game');
    await writeRawState({
      current_version: 3,
      versions: state.versions.map((entry) =>
        entry.version === 3 ? { ...entry, base_version: 99 } : entry,
      ),
    });

    // The invalid pointer cannot be followed; the bounded legacy fallback
    // restores the immediately preceding version instead of guessing forward.
    expect(await workspace.rollback('demo-game')).toEqual({ version: 2, previous: 3 });
  });

  it('refuses rollback when the current version has no usable parent', async () => {
    await promoteVersion(versionHtml('one'), null);
    await promoteVersion(versionHtml('two'), 1);

    const state = await workspace.state('demo-game');
    await writeRawState({
      current_version: 1,
      versions: state.versions.map((entry) =>
        entry.version === 1 ? { ...entry, base_version: 1 } : entry,
      ),
    });

    await expect(workspace.rollback('demo-game')).rejects.toMatchObject({
      code: 'nothing_to_rollback',
    });
  });
});

describe('checked-source integrity', () => {
  it('refuses promotion when staging changed after verification', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    expect(snapshot?.sha256).toMatch(/^[a-f0-9]{64}$/);

    // Someone replaces the staged bytes between the browser check and approval.
    await writeFile(
      join(staging, 'index.html'),
      HTML.replace('const score = 0;', 'const score = 7;'),
    );

    await expect(
      workspace.promote('demo-game', JOB, 'changed', {
        baseVersion: null,
        jobId: JOB,
        expectedSha256: snapshot?.sha256,
      }),
    ).rejects.toMatchObject({ code: 'staged_changed' });

    const state = await workspace.state('demo-game');
    expect(state.current_version).toBeNull();
    expect(state.versions).toHaveLength(0);
  });

  it('promotes the exact bytes that were verified', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    const promoted = await workspace.promote('demo-game', JOB, 'verified', {
      baseVersion: null,
      jobId: JOB,
      expectedSha256: snapshot?.sha256,
    });
    expect(promoted.sha256).toBe(snapshot?.sha256);
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

describe('state file integrity', () => {
  const statePath = () => join(workspace.projectDir('demo-game'), 'state.json');

  it('treats an absent state file as missing, then initialises it', async () => {
    await unlink(statePath());
    expect(await workspace.state('demo-game')).toMatchObject({
      current_version: null,
      versions: [],
    });
    await workspace.ensureProject('demo-game');
    const state = await workspace.state('demo-game');
    expect(state.current_version).toBeNull();
    expect(state.versions).toEqual([]);
  });

  it.each([
    ['JSON null', 'null'],
    ['invalid JSON', '{ "current_version": 1,'],
    ['a JSON array', '[]'],
    ['a non-object scalar', '"state"'],
    ['a current version absent from history', '{"current_version":2,"versions":[]}'],
    ['a malformed versions field', '{"current_version":null,"versions":"nope"}'],
  ])('refuses %s and preserves the bytes', async (_label, malformed) => {
    await writeFile(statePath(), malformed, 'utf8');
    await expect(workspace.state('demo-game')).rejects.toMatchObject({ code: 'state_corrupt' });
    await expect(workspace.ensureProject('demo-game')).rejects.toMatchObject({
      code: 'state_corrupt',
    });
    expect(await readFile(statePath(), 'utf8')).toBe(malformed);
  });
});
