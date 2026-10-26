# Phase verification — claims checked against the commits

Every claim below was checked by checking out the relevant commit in a separate Git
worktree and executing the command listed. Nothing was rewritten, amended, or reordered.

Verification performed: **2026-10-27** (Australia/Brisbane), Node v26.8.1, pnpm 10.32.1,
Muse Code 1.4.13.

| # | Claim | Commit | How checked | Result | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Phase 1 exists on `main` | `349d86c` | `git show-ref` / `git log --all` | Present, reachable from `refs/heads/main` | Verified |
| 2 | Phase 2 exists on `main` | `8579c26` | `git show-ref` / `git log --all` | Present, reachable from `refs/heads/main` | Verified |
| 3 | Phase 1 default test suite passes | `349d86c` | `pnpm test` in a clean worktree | 70 passed, 3 skipped (73) | Re-run at commit |
| 4 | Phase 1 live Muse suite passes (72) | `349d86c` | `MML_LIVE_MUSE=1 pnpm test` | 72 passed (72) | Re-run at commit, real inference |
| 5 | Muse Code 1.4.13 integration | `349d86c` | `muse --version`; live suite above | `1.4.13 (1.4.13-R6996.1)`; live calls succeed | Verified |
| 6 | `muse exec --json` used, streaming verified | `349d86c` | Live test `streams incremental deltas from a real run` | Passed | Re-run at commit |
| 7 | Structured output verified | `349d86c` | Live test `honours a structured output schema` | Passed | Re-run at commit |
| 8 | Phase 2 default test suite passes | `8579c26` | `pnpm test` in a clean worktree | 162 passed, 3 skipped (165) | Re-run at commit |
| 9 | Phase 2 live Muse suite passes (164) | `8579c26` | `MML_LIVE_MUSE=1 pnpm test` | 164 passed (164) | Re-run at commit, real inference |
| 10 | Retrieval hit@8 = 100% | `8579c26` | `npx tsx scripts/benchmark-retrieval.ts` | 30/30 | Re-run at commit |
| 11 | Correction accuracy 100% | `8579c26` | same benchmark | 12/12 | Re-run at commit |
| 12 | Stale-memory retrieval rate 0 | `8579c26` | same benchmark | 0.000% | Re-run at commit |
| 13 | Deleted memories not retrievable | `8579c26` | same benchmark; deletion tests | 0 still retrievable | Re-run at commit |
| 14 | Retrieval p95 latency | `8579c26` | same benchmark | **0.511 ms** (reported at the time: 0.429 ms) | Re-run; variance noted |

## Notes on the latency figure

The committed benchmark artifact recorded p95 = 0.429 ms. Re-running the identical script at
the identical commit produced p95 = 0.511 ms (mean 0.2557 ms, p50 0.195 ms over 300
retrievals). Sub-millisecond timings are sensitive to machine load and scheduling. Both
numbers are reported; the claim "sub-millisecond retrieval on this machine" is what the
evidence supports, not a fixed constant.

## What was not re-verified

- **Browser verification (Playwright/Chrome) at the commits.** The scripts require a running
  server and Chrome, and they were executed during development. Their pass results are
  reported, not re-run during this checkpoint.
- **The original console output of the historical test runs.** It was not preserved. The
  re-runs above were performed at the exact commits and are stronger evidence than a
  transcribed log; they are labelled as re-runs to avoid implying they are the original
  output.
- **Muse quota and rate-limit behaviour.** Not measured; see `docs/muse-integration.md`
  (unknowns).

## Reproduce any row

```bash
git worktree add /tmp/verify <commit> --detach
cd /tmp/verify
pnpm install
pnpm test
MML_LIVE_MUSE=1 pnpm test
npx tsx scripts/benchmark-retrieval.ts
```

The live suite makes real Muse calls and consumes quota; it is opt-in for that reason.
