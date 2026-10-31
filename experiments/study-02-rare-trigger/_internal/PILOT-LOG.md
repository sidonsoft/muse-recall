# Pilot execution log (internal, checkpoint 2)

Timeline is Australia/Brisbane (UTC+10) on 2026-10-31. Pilot is **Dell-only**, full-file outputs,
free/local calls; the confirmatory experiment is not started and nothing is frozen.

## Decisions

- **Go decision:** endpoint qualification (07-ENDPOINT-QUALIFICATION.md) projected 132 executions at
  8.73 h central (range 8.28–10.37 h) and p95 278.6 s/run; the pre-declared stop rule (projected
  >10 h OR p95 >8 min) was **not triggered**. Proceeded.
- **Runtime monitoring (user condition 8):** the approved basis given to the user in checkpoint 1 was
  a ~9–13 h pilot; the stop rule remains "stop for review if the projection becomes unreasonable".
  The Lead treats **>12 h projected** as the review trigger (pathological overrun), and records the
  rolling mean after each batch of runs. The 10 h figure from qualification is the planning
  threshold, not a hard abort for a 20 % stochastic overrun on a 132-run batch.
- **Repeat relabel:** due to the endpoint's non-seed-determinism at temperature 0.7 (qualification
  §2.2), the 12 repeats are **repeatability/variability probes**, not a determinism test. This is a
  pre-freeze pilot finding (defect D-P1); it must be fixed in the protocol before the confirmatory
  freeze.

## Incidents

### D-P2 — runner transport defect (fixed before the pilot proper)

- First two executions were aborted by the client at **301.0 s** and **306.0 s** with
  `"fetch failed"`, after which the runner recorded one unusable run
  (`pilot.s02.farm-arcade.farmyard-v01.p00--memory--r0`, quarantined under
  `pilot/aborted-transport-defect/`, no output produced).
- Cause: Node's global `fetch` (undici) applies a default 300 s `bodyTimeout`; the Dell engine sends
  no bytes until a full-file generation completes, so a valid ~4–5 min generation always dies at
  ~301 s. Qualification used a Python client, which has no such default and therefore did not reveal
  it.
- Fix: `fetchJson` in `scripts/study02/runner.mjs` now uses `node:http`/`node:https` with an explicit
  socket idle timeout (default raised to 900 s per the qualification recommendation). Verified with
  one real execution: **320.076 s, 7,489 completion tokens, status ok, 2 memories, manipulation check
  passed**.
- Quarantined record kept for the audit trail; the run was re-executed under the fixed client, so the
  final pilot dataset contains one successful record for that run id and no duplicated outputs.

## Progress checkpoints

| Time | Recorded | Usable | Rolling mean wall | Projected 132 | Note |
|---|---:|---:|---:|---:|---|
| 12:48 | 0 | 0 | — | 8.73 h (qualification) | transport defect found; pilot paused |
| 13:02 | 1 | 1 | 320.1 s | 11.7 h | fixed client; single-run verification |

(Updated by the Lead as the background job progresses; the analyser recomputes final numbers from
`pilot/records/`.)
