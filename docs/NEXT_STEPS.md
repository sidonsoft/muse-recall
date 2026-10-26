# Next steps

## Phase 3 — Agent harness and conversational sessions

**Goal:** Muse actually uses memory in conversation. A session retrieves relevant
memories, assembles a bounded context, streams an answer, and records which memories
influenced it — so a fresh session resumes work without the previous transcript.

**Acceptance criteria (from the build brief):**
1. A real Muse request succeeds through the harness.
2. A second session retrieves relevant memory and answers with it.
3. API failures are reported clearly to the user.

### Work items

**1. New package `packages/agent-core`**

- `ContextAssembler` — builds a prompt from (system instructions, retrieved memory
  block, recent turns). Hard budgets: memory characters (Phase 2) **plus** a turn
  budget (default 6 turns / 6,000 characters). Never the whole transcript.
- `SessionStore` — SQLite-backed sessions and messages.
- `AgentRuntime` — one turn: retrieve → assemble → call provider → stream → persist.
  Tool execution stays out of Phase 3 (that is Phase 5).
- Token accounting: store provider-reported usage per turn; label estimates as
  estimates.

**2. Migration 3 — `packages/memory-engine/src/migrations.ts`**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

-- Which memories influenced which turn. This is the evidence trail Demo A/B rely on.
CREATE TABLE turn_memories (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL,           -- no FK: history must survive memory purge
  score REAL NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY (message_id, memory_id)
);
```

Note the deliberate absence of a foreign key on `memory_id`: if a memory is purged, the
turn record must still show that *something* influenced the answer, not silently lose
the provenance edge.

**3. Harness**

- `createAgentRuntime({ provider, engine, config })`.
- Turn flow: persist user message → retrieve (`project_id`, query = user message) →
  `formatMemoryContext` → assemble → `provider.stream` → emit deltas → persist
  assistant message + `turn_memories`.
- Bounded retries for provider errors (`provider_timeout` no retry; `provider_crashed`
  one retry).
- Execution log rows for every turn: prompt characters, memory ids, usage, duration.

**4. HTTP**

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Create a session (optional project, title) |
| `GET` | `/api/sessions` | List recent sessions |
| `GET` | `/api/sessions/:id` | Session + transcript + per-turn memory evidence |
| `POST` | `/api/sessions/:id/messages` | Send a turn; SSE stream of deltas, memory events, usage, done |
| `DELETE` | `/api/sessions/:id` | Delete a session |

SSE event types: `retrieval` (ids, counts, characters), `delta` (text), `usage`,
`error`, `done`. The retrieval event must arrive **before** the first token so the
inspector can show why before it shows what.

**5. UI — Conversations view**

- Session list in the sidebar section, transcript in the main pane, composer at the
  bottom.
- Streaming answer with a stop button.
- Per-turn "memory used" disclosure that expands the evidence inline.
- Context inspector switches from "no agent turn yet" to the live turn: retrieved
  memories, characters injected, tokens, latency.
- Provider failure renders as an actionable message, not a blank answer.

**6. Tests**

| Test | Assertion |
| --- | --- |
| Routing | `/api/sessions` CRUD; unknown session → 404 |
| Persistence | Transcript survives a server restart |
| Retrieval wiring | Turn 2 in a new session includes project memory in the provider request |
| Budget | Assembled prompt never exceeds memory + turn budgets |
| Evidence | `turn_memories` rows match the retrieval metadata exactly |
| Failure | Provider error yields a clear SSE `error` event and no assistant row |
| Isolation | Sessions in project A never inject project B memory |
| Streaming | Deltas concatenate to the persisted assistant content |

**7. Demonstration rehearsal (Demo A and B)**

- **Demo A:** new project → state constraints → new session → ask to continue → show
  the retrieved constraints and answer. Record a transcript in `docs/demo-script.md`.
- **Demo B:** establish decision → correct it → new session → ask for the current
  decision → show the new fact retrieved and the old one absent, with the inspector
  showing the correction history in the retrieval evidence.

### Sequencing

```
migration 3 + SessionStore  →  tests
        ↓
ContextAssembler + budgets  →  tests
        ↓
AgentRuntime + SSE route    →  integration tests
        ↓
Conversations UI            →  browser verification
        ↓
Demo A / Demo B rehearsals  →  docs/demo-script.md
```

Do not start Phase 4 (generative UI) until Demo A and Demo B both work end to end.

## Open questions for Phase 3

1. Should a turn retrieve using the raw user message or a rewritten query? Start with
   the raw message — it is explainable and adds no extra model call.
2. How many turns belong in the context budget? Start with 6 turns / 6,000 characters
   and measure with the evaluation harness.
3. When the provider reports no usage (KI-2), do we show an estimate? Prefer showing
   "unavailable" until an estimate can be labelled unambiguously.
