# Batch C acceptance — verification status

**Base:** `integration` @ `d77b55a` (“Batch C: visual references and SAM object extraction”).
**Status:** deterministic browser acceptance **PASSED**; scoped live smoke **HALTED after one failed
vision submission**. No SAM request and no coding request were made; no image-generation request was
made. **Live acceptance remains pending and no live call was made in the P2 follow-up.**

## 1. Deterministic browser coverage — PASS (fixtures, no provider traffic)

- Script: `scripts/verify-batchc-ui.ts` (new), package entry `verify:batchc-ui`.
- Command: `pnpm exec tsx scripts/verify-batchc-ui.ts`.
- Result: **22/22 checks PASS**, exit 0, repeated runs byte-identical apart from timestamps; evidence
  under `test-results/batchc-ui/` (gitignored).
- Real surfaces: the production web build, real Fastify app, real SQLite/memory engine, real Forge
  pipeline with the deterministic fake Muse CLI. Only the media provider is an injected stub; the
  production media adapter is never constructed, `FORGE_MUSE_API_KEY` is absent and
  `config.forge.apiKey === null`, so no provider traffic is possible.
- Covered:
  - upload reference → Suggest → three editable drafts (type + content) → edit one text **and** type →
    Propose → Propose second → dismiss third;
  - proposals carry `muse-asset://<asset>/v1`; Memory review → **Accept proposal** → active memory
    content/source verified in UI+API; open second → **Reject proposal** → disappears; API proves only
    one active memory at the source version, rejected proposal is a tombstone, dismissed draft left no
    record in any status;
  - Segment → **two decodable inspectable preview `<img>` elements** → select match 1 → Save cutout →
    candidate shows segment provenance/parent linkage/RGBA bytes → Approve in Media → Insert → change
    request contains a well-formed cutout placeholder; **no generation started** (artifact/jobs
    unchanged);
  - clean console, no page errors, no HTTP ≥400, no non-local requests; exactly one stub suggest and
    one stub segment call (no retries).

**Fixture boundary:** these results validate UI/API behaviour against deterministic stubs; they are
**not** live model outputs and are not visual-correctness evidence.

## 2. P2 harness correction — transport retries, attempt accounting, failure capture

The review correctly found that the Studio submission counter did not prove the provider-attempt
count: the media adapter defaults to one retry after retryable 5xx/network failures, and the first
live-smoke harness could not see it. This is now fixed **for the smoke only** (normal product defaults
are unchanged):

- **Retries disabled at the transport for this smoke:** new optional env
  `FORGE_MEDIA_MAX_RETRIES=0` is parsed into `config.media.maxRetries` and passed to the production
  `MediaAdapter`; the live smoke sets it to `0`. The adapter's default remains `1`.
- **Actual provider attempts recorded at the adapter boundary:** the adapter now counts dispatches
  and returns `attempts` on success; errors carry `details.attempts`. `MediaSuggestResponse` /
  `MediaSegmentResponse` expose `provider_attempts`, and the media error envelope exposes
  `details.attempts`. The live smoke requires `provider_attempts === 1` for vision and SAM and
  cross-checks the `[media-trace]` log lines (one start line per attempt) captured in
  `test-results/batchc-live/<stamp>/server.log`. It records UI submissions, response attempts and
  trace attempts separately. The coding job's `usage.calls` is recorded as coding attempts.
- **Requested models from effective configuration:** `/api/meta` now reports the effective media
  models and retry budget (`media.image_model/sam_model/vision_model/max_retries`); the smoke fails
  unless `max_retries === 0`, and uses those values (trace payload as fallback) instead of hard-coded
  labels. The coding model comes from `/api/meta` `forge.configured_model`, with CLI-observed
  identity from the job's `model_observed`.
- **Non-JSON failures captured:** vision/SAM failures now read the raw bounded body first and only
  then attempt JSON parsing; status, raw body, parsed envelope (when valid) and a screenshot are
  retained. A non-JSON error cannot bypass evidence capture.
- **Offline regression:** new `tests/unit/media-adapter-retry.test.ts` (7 tests) proves default 1
  retry = two attempts, `maxRetries:0` refuses a second attempt on 503/network/timeout, and the trace
  contains one line per attempt without the credential. No provider traffic.

**Retained-log inspection before another call:** the preserved failure report and harness log were
inspected; they contain one Studio vision submission and no transport status/body or per-attempt
records. The historical upstream attempt count is therefore **unknown** (the old adapter could have
made up to two), and the cause remains unknown. The failed submission is treated as a **consumed
attempt** — a further attempt requires new authorization and is not retroactively counted inside the
original allowance. The improved harness retains `server.log` with trace lines for any future run.

## 3. Scoped live smoke — HALTED (one vision submission failed; upstream attempts unknown)

- Script: `scripts/verify-batchc-live-smoke.ts` (new), package entry `verify:batchc-live-smoke`.
- Budget enforced: at most **1 vision, 1 SAM, 1 coding, 0 image-generation**, no automatic retries;
  it stops on first failure.
- Setup succeeded without paid calls: seeded recorded baseline v1 (no model call), started isolated
  production API, served production web build, opened the seeded project, uploaded the existing
  reference image `docs/assets/muse-forge-after.png`.
- **Vision submission 1/1:** one `POST …/media/suggest` submission was issued with the configured
  vision model (effective value was `muse-spark-1.3`; under the old harness the value came from the
  server default rather than an effective-config read). It returned a non-success/absent data envelope; the first harness
  version did not persist HTTP status/body or per-attempt transport records, so the failure cause and
  the upstream attempt count (1 or 2 under the old adapter default) are **unknown**. The run stopped
  immediately. Evidence report: `test-results/batchc-live/2026-11-01-0027/report.json`
  (`calls: {vision:1, sam:0, coding:0, imageGeneration:0}`). **This failed submission counts as
  consumed.**
- **SAM and coding calls were not made.** No screenshots/overlays/cutout/staging/restart/rollback
  evidence exists for the live path yet; those acceptance items remain **unverified live**.
- The harness now captures the failing HTTP status/bounded body and a failure screenshot for the
  next authorized attempt (`observations.visionError`), and likewise for SAM.
- `test-results/batchc-live/2026-11-01-0025` and `-0026` are pre-call UI/bootstrap failures (zero
  provider calls); they are retained only as debugging evidence.

## 4. UI gap fixed

Batch C’s memory proposals had no explicit browser acceptance path. This commit adds minimal,
contract-backed actions:
- `apps/web/src/lib/api.ts`: `acceptMemory` / `rejectMemory` call the existing
  `POST /api/memories/:id/accept|reject` endpoints.
- `MemoryDetailPanel` / `MemoryInspector`: a `proposed` memory shows **Accept proposal** and
  **Reject proposal**; acceptance refreshes to `active`, rejection removes the proposal from active
  review. Rejection decision is the server’s existing tombstone behaviour.

## 5. Requested next step

The failed vision submission remains consumed; a repeat is a **newly authorized attempt**, not a
continuation of the original one-call allowance. No additional live call will be made without
direction. The harness now has a `BATCHC_SMOKE_VISION_ONLY=1` mode so a newly authorized vision
attempt can stop after the single vision submission without entering SAM/coding. Options:

1. Authorize **one new vision attempt** with the P2-fixed harness (`FORGE_MEDIA_MAX_RETRIES=0`,
   trace attempt accounting, non-JSON capture, retained `server.log`); or
2. Authorize **one documented non-inference access check** first (using a documented endpoint, not an
   invented probe), then one new vision attempt; or
3. Treat live acceptance as blocked pending provider credential/model-access verification.

Confirmatory/research artefacts, the Study 02 branch, tags, and remotes are untouched. No push, main
merge, beta branch, tag, or research-artifact change was made.

## 6. Evidence paths

- Deterministic UI: `test-results/batchc-ui/` (screenshots/summary; gitignored)
- Live failure report: `test-results/batchc-live/2026-11-01-0027/report.json` (gitignored)
- P2 regression: `tests/unit/media-adapter-retry.test.ts` (7 tests, offline transport)
- Retry/trace env: `FORGE_MEDIA_MAX_RETRIES=0`, `FORGE_MEDIA_TRACE=1` (smoke only; product default 1)
- Future live transport evidence: `test-results/batchc-live/<stamp>/server.log` (`[media-trace]` lines)
- Scripts: `scripts/verify-batchc-ui.ts`, `scripts/verify-batchc-live-smoke.ts`
- Reference image: `docs/assets/muse-forge-after.png` (existing; sha256 `3db8a97b68e4…`, 268,814 B)
