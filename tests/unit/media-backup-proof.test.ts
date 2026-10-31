import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import {
  embedAssetImages,
  MediaAssetStore,
  mediaStoreToEmbedStore,
} from '../../apps/server/src/media/index.js';

/**
 * Batch A acceptance (lead integration): backup/restore preserves media
 * hashes and links. The media store lives beside SQLite under the Forge
 * project dir, so this proves the hash-link design end to end: store an
 * image, approve it, snapshot the hash manifest, copy the store (the backup
 * leg), re-verify against the SAME manifest, and resolve the placeholder
 * through the A2->A3 bridge with byte-identical bytes.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Minimal 1x1 PNG (transparent): valid magic + IHDR 1x1.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('media backup/restore hash-link proof (Batch A)', () => {
  it('hashes and links survive a store copy; bridge resolves byte-identical', async () => {
    const root = mkdtempSync(join(tmpdir(), 'media-backup-proof-'));
    dirs.push(root);
    const projectId = 'media-proof';
    const workspace = new ForgeWorkspace(root);
    await workspace.ensureProject(projectId);
    const store = new MediaAssetStore(workspace);

    const created = await store.createAsset(projectId, {
      kind: 'image',
      mime: 'image/png',
      bytes: ONE_BY_ONE_PNG,
    });
    const approved = await store.approve(projectId, created.asset_id, created.version);
    expect(approved.status).toBe('approved');

    // Snapshot the hash manifest (the backup leg's inventory).
    const before = await store.verifyProjectMedia(projectId);
    expect(before.ok).toBe(true);
    expect(before.checked).toBe(1);
    const manifest = await store.collectMediaManifest(projectId);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.sha256).toBe(approved.sha256);

    // Simulate backup + restore of the project dir: copy media bytes +
    // manifests aside, wipe, restore, re-verify against the SAME manifest.
    const { cpSync, readFileSync } = await import('node:fs');
    const stash = mkdtempSync(join(tmpdir(), 'media-backup-stash-'));
    dirs.push(stash);
    cpSync(join(root, 'forge', projectId, 'media'), join(stash, 'media'), { recursive: true });
    rmSync(join(root, 'forge', projectId, 'media'), { recursive: true, force: true });
    cpSync(join(stash, 'media'), join(root, 'forge', projectId, 'media'), { recursive: true });

    const after = await store.verifyProjectMedia(projectId);
    expect(after.ok).toBe(true);
    expect(after.checked).toBe(1);

    // The placeholder link resolves through the bridge with identical bytes.
    const bytes = await store.readBytes(projectId, created.asset_id, 1);
    expect(readFileSync(manifest[0]?.bytes_path ?? '').equals(bytes)).toBe(true);
    const embedStore = mediaStoreToEmbedStore(projectId, [{ record: approved, bytes }]);
    const doc = embedAssetImages(`<img src="muse-asset://${created.asset_id}/v1">`, embedStore);
    expect(doc.embedded[0]?.sha256Hex).toBe(approved.sha256);
    expect(doc.embedded[0]?.bytes).toBe(ONE_BY_ONE_PNG.length);
    const raw = new DatabaseSync(':memory:');
    raw.close();
  });

  it('tampered bytes are detected by verify, not served', async () => {
    const root = mkdtempSync(join(tmpdir(), 'media-tamper-proof-'));
    dirs.push(root);
    const projectId = 'media-tamper';
    const workspace = new ForgeWorkspace(root);
    await workspace.ensureProject(projectId);
    const store = new MediaAssetStore(workspace);

    const created = await store.createAsset(projectId, {
      kind: 'image',
      mime: 'image/png',
      bytes: ONE_BY_ONE_PNG,
    });
    const manifest = await store.collectMediaManifest(projectId);
    const path = manifest[0]?.bytes_path ?? '';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(ONE_BY_ONE_PNG).fill(0xab));

    const result = await store.verifyProjectMedia(projectId);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    await expect(store.readBytes(projectId, created.asset_id, 1)).rejects.toThrow(
      /no longer matches its recorded hash/,
    );
  });
});
