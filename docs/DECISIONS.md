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

---

### D028 — Model output is a declarative spec, not markup

**Context:** Letting a model emit HTML or JavaScript would make every generated interface a
code-execution surface.
**Decision:** The model emits a closed, validated JSON document (blocks, fields, limits).
The browser renders it through a fixed registry; unknown block kinds fail validation.
**Consequence:** The worst case for a bad generation is a rejected request, not script
execution. Cost: the vocabulary is intentionally small.

---

### D029 — Generation is narrow on purpose

**Context:** The first real structured-output attempt failed: the Muse API's strict JSON
Schema requires every property in `required`, and our schema marked `submit_label` optional.
**Decision:** Make all schema properties required (optionals expressed as empty arrays or
strings), and scope generation to a planning form: Muse chooses fields and options, not
layout.
**Consequence:** Generation succeeded on the next attempt with context-appropriate fields.
Cost: richer surfaces must be composed from the registry rather than freely generated.

---

### D030 — Submissions are validated against the surface, then become a turn

**Context:** A client could post arbitrary values, fields, or option choices.
**Decision:** The server reloads the stored spec, rejects unknown fields, enforces required
fields, declared options, numeric bounds, and length limits, records the event, optionally
stores the submission as project memory, and then runs the agent with a structured summary.
**Consequence:** An interface cannot widen its own authority. The agent continues with
exactly the data the form declared.


---

### D031 — Tool choice is a separate, structured decision step

**Context:** The provider adapter is a stateless text protocol with no native tool calling.
Parsing tool calls out of streamed prose would be brittle and could mistake a quoted example
for a real invocation.
**Decision:** When tools are enabled, a bounded structured-output call returns
`{calls:[{tool, arguments_json}]}`. Arguments are parsed and validated against the chosen
tool's Zod schema. Only then does execution or approval happen; the answer is still streamed
normally afterwards.
**Consequence:** Tool calls are unambiguous and validated. Cost: one extra model call on
tool-enabled turns (~16.9k input tokens in the recorded run).

---

### D032 — Writes use a two-phase approval, not a paused stream

**Context:** Pausing an SSE stream mid-turn to wait for a click complicates cancellation,
timeouts, and reconnect logic.
**Decision:** A write call is persisted as `pending` and the turn completes with the model
told it has not run. The user approves or denies through
`POST /api/sessions/:id/tools/:callId/decision`; approval executes the tool and starts a
follow-up turn with the result. Denial records the decision and changes nothing.
**Consequence:** Approval survives a page reload and is trivially testable. Cost: an approval
costs a follow-up turn.

---

### D033 — Project scope comes from the session, never the model

**Context:** A model-supplied `project_id` would be a cross-project access path.
**Decision:** `ToolContext.projectId` is taken from the session. Tools either use it or fail
with "requires a project-scoped conversation"; no tool accepts a project id argument.
**Consequence:** Cross-project access is structurally impossible, not merely checked. A call
approved through a different session returns 404.

---

### D034 — The audit log records failures and refusals, not just successes

**Context:** An audit that only lists successful calls cannot answer whether the agent tried
something it should not have.
**Decision:** Every requested call is written before it runs with status
`pending|executed|failed|denied|invalid`, including unknown tools and malformed arguments.
Results are stored as JSON; no secret material is logged.
**Consequence:** The demo can be verified from the database, and a prompt-injection attempt
appears as a denied or pending call rather than disappearing.

---

### D035 — Atomic writes are fsynced before they are published

**Context:** Temp-file-plus-rename makes a reader see either the old or the new
record, but after a power loss a published rename can point at bytes that never
reached the device. Forge's promise is that acknowledged writes and approved
versions survive.
**Decision:** Every Forge atomic write fsyncs the temporary file before its
rename and syncs the containing directory after (`syncFile` strict,
`syncDirectory` best-effort with the tradeoff written in the code). Version
promotion also syncs the approved `index.html` before the version directory is
renamed in, so the state pointer can never name bytes that are not on disk.
**Consequence:** Acknowledged writes survive power loss, not just torn reads.
Cost: one fsync per persistence operation (visible in job throughput but small
at Studio scale); on platforms that refuse directory fsync the guarantee
degrades to "bytes durable, entry may be absent", which is documented rather
than hidden.

---

### D036 — Historical research prompts are frozen snapshots, not compatibility inputs

**Context:** The Phase 15A trial reconstructs recorded `prompt_sha256` values,
which kept a legacy raw-text memory input alive inside the production prompt
builder. The evaluation harnesses used that same raw path, so measured prompts
had already drifted from the structured rendering production actually sends.
**Decision:** Copy the builder at the freeze commit into
`scripts/lib/phase15a-prompt-snapshot.ts` with provenance recorded, pin it with
byte-fixture tests, and delete the raw input from the production builder.
Harnesses pass structured retrieval records from now on.
**Consequence:** Production has one memory path, so eval output measures what
the server sends. Cost: new prompt wording no longer applies retroactively to
Phase 15A evidence — that is intentional, the snapshot freezes it instead.

---

### D037 — Recovery has two read surfaces and one guarded repair action

**Context:** A damaged `state.json` made a project look empty and left operators
with no way to see or fix recovery state without host filesystem access.
**Decision:** Three deliberate surfaces: per-project Studio inspection
(`GET .../recovery/state`, never throws on damage), a store-wide read-only
summary embedded in `/api/health` for the System screen, and one guarded
action (`POST .../recovery/repair`) that refuses on valid state (`state_valid`,
409) and always archives the damaged bytes before rebuilding from surviving
approved versions. Acknowledgement and repair stay out of the System screen.
**Consequence:** Damage is visible at both scopes and repairable without a
shell. Cost: repair trusts surviving version bytes as the source of truth; the
archive keeps the disputed file inspectable, and the managed browser workflow
now exercises the whole corrupt-inspect-repair loop as a standing gate.

---

### D038 — `proposed` joins the lifecycle; records carry `revision` and `actor`

**Context:** Roadmap §6 requires an explicit record contract: candidates must
stay separate from established decisions, concurrent edits must fail loudly,
and every record must be attributable. Options were a separate proposal
table, or lifecycle states on the existing record.
**Decision:** One record table, widened lifecycle: `proposed` (never
retrieved, never in the default list), promoted to `active` by `accepted` or
tombstoned by `rejected` — both recorded as distinct audit actions. Every
record carries a monotonic `revision` (every in-place change bumps it) and a
record-level `actor` mirroring the latest audit entry. `PATCH` accepts an
optional `expected_revision`; a mismatch is `memory_conflict` (409) with the
current revision included. Migration v7 rebuilds `memories` under the new
CHECKs, snapshotting children first because dropping the parent fires their
CASCADE actions even with deferred constraints.
**Consequence:** Proposals share identity, history and supersession edges
with facts instead of living in a parallel store with weaker guarantees;
lost-update races become actionable conflicts. Cost: one table rebuild, and
every write path (create, update, correct, expire, delete, accept, reject)
must now maintain the counter — enforced by the contract test suite rather
than convention.

---

### D039 — Portable export/import is a database snapshot, not an API dump

**Context:** Roadmap §6 requires memory export/import "with schema versions
and round-trip checks" including provenance and relationships (gap G-4). The
API deliberately hides tombstones and merges audit trails into detail views;
reusing those shapes for portability would silently drop data.
**Decision:** A dedicated envelope (`muse-recall-memory-export`, format
version 1) that snapshots the whole memory domain: records in every status
including tombstones, verbatim history, supersession edges and project
anchors, each record carrying its `content_hash` so replay detection is
defined over the normalized fingerprint. Referential integrity is part of
the schema — exports self-check on the way out, imports refuse envelopes
whose history or edges point at records the envelope does not carry. An
import is one transaction that either lands completely or rolls back with
every clashing id reported; identical rows replay as no-ops; `dry_run`
answers the plan without writing. Records insert in supersession dependency
order because `superseded_by` references its replacement.
**Consequence:** Restores and migrations can be rehearsed with the same code
that ships them; a half-imported store cannot exist. Cost: the envelope is a
second contract to keep aligned with the record schema (versioned, and the
round-trip test fails loudly when it drifts).

---

### D040 — Second browser engine without renaming the required check

**Context:** Roadmap §7 (gap G-10) wants the managed browser workflow to run on a
second engine and to assert accessibility and interrupted-job behaviour. The
"Protect integration" ruleset requires checks by exact name, and the ruleset
itself is part of the judged repository surface.
**Decision:** Extend the existing `browser` job with a matrix: Chromium keeps the
historical name verbatim, Firefox joins as "Managed browser workflow (fake
provider · managed Firefox)". Engine choice stays an explicit env
(`FORGE_RUNTIME_BROWSER=firefox`); no automatic fallback. The interrupted-job
scenario is driven live (SIGKILL mid-generation, restart, UI notice, queue
recovers) instead of trusting the pre-seeded bookkeeping fixture alone.
**Consequence:** No ruleset edit was needed to introduce the second engine; the
new check can be promoted to required independently. The engine variable is
scoped to the driving script: the server's approval-gate runtime check keeps
its own managed-Chromium policy regardless of which engine drives the UI.
Cost: the macOS 27 host cannot run the bundled Firefox until Playwright 1.65
(upstream #42768), so the second engine is verified in CI only; a Firefox leg
failure now also blocks developer visibility of the gate even though only
Chromium is required.

---

### D041 — Rule-family breadth without weakening the abstention contract

**Context:** Gap G-7: Decision Guard's five families were palette-centric.
The obvious fix — pattern rules that always answer — would turn unprovable
cases into fake PASSes, breaking the engine's founding rule ("never PASS
because nothing matched").
**Decision:** Two families with opposite determinism. Autoplay-media BLOCKs
only on declared autoplay (attribute, property, setAttribute) and ABSTAINS on
bare `.play()` calls, because user-initiation is not statically decidable.
External-assets PASSes/BLOCKes deterministically on absolute references
(including protocol-relative `//`), with the known URL-assembled-from-parts
FN pinned in the corpus as ideal-UNVERIFIED rather than hidden. RULE_ORDER
appends the new ids; the historical five keep their order and version pins.
**Consequence:** v1.5.0: seven families. Corpus +22 cases (11 per rule, all
nine adversarial dimensions each): precision 1.0, zero false positives on
both; one honest FN recorded (G07) and one deliberate abstention (F03). The
advisory stance is unchanged — breadth never converts a finding into a block.

---

### D042 — Worker isolation is an operator seam, not a self-declared sandbox

**Context:** Gap G-2: the Forge child runs with the server user's OS permissions.
A hardcoded "sandbox" the application claims for itself would be theatre: the
only honest strong boundary is one the operator provisions (dedicated uid,
container) and the server cannot create it at runtime for an unprivileged
process.
**Decision:** Ship the code-side seam: `FORGE_WORKER_WRAPPER` names an
absolute executable that launches the CLI as `wrapper <cli> <args...>`.
Boot fails fast unless the wrapper passes a real pass-through probe
(`<wrapper> node -e 0`). argv is otherwise untouched; env scrubbing and
staging cwd semantics are unchanged. The Linux setpriv recipe (dedicated
`forge` uid, workspace-only mount) is documented in security.md.
**Consequence:** Isolation becomes deployable without inventing a fake claim:
the default local beta still runs unwrapped, and the wrapper path is visible
in the startup log. Cost: every child spawn now flows through one more
execve when configured; wrappers that mutate argv must be pass-through by
contract, enforced only by the probe (executes argv[0]), not by inspection.

---

### D043 — One tool contract, two transports; scope and writes bound at startup

**Context:** Gap G-5 wanted an MCP server plus a versioned shared contract.
The easy path — a second, hand-maintained tool list for MCP — was exactly the
drift roadmap §4 warned about. MCP also has no interactive approval surface,
which collides with the beta's two-phase write confirmation (D032).
**Decision:** The MCP server registers directly from
`createDefaultToolRegistry()`: tool list, descriptions, and JSON Schemas
(input AND output, via zod) all derive from the one registry; dotted ids map
to MCP-safe names (`memory.search` → `memory_search`) with the original id
kept as the tool title and in the contract. `TOOL_CONTRACT_VERSION` (shared)
is stamped into `GET /api/tools` and a `mcp-recall://contract` resource.
Because MCP calls are headless, the two properties the session enforces
interactively become startup bindings: `--project` fixes scope (never
model-supplied, same as D033) and `--allow-writes` is the operator's
confirmation; a model cannot self-confirm or retarget.
**Conformance:** integration tests connect a real MCP client over an
in-memory transport pair and pin: MCP list ≡ registry list, contract
resource ≡ version+scope+policy, reads round-trip with validated
structuredContent, writes refuse without the flag, invalid args error
loudly. A second test pins the REST surface's version stamp. Cost: the SDK
stays a thin transport layer (low-level request handlers, no zod coupling
into the SDK), which keeps zod-version drift out of the protocol surface.

---

### D044 — The review queue is derived, never a stored state machine

**Context:** Gap G-9 asks for explorer review-queue features. A stored
"needs review" flag would create a second lifecycle that can drift from
validation status and expiry — and a background sweep would have to maintain
it correctly across imports, corrections, and sweeps.
**Decision:** Queue membership is COMPUTED per request from the fields that
already exist: unverified or disputed validation status, or expiry at/inside
a caller-supplied horizon (default 7 days). Swept-out `expired` rows stay in
the queue (an expired claim is precisely a now-problem). Actions are ordinary
`PATCH /api/memories/:id` with the optimistic revision guard, so every triage
decision lands in the append-only audit history — the queue adds no new
mutation path and no new schema state.
**Consequence:** The queue can never disagree with the data; imports need no
queue bookkeeping. Cost: the queue query recomputes each load (trivial at
single-user scale — one indexed scan), and horizon semantics are deliberately
"as of the moment of the call", so a UI showing counts is a snapshot, not a
subscription.
