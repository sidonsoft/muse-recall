# Batch C — visual references and SAM object extraction

Status: implemented on `integration` (uncommitted working tree, for review).
Batch B stays accepted at `0a77a66`; beta remains uncut. No live (paid)
calls were made for this batch; provider paths are stubbed in tests.

## Scope

1. Reference image → suggested project decisions (style/requirements).
   Users inspect, edit, and confirm suggestions before anything enters
   memory. Rejected or dismissed drafts never enter memory at all.
2. Image → SAM matches → selected transparent cutout saved as a versioned
   asset with provenance, flowing through the normal candidate/approve/
   Insert/embed/rollback path unchanged.
3. Studio UI for both flows wired into the Media panel.

## Contracts

Shared schemas live in `packages/shared/src/media.ts`:

- `DEFAULT_SAM_MODEL` (`sam-3.1`), `DEFAULT_VISION_MODEL`
  (`muse-spark-1.3`): independent settings via `FORGE_SAM_MODEL` /
  `FORGE_VISION_MODEL`. The coding and image models are never sent to
  these endpoints.
- `MediaSuggestRequest` / `MediaSuggestResponse`: drafts only, never
  persisted. Proposals enter memory only through `POST /api/memories/
  proposals` with `source.reference = muse-asset://<id>/v<n>`.
- `MediaSegmentRequest` / `MediaSegmentResponse`: matches carry a
  `match_index`, clipped box, optional confidence, and a downscaled
  overlay preview. Zero matches is valid, not an error.
- Cutouts store `source.kind = 'segment'` with concept, box, confidence,
  and mask dims, plus `parent` pointing at the source version.

HTTP surface (`apps/server/src/routes/media.ts`):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/forge/projects/:id/media/suggest` | Draft decisions from a version |
| POST | `/api/forge/projects/:id/media/segment` | SAM matches + previews (session) |
| POST | `.../media/segments/:segmentId/cutout` | Save match as PNG asset |

## Decisions

- **Inference never writes.** Suggest returns data; the caller proposes
  reviewed drafts through the memory engine, so dismissed suggestions
  leave no trace. Rejected proposals become unaddressable tombstones
  (history 404s like any deleted memory); accepted ones keep an audit
  trail and appear in listing/retrieval.
- **Sessions fail closed.** Segment results live in a short-lived
  (30 min, max 50) in-memory session. Cross-project use deletes the
  session; unknown/expired ids 404; out-of-range matches 400. Saving a
  cutout re-reads and re-decodes the source version rather than trusting
  cached bytes.
- **Cutouts are ordinary assets.** Trimmed transparent PNGs (RGBA color
  type 6), parent-linked and provenance-carrying, approved and embedded
  by the Batch B path with no special cases.
- **Official grammar, local compositing.** `@meta-sam/parser` validates
  the SAM geometry lane; masks composite locally with pure-JS decoders
  (pngjs, jpeg-js, @jsquash/webp) — no native deps.
- **Unconfigured is honest.** Without the provider key, all three
  endpoints 503 with `media_unconfigured`, matching the Batch B
  convention.

## Verification evidence

- `tests/unit/media-segment.test.ts` (38 tests) — lane parsing incl.
  real-grammar two-match fixtures, cutout compositing/trimming,
  preview bounds, PNG/JPEG/WebP decode, SAM/vision model targeting,
  refusal and error handling. Review regressions: pixel-exact
  downscale with source immutability, >512px preview bound, >2048px
  pre-inference fit with box remapping, forced byte-cap fallback,
  source-alpha preservation in both compositors, and operation-level
  lane validation (missing lane, prose, malformed geometry,
  undecodable masks rejected; explicitly empty lane stays a valid
  zero-match).
- `tests/integration/media-batchc.test.ts` (8 tests) — suggest writes
  nothing; propose/accept/reject linkage with source reference and
  tombstone exclusion; zero-match validity + cutout refusal; multi-match
  save with provenance and RGBA bytes; session failure modes
  (unknown/cross-project/out-of-range); unconfigured 503s; full
  cutout → approve → embed → modify → rollback byte-identity through
  the Batch B path.
- Studio `ReferencePanel` (suggest/segment) wired per version in
  `MediaPanel`, keyed by project/asset/version with mount-fenced async
  results (fence rearmed in effect setup for StrictMode double-mount)
  so switching versions cannot misattribute v1 inference to v2;
  web + server typecheck clean; batch files lint-clean
  (repo lint diagnostics identical to baseline).
- `scripts/verify-studio-workflow.ts` — deterministic browser
  regression: reference state resets on a same-asset version switch
  (v2 seeded into the asset store, page reloaded, stale drafts/errors
  must clear; 56 checks, clean console gate).
- Not run: live SAM/vision calls and the scoped live smoke —
  left for the acceptance gate.
