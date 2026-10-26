# Hackathon evidence — index

This directory records how the Phase 1 and Phase 2 milestones were verified against the
committed history. It exists so a reviewer can check claims instead of trusting a summary.

## Commits under review

| Phase | Commit | Permalink |
| --- | --- | --- |
| Phase 1 — foundation and Muse CLI integration | `349d86c5943ea6d763fab89b5e721389d730db56` | https://github.com/sidonsoft/muse-recall/commit/349d86c5943ea6d763fab89b5e721389d730db56 |
| Phase 2 — persistent memory engine | `8579c26a4d83a671c914fe3a35bb9d081b1ae2cd` | https://github.com/sidonsoft/muse-recall/commit/8579c26a4d83a671c914fe3a35bb9d081b1ae2cd |
| Documentation checkpoint | see `git log --oneline -1` on `main` | https://github.com/sidonsoft/muse-recall/commits/main |

## Contents

| File | What it is |
| --- | --- |
| [`git-history.txt`](git-history.txt) | Full `git log --pretty=fuller`, refs, and the tracked file list, captured **before** the documentation commit |
| [`phase-verification.md`](phase-verification.md) | Each reported claim, the commit it applies to, the command used, and the observed result |
| [`requirements-review.md`](requirements-review.md) | What the official hackathon page does and does not state, plus open questions |
| [`../../DEVELOPMENT_LOG.md`](../../DEVELOPMENT_LOG.md) | Chronological development log with environment and milestone detail |

## How to verify

```bash
git clone https://github.com/sidonsoft/muse-recall.git
cd muse-recall

# Phase 1
git worktree add /tmp/verify-phase1 349d86c --detach
cd /tmp/verify-phase1 && pnpm install && pnpm test
MML_LIVE_MUSE=1 pnpm test      # requires a logged-in Muse CLI

# Phase 2
git worktree add /tmp/verify-phase2 8579c26 --detach
cd /tmp/verify-phase2 && pnpm install && pnpm test
MML_LIVE_MUSE=1 pnpm test
npx tsx scripts/benchmark-retrieval.ts
```

Expected results, as re-run on 2026-10-27:

| Check | Result |
| --- | --- |
| Phase 1 default suite | 70 passed, 3 skipped |
| Phase 1 live Muse suite | 72 passed |
| Phase 2 default suite | 162 passed, 3 skipped |
| Phase 2 live Muse suite | 164 passed |
| Retrieval benchmark | hit@8 30/30, correction 12/12, stale 0, deleted 0 |
| Retrieval latency | p50 0.195 ms, p95 0.511 ms (reported earlier: p95 0.429 ms) |

## Security review performed before publication

- **No credentials in history.** All commits were scanned for API-key, token, private-key,
  and password patterns. The only matches are documentation references to the environment
  variable name `META_API_KEY`; no value appears anywhere.
- **Only `.env.example` is tracked**, containing placeholders and local defaults. `.env` is
  ignored.
- **Local data is ignored:** `data/`, `*.db`, WAL/SHM files, build output, and
  `node_modules/` are excluded by `.gitignore`. The memory databases created during
  development (including conversation transcripts) are on disk but untracked.
- **No personal agent logs or attachments** are included.
- **Commit author identity:** commits are authored by the repository owner. Author email is
  visible in commit metadata; it was not altered, because changing published commit
  metadata is prohibited for this checkpoint. If that email should not be public, the
  decision must be made before further pushes — it cannot be fixed without rewriting
  history.

## Scope and limitations

- This checkpoint covers **Phases 1 and 2 only**. Later work is not part of these commits.
- Timestamps are local authoring times. Publishing establishes a GitHub record of when the
  history appeared, not independent proof of when the work was performed.
- The evidence is deliberately text-based and reproducible; large generated outputs
  (screenshots) live in `docs/assets/` and `docs/benchmarks/` at the relevant commits.
