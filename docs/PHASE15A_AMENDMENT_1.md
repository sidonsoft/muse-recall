# Phase 15A — amendment 1: complete N3 and M3

**Status:** recorded and committed **before** N3 or M3 is run. The original protocol
([PHASE15A_CHILD_SAFETY_TRIAL_PROTOCOL.md](PHASE15A_CHILD_SAFETY_TRIAL_PROTOCOL.md)) is left
unedited. This amendment was written after N1, M1, N2 and M2 were seen; that is stated here
and in the results.

**Authorised by:** the director, 2026-10-27, after the first four results were reported.

## Why

The trial stopped at the protocol's 3,000,000 input-token cap after 4 of 6 runs. The cap was
meant to stand for about $1.50 but, at the observed rate, stood for about $0.30 (a conversion error
recorded in the results). The approved intent was the full 3 + 3.

## What changes

| Item | Original protocol | Amendment 1 |
| --- | --- | --- |
| Slots | N1, M1, N2, M2, N3, M3 | **N3, then M3 only** (N1–M2 stand as recorded, M2 is not re-run) |
| Credentials | API key | **Director's Muse Code subscription** (Muse CLI stored login). No API key in the environment. |
| Model | `muse-spark-1.3-contributor`, forced | unchanged: still forced with `--model` |
| Token cap | 3,000,000 across the trial | **4,000,000 for these two slots** (per-job budget unchanged: 1.5 M input tokens, 25 calls, 10 min) |
| Output | `trial.json` | `trial-amendment-1.json` beside it; `trial.json` is not modified |
| Unscored staged bytes | not kept | a run that does not succeed keeps its staged source as `{slot}-staged-unscored.html`, for diagnosis only; it is never coded or scored |

Everything else is unchanged: request, baseline, preview bytes (the original `preview.png` is
reused), seeds, prompt builder, retrieval, coding definitions (§4), claims table (§6), footage rule
(§7) and failure rules (§8).

## Stop rules specific to this amendment

- If the subscription will not serve `muse-spark-1.3-contributor` (an infrastructure failure with
  zero model calls), stop after the §8 retries. **Do not switch models** without a further
  amendment: a different model would not be comparable with N1–M2.
- If the subscription reports quota exhaustion, that is an infrastructure failure: retry at most
  twice per slot, then stop. There is no API-key fallback.
- Run `failover` must be false. A run that reports failover is recorded but flagged as not
  comparable.

## Effect on the claims

Even with N3 and M3 complete, the memory side has at most 2 usable runs (M2 produced none). The
§6 row-1 wording ("0 of 3") therefore stays unavailable whatever happens. The final counts are
reported over all six slots, with M2 as "no usable output".

## Command

```bash
pnpm tsx scripts/phase15a-child-safety-trial.ts --amendment 1 --slots N3,M3 --max-input-tokens 4000000
```
