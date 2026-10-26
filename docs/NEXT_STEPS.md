# Next steps

## Phase 5 — Authorized agent tools (current)

**Goal:** the agent can *do* work, not just talk about it — under an explicit permission model
and with an audit trail.

**Scope:**
1. `packages/tool-runtime`: registry entries declare `id`, description, JSON input schema,
   side-effect class (`read` | `write` | `external`), and whether confirmation is required.
2. Workspace tools confined to `WORKSPACE_ROOT`: list, read, write (write requires
   confirmation), and a read-only command runner with a timeout.
3. Approval policy: `TOOL_APPROVAL_POLICY=always` means every `write`/`external` call needs
   explicit user confirmation; `never` is for tests only and is refused when not in test mode.
4. A tool turn protocol: the model returns a structured tool request (bounded schema, one
   call at a time), the harness validates, asks for approval if required, executes, appends
   the result, and continues — with a hard step limit.
5. Audit log: every call (inputs, decision, result summary, duration, actor) persisted and
   inspectable in the UI.
6. Interface events may request an authorized tool only through the same registry and
   approval path.

**Acceptance criteria:** an authorized read succeeds; a write is blocked without approval;
an unauthorized path or command is refused; every call appears in the audit log; tests cover
approval, refusal, timeout, and path traversal.

## Phase 6 — Evaluation and submission

- Run the baseline vs memory-enabled comparison through `tests/evaluation/harness.ts` with
  several tasks and report measured deltas.
- Record the final demo video and screenshots (memory across sessions, correction, generated
  interface).
- Confirm repository visibility for judging and update `DEVELOPMENT_LOG.md`.
- Freeze and submit.
