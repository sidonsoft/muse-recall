# Project status

**Last updated:** 2026-10-27
**Milestone:** Phase 2 — Persistent memory engine
**State:** Complete and verified

## Implemented

### Memory engine (`packages/memory-engine`)

- **Storage** — `MemoryEngine` over `node:sqlite`; every mutation runs inside
  `BEGIN IMMEDIATE`, so a check-then-write cannot interleave with another writer.
- **Create with provenance** — type, scope, project, source (session + reference),
  confidence, validation status, tags, optional expiry. Project scope anchors are
  created on demand (`ensureProject`) so the foreign key stays meaningful.
- **Deduplication** — SHA-256 over `type|scope|project|normalised content`; identical
  claims return the existing record (`created: false`) instead of inserting a
  duplicate. Casing and whitespace are normalised away.
- **Correction / supersession** — one transaction: insert or reuse the replacement,
  record supersession edges, flip old rows to `superseded`, append history. Replaying
  the identical correction is idempotent; correcting an already-superseded record with
  a *different* fact is a 409 pointing at the replacement.
- **Deletion** — soft delete removes the FTS row and every read path filters `deleted`
  out, so deleted content is not recoverable through the API. Tombstones remain
  internally for integrity. `purge` (maintenance only) accepts deleted/expired rows.
- **History** — append-only audit trail (`created`, `updated`, `superseded`,
  `deleted`, `expired`), ordered by insertion, with actor and user-supplied reason.
- **Retrieval** — SQL hard filters (status, scope, expiry, type) then six weighted
  components: relevance (FTS5 `bm25`), scope match, confidence, validation, recency
  (per-type exponential half-life), type priority. Pinned `constraint`/`goal`
  memories reserve up to two slots so they are never lost to wording.
- **Budgets** — max memories (8), max characters (4,000), max per-memory characters
  (1,000, truncated not dropped), all configurable via environment or per request.
- **Evidence** — every result carries `rank_components`, a weighted `score`, a
  human-readable `evidence` string, and `pinned`/`truncated` flags. Metadata reports
  candidate/selected/excluded counts, exclusions by reason, characters used, ids,
  latency and effective weights.
- **Context rendering** — `formatMemoryContext` produces a delimited
  `<retrieved_memories>` block labelled as data-not-instructions, with exact
  character and estimated-token accounting.
- **Retention** — `expireStale()` marks active memories past `expires_at` as expired
  with history; runs at startup.
- **Schema** — migration 2 adds `superseded_by`, plus scope/status, recency and
  supersession indexes.

### API (`apps/server`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/memories` | List/search with project, status, type, text and paging |
| `POST` | `/api/memories` | Create (201) or deduplicated replay (200) |
| `GET` | `/api/memories/:id` | Detail: record, provenance, history, supersession chain |
| `PATCH` | `/api/memories/:id` | In-place edit with history entry |
| `POST` | `/api/memories/:id/correct` | Transactional supersession |
| `DELETE` | `/api/memories/:id` | Soft delete with reason |
| `GET` | `/api/memories/:id/history` | Audit trail |
| `GET` | `/api/memories/stats` | Lifecycle counts by status and type |
| `GET` | `/api/projects` | Scope anchors for the inspector |
| `POST` | `/api/retrieval/preview` | Ranked results, evidence, and the exact prompt block |

Domain errors map to stable codes (`memory_not_found` → 404, `memory_conflict` → 409,
validation → 400). `/api/meta` now reports `memory_engine: complete`, phase 2, and
the retrieval configuration in force.

### UI (`apps/web`)

- **Memory Inspector** replacing the Phase 2 placeholder: search (debounced),
  project/status/type filters, lifecycle counters, memory cards, detail panel with
  provenance, tags, supersession links and a history timeline.
- **Correction workflow** — dedicated form (content, type, confidence, validation,
  reason) that supersedes and reports what changed.
- **Edit and delete** — in-place edit with an explicit warning that it rewrites the
  record; delete requires confirmation and states that the content becomes
  unrecoverable.
- **Retrieval explanation** — a second tab runs the real retrieval path and shows
  the ranked results, per-component score bars, evidence sentences, budget outcome
  and the exact prompt block with its estimated token cost.
- **Create** — a compact form so the inspector is usable without curl.
- Navigation badges now appear only for sections that are not implemented.

### Instrumentation (`scripts/`, `tests/evaluation/`)

- `pnpm bench:retrieval` — deterministic corpus, latency percentiles, selectivity,
  retrieval accuracy, correction accuracy, stale-memory rate.
- `pnpm bench:muse-overhead` — repeated real Muse calls measuring token variance and
  the marginal cost of a memory block.
- `tests/evaluation/harness.ts` — baseline vs memory-enabled runner with strict
  fairness rules and refusal to report token deltas without provider usage.
- `scripts/verify-ui.ts` — 18-check browser journey including the full memory
  workflow.

## Verified

Commands run on the reference machine (Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13,
SQLite 3.53.4 with FTS5).

| Command | Result |
| --- | --- |
| `pnpm run lint` | 0 errors |
| `pnpm run typecheck` | 5/5 projects clean |
| `pnpm test` | **162 passed**, 3 skipped (live suite opt-in) |
| `pnpm bench:retrieval` | accuracy 100% (30/30), correction 100% (12/12), stale rate 0.000%, latency p50 0.20 ms |
| `pnpm bench:muse-overhead` | 8 real calls; baseline 16,630 tokens (CV 0%), memory block +877 tokens |
| `pnpm exec tsx scripts/verify-ui.ts` | 18 checks passed, **zero console errors, zero HTTP errors** |
| `MML_LIVE_MUSE=1 pnpm test` | 164 passed, 1 skipped — includes 3 live Muse tests |

Screenshots: [system overview](assets/phase2-ui.png) ·
[memory detail with history](assets/phase2-ui-memory-detail.png) ·
[retrieval explanation](assets/phase2-ui-memory-retrieval.png).

Test breakdown: Phase 1 engine 15, Phase 2 engine 42, context/FTS 9, memory schemas 15,
provider 15, config 8, HTTP (Phase 1) 16, memory API 32, evaluation harness 9,
live Muse 3.

## Benchmark results

| Metric | Value |
| --- | --- |
| Retrieval latency (p50 / p95) | 0.20 ms / 0.43 ms |
| Mean candidates per query | 16.3 |
| Mean selected | 8.0 of 8 budget |
| Mean characters injected | 507 of 4,000 |
| Retrieval accuracy (hit@8) | 100% |
| Correction accuracy | 100% |
| Stale-memory retrieval rate | 0.000% |
| Deleted still retrievable | 0 |
| Muse baseline input tokens | 16,630 (identical across 5 calls) |
| Marginal cost of ~4k-char memory block | +877 tokens |

**Memory has not been shown to reduce total model tokens.** It adds ~877 tokens per
turn while removing the need to re-send history; the net depends on a baseline that
has not been measured yet. See [evaluation.md](evaluation.md).

## Failed / not attempted

- Nothing in Phase 2's scope failed.
- No restore-after-delete endpoint: by design, deletion is final through the API.
- No semantic/embedding retrieval: keyword FTS5 only (acceptance criteria met;
  embeddings are a later enhancement).
- Phase 3–6 features remain unbuilt and are reported as such by `/api/meta`.

## Blockers

None requiring user input.

## Next milestone

**Phase 3 — agent harness and conversational sessions.** Plan in
[NEXT_STEPS.md](NEXT_STEPS.md).
