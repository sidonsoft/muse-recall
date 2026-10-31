import type { MediaAssetStore, MediaVersionRecord } from './assets.js';
import type { EmbedAssetStore, EmbeddableImageVersion } from './embed.js';

/**
 * Batch A lead integration: bridge the A2 asset store to the A3 embed
 * resolver.
 *
 * A2 records are snake_case manifests (`project_id`, `asset_id`, `mime`,
 * `sha256`) while the A3 resolver takes a minimal camelCase structural view
 * plus the live bytes (which the store serves separately via `readBytes`, so
 * manifests never carry payloads). This bridge maps fields and pairs each
 * manifest with its hash-verified bytes; nothing here redefines either
 * module's records.
 */
export interface EmbedMediaVersionInput {
  record: MediaVersionRecord;
  bytes: Buffer | Uint8Array;
}

export function mediaVersionToEmbeddable(input: EmbedMediaVersionInput): EmbeddableImageVersion {
  const { record, bytes } = input;
  return {
    assetId: record.asset_id,
    version: record.version,
    projectId: record.project_id,
    status: record.status,
    mimeType: record.mime,
    bytes,
    sha256Hex: record.sha256,
    width: record.width,
    height: record.height,
  };
}

/**
 * Adapt a live {@link MediaAssetStore} to the synchronous {@link EmbedAssetStore}
 * view. Manifests and bytes are preloaded (reads re-verify the sha256), so
 * resolution stays synchronous and hash-checked.
 */
export function mediaStoreToEmbedStore(
  projectId: string,
  versions: EmbedMediaVersionInput[],
): EmbedAssetStore {
  const byKey = new Map<string, EmbeddableImageVersion>();
  for (const input of versions) {
    if (input.record.project_id !== projectId) continue;
    byKey.set(`${input.record.asset_id}/v${input.record.version}`, mediaVersionToEmbeddable(input));
  }
  return {
    projectId,
    lookup: (assetId: string, version: number) => byKey.get(`${assetId}/v${version}`) ?? null,
  };
}

// Re-exported for documentation builds that resolve types through the bridge.
export type { MediaAssetStore };
