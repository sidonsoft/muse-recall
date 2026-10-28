# Architecture overview

```
Browser (React 19 · Vite 7 · Tailwind 4)
  │  typed fetch client; every response re-validated with shared Zod schemas
  ▼
Fastify API (apps/server)
  │  routes · envelope · error mapping · SSE · origin/host guards
  ├── packages/agent-core        sessions, bounded context, turn lifecycle, tools
  ├── packages/memory-engine     SQLite · migrations · retrieval · evidence · prompt blocks
  ├── packages/tool-runtime      typed registry · validation · audit
  ├── packages/ui-protocol       declarative UI schema · validation · generation
  ├── packages/decision-guard    advisory source-pattern engine
  └── packages/muse-provider     ModelProvider → `muse exec --json`
                                  └── packages/shared   Zod contracts
```

HTML Studio and the conversational product share the memory engine and API, but they
have different execution models. See [Declarative UI vs HTML Studio](#declarative-ui-vs-html-studio).

## Boundaries that matter

| Boundary | Why |
| --- | --- |
| Provider is stateless text | The harness owns conversation state; a text completion cannot execute anything. |
| Memory content is data | Retrieved blocks carry ids/provenance, are escaped, and are labelled "not instructions"; injection is tested. |
| Project scope originates in the session | No tool or retrieval accepts a model-supplied project id. |
| Declarative UI is data | The model emits validated JSON; a fixed registry renders it; no model JavaScript runs in the app origin. |
| Studio HTML is sandboxed | Generated HTML/JS runs only in `<iframe sandbox="allow-scripts">` with an opaque origin and restrictive CSP. |
| Writes require approval | The model can request a call; only a user decision executes it. Forge promotion is a separate explicit approval. |
| Forge promotion is exact-byte | Runtime verification snapshots bytes; promotion refuses a different SHA-256. |
| Durable jobs are observable | Unreadable records, failed writes, and restart-interrupted jobs are reported, not hidden as an empty project. |

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

## HTML Studio / Forge lifecycle

1. **Start** — validate project and concurrency, create an isolated staging directory,
   retrieve project memories, and persist a `queued` job *before* spawning the model.
2. **Run** — spawn `muse exec` with a scrubbed environment and hermetic flags, rooted at
   the staging directory. Stream JSONL frames into bounded logs/usage.
3. **Validate** — structural/syntax checks and advisory Decision Guard run on the staged
   file. A failed job never becomes visible as a version.
4. **Review** — the user sees Preview, Source, Changes, provenance, and the advisory
   report. Nothing is promoted yet.
5. **Approve** — a project lock serialises approval/rejection; version ancestry is
   checked; the staged bytes are snapshotted, runtime-checked, and promoted with the
   expected SHA-256. The version records syntax/structure results, runtime result,
   browser identity when available, verification timestamp and the checked hash. The
   resulting version is immutable.
6. **Reject / rollback** — rejection deletes staged bytes and records the decision;
   rollback follows the recorded `base_version` edge, not array adjacency.
7. **Shutdown** — stop accepting starts, mark active jobs cancelled, send SIGTERM,
   escalate to SIGKILL after a bounded grace period, wait for terminal persistence, then
   flush writes. A restart afterwards sees terminal/cancelled records, not `interrupted`.

### Durable job files

```
WORKSPACE_ROOT/
  forge/
    <project-id>/
      state.json                 # current_version + immutable version ancestry
      jobs/<job-id>.json         # one complete job record per file
      staging/<job-id>/          # staged index.html + prompt.txt (review only)
      versions/<n>/index.html    # promoted, hash-checked versions
```

Job writes use a same-directory temporary file and atomic rename. Intermediate log/usage
snapshots are coalesced (one in-flight write plus one pending replacement); creation,
terminal states, approval and rejection are marked required and awaited. Startup scans
every project's `jobs/` directory before serving requests:

- `queued` / `running` becomes `interrupted` with an explicit error; the model is **not**
  resumed.
- `succeeded` with no applied version remains reviewable if its staged file exists; a
  missing staging file is reported.
- A crash between promotion and the job-record write is reconciled from the version's
  `job_id`.
- Malformed JSON/schema records are reported as recovery issues; they are not deleted or
  rewritten, and readable jobs in the same project still load.
- A malformed `state.json` (including JSON `null`, arrays, invalid shapes or invalid JSON)
  raises `state_corrupt` instead of being replaced with an empty project. Missing files use
  a distinct sentinel, so `null` is never treated as absence.
- Recovery reports keep immutable startup counts separate from current jobs. Historical
  incidents can be acknowledged without deleting records; active project/store storage
  failures remain until an explicit health check succeeds.

## Declarative UI vs HTML Studio

| Surface | Model output | Execution | Authority |
| --- | --- | --- | --- |
| Generated interface | Closed JSON schema (blocks/fields) | Fixed React registry | Values validated against the stored surface; no code execution |
| HTML Studio | One `index.html` with inline CSS/JS | Sandboxed iframe, opaque origin, CSP | Arbitrary client-side JS only inside the frame; no app-origin access |

The server never evaluates Studio HTML. It serves it as sandboxed HTML, as JSON source for
inspection/export, and loads it once in a browser during approval with network blocked
except the approved CDN. A downloaded file is no longer sandboxed.

## Data model

`projects`, `memories`, `memory_supersessions`, `memory_history`, `memory_fts`,
`sessions`, `messages`, `turn_memories`, `ui_surfaces`, `ui_events`, `project_tasks`,
`tool_calls`, `schema_migrations`.

Turn evidence stores ranking metadata only and has **no foreign key** to memories: purging a
memory cannot erase the record that it influenced an answer. Tool-call audits are append-only
and include invalid and denied requests. Forge jobs/versions live on the filesystem under
`WORKSPACE_ROOT`, not in SQLite.

## Safety posture

- Local-first: binds `127.0.0.1`, no authentication, **not** production-ready for multi-user
  hosting.
- Conversational tools are six bounded project/memory tools; the Forge child may write
  inside its staging workspace under the CLI's own sandbox.
- Stored memory is rendered as bounded, escaped data with record identity and provenance.
  It cannot grant tool permissions or change the application prompt/policy.
- The Forge and chat children receive a shared environment allow-list (home/login,
  `PATH`/platform lookup, locale, proxy, certificate configuration), not the server's
  full environment; provider keys travel over stdin only.
- Secrets stay in the server environment or the Muse CLI credential store; the browser never
  receives a provider key.

## Known constraints

Keyword retrieval only (two vocabulary-gap failures documented); ~16.6k Muse CLI token
baseline; one turn at a time per session; no restore-after-delete; Forge jobs are
single-process file records, and the Forge child is not OS-isolated beyond the CLI's
sandbox and the server user's permissions. A queued/running job interrupted by a restart is
marked `interrupted`, not resumed.
