# Next steps

## Phase 4 — Dynamic interactive interfaces (current)

**Goal:** Muse generates a validated, interactive interface for the task at hand; the user
interacts with it; structured events return to the agent and continue an authorized workflow.

**Acceptance criteria:**
1. Muse can produce a declarative UI specification that validates against a strict schema.
2. The interface renders from a fixed component registry — no model-authored JavaScript.
3. Submitting the interface returns structured data to the agent, which responds.
4. Submitted values can be stored as project memory with provenance.
5. An unknown component, an invalid field, or an oversized spec is rejected, not rendered.
6. The rendered interface and its submission are inspectable afterwards.

### Design

- **`packages/ui-protocol`** — Zod schemas for surfaces, blocks, fields, and events, plus a
  validator that enforces the registry, limits, and safety rules.
- **Component registry** — `heading`, `text`, `status`, `progress`, `tasklist`, `table`,
  `card`, `form`, `button`. Each maps to one React component; anything else fails validation.
- **Generation** — `POST /api/sessions/:id/ui` calls Muse with `--output-schema` (bounded,
  one retry on invalid JSON), validates, and stores the spec.
- **Rendering** — the surface is stored against the assistant message and rendered inline in
  the transcript.
- **Events** — `POST /api/sessions/:id/ui/:surfaceId/events` validates the submission against
  the surface's own fields, records the event, optionally stores a memory, and runs a turn
  with the structured summary.
- **Safety** — no HTML, no JavaScript, no arbitrary URLs; fields are enums or bounded
  strings; submit actions are a closed set.

### Work items

1. `packages/ui-protocol`: schemas, registry, validator, prompt schema for Muse, tests.
2. Migration 5: `ui_surfaces` (session, message, spec, status, created_at) and `ui_events`.
3. `apps/server/src/routes/ui.ts`: generate, submit, inspect.
4. `apps/web`: renderer, form components, event submission, inline transcript integration.
5. Tests: validation rejects unknown blocks/oversized specs; event validation; API flow with
   the deterministic provider; UI verification with real Muse.
6. Demo D: "Help me plan a game" → form → submit → plan stored as project memory → new
   session recalls it.

### Sequencing

```
schemas + validator  →  tests
        ↓
generation route     →  API tests (deterministic provider)
        ↓
renderer + submit    →  browser verification
        ↓
Demo D with real Muse →  docs/demo-script.md
```

## Phase 5 — Authorized agent tools (after Phase 4)

Tool registry with declared side effects, an approval policy, workspace confinement, and an
append-only audit log. Every tool call — from chat or from a generated interface — passes
through the same authorization path.

## Phase 6 — Evaluation and submission

Run the baseline vs memory-enabled comparison through `tests/evaluation/harness.ts`, record
the final demo video and screenshots, confirm repository visibility for judging, and freeze.
