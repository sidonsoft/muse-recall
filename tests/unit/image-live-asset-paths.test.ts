/**
 * The live image harness measures the bytes the product stored, so its idea of
 * where those bytes live has to be pinned to the store, not to a guess.
 *
 * The first live generate call was paid for, produced a real image, and the
 * harness then looked under `<workspace>/projects/<id>/media/...` — a level the
 * workspace layout does not have — and deleted the isolate on the way out. This
 * test writes through the real `MediaAssetStore` and asks the helper where the
 * bytes went, so the same mistake fails here instead of destroying evidence.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import { assetVersionPaths } from '../../scripts/lib/image-live.js';

const PROJECT_ID = 'image-paths';

function pngBytes(): Buffer {
  const png = new PNG({ width: 4, height: 4 });
  png.data.fill(0);
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 200;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('the live harness finds the asset bytes where the store puts them', () => {
  let root: string;
  let store: MediaAssetStore;
  let assetId: string;
  let version: number;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'image-live-paths-'));
    store = new MediaAssetStore(new ForgeWorkspace(root));
    const record = await store.createAsset(PROJECT_ID, {
      kind: 'image',
      mime: 'image/png',
      bytes: pngBytes(),
      source: { kind: 'prompt' },
      model: { provider: 'meta', model: 'muse-image-1.0' },
    });
    assetId = record.asset_id;
    version = record.version;
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the exact paths the asset store wrote', async () => {
    const paths = assetVersionPaths(root, PROJECT_ID, assetId, version);
    const written = readFileSync(paths.bytes);
    expect(written.length).toBeGreaterThan(0);
    // The second version proves the helper is not hard-coded to one file name.
    const second = await store.addVersion(PROJECT_ID, assetId, {
      kind: 'image',
      mime: 'image/png',
      bytes: pngBytes(),
      source: { kind: 'edit' },
      model: { provider: 'meta', model: 'muse-image-1.0' },
      parent: { asset_id: assetId, version, project_id: PROJECT_ID },
    });
    expect(second.version).toBe(version + 1);
    const nextPaths = assetVersionPaths(root, PROJECT_ID, assetId, second.version);
    expect(readFileSync(nextPaths.bytes).length).toBeGreaterThan(0);
    expect(nextPaths.bytes).not.toBe(paths.bytes);
    // The manifest must be beside the bytes: the harness reads the recorded mime
    // from it, and a missing manifest is a named failure rather than an empty one.
    const manifest = JSON.parse(readFileSync(nextPaths.manifest, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest.mime).toBe('image/png');
  });

  it('does not hide a wrong workspace root behind a permissive join', () => {
    // A data root passed where a workspace root belongs must resolve to a path
    // that simply does not exist — the harness reports that as a named failure.
    const wrong = assetVersionPaths(join(root, 'data'), PROJECT_ID, assetId, version);
    expect(wrong.bytes).toContain(join('data', 'forge', PROJECT_ID, 'media'));
    expect(() => readFileSync(wrong.bytes)).toThrow();
  });
});
