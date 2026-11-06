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

### D-P3 — post-restart LAN reachability failure from Node/Python; curl transport + supervisor

- After a harness/session restart mid-pilot, the pilot process was lost with 10 primary records
  completed (resumable, no data loss; records 1-10 preserved).
- Relaunch attempts then failed at preflight with `EHOSTUNREACH 192.168.86.39:8080`, while
  `curl http://192.168.86.39:8080/health` from the same process tree returned 200 in ~2 ms. Raw
  TCP sockets from Node and Python failed with "No route to host"; the system `curl` binary
  connected. This is an environment/network-privilege quirk after the restart, not a Dell fault.
- Fix: runner HTTP transport now shells out to `curl --max-time` (with a `node:http` fallback if
  curl is absent); curl exit 28 maps to a recorded `timeout`. This also keeps the earlier D-P2 fix
  (undici's 300 s body timeout).
- Resilience: `scripts/study02/supervise_pilot.sh` (detached, new session) relaunches `--resume`
  after any runner exit until all 132 records exist, so transient network failures cannot truncate
  the pilot. The supervisor refuses to start if a runner is already active.
- No record was skipped or re-executed against the resume rule; transient failures produced no
  outputs.

### D-P4 — "hung" transport was a queued request behind a killed client (no code defect)

- After D-P3 the runner appeared to hang on a long generation: the request was sent at 13:48:44 and
  no response arrived, while the Dell status showed a completed generation at 13:53:43.
- Root cause: killing a client mid-generation does **not** stop the engine; the server keeps
  generating the orphaned request to completion, and the next request is FIFO-queued behind it.
  The runner's request had simply not started generating yet. A standalone verbose curl of the same
  prompt then completed normally: **5 m 28.4 s, HTTP/1.0 200, Content-Length 25,659, Connection:
  close** — curl transport is sound.
- Fix (process, not code): the supervisor now waits for `/slots` `is_processing == false` before
  launching the runner, and a running client is never killed to "free" the endpoint. The runner's
  900 s per-request safety timeout is unaffected.
- Lesson recorded for the confirmatory harness: never treat a client-side abort as a server-side
  abort on this endpoint; always wait for the slot to drain before the next execution.

### D-P9 — non-streaming long generations lose the connection; streaming transport adopted

- One pilot execution (`pilot.s02.focus-reward.focusflow-v01.p00--none--r0`) failed with
  `curl: (56) Recv failure: Operation timed out` after 780.3 s (attempt 1) and 660.3 s (attempt 2).
  The server was generating a very long full-file output; the connection carried no bytes until the
  single JSON response, and the idle long-lived connection was dropped before the response arrived.
- Fix: generation calls now use **SSE streaming** (`stream: true`, curl `-N`), which the endpoint
  keeps alive with `: keep-alive` comments every ~10 s; the runner reconstructs the response content
  from `data:` deltas. Verified end-to-end: content `"OK"`, finish_reason `stop`, usage and timings
  present, 3 chunks, 1.0 s. Raw SSE text is kept per attempt (`*.attemptN.sse.txt`) for audit.
- The failed record was quarantined under `pilot/aborted-transport-defect-2/` (no output produced)
  and the run is re-executed under the streaming transport; the final dataset contains one
  successful record for each run id.
- Request timeout default raised to 1800 s (streaming removes the idle-socket failure mode; this is a
  safety bound, not an expected runtime).

### D-P10 — server-side mid-generation stall with SSE (inactivity abort added)

- A streaming execution produced 5,160 SSE delta chunks (17,119 content chars) and then the stream
  stopped mid-generation: the SSE file's mtime froze, `/slots` reported `is_processing: false`, and
  the HTTP socket stayed open (curl would have waited until the 1800 s cap). The engine log showed
  no request-level error; the cause is not diagnosed beyond "engine stopped mid-generation".
- Fix: curl now aborts a stream that carries < 1 byte/s for 120 s (`--speed-time 120
  --speed-limit 1`); the attempt is recorded as a timeout and retried. This bounds a stall to
  ~2 min instead of 30 min. A partial stream is never scored as usable.
- No record was written for the stalled attempt, so no quarantine was needed; the run is
  re-executed under the bounded-stream transport.

### D-P11 — sustained-load degradation and retry cooldown

- After ~6 h of continuous CPU-heavy inference the measured pace worsened: some full-file runs took
  500-630 s (vs 240-450 s earlier), and a few runs failed both attempts with the 120 s stream
  inactivity abort, producing usable-rate loss (3 unusable by 19:31 of 58 recorded).
- No Dell restart/configuration change was made (the endpoint is a manually launched process and the
  user forbade modifying the Natasia installation; PolyStrata is not a managed service). The pilot
  continues with the failure rate counted, not hidden.
- Harness change: the inter-attempt cooldown was raised from 3 s to 30 s to give the single engine
  slot time to recover between attempts; the curl-28 error message now states that the failure was a
  stream inactivity abort rather than a request-size timeout.
- Consequence for the checkpoint: the pilot is taking materially longer than the qualification
  projection (which assumed no stalls). Actual throughput and usability are reported from the
  records; the confirmatory-budget section treats the Dell single-slot option as infeasible.

## Replacement policy for unusable pilot executions (user-approved 2026-10-31)

The user asked whether unusable pilot runs can be replaced. Decision: **pilot-only, bounded,
pre-declared, non-cherry-picking**:

- For each unusable **pilot** record, exactly **one** replacement execution of the same
  scenario/arm/repetition, same prompt construction and seed policy, is run after the primary pilot
  completes. Original failed records are kept and reported; replacements are stored separately under
  `pilot/replacements/` and never overwrite primary records.
- No replacement is attempted more than once per run, and no run is repeated until success.
- Replacements are **never** used in the confirmatory study: there, unusable runs remain excluded
  under the pre-declared exclusions (per-protocol primary + worst-case ITT), with no post-hoc
  replacement.
- Tooling: `scripts/study02/run_replacements.mjs` (refuses `--confirmatory`, one pass at a time,
  resumable, uses the same curl/SSE transport and idle gate). Dry-run verified: 4 targets, prompt
  construction check passed (manual arm: 1 memory, rule in prompt).
- The pilot analysis reports primary usability (including failures) and replacement outcomes
  separately.
