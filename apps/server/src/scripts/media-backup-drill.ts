import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForgeWorkspace } from '../forge/workspace.js';
import { MediaAssetStore } from '../media/assets.js';
import { backupMedia, restoreMedia } from '../media/backup.js';
import { MediaJobStore } from '../media/jobs.js';

/**
 * `pnpm media:drill` — standing media backup/restore drill.
 *
 * Seeds assets + a job, verifies every version hash, backs up, destroys the
 * source media, restores into an isolated workspace, and proves hashes, job
 * records and counts survive. Also proves a corrupt bundle is refused before
 * any target is touched. Never touches the configured workspace.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mml-media-drill-'));
  try {
    const sourceRoot = join(dir, 'source');
    const targetRoot = join(dir, 'target');
    const projectId = 'media-drill';
    const workspace = new ForgeWorkspace(sourceRoot);
    await workspace.ensureProject(projectId);
    const assets = new MediaAssetStore(workspace);
    const jobs = new MediaJobStore(workspace);

    const asset = await assets.createAsset(projectId, {
      kind: 'image',
      mime: 'image/png',
      bytes: PNG,
      source: { kind: 'upload', text: 'drill' },
    });
    await assets.approve(projectId, asset.asset_id, asset.version);
    const second = await assets.addVersion(projectId, asset.asset_id, {
      kind: 'image',
      mime: 'image/png',
      bytes: PNG,
      parent: { asset_id: asset.asset_id, version: 1, project_id: projectId },
    });
    const job = await jobs.enqueue(projectId, { kind: 'generate', params: { prompt: 'drill' } });

    const before = await assets.verifyProjectMedia(projectId);
    if (!before.ok || before.checked !== 2) throw new Error('source media did not verify');

    const bundle = join(dir, 'bundle');
    const backup = await backupMedia(workspace, bundle);
    if (backup.totals.files === 0) throw new Error('backup copied no files');

    rmSync(join(workspace.getRoot(), projectId, 'media'), { recursive: true, force: true });
    rmSync(join(workspace.getRoot(), projectId, 'media-jobs'), { recursive: true, force: true });

    const restored = await restoreMedia(bundle, new ForgeWorkspace(targetRoot), { force: false });
    if (!restored.projects.includes(projectId)) throw new Error('project missing from restore');
    const restoredWorkspace = new ForgeWorkspace(targetRoot);
    const restoredAssets = new MediaAssetStore(restoredWorkspace);
    const after = await restoredAssets.verifyProjectMedia(projectId);
    if (!after.ok || after.checked !== 2) throw new Error('restored media did not verify');
    const restoredJobs = await new MediaJobStore(restoredWorkspace).loadAll({ projectId });
    if (restoredJobs.jobs.length !== 1 || restoredJobs.jobs[0]?.id !== job.id) {
      throw new Error('restored job record did not survive');
    }
    const bytes = await restoredAssets.readBytes(projectId, second.asset_id, second.version);
    if (!bytes.equals(PNG)) throw new Error('restored bytes changed');

    // Corrupt-bundle refusal: tamper a payload and prove restore refuses it
    // before creating a target workspace.
    const corrupt = join(dir, 'corrupt');
    cpSync(bundle, corrupt, { recursive: true });
    const payload = readdirSync(join(corrupt, 'forge', projectId, 'media'), {
      recursive: true,
    }).find((name) => String(name).endsWith('.bin'));
    if (payload === undefined) throw new Error('no payload found to corrupt');
    writeFileSync(
      join(corrupt, 'forge', projectId, 'media', String(payload)),
      Buffer.from('tampered'),
    );
    const isolated = new ForgeWorkspace(join(dir, 'isolated'));
    let refused = false;
    try {
      await restoreMedia(corrupt, isolated);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('corrupt bundle was not refused');
    if (existsSync(join(isolated.getRoot(), projectId, 'media'))) {
      throw new Error('refused restore touched the target');
    }
    console.log(`source: ${sourceRoot}`);
    console.log(`bundle: ${bundle}`);
    console.log(`projects: ${String(restored.projects.length)} files: ${String(restored.files)}`);
    console.log('media backup drill: ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('Media drill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
