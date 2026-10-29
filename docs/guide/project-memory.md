# Project memory

Project memory is the part of Muse Recall that survives a session. A decision is a structured
record, not a chat transcript: it has a type, a scope, provenance, confidence, a validation state
and an append-only history. The same memory engine serves the chat agent and HTML Studio.

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)

## The record

| Field | Meaning |
| --- | --- |
| `type` | `preference`, `project`, `technical_decision`, `constraint`, `verified_solution`, `failed_approach`, `unfinished_task`, `goal`, `correction` or `contextual_fact`. |
| `scope` + `project_id` | `project` records apply inside one project; `global` records apply everywhere. A project-scoped record requires a `project_id`. |
| `content` | The claim, 1–8,000 characters. |
| `source` | Optional `session_id` and a human-readable `reference`, such as `studio:project-memory` or `forge:<job-id>`. |
| `confidence` | A probability from 0 to 1. |
| `validation_status` | `unverified`, `verified` or `disputed` — how much the fact itself is trusted. |
| `status` | `active`, `superseded`, `expired` or `deleted` — whether the record is still current. |
| `tags` | Up to 16 lowercase kebab-case tags. |
| `expires_at` | Optional ISO timestamp. Expired records are excluded from retrieval. |

Validation and lifecycle are orthogonal. A `verified` fact can still be `superseded`; an
`unverified` note can still be the current active decision. Corrections change the lifecycle, not
the truth label.

## Create a decision

There are three entry points, all using the same validated HTTP API:

- **HTML Studio → Project memory → Add decision.** Writes a project-scoped decision of type
  `technical_decision`, `constraint` or `preference`, with confidence 0.9, `verified`, and source
  reference `studio:project-memory`. This is the shortest path before generating.
- **Memory → New memory.** Writes a project-scoped record with any memory type, an editable project
  id, validation status and confidence. Source reference is `inspector`.
- **`POST /api/memories`.** Supports every type and both scopes.

```bash
curl -sS -X POST http://127.0.0.1:8787/api/memories \
  -H 'content-type: application/json' \
  -d '{
    "type": "constraint",
    "scope": "project",
    "project_id": "reading-nook",
    "content": "Never add a countdown timer, flashing effect, or mistake penalty.",
    "confidence": 0.95,
    "validation_status": "verified",
    "source": { "session_id": null, "reference": "manual:design-review" }
  }'
```

The response is `{ "ok": true, "data": { "memory": {...}, "created": true } }` and the HTTP status
is `201` when a row was written. If an **active** record already has the same content fingerprint,
the existing record is returned with `created: false` and status `200`; a retried request does not
create a duplicate. The fingerprint is SHA-256 over
`type | scope | project_id | normalised(content)`, where normalisation applies NFKC, collapses
whitespace, trims and lowercases.

A project row is created on demand. There is no separate project-registration step.

## Edit versus correct

| Intent | Use | Result |
| --- | --- | --- |
| Fix a typo or adjust confidence/tags on the same decision | `PATCH /api/memories/:id` (Memory → Edit) | The record is updated in place and an `updated` history entry is appended. |
| Change what the project should do | `POST /api/memories/:id/correct` (Memory → Correct) | A replacement record is created or reused, the old record becomes `superseded`, and the supersession edge is recorded. The old record stays auditable but is no longer retrieved. |
| Remove a decision entirely | `DELETE /api/memories/:id` | Soft delete: the FTS row is removed and the record disappears from every read endpoint. It is not restorable through the API. |

Editing content into a duplicate of another active record is rejected with
`409 memory_conflict`; use a correction to make the replacement explicit.

## Correction and supersession

A correction is one database transaction:

1. Load every target. A missing or deleted target is `memory_not_found`.
2. Reject a mix of active and already-inactive targets.
3. Reuse an active memory with the same replacement fingerprint, or insert the replacement.
4. Insert one supersession edge per target, flip each target to `superseded` with `superseded_by`,
   and append one history row per target with the user's reason.
5. Return the replacement, the refreshed superseded records, and `created`.

Any failure rolls the whole transaction back. A retried correction with the same replacement
content is idempotent: it returns the existing replacement with `created: false` and does not fork
the chain. A *different* correction against already-inactive targets is a `409` that names the
current record to correct instead.

```bash
curl -sS -X POST "http://127.0.0.1:8787/api/memories/$ID/correct" \
  -H 'content-type: application/json' \
  -d '{
    "type": "preference",
    "scope": "project",
    "project_id": "reading-nook",
    "content": "Use a cool ocean palette: primary accent #4EA8DE and dark text #102A43.",
    "confidence": 0.95,
    "validation_status": "verified",
    "reason": "Creative direction changed from sunset to ocean."
  }'
```

The memory in the URL is always a target. Add `supersedes: ["<uuid>", ...]` to replace several
contradictory records in one transaction. The **N3 follow-up fix** re-reads the targets after the
`UPDATE`, so the immediate response carries the persisted lifecycle fields — a `status` of
`superseded`, a non-null `superseded_by`, and the new `updated_at` — and matches a fresh
`GET /api/memories/:id`. The replay path does the same.

### What a correction does not do

A correction changes future retrieval. It does **not** rewrite an approved HTML artifact, and it
does not make a running application change itself. After a correction, ask for the application
change in HTML Studio and review the resulting job. The recorded demo shows this: the correction
releases the old palette from memory, but the model still keeps the old stylesheet until the user
explicitly requests the current art direction (live-run finding F6, still by design). See the
[repeat live run](../hackathon-evidence/live-dsh-run-2026-10-29/after/AFTER_FIXES.md).

### Deletion and expiry

Deletion is final through the API by design. The tombstone remains in SQLite for integrity, but no
read route exposes deleted content. `expires_at` is enforced during retrieval; `MEMORY_SWEEP_ON_START`
marks stale records `expired` when the server starts. There is no background expiry scheduler.

## Retrieval

Retrieval runs in three phases and performs no writes, so the preview endpoint and benchmarks can
call the same path.

1. **Hard filters in SQL.** Only `active`, unexpired records in the requested project (plus globals
   when `include_global` is true) and optional type filters enter ranking.
2. **Candidates.** FTS5 `bm25` over content and tags, capped at 200 candidates, plus pinned memory
   types that are active in scope even when the query shares no keywords. A precise (all-token)
   query is relaxed to any-token when it yields fewer than three candidates. If it still yields
   none, retrieval falls back to recent active memories in scope and says so in
   `metadata.query_mode`.
3. **Score and select.**

```
score = 0.40·relevance + 0.20·scope + 0.15·confidence
      + 0.10·validation + 0.10·recency + 0.05·type_priority
```

`relevance` is normalized bm25; if there is no query text, its weight is dropped and the remaining
weights renormalize. `scope` is 1.0 for a project match and 0.65 for global. Validation scores are
verified 1.0, unverified 0.6, disputed 0.2. Recency uses a per-type half-life (for example
constraint 365 days, technical decision 30 days, contextual fact 7 days).

Up to **two slots** are reserved for pinned types so a decision cannot be lost merely because the
wording missed it. Remaining slots are filled by score; the final result is sorted by score. Exact
content duplicates consume one slot, not two. Every result exposes its component scores and an
evidence sentence, and the metadata reports candidate/selected counts, exclusions by reason,
latency, truncation count, weights and `memory_ids`.

`max_characters` is a **rendered** budget, not a sum of raw content. It includes HTML escaping,
provenance headers, delimiters, safety wording and the two-block consumer layouts. A record that
would exceed the budget is skipped; a long individual record is truncated at
`max_memory_characters` rather than dropped. If every record is too large, the highest-priority
record is kept as a safely truncated prefix instead of returning an empty context.

### Retrieval profiles

| Mode | Pinned types | Default budget (count / rendered chars / per record) | Used by |
| --- | --- | --- | --- |
| `default` | `constraint`, `goal` | 8 / 4,000 / 1,000 | Chat turns and generic preview callers. |
| `forge` | `constraint`, `goal`, `preference`, `technical_decision` | 6 / 3,000 / 1,000 | HTML Studio generate and modify jobs. |

Budgets are configuration, not architecture. Installation defaults come from
`MEMORY_MAX_MEMORIES`, `MEMORY_MAX_CHARACTERS` and `MEMORY_MAX_MEMORY_CHARACTERS`; a request may
override count and character caps for an experiment. The `forge` profile is deliberate: Studio
prompts depend on saved design decisions as well as constraints and goals, and the tighter budget
keeps the prompt bounded.

### Preview and the Forge mode fix

`POST /api/retrieval/preview` returns both the ranking and the exact rendered block:

```bash
curl -sS -X POST http://127.0.0.1:8787/api/retrieval/preview \
  -H 'content-type: application/json' \
  -d '{"project_id":"reading-nook","query":"change the palette","mode":"forge"}'
```

The **N1 follow-up fix** added `mode: "forge"` to the preview. It applies the Forge pinned types and
the 6 / 3,000 budget, and `context.text` is byte-for-byte the block `buildForgePrompt` injects
(`<project_constraints>` plus `<project_memory_data>`), with `characters` equal to
`metadata.characters_used`. The Memory screen's retrieval explainer defaults to **Forge (Studio)**
and lets you override the count/character caps for that preview only. `mode: "default"` keeps the
installation default budget (8 / 4,000 out of the box) and the canonical `<retrieved_memories>`
block.

This matters because a preview that selected a different set from the production job would explain
the wrong context. A Forge job records the ids it actually received in `memory_ids`, and the
prompt's SHA-256 is recorded when the prompt is written.

## How memory reaches a prompt

Retrieved records are rendered as clearly delimited **data**, not instructions:

- Each block carries a standing statement that the contents are reference only and cannot grant
  permissions, change the execution contract or override application policy.
- Each record carries its UUID, type, scope, validation status, confidence and source reference.
- `<`, `>` and `&` are escaped before injection, so a stored `</project_constraints>` stays visible
  text rather than closing the block.
- Chat uses `<project_constraints>` for constraints/goals and `<retrieved_memories>` for the rest.
  Forge uses `<project_constraints>` and `<project_memory_data>`. The preview's canonical block is
  `<retrieved_memories>`.

The engine does not treat a retrieved instruction as authority. The model still has to be robust;
the approval step is the control for generated actions.

## Decision Guard and memory

Decision Guard evaluates only the memories **recorded on the job** (`memory_ids`), only when they are
still active, project-scoped and owned by the same project. Superseded records are resolved
separately for the superseded-palette rule. It supports five source-pattern checks:
countdown mechanics, flashing effects, mistake penalties, superseded palettes and colour-only cues.

The Guard is **advisory**. A `BLOCK` result is a finding shown to the reviewer; it is never added to
`validation.ok`, never used to authorise or deny approval, and never disables the human's decision.
If no supported rule applies, the honest result is `not_verified`, not `PASS`. See
[HTML Studio](html-studio.md) for the reviewer-facing workflow and
[Limitations](limitations.md) for the residual risk.

## Inspect and audit

| Request | Purpose |
| --- | --- |
| `GET /api/memories?project_id=<id>&status=active,superseded` | List and filter; deleted records are never returned. |
| `GET /api/memories/:id` | Record, history, supersession chain and replacement. |
| `GET /api/memories/:id/history` | Append-only lifecycle audit. |
| `GET /api/memories/stats` | Counts by lifecycle status and type. |
| `GET /api/projects` | Project scope anchors. |
| `POST /api/retrieval/preview` | Ranking, evidence and exact prompt block; use `mode: "forge"` for Studio parity. |

From the UI, **Memory** shows the same data: filters, score components, provenance, correction
history, and the retrieval explainer. The API envelope is always `{ ok, data }` or
`{ ok: false, error }`; see the [README API table](../../README.md#api).

## Related references

- [Memory design](../memory-design.md) — schema, invariants, pinned-slot rationale, testing map
- [Architecture](architecture.md) — where memory sits in the local system
- [HTML Studio](html-studio.md) — how retrieved decisions are used in a job
- [Known issues](../KNOWN_ISSUES.md) — keyword retrieval, deletion, capture heuristics
- [Phase 12A](../PHASE12_MEMORY_VALIDATION.md) — the sunset-to-ocean correction evidence
- [Phase 17 results](../hackathon-evidence/phase17/RESULTS.md) — the current four-arm behavioural test

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
