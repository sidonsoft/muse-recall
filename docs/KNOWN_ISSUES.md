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
**Detail:** `DATABASE_PATH=./data/…` resolves against the process working directory.
`pnpm dev` starts the server with `apps/server` as cwd, so the database lands in
`apps/server/data/`. `.gitignore` covers `data/` at any depth.
**Fix:** Use an absolute path in `.env` when the location matters.

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

### KI-4 — No authentication or rate limiting on the API

**Severity:** Low locally, blocking for any deployment
**Detail:** The API binds `127.0.0.1` with no auth, no per-user isolation, and no rate
limiting. The provider bench and memory writes are reachable by anything on the
loopback interface.
**Mitigation:** Loopback binding only; documented in [security.md](security.md).

### KI-5 — Browser verification is a script, not a test project

**Severity:** Low
**Detail:** `scripts/verify-ui.ts` drives Chrome for 18 checks and fails on console or
HTTP errors, but it is not part of `pnpm test` and needs a running server plus Vite.
**Fix (Phase 6):** Promote it to a Playwright test project with a managed web server.

### KI-6 — Unknown Muse model ids silently fall back

**Severity:** Low
**Detail:** `muse exec --model does-not-exist` does not error; the CLI uses its default
and reports the requested id. Our adapter reports what the CLI says it resolved.
**Fix:** Validate against the advertised catalog.

### KI-7 — The provider bench is non-streaming

**Severity:** Low (cosmetic)
**Detail:** Streaming exists in the adapter and is covered by tests, but no HTTP route
exposes it yet.

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

### KI-23 — Repository is private, so commit permalinks are 404 when logged out

**Severity:** Blocking for submission if judges need public access
**Detail:** `https://github.com/sidonsoft/muse-recall` is private. GitHub returns 404 to
unauthenticated requests, including commit URLs.
**Fix:** Confirm the Official Rules' visibility requirement and make the repository public
(or share it with judging accounts) before submission.

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
