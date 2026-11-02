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
**Status (beta integration, 31 Oct):** FIXED on `integration` by owner
direction ahead of beta 0.1 — the pre-Nov-4 queuing applied to what the
judges see, and `main` @ c32d03b + the submission tag are untouched;
promotion stays post-judging. Catalogue v3 published the five codes AND a
SIXTH (`invalid_submission`, 400) discovered live while writing the mirror
probes: 53 entries / 52 unique codes. The five sites now send via
`apiFailure()` (shapes unchanged); ten new live probes (five session codes,
invalid_submission, bad_request body half, payload_too_large) run in the
drift gate.

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
**Status (beta integration, 31 Oct):** FIXED with the KI-43 v3 bump (same PR,
same bump — the version moved for the ADDED entries; this entry's text stayed
as written, which it was). The parse failure now carries `mmlCode`
`bad_request` end to end; mirror probe + the characterization pin flipped in
lockstep.

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
**Status (beta integration, 31 Oct):** re-audited at `integration` head: identical two
findings (locked vite 5.4.21 + esbuild 0.21.5; the only automated fix is a vite 8
major), main workspace `pnpm audit` clean. Beta decision: DEFER unchanged - website/
is outside the pnpm workspace, ships as a static Pages artifact, and both advisories
need a dev server to exploit. Same sweep also found the queued main-workspace
updates (biome 2.6.3->2.6.4, @types/node 26.6.5->26.6.6 patch; vite 7->8 +
plugin-react 5->6 dev-major): all deferred - a toolchain churn PR during beta buys
nothing and would force a full re-verify.

### KI-47 - On the frozen `main`, CONTRIBUTING's SECURITY.md link 404s; the security-policy indicator is unset (same shape as KI-44)

**Severity:** Cosmetic-to-judges (one dead docs link + one missing repo indicator; no functional impact)
**Detail:** raw-URL probes (31 Oct, case-sensitive like GitHub's Linux side):
`main/SECURITY.md` -> **404**, `integration/SECURITY.md` -> 200, `main/CONTRIBUTING.md` -> 200.
The root `SECURITY.md` (37-line security policy: private disclosure channel, scope, supported
versions) was added on `integration` (9bb0770) AFTER the `main` cut, so on the frozen default
branch (a) CONTRIBUTING.md:33's `[SECURITY.md](SECURITY.md)` link lands on a 404, and (b) GitHub's
security-policy community indicator stays unset (it reads default-branch files). The 264-line threat
model is tracked lowercase `docs/security.md` and resolves 200 on both branches - its links are fine.
Fix: NONE needed as new work - promoting `integration` to `main` post-judging lands the root policy
and repairs the link in one merge. Owner decision at tag time mirrors KI-44: (i) promote the
docs-only lines to `main` before tagging (changes the shipped SHA) or (ii) ship as-is with the
404 recorded here. Both files are also inside the frozen tree, so nothing acts before judging.
**Status (beta integration, 31 Oct):** unchanged - no beta action; the fix IS the
post-judging `integration`->`main` promotion merge, and the tag-time choice stays an
owner call (mirrors KI-44).

### KI-48 - Oversized request bodies answer 413 + `internal_error`; the catalogue has no 413 entry at all (KI-45's class, second instance)

**Severity:** Low (status correct, code wrong, like KI-45; discovery value is the missing 413 class)
**Detail:** `bodyLimit: 1_048_576` at apps/server/src/app.ts:137 (1 MiB, code-only - no doc claims the
number). Wire probe (31 Oct, fresh server): POST ~1.1 MB to `/api/memories` ->
`413 {"ok":false,"error":{"code":"internal_error","message":"Request body is too large"}}`.
The message is Fastify's default body-limit rejection; the generic error handler re-maps it to
`internal_error` - a CLIENT error wearing a server-fault code, exactly KI-45's mechanism. Worse
for the catalogue: NO 413 entry exists anywhere in the 45-code versioned set, so even a corrected
code would currently be uncatalogued (KI-43 territory).
Fix plan (post-judging, rides the KI-43 lockstep PR): handler maps Fastify's 413 statusCode to a
new `payload_too_large` (413) catalogue entry + mirror probe; catalogue +1 entry => ERROR_CATALOG_VERSION
2->3 in the same PR as KI-43's five codes and KI-45's bad_request mapping - one version bump, three
code-honesty fixes. Pre-Nov-4: behavior+contract change, not judge-visible, so documented and queued.
**Status (beta integration, 31 Oct):** FIXED exactly as planned, in the KI-43 bump
(executed pre-Nov-4 on `integration` only by owner direction; frozen judge tree
untouched). Fastify bodyLimit refusals answer 413 `payload_too_large`; entry
published; mirror probe + characterization pin flipped in the same bump.

### KI-49 - security.md's uid-change wrapper recipe cannot write the staging tree - G-2 provisioning gap (found while building the operator runbook)

**Severity:** Low (the G-2 seam is unset in the default beta, so the shipped example fails only for
operators who follow it; nothing judge-visible)
**Detail (found 31 Oct 2026 by code-reading the launch path; no live experiment yet):**
docs/security.md recommends `setpriv --reuid forge` behind `FORGE_WORKER_WRAPPER`. But the child
needs two OS permissions the server grants only to the server user: the staging directory
`<project data>/staging/<job-id>` is created mode **0700** server-owned (workspace.ts:510
`ensurePrivateDirectory`) and the Forge CLI file-write tools run with `cwd=staging`
(runner.ts:1268); `prompt.txt` is written mode **0600** (runner.ts:1224 `writePrivateFile`) and
passed as `--prompt-file`. A uid-changing wrapper boots fine (the startup probe only runs
`<wrapper> node -e 0` - worker-wrapper.ts) but the first real generation hits EACCES inside the
CLI, surfacing as an interrupted job. The example as written promises isolation it cannot deliver.
**Working today without code changes:** (a) a container-launcher wrapper whose staging bind-mount
is uid-mapped to the server euid (strongest isolation; the startup probe exercises the launcher
end to end), or (b) a `systemd-run` scope wrapper (cgroup/temp isolation, no uid change - partial).
**Fix plan (post-judging, owner call):** small server-side ACL support - create staging
(0750) and prompt (0640) group-accessible for a dedicated worker group named by a new env;
contract-visible (new env + permission model), hence tier-C of the action register (item 13).
**Status (beta integration, 31 Oct):** the trap is defused, the recipe is gone, the ACL
work stays queued. The startup probe is no longer just `node -e 0`: `probeWorkerStagingAccess`
creates a 0700 scratch dir + 0600 prompt INSIDE `<WORKSPACE_ROOT>/forge/.wrapper-probe/` and
runs the wrapper through the exact generation accesses (read prompt, write inside cwd). A
uid-changing wrapper now REFUSES BOOT with a KI-49-naming error instead of dying mid-job;
pinned by unit tests (prompt-revoke and dir-revoke controls simulate the EACCES shape
without setuid) and an integration boot-refusal test. The misleading setpriv example is
removed from security.md; the default posture (same-uid child, 0700/0600 server-owned) is
now stated plainly there and in the runbook. True uid isolation still waits on C-13 ACL
support (owner call) - the beta deliberately did NOT weaken permissions to paper over it.
**Second-review addendum (31 Oct):** the probes now spawn under `forgeChildEnv` - the
identical scrubbed allowlist env the real generation launch uses - closing the gap where
a wrapper requiring stripped server configuration (a `DOCKER_HOST`-style sentinel)
passed boot and exited mid-job; a pinned sentinel regression refuses such wrappers at
BOTH probes, and wrapper configuration is policy-stated as self-contained (no new
env-forwarding surface).

---

## Test typechecking (post-judging action B-7)

### KI-50 — `tsconfig.tests.json` is green and wired to a gate (closed 2 Nov)

**Severity:** was Medium for future regression coverage: untyped test code hides
real defects. **Status: closed.** `pnpm run typecheck:tests` passes, it is part of the aggregate
`pnpm verify`, and CI runs it as "Typecheck test and gate sources" in the `verify`
job, between the product typecheck and the test run. Measured path: **311 → 278 → 131 → 41 → 0** errors
(from 5651c19 through 3ea5944). No check was loosened, no assertion removed, no
`any`/`@ts-ignore`/`@ts-expect-error` introduced.

How the families were closed:

- 311 → 278 — the config declared no DOM lib, no `jsx`, and no type mappings for
  `react`, `react-dom`, `pngjs` (pnpm keeps them under `apps/web` / `apps/server`,
  not the root), and no Vite client types for `import.meta.env`. Each absence
  reported as a test-code error.
- 278 → 131 — Batch B–E tests and the forge/memory/media suites now carry types
  that match what the code does: `NonNullable<InjectOptions['payload']>` for
  request bodies (one `unknown` there collapsed fastify's `inject()` overloads and
  produced 75 bogus property errors in a single file), named job/view types
  instead of `as { error: string }` casts, real `PNG` instances for `pngjs`.
- 131 → 41 — `tests/helpers/memory-fixtures.ts` mirrors the defaults declared by
  `MemoryCreateInputSchema` / `MemoryCorrectionFieldsSchema`, so a fixture states
  the fields the input type carries instead of leaning on the runtime to fill
  them. The suites whose purpose IS proving a default applies (`memory-defaults`,
  `memory-terms`, `memory-status`) deliberately keep omitting those fields.
- 41 → 0 — the Phase 12/14/15 gate scripts and evaluation harnesses: the recorded
  pilot JSON now states the fields the rehearsal reads instead of
  `Record<string, unknown>` plus two casts; rubric and `SHA256SUMS` reads name the
  malformed case; the evaluation harnesses import `ModelProvider` from
  `@mml/shared` (it is declared locally in `@mml/muse-provider` and never
  re-exported).

**The memory-engine signature call, resolved as: not taken.** `MemoryEngine.create`
and friends keep taking the schema's parsed shape. Changing them to
`MemoryCreateRequest = z.input<typeof MemoryCreateInputSchema>` would be a
contract-visible change in a shipped package for the sake of test ergonomics, and
the fixtures now state the values anyway. Revisit only if a real client is
hand-building partial inputs at the type level.

**What the gate does NOT cover, deliberately:** `scripts/verify-phase16.ts`,
`verify-phase17.ts` and `verify-phase17-sums.ts` are protocol-locked (their own
bytes are hashed by the Phase 16/17 chain, so a type-only edit breaks the
evidence chain). `verify-phase17-strict.ts` is locked too, and used to drag its
frozen errors into scope because `tests/research/phase17-evidence.test.ts`
imported its `closeRelative` helper. That math now lives in
`tests/research/phase17-math.ts`; the locked script keeps its own copy (it cannot
import anything), and a test compares the two copies text by text so neither can
change the comparison unnoticed. With nothing in scope importing it, the script
sits outside the denominator honestly rather than by omission.

**Latent defects this gate had already reported and nobody had acted on:**
`engine.correct({ reason: null })` against an `.optional()` (non-nullable) field in
the decision-evaluation harness; `rubric[r.id].child_safety` in the Phase 15b
verifier; a `stamp(offset: string)` helper called with numbers; `ProviderError`
constructed with a code its own union does not declare; a contract resource read
as `contents[0]?.text ?? "{}"`, which would have turned a binary or missing
resource into an empty object and failed on an unrelated field.

## KI-51 — the product recorded wrong dimensions for the images its own model returns (closed)

**Symptom.** The first live image run stored a frame and reported it as unusable:
the gate said the stored bytes did not match the manifest, and the manifest said
**1×1600** for a picture the provider returned at 1600×1600.

**Root cause.** `parseWebpDimensions()` in `apps/server/src/media/assets.ts` read
VP8X canvas size one byte early. VP8X lays out a flags byte, reserved bits, then
canvas width and height as 24-bit little-endian minus-one values at payload
offsets 4 and 7; the parser read offsets 1 and 4. The flags byte is `0x04` for
the "extended" bit, which is exactly the number the model's header carries, so
the width it read was never a width. Nothing downstream noticed: preview sizing
and reference scaling would simply have used the wrong canvas.

**Why the tests did not catch it.** The fixture was a hand-written header stub
(`RIFF…WEBPVP8X` and nothing else) shaped to match the parser's mistake rather
than the format. A real VP8X chunk from the live model disagreed with it.

**Fix.** Offsets corrected and bounds-checked; the fixture replaced with a
spec-shaped VP8X builder, and both a square (1600×1600, flags `0x02`) and a
rectangular (640×1024) frame are pinned, including the flags byte the live
response carries.

**What would have caught it earlier.** Independent measurement. The live gate now
decodes the stored bytes with a real browser and refuses when the manifest
disagrees with `naturalWidth`/`naturalHeight` — that comparison is what surfaced
this, and it is the reason the measurement gate reads the bytes the product
stored rather than the bytes the transport returned.
## KI-52 — three Studio panels shared one React key, and only development React said so (closed)

**Symptom.** On a freshly installed app opened in dev mode, the console logged
`Encountered two children with the same key` eight times, with the offending key
being the current project id.

**Root cause.** `StudioView` remounts `MediaPanel`, `VoiceVideoPanel` and
`StudioMemory` when the project changes, by giving each `key={projectId}` — added
in the Batch C/D work so the previous project's thumbnails and prompt draft
cannot survive a switch. Those three elements are siblings in the same children
array, so the array held three identical keys. React requires keys to be unique
*among siblings*, not merely per component.

**Why no gate saw it.** React strips these warnings from production builds. Every
browser gate in this repository runs against production bundles (`verify:batchc-ui`,
`verify:batche-review-ui`, `verify:studio-workflow`, `verify:batchd-playback-auth`),
and CI builds production artifacts before running them. The defect was therefore
invisible to exactly the checks that look cleanest. It surfaced on the first run
of `pnpm verify:fresh-install`.

**Why it matters anyway.** A duplicated sibling key is not cosmetic: it tells the
reconciler that two different elements are the same item, which is the same class
of bug Batch D fixed for playback state — one element's state attributed to
another, here visible as panels that may not remount when the project does.

**Fix.** The keys are prefixed per panel (`media:` / `voice:` / `memory:`), which
keeps the documented remount behaviour and makes the siblings distinguishable.

**Net added.** `verify:first-run` runs the command README documents —
`MODEL_PROVIDER=echo pnpm dev`, open `http://127.0.0.1:5173` — walks the documented
screens in the managed browser, and fails on any console error on any screen. It
is wired into both browser legs of CI, because dev-mode warnings are a class that
production-bundle gates cannot cover.

## KI-53 — a generated game needs the CDN, so "local" is not the same as "offline" (measured; dependency remains by design)

**Observed.** A freshly installed app, opened for the first time with the offline echo provider,
requests `https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js`. This is the product's own
documented choice: the generation prompt names that script, the preview CSP allowlists
`script-src … https://cdn.jsdelivr.net`, and `apps/server/src/forge/runtime-check.ts` treats that
one host as the only permitted remote. This machine reaches it: HTTP 200, 1 181 917 bytes, 0.5 s.

**What was measured on 2026-11-02**, in managed Chromium, with the engine request failed while the
allowlist still permitted it:

| Surface | Engine reachable | Engine load fails |
| --- | --- | --- |
| Working Phaser scene | canvas created, visible content, no errors | no `<canvas>` at all |
| Page signal | — | page error `Phaser is not defined`; console `Failed to load resource: net::ERR_*` |
| Approval | passes verification | **refused**: `422 runtime_failed`, no version, `current_version` stays null |
| Studio preview | renders | blank frame, and Studio has **no** signal about why |

Three things follow, and the third is the one that was wrong.

1. The verifier already refused such an artifact, so no broken game was ever approved. Good.
2. The dependency is real: approval of a game needs outbound HTTPS to that host, not just the
   browser. Gates that approve a Phaser artifact have always depended on egress, which an earlier
   version of `docs/MULTIMODAL_STUDIO_STATUS.md` described as "no external network". That wording
   was wrong and is corrected: the gates make no **provider** call and refuse to run when a provider
   credential is present; the browser gates do reach the one allowlisted host.
3. **The refusal blamed the artifact instead of the network.** Reported errors were "The
   application did not render visible content", "No canvas element was created", an unattributed
   `Failed to load resource: net::ERR_*` and `Phaser is not defined`. Nothing named the host, so a
   user with no connectivity was told their game was broken. `checkGameRuntime` now records loads
   the allowlist permitted but the network refused (`requestfailed` on an allowed origin) and
   reports them as `A load the allowlist permitted failed (<origin>): <reason>` — origin only, never
   the path or a query the generated page built from page data, the same rule the blocked-request
   text follows, bounded to the schema's 300 characters and redacted. `RuntimeCheckResult` gained
   `remote_failures`; the line reaches the job's `validation.issues` and so the review panel.
   Blocked hosts are still reported through `blocked`, never as a permitted failure, so this cannot
   launder a refused destination into a network complaint.

**Net added.** `pnpm verify:runtime` grew from three cases to five, and its engine-failure case needs
no egress: the artifact requests the approved host on port 1, which the allowlist permits and the
browser refuses to attempt, producing a permitted-load-failure deterministically. Assertions require
the refusal to name `https://cdn.jsdelivr.net` and forbid the report from leaking `phaser.min.js`.
A blocked host must not appear in `remote_failures`, and a scene that loads its engine and then
throws must not be blamed on the CDN. Exit codes are separated honestly: `1` is a verifier defect,
`2` means the approved CDN is unreachable here, so the reachable-engine cases cannot be measured —
which is the same fact this entry is about, reported rather than hidden.

**Still open, deliberately.** The dependency itself. Closing it means vendoring Phaser into the
server's static bundle and pointing the prompt, the CSP and the runtime allowlist at the local copy
(~1.18 MB, one version, its own update and licence questions), or accepting that games need network.
The preview surface also stays unsatisfying: a sandboxed preview document gives Studio no console
access, so a game that cannot fetch its engine shows an empty frame with no in-frame message. A
message there needs a bridge inside the preview document — a separate change with its own review,
not something to bolt onto this fix.


## KI-54 — a route that promised to change nothing created the Forge project anyway (closed)

**Symptom.** `POST /api/forge/projects/:id/visual-review` and
`GET /api/forge/projects/:id/generations` both returned the right answer for the
right reasons, and both created `<data>/forge/<id>/state.json` on disk for a
project that had never been staged.

**Root cause.** Each route opened with `await workspace.ensureProject(id)` — a
holdover from the routes that legitimately need state — before validating the
request. `ForgeWorkspace.ensureProject()` calls `state(id)`, which loads, creates
the directory tree and writes when the file is missing. Every later guard was
read-only; the first line was not.

**Why the tests missed it.** The suite seeds its own Forge state in `beforeEach`,
so there was never a cold project to observe. Every "advisory, writes nothing"
assertion in the visual-review tests checked versions, jobs, staging files and
memory rows — the state the route could corrupt — and none looked at the
filesystem the route touched first.

**Fix.** The `ensureProject()` calls are gone from both read-only paths: reading
state that does not exist returns `null` and renders "no generations"/"nothing on
record", which is the honest answer for a project that has never been used. The
routes that legitimately write state (`generate`, `modify`, `approve`, `rollback`,
`reset`) still initialise it.

**Regression tests.**
`tests/integration/forge-batche-visual-review.test.ts` now adds a project id that
exists only as a database row and asserts (a) a refused stale-selection review
creates no `<root>/forge` directory, (b) a successful review creates none either,
and (c) listing generations for an id the workspace has never seen returns
`{ items: [], current_version: null }` and creates none.

## KI-55 — the live gates' own accounting was wrong, in ways that could report paid work that never happened (closed, reopened by the review of the fix: items 9-12, reopened again by self-review: items 13-16)

An independent review of the live-acceptance chain (`d69b798..549dc93`) found
these; each was reproduced before being fixed. None invalidated a recorded live
result — the paid runs' own dispatch assertions still hold — but the reported
numbers were not trustworthy, and two of the gates could pass on a broken run.

**1. A retry could be counted as one call.** `countModelAttempts()` in
`scripts/lib/media-trace.ts` counted *distinct attempt numbers* per model.
Attempt numbering restarts for each operation, so two independent first attempts
scored as one dispatch — exactly the count the zero-retry budget exists to catch.
It now counts `callDispatch` start lines, and a second `attempt=1` line for the
same model fails the budget. A retry correctly counts as two dispatches.
`tests/unit/media-trace.test.ts` pins all three cases.

**2. A harness failure erased its own ledger.** `verify:batchd-live-smoke.ts` and
`verify:image-live-smoke.ts` set `calls` only on the success path, so any measured
failure — failed clip check, timed-out job, failed pixel assertion — was reported
with `calls.* = 0` and an empty `dispatch_ledger` while the server log held the
real `callDispatch`/`callOutcome` lines. Call counts now come from the trace in
`writeReport()` / a `finally` block, so every exit path reports what the server
actually dispatched.

**3. Forbidden paths were attributed to real capabilities.** Both harnesses
counted `/v1/responses` dispatches into `calls.coding` (and the image run copied
that into `calls.vision`) while simultaneously checking that `/v1/responses` was
never called. The forbidden-path count now goes to `calls.otherPaidPaths`, which
is what the budget assertion reads.

**4. The clip budget was asserted against a number that is not call count.**
`verify-batchd-live-smoke.ts` read `observations.clip_route_attempts`, which
includes the file upload, and wrote it into `calls.clip`. It also used
`countModelAttempts(trace, 'muse-spark')` over the *whole run*, so a coding or
vision dispatch would have been billed as a clip call. Now: the ledger-derived
count is authoritative, the route's own attempt number is kept only for
cross-checking, and the clip check runs against an operation-scoped slice.
`clipPromptIssues()` refuses a prompt that does not mention both scene colours,
so an empty observation cannot be read as a model result.

**5. The credential check read the wrong artifact.** Both harnesses searched the
*filename* of the server log for the API key, which can never match. They now read
the log body and fail if the key appears in it, and report the byte length of what
they searched.

**6. A "no network used" claim that was true of the model path only.**
`verify:batchd-playback-auth.ts` asserted no *provider* host was contacted and
printed "no network used" while the same page approved a Phaser artifact that
loads `cdn.jsdelivr.net` (see KI-53). The output now names the non-local hosts it
saw and says "no provider host".

**7. The first-run gate asserted clicks, not screens.** `inspectFirstRun()`
clicked each documented nav item, waited 800 ms and counted the screen as visited.
A screen that threw during its own effects would have been counted as visited.
Each screen must now render: the shell marks the active nav item
`aria-current="page"`, and the screen must put a heading under `<main>` (for HTML
Studio, the named `Development` panel, because that screen's heading is the
artifact title — measured `["Farmyard Memory Match"]`, with no heading at all
before the first click). Uncaught exceptions are captured through `pageerror`,
which is a different signal from `console.error`.

**8. The first-run environment was asserted nowhere, and the meta envelope was
read too loosely.** `readServiceMeta()` accepted an unwrapped body as well as the
shipped `{ ok: true, data: … }` envelope, so a failure envelope carrying a
plausible `data`, or a proxy error page, would have read as success. It now
requires `ok === true` and an object `data`. The gate also refuses a run whose
reported environment is not `development`: a production build is a different
thing from the README's first run, and it is exactly the build in which the
dev-only React warnings (KI-52) are absent. Startup time and walkthrough time are
reported separately — folding them together had labelled an 800 ms-per-screen walk
"startup".

**Found by the follow-up review of the fix pass itself (`549dc93..f79dfb7`), fixed in
the same issue's follow-up commit:**

**9. A forbidden-path count that nothing asserted.** `calls.otherPaidPaths` was recorded
in the report, but the whole-run check only tested against a hard-coded list of paths the
author had thought to forbid. An image run that also dispatched `/v1/files` passed while
printing "the whole run touched only image paths"; an audio run with a stray image call
passed while printing "every live call accounted for one dispatch". Recording a number is
not enforcing it. Every live scope now has an allowlist and the inverse rule is asserted:
a path is wrong *because it is not on the list*, not because someone remembered to list it.

**10. An incomplete ledger could support an exact paid-call claim.** A start line whose
outcome never arrived means the transport died mid-call and the number of paid calls is
unknown; an outcome line that answers no start means an answer cannot be attributed. Both
satisfied a bare "exactly one dispatch" check. `ledgerIntegrityIssues()` refuses either,
and the retry rule now lives in the same place, so one call site cannot forget it.

**11. The grounding rule could turn a correct answer into a reported model failure.**
Any denial word anywhere in the evidence counted as denying the visible fact, so
*"A countdown timer is visible despite the instruction not to show one"* — a correct
description of the probe frame — scored `evidenceDeniesTheFrame: true`. Only an absence
construction about the countdown/timer, within one clause of it, counts now; ambiguous
negation is left for the human reader, and the sentence is pinned by a test.

**12. Origin-only reporting stopped at the request URL.** The browser's *reason* text was
only redacted and truncated, so `net::ERR_FAILED https://host/npm/game/app.js?session=…`
echoed a path that can name the generated page and a query that can hold its data. URLs
inside the reason are reduced to origins before bounding. The earlier long-URL test passed
because truncation removed the checked suffix, not because anything sanitized the URL — the
new test uses a URL short enough to survive the bound.

### Reopened a second time: by reviewing the review-fix myself

The follow-up review of `549dc93..f79dfb7` closed items 9-12, and then a self-review of
those closures (`f79dfb7..HEAD`) found four more, all of them defects **in the fixes**.
Each was reproduced without a provider call.

**13. The narrowed grounding rule still failed correct answers.** Item 11's fix required
an absence construction *about* the countdown rather than any negation word, which fixed
one counterexample and left the class open: "The UI shows a countdown timer despite the
instruction not to show a timer" and "the developer was told not to display a countdown,
and one appears" both put `not … show` next to `timer` while asserting the opposite of a
denial. The probe's decisions literally read "Never show a countdown timer in the game
UI.", so a model that answers correctly is *likely* to echo that wording, and the harness
would have burned a paid call reporting a correct answer as a model failure. Denial is now
judged clause by clause with directive language (`instruction`, `rule`, `brief`,
`forbade`, `may not`, an infinitive like `not to show`) suppressing it, and a clause where
the readings collide is reported as ambiguous (`evidence_negation_quotes_decision`) rather
than scored either way. The first narrowing attempt went the other way too — it swallowed
"the frame contains no timer, so the decision is honoured" because it treated `decision`,
`conflict` and `violates` as quotients of the instruction, when those are how a finding
talks about the frame. Both directions are pinned, thirteen sentences in the probe plus
the retained live wording.

**14. The most expensive paid gate was never bounded.** Items 9-10 put whole-run path
budgets into the image, Batch D and review gates by copying the rule gate by gate, and
Batch C — the gate that spends coding calls — was left out. `pathsOutside` and
`ledgerIntegrityIssues` now sit beside a Batch C policy
(`scripts/lib/batchc-scope.ts`), and `assertPaidCallBudget()` runs before either PASS
line. Two facts it has to respect: vision and SAM share `/v1/responses`, so a path budget
alone cannot catch a vision-only run that also paid for SAM — the counts must match the
model on each start line; and coding runs through the Muse CLI, which never writes a
media-trace line, so any extra media path is an extra media call, never the coding job.
Expectations match the retained runs: `vision-only` → 1 vision + 0 SAM, `resume` → 0 + 1,
`resume-cutout` → 0 + 0, `full` → 1 + 1.

**15. A ledger claim rested on a log that did not exist.** The fixtures-only Batch D run
reports `ledger_issues: []`, `dispatch_ledger: []` and `unanswered_dispatches: 0` while
its evidence directory contains **no `server.log` at all** — that path returns before the
server starts, and `readMediaTrace` turns a missing file into an empty trace. "The ledger
is clean and empty" was a claim about an empty string. `ledgerEvidence()` now records
whether a log exists and how many bytes were read, and a run with no log reports
`ledger_issues: null` plus an explicit note instead of a clean bill of health. My previous
status wording ("PASS 4 with an empty ledger") was the overclaim in print.

**16. The policies were tested against traces the product does not write.** The new
ledger tests used synthetic lines whose outcome lines carried a path and a model. Real
outcome lines carry neither: every retained paid log writes
`outcome=response attempt=1 status=200 bytes=…`. A rule that matched needles against
outcome lines would have reported every real run as having unanswered dispatches and
unattributable outcomes — a false alarm the next live acceptance would pay for twice. The
retained lines are now transcribed verbatim into `tests/unit/live-ledger-policies.test.ts`
(from `batchc-live/2026-11-01-0106`, `batchc-live/2026-11-01-0755`,
`batchd-live/2026-11-02-0400`, `batchd-live/2026-11-02-0458`,
`review-live/2026-11-02-0451`, `image-live/2026-11-02-0445`) and each gate's policy must
find no violation in them. Same shape as KI-51, one layer up: a fixture that matches the
parser instead of the format.

## KI-56 — one backup/restore test once spent the whole 30 s test timeout, and the aggregate gate failed for no code reason (open, observed once)

While the self-review fixes were being gated, `pnpm run verify` failed on
`tests/unit/backup-restore.test.ts > refuses an existing target unless force is explicit`.
Nothing in that test or in `apps/server/src/backup.ts` waits, retries or polls, and the
same operations measured **4 ms** end to end when run directly against the product code:

```
seed (engine open): 10ms   close: 1ms   backupDatabase: 3ms
refusal (expected throw): 0ms   force restore: 4ms
```

Run alone, the test finishes in 90 ms. Run three more times as a whole file it passed
every time (28/28). In the failing run Vitest charged it ~29.9 s — the configured
`testTimeout: 30_000` — so it did not fail slowly, it **timed out**, and the failure has
not reappeared on demand.

Why it is recorded instead of smoothed over:

- the aggregate gate can fail without any code being wrong, which is exactly how a
  release gate loses its authority;
- the failure landed while other gates had just been running, so the plausible cause is
  host contention over the freshly created temp directories (SQLite `node:sqlite`
  handles plus `rmSync` cleanup), not the code under test;
- raising `testTimeout` would make the symptom disappear and hide whatever stalled for
  30 s, so the timeout is deliberately left at 30 s.

What would close it: reproduce under a deliberately loaded machine (`stress`/parallel
browser gates) with `--reporter=verbose` durations, then either isolate the backup/restore
file to its own pool or split the two slow cases. Until then, a red `verify` on this test
is re-run once before it is treated as a code failure, and the re-run is recorded.

## KI-57 — a paid gate could fail and print nothing (closed)

**Symptom.** `verify:image-live-smoke` exited 1 with no reason on the terminal.
The last visible lines were the two successful checks, then
`ELIFECYCLE Command failed with exit code 1`:

```
  ✓ the server answered readiness probes
  ✓ the live configuration gate passed and the image model is muse-image-1.0
evidence: test-results/image-live/2026-11-02-1153
 ELIFECYCLE  Command failed with exit code 1.
```

**What actually happened.** The run had failed a real check — `report.json` for
that run says
`blocked_at: "boot-only mode has no trace log, so \"zero provider calls\" is not
evidenced"`. The reason was recorded twice on disk (`report.json` and
`FAILED.md`) and never once on the terminal.

**Root cause.** Each live gate wraps its body in a catch that separates
"expected failure" from "crash":

```ts
if (!(error instanceof SmokeFailure) && !(error instanceof EarlyExit)) {
  process.stderr.write(`[${ctor}] ${message}\n`);
}
```

Every `fail()` raises `SmokeFailure`, so the branch that prints exists only for
unexpected errors — the one case that was never silent. The intended failures,
raised by the gate's own assertions, were the ones thrown away.

**Fix.** The catch now prints the reason for any measured failure:

```ts
if (!(error instanceof EarlyExit)) {
  process.stderr.write(`FAILED before completion: ${reason}\n`);
  blockedAt = reason;
  exitCode = 1;
}
```

`EarlyExit` stays quiet because it means a designed stop, and `verify:review-live-smoke`
keeps its exit 2 refusal path unchanged: without a credential it prints
`unconfigured` and does **not** print a FAILED line.

**Why it matters for paid runs.** A run that spent quota and then failed must be
legible where it was run. Silent exit 1 invites the operator to re-run the gate,
which spends the call again — the exact behaviour KI-55 is about.

**Proof.** A boot-only run mutated to feed the ledger one real-shaped dispatch
line (`[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0`
plus its outcome line) now ends with exit 1 and the line
`FAILED before completion: boot-only mode dispatched 1 time(s)`. The clean
boot-only run still passes:
`zero provider calls were made (0 bytes of trace read, 0 dispatch lines)`.

**Method note — a mutation that proves nothing.** The first mutation attempt
fed `parseMediaTrace()` lines without the `[media-trace]` prefix. The parser
ignores such lines, the gate passed, and the mutation looked like a failure to
reproduce the bug. Ledger mutations must match the real line shape (the
documented `[media-trace] attempt=…` and `[media-trace] outcome=…` forms from
`scripts/lib/media-trace.ts`), or they test the parser's filter rather than the
assertion.

## KI-58 — a build-identity report named the tested commit, not the commit the bytes came from (closed)

**Symptom.** A `verify:batchd-playback-auth` run printed
`"commit": "09d2258…", "treeClean": false` while `apps/server/dist/.build-manifest.json`
and the web manifest both said `94d3c62`, built `2026-11-02T11:50:48Z`.

**Why it happened.** `verifyBuildProvenance` returns `commit` from `git rev-parse HEAD` at
gate time. Its actual guarantees are: a manifest exists for each component, the recorded
`sourceHash` equals the hash of the **current** tree's hashed inputs, and the recorded
`buildHash` equals the current dist outputs. Those are about content, and they are strong.
Which commit was checked out when the compiler ran is a different fact, recorded in the
manifest and never surfaced by the gate.

**Both ways this misleads.**
1. A commit that touches only files the build does not hash (documentation,
   `scripts/verify-*.ts` — `SERVER_INPUTS`/`WEB_INPUTS` list product sources, package
   manifests, the lockfile, `scripts/build-production-bundles.ts` and
   `scripts/lib/build-provenance.ts`) leaves the bundles valid, so the gate correctly
   passes at the newer commit while the bytes were produced from the older one.
2. `treeClean: false` meant the build ran over a dirty tree. Commit fields agreeing does
   not help: the bytes contain work no commit names.

**Fix.** `describeBundleIdentity()` in `scripts/lib/build-provenance.ts` reports
`testedCommit`, `builtAtCommit`, `builtAtHead`, `builtFromCleanTree`,
`supportsCommitIdentity` and a prose `note`; the identity gate records all of them and adds the
note as a check line whenever `supportsCommitIdentity` is false. The status document's
mechanical rule now requires the newest `test-results/batchd-playback-auth/` run to have
`supports_commit_identity: true` before its pair can stand for a beta cut.

**Proof the drift gate itself still bites.** With `build-provenance.ts` edited but the bundles
not yet rebuilt, the same gate refused before any browser or server work:
`server sources changed since the production build (recorded 528a6c5feff6 over 128 files,
current 59d02a18924a over 128 files)`, exit 1, zero checks printed. So "hashed inputs match"
is enforced, not assumed; the gap was only in *reporting* which commit produced the bytes.
