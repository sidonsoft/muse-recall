# Muse Memory Lab

A local-first **memory companion** for Meta Muse. It remembers what matters across
sessions, keeps that memory correctable, and generates the interface a task needs
instead of making you read a wall of chat.

> **Status: Phase 1 (Foundation) complete.** The repository, API, database, shared
> contracts, and the Meta Muse provider integration are implemented and verified on
> a real machine with real inference. Memory retrieval, generative UI, tools, and
> evaluation are **not built yet** and the app says so in its own interface.
> See [Project status](#project-status) for the exact line.

---

## What this is

A conventional assistant forgets everything between sessions, or compensates by
replaying an ever-growing transcript into the context window. Muse Memory Lab takes
the other path:

- **Persistent, correctable memory** — a custom SQLite-backed memory engine with
  provenance, confidence, supersession, and an audit trail. The model's context is
  an assembly of *retrieved* memory, not a transcript dump.
- **Generative interface** — Muse returns a validated declarative UI spec, and a
  fixed component registry renders it. Events flow back as structured data. No
  model-authored JavaScript ever runs.
- **An agent harness that owns the loop** — model provider, memory, tool execution,
  and permissions are separate boundaries, so retrieved text or generated UI can
  never widen its own authority.

Phase 1 builds the foundation those three ideas stand on.

---

## Quickstart

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | **>= 24.0.0** | Uses the built-in `node:sqlite` module (no native build) |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Meta Muse Code CLI | 1.4.x | `muse` on `PATH`, logged in (`muse login`) |

Verified on Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13.

### Run it

```bash
git clone <your-fork> muse-memory-lab && cd muse-memory-lab
pnpm install
cp .env.example .env          # defaults are already local-first

pnpm dev                      # API on :8787 and web on :5173
```

Open <http://127.0.0.1:5173>, then press **live check** on the Muse card to confirm
real inference from your machine.

Run the pieces separately when you want two clean terminals:

```bash
pnpm dev:server    # Fastify API, tsx watch, port 8787
pnpm dev:web       # Vite dev server, port 5173, proxies /api
```

### Verify, don't trust

```bash
pnpm verify              # lint + typecheck + tests
pnpm muse:probe          # real headless Muse call; prints latency and token usage
MML_LIVE_MUSE=1 pnpm test # includes 3 live integration tests against Muse
pnpm exec tsx scripts/verify-ui.ts   # drives the real UI in Chrome, fails on any console error
```

`pnpm muse:probe` on the reference machine:

```
reply: "READY" · model muse-wonder-1.0 · latency 5538 ms
input 16630 tokens · output 17 tokens · reasoning 7 tokens
```

### Offline / CI mode

Set `MODEL_PROVIDER=echo` to run the whole stack without Muse, credentials, or
network. The deterministic provider is **not a model**: it is labelled as such in
the API, the UI, and the provider capability notes, and it refuses to impersonate
Muse. Tests use it by default.

---

## Project status

| Area | Phase | State |
| --- | --- | --- |
| Monorepo, TypeScript, lint, tests, CI | 1 | **Complete** |
| Fastify API + `/api/health` with a real write round-trip | 1 | **Complete** |
| SQLite schema, migration runner, FTS5 index | 1 | **Complete** |
| Shared Zod contracts for memory, health, provider, meta | 1 | **Complete** |
| Meta Muse provider adapter (real calls, streaming, usage) | 1 | **Complete**, verified live |
| React/Vite/Tailwind shell + context inspector | 1 | **Complete** |
| Memory CRUD, retrieval, dedupe, supersession | 2 | Not started — schema only |
| Agent harness sessions and context assembly | 3 | Not started |
| Declarative UI protocol and renderer | 4 | Not started |
| Tool registry, permissions, audit log | 5 | Not started |
| Baseline vs. memory-enabled evaluation | 6 | Not started |

The UI's **System** screen reads these states from `GET /api/meta`, so the app
cannot silently overstate itself.

---

## Architecture at a glance

```
apps/web (React 19 · Vite 7 · Tailwind 4)
   │  typed fetch client; responses re-validated with the shared Zod schemas
   ▼
apps/server (Fastify 5)
   │  config · routes · error envelope · provider health tracking
   ├──────────────► packages/muse-provider   ModelProvider interface
   │                    └── MuseCliProvider → `muse exec --json` (child process)
   └──────────────► packages/memory-engine    node:sqlite · migrations · FTS5
                          │
                          └── packages/shared   Zod schemas + domain types
```

Boundaries that matter:

- **The web app never talks to a model vendor.** It only calls our API, which only
  calls a `ModelProvider`. Swapping providers cannot leak into the UI.
- **The provider adapter is a stateless text protocol.** One process per call; the
  harness owns conversation state. Native tool calling stays off, so no
  model-generated action executes outside our permission layer.
- **Memory content is data, never instruction.** Retrieved memories will be
  delimited untrusted input, never merged into system instructions.

More detail: [docs/architecture.md](docs/architecture.md) ·
[docs/muse-integration.md](docs/muse-integration.md) ·
[docs/memory-design.md](docs/memory-design.md) ·
[docs/security.md](docs/security.md).

---

## Repository layout

```
apps/
  server/          Fastify API, config, health, provider health tracking
  web/             React shell, typed API client, provider bench
packages/
  shared/          Zod schemas: memory, health, provider, service meta, envelopes
  memory-engine/   node:sqlite bootstrap, migrations, FTS5, health probe
  muse-provider/   ModelProvider contract impls: Muse CLI adapter + offline echo
tests/
  unit/            schemas, migrations, provider parsing, config
  integration/     HTTP contract tests (Fastify inject) + opt-in live Muse tests
docs/              architecture, integration findings, status, decisions, risks
scripts/           muse probe, browser UI verification
```

---

## Configuration

All configuration is environment-based; see [`.env.example`](.env.example).
Relative paths resolve against the process working directory (when run via the
provided pnpm scripts, that is `apps/server`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | API bind address |
| `DATABASE_PATH` | `./data/muse-memory-lab.db` | SQLite file |
| `MODEL_PROVIDER` | `muse-cli` | `muse-cli` or `echo` (offline) |
| `MUSE_MODEL` | `muse-wonder-1.0` | Any model the CLI offers |
| `MUSE_REASONING_EFFORT` | `medium` | `none`…`ultra` |
| `MUSE_TIMEOUT_MS` | `120000` | Hard per-call budget |
| `TOOL_APPROVAL_POLICY` | `always` | Approval mode for future tool calls |
| `CORS_ORIGINS` | local Vite origins | Allowed browser origins |

The API key is never required in the browser: the server shells out to the Muse
CLI, which uses its own stored login (or `META_API_KEY` in the server environment).

---

## API (Phase 1)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live` | Liveness; touches nothing |
| `GET` | `/api/health` | DB write round-trip, schema version, provider state |
| `GET` | `/api/health?probe=live` | Same, plus a real (cached) model round-trip |
| `POST` | `/api/health/muse` | Force a live Muse check |
| `GET` | `/api/meta` | Provider capabilities and honest module status |
| `POST` | `/api/provider/generate` | Bounded raw model call (test bench, no memory, no tools) |

Every route returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

---

## Roadmap

1. **Phase 2 — Memory engine.** CRUD, provenance, hybrid retrieval with a context
   budget, dedupe, supersession, deletion that removes index entries, tests for each
   invariant.
2. **Phase 3 — Harness.** Sessions, bounded context assembly, memory injection,
   streaming chat.
3. **Phase 4 — Generative UI.** Declarative spec, component registry, validated
   event channel, memory inspector.
4. **Phase 5 — Tools.** Registry, permission model, workspace tools, audit log.
5. **Phase 6 — Evaluation.** Baseline vs. memory-enabled runs on identical tasks,
   then the demo script and final polish.

Current blockers and next steps: [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) ·
[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

---

## License

MIT. See [LICENSE](LICENSE).
