# Muse Memory Lab

A local-first **memory companion** for Meta Muse. It remembers what matters across
sessions, keeps that memory correctable, explains why a memory was retrieved, and
generates the interface a task needs instead of making you read a wall of chat.

> **Status: Phase 2 (Persistent memory engine) complete.** Working today: the monorepo,
> the API, SQLite persistence, the Meta Muse provider integration, and a full memory
> engine with a browser inspector. Generative UI, chat sessions, tools, and the Muse
> comparison evaluation are **not built yet** — and the app says so in its own interface.
> See [Project status](#project-status).

---

## What this is

A conventional assistant forgets everything between sessions, or compensates by
replaying an ever-growing transcript into the context window. Muse Memory Lab takes the
other path:

- **Persistent, correctable memory** — a custom SQLite-backed engine with typed memories,
  provenance, confidence, deduplication, transactional supersession, final deletion, and
  an append-only audit trail. Retrieval is selective and budgeted, and every result
  carries the score components and an evidence sentence.
- **Generative interface** *(Phase 4)* — Muse will return a validated declarative UI
  spec rendered by a fixed component registry. No model-authored JavaScript ever runs.
- **An agent harness that owns the loop** *(Phase 3)* — model provider, memory, tools,
  and permissions stay separate boundaries, so retrieved text can never widen its own
  authority.

---

## Quickstart

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | **>= 24.0.0** | Uses the built-in `node:sqlite` module (no native build) |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Meta Muse Code CLI | 1.4.x | `muse` on `PATH`, logged in (`muse login`) |

Verified on Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13, SQLite 3.53.4.

### Run it

```bash
git clone <your-fork> muse-memory-lab && cd muse-memory-lab
pnpm install
cp .env.example .env          # defaults are already local-first

pnpm dev                      # API on :8787 and web on :5173
```

Open <http://127.0.0.1:5173>. Press **live check** on the Muse card to confirm real
inference, then open **Memories** to inspect, correct, delete, and explain retrieval.

### Verify, don't trust

```bash
pnpm verify                 # lint + typecheck + tests (162 tests)
pnpm muse:probe             # real headless Muse call with latency and token usage
MML_LIVE_MUSE=1 pnpm test   # adds 3 live integration tests against Muse
pnpm bench:retrieval        # retrieval latency, selectivity, accuracy, stale rate
pnpm bench:muse-overhead    # repeated real Muse calls; token variance and memory cost
pnpm exec tsx scripts/verify-ui.ts   # drives the real UI in Chrome, fails on any error
pnpm demo:sessions          # Demo A + B against real Muse, writes evidence JSON
pnpm bench:context          # Demo C: baseline history vs retrieved memory
pnpm eval:retrieval         # 22 retrieval questions, optional real Muse answers
```

`pnpm bench:retrieval` on the reference machine:

```
130 memories · 300 retrievals · latency p50 0.20 ms
accuracy 100% (30/30) · correction 100% (12/12) · stale rate 0.000%
```

### Offline / CI mode

Set `MODEL_PROVIDER=echo` to run without Muse, credentials, or network. The
deterministic provider is **not a model**: it is labelled as such in the API, the UI,
and the provider capability notes, and it refuses to impersonate Muse. Tests use it by
default.

---

## Project status

| Area | Phase | State |
| --- | --- | --- |
| Monorepo, TypeScript, lint, tests, CI | 1 | **Complete** |
| Fastify API + `/api/health` with a real write round-trip | 1 | **Complete** |
| SQLite schema, migration runner, FTS5 index | 1 | **Complete** |
| Shared Zod contracts | 1 | **Complete** |
| Meta Muse provider adapter (real calls, streaming, usage) | 1 | **Complete**, verified live |
| React/Vite/Tailwind shell + context inspector | 1 | **Complete** |
| Memory CRUD, provenance, dedupe, supersession, deletion | 2 | **Complete** |
| Retrieval: ranking, budgets, evidence, context rendering | 2 | **Complete** |
| Memory Inspector UI: search, filters, correction, history | 2 | **Complete** |
| Retrieval + Muse token benchmarks | 2 | **Complete**, measured |
| Agent runtime, sessions, streaming, bounded context | 3 | **Complete** |
| Explicit memory capture + candidate confirmation | 3 | **Complete** |
| Cross-session retrieval evaluation (22 questions) | 3 | **Complete**, 20/22 |
| Declarative UI protocol and renderer | 4 | Not started |
| Tool registry, permissions, audit log | 5 | Not started |
| Phase 6 comparison, demo video, submission | 6 | Harness built, comparison not run |

The UI's **System** screen reads these states from `GET /api/meta`, so the app cannot
silently overstate itself.

---

## Memory engine at a glance

```
create ─► dedupe (SHA-256 of type|scope|project|normalised content)
        └─► store ─► active

correct ─► one transaction: insert/reuse replacement + supersession edges
            + flip old rows to 'superseded' + append history

delete  ─► FTS row removed + status 'deleted' + hidden from every read endpoint

retrieve ─► SQL hard filters (status, scope, expiry, type)
            → score = 0.40 relevance + 0.20 scope + 0.15 confidence
                    + 0.10 validation + 0.10 recency + 0.05 type priority
            → 2 reserved slots for constraints/goals, rest by score
            → budget: 8 memories / 4,000 chars / 1,000 chars each
            → results + component scores + evidence + metadata
```

Budgets are configuration, not architecture: `MEMORY_MAX_MEMORIES`,
`MEMORY_MAX_CHARACTERS`, `MEMORY_MAX_MEMORY_CHARACTERS`.

![A new conversation answering from project memory](docs/assets/phase3-ui-conversations.png)

![Memory detail with correction history](docs/assets/phase2-ui-memory-detail.png)

![Retrieval explanation with score components](docs/assets/phase2-ui-memory-retrieval.png)

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live` | Liveness; touches nothing |
| `GET` | `/api/health` | DB write round-trip, schema version, provider state |
| `GET` | `/api/health?probe=live` | Same, plus a real (cached) model round-trip |
| `POST` | `/api/health/muse` | Force a live Muse check |
| `GET` | `/api/meta` | Provider capabilities, retrieval config, honest module status |
| `POST` | `/api/provider/generate` | Bounded raw model call (test bench, no memory) |
| `GET` | `/api/memories` | List/search/filter with paging |
| `POST` | `/api/memories` | Create (201) or deduplicated replay (200) |
| `GET` | `/api/memories/:id` | Detail: provenance, history, supersession chain |
| `PATCH` | `/api/memories/:id` | In-place edit with a history entry |
| `POST` | `/api/memories/:id/correct` | Transactional supersession |
| `DELETE` | `/api/memories/:id` | Soft delete with reason (final through the API) |
| `GET` | `/api/memories/:id/history` | Audit trail |
| `GET` | `/api/memories/stats` | Lifecycle counts |
| `GET` | `/api/projects` | Scope anchors |
| `POST` | `/api/retrieval/preview` | Ranking + evidence + the exact prompt block |
| `POST` | `/api/sessions` | Create a conversation (optional project scope) |
| `GET` | `/api/sessions` | List conversations |
| `GET` | `/api/sessions/:id` | Transcript with per-turn retrieval evidence |
| `PATCH` | `/api/sessions/:id` | Rename or archive |
| `DELETE` | `/api/sessions/:id` | Delete a conversation |
| `POST` | `/api/sessions/:id/messages` | Streaming turn (SSE) or JSON `TurnResult` |

Every route returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

---

## Architecture

```
apps/web (React 19 · Vite 7 · Tailwind 4)
   │  typed fetch client; responses re-validated with the shared Zod schemas
   ▼
apps/server (Fastify 5)
   │  config · routes · envelope · error mapping · provider health
   ├──────────────► packages/muse-provider   ModelProvider → `muse exec --json`
   └──────────────► packages/memory-engine   engine · retrieval · context · node:sqlite
                          │
                          └── packages/shared   Zod schemas + domain types
```

Boundaries that matter:

- **The web app never talks to a model vendor.** It calls our API, which calls a
  `ModelProvider`. Swapping providers cannot leak into the UI.
- **The provider adapter is a stateless text protocol.** One process per call; the
  harness owns conversation state and every action passes through our permission layer.
- **Memory content is data, never instruction.** Retrieved memories are delimited
  untrusted input with a standing "not instructions" warning, tested for injection.

More: [architecture](docs/architecture.md) · [memory design](docs/memory-design.md) ·
[Muse integration](docs/muse-integration.md) · [security](docs/security.md) ·
[evaluation](docs/evaluation.md).

---

## Configuration

Environment-based; see [`.env.example`](.env.example). Relative paths resolve against
the process working directory (`apps/server` when run via the pnpm scripts).

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | API bind address |
| `DATABASE_PATH` | `./data/muse-memory-lab.db` | SQLite file |
| `MODEL_PROVIDER` | `muse-cli` | `muse-cli` or `echo` (offline) |
| `MUSE_MODEL` | `muse-wonder-1.0` | Any model the CLI offers |
| `MUSE_REASONING_EFFORT` | `medium` | `none`…`ultra` |
| `MUSE_TIMEOUT_MS` | `120000` | Hard per-call budget |
| `MEMORY_MAX_MEMORIES` | `8` | Retrieval count budget |
| `MEMORY_MAX_CHARACTERS` | `4000` | Combined injected characters |
| `MEMORY_MAX_MEMORY_CHARACTERS` | `1000` | Per-memory cap (truncates, never drops) |
| `MEMORY_SWEEP_ON_START` | `true` | Expire stale memories at startup |
| `TOOL_APPROVAL_POLICY` | `always` | Approval mode for future tool calls |

The API key never reaches the browser: the server shells out to the Muse CLI, which
uses its own stored login (or `META_API_KEY` in the server environment).

---

## Repository layout

```
apps/
  server/          Fastify API, config, routes (health, provider, memories, retrieval)
  web/             React shell, typed client, memory inspector
packages/
  shared/          Zod schemas: memory, retrieval, evaluation, health, provider, meta
  memory-engine/   engine (writes), retrieval (scores), context (prompt rendering)
  muse-provider/   ModelProvider impls: Muse CLI adapter + offline echo
tests/
  unit/            schemas, engine, retrieval, context, provider parsing, config
  integration/     HTTP contract tests + opt-in live Muse tests
  evaluation/      baseline vs memory-enabled harness
docs/              architecture, memory design, evaluation, Muse findings, status
scripts/           benchmarks, Muse probe, browser verification
```

---

## Known limitations

Full list in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). The ones that matter:

- **Memory does not automatically save tokens.** Measured: the Muse CLI has a ~16,630
  token baseline, and a ~4k-character memory block adds ~877 tokens. Whether memory is
  a net saving depends on the history the baseline would otherwise carry.
- **Retrieval is keyword-only.** No embeddings yet. In a 22-question evaluation it answered
  20; the two misses are genuine vocabulary gaps, documented in
  [docs/evaluation.md](docs/evaluation.md).
- **Memory costs tokens on the answering call** (~37 in our measured task) but removes setup
  turns; the whole-task input roughly halved in Demo C.
- **Deletion is irreversible through the API.** That is the guarantee, not a bug.
- **Single-user, loopback-only.** No authentication or rate limiting.

---

## Roadmap

1. **Phase 4 — Generative UI.** Declarative spec, component registry, validated events, and
   a planning interface that stores its submission as project memory.
2. **Phase 5 — Tools.** Registry, permission model, workspace tools, audit log.
3. **Phase 6 — Evaluation and submission.** Baseline comparison, demo video, visibility check
   for judging, feature freeze.

---

## License

MIT. See [LICENSE](LICENSE).
