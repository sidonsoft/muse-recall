import {
  existsSync,
  mkdtempSync,
  readdirSync,
  cpSync as realCpSync,
  renameSync as realRenameSync,
  rmSync as realRmSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import {
  backupMedia,
  type MediaRestoreFs,
  restoreMedia,
} from '../../apps/server/src/media/backup.js';
import { MediaJobStore } from '../../apps/server/src/media/jobs.js';
import { MediaSourceStore } from '../../apps/server/src/media/sources.js';
import { wavBytes } from '../helpers/media-fixtures.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'media-backup-'));
  dirs.push(dir);
  const workspace = new ForgeWorkspace(join(dir, 'source'));
  await workspace.ensureProject('backup-project');
  const assets = new MediaAssetStore(workspace);
  const asset = await assets.createAsset('backup-project', {
    kind: 'image',
    mime: 'image/png',
    bytes: PNG,
  });
  await assets.approve('backup-project', asset.asset_id, asset.version);
  const job = await new MediaJobStore(workspace).enqueue('backup-project', {
    kind: 'generate',
    params: { prompt: 'backup' },
  });
  const sources = new MediaSourceStore(workspace);
  const source = await sources.create('backup-project', {
    mime: 'audio/wav',
    bytes: wavBytes({ durationMs: 1_000 }),
    origin: 'recording',
  });
  return { dir, workspace, asset, job, source };
}

describe('media backup/restore (Batch B5)', () => {
  it('round-trips every media version and job record', async () => {
    const { dir, workspace, asset, job, source } = await seed();
    const bundle = join(dir, 'bundle');
    const backup = await backupMedia(workspace, bundle);
    expect(backup.totals.files).toBeGreaterThan(0);
    expect(existsSync(join(bundle, 'manifest.json'))).toBe(true);

    const target = new ForgeWorkspace(join(dir, 'target'));
    const restored = await restoreMedia(bundle, target);
    expect(restored.projects).toEqual(['backup-project']);
    const assets = new MediaAssetStore(target);
    expect((await assets.verifyProjectMedia('backup-project')).ok).toBe(true);
    expect((await assets.readBytes('backup-project', asset.asset_id, 1)).equals(PNG)).toBe(true);
    const jobs = await new MediaJobStore(target).loadAll({ projectId: 'backup-project' });
    expect(jobs.jobs.map((entry) => entry.id)).toEqual([job.id]);
    const sources = new MediaSourceStore(target);
    expect((await sources.verifyProjectSources('backup-project')).ok).toBe(true);
    expect((await sources.get('backup-project', source.source_id)).sha256).toBe(source.sha256);
  });

  it('refuses a tampered bundle before writing the target', async () => {
    const { dir, workspace } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const manifest = JSON.parse(
      (await import('node:fs')).readFileSync(join(bundle, 'manifest.json'), 'utf8'),
    ) as { files: Array<{ path: string }> };
    writeFileSync(join(bundle, manifest.files[0]?.path ?? ''), 'tampered');
    const target = new ForgeWorkspace(join(dir, 'target'));
    await expect(restoreMedia(bundle, target)).rejects.toThrow(/manifest hash/);
    expect(existsSync(join(target.getRoot(), 'backup-project'))).toBe(false);
  });

  it('refuses to overwrite existing subtrees without force, and refuses an existing destination', async () => {
    const { dir, workspace } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    await expect(backupMedia(workspace, bundle)).rejects.toThrow(/already exists/);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);
    await restoreMedia(bundle, target, { force: true });
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
  });

  it('restores the parked subtree when the swap rename fails', async () => {
    const { dir, workspace, asset } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);
    const before = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);

    const fs: MediaRestoreFs = {
      renameSync: ((from, to) => {
        if (basename(String(from)).startsWith('.restore-media-')) {
          throw new Error('injected swap failure');
        }
        return (realRenameSync as (...args: unknown[]) => unknown)(from, to);
      }) as typeof realRenameSync,
    };
    await expect(restoreMedia(bundle, target, { force: true, fs })).rejects.toThrow(
      /injected swap failure/,
    );
    // The parked original is back in place; no temp or parked copies leak.
    expect(dotLeftovers(join(target.getRoot(), 'backup-project'))).toEqual([]);
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
    const after = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);
    expect(after.equals(before)).toBe(true);
  });

  it('rolls back earlier subtrees when a later swap fails', async () => {
    const { dir, workspace, asset, job, source } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);
    const before = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);

    const fs: MediaRestoreFs = {
      renameSync: ((from, to) => {
        // Fail only the second subtree (media-jobs) after the first commits.
        if (
          basename(String(from)).startsWith('.restore-media-') &&
          basename(String(from)).endsWith('-media-jobs')
        ) {
          throw new Error('injected late swap failure');
        }
        return (realRenameSync as (...args: unknown[]) => unknown)(from, to);
      }) as typeof realRenameSync,
    };
    await expect(restoreMedia(bundle, target, { force: true, fs })).rejects.toThrow(
      /injected late swap failure/,
    );
    expect(dotLeftovers(join(target.getRoot(), 'backup-project'))).toEqual([]);
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
    const after = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);
    expect(after.equals(before)).toBe(true);
    const jobs = await new MediaJobStore(target).loadAll({ projectId: 'backup-project' });
    expect(jobs.jobs.map((entry) => entry.id)).toEqual([job.id]);
    const sources = new MediaSourceStore(target);
    expect((await sources.verifyProjectSources('backup-project')).ok).toBe(true);
    expect((await sources.get('backup-project', source.source_id)).sha256).toBe(source.sha256);
  });

  it('removes a partial copy without touching the target', async () => {
    const { dir, workspace, asset } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);

    const fs: MediaRestoreFs = {
      cpSync: ((...args) => {
        // Leave a real partial copy behind, then fail the hash gate.
        (realCpSync as (...args: unknown[]) => unknown)(...args);
        throw new Error('injected copy failure');
      }) as typeof realCpSync,
    };
    await expect(restoreMedia(bundle, target, { force: true, fs })).rejects.toThrow(
      /injected copy failure/,
    );
    expect(dotLeftovers(join(target.getRoot(), 'backup-project'))).toEqual([]);
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
    const after = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);
    expect(after.equals(PNG)).toBe(true);
  });

  it('keeps the target when parking fails', async () => {
    const { dir, workspace, asset } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);

    const fs: MediaRestoreFs = {
      renameSync: ((from, to) => {
        if (basename(String(to)).startsWith('.restore-previous-')) {
          throw new Error('injected park failure');
        }
        return (realRenameSync as (...args: unknown[]) => unknown)(from, to);
      }) as typeof realRenameSync,
    };
    await expect(restoreMedia(bundle, target, { force: true, fs })).rejects.toThrow(
      /injected park failure/,
    );
    expect(dotLeftovers(join(target.getRoot(), 'backup-project'))).toEqual([]);
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
    const after = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);
    expect(after.equals(PNG)).toBe(true);
  });

  it('names the parked copy when recovery itself fails', async () => {
    const { dir, workspace } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);

    const fs: MediaRestoreFs = {
      renameSync: ((from, to) => {
        const fromBase = basename(String(from));
        // Fail the swap, then fail the parked restore too.
        if (fromBase.startsWith('.restore-media-')) throw new Error('injected swap failure');
        if (fromBase.startsWith('.restore-previous-')) throw new Error('injected recovery failure');
        return (realRenameSync as (...args: unknown[]) => unknown)(from, to);
      }) as typeof realRenameSync,
    };
    await expect(restoreMedia(bundle, target, { force: true, fs })).rejects.toThrow(
      /\.restore-previous-/,
    );
  });

  it('reports a parked-cleanup failure as a warning instead of rolling back', async () => {
    const { dir, workspace, asset } = await seed();
    const bundle = join(dir, 'bundle');
    await backupMedia(workspace, bundle);
    const target = new ForgeWorkspace(join(dir, 'target'));
    await restoreMedia(bundle, target);

    const fs: MediaRestoreFs = {
      rmSync: ((path, ...rest) => {
        if (String(path).includes('.restore-previous-')) {
          throw new Error('injected cleanup failure');
        }
        return (realRmSync as (...args: unknown[]) => unknown)(path, ...rest);
      }) as typeof realRmSync,
    };
    const restored = await restoreMedia(bundle, target, { force: true, fs });
    // All three subtrees (media, media-jobs, media-sources) parked an original.
    expect(restored.warnings).toHaveLength(3);
    for (const warning of restored.warnings) expect(warning).toMatch(/\.restore-previous-/);
    // The restore itself committed: the new bytes verify.
    expect((await new MediaAssetStore(target).verifyProjectMedia('backup-project')).ok).toBe(true);
    const after = await new MediaAssetStore(target).readBytes('backup-project', asset.asset_id, 1);
    expect(after.equals(PNG)).toBe(true);
  });
});

/** Temp and parked restore copies must never survive a finished restore. */
function dotLeftovers(projectDir: string): string[] {
  if (!existsSync(projectDir)) return [];
  return readdirSync(projectDir).filter(
    (entry) => entry.startsWith('.restore-media-') || entry.startsWith('.restore-previous-'),
  );
}
