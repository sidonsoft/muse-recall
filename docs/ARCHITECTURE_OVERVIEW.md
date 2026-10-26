# Architecture overview

```
Browser (React 19 · Vite 7 · Tailwind 4)
  │  typed fetch client; every response re-validated with shared Zod schemas
  ▼
Fastify API (apps/server)
  │  routes · envelope · error mapping · SSE
  ├── packages/agent-core        sessions, bounded context, turn lifecycle, tools
  ├── packages/memory-engine     SQLite · migrations · retrieval · evidence
  ├── packages/tool-runtime      typed registry · validation · audit
  ├── packages/ui-protocol       declarative UI schema · validation · generation
  └── packages/muse-provider     ModelProvider → `muse exec --json`
                                  └── packages/shared   Zod contracts
```

## Boundaries that matter

| Boundary | Why |
| --- | --- |
| Provider is stateless text | The harness owns conversation state; a model call cannot execute anything. |
| Memory content is data | Retrieved blocks are delimited and labelled "not instructions"; injection is tested. |
| Project scope originates in the session | No tool or retrieval accepts a model-supplied project id. |
| UI is declarative | The model emits validated JSON; a fixed registry renders it; no JavaScript from the model runs. |
| Writes require approval | The model can request a call; only a user decision executes it. |

## Turn lifecycle

1. Validate session and project scope; reject archived sessions.
2. Honour explicit `remember …` instructions (leading/trailing/cue-first), with lexical
   supersession targeting for corrections.
3. Persist the user message; assign `sequence` under `BEGIN IMMEDIATE`.
4. Retrieve active memory within budgets; emit `retrieval` before any token.
5. Plan tools (structured decision call); execute reads, hold writes as `pending`.
6. Assemble a bounded prompt: system, constraints, memories, tool results, corrections,
   history, current request — with per-section character accounting.
7. Stream the answer; persist it with usage and context statistics; record turn evidence.
8. Emit `completed`; pending writes wait for `POST …/tools/:callId/decision`.

## Data model

`projects`, `memories`, `memory_supersessions`, `memory_history`, `memory_fts`,
`sessions`, `messages`, `turn_memories`, `ui_surfaces`, `ui_events`, `project_tasks`,
`tool_calls`, `schema_migrations`.

Turn evidence stores ranking metadata only and has **no foreign key** to memories: purging a
memory cannot erase the record that it influenced an answer. Tool-call audits are append-only
and include invalid and denied requests.

## Safety posture

- Local-first: binds `127.0.0.1`, no authentication, **not** production-ready for multi-user
  hosting.
- No shell/filesystem/network tools; the only child process is the Muse CLI itself.
- Generated UI cannot execute code; submissions are validated against the stored surface.
- Secrets stay in the server environment or the Muse CLI credential store; the browser never
  receives a provider key.

## Known constraints

Keyword retrieval only (two vocabulary-gap failures documented); ~16.6k Muse CLI token
baseline; one turn at a time per session; no restore-after-delete.
