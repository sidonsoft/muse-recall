# Architecture

Muse Recall is a local-first monorepo with a React web client, a Fastify API, a SQLite-backed memory
engine, and a filesystem-backed job runner for HTML Studio. There is no hosted component. The
architecture is shaped by four constraints: memory must be correctable, generated code must be
reviewable before it is current, retrieval must be explainable, and the local beta must not overstate
its safety.

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)

## Runtime at a glance

```
Browser (apps/web)
  React 19 · Vite 7 · Tailwind 4 · typed fetch client
  every response re-validated with shared Zod schemas
        │  JSON over /api (Vite proxy in development)
        ▼
Fastify API (apps/server)
  config · routes · envelope · error mapping · SSE
  host guard · origin guard · provider health
  ├── packages/agent-core        sessions, turn lifecycle, bounded context, capture
  ├── packages/memory-engine     SQLite · migrations · retrieval · prompt blocks
  ├── packages/tool-runtime      typed tool registry · validation · audit
  ├── packages/ui-protocol       closed declarative-UI schema · renderer data
  ├── packages/decision-guard    pure advisory source-pattern engine
  ├── packages/muse-provider     ModelProvider → `muse exec --json`
  ├── packages/mcp-server        stdio MCP front (seven tools) over the SAME
  │                              registry the web API serves
  └── packages/shared            Zod contracts + domain types
        │
        ├── SQLite file          memories, history, sessions, audit
        └── WORKSPACE_ROOT/forge jobs, staging, immutable versions
```

The web app never talks to a model vendor. It calls our API, which calls a `ModelProvider`. The
provider adapter is a stateless text protocol: one child process per call, with the harness owning
conversation state and every action passing through the permission layer.

## Packages and responsibilities

| Package / app | Responsibility |
| --- | --- |
| `apps/web` | Four surfaces: HTML Studio, Memory, Conversations, System. Typed client; no provider endpoint or API key in the browser. |
| `apps/server` | Fastify routes, configuration, health, origin/host guards, Forge job manager, runtime check, Guard adapter. |
| `packages/shared` | Zod schemas for memory, retrieval, sessions, tools, UI protocol, Forge and API envelopes. The same contracts validate writes and browser reads. |
| `packages/memory-engine` | `create`, `update`, `correct`, soft delete, retention, FTS5 retrieval, scoring, evidence, prompt rendering. |
| `packages/muse-provider` | `muse-cli` adapter and deterministic `echo` provider behind `ModelProvider`. |
| `packages/agent-core` | Sessions, turn processing, bounded history, memory capture, retrieval per turn, tool planning/execution. |
| `packages/tool-runtime` | Seven bounded project/memory tools (search, graph, create; project get/update; task create/list), input validation, approval for writes, append-only audit. |
| `packages/mcp-server` | stdio Model Context Protocol server exposing the same seven-tool registry to MCP clients - one shared contract, no second implementation (G-5). |
| `packages/ui-protocol` | Closed JSON schema for generated planning forms. A fixed React registry renders it; no model-authored JavaScript. |
| `packages/decision-guard` | Pure, dependency-free advisory engine over source text and active/superseded decisions. |
| `tests/` + `scripts/` | Unit/integration tests, deterministic fixtures, live probes, browser verification and research verifiers. |

## Processes and ports

| Process | Default | Notes |
| --- | --- | --- |
| Vite dev server | `127.0.0.1:5173` | Strict port; proxies `/api` to the API. |
| Fastify API | `127.0.0.1:8787` | Loopback only by default. |
| Chat provider child | one per call | `muse exec --json`; startup and streaming latency are per-call costs. |
| Forge provider child | one per job | Runs with the staging directory as cwd and a scrubbed environment. |
| Verification browser | one per approval/runtime check | Playwright-managed Chromium by default. |

`pnpm dev` starts the API and web together. `pnpm dev:server` and `pnpm dev:web` start one side.
The production web build is static; the server build is a standalone Fastify bundle. The repository
does not deploy either one, and there is no hosted URL.

## Data at rest

### SQLite

`node:sqlite` (built into Node ≥ 24) avoids a native build dependency. The schema is created by an
ordered, append-only migration list recorded in `schema_migrations`. WAL is enabled by default.

| Area | Tables |
| --- | --- |
| Memory | `projects`, `memories`, `memory_supersessions`, `memory_history`, `memory_fts` |
| Conversation | `sessions`, `messages`, `turn_memories` |
| Declarative UI | `ui_surfaces`, `ui_events` |
| Tools | `project_tasks`, `tool_calls` |
| Infrastructure | `schema_migrations` |

Memory writes use `BEGIN IMMEDIATE`, so deduplication, supersession and deletion cannot interleave
with another writer. Reads never expose deleted content. `memory_fts` is kept in sync by triggers;
soft delete removes the FTS row explicitly in the same transaction.

### Filesystem

```
WORKSPACE_ROOT/
  forge/
    <project-id>/
      state.json                 # current_version + immutable version ancestry
      jobs/<job-id>.json         # one complete job record per file
      staging/<job-id>/          # staged index.html and prompt.txt
      versions/<n>/index.html    # promoted, hash-checked version
```

Forge workspace paths are resolved and re-checked after `realpath`; symlinks and escapes are
rejected. Version files are written once and never rewritten. Job and state writes use a
same-directory temporary file plus atomic rename; terminal, approval and rejection records are
awaited. There is no `fsync`, so a sudden power loss is not a durability guarantee.

## Request paths

### A chat turn

1. Validate the session and its project scope; reject archived sessions.
2. Capture explicit memory instructions and candidates before retrieval so a just-stated fact can
   ground the same turn.
3. Persist the user message, assigning its sequence under `BEGIN IMMEDIATE`.
4. Retrieve active memory within the chat (default) budget and emit retrieval evidence.
5. Optionally plan tools; reads run immediately, writes become `pending` until a user decision.
6. Assemble a bounded prompt: system, constraints, memories, tool results, recent corrections,
   history, current request. Older history is dropped first; the current message is never truncated.
7. Stream the answer, persist it with usage and context statistics, record turn evidence, and finish.

### An HTML Studio job

1. Validate the project and concurrency, create a staging directory, retrieve project memory in the
   **forge** profile, and persist a `queued` job before spawning the model.
2. Spawn `muse` with the staging directory as cwd, `--workspace` rooted there, a shared allow-listed
   environment, and hermetic flags. Stream JSONL frames into bounded logs and usage.
3. Validate the staged file structurally and syntactically. Record an advisory Guard snapshot beside
   validation, never inside it.
4. Review the preview, source and diff. Nothing is promoted.
5. Approve under a project lock: verify the base version, snapshot the bytes, run the load-time
   browser check, then promote only if the promoted hash equals the checked hash.
6. Or reject (delete staging) / roll back (restore the recorded parent after a hash check).

### HTTP contract

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Route inputs
are parsed with shared Zod schemas; malformed JSON maps to `400`; stack traces are logged server-side,
not returned. Chat streaming uses SSE.

State-changing requests (`POST`, `PATCH`, `DELETE`) with an `Origin` must come from the request's own
origin or a configured `CORS_ORIGINS` entry. `Origin: null`, malformed and foreign origins receive
`403 forbidden_origin` before routing. Requests with no `Origin` and no cross-site fetch metadata are
treated as non-browser clients and remain subject to the Host guard. This is a browser-confusion
control, not authentication.

## Memory path

```
create ─► fingerprint ─► active record (idempotent on duplicate)
correct ─► one transaction: replacement + supersession edges
            + old rows 'superseded' + append history
retrieve ─► SQL hard filters → bm25 candidates + pinned types
            → weighted score → dedupe → reserve 2 pinned slots
            → rendered-budget selection → evidence + metadata
render ─► delimited, escaped, provenance-bearing data block
```

The memory engine is deliberately split into modules with no shared mutable state:
`engine.ts` writes, `retrieval.ts` reads and ranks, `context.ts` renders and accounts, `rows.ts`
maps rows to contracts, and `migrations.ts` owns schema history. This is what makes the retrieval
preview and benchmarks safe to run: they cannot write.

More detail: [Project memory](project-memory.md) and [memory design](../memory-design.md).

## Boundaries that matter

| Boundary | Why it exists |
| --- | --- |
| Provider is stateless text | The harness owns conversation state; retrieved text cannot execute a tool by itself. |
| Memory is data | Stored content is bounded, escaped, labelled as non-instruction, and carries provenance. |
| Declarative UI is data | The model emits validated JSON; a fixed registry renders it; no model JavaScript runs in the app origin. |
| Studio HTML is sandboxed | Generated HTML/JS runs only inside `<iframe sandbox="allow-scripts">` with an opaque origin and restrictive CSP. |
| Approval is exact-byte | Runtime verification and promotion share one snapshot hash, so a later rewrite cannot ride an earlier check. |
| Guard is separate | Advisory findings never enter `validation.ok` and never authorise or block promotion. |
| Writes require a human | Tool writes wait for an explicit decision; Forge promotion is a separate explicit approval. |
| Loopback only | The local beta has no authentication, rate limiting or per-user isolation. |

## Security posture

- **Single-user and loopback-only.** The API binds `127.0.0.1` by default. Do not expose it to a
  network; the Host and Origin guards are proportionate for one local user, not an authentication
  system.
- **Secrets stay server-side.** The browser has no provider code path. A configured `META_API_KEY`
  or Forge API key is delivered to the CLI over stdin, not argv or the inherited environment.
- **Child environment is scrubbed.** Forge and chat children receive an allow-list (home/PATH,
  locale, temp/XDG, proxy, certificate settings) and not `DATABASE_PATH`, `WORKSPACE_ROOT`, provider
  keys or executable-injection variables. The Forge child is still not OS-isolated; it runs as the
  server user under the CLI's own sandbox/approval flags.
- **Generated HTML is untrusted.** The server never evaluates it. Preview CSP blocks network except
  `cdn.jsdelivr.net`, blocks WebSockets, and uses `sandbox allow-scripts`. Export removes the sandbox.
- **Delete is final through the API.** A tombstone remains for integrity, but no read route returns
  deleted content.

The full threat model is in [security model](../security.md). The cross-origin fix and its
regression coverage are in [CROSS_ORIGIN_SECURITY_FIX.md](../release/CROSS_ORIGIN_SECURITY_FIX.md).

## Design trade-offs

| Choice | Consequence |
| --- | --- |
| SQLite + FTS5 keyword retrieval, no embeddings | No extra service and explainable scores; vocabulary gaps are a known limitation. |
| Synchronous single-writer SQLite | Simple, race-safe memory mutations; not a multi-user database. |
| Forge jobs as files, not SQLite rows | Durable and inspectable per job; single-process only, no cross-process lease. |
| One `index.html`, no build step | Sandboxable and portable; no multi-file projects, package installs or verified self-contained export. |
| Load-time browser check | Catches initialization errors and blocked network requests; does not test interactions or pixels. |
| Advisory source-pattern Guard | Transparent and dependency-free; narrow rule set, false results possible, human decides. |
| `ModelProvider` boundary with two providers | Clean test seam and offline mode; arbitrary providers are not implemented. |
| Loopback, no auth | Appropriate for a local single-user beta; not deployable as a public service. |

## Extension points (not shipped claims)

- A new `ModelProvider` implementation can sit behind the existing boundary, but only `muse-cli` and
  `echo` are shipped.
- Retrieval budgets, weights and named profiles are configurable values; adding a new named profile
  is a code change with contract tests, not a runtime plugin.
- The Guard's rule set is deliberately versioned (`GUARD_VERSION`); a new rule family is an engine
  change, not configuration.
- Embeddings, multi-file generation, authentication, hosted collaboration and interaction/pixel
  verification are out of scope for this release.

## Source map

| Concern | Source |
| --- | --- |
| Config, routes, guards | [`apps/server/src`](../../apps/server/src) |
| Forge runner and workspace | [`runner.ts`](../../apps/server/src/forge/runner.ts), [`workspace.ts`](../../apps/server/src/forge/workspace.ts) |
| Guard adapter | [`decision-guard.ts`](../../apps/server/src/forge/decision-guard.ts) |
| Memory engine | [`engine.ts`](../../packages/memory-engine/src/engine.ts), [`retrieval.ts`](../../packages/memory-engine/src/retrieval.ts), [`context.ts`](../../packages/memory-engine/src/context.ts) |
| Retrieval contracts and profiles | [`retrieval.ts`](../../packages/shared/src/retrieval.ts) |
| Forge contracts | [`forge.ts`](../../packages/shared/src/forge.ts) |
| Studio UI | [`apps/web/src/components/studio`](../../apps/web/src/components/studio) |
| Pure Guard engine | [`packages/decision-guard/src/index.ts`](../../packages/decision-guard/src/index.ts) |

## Related references

- [Architecture overview](../ARCHITECTURE_OVERVIEW.md) — the concise companion to this page
- [Memory design](../memory-design.md) — schema and retrieval invariants
- [Security model](../security.md) — threat model and residual risks
- [Local-beta hardening](../LOCAL_BETA_HARDENING.md) — durable jobs, recovery, managed browser
- [Known issues](../KNOWN_ISSUES.md) — granular constraints
- [Limitations](limitations.md) — the product-level summary

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
