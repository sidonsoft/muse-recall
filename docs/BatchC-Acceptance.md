# Batch C acceptance — verification status

**Base:** `integration` @ `d77b55a` (“Batch C: visual references and SAM object extraction”).
**Status:** deterministic browser acceptance **PASSED**; scoped live smoke **HALTED after one failed
vision request** and is awaiting direction. No SAM request and no coding request were made. No image
generation request was made. No retries were issued.

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

## 2. Scoped live smoke — HALTED (one vision request failed; no retry)

- Script: `scripts/verify-batchc-live-smoke.ts` (new), package entry `verify:batchc-live-smoke`.
- Budget enforced: at most **1 vision, 1 SAM, 1 coding, 0 image-generation**, no automatic retries;
  it stops on first failure.
- Setup succeeded without paid calls: seeded recorded baseline v1 (no model call), started isolated
  production API, served production web build, opened the seeded project, uploaded the existing
  reference image `docs/assets/muse-forge-after.png`.
- **Call 1 — vision:** one `POST …/media/suggest` request was issued with the configured vision model
  (`muse-spark-1.3`). It returned a non-success/absent data envelope; the first harness version did
  not persist the HTTP status/body, so the exact provider error is not captured. The run stopped
  immediately. Evidence report: `test-results/batchc-live/2026-11-01-0027/report.json`
  (`calls: {vision:1, sam:0, coding:0, imageGeneration:0}`).
- **SAM and coding calls were not made.** No screenshots/overlays/cutout/staging/restart/rollback
  evidence exists for the live path yet; those acceptance items remain **unverified live**.
- The harness now captures the failing HTTP status/bounded body and a failure screenshot for the
  next authorized attempt (`observations.visionError`), and likewise for SAM.
- `test-results/batchc-live/2026-11-01-0025` and `-0026` are pre-call UI/bootstrap failures (zero
  provider calls); they are retained only as debugging evidence.

## 3. UI gap fixed

Batch C’s memory proposals had no explicit browser acceptance path. This commit adds minimal,
contract-backed actions:
- `apps/web/src/lib/api.ts`: `acceptMemory` / `rejectMemory` call the existing
  `POST /api/memories/:id/accept|reject` endpoints.
- `MemoryDetailPanel` / `MemoryInspector`: a `proposed` memory shows **Accept proposal** and
  **Reject proposal**; acceptance refreshes to `active`, rejection removes the proposal from active
  review. Rejection decision is the server’s existing tombstone behaviour.

## 4. Requested next step

The one authorized live vision request has been used and failed before returning usable output. Per
the stop rule, **no additional live call will be made without direction.** Options:

1. Authorize **one diagnostic non-inference check** (e.g. credential/model availability) and then one
   retry of the vision step with the improved status capture; or
2. Authorize a single retry of the vision call only (still within the one-vision budget, if the
   failed call is deemed not to have consumed it); or
3. Treat the live acceptance as blocked pending provider credential/model-access verification.

Confirmatory/research artefacts, the Study 02 branch, tags, and remotes are untouched. No push, main
merge, beta branch, tag, or research-artifact change was made.

## 5. Evidence paths

- Deterministic UI: `test-results/batchc-ui/` (screenshots/summary; gitignored)
- Live failure report: `test-results/batchc-live/2026-11-01-0027/report.json` (gitignored)
- Scripts: `scripts/verify-batchc-ui.ts`, `scripts/verify-batchc-live-smoke.ts`
- Reference image: `docs/assets/muse-forge-after.png` (existing; sha256 `3db8a97b68e4…`, 268,814 B)
