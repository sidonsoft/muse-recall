# Memory design

Phase 1 ships the **storage substrate and its invariants**. Retrieval, dedupe, and
the correction workflow are Phase 2; this document states both what exists and the
design those features will implement, clearly marked.

## Principles

1. **Memory is curated, not dumped.** A conversation transcript is not a memory.
   Entries are typed, scoped, sourced, and scored.
2. **History is append-only.** Corrections never overwrite the past; they add a
   supersession edge and a history row.
3. **Deletion is not supersession.** Superseded memory remains auditable; deleted
   memory must vanish from retrieval. Conflating the two is how memory systems end
   up asserting stale facts.
4. **Retrieval must be explainable.** Every retrieved memory carries the reason it
   ranked where it did, so the UI can justify an action.

## Schema (implemented — migration 1)

### `memories`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `type` | TEXT | `preference`, `project`, `technical_decision`, `constraint`, `verified_solution`, `failed_approach`, `unfinished_task`, `goal`, `correction`, `contextual_fact` |
| `scope` | TEXT | `global` or `project` |
| `project_id` | TEXT → `projects.id` | Required for project scope, `ON DELETE CASCADE` |
| `content` | TEXT | The claim, 1–8,000 chars |
| `source_session_id`, `source_reference` | TEXT | Provenance (nullable, always present) |
| `confidence` | REAL | `CHECK 0 ≤ confidence ≤ 1` |
| `validation_status` | TEXT | `unverified` \| `verified` \| `disputed` |
| `status` | TEXT | `active` \| `superseded` \| `deleted` \| `expired` |
| `created_at`, `updated_at`, `expires_at` | TEXT | ISO-8601 |
| `content_hash` | TEXT | Normalised fingerprint for dedupe |
| `tags` | TEXT | JSON array of lowercase kebab-case tags |

Enforced invariants (by the database, not by convention):

- a project-scoped row **must** name an existing project
  (`CHECK (scope = 'global' OR project_id IS NOT NULL)` plus the foreign key);
- confidence is a probability;
- lifecycle and validation vocabularies are closed sets;
- deleting a project cascades to its memories.

### `memory_supersessions`

`(new_id, old_id, created_at)` — one row per replaced memory, primary key on the
pair. A single correction can replace several records, and the old row is never
mutated except for its `status`.

### `memory_history`

Append-only audit: `action` (`created`, `updated`, `superseded`, `deleted`,
`expired`, `purged`), `previous_status`, `next_status`, human-readable `reason`,
`actor` (`user` | `agent` | `system`), timestamp.

### `memory_fts`

FTS5 virtual table over `content` and `tags`, `tokenize='unicode61
remove_diacritics 2'`, with `memory_id` unindexed. Kept in sync by triggers on
insert, on content/tag update, and on hard delete.

**Soft delete removes the FTS row explicitly.** Status changes intentionally do not
touch the index (so a `superseded` memory remains searchable for audit), but the
delete path must call `DELETE FROM memory_fts WHERE memory_id = ?` in the same
transaction. Phase 2 must implement that and test it — a tombstone that still
matches a keyword query is a correctness bug, not a cosmetic one.

## Lifecycle

```
                 ┌──────────── correction ────────────┐
                 │                                    ▼
  create ──► active ──expire by policy──► expired   superseded
                 │                                    ▲
                 └──── soft delete ──► deleted        │
                                          │   supersession edge
                                     purge│   from a newer memory
                                          ▼
                                       (gone)
```

Rules:

| Transition | Retrieval-visible? | Reversible? |
| --- | --- | --- |
| `active` | yes | — |
| `superseded` | **no** (audit only) | yes, by another correction |
| `expired` | no | yes |
| `deleted` (soft) | no, and out of FTS | yes, by restore |
| purged (hard) | no, bytes removed | no |

## Retrieval design (Phase 2 — not yet implemented)

Scoring will be a weighted sum over independently observable signals, so the
inspector can show *why* something ranked:

```
score = 0.40 · relevance      (FTS5 bm25, normalised)
      + 0.20 · scope_match    (project exact > global > other project = 0)
      + 0.15 · confidence
      + 0.10 · validation     (verified 1.0, unverified 0.6, disputed 0.2)
      + 0.10 · recency        (exponential decay, configurable half-life)
      + 0.05 · type_priority  (constraints and goals above contextual facts)
```

Hard filters run in SQL first: `status = 'active'`, scope in (project, global),
`expires_at IS NULL OR expires_at > now`. Then ranking, then a **context budget**:

- max memories per turn (default 8);
- max characters injected (default ~4,000, roughly 1k tokens);
- always include active `constraint` and `goal` records for the project even if
  relevance is marginal, because violating a constraint is worse than a slightly
  longer prompt.

Each retrieval result carries `rank_components` and a one-line `evidence` string
(e.g. *"matches 'sqlite' + project scope + verified"*), which is what the inspector
renders.

**Semantic retrieval** is a pluggable embedding provider. It must degrade to keyword
search without error when unavailable — an optional dependency may never be a hard
one.

### Deduplication

Before insert, compute `content_hash` over normalised text (case-folded, whitespace
collapsed) plus type/scope/project. On collision:

- identical hash + active status → return the existing memory, bump `updated_at`
  only if provenance or confidence improved;
- near-duplicate (Phase 2, token Jaccard ≥ threshold) → surface as a candidate
  correction rather than silently adding a second copy.

### Correction workflow

`supersede(oldIds[], newMemory, reason, actor)` runs in one transaction:

1. insert the new memory (`status='active'`);
2. insert supersession edges;
3. set each old row to `status='superseded'`, `superseded_by = new.id`;
4. append `memory_history` rows for each old row (`action='superseded'`, with
   `previous_status` and the reason);
5. append a `created` history row for the new memory.

Retrieval then excludes the old rows automatically, and the inspector shows the
chain. This is the mechanism Demo B depends on.

### Retention

Policies are declarative per type: `expires_at` for time-boxed facts, and a sweep
that marks `active → expired` when the deadline passes. Expiry is a status change
with history, not a deletion. A separate purge job hard-deletes `deleted` rows older
than a retention window.

## Context hygiene

- Memory content is **delimited untrusted data** in prompts, never merged into
  system instructions. The formatter wraps it in a
  `<retrieved_memories>` block with a standing instruction to treat it as data.
- Memory text may contain prompt-injection attempts; they have no more authority
  than a web page.
- The engine records `retrieved_memory_ids` per turn so an action can be traced back
  to the memories that influenced it.

## Testing plan for Phase 2

| Invariant | Test |
| --- | --- |
| Scope isolation | A memory from project A never appears in project B's retrieval |
| Correction | After supersede, only the new memory is retrievable; the old one is in history |
| Deletion | Soft-deleted memory is not retrievable and does not match FTS |
| Dedupe | Identical content is not stored twice |
| Budget | Retrieval never exceeds the memory/character cap |
| Evidence | Every result has non-empty rank components summing to its score |
| Expiry | Past `expires_at` is excluded from retrieval and marked expired by the sweep |
