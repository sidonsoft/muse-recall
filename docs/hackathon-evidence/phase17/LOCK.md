# Phase 17 — lock evidence

The Phase 17 protocol was locked by a commit pushed to GitHub before the first trial run. This file
records that evidence. It is not covered by `protocol.sha256` and was written after the lock.

| | |
|---|---|
| Lock commit | `6640e83f3c999cd1349420ad5e95bc329fff7d36` ("docs(phase17): lock the pre-registration before the first trial run") |
| Tag | `phase17-preregistration` (annotated tag object `303eb4d5…`, pointing at `6640e83`) |
| Pushed | **2026-10-28 11:18:28 UTC** (21:18:28 AEST): GitHub repository activity for `sidonsoft/muse-recall`, branch `claude/admiring-kilby-7f7211` created at `6640e83` |
| First trial run | Muse Spark Open: first prompt file written 11:19:09 UTC (local file time). Muse Spark: first Forge job `created_at` 11:19:29 UTC (server job record) |

How to check:

```bash
git ls-remote origin 'refs/tags/phase17-preregistration^{}'   # → 6640e83…
gh api 'repos/sidonsoft/muse-recall/activity?ref=claude/admiring-kilby-7f7211' --jq '.[] | "\(.timestamp) \(.activity_type) \(.after)"'
pnpm verify:research17                                         # every file in protocol.sha256 matches
```

The repository history was later rewritten to drop commit-message trailers. On the rewritten branch,
the same locked tree is commit `52ce00f` (`git diff 6640e83 52ce00f` is empty). The pushed
`6640e83`, its branch and its tag are kept unchanged as the public pre-registration record.
