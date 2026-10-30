import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ForgeJob, ForgeJobSchema } from '@mml/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForgeError, ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';

const JOB = '22222222-2222-4222-8222-222222222222';
const HTML_V1 = '<!doctype html><html><body>v1</body></html>';
const HTML_V2 = '<!doctype html><html><body>v2</body></html>';

let root: string;
let workspace: ForgeWorkspace;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-repair-'));
  workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo-game');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const projectDir = () => join(root, 'forge', 'demo-game');
const stateFile = () => join(projectDir(), 'state.json');
const versionFile = (v: number) => join(projectDir(), 'versions', String(v), 'index.html');

function job(overrides: Partial<ForgeJob> = {}): ForgeJob {
  return ForgeJobSchema.parse({
    id: JOB,
    project_id: 'demo-game',
    kind: 'generate',
    status: 'succeeded',
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
    version: 1,
    ...overrides,
  });
}

async function stageVersions(...usable: number[]): Promise<void> {
  for (const version of usable) {
    await mkdir(join(projectDir(), 'versions', String(version)), { recursive: true });
    await writeFile(versionFile(version), version === 1 ? HTML_V1 : HTML_V2);
  }
}

async function corruptState(bytes = '{ not json'): Promise<void> {
  await writeFile(stateFile(), bytes);
}

describe('inspect (state_corrupt diagnosis without throwing)', () => {
  it('classifies invalid JSON and lists usable versions and job records', async () => {
    await stageVersions(1, 2);
    await corruptState();
    const BROKEN = '33333333-3333-4333-8333-333333333333';
    await writeFile(join(projectDir(), 'jobs', `${JOB}.json`), JSON.stringify(job()));
    await writeFile(join(projectDir(), 'jobs', `${BROKEN}.json`), 'not-a-job');
    await writeFile(join(projectDir(), 'jobs', '.hidden.json'), 'ignored');

    const view = await workspace.inspect('demo-game');
    expect(view.repairable).toBe(true);
    expect(view.state_file.presence).toBe('invalid_json');
    expect(view.state_file.content).toBe('{ not json');
    expect(view.versions_readable).toBe(true);
    expect(view.versions).toEqual([
      expect.objectContaining({ version: 1, usable: true, bytes: HTML_V1.length }),
      expect.objectContaining({ version: 2, usable: true, bytes: HTML_V2.length }),
    ]);
    expect(view.versions[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(view.jobs.find((entry) => entry.job_id === JOB)?.status).toBe('succeeded');
    expect(
      view.jobs.find((entry) => entry.job_id === '33333333-3333-4333-8333-333333333333')?.status,
    ).toBeNull();
    expect(view.jobs.length).toBe(2); // uuid-named invalid record shows status null; hidden skipped
  });

  it('marks a structurally invalid state file as invalid_value, not missing', async () => {
    await corruptState('{"current_version": 99, "versions": []}');
    const view = await workspace.inspect('demo-game');
    expect(view.state_file.presence).toBe('invalid_value');
    expect(view.repairable).toBe(true);
  });

  it('classifies a genuinely missing state file as missing', async () => {
    await rm(stateFile());
    const view = await workspace.inspect('demo-game');
    expect(view.state_file.presence).toBe('missing');
    expect(view.state_file.content).toBeNull();
    expect(view.repairable).toBe(true);
  });

  it('reports a valid state as ok and not repairable', async () => {
    const view = await workspace.inspect('demo-game');
    expect(view.state_file.presence).toBe('ok');
    expect(view.repairable).toBe(false);
  });

  it('truncates oversized raw bytes to the 64 KiB inspection cap', async () => {
    await corruptState(`{${'x'.repeat(70_000)}`);
    const view = await workspace.inspect('demo-game');
    expect(view.state_file.truncated).toBe(true);
    expect(view.state_file.content?.length).toBe(65_536);
  });
});

describe('repairState (rebuild from surviving approved versions)', () => {
  it('preserves the damaged bytes and rebuilds a functional state with rollback', async () => {
    await stageVersions(1, 2);
    // Version 3 directory survives but its bytes are gone (empty file).
    await mkdir(join(projectDir(), 'versions', '3'), { recursive: true });
    await writeFile(versionFile(3), '');
    const damaged = '{ "current_version": 2, "versions": [broken';
    await corruptState(damaged);

    const result = await workspace.repairState('demo-game');
    expect(result.adopted_versions).toEqual([1, 2]);
    expect(result.skipped_versions).toEqual([3]);
    expect(result.archived_to).toMatch(/^state\.corrupt-\d{4}-\d{2}-\d{2}T\d{9}Z\.json$/);

    const dirEntries = await readFile(join(projectDir(), result.archived_to ?? ''), 'utf8');
    expect(dirEntries).toBe(damaged);

    const state = await workspace.state('demo-game');
    expect(state.current_version).toBe(2);
    expect(state.can_rollback).toBe(true);
    expect(state.versions.map((entry) => entry.version)).toEqual([1, 2]);
    expect(state.versions[1].base_version).toBe(1);
    expect(await workspace.currentHtml('demo-game')).toBe(HTML_V2);
  });

  it('refuses to touch a valid state', async () => {
    await stageVersions(1);
    await writeFile(
      stateFile(),
      JSON.stringify({
        current_version: 1,
        versions: [{ version: 1, created_at: '2026-10-01T00:00:00.000Z', summary: 'ok' }],
      }),
    );
    const before = await readFile(stateFile());
    await expect(workspace.repairState('demo-game')).rejects.toMatchObject({
      code: 'state_valid',
    });
    expect(await readFile(stateFile())).toEqual(before);
  });

  it('repairing a missing state file archives nothing but still rebuilds', async () => {
    await stageVersions(1);
    await rm(stateFile());
    const result = await workspace.repairState('demo-game');
    expect(result.archived_to).toBeNull();
    expect(result.adopted_versions).toEqual([1]);
    expect((await workspace.state('demo-game')).current_version).toBe(1);
  });

  it('leaves the damaged file untouched when the versions directory cannot be listed', async () => {
    await corruptState();
    // Replace the versions directory with a regular file: readdir fails.
    await rm(join(projectDir(), 'versions'), { recursive: true, force: true });
    await writeFile(join(projectDir(), 'versions'), 'not-a-directory');
    await expect(workspace.repairState('demo-game')).rejects.toMatchObject({
      code: 'state_corrupt',
    });
    expect(await readFile(stateFile(), 'utf8')).toBe('{ not json');
  });

  it('state() still refuses orphaned versions before repair, and works after', async () => {
    await stageVersions(1);
    await rm(stateFile());
    await expect(workspace.state('demo-game')).rejects.toBeInstanceOf(ForgeError);
    await workspace.repairState('demo-game');
    expect((await workspace.state('demo-game')).versions.length).toBe(1);
  });

  it('rejects a second repair on the freshly rebuilt state', async () => {
    await stageVersions(1);
    await corruptState();
    await workspace.repairState('demo-game');
    await expect(workspace.repairState('demo-game')).rejects.toMatchObject({ code: 'state_valid' });
  });
});
