# Security model

The product's premise — an agent that remembers and acts — makes three boundaries
security-critical: **what the model is allowed to do**, **what stored text is allowed
to mean**, and **what generated UI is allowed to execute**.

## Threat model

| # | Threat | Impact | Status |
| --- | --- | --- | --- |
| T1 | Model emits a tool call that was never authorized | File/data damage | Tool layer not built; design blocks it (see below) |
| T2 | Prompt injection arrives via stored memory or external content | Agent obeys attacker text | Memory injection is Phase 2; delimiter + standing instruction designed |
| T3 | Generated UI executes model-authored JavaScript | Full client compromise | **Prevented by design**: no code path evaluates generated strings |
| T4 | API key leaks to the browser | Credential theft | **Prevented**: keys stay in the server/CLI environment |
| T5 | Malformed or hostile HTTP input crashes the server | Denial of service | **Handled**: Zod validation + envelope + safe error mapping |
| T6 | Local API is reachable from other machines | Unauthorized use | **Mitigated**: binds `127.0.0.1`; no auth (single-user local app) |
| T7 | Database file exfiltrated | Memory disclosure | Out of scope for local-first; file is gitignored and never committed |

## Controls implemented in Phase 1

**Input validation.** Every route validates its body/query with a Zod schema from
`@mml/shared` (shared with the client). Oversized input is rejected before it can
cost tokens: prompts ≤ 4,000 chars, output ≤ 1,024 tokens, page sizes bounded.

**No arbitrary code execution.** Nothing in the application evaluates model output.
The provider returns text; the bench renders it as text in a `<pre>`. There is no
`eval`, no `new Function`, no `dangerouslySetInnerHTML` anywhere in the codebase.
React escapes rendered strings by default.

**Secrets never reach the browser.** The API key lives in the server environment or
the Muse CLI's credential store. The client has no code path to a provider endpoint;
it calls our API only. `VITE_*` variables are limited to the API base URL.

**Hermetic model invocation.** Every headless Muse call disables web tools, reminder
sub-agents, and interactive prompts, and does not load the developer's personal
rules. A model call cannot reach the network, spawn background work, or block on a
human.

**Bounded execution.** Each provider call has a hard wall-clock timeout enforced by
the adapter (SIGTERM, then SIGKILL after 5 s). A hung model cannot hang the server.

**Safe error surfaces.** The error handler returns stable codes and generic
messages for 5xx; stack traces are logged server-side only, never serialized to the
client. A test asserts that a malformed body does not leak file paths or module
names.

**Envelope discipline.** Clients get exactly one response shape, so a failure is
never silently treated as an empty success.

**CORS allow-list.** Only the configured local Vite origins may call the API from a
browser; non-browser clients without an `Origin` header are allowed (the app is
loopback-only).

## Controls specified for later phases

### Tool authorization (Phase 5)

- A tool registry where each tool declares `side_effect`, `scopes`, and whether it
  requires confirmation.
- The harness — not the model — decides whether a call runs. The model can only
  *request*; requests are validated against the registry, the current approval
  policy, and the workspace root.
- `TOOL_APPROVAL_POLICY=always` is the default: every state-changing call is
  confirmed by the user, including those originating from generated UI.
- Generated UI events enter the **same** path as conversational requests. A form
  submission is a structured intent, not a granted permission.
- Workspace file access is confined to `WORKSPACE_ROOT` with path canonicalisation
  (reject `..`, symlink escapes, absolute paths outside the root).
- Every call is appended to a tool audit log with inputs, decision, result, and
  duration.

### Memory engine controls (implemented in Phase 2)

**Deleted content is unreachable.** A soft delete removes the FTS row in the same
transaction and every read path (`get`, `list`, `detail`, `history`, retrieval) filters
`status = 'deleted'` out, including when a caller explicitly requests deleted rows.
There is no restore endpoint, so deletion is final through the API. Tests assert each of
these paths.

**Search input is never an FTS expression.** `toFtsQuery` extracts word tokens, quotes
each one, and joins them with `AND`, so `"`, `*`, `NEAR`, `OR`, and friends are literal
text. Hostile queries are covered by tests and cannot reshape the SQL.

**Destructive actions are explicit.** Correction, in-place edit, and deletion each have
their own confirmation surface in the UI; deletion states that the content becomes
unrecoverable. The engine additionally refuses to purge an active record.

**Supersession cannot silently swallow a request.** Correcting an already-superseded
memory with a *different* fact returns 409 naming the record to correct, instead of
returning an unrelated replacement with 200.

**Scope is enforced in SQL, not in JavaScript.** Retrieval builds the scope predicate
into the query, so a memory from another project never enters the candidate set and
cannot be leaked by a ranking bug.

**Duplicate requests cannot fork state.** Writes take `BEGIN IMMEDIATE`, so
check-then-insert serialises; an identical correction replays idempotently.

**History is append-only and content-free where it matters.** History rows record
actions, actors, and reasons — not memory content — so an audit entry cannot resurrect
deleted text.

### Memory as untrusted data (Phase 3 wiring)

- Retrieved memories are injected inside a delimited block prefixed with a standing
  instruction that the content is data, not instructions.
- Memory writes derived from model output are marked with actor `agent` and
  `validation_status='unverified'`; they cannot silently become `verified`.
- Memory content can never alter the system prompt, the tool policy, or the
  authorization rules — those are assembled server-side from configuration, not from
  stored text.

### Deployment (if ever exposed beyond loopback)

- Authentication, per-user namespaces, CSRF protection, and rate limiting are
  **not implemented** and are required before any non-local deployment. The current
  bind address (`127.0.0.1`) and the absence of a public URL are the only controls
  keeping the API private.

## Repository hygiene

- `.env`, `data/`, `*.db`, and test output are gitignored.
- No credentials are committed; `.env.example` contains placeholders only.
- CI runs lint, typecheck, and tests with the deterministic provider, so no secrets
  are needed to validate a pull request.
