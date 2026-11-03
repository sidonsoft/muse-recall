# Batch B — media operations, artifact embedding and backup

Status: implemented on `integration` (not committed/pushed as of this note).

## Scope

1. Documented image generation and editing.
2. Studio asset controls (upload, generate, edit, approve/reject, insert reference, cancel).
3. Approval-time embedding of approved images into the immutable artifact.
4. Combined artifact verification (HTML + every embedded image).
5. Rollback that re-verifies embedded media.
6. Complete media backup and restore with a standing drill.
7. Honest live-provider verification script.

## Contracts

Shared schemas live in `packages/shared/src/media.ts` (assets, versions, jobs,
upload/generate/edit) and `packages/shared/src/forge.ts`
(`ForgeMediaManifest`, `ForgeArtifactMedia`, `ForgeArtifactVerification`, and
optional `media` on versions/artifacts).

HTTP surface (`apps/server/src/routes/media.ts`):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/forge/projects/:id/media` | Asset summaries |
| POST | `/api/forge/projects/:id/media/upload` | Candidate from base64 PNG/JPEG/WebP |
| POST | `/api/forge/projects/:id/media/generate` | Queue generation job (202) |
| POST | `/api/forge/projects/:id/media/edit` | Queue edit job (202) |
| GET | `/api/forge/projects/:id/media/jobs` | Jobs + recovery issues |
| GET | `/api/forge/projects/:id/media/jobs/:jobId` | One job |
| POST | `/api/forge/projects/:id/media/jobs/:jobId/cancel` | Cooperative cancel |
| GET | `/api/forge/projects/:id/media/:assetId` | Version records |
| POST | `.../versions/:version/approve\|reject` | Curation |
| GET | `.../versions/:version/bytes` | Hash-verified bytes, `no-store` |

`GET /api/forge/projects/:id/artifact/verification?job=` returns
`ForgeArtifactVerification`; `GET /artifact` now carries `media.embedded`
and `media.pending`.

## Decisions

- **Embed at approval, not at render.** Approval resolves every placeholder
  through the project's approved versions and promotes the resolved HTML plus a
  manifest. Approved bytes are immutable and self-contained; later curation
  changes cannot break an approved artifact, and rollback restores images with
  the HTML. Staged previews also resolve approved images, but a curation
  problem never blocks preview (header `x-forge-media-unresolved: 1`).
- **Approval blocks on unusable references.** Missing, unapproved, cross-project,
  oversized or hash-mismatched references return `invalid_media_reference`
  (422) with explicit issues; the staged file is left alone.
- **Verification is store-independent.** `verifyEmbeddedManifest` re-hashes data
  URLs against the manifest, so verification keeps working after the underlying
  asset is rejected or deleted.
- **Jobs fence publication.** Generation/editing goes through `MediaJobStore`:
  cancel bumps the generation, late results are refused, restart recovery marks
  abandoned jobs `interrupted`, and the asset version is written before the job
  records success.
- **Uploads are canonical-base64 only** and re-validated by magic bytes,
  dimensions, MIME agreement and the 10 MB store ceiling. SVG/HTML are refused.
- **Provider downloads are constrained.** Only HTTPS, no credentials, no
  redirects, exact host `api.meta.ai` by default, bounded bytes and `image/*`
  content type. Generation prefers `b64_json`; `url` is a fallback.
- **Backup refuses drift.** `backupMedia` re-hashes every version before
  copying; `restoreMedia` verifies the whole bundle before touching the target,
  copies beside each subtree, re-hashes the copy, parks the existing subtree,
  swaps, and undoes earlier subtrees on failure. Only `media` and
  `media-jobs` are restored; HTML versions/state are untouched.
- **No key means unconfigured.** `pnpm verify:media` exits 2 with
  `unconfigured` rather than claiming a live pass.

## Commands

```bash
pnpm media:drill          # self-contained backup/restore drill
pnpm media:backup [dest]  # hash-verified bundle
pnpm media:restore <bundle> [--force]
pnpm verify:media         # live generate+edit; requires FORGE_MUSE_API_KEY
pnpm verify               # lint + typecheck + full suite
```

## Verification evidence

- `tests/unit/media-operations.test.ts` — b64/url generation, redirects,
  allowlist, canonical base64, multipart edit.
- `tests/unit/media-artifact.test.ts` — embedding, pending refs, tamper
  detection, promote/rollback integrity.
- `tests/unit/media-backup.test.ts` — round trip, tamper refusal, force
  semantics.
- `tests/integration/media-api.test.ts` — upload/list/bytes/curate, mismatch
  refusal, async generation, unconfigured 503.
- `tests/integration/forge-api.test.ts` — approved media is embedded at
  promotion, the artifact carries `media.embedded`, `/artifact/verification`
  reports `ok`, previews inline the data URL, and a staging rewrite between
  runtime verification and approval is still refused.
- Existing Batch A suites still pass. Media suites: **75 passed** (8 files).
- Full gate `pnpm verify` is green: lint, typecheck, **1036 passed / 3
  skipped**.
- `pnpm media:drill` prints `media backup drill: ok` (seed, verify, backup,
  destroy, restore, re-verify, corrupt-bundle refusal).
- Live provider: `pnpm verify:media` currently reports
  `unconfigured (FORGE_MUSE_API_KEY is not set)` and exits **2**. No live
  generate/edit call has been made, so this note does **not** claim the live
  integration works. Configure the key and rerun that command before the
  expanded v0.1 is declared verified; the beta branch stays uncut until then.
