# Muse Forge MVP — implementation and limits

Branch `experiment/muse-forge`. One project, one generated `index.html`, real Muse.
No merge to `main`, no submission.

## What is wired

| Capability | Where | Status |
| --- | --- | --- |
| Scoped workspace, containment | `apps/server/src/forge/workspace.ts` | Working |
| Real-Muse generation job | `apps/server/src/forge/runner.ts` | Working (CLI) |
| Job status, logs, usage | `GET /api/forge/jobs/:id` | Working |
| Cancellation | `POST …/cancel` | Working |
| Runtime/call budgets | runner options (`FORGE_*`) | Working |
| Staged preview | `GET …/preview?job=` | Working |
| Approved preview | `GET …/preview` | Working |
| Screenshot capture | preview bridge + UI | Working |
| Screenshot-driven modification | `POST …/modify` | Working |
| Diff review | `GET …/diff` + UI | Working |
| Approve / reject | `POST …/approve`, `…/reject` | Working |
| Rollback | `POST …/rollback` | Working |
| Memory injection + provenance | runner, `memory_ids` on each job | Working |
| Approval-gated decision capture | approve `capture_memory` | Working |
| Sandboxed preview | CSP `sandbox allow-scripts` + iframe | Working |
| Browser E2E | `pnpm verify:forge` | Working |

## Security model

- **Containment.** Project ids match `^[a-z0-9][a-z0-9-]{1,63}$`. Every path is resolved under
  `WORKSPACE_ROOT/forge/<project>` and re-checked with `realpath`; symlinked files, symlinked
  staging directories, and paths resolving outside the project are rejected.
- **Generated content is untrusted.** It is served only through a document-level CSP
  `sandbox allow-scripts` and an iframe without `allow-same-origin`, giving it an opaque origin:
  no cookies, storage, or privileged API access. The only bridge is a `postMessage` handler that
  reads the game canvas for screenshots.
- **No shell or filesystem tools added to the app.** The only filesystem access is the workspace
  module's fixed operations; the only process spawned is the configured Muse CLI.
- **Staging is isolated.** A job writes into `staging/<jobId>`; approval validates again, copies
  the file into `versions/<n>`, and flips a pointer atomically (temp file + rename). Rejection
  deletes staging and cannot touch the approved version.
- **Screenshots** must be a base64 PNG data URL with valid magic bytes and are capped at 6 MB.
- **Budgets.** Wall-clock and observed model calls are hard stops; token counts are
  **observational** because the CLI cannot be capped mid-run.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKSPACE_ROOT` | `./workspaces` | Parent of the `forge/` root |
| `FORGE_MAX_RUNTIME_MS` | `600000` | Hard job timeout |
| `FORGE_MAX_CALLS` | `25` | Observed-call budget |
| `FORGE_MAX_INPUT_TOKENS` | `1500000` | Observational input-token budget |
| `FORGE_MUSE_BIN` | `muse` | CLI binary (tests use the fake fixture) |
| `FORGE_REASONING_EFFORT` | `low` | Muse reasoning effort |

## Verification

```bash
# deterministic, no model calls
FORGE_MUSE_BIN=$PWD/tests/fixtures/fake-muse.mjs FAKE_MUSE_MODE=auto \
  DATABASE_PATH=./data/forge.db pnpm dev:server
pnpm verify:forge

# real Muse
DATABASE_PATH=./data/forge.db pnpm dev:server
pnpm verify:forge
```

Tests: `tests/unit/forge-workspace.test.ts` (9) and `tests/integration/forge-api.test.ts` (8)
cover traversal, symlink file and directory, validation, promotion, rollback, rejected staging,
budget, cancel, timeout, concurrency and invalid ids.

## Known limitations

- One project, one `index.html`; extra files a model writes are ignored, and no asset pipeline
  or image generation is wired.
- Job state is in memory plus a JSON file per job; a server restart loses live jobs (approved
  versions survive on disk).
- No authentication; loopback only. Not safe for multi-user hosting.
- Approve/reject are not locked against simultaneous requests; the state pointer write is atomic
  but two approvals in the same instant could both promote.
- Preview runs same-origin with CSP sandbox; a separate preview origin would be stronger.
- Memory influences the prompt, not an autonomous agent loop; capture happens only after
  approval and only when requested.
- Diff is a single-file prefix/suffix view, not a full unified diff of multiple files.
- Muse does not play-test; browser verification is ours (`pnpm verify:forge`).
- Runtime errors are surfaced from the sandboxed preview and block approval, but the validator
  itself is structural (size, canvas/Phaser, inline-script syntax); it cannot prove gameplay
  correctness or that every asset/animation works.
- Real modification latency varied from 53 s to >600 s on the same project; a 10-minute default
  can be too short for a broad request. Narrow requests are more reliable.

## Measured runs (real Muse, 2026-10-27)

| Operation | Calls | Input tokens | Output tokens | Wall time | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Generate (in-app, real) | 8 | 320,749 | 10,874 | 122.4 s | succeeded, approved as v1 |
| Modify attempt 1 (screenshot) | 7 | 219,082 | 3,975 | 59.4 s | rejected by validation: model replaced Phaser with vanilla JS |
| Modify attempt 2 (screenshot) | — | — | — | 600 s | failed: runtime budget exceeded before any usage event |
| Modify attempt 3 (narrow scope, after prompt fix) | — | — | — | 53.2 s | validation passed; approved as v2; preview threw `g.fillStar is not a function`, then rolled back to v1 |
| Deterministic fake CLI, full workflow | 1 per job | — | — | <2 s | generate → preview → approve → capture → modify → reject → modify → approve → undo |

The first modification is a useful negative result: the model produced a plausible game but
silently changed the engine, and the validator refused it. The prompt now explicitly forbids
replacing Phaser; the runtime budget default is 600 s, which proved too short for the larger
rewrite attempts. Real screenshot capture itself worked (the PNG was attached to the request),
and the third attempt ran with one retrieved project memory (the v1 approval decision).

Attempt 3 exposed a gap that structural validation cannot cover: the HTML was syntactically
valid and Phaser-based, but the game threw at runtime (`Graphics.fillStar` does not exist). The
preview now reports runtime errors to the host, shows a red badge, and **disables approval**
until the change is regenerated or rejected. The measured run predates that gate: it approved
v2, observed the error, and rolled back to v1.

## Phase 10 hardening (audit fixes)

**D1 — modifications start from the approved source.** A modify job now copies the
current approved `index.html` into staging, records `base_version` on the job, and tells Muse to
edit that file in place rather than regenerate it. Modifying a project with no approved version
is refused (409). Tests assert that unrelated source (`FARM_MARKER`) survives a modification.

**D2 — valid captures.** The capture bridge is injected into `<head>` and wraps `Phaser.Game`
when the CDN assigns `window.Phaser`, so capture can use `renderer.snapshot()` instead of
`canvas.toDataURL()` on a cleared WebGL buffer. Captures with no luminance range or colour
variety are rejected before they reach a model request; screenshots smaller than 32×32 are
rejected by the server. The browser test asserts a non-blank image captured via
`renderer.snapshot`.

**D3 — server-side runtime verification.** Approval loads the staged game in headless Chrome
(`playwright-core`, already installed) and fails on page errors, console errors or a missing
canvas. A failing check marks the job failed, stores the errors and returns 422; nothing is
promoted. `pnpm verify:runtime` proves a valid Phaser scene passes and a `Graphics.fillStar`
scene is rejected.

**D4–D6 — ancestry, concurrency, integrity.** Versions record `base_version`, `job_id` and a
`sha256`. Promotion is compare-and-swap under a per-project lock; a stale base returns 409
`version_conflict`. The promoted bytes are re-hashed, rollback refuses a corrupted version,
and at most two jobs may run per project. Preview, diff and current-version reads refuse
symlinks and paths outside the project (the confirmed read vulnerability is fixed and tested
with a staged symlink to `/etc/passwd`).

**S2–S6.** Preview CSP adds `base-uri`, `form-action` and `object-src` restrictions; staging is
deleted after promotion; screenshot dimensions and PNG magic bytes are validated; job logs and
jobs are bounded; no shell, filesystem or network tools were added to the agent runtime.

### Remaining limitations after Phase 10

- Runtime verification proves the game loads without errors; it does not prove every rule or
  win condition. Gameplay is still verified by the browser script, not automatically.
- Approval launches a headless browser (~2–3 s); machines without Chrome cannot verify.
- Single project/file, loopback-only, no authentication; the preview is sandboxed but served
  from the app origin.
- A broad visual request can still exceed the runtime budget; narrow requests are required for
  a predictable demo.


## Phase 10 verification results

| Item | Result | Evidence |
| --- | --- | --- |
| D1 source-aware modify | **PASS in deterministic tests** | staging seeded from v1; `base_version=1`; `FARM_MARKER` survives; empty project returns 409 |
| D2 valid capture | **PASS on the real generated game** | `renderer.snapshot`; 142 KB PNG; luminance range 197; 4,093 colourful pixels |
| D2 blank rejection | **PASS** | unit tests for black/single-colour/rendered frames; client refuses blank |
| D3 runtime verification | **PASS** | `pnpm verify:runtime`: valid scene ok, `Graphics.fillStar` rejected |
| Symlink read blocker | **PASS** | staged symlink to `/etc/passwd` cannot be previewed or diffed (409) |
| D4–D6 ancestry/CAS/lock | **PASS** | stale approval 409, tampered rollback 409, job cap 429 |
| Browser regression | **PASS** | `pnpm verify:forge` 9/9, snapshot capture asserted |
| Real Muse modification | **BLOCKED (quota)** | CLI returned 429 "Subscription quota exhausted … resets 2026-10-27T02:31:28Z" |

A real generation (89.6 s, 7 calls, 249,501 input tokens) was approved and its capture was
verified after fixing a bridge-ordering bug: defining `window.Phaser` after the CDN had assigned
it replaced the library, so the preview had no canvas. The bridge now injects before the first
script in `<head>`; the real game then loaded Phaser 3.80.1 and produced a meaningful snapshot.

The real modification could not be re-run after the fix because the Muse subscription window was
exhausted. Deterministic tests prove the source-aware path; the next real run should be done
after the quota resets.
