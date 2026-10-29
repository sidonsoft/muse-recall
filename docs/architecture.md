# Architecture

## Goals and constraints

1. **Local-first.** One `pnpm install`, one database file, no hosted services. The
   app must demo on a laptop with no network beyond the model call.
2. **Explainable.** Every retrieval and tool call must be attributable after the
   fact. Memory and UI specs are data, not code.
3. **Model-independent.** Meta Muse is the primary provider, but nothing in the
   harness, memory engine, or UI may depend on Muse specifics.
4. **No fake success.** Anything not implemented reports itself as such, in the API
   and in the interface.

## Processes and packages

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (apps/web)                                                  │
│  React 19 · Vite 7 · Tailwind 4 · typed fetch client                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  JSON over /api (same origin in dev via proxy)
┌───────────────────────────▼─────────────────────────────────────────┐
│ API (apps/server · Fastify 5)                                       │
│  config → routes → envelope · error mapping · provider health       │
└───────┬───────────────────────────────────────┬─────────────────────┘
        │                                       │
┌───────▼──────────────────┐        ┌───────────▼─────────────────────┐
│ packages/muse-provider   │        │ packages/memory-engine          │
│  ModelProvider interface │        │  node:sqlite · migrations · FTS5│
│  MuseCliProvider         │        │  probe · future retrieval       │
│  EchoProvider (offline)  │        └───────────┬─────────────────────┘
└──────────────────────────┘                    │
        │                                       │
        ▼                                       ▼
  `muse exec --json`                     SQLite file (data/*.db)
  (child process, per call)

packages/shared — Zod schemas consumed by all of the above and by the browser.
```

### Why these boundaries

| Boundary | Reason |
| --- | --- |
| Provider behind `ModelProvider` | Evaluation needs a deterministic provider; the app must survive a provider swap without touching UI or memory code. |
| Memory engine as its own package | Memory invariants (supersession, deletion, scope) need direct unit tests that never start a server. |
| Schemas in `shared` | The same Zod object validates a write, types the insert, and guards the browser's parse. Contract drift becomes a test failure, not a blank panel. |
| Web talks only to our API | No API key in the browser, no vendor endpoint in client code, one place to enforce authorization. |

## Request flows

### `GET /api/health`

1. Optionally trigger a provider probe (`?probe=live`), which is cached for 60 s in
   `ProviderHealthTracker` so a page refresh cannot burn quota.
2. `probeDatabase` opens a transaction, inserts a probe project, reads it back, and
   rolls back. A connection that opened but cannot write therefore reports
   `error` instead of `ok`.
3. Compose a `HealthResponse`, validate it against `HealthResponseSchema`, and send
   it inside the standard envelope.

Health is deliberately *observational*: the provider is only `verified` after a real
model call returns in this process.

### `POST /api/provider/generate`

A bounded test bench, not a chat: prompt ≤ 4,000 chars, requested output ≤ 1,024 tokens,
no memory, no tools. Because the Muse CLI has no output-token flag, the adapter enforces
the requested budget on the stream (~4 chars/token), terminates the child when the budget
is exceeded, and returns truncated text with `stop_reason: "max_tokens"`. It proves
browser → API → Muse in one request. Any failure maps to `503` with a stable error code
and generic text so "model unavailable" is distinguishable from "server bug" without
echoing provider internals or credentials.

### Errors

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message,
details? } }`. The error handler never returns a stack trace to the client, and
malformed JSON maps to `400` rather than a generic `500`.

## Memory engine layers

```
engine.ts      writes: create, update, correct (supersession), delete, retention
               every mutation in BEGIN IMMEDIATE
retrieval.ts   reads: SQL hard filters → weighted scoring → budgeted selection
context.ts     rendering: delimited prompt block + exact character/token accounting
rows.ts        row → contract mapping (validated against the shared schema)
migrations.ts  append-only schema history
```

Writes and reads are separate modules with no shared mutable state, which is what makes
the retrieval benchmark and the preview endpoint safe: they cannot change anything.
Correctness invariants live in `engine.ts` and are tested directly, not through HTTP.

## Persistence

`node:sqlite` (built into Node ≥ 24) instead of `better-sqlite3`:

- No native compilation, so `pnpm install` works on any machine at the hackathon.
- Ships with FTS5 and JSON1 — both verified on the reference machine
  (SQLite 3.53.4).
- Synchronous API, which suits a single-process local server and keeps the memory
  engine free of connection-pool complexity.

Migrations are an ordered, append-only array; each runs in its own transaction and
is recorded in `schema_migrations`. The health probe reports both the applied and
expected version, and flags drift as `degraded`.

Data model detail lives in [memory-design.md](memory-design.md).

## State ownership

| State | Owner | Lifetime |
| --- | --- | --- |
| Memories, history, supersession edges | SQLite | Permanent (until purged) |
| Migrations applied | SQLite `schema_migrations` | Permanent |
| Provider verification | `ProviderHealthTracker` (in memory) | Process lifetime, 60 s cache |
| Uptime | server process start time | Process lifetime |
| Conversation/session state | *not yet implemented* (Phase 3) | — |

Nothing durable is kept in the browser. A page reload re-reads everything from the
API, which is why the UI can be trusted as a view of real state.

## Testing strategy

| Layer | Tool | What it proves |
| --- | --- | --- |
| Schema contracts | Vitest | Invalid memory shapes are rejected before storage |
| Migrations + invariants | Vitest (`:memory:`) | FKs, scope invariant, cascade, FTS sync, supersession history |
| Provider adapter | Vitest + scripted fake CLI | JSONL parsing, usage aggregation, timeouts, spawn failure, flags |
| HTTP contract | Vitest + Fastify `inject` | Real routes, real schema, envelope, error mapping |
| Memory engine | Vitest (`:memory:` and file DBs) | Dedupe, supersession, rollback, deletion/FTS, scope, budgets, determinism, concurrency |
| Memory API | Vitest + `inject` | Every endpoint, status codes, envelopes, deleted-content guarantees |
| Retrieval benchmark | Script | Latency, selectivity, recall, correction accuracy, stale rate |
| Live integration | Vitest, opt-in | Actual Muse inference, structured output, streaming |
| UI | Playwright-core + Playwright-managed Chromium | Managed Studio workflow; some legacy scripts still use system Chrome |

The fake-CLI approach is what lets the provider tests be deterministic without
mocking our own parsing logic: the adapter under test is the real one.

## Known architectural constraints

- **~16,630 token floor per Muse CLI call.** Measured as *exactly* 16,630 input tokens
  across five identical calls (CV 0%); a ~4k-character memory block adds 877 tokens.
  The floor must be subtracted from any token comparison. See
  [evaluation.md](evaluation.md).
- **One process per model call.** Roughly 3.5–5.5 s of startup and streaming latency
  on the reference machine. Fine for a local companion; not a chat-latency design.
  A long-lived `muse serve` adapter is a Phase 3+ option if latency matters.
- **Single-writer SQLite.** WAL is enabled, but the design targets one local user.
  Multi-user hosting is explicitly out of scope.
