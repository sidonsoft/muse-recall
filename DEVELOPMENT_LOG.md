# Development Log — Muse Recall

**Project:** Muse Recall — a local-first memory companion for Meta Muse
**Event:** Meta Global AI Developer Hackathon (remote, Oct 26 – Nov 4, 2026 ET)
**Repository:** https://github.com/sidonsoft/muse-recall (branch `main`)
**Local working copy:** `/Users/burnz/projects/muse-memory-lab`
**Checkpoint scope:** Phase 1 and Phase 2 are committed. Phase 3 is **not** part of this
checkpoint.

> **Naming note.** The submission and repository are named **Muse Recall**. Internal
> package identifiers (`@mml/*`), database defaults, and some documents still use the
> earlier working name “Muse Memory Lab”. The names refer to the same codebase; identifiers
> were not rewritten because Phase 1 and Phase 2 commits are already published history.

---

## Development environment

| Item | Value |
| --- | --- |
| OS | macOS (darwin, arm64) |
| Node.js | v26.8.1 |
| pnpm | 10.32.1 |
| TypeScript | 7.0.2 |
| Muse Code CLI | 1.4.13 (1.4.13-R6996.1) |
| SQLite | 3.53.4 (bundled with `node:sqlite`, FTS5 enabled) |
| Browser verification | Google Chrome via `playwright-core` |
| Timezone | Australia/Brisbane (UTC+10) |

---

## Phase 1 — Muse CLI integration and foundation

**Commit:** `349d86c5943ea6d763fab89b5e721389d730db56`

### Implemented

- pnpm monorepo: `apps/{server,web}`, `packages/{shared,memory-engine,muse-provider}`.
- Fastify 5 API with a uniform response envelope and validated configuration.
- SQLite persistence through Node's built-in `node:sqlite` (no native build), with a
  versioned migration runner and an FTS5 index.
- Shared Zod contracts used by server, client, and storage.
- `ModelProvider` abstraction with a **Muse Code CLI adapter** built on the verified
  `muse exec --json` interface: JSONL frame parsing, token streaming, usage aggregation,
  hermetic invocation flags, a hard timeout with process termination, and coded errors.
- Deterministic offline provider, explicitly labelled as “not a model” so it can never be
  mistaken for Muse.
- React/Vite/Tailwind interface with a System screen, live Muse check, provider bench, and
  a context inspector.

### Verified (re-run against the commit, 2026-10-27)

```
cd <repo> && git worktree add /tmp/mml-phase1 349d86c --detach
cd /tmp/mml-phase1 && pnpm install && pnpm test
  → 70 passed | 3 skipped (73)

MML_LIVE_MUSE=1 pnpm test
  → 72 passed (72)   [3 real Muse calls: inference, structured output, streaming]
```

The live run exercises the installed Muse Code 1.4.13 binary and performs real inference.
The Muse integration facts (models, flags, frame types, measured overhead) are recorded in
[`docs/muse-integration.md`](../muse-integration.md) at this commit.

**Historical note:** the original 72-test run happened before this checkpoint. The figures
above are from a re-run at the exact commit, which is stronger evidence than a transcribed
console log.

---

## Phase 2 — Persistent memory engine

**Commit:** `8579c26a4d83a671c914fe3a35bb9d081b1ae2cd`

### Implemented

- Transactional memory writes (`BEGIN IMMEDIATE`) with provenance, scope, confidence,
  validation status, tags, and expiry.
- SHA-256 deduplication over normalised content, type, scope, and project.
- Correction and supersession as one transaction, with idempotent replay only when the
  retried request asks for the same fact.
- Soft deletion that removes the FTS row and hides the record from every read path.
- Append-only history, scoped retrieval with weighted relevance scoring (bm25, scope,
  confidence, validation, per-type recency, type priority), pinned constraints, and
  configurable context budgets.
- Per-result component scores and evidence sentences, plus the Memory Inspector UI.

### Verified (re-run against the commit, 2026-10-27)

```
git worktree add /tmp/mml-phase2 8579c26 --detach
cd /tmp/mml-phase2 && pnpm install && pnpm test
  → 162 passed | 3 skipped (165)

MML_LIVE_MUSE=1 pnpm test
  → 164 passed (164)

npx tsx scripts/benchmark-retrieval.ts
  → hit@8 30/30 (100%) · correction 12/12 (100%) · stale 0 · deleted retrievable 0
  → latency mean 0.2557 ms · p50 0.195 ms · p95 0.511 ms
```

**Reported at the time:** p95 0.429 ms. The re-run measured p95 0.511 ms on the same
commit — sub-millisecond retrieval timing varies with machine load. Both figures are
recorded; neither is presented as a fixed constant.

The memory-context injection safety property (memories are delimited data, never
instructions) is covered by tests in `tests/unit/memory-context.test.ts` at this commit.

---

## Timeline (from Git metadata)

| Phase | Commit | Author date (+10:00) | Committer date (+10:00) | Description | Verification |
| --- | --- | --- | --- | --- | --- |
| 1 | `349d86c` | 2026-10-27 07:45:13 | 2026-10-27 07:45:13 | Foundation, Muse CLI integration | Re-run: 72 tests pass with live Muse |
| 2 | `8579c26` | 2026-10-27 08:09:38 | 2026-10-27 08:09:38 | Persistent memory engine | Re-run: 164 tests pass with live Muse; benchmark reproduced |

Full metadata, refs, and the tracked file list at this checkpoint are captured in
[`git-history.txt`](git-history.txt), which was written **before** the documentation commit
so it reflects the pre-checkpoint history.

### What the timestamps do and do not prove

These are **local** commit timestamps. Publishing them to GitHub adds a server-side
publication record, but it does not independently prove that the work was performed at the
authoring time. Judges can inspect the history, the code, and the reproducible verification
commands; the timestamps alone are not offered as proof of session activity.

No commit metadata was modified, squashed, amended, or reordered for this checkpoint.

---

## Reproducing the verification

```bash
git clone https://github.com/sidonsoft/muse-recall.git
cd muse-recall
pnpm install
pnpm test                      # Phases 1–2 suite at the checked-out commit
MML_LIVE_MUSE=1 pnpm test      # adds live Muse integration tests
```

Per-commit verification instructions are in
[`docs/hackathon-evidence/README.md`](docs/hackathon-evidence/README.md).
