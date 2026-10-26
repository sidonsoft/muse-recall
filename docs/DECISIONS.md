# Decisions

Architecture decisions with context and consequence. New decisions are appended;
superseded ones are marked, not deleted.

---

### D001 — Use `node:sqlite` instead of `better-sqlite3`

**Context:** The stack suggested SQLite. `better-sqlite3` is the usual choice but is a
native add-on requiring a compile toolchain, and it lags new Node major versions.
**Decision:** Use the `node:sqlite` module built into Node ≥ 24.
**Consequence:** Zero build step, no native compilation, FTS5 and JSON1 verified
present (SQLite 3.53.4). Cost: requires Node ≥ 24 (recorded in `engines`), and the
API is newer and less documented than `better-sqlite3`.

---

### D002 — Integrate Muse through `muse exec --json`, not `muse serve`

**Context:** Two verified interfaces exist: the one-shot headless command, and the MSP
session host over stdio (`muse serve`, with an authoritative schema via
`muse schema`).
**Decision:** Build the provider on `muse exec --json` with `--preset empty`.
**Consequence:** The harness owns conversation state, tool execution, and
authorization — which is exactly the security requirement. Cost: no native tool
calling over this path; the harness must implement the tool loop. `muse serve` remains
a documented option if native tool-call fidelity becomes necessary.

---

### D003 — Do not invent a REST endpoint

**Context:** No public Meta model REST API is documented, and binary inspection found
only channel/launcher URLs. `--base-url` exists but behaved inexplicably when pointed
at an invalid host (the call still succeeded).
**Decision:** Integrate only through the documented CLI surface; record the rest as
unknowns in [muse-integration.md](muse-integration.md).
**Consequence:** Slightly higher latency per call, but every claim about Muse in this
repository is backed by an observed run.

---

### D004 — Shared Zod schemas as the single contract

**Context:** Duplicated types between server, client, and database are the usual
source of silent drift.
**Decision:** All cross-boundary shapes live in `@mml/shared` as Zod schemas; the
browser re-validates every response with the same schema the server writes with.
**Consequence:** Contract drift fails loudly (a typed `contract_mismatch` error in
dev). Cost: schemas must stay free of framework imports, enforced by convention and
package layout.

---

### D005 — A deterministic provider that refuses to impersonate Muse

**Context:** CI and offline demos need a provider, but the brief forbids fake success.
**Decision:** Ship `EchoProvider` with `id: "echo"`, a name containing "not a model",
capability notes stating it must never be presented as Meta Muse, and a UI banner when
it is active.
**Consequence:** Tests are hermetic without ambiguity; no screenshot can be mistaken
for real inference.

---

### D006 — Provider health is observational, cached, and single-flight

**Context:** A health endpoint that merely reports configuration would claim
integration success it never tested. A live call on every page load burns quota.
**Decision:** `ProviderHealthTracker` flips to `verified` only after a real call;
results are cached 60 s; concurrent checks share one in-flight request.
**Consequence:** Honest status and bounded cost. The UI shows "not run" until someone
clicks, which is the truthful initial state.

---

### D007 — Biome for lint and format

**Context:** ESLint + Prettier needs several packages and two config surfaces.
**Decision:** Biome 2.6 for both.
**Consequence:** One dependency, one config, very fast. Cost: a smaller rule set than
the ESLint ecosystem; acceptable at this project size.

---

### D008 — Bundle the server with esbuild, dependencies external

**Context:** Workspace packages export TypeScript sources, so `tsc` alone cannot emit
a runnable server without a multi-package build graph.
**Decision:** Bundle `src/index.ts` with esbuild, aliasing the three workspace packages
to their sources and keeping `node_modules` external (`--packages=external`).
**Consequence:** A 45 kB runnable `dist/index.js`, verified to serve real requests.
Cost: the bundle still needs `node_modules` present at runtime, which is fine for a
local-first app.

---

### D009 — Require Node ≥ 24

**Context:** `node:sqlite` is available from 22.5 but stabilised later, and FTS5 must
be present.
**Decision:** Set `engines.node` to `>=24.0.0` and run CI on Node 24; developed and
verified on 26.8.1.
**Consequence:** No experimental warnings and no ambiguity about FTS5 support.

---

### D010 — Supersession and deletion are separate mechanisms

**Context:** Memory systems commonly conflate "this is wrong now" with "remove this",
which destroys the audit trail or leaves stale facts retrievable.
**Decision:** Supersession adds an append-only edge plus a history row and sets
`status='superseded'`; soft deletion sets `status='deleted'` **and** removes the FTS
row; purge removes bytes.
**Consequence:** Corrections stay auditable (Demo B), deletions truly disappear from
retrieval. The FTS removal is an explicit engine responsibility, documented as a
must-test invariant for Phase 2.

---

### D011 — The UI reads its own honesty from the API

**Context:** The brief forbids claiming unbuilt features work, and a static roadmap in
a README drifts from reality.
**Decision:** `GET /api/meta` reports per-module status (`schema_only`,
`not_implemented`, …) and the System screen renders that list.
**Consequence:** A reviewer can see exactly what is real without reading the source.
Cost: statuses must be updated when a module lands — a deliberate chore.

---

### D012 — Deduplication uses `BEGIN IMMEDIATE`, not a unique index

**Context:** Two writers must not create the same memory twice, but a unique index on
`content_hash` would also block a legitimate correction that replaces an old fact with
content that already exists elsewhere.
**Decision:** Run every mutation inside `BEGIN IMMEDIATE` (write lock taken up front)
and perform the duplicate check inside that transaction.
**Consequence:** Race-safe dedupe without constraining the correction semantics. Two
connections writing the same content produce exactly one row (tested). Cost: writes
serialise, which is correct for a single-user local-first app.

---

### D013 — A retried correction is only a replay when it asks for the same fact

**Context:** The first implementation treated "all targets already superseded" as an
idempotent replay and returned whatever replacement it found. Correcting a superseded
memory to a genuinely different fact then returned the old replacement with HTTP 200,
silently ignoring the user's intent.
**Decision:** A replay requires the requested content hash to match the existing
replacement. Otherwise the call is a 409 that names the record to correct instead.
**Consequence:** Retried requests stay safe, and a different correction cannot be
swallowed. Tested in both the engine and the API suites.

---

### D014 — Deletion is final through the API; supersession is not deletion

**Context:** Memory systems routinely conflate "this is wrong now" with "remove this",
which either destroys the audit trail or leaves stale facts retrievable.
**Decision:** `superseded` records remain readable as history and are excluded from
retrieval; `deleted` records are removed from the FTS index and hidden from *every*
read endpoint, including list filters that ask for them. There is no restore endpoint.
**Consequence:** Corrections stay auditable (Demo B) while deletion is genuinely final.
`purge` exists only for retention jobs and refuses rows that are still active.

---

### D015 — Pinned constraints reserve two slots, not the whole budget

**Context:** Constraints and goals must survive a keyword mismatch, but the first
implementation ranked every pinned memory ahead of everything else. The benchmark
exposed the consequence immediately: with eight pinned memories in a project, retrieval
accuracy collapsed to 17% because relevant memories never reached the budget.
**Decision:** Reserve at most two slots for pinned types, fill the rest by score, and
sort the final selection by score so the top result is the best match rather than a
constraint.
**Consequence:** Constraints are guaranteed (within the reserve) and relevance still
wins the remaining budget. Accuracy rose from 17% to 100% on the benchmark corpus.

---

### D016 — Retrieval evidence is generated from the scoring components

**Context:** An explanation that is written separately from the score will eventually
disagree with it.
**Decision:** `evidence` and `rank_components` are produced in the same pass that
computes the score, and `weights` are returned in the metadata so a client can
recompute the sum. A test asserts the weighted sum equals the reported score.
**Consequence:** The inspector can justify a retrieval without a second code path.

---

### D017 — Project scope anchors are created on demand

**Context:** `memories.project_id` is a foreign key, but Phase 2 has no project
management UI. Requiring a pre-registered project would make the memory API unusable
from a clean database.
**Decision:** `MemoryEngine.ensureProject` inserts the anchor (`id` as name) on the
first memory written in that scope; `GET /api/projects` lists what exists.
**Consequence:** The foreign key stays meaningful and a fresh install works
immediately. Cost: a typo in a project id creates a project — acceptable until project
management lands in Phase 4.

---

### D018 — User input never reaches FTS5 as an expression

**Context:** Raw text passed to `MATCH` can raise syntax errors or be shaped into a
query the user did not intend.
**Decision:** `toFtsQuery` extracts at most twelve word tokens and quotes each one,
joining them with `AND`.
**Consequence:** Search is predictable and injection-resistant; hostile strings are
covered by tests. Cost: no phrase or boolean search syntax is exposed to users.

---

### D019 — The benchmark uses a synthetic corpus and says so

**Context:** Retrieval claims need evidence, but a real user's memory database does not
exist at build time and would not be shareable if it did.
**Decision:** Generate a deterministic corpus from a seeded PRNG and label every
reported number as synthetic. Report recall at the budget, not "quality".
**Consequence:** Results are reproducible and honest about their scope. Accuracy here
proves the engine selects the right record under budget pressure; it does not prove
semantic search quality.

---

### D020 — Message order is a database guarantee

**Context:** Two concurrent turns in one session could interleave assistant output.
**Decision:** `messages` has `UNIQUE(session_id, sequence)`; the sequence is assigned inside
`BEGIN IMMEDIATE`. The runtime additionally rejects a second concurrent turn with
`session_busy` rather than queueing it.
**Consequence:** Ordering cannot be corrupted by a race, and a retry is explicit. Cost:
clients must wait rather than pipeline turns.

---

### D021 — Turn evidence stores metadata, never memory content

**Context:** Provenance must survive memory deletion, but duplicating memory text into
`turn_memories` would create a second copy of content the user asked to delete.
**Decision:** Persist only ranking metadata (score, evidence, type, scope, flags, character
count) with **no foreign key** on `memory_id`. Resolve the current memory at read time and
report `memory_available: false` when it is gone.
**Consequence:** An answer's provenance survives a purge; its content does not. The UI says
so explicitly.

---

### D022 — Context assembly has a documented priority order

**Context:** A prompt can exceed its budget in several places; silently trimming the user's
request is unacceptable.
**Decision:** Request and system instructions are never trimmed. Constraints and memories
are already bounded by retrieval. Correction history is dropped first, then oldest history.
If request + system exceed the budget, the turn fails with `context_overflow`.
**Consequence:** Behaviour under pressure is predictable and tested. Cost: a very long
request fails rather than being silently shortened.

---

### D023 — Progressive keyword relaxation plus porter stemming

**Context:** The first Phase 3 demo question ("what game, which engine, what platform")
retrieved **nothing**, because FTS5 `AND` required every token and no single memory had all
of them. A long question also spent its entire 12-token budget on stopwords.
**Decision:** Filter stopwords before the token cap; try precise `AND`, relax to `OR` when
fewer than three candidates are found, and fall back to recent active memories when nothing
matches. Rebuild the FTS index with the porter tokenizer. Report the chosen strategy as
`query_mode`.
**Consequence:** Multi-part and inflected questions work. The fallback can surface recent
but tangential memories, which the evidence string reports as "no keyword match". Two of 22
evaluation questions still fail on genuine vocabulary gaps (documented, not hidden).

---

### D024 — Automatic memory capture only proposes

**Context:** Silently storing every message would pollute memory and let model phrasing
become "fact".
**Decision:** Only explicit user instructions ("remember …", "remember these …") store
memory, with the session as provenance. Extraction produces candidates returned to the UI
for confirmation. `MEMORY_AUTO_CAPTURE=off` disables even that.
**Consequence:** Demo A/B work deterministically; nothing is captured from assistant output.

---

### D025 — Correction history is a labelled section, not stale retrieval

**Context:** Demo B asks "did that change?" — which requires the previous value without
injecting superseded records into ordinary active retrieval.
**Decision:** After retrieval, the assembler follows the *active* memory's supersession
edges and renders replaced records in `<recent_corrections>` with an explicit "historical,
not current facts" warning. Superseded records never enter the active candidate set.
**Consequence:** The model can explain a change while ordinary retrieval stays clean.

---

### D026 — SSE with a JSON fallback, and a hijacked socket

**Context:** Streaming is required, but tests and simple clients need a single response.
**Decision:** `Accept: text/event-stream` streams `retrieval`/`delta`/`usage`/`completed`/
`error`; any other Accept runs the same turn and returns one `TurnResult`. The SSE path
hijacks Fastify's reply, aborts the provider on client disconnect, and persists partial
output as `interrupted`.
**Consequence:** One turn implementation, two transports, and no misleading "complete"
message after a cancellation.
