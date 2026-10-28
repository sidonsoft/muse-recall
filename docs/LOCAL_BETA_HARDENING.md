# Local-beta hardening (post-hackathon)

**Branch:** `harden/local-beta` (isolated worktree from `main` at `df9a1fd`).
**Scope:** local, single-user beta. No deployment, no repository-visibility change, no
hackathon submission, no paid model calls, no research-protocol/baseline/tag changes.

Phase 17 remains active on its own branch (`claude/admiring-kilby-7f7211`, lock commit
`219b73f`). At the final check it was still running (an owned Spark watcher/process
remained active). This branch does not claim any Phase 17 result. Its checkout, files,
servers, evidence, and tags were not touched. Integration remains gated on Phase 17
completion and reconciliation.

## What changed

### 1. Durable Forge jobs and restart recovery

- Added `apps/server/src/forge/job-store.ts`: one JSON record per job, written with a
  same-directory temp file + atomic rename. Writes are serialised and intermediate
  log/usage snapshots are coalesced to at most one in-flight plus one pending snapshot.
  Creation, terminal states, approval and rejection are marked required and awaited. A
  failed write rejects instead of being swallowed.
- `ForgeJobManager.start()` persists the `queued` record **before** spawning the model.
  If persistence fails, the job is not started (no orphan paid run).
- Startup recovery (`buildApp` → `forgeManager.recover()`) scans all projects:
  - `queued`/`running` → `interrupted` with an explicit error; never resumed.
  - `succeeded` + unapplied → staged bytes stay reviewable; missing staging is reported.
  - a promotion that completed before the job record was written is reconciled from
    `state.json`.
  - malformed job files are left untouched and reported; readable jobs still load.
- `ForgeProjectView.recovery` separates immutable startup counts, current job counts,
  unacknowledged historical incidents, acknowledged count, and project/store storage
  health. The Studio banner offers explicit **Acknowledge notices** and **Retry storage**
  actions. Acknowledgement persists the proposed id set before publishing it in memory;
  writes are serialized, so a failed request cannot hide notices or discard another
  successful acknowledgement. Active storage failures cannot be acknowledged as history.
- Storage health checks return independent workspace-root and selected-project outcomes
  (`root_ok`, `project_ok`, bounded errors). A project check cannot clear another project
  or a root failure; a root success cannot clear a project-directory failure. The Studio
  shows both diagnostics and keeps the explicit retry action.
- **Durability policy:** intermediate job snapshots are best-effort and coalesced;
  creation, terminal state, approval and rejection are required. Decision Guard is
  advisory metadata carried in the required approval record — it has no separate blocking
  write. A runtime-verification failure keeps bounded browser diagnostics even if storing
  the failed record also fails. If promotion succeeds but the job record cannot be
  written, the API reports explicit partial success (`persistence_failed`) and startup
  reconciliation can rebuild the job’s version from `state.json`.
- Failed starts (for example a modify with no approved application) remove their staging
  directory when no execution began. Recovered/completed staging is never removed.
- Shutdown and `flush()` wait for the newest required snapshot and surface the latest
  write failure.
- `workspace.state()` uses a distinct missing-file sentinel, so JSON `null` can no longer
  masquerade as absence. Present state is validated through one shared path; malformed
  content is preserved byte-for-byte and raises `state_corrupt` instead of being
  overwritten with an empty project.
- `app.close()` now calls `forgeManager.shutdown()`: it stops new starts, marks active
  jobs cancelled, sends SIGTERM, escalates to SIGKILL after a bounded grace period, waits
  for terminal persistence, then flushes. Repeat calls share one promise. In-flight
  starts and fallback attempts are checked before spawning.
- Exact-byte approval (`expectedSha256`), version-conflict checks, and rollback ancestry
  are unchanged.

### 2. Memory trust boundaries

- `renderMemoryBlock` now includes each record's UUID, type, scope, validation status,
  confidence, and source reference. `<`, `>`, `&` are escaped so stored text cannot close
  the block or open a fake system section.
- Removed “authoritative unless contradicted” from the Forge prompt. Production Forge
  passes structured retrieval records; constraints/goals render separately from other
  memories. A legacy raw block remains for the frozen Phase 15A script and is wrapped and
  escaped identically.
- Forge child process:
  - shared environment allow-list (home/login, `PATH`/`Path` and platform lookup,
    locale, temp/XDG, proxy, certificate configuration);
  - no `DATABASE_PATH`, `WORKSPACE_ROOT`, provider keys, `META_API_KEY`, or
    `NODE_OPTIONS`;
  - cwd is the staging directory;
  - `--no-session-log`, `--no-foreign-personal-context`, `--disable-web-tools`,
    `--disable-reminders`, `--disable-request-user-input`.
- The chat provider uses the same shared environment policy. A configured primary
  `META_API_KEY` is delivered over stdin, not placed in argv or inherited by the child.
- This does **not** make `--workspace` an OS sandbox. See
  [security.md](security.md#forge-child-process).

### 3. Browser workflow in CI

- Added `scripts/verify-studio-workflow.ts` and `pnpm verify:studio-workflow`.
  It starts its own production API, web preview, temp database/workspace, free ports and
  Playwright browser; uses the deterministic fake Muse fixture; covers generation, staged
  review, approval, modification, rejection, rollback, and restart recovery, including
  form and keyboard interactions. Version expectations follow monotonic history: after
  v1/v2 and a rollback to v1, the recovered staged change is approved as **v3** with
  `base_version: 1`, while v1 and v2 remain intact.
- Added a `browser` CI job that installs Playwright Chromium with `--with-deps`, builds,
  and runs the workflow. The workflow uses the same shared browser helper as the other
  active checks. Live-model checks remain opt-in (`MML_LIVE_MUSE=1`).
- Runtime verification and every active verification script, including
  `verify:studio-workflow`, share the managed-browser policy: Playwright-managed Chromium
  by default, system Chrome only with explicit `FORGE_RUNTIME_BROWSER=chrome`, actionable
  missing-browser errors, no fallback and bounded/redacted diagnostics. Active scripts
  report the selected browser and version.
- Frozen research/evidence scripts under `scripts/phase12c*`, `scripts/phase12e*`,
  `scripts/phase14a*`, and `scripts/phase15a*` retain their historical explicit Chrome
  launches. They are not current verification entry points and were not modified. The
  active `scripts/ux-evidence.ts` capture path uses managed Chromium but was not rerun
  because it rewrites tracked UX evidence.
- UI labels now say “Syntax/structure passed” and explain that automated checks are not
  human review.
- Verification labels are documented in README: syntax validation ≠ successful loading ≠
  tested interactions ≠ human review.

### 4. HTML Studio trial fixes

The event-ticket-calculator trial exposed eight UX/identity issues; all were verified
against the current code and fixed in Studio:

- **No prefilled request:** the change field starts empty with the placeholder
  “Describe what you want to change.” Generate change stays disabled for
  empty/whitespace-only input. Drafts are stored per project and survive project
  switches; examples only fill when explicitly selected.
- **Studio identity:** the header now labels the chat provider separately (`Chat · …`).
  Studio shows the configured Forge model (`<model> (configured)` or
  `CLI default (configured)`) in the Development chip and footer, and explicitly does
  not claim an independently observed execution model.
- **Decision Guard context:** with no project decisions it says “No project decisions to
  check.” When decisions exist, it lists the applicable supported rules and separate
  coverage/runtime limitations. Findings remain advisory and never block approval.
- **Descriptive names and summaries:** Studio uses the existing project name when it is
  meaningful, with the internal id secondary. New version summaries prefer a meaningful
  recorded summary and fall back to the bounded user request, not the generic
  “Application updated.”
- **First-version message:** the first approval says “First version approved.”;
  previous-version preservation is mentioned only when earlier versions exist.
- **Explicit project memory:** the empty-memory state and header offer an Add decision
  form. It uses the existing memory validation path with the current project scope,
  requires explicit submission, refreshes the list, and reports failures. It never saves
  suggestions or model summaries automatically.
- **Export disclosure:** Download HTML has an accessible Export info disclosure: exported
  HTML runs outside Studio’s sandbox and may need external dependencies/network access;
  it is not claimed to be self-contained or offline-ready.
- **Inspectable approval checks:** approved versions record syntax/structure results,
  runtime load result, browser identity/version, verification timestamp and the exact
  checked artifact hash. Older versions without telemetry show “not recorded.” Stored
  diagnostics are bounded and redacted; load checks are explicitly separated from
  interaction testing and human review.

### 5. Documentation

Updated `README.md`, `ARCHITECTURE_OVERVIEW.md`, `security.md`, `KNOWN_ISSUES.md`,
`NEXT_STEPS.md`, `muse-integration.md`, and `.env.example`. Historical release reports and
research evidence are unchanged.

## Final review scope

The complete working-tree diff was reviewed, including untracked files. No protected
research, hackathon evidence, submission, release evidence, demo artifact, or frozen
phase/evidence script changed. The three submission/preregistration tags were unchanged.

**Changed areas**

- Forge runtime: job store, recovery, shutdown, state validation, child environment,
  prompt rendering, runtime browser selection, API error mapping.
- HTML Studio UI: recovery banner, verification labels, interrupted status, per-project
  drafts, separate Studio identity, no-decision/applicable Guard context, descriptive
  project/version display, explicit memory creation, export disclosure, and approval-check
  inspection.
- Shared contracts: `interrupted` status, recovery report, Guard applicable rules, Studio
  identity, and approval verification.
- Tests/fixtures: new shutdown, state, job-store, child-env, prompt, Guard UI,
  approval-verification, durability/coalescing, and 32-check browser regressions; deterministic fake Muse modes.
- CI/config/docs: managed browser job, Vite preview proxy, env example, architecture,
  security, known issues, backlog, and this handoff.

**Excluded / untouched**

- No files under `docs/hackathon-evidence/`, `research/`, `release-deliverables/`,
  `experiments/`, `docs/release/`, `docs/submission/`, or `demo/` were modified.
- No tags were created, moved, or deleted. `submission-v14`, `submission-v15`, and
  `phase17-preregistration` are unchanged. `HEAD` has no tag.
- No database migration, dependency, lockfile, repository-visibility, deployment, or
  publication change.
- One pre-existing Biome `useTemplate` style issue in
  `tests/evaluation/forge-decision/accuracy/accuracy.test.ts` was fixed with an
  equivalent template literal. The generated string is identical, so the test input,
  detector, baseline, and recorded output are unchanged.
- The Forge memory evaluation's prompt-wording assertion was updated because production
  prompt wording changed. It still checks that the approved constraint is present and now
  also checks that memory is labelled untrusted data rather than authoritative. No
  evaluation input, detector, baseline, or recorded output changed.

## Post-review fixes (PR #1)

Reviewed head: `d8cdc02`. Three independently reproduced review findings were fixed without
changing the hardening scope.

### 1. Storage Retry now restores durable job state before clearing the incident

`ForgeJobManager.checkStorage()` previously retested only the directory. It cleared every
project persistence incident after a temporary-file write, even when a terminal job record
still said `running` on disk; a restart then recovered a completed job as `interrupted`.

- After a successful project directory check, Retry storage now re-persists the **latest
  in-memory state** of each job with a failed required write, then waits for the store to
  flush that job before clearing the incident.
- Retries are revision-fenced. If execution, approval, or rejection changes the job while a
  retry write is in flight, the manager writes the newest revision again instead of letting
  a stale snapshot win. The retry loop is bounded; if state cannot settle, the warning
  remains visible rather than claiming durability.
- A failed retry records a fresh active persistence incident. Storage stays unhealthy until
  a later retry succeeds. Root and project checks/incidents remain independently scoped.
- Regressions: successful retry restores the terminal record and reloads it as `succeeded`
  across restart; an injected continuing failure keeps the active warning and leaves disk
  non-terminal; an approval concurrent with a gated retry ends with the approved version on
  disk, not the stale version-less snapshot.

### 2. The complete browser-launch diagnostic is bounded and redacted

The old launch path bounded only the Playwright error text, then appended setup guidance.
The final `browser_selection.failure` could exceed the shared 300-character schema limit; a
451-character missing-browser message made approval throw `ZodError` and return HTTP 400.

- `runtime-check.ts` now redacts and bounds the **complete** diagnostic, keeping the
  actionable `pnpm exec playwright-core install chromium` / explicit-Chrome guidance within
  the limit. Successful browser identity strings are bounded too.
- The manager defensively bounds and re-validates policy/attempted/selected/failure fields
  before building the failed or approved job record, so an injected checker cannot push a
  field over its schema limit.
- Regressions: a mocked long managed-Chromium launch failure is `<=300` characters, keeps
  setup guidance, redacts a synthetic `api_key` value, and parses against
  `ForgeRuntimeBrowserSelectionSchema`. An approval/API regression injects the same long
  failure, receives `422 runtime_failed` (not `400 invalid_request`), reads the recorded
  `failed` job without a schema error, keeps the bounded diagnostic, and leaves the project
  version unchanged. No system Chrome is launched.

### 3. Returned startup read failures now affect storage health

`ForgeJobStore.loadAll()` reports directory read failures through `loaded.issues`, but
`recoverOnce()` only marked storage unhealthy when `loadAll()` threw. An unreadable root
could therefore show `job_store_unreadable` while reporting `storage.ok: true` and
`root_ok: true`.

- Startup now translates `job_store_unreadable` issues into the corresponding root or
  project storage error. Malformed individual records (`job_unreadable`, schema mismatch)
  remain notices only and do not make the directory look unavailable.
- Storage health checks now verify that the directory can be **listed** as well as written.
- An ongoing failure remains in storage health even after its historical notice is
  acknowledged. Only a successful root/project retest clears that scope; checking another
  project or the root cannot clear a project-directory failure, and vice versa.
- Regressions use real filesystem faults: a chmod-`000` workspace root and a project `jobs`
  path replaced by a file. They cover scope isolation, acknowledgement, repair, and
  clearing. The existing malformed-record test now also asserts healthy storage.

### Re-review validation

Local, Node **24.22.1**:

- `pnpm verify` — **618 passed, 3 skipped** (621 total, 39 files); lint and typecheck clean.
- `pnpm build` — pass.
- Focused files: `runtime-browser-policy`, `forge-recovery`, `forge-api` — **69 passed**.
- `verify:runtime` — pass, managed Chromium `156.0.8078.4`; valid/broken scenes and blocked
  HTTP/WebSocket.
- `verify:studio-workflow` — **32 checks**, managed Chromium.
- `verify:forge` — **14 checks**, managed Chromium, run against an isolated production
  API/Vite preview because the default port 5173 was occupied by an unrelated listener.
- `verify:browser` — pass, same isolated production stack.
- `verify:security` — pass, managed Chromium (foreign-origin rejected, same-origin allowed).
- `verify:formsandbox` — **7 checks**, managed Chromium.
- No system Chrome was launched; no paid inference was used.

## Integration preparation

- **Implementation commit:** `9c76ae94284269ed69ba1406d392fd3528b588df`
  (`harden: durable Forge recovery and managed browser checks`).
- **Draft PR:** [sidonsoft/muse-recall#1](https://github.com/sidonsoft/muse-recall/pull/1)
  against `main`. Draft only; not merged, tagged, deployed, or published.
- **Post-review fix commit:** `878ce8f057dc1fb6116e2ea32aa9f0e7158df9a0`
  (`fix: close Forge recovery and browser diagnostic gaps`).
- **CI on `878ce8f`:** [run 40711026738](https://github.com/sidonsoft/muse-recall/actions/runs/40711026738)
  passed both jobs:
  - [verify job](https://github.com/sidonsoft/muse-recall/actions/runs/40711026738/job/122896020114):
    Node `24.21.0`; lint, typecheck, **618 passed / 3 skipped**, build — success.
  - [browser job](https://github.com/sidonsoft/muse-recall/actions/runs/40711026738/job/122896020628):
    Node `24.22.1`; installed Playwright Chromium `156.0.8078.4` and passed all
    32 Studio workflow checks with `Browser: Chromium 156.0.8078.4 (managed)`.
- **Pre-review CI:** [run 40706723095](https://github.com/sidonsoft/muse-recall/actions/runs/40706723095)
  passed on the implementation commit under **Node 24.21.0**:
  - [verify job](https://github.com/sidonsoft/muse-recall/actions/runs/40706723095/job/122880717524):
    lint, typecheck, 611 passed / 3 skipped, build — success (pre-review run).
  - [browser job](https://github.com/sidonsoft/muse-recall/actions/runs/40706723095/job/122880717063):
    installed Chromium `156.0.8078.4` (Playwright revision `1248`) and passed all
    32 Studio workflow checks with `Browser: Chromium 156.0.8078.4 (managed)`.
- **Local integration validation:** the pre-review head used Node 24.22.1, 611 passed /
  3 skipped, build and all applicable managed-browser checks passed. The post-review run
  uses 618 passed / 3 skipped; CI is reported separately, not inferred from local runs.
- **Final pushed commit:** the docs-only handoff commit that follows `878ce8f`; its CI run
  is recorded in the PR checks. It changes no code.

## Pre-integration gates

Status at handoff:

| Gate | Status |
| --- | --- |
| Local `pnpm verify` on Node 24.22.1 (CI major), post-review | **Pass** — 618 passed, 3 skipped |
| Local production build on Node 24.22.1 | **Pass** |
| Local runtime verifier (Node 24.22.1, managed Chromium 156.0.8078.4) | **Pass** |
| Local managed Studio workflow (Node 24.22.1) | **Pass** — 32 checks |
| Local managed UI smoke (`verify:browser`, Node 24.22.1) | **Pass** |
| Local managed Forge workflow (`verify:forge`, Node 24.22.1) | **Pass** — 14 checks |
| Local managed security check (Node 24.22.1) | **Pass** |
| Local managed form/sandbox check (Node 24.22.1) | **Pass** — 7 checks |
| Local production shutdown smoke | **Pass** (earlier isolated run) |
| GitHub Actions `verify` job on post-review `878ce8f` | **Pass** — [job](https://github.com/sidonsoft/muse-recall/actions/runs/40711026738/job/122896020114), Node 24.21.0, 618 passed / 3 skipped |
| GitHub Actions `browser` job with pinned Chromium on `878ce8f` | **Pass** — [job](https://github.com/sidonsoft/muse-recall/actions/runs/40711026738/job/122896020628), Chromium 156.0.8078.4, 32 checks |
| GitHub Actions `verify` job on pre-review `9c76ae9` | **Pass** — [job](https://github.com/sidonsoft/muse-recall/actions/runs/40706723095/job/122880717524), Node 24.21.0, 611 passed / 3 skipped |
| GitHub Actions `browser` job on pre-review `9c76ae9` | **Pass** — [job](https://github.com/sidonsoft/muse-recall/actions/runs/40706723095/job/122880717063), Chromium 156.0.8078.4 |
| Node 24 compatibility (CI runtime) | **Pass** — local 24.22.1 and CI 24.21.0 |
| Protected paths and tags unchanged | **Pass** — audit completed |
| Phase 17 completed and reconciled | **Gated** — still running at the final check; no Phase 17 result claimed |
| Draft PR / final review | **Draft** — [PR #1](https://github.com/sidonsoft/muse-recall/pull/1); no merge |

Before integration:

1. Wait for Phase 17 to finish; review its completed results and deviations without
   modifying its branch, evidence, or tags. Reconcile only findings that affect this
   hardening work. Integration remains gated until then.
2. CI has passed for the implementation commit; re-run it if any branch content changes.
3. Node 24 behaviour for `node:sqlite`, signal handling, and the browser preview proxy
   passed locally on 24.22.1 and on the GitHub runner at 24.21.0.
4. The `browser` job installed and selected the lockfile-pinned Playwright Chromium
   (`156.0.8078.4`, revision `1248`), as recorded in the job log.
5. Protected-path and tag audit is complete. Reconfirm on the final pushed commit.
6. Keep this branch distinct from the experiment release. Do not tag it until review
   approves a release name; never reuse a submission or Phase 17 tag.

## Release identity

- `harden/local-beta` is a **hardening candidate**, not a submission snapshot.
- The submission snapshots and research tags remain frozen:
  `submission-v14`, `submission-v15`, `phase17-preregistration`.
- The experiment's Phase 17 outputs belong to its own branch and must not be described as
  part of this hardening release.
- If a release tag is later approved, create a new tag; do not move an existing one.

## Migration and recovery

No database migration is required. Job/version JSON remains additive-compatible; the new
`approval_verification`, `applicable_rules`, and recovery fields are optional on old
records. The recovery report shape changed from flat `loaded_jobs`/`storage_ok` fields to
`startup`, `current_jobs`, `issues`, `acknowledged_issues`, and `storage` (including
independent `root_ok`/`project_ok` diagnostics); clients must use the new shape. Acknowledgement ids are stored in `<WORKSPACE_ROOT>/forge/.recovery-ack.json`;
deleting that file only re-shows historical notices, never deletes job records.

- **Normal restart:** jobs reload automatically. A job that was queued/running is shown
  as `interrupted`; start a new job after reviewing any staged files.
- **Malformed job file:** it is reported in the Studio recovery banner and left in place.
  Move it aside manually only after copying it for diagnosis; valid jobs still load.
- **Malformed `state.json`:** the project returns `state_corrupt` instead of an empty
  project. Restore `state.json` from a backup (or repair the JSON) before opening the
  project. Do not delete it unless you accept losing version ancestry; job files and
  version directories are separate and can be inspected first.
- **Persistence failure:** start returns `503 persistence_failed` and does not run the
  model. Check workspace permissions and free disk space, then retry. Use the Studio
  **Retry storage** check (or `POST /api/forge/projects/:id/storage-check`) to retest the
  selected project and workspace root. The response is a recovery report with independent
  `root_ok` / `project_ok` results; only the scopes actually retested are cleared.
- **Recovery notices:** acknowledge historical incidents from the Studio banner (or
  `POST /api/forge/projects/:id/recovery/ack`). Active storage failures remain visible
  until a healthy check; interrupted jobs remain interrupted for audit.
- **Upgrading from an older workspace:** no conversion is needed. Existing `jobs/*.json`
  files are read by the same schema; new fields are optional.

## Verification

Executed in the isolated worktree on Node **24.22.1** (the CI major) unless noted. Earlier
validation used Node 26.8.1; the Node 24 run is the integration result.

- `pnpm verify` — pass: lint and typecheck clean; 618 passed, 3 skipped (621 total,
  39 files) on the post-review head. The pre-review head had 611/614.
- `pnpm build` — pass.
- `pnpm lint` / `pnpm typecheck` — pass after the final script change.
- `git diff --check` — clean.
- Production-build smoke (deterministic fake provider, no browser): API health, Vite
  preview proxy, generation, process restart, job reload, staged preview after restart —
  pass.
- Production-build shutdown smoke: a SIGTERM-ignoring fake child was running; server
  SIGTERM returned after ~5s, the child was gone, and a restarted server loaded the job
  as `cancelled` (not `interrupted`). Pass.
- `pnpm verify:runtime` — PASS (managed Chromium 156.0.8078.4; valid/broken scene,
  blocked HTTP and WebSocket).
- `pnpm verify:browser` — PASS against an isolated production API/web preview, managed
  Chromium, with a disposable database, workspace and browser context.
- `pnpm verify:forge` — PASS — 14 checks, managed Chromium, isolated API/web/browser.
- `pnpm verify:security` — PASS — foreign-origin rollback rejected, same-origin accepted,
  managed Chromium.
- `pnpm verify:formsandbox` — PASS — 7 checks, managed Chromium.
- Each active script printed `Browser: Chromium 156.0.8078.4 (managed)`; no script fell
  back to system Chrome.
- Missing-browser and launch-failure paths are unit-tested with injected launch failures;
  no system Chrome is started.
- Targeted new tests cover transactional/serialized acknowledgement, active-failure
  dismissal, root/project storage isolation with real filesystem faults, job-store
  atomicity/order, malformed records, interrupted recovery, promotion reconciliation,
  persistence failure, malformed/null state, hostile memory escaping/identity, shared
  child-env policy, managed script browser policy, and legacy block escaping.
- Shutdown regressions: a SIGTERM-ignoring fake child is SIGKILLed on `app.close()`;
  the job is persisted as cancelled; a reloaded manager does not mark it interrupted;
  new starts are refused; repeat shutdown calls share one promise. A separate test
  verifies shutdown terminates a fallback child after quota failover.
- Version allocation for the repaired browser scenario (v1 → v2 → rollback to v1 →
  recovered change approved as v3 with `base_version: 1`) is covered by the existing
  workspace/API ancestry tests. The browser script's expectations were corrected to match.
- Recovery/durability regressions cover explicit browser policy, project/store health
  isolation, fixed startup counts, acknowledgement persistence, failed-start cleanup,
  coalesced log bursts, and approval advisory/runtime/promotion persistence faults.
- Managed Studio browser workflow: **PASS — 32 checks** with
  `pnpm verify:studio-workflow` on Playwright-managed Chromium, using only a disposable
  database/workspace, free ports, and its own browser context. It covered empty/neutral
  drafts, project-switch isolation, separate chat/Studio identity, no-decision Guard,
  explicit decision creation, applicable checks, first-version messaging, version
  summaries, export disclosure, approval checks with browser identity/hash and explicit
  managed-browser policy, generation, staged review, approval, modification, rejection,
  rollback, restart recovery, recovery-banner acknowledgement, and the v3/base-v1 history
  assertions. Phase 17 was still running; no Phase 17 files, servers, processes, evidence
  or tags were touched.

## Before/after screenshots

Captured with the deterministic fake-provider fixture (not live Muse generation):

- Before: [before-approved-v1.png](../test-results/studio-before/before-approved-v1.png)
  — prefilled animal-card request, generic Guard checks, “app generated” summary,
  “Approved v1. The previous version stays in history.”, chat model shown as Studio identity.
- After: [after-approved-v1.png](../test-results/studio-after/after-approved-v1.png)
  — empty neutral change field, no-decision/applicable-check Guard state, explicit memory
  action, recorded request as version summary, “First version approved.”, separate Studio
  identity, export disclosure, and inspectable approval checks.
- Empty state after: [after-empty.png](../test-results/studio-after/after-empty.png)
- Recovery banner: [after-recovery-banner.png](../test-results/studio-after/after-recovery-banner.png)
- After acknowledgement: [after-recovery-ack.png](../test-results/studio-after/after-recovery-ack.png)

These are test outputs under the ignored `test-results/` directory; they are not
historical research evidence.

## Remaining risks

- Forge persistence is single-process JSON files, without `fsync` or a cross-process lease.
- The Forge child still runs as the server user; `--workspace` is not an OS boundary.
- Interrupted jobs are not resumable by design. Active jobs at graceful shutdown are
  cancelled, not resumed.
- Shutdown relies on SIGKILL after the grace period; an unkillable process is outside the
  application's control.
- Browser coverage is representative, not visual/gameplay/accessibility exhaustive. The
  local run and CI both used Playwright-managed Chromium; CI installed and selected the
  lockfile-pinned Chromium 156.0.8078.4.
- Managed-browser adoption removes the known automatic system-Chrome launch paths in
  active verification and runtime-check code. It does **not** establish that every macOS
  Chrome crash is resolved: the historical phase/evidence scripts still launch system
  Chrome by design, and no cross-browser stability claim is made.
- Approval verification telemetry is available only for versions approved by this build.
  Older versions display “not recorded” rather than a successful check.
- Studio identity is configured only. There is no independently observed execution-model
  telemetry, so the UI does not claim verification.
- The recovery acknowledgement file is local, unauthenticated workspace state; it is not
  a signed audit ledger. Deleting it re-surfaces historical notices.
- The active script browser policy is managed and the CI job confirmed it. Windows
  executable lookup remains unverified. Historical phase/evidence scripts still launch
  system Chrome by design and must not be treated as current verification.
- Intermediate coalescing bounds disk churn but does not provide `fsync`/power-loss
  durability. A failed intermediate write is recorded; required writes still gate
  creation/terminal/approval/rejection.
- The child environment is an allow-list, not an OS sandbox. It preserves certificate and
  platform lookup variables but cannot make a same-user child filesystem-confined.
- The chat provider delivers a configured primary key over stdin; CLI-stored login remains
  the default. No full environment inheritance is restored.
- Windows `Path`/`PATHEXT` policy is tested synthetically and the POSIX executable lookup is
  tested by spawning `node`; no Windows host was available, so Windows spawn behaviour
  remains unverified here.
- A corrupt `state.json` blocks that project until repaired (explicit, not silent).
- The legacy raw memory input remains for the frozen Phase 15A protocol.

## Next recommended milestone

Reconcile the completed Phase 17 results first. Then add an explicit `state_corrupt`
repair/export flow and move Forge execution behind a dedicated OS user or container.
See [NEXT_STEPS.md](NEXT_STEPS.md).
