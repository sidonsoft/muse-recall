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
