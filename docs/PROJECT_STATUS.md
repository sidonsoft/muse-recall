# Project status

**Last updated:** 2026-10-27
**Milestone:** Phase 6 — Evaluation, stabilization, and submission preparation
**State:** Complete — submission-ready with administrative actions pending

## Implemented

### Agent runtime (`packages/agent-core`)

- **`AgentRuntime`** — session orchestration, an active-turn registry, and cancellation. At
  most one turn per session: a second concurrent request is rejected with `session_busy`
  instead of interleaving output.
- **`SessionStore`** — SQLite-backed sessions and messages. Message order is enforced by a
  `UNIQUE(session_id, sequence)` constraint with the sequence assigned under
  `BEGIN IMMEDIATE`, so concurrent writers cannot duplicate or reorder messages.
- **`TurnProcessor`** — the full lifecycle: validate session and scope → capture explicit
  memories → persist the user message → retrieve active memory → assemble bounded context →
  stream the provider → persist the assistant message and its retrieval evidence → report
  usage and context statistics.
- **`ContextAssembler`** — delimited sections (`system_instructions`, `project_constraints`,
  `retrieved_memories`, `recent_corrections`, `conversation_history`, `current_request`)
  under hard budgets. The current request is never truncated; correction history is dropped
  first, then oldest history; if request plus system instructions exceed the budget the turn
  fails with `context_overflow`.
- **`memory-capture`** — explicit "remember …" handling (leading, trailing, cue-first),
  correction detection, deterministic supersession targeting by lexical overlap, and
  candidate extraction that only *proposes* memories for confirmation.
- **`streaming`** — transport-agnostic events plus an SSE writer that tolerates disconnects.

### Persistence (migrations 3–4)

- `sessions`, `messages`, `turn_memories`.
- Turn evidence stores ranking metadata only — never memory content. `memory_id` has **no
  foreign key**, so purging a memory cannot erase the record that it influenced an answer;
  content is resolved at read time and reports `memory_available: false` once deleted.
- Migration 4 rebuilds the FTS index with **porter stemming**, so "building" matches "build"
  and "targeting" matches "target".

### Retrieval changes

- Progressive relaxation: precise (all tokens) → relaxed (any token) when precision starves
  the candidate set → recency fallback when nothing matches. The chosen strategy is reported
  as `query_mode` and surfaced in the inspector.
- Stopwords are removed **before** the 12-token cap; previously a long question spent its
  whole budget on "what/are/we/the" and dropped the nouns that would have found the memory.
- Correction history is rendered as a labelled historical section derived from the *active*
  memory's supersession chain — not a second retrieval of stale records.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Create a conversation (optional project scope) |
| `GET` | `/api/sessions` | List conversations |
| `GET` | `/api/sessions/:id` | Transcript with per-message retrieval evidence |
| `PATCH` | `/api/sessions/:id` | Rename or archive |
| `DELETE` | `/api/sessions/:id` | Delete a conversation |
| `GET` | `/api/sessions/:id/messages/:messageId` | One message and its memory usage |
| `POST` | `/api/sessions/:id/messages` | SSE turn (`retrieval` → `delta` → `usage` → `completed`) or JSON `TurnResult` |

`retrieval` is always emitted before the first `delta`. A disconnected client aborts the
provider call; the partial answer is persisted as `interrupted`, never `complete`.

### UI

- **Conversations view**: session list, streamed answers, stop button, project-scoped
  creation, archive/delete, actionable errors, and streaming status.
- **Memory used** disclosure on every assistant turn: retrieved memory, relevance score,
  evidence sentence, scope, pinned/truncated flags, and context statistics. It states
  explicitly that retrieval is evidence a memory was *provided*, not proof the model used it.
- **Candidate confirmation**: proposed memories appear with a Save button; nothing is stored
  until the user confirms.
- Capture can be disabled per message with a checkbox.

### Verification tooling

- `scripts/demo-sessions.ts` — Demo A and B over HTTP with real Muse, writing evidence JSON.
- `scripts/benchmark-context-efficiency.ts` — Demo C: baseline history vs memory retrieval.
- `scripts/evaluate-retrieval.ts` — 22 realistic retrieval questions with optional real Muse
  answers and a memory-grounded check.

## Phase 4 — generated interfaces

- **`packages/ui-protocol`** — a closed declarative schema (heading, text, status, progress,
  tasklist, table, card, form, button), limits (10 blocks, 10 fields, 30 rows), a component
  allow-list, and a validator. No markup, script, or URL is part of the protocol.
- **Generation** — `POST /api/sessions/:id/ui` asks Muse for a planning form via
  `--output-schema`. The result is normalised, validated, and stored against an assistant
  message. Malformed output is retried once, then rejected with `ui_generation_failed`.
- **Rendering** — the web app renders the spec through a fixed registry, inline in the
  transcript. Unknown blocks never reach it: validation rejects them first.
- **Submission** — `POST /api/sessions/:id/ui/:surfaceId/events` validates values against
  the stored form (required fields, declared options, numeric bounds, no unknown fields),
  records the event, stores the submission as project memory when the form asks for it, and
  runs a normal agent turn with a structured summary.
- **Inspection** — `GET /api/sessions/:id/ui` returns surfaces with their events.

**Real Muse result:** asked to "Plan the first playable milestone for our Phaser game",
`muse-wonder-1.0` returned an 8-field form (milestone name, core mechanic, content scope,
features, session length, art direction, playtest goal, mobile support) in 6.99 s. After
submission the agent produced a milestone plan, and the submission was stored as project
memory.

## Phase 5 — agent tools (added)

- **`packages/tool-runtime`** — typed registry with Zod input/output validation, a declared
  side-effect class, and a confirmation flag per tool. `ToolCallStore` is an append-only
  audit of every request, including invalid and denied calls.
- **Six tools** — `memory.search`, `memory.create`, `project.get`, `project.update`,
  `task.create`, `task.list`. No shell, filesystem, or network tools.
- **Planning** — a separate structured-output call returns up to three tool calls; arguments
  are validated against the chosen tool. Reads execute inside the turn; writes become
  `pending`.
- **Approval** — writes are approved or denied through
  `POST /api/sessions/:id/tools/:callId/decision`. Approval executes and continues the
  conversation; denial records the decision and changes nothing.
- **Scope** — the project id comes from the session, never from model arguments; a call
  approved through another session returns 404.
- **Interfaces** — submitting a generated form now forces a tool-enabled turn, so Muse can
  turn the plan into project tasks (still with approval for each write).
- **UI** — a Tool activity panel shows every call with status, arguments, result, and
  Approve/Deny controls; the memory inspector is unchanged.

## Phase 6 — evaluation and submission (added)

- **Evaluation:** `pnpm eval:comparison` — n=4 per configuration; both configurations 4/4
  correct; memory +67.5 input tokens per call; correction check (superseded excluded) and
  project isolation (0 leaks) pass. Report: `docs/EVALUATION_REPORT.md`.
- **Integrated showcase:** `pnpm demo:showcase` — **8/8** checks with real Muse on a fresh
  database (Demos A, B, D, E); evidence: `docs/benchmarks/showcase.json`.
- **Browser verification:** 28 checks pass, including generated form completion and
  submission, with zero console or HTTP errors.
- **Security/privacy review:** no secrets in history; no tracked `.env` or databases; six
  bounded tools; no outbound HTTP from the app; generated UI is declarative data only.
- **Feature freeze** in effect.
- **Submission materials:** checklist, submission description, evaluation report,
  architecture overview, demo script, video storyboard.
- **Pending owner actions:** confirm repository visibility against the Official Rules
  (currently private), record/upload the video, complete the submission form.

## Verified

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Up to date |
| `pnpm run lint` | 0 errors (99 files) |
| `pnpm run typecheck` | 6/6 projects clean |
| `pnpm test` | **263 passed**, 3 skipped (266) |
| `MML_LIVE_MUSE=1 pnpm test` | **265 passed** (265) — includes 3 real Muse calls |
| `pnpm run build` | web + server bundles built |
| `pnpm demo:sessions` | Demo A and B succeeded with real Muse |
| `pnpm bench:context` | 3 trials per configuration, 100% correctness |
| `pnpm eval:retrieval` | 20/22 retrieval, 7/7 sampled answers correct and grounded |
| `pnpm exec tsx scripts/verify-ui.ts` | **28 checks pass**, zero console/HTTP errors |
| `pnpm demo:showcase` | **8/8 checks**, real Muse |
| `pnpm eval:comparison` | n=4; 4/4 both configurations; see evaluation report |

## Demonstration results (real Muse, `muse-wonder-1.0`)

### Demo A — cross-session memory

Session A captured three requirements from one message. A **new** session B, with zero
history messages, answered:

> "A children's memory game, using Phaser, targeting mobile web."

Retrieved 2 memories (86 characters), `history_messages: 0`, prompt 1,395 characters.

### Demo B — correctable memory

Session C corrected the platform. The old record was superseded (1 supersession), and a new
session D answered:

> "We are now targeting **desktop browsers** for Monty's Memory Meadow. Yes — that changed.
> It was previously mobile web…"

The superseded value appeared only in the labelled `recent_corrections` section.

### Demo C — context efficiency

| Metric | Baseline (history) | Memory-enabled |
| --- | --- | --- |
| Turns per task | 2 | 1 |
| Answering-call input tokens | 16,863 | 16,900 |
| Whole-task input tokens | ~33,671 | ~16,900 |
| Correctness | 100% | 100% |

Memory costs **~37 more tokens on the answering call** but removes an entire setup turn, so
the whole task used roughly half the tokens. Both configurations pay the Muse CLI's
~16.6k-token baseline. Memory is **not** claimed to be cheaper per call.

## Failed / not attempted

- Tool planning is a heuristic in `auto` mode and costs an extra model call per acting turn.
- No shell, filesystem, or network tools (deliberate).
- Generation is deliberately limited to a planning **form** rather than arbitrary layouts.
- Retrieval missed 2/22 evaluation questions — genuine vocabulary gaps, documented in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and [evaluation.md](evaluation.md).

## Blockers

None requiring input.

## Next milestone

**Submission.** Complete the owner actions in `docs/SUBMISSION_CHECKLIST.md`: confirm
visibility, record the video, and submit. No further feature work is planned.
