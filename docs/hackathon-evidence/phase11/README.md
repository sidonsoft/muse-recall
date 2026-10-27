# Phase 11 evidence

- `trials.json` — five real modification trials: requests, job ids, latency, calls, tokens,
  line-change metrics, screenshot validity, validation, runtime check, approval, rollback.
  Sanitised; contains no credentials.

Summary: 5/5 succeeded; mean 55.7 s (median 48.1 s, min 34.1 s, max 104.2 s); ≤10.1% of lines
changed; 995,828 input / 8,180 output tokens; ~$0.10 at contributor pricing; failover to
`muse-spark-1.3-contributor` on every trial because the subscription window was exhausted.

Reproduction: generate or seed a baseline, then use `pnpm verify:forge` for the deterministic
workflow or the Forge UI for real inference. `demo/forge-baseline/index.html` is the recorded
real baseline used by `pnpm demo:seed`.
