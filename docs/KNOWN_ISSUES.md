# Known issues

Honest list of defects and limitations. Severity reflects impact on the hackathon
demonstration.

---

## Memory engine

### KI-11 — Deletion is irreversible through the API

**Severity:** Medium (by design, but users may expect an undo)
**Detail:** `DELETE /api/memories/:id` removes the memory from the FTS index and hides
it from every read endpoint. There is no restore endpoint, because a restore would
contradict the guarantee that deleted content cannot be recovered. The tombstone still
exists in SQLite for integrity, and `purge` (maintenance only) removes it entirely.
**Mitigation:** The delete form states the consequence and asks for confirmation.
**Fix:** A future "trash" feature would need an explicit, separately-authorized
retention policy — not a normal read path.

### KI-12 — Superseded records remain visible in the inspector list

**Severity:** Low (correct behaviour, potentially confusing)
**Detail:** The default "All visible" filter includes `active`, `superseded`, and
`expired`. Superseded records are never used for retrieval, but they remain inspectable
so a correction chain can be audited. A user who deletes the current fact will still
see the older superseded record.
**Mitigation:** Status pills and the "Superseded by" link make the state explicit.
**Fix:** Default the filter to `active` if user testing shows confusion.

### KI-13 — Retrieval is keyword-only

**Severity:** Medium (functional limitation)
**Detail:** Candidates come from FTS5 `bm25`. A query using different vocabulary from
the stored memory ("database" vs "storage") will not match unless `constraint`/`goal`
pinning or recency puts the memory in the candidate set. The pluggable embedding
provider described in the design is not implemented.
**Mitigation:** Retrieval is explainable, so a miss is diagnosable rather than silent.
**Fix:** Add an optional embedding provider with keyword fallback (design already
requires graceful degradation).

### KI-14 — Pinned memories can still crowd the budget in extreme cases

**Severity:** Low
**Detail:** Up to two slots are reserved for `constraint`/`goal`. A project with many
constraints can still fill the remainder through score, because pinned types carry the
highest `type_priority`.
**Mitigation:** The benchmark reports selected counts and accuracy, so the effect is
measurable.
**Fix:** Make the reserve and type priority configurable per project.

### KI-15 — `all_projects` is an inspector-only affordance

**Severity:** Low
**Detail:** `GET /api/memories?all_projects=true` ignores scope entirely. Retrieval has
no equivalent: a prompt is always scoped to one project plus globals. This asymmetry is
intentional but easy to misread.
**Mitigation:** Documented in the schema comment and here.

### KI-16 — Concurrent writes serialise

**Severity:** Low for the intended use
**Detail:** `BEGIN IMMEDIATE` takes the write lock up front. Two writers block on the
busy timeout (5 s) rather than interleaving. That is what makes dedupe and supersession
safe, but throughput is single-writer.
**Mitigation:** Correctness tests cover two connections writing concurrently.
**Fix:** Out of scope; multi-user hosting is excluded.

---

## Platform and integration

### KI-1 — Relative paths resolve against the package directory

**Severity:** Low (documentation/UX)
**Status:** Fixed on `main` in [PR #4](https://github.com/sidonsoft/muse-recall/pull/4).
**Detail:** `DATABASE_PATH=./data/…` used to resolve against the process working directory.
`pnpm dev` starts the server with `apps/server` as cwd, so the database landed in
`apps/server/data/`. Relative paths and `.env` now resolve from the repository root.
**Upgrade:** data created by earlier builds stays in `apps/server/data/` and
`apps/server/workspaces/`. Move it to `data/` and `workspaces/` at the root, or set absolute
paths. `.gitignore` covers both locations.

### KI-2 — Per-run token usage can be empty

**Severity:** Medium (affects evaluation, not functionality)
**Detail:** `run.usage` sometimes reports `models: []` because the CLI's allowance
endpoint returns `credential_rejected` on this machine. The adapter then reports zero
rather than a wrong number, and the evaluation harness marks the comparison invalid
instead of computing a delta from it.
**Fix:** Fall back to a locally computed estimate, explicitly labelled as an estimate.

### KI-3 — ~16.6k token floor per Muse CLI call

**Severity:** Medium (cost and evaluation)
**Detail:** Measured at exactly 16,630 input tokens across five identical calls
(CV 0%). A ~4k-character memory block adds 877 tokens. See
[benchmarks/muse-overhead-latest.md](benchmarks/muse-overhead-latest.md).
**Impact:** Memory is not a token-saving mechanism by itself; comparisons must account
for the constant.
**Fix:** A direct API adapter or long-lived `muse serve` session would remove it.

### KI-4 — No per-user auth; token mode optional; no rate limiting

**Severity:** Low locally, blocking for any deployment
**Detail (re-surveyed 31 Oct 2026):** Default posture unchanged: the API binds
`127.0.0.1` with no auth, no per-user isolation, and no rate limiting. Since
D045 an **optional shared bearer token** (`ACCESS_TOKEN`) guards every `/api`
route except `/api/health` (wire-witnessed, incl. 401 refusals and SSE
composition), and bind/Host guards are token-aware — but that is one shared
secret, not identity. Identity, scoping and rotation remain the post-judging
G-6 items.
**Mitigation:** Loopback binding by default; optional token mode; documented
in [security.md](security.md).

### KI-5 — Browser verification is a script, not a test project

**Severity:** Low
**Detail:** `scripts/verify-ui.ts` drives Playwright-managed Chromium for its UI checks
(explicit system Chrome only with `FORGE_RUNTIME_BROWSER=chrome`) and fails on console or
HTTP errors, but it is not part of `pnpm test` and needs a running server plus Vite.
**Status (post-hackathon hardening):** Partially resolved. `pnpm verify:studio-workflow`
now manages its own API, production web preview, temp database/workspace, ports and
Playwright Chromium, and CI runs it with the deterministic fake provider. The older broad
UI scripts still require manually started servers.

### KI-6 — Unknown Muse model ids silently fall back

**Severity:** Low
**Detail:** `muse exec --model does-not-exist` does not error; the CLI uses its default
and reports the requested id. Our adapter reports what the CLI says it resolved.
**Fix:** Validate against the advertised catalog.

### KI-7 — The provider bench is non-streaming

**Severity:** Low (cosmetic)
**Detail (re-surveyed 31 Oct 2026):** Streaming IS exposed over HTTP — the SSE
turn route `POST /api/sessions/:id/messages` streams `retrieval`/`delta`/
`usage`/`completed` (D026; wire-witnessed with headers and event order, #78
and #103). What remains true: the *provider bench script* itself drives the
adapter without streaming, so bench numbers reflect non-streamed calls.

### KI-8 — Single-writer assumption

**Severity:** Low for the intended use
**Detail:** WAL is enabled, but the design assumes one local user and one server
process.

### KI-9 — Dark theme only

**Severity:** Cosmetic
**Detail:** A single dark palette; `color-scheme` is pinned to dark.

### KI-10 — `muse usage` fails on the reference machine

**Severity:** Informational
**Detail:** `usage refresh failed (credential_rejected)` while `muse exec` works.

---

## Benchmark caveats

### KI-17 — Retrieval accuracy is a synthetic recall metric

**Severity:** Informational
**Detail:** The benchmark's 100% accuracy means "the memory containing the query's
unique token was in the top-8". The corpus is generated from a seeded PRNG and is not a
real memory database. It does not measure semantic search quality or answer quality.
**Mitigation:** Stated in the generated report and in [evaluation.md](evaluation.md).

---

## Phase 3 — conversations and capture

### KI-18 — Keyword retrieval misses genuine vocabulary gaps

**Severity:** Medium (functional limitation)
**Detail:** In the 22-question evaluation two failed: "What is missing from the API?" (the
memory says "Rate limiting … not implemented yet"; neither word appears in the question) and
"Is mobile still the priority?" (the corrected memory says "desktop browsers", so "mobile"
only exists in the superseded record). Both are lexical gaps, not bugs in ranking.
**Mitigation:** Recency fallback prevents an empty context; the evidence string reports
"no keyword match", so the failure is visible in the UI.
**Fix:** Optional embedding retrieval with keyword fallback. The evaluation now demonstrates
the need, which was the precondition for adding one.

### KI-19 — Correction history competes with history for budget

**Severity:** Low
**Detail:** `recent_corrections` is dropped first when the prompt budget is exhausted, so a
very long conversation can lose the "what changed" explanation.
**Mitigation:** The warning list in the context report records the drop, and the inspector
shows it.

### KI-20 — The Muse CLI baseline dominates token comparisons

**Severity:** Informational
**Detail:** Both configurations pay ~16.6k input tokens. Demo C shows memory costing ~37 more
tokens on the answering call while removing a setup turn; the whole-task saving comes from
that turn, not from cheaper calls.
**Mitigation:** Reported explicitly in [evaluation.md](evaluation.md).

### KI-21 — One turn at a time per session

**Severity:** Low
**Detail:** A second concurrent message returns `409 session_busy` instead of queueing.
Clients must retry after the stream completes.
**Mitigation:** The UI disables the composer while streaming.

### KI-22 — Memory capture heuristics can misfire

**Severity:** Medium
**Detail:** Correction capture uses lexical overlap to pick the record to supersede.
Announcement-only sentences ("we changed X") are skipped, and a marginal match creates a new
memory instead of superseding. Unusual phrasing may therefore create a duplicate rather than
a correction; the user can correct it in the inspector.
**Mitigation:** Every capture reports what it stored and which record it superseded.

### KI-23 — Repository visibility (resolved for public release)

**Severity:** Was blocking for submission if judges need public access
**Detail:** The repository was private, so GitHub returned 404 to unauthenticated requests,
including commit URLs.
**Status:** Resolved — the repository is being published for judging. Historical commits,
branches and evidence remain accessible; no history was rewritten.

---

## Phase 4 — generated interfaces

### KI-24 — Generation depends on a strict structured-output call

**Severity:** Medium
**Detail:** Muse is asked for a planning form via `--output-schema`. One retry is allowed;
after that the request fails with `ui_generation_failed`. A prompt or model change can break
generation even though the rest of the app works.
**Mitigation:** The failure is explicit and the chat path is unaffected. The protocol and
submission path are covered by deterministic tests.

### KI-25 — Generated interfaces are planning forms only

**Severity:** Informational
**Detail:** The renderer supports headings, text, status, progress, task lists, tables,
cards, forms, and dismiss buttons, but generation emits only a heading, a description, and
one form. Layout is not model-controlled.
**Rationale:** A small validated vocabulary is more trustworthy than a general surface
generator for this phase.

### KI-26 — Interface submission costs a full model turn

**Severity:** Informational
**Detail:** Submitting a form stores a memory and runs an agent turn. In the recorded run the
continuation used 34,362 input tokens because the summary and retrieved memory were included.
**Mitigation:** Submission is an explicit user action and the resulting turn is visible.


---

## Phase 5 — agent tools

### KI-27 — Each tool-enabled turn costs an extra model call

**Severity:** Medium (cost)
**Detail:** Tool planning is a separate structured call. In the recorded run approving a task
cost ~16.9k input tokens for the follow-up turn, and the planning call costs a similar
baseline. Tools roughly double the token cost of an acting turn.
**Mitigation:** `TOOL_DECISION_MODE=auto` only plans when the message looks actionable;
`off` disables tools entirely.

### KI-28 — Tool planning is a heuristic trigger

**Severity:** Low
**Detail:** In `auto` mode, planning runs only for messages matching an action-word heuristic.
A message like "the menu needs work" may not trigger a tool call even when one would help.
`force` (used after an interface submission) and `always` cover the demo paths.

### KI-29 — Approval requires a follow-up turn

**Severity:** Low (UX/cost)
**Detail:** After approving a write, the agent continues in a new turn. The approval itself
is not executed inside the original stream.

### KI-30 — No shell, filesystem, or network tools

**Severity:** Informational (by design)
**Detail:** Phase 5 deliberately ships six project/memory tools only. `WORKSPACE_ROOT` is
reserved for a later phase; there is no arbitrary command path.
*(Era note, 31 Oct: the registry now publishes seven - `task.create`/`task.list` joined later;
the design claim is unchanged: still no shell, filesystem or network tools.)*

---

## Post-hackathon local-beta hardening

### KI-31 — Forge job persistence is single-process

**Severity:** Low for the intended single-user app; blocking for multi-process hosting
**Detail:** Each job is one atomically replaced JSON file under `WORKSPACE_ROOT/forge`.
Writes for a job are serialised inside one server process, and startup recovery loads all
readable records. There is no file lease, database transaction, or cross-process lock, so
two servers must not share a Forge workspace.
**Mitigation:** The app remains local and single-user; recovery issues are visible in the
Studio banner and `GET /api/forge/projects/:id`.
**Fix:** Move job metadata into SQLite with a lease/owner column if a hosted variant is ever
built.

### KI-32 — The Forge child is not OS-isolated

**Severity:** Medium (local trust boundary)
**Detail:** `--workspace` roots the Muse CLI's policy-gated tools, and the child now starts
in the staging directory with an allow-listed environment and hermetic flags. It still runs
with the server user's filesystem permissions; the app does not own a container, VM, or
separate OS user.
**Mitigation:** Do not enable `--yolo`/`--disable-sandbox`; keep the CLI's sandbox and
approval layer on. Run Forge in a dedicated container/user if stronger isolation is needed.
**Fix:** Containerised worker with only the staging directory mounted.

### KI-33 — Interrupted jobs are not resumed

**Severity:** Low (explicit trade-off)
**Detail:** A `queued`/`running` job found at startup becomes `interrupted` with an
explanation. It is not retried, because a partial model run may already have consumed quota
or written staged files. The user must start a new job.
**Mitigation:** The staged bytes, logs and usage are preserved for inspection. On a
graceful `app.close()`, active jobs are marked cancelled, owned children receive SIGTERM
then SIGKILL after a bounded grace period, and terminal state is flushed before shutdown
returns. Only an ungraceful process death produces `interrupted`.
**Fix:** A resumable-job design would need idempotent provider calls and a durable lease;
out of scope for this milestone.

### KI-34 — Atomic rename without a filesystem sync

**Severity:** Low
**Detail:** Job and state writes use temp-file + rename, which survives a process crash but
not necessarily a sudden power loss before the filesystem flushes. There is no `fsync` of
the file or directory. Intermediate log/usage snapshots are coalesced; creation, terminal
states, approval and rejection are awaited but still not power-loss-fsynced.
**Mitigation:** Startup validates every record and reports unreadable ones instead of
showing an empty project.
**Fix:** Add `fsync`/directory sync if the beta needs power-loss durability guarantees.

### KI-35 — Browser coverage is representative, not exhaustive

**Severity:** Low
**Detail:** The managed Chromium job covers generation, staged review, approval,
modification, rejection, rollback, restart recovery, recovery-banner acknowledgement and
representative form/keyboard interactions. It is not a visual-regression, pixel, gameplay,
accessibility, or cross-browser audit. Runtime approval defaults to managed Chromium;
system Chrome requires an explicit policy and never silently replaces a failed managed
launch.
**Mitigation:** Screenshots/logs are written to `test-results/`; the UI labels automated
syntax/loading checks separately from human review.
**Fix:** Add visual snapshots and a second browser engine when the suite is expanded.

### KI-36 — Legacy raw memory input remains for the frozen Phase 15A script

**Severity:** Low (research compatibility)
**Detail:** `buildForgePrompt` still accepts a raw `memoryBlock` string for
`scripts/phase15a-child-safety-trial.ts`. That path is wrapped and escaped in the same
untrusted-data block, but it has no per-record id/provenance. Production Forge passes
structured retrieval records instead.
**Mitigation:** Tests assert the legacy path cannot close the block.
**Fix:** Freeze a local prompt snapshot for the historical protocol and remove the legacy
input from production code.

### KI-37 — Approval verification telemetry is forward-only

**Severity:** Low
**Detail:** Versions approved before this hardening build have no recorded runtime browser
identity, timestamp or checked hash. The UI renders those fields as “not recorded”; it does
not infer a successful check from the version’s presence.
**Mitigation:** The version’s own SHA-256 and the approval pipeline remain unchanged.
**Fix:** Backfilling historical telemetry would require re-running verification on
historical bytes and must not be presented as an original approval check.

### KI-38 — Studio generation identity is configured, not observed

**Severity:** Low
**Detail:** Studio shows the configured Forge model (or “CLI default”) and labels it
“configured.” The current pipeline does not persist an independently observed execution
model id. The chat provider’s model is shown separately and is not evidence about Forge.
**Mitigation:** The UI never claims the configured model was independently verified.
**Fix:** Persist model identity from CLI telemetry if the protocol provides it reliably.

### KI-39 — Studio drafts are browser-local

**Severity:** Informational
**Detail:** Per-project prompt/change drafts are stored in `localStorage`, so they survive
project switches in one browser but do not sync across browsers or devices.
**Mitigation:** Drafts are explicitly project-scoped; examples only fill on selection.
**Fix:** Persist drafts server-side only with a clear retention/deletion policy.

### KI-40 — Recovery acknowledgement is local workspace state

**Severity:** Informational
**Detail:** Acknowledged recovery-notice ids are stored in
`<WORKSPACE_ROOT>/forge/.recovery-ack.json`. It is not signed or authenticated, is shared
by all local users of that workspace, and deleting it re-surfaces historical notices. It
never deletes job records or clears active storage failures. Writes are serialized and the
proposed set is published in memory only after the atomic write succeeds.
**Mitigation:** Active failures remain visible until a successful storage health check;
interrupted jobs remain `interrupted` for audit.
**Fix:** A multi-user deployment would need authenticated per-user acknowledgement state.

### KI-41 — Intermediate writes are coalesced, not transactional

**Severity:** Low
**Detail:** A burst of log updates can replace pending intermediate snapshots before they
are written. Required snapshots (creation, terminal, approval, rejection) are never
abandoned for an older intermediate update, but a process crash can lose the latest
intermediate logs/usage.
**Mitigation:** Terminal/approval records are awaited and failures are surfaced.
**Fix:** Move job persistence into SQLite with transactions if stronger audit durability
is needed.

### KI-42 — Frozen phase scripts still launch system Chrome explicitly

**Severity:** Informational
**Detail:** Historical phase/evidence scripts (`scripts/phase12c*`, `scripts/phase12e*`,
`scripts/phase14a*`, `scripts/phase15a*`) retain their original explicit Chrome launches
so frozen evidence remains reproducible. They are not current verification entry points.
**Mitigation:** Current verification scripts and the runtime checker use
`scripts/lib/browser.ts` / the server policy: managed Chromium by default, explicit
`FORGE_RUNTIME_BROWSER=chrome` only, no fallback.
**Fix:** Rewrite the phase scripts only if their evidence is deliberately re-baselined.

### KI-43 — Five inline wire error codes live outside the versioned error catalogue

**Severity:** Low (contract completeness, not function)
**Detail (found 31 Oct 2026 by doc-vs-catalog diff):** `GET /api/errors`
publishes 45 codes (D048, catalogue version 2 - wire re-witnessed 31 Oct
at head as 45 UNIQUE codes across 46 group entries: `invalid_request`
deliberately publishes twice, session/400 runtime rejection and
provider/503 bench request-bug, code+status+context triples per the
mirror rule; "45 codes" throughout this entry counts uniques), and the
mirror test suite drift-gates the probed mappings. But five codes the server returns as
hand-built (not `apiFailure`) responses are absent from the catalogue:
`ui_generation_failed` (`routes/ui.ts:114`, a 502 when the model misses
the interface schema twice), `surface_not_found` (ui.ts:167),
`surface_already_submitted` (ui.ts:174), `tool_call_not_found`
(`routes/tools.ts:56`), `tool_call_not_pending` (tools.ts:63). They
behave correctly and are shape-stable; the catalogue just under-mirrors
reality for these five — the same "catalogue must mirror reality"
standard D048 set for the other surfaces.
**Mitigation:** behavior is exercised by ui/tools API tests; the codes
appear nowhere else than these five sites; the gap is documented here
rather than left to be discovered by an integrator diffing wire traffic
against `/api/errors`.
**Fix (post-judging, one lockstep PR):** add the five entries to
`API_ERROR_CATALOG`, bump `ERROR_CATALOG_VERSION` 2→3 (adding entries is
catalogue-visible), replace the inline sends with `apiFailure()` at those
five sites, and extend the mirror suite to probe all five — code,
catalogue, tests, version in one PR, per the D048/D051 discipline.
Pre-Nov-4 rule: contract bumps wait for the judging window to close.

### KI-44 — Two committed docs promise a "2:46 fallback video" that no tree contains

**Severity:** Low (a dead pointer on a judge-facing index), but it is a
**defect inside the frozen entry**, not just integration.
**Detail (found 31 Oct 2026):** `docs/README.md` (the documentation index
judges are routed to) describes the Phase 16 evidence card as research
"shown in the 2:46 fallback video", and `SUBMISSION_CHECKLIST.md` says the
"2:46 cut is retained as the fallback". Exhaustive check: the only video
files in ANY tree - integration AND frozen `main` - are the 2:50 V21 demo
and its website copy; `git log --all --diff-filter=D` finds no deleted mp4,
so the 2:46 cut was never committed. The research itself IS shown at the
END of the committed 2:50 video (the evidence card says so) - the promise
is wrong about the file, not the content.
**State on integration:** both lines corrected 31 Oct to describe what the
committed files support. **State on `main`:** both stale lines are inside
the frozen submission surface; the freeze forbids touching them.
**Owner action for the 4 Nov submission acts:** either promote the two
docs-only lines to `main` before cutting the submission tag (they change
no code, but they DO change the SHA judges currently see), or ship as-is
knowing one index line points at a nonexistent file. Recorded in the
preservation doc's owner-act list.

### KI-45 - Malformed JSON body answers `internal_error`, but the catalogue promises `bad_request`

**Severity:** Low (right status, wrong code; every documented client path sends valid JSON)
**Detail:** Wire probe at head (31 Oct, echo provider, fresh DB):
`POST` with body `not json` to any route answers **400 with
`{"ok":false,"error":{"code":"internal_error","message":"Request body is not valid JSON."}}`**.
The catalogue's `bad_request` entry (api.ts, transport group) claims exactly that
situation: "Request body is not valid JSON, or the Idempotency-Key header is
malformed...". The header half is mirror-tested (`idempotency.test.ts` asserts
`bad_request`); the body half is NOT tested - and the content-type parser tags
the parse failure with `statusCode: 400` (comment: "Malformed JSON is a client
error, not a server fault") while the generic error handler maps it to
`internal_error`. So the code contradicts BOTH its own catalogue entry and its
own source comment. Status (400) is right; only the code lies.
**Why not fixed before judging:** behavior change, not judge-visible on any
demo path. **Fix plan:** handler maps statusCode-400 parse failures to
`apiFailure('bad_request', ...)`; mirror probe asserts live 400 + bad_request;
catalogue text needs NO change (the docs are the truth being caught up to), so
`ERROR_CATALOG_VERSION` stays 2 - fits naturally in KI-43's post-judging
lockstep PR as a second code-honesty item.

### KI-46 - Landing-page build tooling carries two dev-server advisories (website/ vite high, esbuild moderate)

**Severity:** Low **for this project's shipped surface** (the advisories are real; the exploit context is absent)
**Detail:** `npm audit` at head (31 Oct, read-only) in the standalone `website/` npm project:
- **vite** high - path traversal in dev-server optimized-deps `.map` handling, range ≤6.4.3,
  fix requires a semver-major bump to vite 8.x;
- **esbuild** moderate - dev server lets any page send/read requests, range ≤0.24.2.
Both are **dev-server** flaws. The deployed landing page is static output built by
website.yml and served by GitHub Pages: no dev server ever faces a visitor, and the
app's own runtime does not use vite at all. The workspace itself audits CLEAN
(`pnpm audit`, prod+dev, 31 Oct). Frozen path + semver-major: the bump is queued
post-judging (website/ unfreezes first), as part of the supply-chain tier with
action-register item 6.
