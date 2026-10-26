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
