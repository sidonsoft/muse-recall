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

> **Note on numbering:** D027 was never used — the number was skipped during
> an early renumbering, and no decision exists under it. The zero-references
> claim below was overstated: two meta-references exist (this note itself and
> the cadence register's "documented skip" mention); zero references treat D027
> as if a decision existed under it. Corrected 31 Oct by the reference census
> that flagged its own
> instrument's imprecision (the audit line beneath it said "54 defined, 54
> referenced" — also stale: 55 decisions are defined, and the fresh census
> finds every D0NN reference in the audited docs resolving to a defined
> decision; zero dangling, with D027 the single documented skip).

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
**[Amended for the local beta (D058): the phrase "the operator's
confirmation" overstated the flag. `--allow-writes` authorizes every write
for the process lifetime at startup; MCP performs no per-write review.
Descriptions, the contract resource, tests and README now say exactly
that — see D058.]**

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

---

### D045 — Groundwork, not theatre: an optional shared bearer token

**Context:** Gap G-6: the loopback bind IS the security boundary, and roadmap §5
lists authentication/quota/credential controls as remote-deployment
prerequisites. Building a full identity system now would be speculative;
shipping nothing leaves the loopback assumption untestable in deployment.
**Decision:** Add ONE optional credential: `ACCESS_TOKEN` (≥16 chars).
Unset — the default — leaves the single-user beta bit-for-bit untouched (no
header, no friction). Set — every `/api` route except `GET /api/health`
requires `Authorization: Bearer`, compared over SHA-256 digests with
`timingSafeEqual`; the check runs BEFORE the origin guard (401 before 403);
the Host-name check relaxes only in token mode (rebinding can deliver a
request but cannot attach the secret); a non-loopback `HOST` becomes
configurable and the post-bind re-check logs a warning naming the exposed
addresses. `/api/meta` reports `safety.authentication` so the posture is
introspectable, not inferred.
**Consequence:** This is authentication WITHOUT identity: one secret = one
operator. The docs say so; the meta field says so; anything beyond
(shared-secret rotation UI, per-project authorization, quotas) stays open in
G-6 rather than being implied by a green "auth enabled" flag.

---

### D046 — Forge persists the model id the CLI reports, never the one we asked for

**Context:** The meta field `forge.observed_model` was hardcoded `null`: honest,
but the CLI protocol already carries `run.model.configured` (verified in
muse-integration.md) and the chat adapter has always reported it. Gap in
honest telemetry, not capability (P1#6 remainder).
**Decision:** Forge jobs record `model_observed` from `run.model.configured`
frames (validated string, ≤128 chars, last frame wins so a fallback attempt's
identity replaces the primary's). `/api/meta` exposes the most recent observed
id; the Studio generation strip shows `reported model <id>` beside the
existing `(configured)` label. Runs that never reach a model (auth, network,
quota-before-run) keep `null` — absence of observation is recorded as
absence, not guessed.
**Consequence:** Configured and observed identity are distinct, visible
concepts; a CLI-side default fallback (the verified `--model does-not-exist`
behaviour) becomes visible in job records instead of being papered over. The
fake CLI echoes `--model`, so the browser workflow can pin the full path:
frame → job record → meta → UI (check #46).

---

### D047 — The adversarial suite pins the guard LAYERING, not just each guard

**Context:** host, origin and token guards each had their own tests, but roadmap
§5 makes an adversarial suite a release criterion for remote access: the danger
is in the composition (which layer refuses first, and whether satisfying one
layer skips another).
**Decision:** a standing CI suite attacks the composed surface and pins the
contract: onRequest order is host guard → authentication → origin guard; a valid
bearer never overrides the host check and never acts as CSRF clearance; the
health exemption is path-exact and never widens under case/slash/method tricks;
Authorization parsing is exact-match over digests, so shape games (case,
spacing, appends, percent-lookalikes, wire-joined duplicates) are refusals, not
parsing quirks; response bodies never echo the secret. The D045 posture (token
mode accepts arbitrary Host names ONLY with the secret and the exact configured
port) is asserted directly so dropping either half fails CI.
**Consequence:** two behaviors that looked like bypasses in test review are
documented as design: `..` segments are normalized to the SAME exempt route
before hooks see the URL (no hidden second health endpoint), and percent-
encoding in headers is not decoded (headers are not URLs). Future guard work
must keep these invariants or this suite goes red.

---

### D048 — The error catalogue mirrors reality, asymmetries included, and is drift-gated

**Context:** roadmap §3 listed "machine-readable error catalogue" as open. Codes
already existed in error classes, but the taxonomy lived only in prose and four
scattered mappings; integrators had no discovery endpoint, and two real
asymmeties (generic-handler 400 for `memory_storage_failed`; Forge zod errors
reported as `invalid_request` instead of `validation_failed`) would have been
silently "smoothed over" by an aspirational catalogue.
**Decision:** `GET /api/errors` publishes `API_ERROR_CATALOG` (shared,
`catalog_version: 1`, five groups) generated from the CURRENT mappings, with
the asymmetries written into their `when` text as known open work. Tests probe
live responses and assert each code's status equals the published entry. The
sessions list `total` is fixed from page-length to `COUNT(*)` in the same
change, so list envelopes agree (`items/total/limit/offset`).
**Consequence:** fixing either asymmetry is a deliberate catalogue edit — code,
catalogue and tests move in one PR or CI goes red. Discovery is self-service
via `/api/meta.errors`; no docs can silently diverge from the wire format.

---

### D049 — Idempotency keys where a retry costs money; locks where it does not

**Context:** roadmap §3's last open remainder. A network-timeout retry of
Forge generation double-spends model quota; a retried memory create double-writes.
Sessions already serialize (409 `session_busy`); proposals already dedup by
content hash. Bolting keys onto everything would add state for no benefit.
**Decision:** `Idempotency-Key` (single 8-128-char header) on
`POST /api/memories` and Forge generate only. Replay records: SQLite table
(schema v8) keyed by `METHOD + concrete path + key`, 24h TTL purged lazily,
first-wins semantics (a diverged body under a used key replays the original
response), durable across restarts, and excluded from the export envelope —
a replay window must not survive a data restore as a hidden side effect.
Comma-joined duplicate headers are refused as ambiguous, mirroring the
adversarial suite's wire-modeling. In-flight de-dup is in-process (409
`idempotency_in_progress`) and the catalogue says so; there is no cross-process
claim in the single-server beta.
**Consequence:** retried clients are safe exactly where retries were costly;
the remaining routes' protections are named explicitly instead of implied.
When multi-process deployment arrives, the in-process Set is the component
that must be replaced — the table already survives restarts.

---

### D050 — Alert SIGNALS live in /api/health; alert DELIVERY stays an external component

**Context:** roadmap §8 demands alerting and G4 gates "operational beta" on
working alerts. Building notification into the server would invent secrets
(webhooks), threads, and failure modes far beyond the local-beta scope — but
with nothing machine-readable, a prober could only grep prose.
**Decision:** publish named states inside `GET /api/health` —
`alerts.backup` (freshness of next-to-DB `db:backup` snapshots by NAME stamp,
threshold `ALERT_BACKUP_MAX_AGE_HOURS`, `disabled` for `:memory:` or 0),
`alerts.storage`, `alerts.provider` — and explicitly keep consumption
external (cron/curl/monitor). `alerts` never flips the top-level `status`:
liveness is the server-alive verdict, backup staleness is a data-safety
signal; conflating them makes monitors misfire during disk incidents.
**Consequence:** the runbook's DR section gained a one-command freshness check;
G4's "working alerts" gate is now narrowed to "wire a consumer to these
states" rather than undefined. Health stays open (no token) so the block must
stay secret-free: ages, counts and states only — never paths or values.

---

### D051 — The alert prober is a dumb pipe: named findings plus an exit code, never paging

**Context:** D050 shipped states; G4 still lacked a consumer. Any in-server
pager would need webhook secrets and new failure domains; any "smart" prober
that dials numbers invents the same problems in a script.
**Decision:** `pnpm ops:alert-prober [base-url]` evaluates the health payload
into `ALERT component=state: detail` lines and a cron contract:
0 = all states acceptable; 1 = findings (degraded, backup stale/missing,
storage issues, provider error); 2 = unreachable, non-health response, or
server-reported error (an outage or a broken prober — both need a human).
Delivery is whatever cron already does (MAILTO, forwarder, monitor hooks).
Version skew is a first-class state: a server without `alerts` yields
`alerts=absent`, exit 1 — a stale deployment is itself a finding.
**Consequence:** G4's remaining work is operational (install the cron, wire a
waker), not engineering. Live smoke proven on a fresh file DB: exit 1
`backup=missing`; after one `db:backup`, exit 0 `ALERT none`.

---

### D052 — Graph and timeline come as a data surface first; the UI consumes, never re-derives

**Context:** gap G-9's remainder named relationship-graph and timeline VIEWS.
Jumping straight to a canvas UI means inventing the data shape under time
pressure in the wrong layer; the supersession edges (`memory_supersessions`,
timestamped since v1) already ARE the timeline — nobody was exposing them.
**Decision:** `GET /api/memories/graph` (+ optional `project_id`, `limit`≤2000):
excerpt nodes (140 chars, never full records), edges between kept nodes only,
merged `events` (created/corrected) capped at 200, honest `truncated` flag.
Scoping mirrors list() exactly (project + global). Deleted memories are
unreachable through the graph — a graph walk must never resurrect purged
data. Events and edges derive from the SAME rows the detail view shows, so
timeline and inspector can never disagree.
**Consequence:** any future canvas/timeline view is a pure client over one
bounded endpoint; the 46-check browser workflow need not touch it yet. G-9
stays Partial until a visual view exists — now with the risky half (shape +
honesty invariants) settled and test-gated.

**Follow-up (same day):** the endpoint proved its shape by being trivial to
consume — `TimelinePanel` in the Memory view renders created/corrected
events read-only, and the browser workflow grew its first cross-view check
(nav → Memory timeline lists the just-saved decision), 46→47 checks.
**Second follow-up:** `RelationshipMapPanel` adds the SVG canvas — union-find
chain grouping, oldest-left arrows, accented current claims, and a TEXT
fallback list so the information is never visual-only; still zero server-side
layout code. Browser checks 47→48, and G-9's remainder is now CLOSED.

---

### D053 — Contract version bumps on additions too: a stamped version must reveal capability shifts

**Context:** `memory.graph` (D052) is additive — old tools keep identity and
semantics — and the contract-version doc said "bump only on breaking
changes". But an MCP client that snapshots the tool set gets a silent
capability change with an unchanged stamp; "breaking-only" made the version
useless to exactly the consumers it exists for.
**Decision:** `TOOL_CONTRACT_VERSION` 1 → 2 on this addition; doc updated so
the version bumps on breaking OR additive changes. One registry remains the
single source for REST, session runtime, and MCP; conformance tests pin all
three surfaces (and now execute `memory_graph` over MCP end to end).
**Consequence:** clients can branch on the stamped version instead of
probing tool lists; future removals/renames still need the same bump, which
is fine — the stamp is a capability signal, not a compatibility promise.

---

### D054 — Catalogue v2: both pinned asymmetries fixed; storage failures answer 5xx under a stable code

**Context:** D048 deliberately published two wrong-but-known mappings
(storage failures on a generic 400; Forge schema failures as `invalid_request`)
so clients could code against reality, with "fix moves the entry" recorded in
the entry text itself. The fix round arrived; the promise had to be honoured
in lockstep.
**Decision:** (1) The engine's `transaction()` now wraps any failure BELOW the
domain layer — including `BEGIN` itself, so a connection that dies between
startup and the write cannot slip past unlabelled — as `memory_storage_failed`
with only the failure CLASS NAME on the wire, the original error chained as
`cause` for debugging. `DryRunAbort` (engine-internal control flow) passes
through untouched. HTTP maps it to 500. (2) Forge zod failures now emit
`validation_failed` with the central handler's exact `{details:[{path,
message}]}` shape; `invalid_request` no longer occurs on that surface.
Catalogue version 1 → 2 (breaking for clients that pinned the old shapes —
exactly what a version is for). Live probes: the drift gate now kills a
connection under a live app and asserts 500 + code + entry-status parity;
forge tests assert the detail shape.
**Consequence:** clients get honest status semantics (5xx means OUR storage
hurt, 4xx means YOUR request); driver internals never cross the wire; the
rollback-under-failure invariant re-verified through a forced trigger (state
fully rolled back, cause text preserved only in the chain).

---

### D055 — The demo seed pins its engine clock: identical rows AND audit stamps on every seed

**Context:** `DEMO_SEED_TIMESTAMP` pinned one project-row field while the
memory engine used the real clock — memory rows and supersession audit
stamps said "whenever the judge ran demo:seed," not the recorded demo time.
The claim "the seeded demo renders identically" was only mostly true. A new
regression test (seed → engine.graph) surfaced it by asserting the edge
stamp and getting the run-time value instead.
**Decision:** `seedForgeDemo` constructs its engine with
`now: () => new Date(DEMO_SEED_TIMESTAMP)` — content, row fields, history
entries, and supersession edges are now bit-identical across seed runs.
Wire-verified on the judge path: fresh DATABASE_PATH → `pnpm demo:seed` →
live server → `GET /api/memories/graph?project_id=forge-demo` → 3 nodes,
one edge stamped exactly `2026-10-27T00:00:00.000Z`, 4 events, not
truncated. A second seed run creates nothing and cannot re-chain the
edges (idempotence also now pinned by tests).
**Consequence:** the judge demo's timeline/map story is reproducible on any
machine at any time; the demo data feeding D052's surfaces has its own
end-to-end regression beyond the browser workflow.

---

### D056 — Pre-judging cadence: guard, witness, consolidate; add nothing new

**Context:** With the submission due 4 Nov 2026 and judging 4–8 Nov, the
weeks after PR #29 left a gap: real work was possible on `integration`,
while `main`, the frozen tags, evidence/submission/demo docs and the
website could not be touched. The earliest audits of that period kept
finding the same class of gap: comments and schema constraints that READ
like specs but had no adversarial test (rollback masking, cascade trust,
name-vs-mtime freshness, closed-set allowlists, "transient" TTLs never
aged, "re-validated on read" never corrupted). Meanwhile doc claims aged
against code in both directions — overstated and, just as bad,
understated (issues outliving fixes, benchmark blocks quoting stale runs).
**Decision:** until judging closes, `integration` work is limited to three
shapes, each PR-scoped and green-CI-gated: (1) **guards** — convert
promise comments into enforced tests (never change behavior to pass);
(2) **witnesses** — re-run operator-facing claims (demo seed, MCP stdio,
SSE+token, alert chain, opt-in live suite, quickstart on both branches
and in dev mode) at head, recording dated evidence lines; (3)
**consolidations** — ledgers and maps (invariant guard ledger §7,
re-witness rotation map, freeze sentinel, bench-artifact policy). No
schema migrations, no contract bumps, no new surfaces, no behavior
changes unless a judge-visible defect demands one; parked observations
get evaluated into the post-judging queue instead of acted on (the
dead `'purged'` enum, the 2-vs-3 required-checks asymmetry, the G-6
identity work). Docs claim only what was RUN — and the doctrine applies
to the auditor too: three self-corrections shipped (#77 sha256sum,
#100 values_json assumption, #113 API field name) plus one caught
self-inflicted doc mangling (#91→#92).
**Consequence:** ~50 scoped PRs later: `main` and the tags verified
untouched on every merge, 15 guard rows with adversarial witnesses,
every operator-facing claim fresh at head, planning docs cross-checked
against artifacts and each other, and a post-judging queue whose entries
carry evaluations rather than mysteries. The repo enters judging week
with its evidence fresh, its freeze double-observed, and its known gaps
named instead of discovered.

---

### D057 — Beta-prep override: beta 0.1 work executes early on `integration` only

**Context:** The beta review (31 Oct) reproduced a destructive restore
failure and confirmed three queued contract/policy gaps (KI-43/45/48, the
MCP write-policy mismatch, KI-49's broken wrapper recipe). The owner
directed that the beta 0.1 preparation happen NOW, while D056's pre-
judging rules said contract bumps and behavior changes wait until the
judging window closes (4–8 Nov).
**Decision:** Owner override, scoped hard: beta fixes land on
`integration` ONLY. The judge-facing surface stays exactly as D056 left
it — `main` @ c32d03b, the `submission-*` tag and its Release, evidence
docs, and the website are untouched; promotion to `main` remains
post-judging per the CONTRIBUTING exception. No beta branch/tag/publish
until the owner asks. Under this override ship: (1) the restore safety
rewrite (destructive on both reproduced paths — a local-beta data-loss
bug, the one shape D056 itself allowed: a defect demands a fix);
(2) catalogue v3 lockstep (KI-43 + KI-45 + KI-48 + the sixth live-found
`invalid_submission`); (3) MCP write-policy honesty (startup
authorization stated as such; no per-write-review claims);
(4) the staging-aware Forge worker-wrapper boot probe (KI-49's probe now
exercises real staging writes/prompt reads; unusable setpriv recipe
removed; ACL support stays queued as C-13).
**Consequence:** The queued post-judging items B4 and parts of P0 #4
execute early, with dates and the override recorded at each home doc.
Judges, the frozen tree, and the promotion rule are unaffected; the
beta-cut decision remains an explicit later owner act.

---

### D058 — MCP write policy stated as startup authorization; no per-write-review claims

**Context:** The beta review caught a three-way mismatch: the shared tool
descriptions said write tools "Require user approval", the README said a
model "cannot self-confirm a write" (implying a per-write review flow that
MCP does not have), while `--allow-writes` actually executes every write
immediately (headless MCP has no interactive channel — D043's own
constraint). Clients reading the advertised descriptions would believe a
safety property the endpoint does not provide.
**Decision:** Keep the behavior (startup authorization; read-only default
stays the strongest posture), and make every surface state the ONE truth:
write-class tools carry no approval sentence in the shared description
(the write class is machine-visible via `side_effect`); each write tool's
MCP description additionally advertises THIS surface's policy (executes
immediately under the startup switch / refuses by default); the
contract resource gains `write_execution` and `per_write_review: false`;
MCP_INSTRUCTIONS and the refusal text say startup-authorization,
no-per-write-review; README says `--allow-writes` authorizes every write
for the process lifetime and per-write review, if wanted, belongs to the
client. D043 gets an amendment line rather than a rewritten body.
**Conformance:** mcp-contract pins both description shapes per policy, the
contract fields (default and enabled), and the refusal text; write
execution still refuses without the flag and persists with it. The
session runtime's per-write approval flow is untouched — that surface
keeps the property honestly, and `requiresConfirmation`'s doc now names
which surface enforces what.

---

### D059 — HTML Studio carries its own copy of the game engine

**Context:** KI-53 measured that a generated game fetched its engine from
`https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js`, and that when
that one request failed the artifact was refused while the Studio preview showed
a blank frame with no explanation. The app is otherwise self-hosted with no
outbound dependency, so availability, reproducibility and the meaning of
"local" all came down to one third party answering a request. An offline or
air-gapped machine could not approve any game at all, and an artifact approved
today could stop working tomorrow without its bytes changing.
**Decision:** Vendor the engine. One pinned copy — Phaser 3.80.1, the version the
prompt already named — 1 181 917 bytes, sha256 `62081f6a1b51d040473f919ffedef9009953c20833518e146da5a8d1c9405ea8`,
committed as a generated module with the MIT licence text inside it and a script
(`pnpm run vendor:phaser`) that re-fetches and refuses to write if the hash or length moved;
`-- --check` verifies the committed copy against the pin with no network, and
`-- --against-remote` asks the pinned URL whether it still serves those bytes and writes
nothing either way. The document is stored in its **source** form, with the one
`<script src="…jsdelivr…phaser@3.80.1…">` tag, and the engine is inlined at the
moment the bytes are handed to anything that runs them: preview, diff,
validation, runtime verification, and promotion. The model is told about the
substitution, is given the short source view when asked to modify an artifact,
and is not allowed to inline its own copy of the engine.
**Conformance:** `verify:runtime` runs both policies in a real browser: a game
that carries the vendored engine boots with **no remote origin granted at all**
(8 checks; `test-results/runtime/`), a game that still needs the CDN keeps the
old allowlist, and a Phaser version this product does not vendor keeps its
reference and is reported as a named gap rather than silently re-pointed at the
pinned copy. `tests/unit/forge-vendored-scripts.test.ts` pins that a forged
vendor marker buys no exemption (verification goes to the bytes), that a
`defer`/`integrity`/`async` tag is never rewritten, that the source view round
trips byte-for-byte, and that the vendored block cannot be used to smuggle code
past the inline-script budget. Promotion records which library and version each
version carries. Research fixtures are **not** regenerated: the Phase 16/17
protocol bytes depend on prompt and artifact hashes, so those prompts keep their
own frozen text and the production prompt is separated from it.
**Cost, measured here:** each game artifact grows by ~1.18 MB on disk and in the
database; a full runtime verification takes 1.6–2.0 s either way on this machine,
where the CDN is reachable and cached, so inlining is within ~0.2 s of fetching.
Artifacts approved before this change are not rewritten, and the CDN stays
allowlisted for documents that still reference it.

---

### D060 — What the first human-review round keeps, clarifies, and leaves unproven

**Context:** the first Muse-built app handed to a human reviewer (Palette Bench,
`test-results/human-review/palette-bench-2026-11-02-2250`) came with four seeded
project decisions, an open question about the vision-draft path, the KI-53
dependency question and the single-server idempotency limit.
**Decision:** keep all four seeded decisions — no modal dialogs (report results in
inline status text), body text at 4.5:1 or better, one accent colour per screen,
and every destructive action undoable from the same screen — with one
clarification: **the accent rule governs interface chrome, not the colours a
generated artifact is asked to produce**. A palette tool is the clearest case: an
app that follows the rule literally cannot show the palette it was built to show.
The vision-draft path stays **experimental**: it works and is accounted for
(1 paid vision call, replay free), but nothing yet shows it beats asking the
coding model directly, so it stays out of the documented main path until there is
evidence of incremental value. Multi-server idempotency is **documented, not
built**: the key store is in-process, which is sound for the single-server beta
the app is designed around and unsound for a horizontally scaled deployment;
the limit ships in the limitations guide and in the review payload. KI-53 goes the
other way and is closed by D059.
**Conformance:** the seeded decision text in the retained Palette Bench packet is
the exact text that was paid for and is not rewritten; the clarification is the
wording to use in the **next** brief, and `docs/review-apps/README.md` says so.
The vision-draft boundary is pinned by the Batch E route tests (advisory, no
write, revision-pinned, one paid call, replay revalidates its subject). The
idempotency limit is pinned by the limitation text in `docs/guide/limitations.md`
and `docs/guide/reviews`-style payloads, not by code.

---

### D061 — Dependency disclosure at approval, and the engine pin stays a human decision

**Context:** KI-53 made the product carry its own copy of one pinned Phaser build
(D059) and refuse, deliberately, to rewrite any other remote reference. That left
a person approving an artifact unable to tell three situations apart: a library the
product bundles, a library the application will fetch from a remote host when it
runs, and a remote host verification refuses so the dependency never arrived during
the check that passed. The facts were recorded server-side (`vendor_gaps`,
`network_policy`, `x-forge-vendor-gaps`) and no surface a person read showed them.
**Decision:** the approval interface states the dependency situation, measured from
**the exact bytes promotion would write** — the staged file after the vendoring
pass, media-resolved at approval — and not from the source view the diff shows or
from the model's own claims. Every dependency is classified `bundled`, `fetched` or
`blocked`, each with a machine-readable reason, and the interface renders one
approved sentence per case; for a remote engine that sentence names the host, says
what approving assumes, and says what the alternative is. A version approved before
the record existed is reported as **no record**, never reconstructed from its file,
and no historical artifact is rewritten to complete the panel. The product still
substitutes nothing: a Phaser version outside the pin keeps its reference and is
named with the version it asked for and the pin carried. The block renders no
verdict — whether a remote dependency is acceptable is the reviewer's decision.
**Pin policy:** changing the engine pin requires an explicit human act. There is no
automatic refresh anywhere — not at runtime, not in CI, not on a mismatch.
`pnpm run vendor:phaser -- --check` verifies the committed copy against the pin with
no network, and `-- --against-remote` asks the pinned URL whether it still serves
those bytes and **writes nothing either way**; a mismatch is information for a
decision, not a trigger to overwrite a hashed production input. Re-pinning means
re-running the vendoring, validation and browser gates, because the copy is a hashed
input to the server bundle.
**Conformance:** `tests/unit/forge-dependency-disclosure.test.ts` pins the three
classifications, the "measured from promoted bytes" property (the disclosure's
`html_sha256` equals the hash promotion is fenced by) and the "not recorded"
behaviour without mutation; `tests/unit/forge-dependency-view.test.ts` pins the
sentences; `tests/unit/forge-dependency-panel.test.ts` pins that the three kinds
render apart and that reference text from a generated document is escaped;
`verify:runtime` cross-checks the disclosed `blocked` origins against the origins the
real browser refused, in both directions, and that a permitted load is never
disclosed as blocked; `verify:studio-workflow` shows the block in production Studio
and checks that the approved version's record hashes to its own artifact. The pin
modes are pinned by `tests/unit/release-command-inventory.test.ts`.

---

### D062 — An artifact may not claim the product's own framing, and a static scan states what it cannot see

**Context.** The fourth independent review attacked the invariants of D059 (carry the
engine) and D061 (disclose what the bytes fetch) rather than the tests written for
them, and found seven reproducible defects (KI-76 to KI-82). Two were not bugs in the
usual sense but decisions the implementation had made implicitly: the source view
collapses text between vendor delimiters, and a scan that finds nothing prints an
empty list. Both turned a *representation* into an *assurance*.

**Decision.**
1. **Vendor delimiters are a format this product writes, never a claim an artifact
   makes.** `unvendorScripts` collapses only the exact span `vendorScripts` itself
   produces, and `vendorMarkerTextIssues` refuses `forge-vendor:` text in staged
   source. Consequence, accepted deliberately: a model can no longer write anything
   resembling the product's framing, and a document that tries is refused rather than
   partially shown. The alternative — trusting author-written markers because an
   integrity check would catch abuse later — was rejected: the check never ran against
   the source view, and a reviewer cannot weigh what the diff hides. Measured before
   the fix: 162 shipped bytes, 30-byte review view, payload executed.
2. **A replacement is only allowed when it provably preserves the document.** An
   engine tag is swapped only if it has exactly one `src` attribute, no other
   attributes and no body. Otherwise the reference stays exactly as written and is
   named. Consequence: more documents keep a remote engine than a permissive swap
   would leave, and more gaps are reported — accepted, because silently deleting an
   `onload` handler changes behaviour nobody approved, and because D061 already decided
   the product swaps nothing silently. Both refused forms were run in a real browser
   and still load and render.
3. **One reading of a document.** The verification browser, the preview CSP and the
   approval-panel disclosure answer "what do these bytes reference" from one parsing
   module, including unquoted attributes and case-insensitive closing tags. The grant
   follows the served bytes rather than a constant, so a self-contained document is
   granted no remote origin in the iframe too. Accepted trade-off: the grant is per
   origin rather than per directive, matching the browser; splitting it per directive
   would add a fourth reading, and the defect was always too many readings.
4. **A measurement states its own limits.** Dependency rows carry `basis`
   (`document_reference` versus `code_text`) and `observed` (was a refusal actually
   recorded against these bytes), and every disclosure carries `scan_limits`. The panel
   renders those limits always, including for records written before the field existed.
   Consequence: sentences get longer and less certain — "no remote reference was found"
   replaces "fetches nothing outside themselves". Accepted: a comment naming a `fetch`
   call had been presented as a request the policy refused, and a URL built at run time
   produced an empty list that read as a guarantee.
5. **Ledger parsing is a contract, not a convenience.** Every `[media-trace]` token is
   validated whole against the format the adapter writes; prefix matching is refused,
   because these bytes are what paid-call claims are read from. Damage is checked
   before any mode-specific claim, so "zero dispatches" can only be stated about a log
   the gate can read.

**Conformance:** `tests/unit/forge-vendored-scripts.test.ts`,
`tests/unit/forge-workspace.test.ts`, `tests/unit/forge-preview-policy-agreement.test.ts`,
`tests/unit/forge-sandbox-policy.test.ts`, `tests/unit/forge-dependency-disclosure.test.ts`,
`tests/unit/forge-dependency-view.test.ts`, `tests/unit/forge-dependency-panel.test.ts`,
`tests/unit/media-trace-damage.test.ts`, `tests/unit/media-journey-policy.test.ts`;
`verify:runtime` PASS 14 checks at `test-results/runtime/20261103-0658/report.json`,
including three new measured cases (tag forms that cannot be swapped, uppercase closing
tag, forged marker).
