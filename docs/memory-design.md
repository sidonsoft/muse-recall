# Memory design

The memory engine is implemented. This document describes the storage substrate, the
lifecycle rules, and the retrieval algorithm **as built**, including the places where
reality forced a design change.

## Principles

1. **Memory is curated, not dumped.** A conversation transcript is not a memory.
   Entries are typed, scoped, sourced, and scored.
2. **History is append-only.** Corrections never overwrite the past; they add a
   supersession edge and a history row.
3. **Deletion is not supersession.** Superseded memory remains auditable; deleted
   memory vanishes from retrieval. Conflating the two is how memory systems end up
   asserting stale facts.
4. **Retrieval must be explainable.** Every retrieved memory carries the component
   scores and an evidence sentence, so an action can be justified after the fact.

## Schema (migrations 1–2)

### `memories`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `type` | TEXT | `preference`, `project`, `technical_decision`, `constraint`, `verified_solution`, `failed_approach`, `unfinished_task`, `goal`, `correction`, `contextual_fact` |
| `scope` | TEXT | `global` or `project` |
| `project_id` | TEXT → `projects.id` | Required for project scope, `ON DELETE CASCADE` |
| `content` | TEXT | The claim, 1–8,000 chars |
| `source_session_id`, `source_reference` | TEXT | Provenance |
| `confidence` | REAL | `CHECK 0 ≤ confidence ≤ 1` |
| `validation_status` | TEXT | `unverified` \| `verified` \| `disputed` |
| `status` | TEXT | `active` \| `superseded` \| `deleted` \| `expired` |
| `created_at`, `updated_at`, `expires_at` | TEXT | ISO-8601 |
| `content_hash` | TEXT | SHA-256 fingerprint for dedupe |
| `tags` | TEXT | JSON array, lowercase kebab-case |
| `superseded_by` | TEXT → `memories.id` | The record that replaced this one (migration 2) |

Database-enforced invariants:

- a project-scoped row must name an existing project;
- confidence is a probability;
- lifecycle and validation vocabularies are closed sets;
- deleting a project cascades to its memories.

### `memory_supersessions`

`(new_id, old_id, created_at)`, primary key on the pair. One correction can replace
several records. Edges are never mutated, only inserted.

### `memory_history`

Append-only: `action` (`created`, `updated`, `superseded`, `deleted`, `expired`,
`purged`), `previous_status`, `next_status`, `reason`, `actor`, `at`. Ordered by
`at, rowid` so two events in the same millisecond keep insertion order.

### `memory_fts`

FTS5 over `content` and `tags` (`unicode61 remove_diacritics 2`), `memory_id`
unindexed, kept in sync by triggers on insert, content/tag update, and hard delete.

**A soft delete removes the FTS row explicitly, in the same transaction.** Status
changes deliberately do not touch the index, so a superseded memory stays searchable
for audit; the delete path must clean up. This is tested (`removes content from every
read path and from the FTS index`).

## Lifecycle

| Transition | Retrieval-visible? | Reversible? |
| --- | --- | --- |
| `active` | yes | — |
| `superseded` | **no** (audit only) | yes, by another correction |
| `expired` | no (also filtered by `expires_at`) | yes |
| `deleted` | no, and out of FTS | **no, through the API** |
| purged (hard) | no, bytes removed | no |

`expireStale()` runs at server start, so a deadline that passed while the server was
down is enforced before the next retrieval.

## Deduplication

Fingerprint: SHA-256 over `type \0 scope \0 project_id \0 normalise(content)`, where
normalise applies NFKC, collapses whitespace, trims, and lowercases.

`create()` runs inside `BEGIN IMMEDIATE`; the lookup and the insert cannot interleave
with another writer. On a hit, the existing active record is returned with
`created: false`. Editing a memory into a duplicate of another active record is a 409
(`memory_conflict`) rather than a silent merge.

## Correction / supersession

One transaction:

1. Load every target; a missing or deleted target is `memory_not_found`.
2. If every target is already inactive, look for one active memory whose supersession
   edges cover them all. If it exists **and the requested content matches it**, this is a
   retried request → return it with `created: false`. Otherwise → 409 naming the record
   to correct instead. (This guard was added after a test showed the naive version
   silently ignored a different correction — see D013.)
3. If targets mix active and inactive → 409.
4. Reuse an existing active memory with the same fingerprint, or insert the replacement.
5. Insert supersession edges, flip targets to `superseded` with `superseded_by`, append
   history rows with the user's reason.

A failure at any step rolls the whole transaction back — tested by forcing a trigger to
abort midway and asserting no partial row survives.

## Retrieval (implemented)

```
hard filters (SQL): status = 'active', not expired, scope, project, types
        ↓
candidates: FTS5 bm25 (max 200)  +  pinned constraints/goals in scope
        ↓
score = 0.40·relevance + 0.20·scope + 0.15·confidence
      + 0.10·validation + 0.10·recency + 0.05·type_priority
        ↓
dedupe by content fingerprint, then select:
    2 reserved slots for pinned → remaining by score
        ↓
budget: ≤ 8 memories, ≤ 4,000 chars, ≤ 1,000 chars each (truncate, don't drop)
        ↓
sort by score; return results + metadata + evidence
```

Component definitions:

| Component | Value |
| --- | --- |
| `relevance` | `-bm25 / max(-bm25)` over candidates; `0` when there is no query text, and in that case its weight is dropped and the rest renormalised |
| `scope` | project match `1.0`, global `0.65` |
| `confidence` | stored confidence |
| `validation` | verified `1.0`, unverified `0.6`, disputed `0.2` |
| `recency` | `0.5 ^ (age_days / half_life[type])` |
| `type_priority` | constraint `1.0` … contextual_fact `0.4` |

Per-type recency half-lives (days): `constraint` 365, `preference` 180, `goal` 180,
`verified_solution` 90, `failed_approach` 90, `project` 60, `technical_decision` 30,
`correction` 30, `unfinished_task` 14, `contextual_fact` 7.

### The pinned-slot change

The first implementation ranked **all** pinned memories first. The benchmark showed
why that is wrong: a project with eight constraints filled the entire budget and
retrieval accuracy fell to 17%. The fix reserves at most two slots, then fills the rest
by score, and sorts the final selection by score so the top result is the best match.
Accuracy rose to 100% on the same corpus. This is recorded as D015 because it is the
kind of trade-off the design document should have caught earlier.

### Why budgets are configuration

`max_memories`, `max_characters`, and `max_memory_characters` have defaults (8 / 4,000 /
1,000) but are environment-configurable and overridable per request. A different
deployment with a bigger context window should raise them rather than patch code.

`max_characters` is a **rendered** budget: it includes HTML escaping, provenance headers,
block delimiters, the standing safety wording, and the two-block layouts used by chat
and Forge. `max_memory_characters` remains the per-record raw-content cap. Retrieval
drops a record that would make any supported layout exceed the rendered budget rather
than slicing escaped text or emitting an oversized prompt.

## Context rendering

`formatMemoryContext` wraps results in `<retrieved_memories>` with a standing statement
that the contents are data, not instructions, and returns exact character and estimated
token counts. Chat and Forge use the same renderer for their constraint/general blocks;
retrieval charges the largest supported layout. Tests assert exact rendered accounting,
that ampersands/angle brackets are escaped losslessly without cutting an entity, and
that a memory containing "ignore previous instructions" appears after the warning and
never leaves the block.

## Testing map

| Invariant | Test file |
| --- | --- |
| Persistence across restart | `tests/unit/memory-engine-phase2.test.ts` |
| Deduplication incl. normalisation | same |
| Correction chain, multi-target, idempotent replay | same |
| Transaction rollback under forced failure | same |
| Deletion removes content and FTS entry | same |
| Project isolation | same |
| Budgets, truncation, pinned inclusion | same |
| Ranking determinism and component sum | same |
| Invalid input rejection | same |
| Concurrent writers on two connections | same |
| FTS query sanitisation | `tests/unit/memory-context.test.ts` |
| Context block safety and accounting | same |
| HTTP contract for every endpoint | `tests/integration/memories-api.test.ts` |
| Retrieval benchmark | `scripts/benchmark-retrieval.ts` |
