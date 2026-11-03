import { Buffer } from 'node:buffer';
import type { ForgeMediaEmbedded, ForgeMediaManifest, ForgeMediaReference } from '@mml/shared';
import { type MediaAssetStore, MediaError } from './assets.js';
import { type EmbedMediaVersionInput, mediaStoreToEmbedStore } from './bridge.js';
import {
  collectAssetReferences,
  EmbedError,
  type EmbedOptions,
  embedAssetImages,
  parseAssetPlaceholder,
  verifyEmbeddedHtml,
  verifyEmbeddedManifest,
} from './embed.js';

/**
 * Batch B — approved-image embedding and combined artifact verification.
 *
 * Approval calls {@link embedApprovedImages} on the staged HTML BEFORE the
 * blocking runtime check. The resolved HTML (placeholders replaced by bounded
 * data URLs built from hash-verified approved bytes) is what gets promoted, so
 * an approved version is self-contained: later curation changes cannot make it
 * unrenderable, and rollback restores its images with its HTML.
 *
 * Verification is deliberately independent of the mutable asset store: it
 * re-hashes the data URLs in the artifact against the manifest recorded at
 * approval time.
 */

export type MediaArtifactErrorCode =
  | 'unresolved_media'
  | 'invalid_media_reference'
  | 'media_too_large';

export class MediaArtifactError extends Error {
  constructor(
    readonly code: MediaArtifactErrorCode,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'MediaArtifactError';
  }
}

export interface MediaArtifactResult {
  html: string;
  manifest: ForgeMediaManifest | null;
  embedded: ForgeMediaEmbedded[];
}

function asManifest(embedded: readonly ForgeMediaEmbedded[], now: Date): ForgeMediaManifest | null {
  if (embedded.length === 0) return null;
  return {
    version: 1,
    embedded: [...embedded],
    total_bytes: embedded.reduce((total, entry) => total + entry.bytes, 0),
    generated_at: now.toISOString(),
  };
}

function describe(error: unknown): string {
  if (error instanceof EmbedError || error instanceof MediaError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve every referenced image version for a project. Approved versions
 * carry their hash-verified bytes; non-approved versions are passed through
 * with empty bytes so the resolver can reject them with its explicit
 * `unapproved_asset_reference` error (never a silent omission).
 */
async function loadReferences(
  assets: MediaAssetStore,
  projectId: string,
  html: string,
): Promise<EmbedMediaVersionInput[]> {
  const inputs: EmbedMediaVersionInput[] = [];
  const summaries = new Map(
    (await assets.listAssets(projectId)).map((asset) => [asset.asset_id, asset] as const),
  );
  for (const reference of collectAssetReferences(html)) {
    const { assetId, version } = parseAssetPlaceholder(reference);
    const summary = summaries.get(assetId);
    if (summary === undefined || version > summary.latest_version) {
      throw new EmbedError(
        'unknown_asset_reference',
        `Unknown asset reference ${reference}: no such asset version in this project.`,
      );
    }
    const record = await assets.getVersion(projectId, assetId, version);
    const bytes =
      record.status === 'approved'
        ? await assets.readBytes(projectId, assetId, version)
        : Buffer.alloc(0);
    inputs.push({ record, bytes });
  }
  return inputs;
}

export async function embedApprovedImages(
  assets: MediaAssetStore,
  projectId: string,
  html: string,
  options?: EmbedOptions,
  now: Date = new Date(),
): Promise<MediaArtifactResult> {
  try {
    const references = collectAssetReferences(html);
    if (references.length === 0) {
      verifyEmbeddedHtml(html, options);
      return { html, manifest: null, embedded: [] };
    }
    const inputs = await loadReferences(assets, projectId, html);
    const store = mediaStoreToEmbedStore(projectId, inputs);
    const document = embedAssetImages(html, store, options);
    const embedded: ForgeMediaEmbedded[] = document.embedded.map((entry) => ({
      assetId: entry.assetId,
      version: entry.version,
      mimeType: entry.mimeType,
      bytes: entry.bytes,
      sha256Hex: entry.sha256Hex,
      dataUrlLength: entry.dataUrlLength,
    }));
    return {
      html: document.html,
      manifest: asManifest(embedded, now),
      embedded,
    };
  } catch (error) {
    if (error instanceof EmbedError) {
      throw new MediaArtifactError(
        error.code === 'embedded_html_too_large' || error.code.startsWith('asset_')
          ? 'media_too_large'
          : 'unresolved_media',
        error.message,
      );
    }
    if (error instanceof MediaError) {
      throw new MediaArtifactError('unresolved_media', error.message);
    }
    throw new MediaArtifactError('unresolved_media', describe(error));
  }
}

/**
 * References still unresolved in authored HTML (before approval). Missing
 * versions are reported explicitly rather than dropped; the caller decides
 * whether to block (approval does) or annotate (the artifact view does).
 */
export async function pendingMediaReferences(
  assets: MediaAssetStore,
  projectId: string,
  html: string,
): Promise<ForgeMediaReference[]> {
  const references = collectAssetReferences(html);
  const summaries = new Map(
    (await assets.listAssets(projectId)).map((asset) => [asset.asset_id, asset] as const),
  );
  const pending: ForgeMediaReference[] = [];
  for (const reference of references) {
    const { assetId, version } = parseAssetPlaceholder(reference);
    const summary = summaries.get(assetId);
    if (summary === undefined || version > summary.latest_version) {
      pending.push({ asset_id: assetId, version, status: 'missing' });
      continue;
    }
    const record = await assets.getVersion(projectId, assetId, version);
    pending.push({ asset_id: assetId, version, status: record.status });
  }
  return pending;
}

export interface ArtifactVerification {
  ok: boolean;
  issues: string[];
  embedded: ForgeMediaEmbedded[];
}

/**
 * Combined verification for a stored/embedded artifact:
 * - no unresolved placeholders,
 * - document within the embedding ceiling,
 * - every manifest image present with a matching sha256 and byte length.
 *
 * When `manifest` is null the artifact must simply carry no placeholders; this
 * is the correct result for hand-written or pre-Batch-B versions.
 */
export function verifyArtifact(
  html: string,
  manifest: ForgeMediaManifest | null,
  options?: EmbedOptions,
): ArtifactVerification {
  const issues: string[] = [];
  try {
    verifyEmbeddedHtml(html, options);
  } catch (error) {
    issues.push(describe(error));
  }
  if (manifest !== null) {
    const media = verifyEmbeddedManifest(html, manifest);
    issues.push(...media.issues);
  }
  return { ok: issues.length === 0, issues, embedded: manifest?.embedded ?? [] };
}
