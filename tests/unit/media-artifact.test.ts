import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import {
  embedApprovedImages,
  MediaArtifactError,
  pendingMediaReferences,
  verifyArtifact,
} from '../../apps/server/src/media/artifact.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function workspaceWithAsset(status: 'approved' | 'candidate' = 'approved') {
  const root = mkdtempSync(join(tmpdir(), 'media-artifact-'));
  dirs.push(root);
  const projectId = 'artifact-project';
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject(projectId);
  const store = new MediaAssetStore(workspace);
  const record = await store.createAsset(projectId, {
    kind: 'image',
    mime: 'image/png',
    bytes: PNG,
    source: { kind: 'upload' },
  });
  if (status === 'approved') await store.approve(projectId, record.asset_id, record.version);
  return { root, projectId, workspace, store, record };
}

describe('approved-image embedding (Batch B2)', () => {
  it('embeds approved bytes, records a manifest, and verifies both hashes', async () => {
    const { projectId, store, record } = await workspaceWithAsset();
    const source = `<html><body><img src="muse-asset://${record.asset_id}/v1"></body></html>`;
    const result = await embedApprovedImages(store, projectId, source);
    expect(result.html).toContain('data:image/png;base64,');
    expect(result.html).not.toContain('muse-asset://');
    expect(result.manifest?.embedded[0]?.sha256Hex).toBe(record.sha256);
    expect(result.manifest?.total_bytes).toBe(PNG.length);

    expect(verifyArtifact(result.html, result.manifest).ok).toBe(true);
    expect(verifyArtifact(source, null).ok).toBe(false);
    expect(verifyArtifact(result.html, null).ok).toBe(true);
  });

  it('refuses candidates, missing versions, and malformed references', async () => {
    const candidate = await workspaceWithAsset('candidate');
    await expect(
      embedApprovedImages(
        candidate.store,
        candidate.projectId,
        `<img src="muse-asset://${candidate.record.asset_id}/v1">`,
      ),
    ).rejects.toBeInstanceOf(MediaArtifactError);

    const { projectId, store } = candidate;
    const pending = await pendingMediaReferences(
      store,
      projectId,
      `<img src="muse-asset://${candidate.record.asset_id}/v1"><img src="muse-asset://11111111-1111-4111-8111-111111111111/v2">`,
    );
    expect(pending.map((entry) => entry.status)).toEqual(['candidate', 'missing']);
    await expect(
      embedApprovedImages(store, projectId, '<img src="muse-asset://not a reference">'),
    ).rejects.toBeInstanceOf(MediaArtifactError);
  });

  it('detects a tampered embedded image and unresolved placeholders', async () => {
    const { projectId, store, record } = await workspaceWithAsset();
    const result = await embedApprovedImages(
      store,
      projectId,
      `<img src="muse-asset://${record.asset_id}/v1">`,
    );
    const tampered = result.html.replace(/base64,[A-Za-z0-9+/=]+/, 'base64,AAAA');
    expect(verifyArtifact(tampered, result.manifest ?? null).ok).toBe(false);
    expect(verifyArtifact('<img src="muse-asset://x/v1">', null).ok).toBe(false);
  });
});

describe('Forge promote/rollback media integrity (Batch B3)', () => {
  it('records the manifest and refuses a version whose embedded bytes drifted', async () => {
    const { workspace, projectId, store, record } = await workspaceWithAsset();
    const jobId = '11111111-1111-4111-8111-111111111111';
    const summary = 'media artifact';
    const result = await embedApprovedImages(
      store,
      projectId,
      `<html><body><p>hi</p><img src="muse-asset://${record.asset_id}/v1"></body></html>`,
    );
    await workspace.promote(projectId, jobId, summary, {
      baseVersion: null,
      jobId,
      html: result.html,
      expectedSha256: (await import('node:crypto'))
        .createHash('sha256')
        .update(result.html)
        .digest('hex'),
      ...(result.manifest ? { media: result.manifest } : {}),
    });
    const state = await workspace.state(projectId);
    expect(state.versions[0]?.media?.embedded).toHaveLength(1);
    expect(await workspace.currentHtml(projectId)).toContain('data:image/png');

    const file = join(workspace.projectDir(projectId), 'versions', '1', 'index.html');
    writeFileSync(file, result.html.replace(/base64,[A-Za-z0-9+/=]+/, 'base64,AAAA'));
    await expect(workspace.currentHtml(projectId)).rejects.toThrow(/no longer matches/);
  });
});
