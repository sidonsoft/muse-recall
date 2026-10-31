# Batch A spike decisions (multimodal Studio expansion)

Date: 31 Oct 2026. These fix the shared contracts the three Batch A
workstreams build against. Implementation lives in `apps/server/src/media/`,
contracts in `packages/shared/src/media.ts`.

## 1. Supported formats

- Raster uploads only: PNG, JPEG, WebP (magic-byte verified, not extension).
- SVG and any HTML-as-image are refused: the plan forbids unsanitized
  SVG/HTML in the image pipeline, and the preview CSP (`img-src data: blob:`)
  renders data-URL images, never markup.
- Audio/video acceptance (Batch D scope) is recorded here for forward
  compatibility but not implemented in Batch A.

## 2. Limits (renderer/CSP-justified)

| Limit | Value | Justification |
|---|---|---|
| Upload bytes | 12 MB | 2x the existing screenshot ceiling (6 MB) headroom for camera/originals; normalization shrinks before embedding |
| Embedded bytes per image | 2 MB | Keeps resolved HTML far under the HTML cap; data URLs expand ~33% |
| Dimensions | 4096 x 4096 max, 32 x 32 min | Mirrors the existing screenshot floor (32px); 4K caps GPU/memory cost of preview decode |
| Decoded pixels | 16.7 MP (4096x4096) | Single allocation bound for the preview renderer |
| Resolved HTML | 5 MB | Matches the Forge staged-file discipline; resolved data URLs are the dominant term |

## 3. Placeholder grammar

- Exact form: `muse-asset://<asset-id>/v<version>` where asset-id is
  `[a-z0-9-]{2,64}` and version is a positive integer.
- The resolver accepts ONLY approved, project-owned image versions.
- Rejected with explicit errors: unresolved (no such asset/version),
  unknown (malformed placeholder), cross-project (asset belongs elsewhere),
  unapproved (candidate/rejected status).
- Rationale: stable IDs + bounded descriptions in prompts (plan §2), never
  raw base64 in model text; placeholders resolve at build time to bounded
  data URLs, and `verifyEmbeddedHtml` asserts none survive.

## 4. Storage layout

- Under the Forge workspace project dir: `<project>/media/<asset-id>/v<version>.bin`
  (0600) plus `v<version>.json` manifest beside the bytes.
- Bytes live outside SQLite; manifests carry validated metadata + sha256.
- Backup/restore: Batch A covers manifest + hash verification (restore
  asserts media hashes match manifests); full media-file evacuation into the
  SQLite backup image is deferred to Batch B (plan §2: extend backup/restore
  to the media store — Batch A proves the hash-link design, Batch B wires
  the drill).
- Path containment follows `ForgeWorkspace.within` (realpath re-check).

## 5. Capability probes

- Statuses: `unconfigured` (no credentials — never an error, never disables
  Studio browsing/code flows), `available`, `unavailable` (auth/quota/region),
  `failed` (timeout/crash/shape).
- Each record carries model id, bounded detail, latency; secrets never logged.
- Adapter talks ONLY to `https://api.meta.ai`; any other origin is refused
  (no general arbitrary-URL fetcher — plan §2 download rule).
- Duplicate-submission keys: concurrent duplicates get 409-style
  in-progress; a cancelled local job never publishes a late result.
