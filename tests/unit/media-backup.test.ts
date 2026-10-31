import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import { backupMedia, restoreMedia } from '../../apps/server/src/media/backup.js';
import { MediaJobStore } from '../../apps/server/src/media/jobs.js';

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
  return { dir, workspace, asset, job };
}

describe('media backup/restore (Batch B5)', () => {
  it('round-trips every media version and job record', async () => {
    const { dir, workspace, asset, job } = await seed();
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
});
