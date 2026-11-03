import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePrivateDirectory, writePrivateFile } from '../../apps/server/src/forge/fs-utils.js';
import {
  extractInlineScripts,
  ForgeError,
  ForgeWorkspace,
  MAX_INLINE_SCRIPT_BYTES,
  MAX_INLINE_SCRIPTS,
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

describe('the engine the product vendors into a game', () => {
  const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
  const MARKER = '<script data-forge-vendor="phaser@3.80.1"';

  it('stages the reference but reads back the engine, hashed as shipped', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.vendored).toEqual([
      {
        name: 'phaser',
        version: '3.80.1',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string,
        bytes: expect.any(Number) as unknown as number,
        replaced_url: ENGINE_URL,
      },
    ]);
    expect(snapshot?.html).toContain(MARKER);
    expect(snapshot?.html).not.toContain(ENGINE_URL);
    expect(snapshot?.html.length).toBeGreaterThan(1_000_000);
    expect(snapshot?.vendor_gaps).toEqual([]);
  });

  it('a model-written script still counts against the inline caps, the engine does not', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    const scripts = extractInlineScripts(snapshot?.html ?? '');
    // One model script: the engine the product inlined is verified by hash and
    // is not the code the caps exist to bound.
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('console.log(score)');
    expect((await workspace.validateStaged('demo-game', JOB)).ok).toBe(true);
  });

  it('refuses a staged document that writes the vendor markers itself', async () => {
    /*
     * The delimiters are a format the product writes, not a claim an author may
     * make. A staged file that carries them could hide whatever it likes behind
     * text that looks like the product's own engine block: the source view would
     * elide it, the diff would summarise it away, and an unverified payload would
     * ship under the engine's name. The marker text is therefore invalid in source.
     */
    const staging = await workspace.createStaging('demo-game', JOB);
    const smuggled = HTML.replace(
      '</body>',
      '<!-- forge-vendor:phaser@3.80.1 start | sha256 ' +
        '0'.repeat(64) +
        ' -->\n<script>window.stolen = document.cookie;</script>\n' +
        '/* The MIT License (c) 2024 Richard Davey */\n' +
        '<!-- forge-vendor:phaser@3.80.1 end -->\n</body>',
    );
    await writeFile(join(staging, 'index.html'), smuggled);
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toContain('forge-vendor: marker text');
    // And the payload stays visible where a person reviews it, rather than being
    // collapsed as if it were the engine.
    const diff = await workspace.diffStaged('demo-game', JOB);
    const html = diff.files.find((file) => file.path === 'index.html');
    if (!html) throw new Error('the review diff showed no index.html');
    // The smuggled block is shown as the model's own text, not elided as if it
    // were the product's engine.
    expect(html.diff).toContain('window.stolen');
    expect(diff.summary).not.toContain('inlined by this product');
  });

  it('promotion records what the version carries, and the shipped file holds it', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    if (!snapshot) throw new Error('the staged file should exist');
    await workspace.promote('demo-game', JOB, 'initial game', {
      baseVersion: null,
      jobId: JOB,
      html: snapshot.html,
      expectedSha256: snapshot.sha256,
    });
    const state = await workspace.state('demo-game');
    expect(state.versions[0]?.vendors).toEqual([
      {
        name: 'phaser',
        version: '3.80.1',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string,
        bytes: expect.any(Number) as unknown as number,
        replaced_url: ENGINE_URL,
      },
    ]);
    const shipped = await workspace.currentHtml('demo-game');
    expect(shipped).toContain(MARKER);
    expect(shipped).not.toContain(ENGINE_URL);
    // What a person or a model reads is the source view, one line long.
    const source = await workspace.currentSourceHtml('demo-game');
    expect(source).toContain(ENGINE_URL);
    expect(source).not.toContain(MARKER);
    expect(source?.length ?? 0).toBeLessThan(600);
  });

  it('a modification seeded from the source view reproduces the engine byte for byte', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const first = await workspace.stagedSnapshot('demo-game', JOB);
    if (!first) throw new Error('the staged file should exist');
    await workspace.promote('demo-game', JOB, 'initial game', {
      baseVersion: null,
      jobId: JOB,
      html: first.html,
      expectedSha256: first.sha256,
    });

    // The way the runner seeds a modification: the source view, then an edit.
    const source = await workspace.currentSourceHtml('demo-game');
    if (source === null) throw new Error('the approved source should exist');
    const second = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(second, 'index.html'),
      source.replace('const score = 0', 'const score = 7'),
    );
    const resnap = await workspace.stagedSnapshot('demo-game', JOB);
    expect(resnap?.vendored).toEqual(first.vendored);
    // The engine block survives the round trip unchanged; only the model line did.
    const engineFromFirst = first.html.slice(
      first.html.indexOf('<!-- forge-vendor:phaser@3.80.1 start'),
      first.html.indexOf('<!-- forge-vendor:phaser@3.80.1 end -->') + 40,
    );
    const engineFromSecond = resnap?.html.slice(
      resnap.html.indexOf('<!-- forge-vendor:phaser@3.80.1 start'),
      resnap.html.indexOf('<!-- forge-vendor:phaser@3.80.1 end -->') + 40,
    );
    expect(engineFromSecond).toBe(engineFromFirst);
  });

  it('diffs the change a reviewer is deciding on, not the engine', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    const first = await workspace.stagedSnapshot('demo-game', JOB);
    if (!first) throw new Error('the staged file should exist');
    await workspace.promote('demo-game', JOB, 'initial game', {
      baseVersion: null,
      jobId: JOB,
      html: first.html,
      expectedSha256: first.sha256,
    });
    const source = await workspace.currentSourceHtml('demo-game');
    if (source === null) throw new Error('the approved source should exist');
    const second = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(second, 'index.html'),
      source.replace('const score = 0', 'const score = 7'),
    );

    const diff = await workspace.diffStaged('demo-game', JOB);
    expect(diff.validation.ok).toBe(true);
    expect(diff.summary).toContain('will carry its own phaser@3.80.1');
    expect(diff.files[0]?.diff).toContain('const score = 7');
    expect(diff.files[0]?.diff).not.toContain('forge-vendor:phaser');
    expect(diff.files[0]?.diff.length ?? 0).toBeLessThan(20_000);
    // The review shows a two-line change, not a 1.1 MB library.
    expect(diff.files[0]?.before).toContain(ENGINE_URL);
  });

  it('refuses a forged vendor marker instead of exempting it', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(staging, 'index.html'),
      `<!doctype html><html><body><canvas id="game"></canvas>
<script>new Phaser.Game({});</script>
<script data-forge-vendor="phaser@3.80.1">console.log("this is not the engine");</script>
</body></html>`,
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toContain('not the pinned library');
    // It is not treated as a vendored library for the caps either.
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    expect(extractInlineScripts(snapshot?.html ?? '')).toHaveLength(2);
  });

  it('names a Phaser version it cannot vendor and leaves the reference alone', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML.replace('phaser@3.80.1', 'phaser@3.55.0'));
    const snapshot = await workspace.stagedSnapshot('demo-game', JOB);
    expect(snapshot?.vendored).toEqual([]);
    expect(snapshot?.vendor_gaps.map((gap) => gap.url)).toEqual([
      'https://cdn.jsdelivr.net/npm/phaser@3.55.0/dist/phaser.min.js',
    ]);
    expect(snapshot?.vendor_gaps[0]?.reason).toContain('3.55.0');
    expect(snapshot?.html).toContain('phaser@3.55.0');
    const diff = await workspace.diffStaged('demo-game', JOB);
    expect(diff.summary).toContain('cannot vendor');
    // Still a game document, and still honest about needing the network.
    expect(diff.validation.ok).toBe(true);
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

  it('caps the number of inline scripts before syntax checking', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    const scripts = Array.from(
      { length: MAX_INLINE_SCRIPTS + 1 },
      (_, index) => `<script>const value${String(index)} = ${String(index)};</script>`,
    ).join('');
    await writeFile(
      join(staging, 'index.html'),
      `<!doctype html><html><body><main>Many scripts</main>${scripts}</body></html>`,
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/too many inline scripts/i);
  });

  it('caps total inline-script bytes before syntax checking', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    const script = `<script>const payload = '${'x'.repeat(MAX_INLINE_SCRIPT_BYTES)}';</script>`;
    await writeFile(
      join(staging, 'index.html'),
      `<!doctype html><html><body><main>Large script</main>${script}</body></html>`,
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/inline script source.*byte limit/i);
  });

  it('still rejects an inline script with a syntax error', async () => {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(
      join(staging, 'index.html'),
      '<!doctype html><html><body><main>Broken</main><script>const = ;</script></body></html>',
    );
    const validation = await workspace.validateStaged('demo-game', JOB);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/failed syntax check/i);
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

describe('approved-version containment (adversarial witness, 31 Oct)', () => {
  // The staging path got symlink witnesses early; the READ side — the
  // approved version an API response and preview are built from — had no
  // adversarial coverage. `readContainedBuffer` promises (lstat rejection +
  // realpath re-check) these tests now pin.
  const versionPath = (v: number) =>
    join(root, 'forge', 'demo-game', 'versions', String(v), 'index.html');

  async function promoteV1(): Promise<void> {
    const staging = await workspace.createStaging('demo-game', JOB);
    await writeFile(join(staging, 'index.html'), HTML);
    await workspace.promote('demo-game', JOB, 'v1', { baseVersion: null, jobId: JOB });
  }

  it('refuses an approved version replaced by a symlink', async () => {
    await promoteV1();
    await unlink(versionPath(1));
    await symlink('/etc/hostname', versionPath(1));
    await expect(workspace.currentHtml('demo-game')).rejects.toMatchObject({
      code: 'unsafe_file',
    });
  });

  it('refuses an approved version replaced by a non-regular file', async () => {
    await promoteV1();
    await rm(versionPath(1));
    await mkdir(versionPath(1));
    await expect(workspace.currentHtml('demo-game')).rejects.toMatchObject({
      code: 'unsafe_file',
    });
  });

  it('refuses an approved version whose parent dir was swapped for an escaping symlink', async () => {
    // The final component stays a regular file THROUGH a symlinked parent,
    // so the lstat layer cannot see this — only the realpath re-check can.
    await promoteV1();
    const outside = await mkdtemp(join(tmpdir(), 'forge-esc-'));
    await writeFile(
      join(outside, 'index.html'),
      HTML.replace('const score = 0;', 'const score = 999;'),
    );
    await rm(join(root, 'forge', 'demo-game', 'versions', '1'), {
      recursive: true,
      force: true,
    });
    await symlink(outside, join(root, 'forge', 'demo-game', 'versions', '1'));
    await expect(workspace.currentHtml('demo-game')).rejects.toMatchObject({
      code: 'unsafe_file',
    });
    await rm(outside, { recursive: true, force: true });
  });
});

describe('owner-only workspace layout (adversarial witness, 31 Oct)', () => {
  // fs-utils comments promise "a directory that only the owning user can
  // enter" and owner-only files, but only the backup path asserted the bits.
  // This pins the promise where the Forge workspace actually lays out.
  // Deliberately NOT asserted here: version-file bits, which inherit from
  // whatever wrote them into staging (the production runner uses
  // writePrivateFile -> 0600; a test's writeFile would not) - claiming a bit
  // nobody sets would be a false guard.

  it('lays out workspace dirs at 0700 and state.json at 0600', async () => {
    await workspace.ensureProject('demo-game');
    const base = join(root, 'forge', 'demo-game');
    for (const dir of [
      join(root, 'forge'),
      base,
      join(base, 'versions'),
      join(base, 'staging'),
      join(base, 'jobs'),
    ]) {
      expect(((await stat(dir)).mode & 0o777).toString(8)).toBe('700');
    }
    expect(((await stat(join(base, 'state.json'))).mode & 0o777).toString(8)).toBe('600');
  });

  it('helpers pin the exact bits under an open umask', async () => {
    // mkdir(mode) is umask-masked on the way in; the helpers' explicit chmod
    // must pin the exact bits anyway.
    const previous = process.umask(0o000);
    try {
      const dir = join(root, 'umask-probe');
      await ensurePrivateDirectory(dir);
      const file = join(dir, 'payload');
      await writePrivateFile(file, 'x');
      expect(((await stat(dir)).mode & 0o777).toString(8)).toBe('700');
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('600');
    } finally {
      process.umask(previous);
    }
  });
});
