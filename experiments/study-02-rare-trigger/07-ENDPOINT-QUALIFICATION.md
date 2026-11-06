# Study 02 — Checkpoint 2: Dell endpoint qualification (pilot gate)

**Date/time:** 2026-10-31 12:14–12:47 AEST (+10, `Australia/Brisbane`) = 02:14–02:47Z. Dell local clock is UTC+11.
**Owner:** `dell-scout`
**Status:** **QUALIFIED — GO WITH CAVEATS.** The pre-declared stop rule (condition 8) is **not triggered on the central projection** (132 executions ≈ **8.73 h** at the measured mean, p95 per run **4.6 min**). The margin is **thin**: at the p95/max per-run time the same projection is **10.2–10.4 h**, above the 10 h threshold. One substantive protocol finding: **the endpoint does not honour explicit `seed` reproducibly at temperature 0.7**, so the planned same-seed determinism checks cannot be met as written.

**Scope:** endpoint qualification only — **6 full-file generations**, not pilot data. No Dell config/service changes, no model downloads, no paid APIs, no access to the Natasia/Strata PC.

---

## 0. Machine-readable block

```json
{
  "checkpoint": 2,
  "kind": "endpoint_qualification",
  "owner": "dell-scout",
  "probed_at": "2026-10-31T12:14:00+10:00",
  "probed_until": "2026-10-31T12:47:00+10:00",
  "endpoint_base_url": "http://192.168.86.39:8080",
  "chat_completions_url": "http://192.168.86.39:8080/v1/chat/completions",
  "model_id": "qwen3.6-35b-a3b-ud-q3_k_m",
  "model_id_asserted_from": "/v1/models (preflight)",
  "model_id_echoed_on_every_response": true,
  "generation_params": {
    "model": "qwen3.6-35b-a3b-ud-q3_k_m",
    "reasoning_effort": "none",
    "chat_template_kwargs": {"enable_thinking": false},
    "temperature": 0.7,
    "top_p": 0.8,
    "top_k": 20,
    "presence_penalty": 1.5,
    "min_p": 0.0,
    "max_tokens_full_file": 16384,
    "stream": false,
    "distinct_explicit_seed_per_request": true,
    "client_timeout_s": 900,
    "concurrency": 1,
    "prompt_path": "production buildForgePrompt (apps/server/src/forge/prompt.ts, current production `memories` signature) + production retrieval mode 'forge' (max_memories 6 / max_characters 3000) + baseline appended + return-complete-instruction, arm 'memory' (rule + context memories)"
  },
  "per_baseline": [
    {
      "baseline": "farmyard",
      "stratum": "farm-arcade",
      "request_id": "arcade",
      "baseline_path": "demo/forge-baseline/index.html",
      "prompt_chars": 14306,
      "prompt_tokens": 5154,
      "completion_tokens": 5861,
      "wall_s": 261.99,
      "finish_reason": "stop",
      "output_html_bytes": 15932,
      "output_sha256": "6b180d4ef72af241ce7e9d4dddf2e431df1a16454077dabdfe1e484bbbee05d4",
      "prompt_ms": 14136.0,
      "predicted_ms": 247775.4,
      "prompt_per_second": 364.6,
      "predicted_per_second": 23.7,
      "cache_n": 0,
      "html_block_extracted": true,
      "html_complete": true,
      "thinking_off_honoured": true,
      "model_echoed_ok": true
    },
    {
      "baseline": "orchard",
      "stratum": "orchard-arcade",
      "request_id": "arcade",
      "baseline_path": "docs/hackathon-evidence/phase17/baselines/orchard-catch.html",
      "prompt_chars": 20191,
      "prompt_tokens": 6447,
      "completion_tokens": 6387,
      "wall_s": 282.8,
      "finish_reason": "stop",
      "output_html_bytes": 19030,
      "output_sha256": "53c6ad6d928ac62a883a86130615369bc5b07efa8ef46439e5bfcf73bfdaaeb5",
      "prompt_ms": 17219.3,
      "predicted_ms": 265512.2,
      "prompt_per_second": 374.4,
      "predicted_per_second": 24.1,
      "cache_n": 0,
      "html_block_extracted": true,
      "html_complete": true,
      "thinking_off_honoured": true,
      "model_echoed_ok": true
    },
    {
      "baseline": "focusflow",
      "stratum": "focus-reward",
      "request_id": "reward",
      "baseline_path": "docs/demo/evidence/artifacts/v3-staged.html",
      "prompt_chars": 18714,
      "prompt_tokens": 5672,
      "completion_tokens": 5178,
      "wall_s": 225.81,
      "finish_reason": "stop",
      "output_html_bytes": 16328,
      "output_sha256": "25880094c88d4315880597093f3f67bee3eb094d174e8516df1e730e1cac3dd0",
      "prompt_ms": 14932.3,
      "predicted_ms": 210844.1,
      "prompt_per_second": 379.8,
      "predicted_per_second": 24.6,
      "cache_n": 0,
      "html_block_extracted": true,
      "html_complete": true,
      "thinking_off_honoured": true,
      "model_echoed_ok": true
    }
  ],
  "repeated_runs": [
    {"id": "q04-farmyard-sameseed", "baseline": "farmyard", "seed": 1001, "wall_s": 196.48, "completion_tokens": 4327, "output_html_bytes": 11485, "finish_reason": "stop", "cache_n": 0, "prompt_ms": 14446.0},
    {"id": "q05-farmyard-newseed", "baseline": "farmyard", "seed": 1004, "wall_s": 223.61, "completion_tokens": 5467, "output_html_bytes": 14827, "finish_reason": "stop", "cache_n": 5153, "prompt_ms": 93.3}
  ],
  "cap_probe": {
    "id": "q06-farmyard-cap512",
    "max_tokens": 512,
    "completion_tokens": 512,
    "finish_reason": "length",
    "wall_s": 23.16,
    "html_block_extracted": false,
    "note": "max_tokens honoured exactly (512); output cut mid-file; no html block; must be treated as failed/censored"
  },
  "determinism": {
    "same_seed_same_prompt_full_file_byte_identical": false,
    "different_seed_full_file_differs": true,
    "greedy_temperature_0_reproducible": true,
    "temperature_0_7_same_seed_reproducible": false,
    "seed_echoed_in_response": false,
    "conclusion": "explicit seed reaches the engine but does not make temperature>0 sampling reproducible; only temperature 0 is byte-reproducible"
  },
  "distribution_seconds": {
    "sample": "full-file generations only (n=5; excludes the 512-token cap probe)",
    "n": 5,
    "values": [196.48, 223.61, 225.81, 261.99, 282.8],
    "mean": 238.14,
    "median": 225.81,
    "stdev": 34.14,
    "min": 196.48,
    "max": 282.8,
    "p90": 274.48,
    "p95": 278.64,
    "p95_note": "n=5: interpolated p95 is ~the max; max is the conservative bound",
    "primary_baselines_mean_s": 256.87
  },
  "projection": {
    "assumption": "sequential single-slot execution; wall = prompt_ms + predicted_ms + ~0.1 s; per-run mean of the measured full-file distribution; no prefix-cache benefit assumed for distinct pilot prompts (cache_n=0 whenever the preceding prompt differed)",
    "pilot_132": {
      "hours_at_mean": 8.73,
      "hours_at_median": 8.28,
      "hours_at_primary_mean": 9.42,
      "hours_at_p95_conservative": 10.22,
      "hours_at_max": 10.37
    },
    "confirmatory_4800": {
      "hours_at_mean": 317.52,
      "hours_at_median": 301.08,
      "hours_at_primary_mean": 342.49,
      "hours_at_max": 377.07,
      "days_at_mean": 13.2
    },
    "formula_check": "wall_s ~= prompt_tokens/370 + completion_tokens/24.2 (measured prefill 356-380 tok/s, decode 23.7-24.6 tok/s)"
  },
  "stop_rule": {
    "rule": "132-execution projected wall time > 10 h OR measured p95 per run > 8 min (480 s) — user condition 8",
    "projected_132h_central_mean": 8.73,
    "projected_132h_primary_mean": 9.42,
    "projected_132h_p95_conservative": 10.22,
    "projected_132h_max": 10.37,
    "p95_seconds": 278.64,
    "p95_under_8min": true,
    "triggered_by_projected_hours": false,
    "triggered_by_p95": false,
    "triggered": false,
    "margin_note": "central projection is 13% below the 10 h threshold; a rolling pilot mean above 272.7 s/run would breach 10 h",
    "rolling_breach_threshold_seconds_per_run": 272.7
  },
  "stop_rule_triggered": false,
  "recommendation": "GO_WITH_CAVEATS",
  "recommendation_reasons": [
    "central projection 8.73 h (median 8.28 h) for 132 executions is below the 10 h stop threshold",
    "p95 per run 278.6 s (4.6 min) is below the 8 min threshold",
    "margin is thin: +13% per-run time breaches 10 h; 2 of 5 full-file runs already exceeded 260 s",
    "the endpoint is not a managed service, and seed does not provide determinism — two harness/protocol caveats apply"
  ]
}
```

---

## 1. What was generated and how (method)

**Prompt construction [OBSERVED].** The prompt for each baseline is the *current production* Forge modify prompt, built by importing the real production modules with `pnpm exec tsx` (script: `qualification/scripts/build_prompts.mjs`):

- `apps/server/src/forge/prompt.ts#buildForgePrompt({ kind:'modify', prompt: request, request, memories: retrieval.results, hasScreenshot:false })`
- `packages/memory-engine#MemoryEngine.retrieve({ project_id, query, mode:'forge' }, { now })` — the production `FORGE_RETRIEVAL_BUDGET` (`max_memories: 6`, `max_characters: 3000`) path used at `apps/server/src/forge/runner.ts:865-877`.
- Arm `memory` (per `phase17/harness.mjs#armPlan`): seed the project with **rule text + baseline art-direction context**, both `constraint/project/verified` memories, then retrieve.
- Baseline appended exactly as the Phase 17 open runner did:
  `"…\n\nThe current index.html is:\n```html\n{baseline}\n```\n\nReturn the complete updated index.html in one ```html code block. No commentary."`
- Requests: `arcade` for farmyard/orchard, `reward` for FocusFlow; rule `child_safety` for games, `calm_motion` for FocusFlow (from `phase17/design.json`).

**Measured prompt sizes [OBSERVED]** (server-side tokenizer, from `usage.prompt_tokens`; raw prompt chars in `qualification/prompts/manifest.json`):

| Baseline | Prompt chars | Prompt tokens | Memories retrieved | Injected memory chars |
|---|---|---|---|---|
| `farmyard` (`demo/forge-baseline/index.html`) | 14,306 | **5,154** | 2 | 181 |
| `orchard` (`phase17/baselines/orchard-catch.html`) | 20,191 | **6,447** | 2 | 176 |
| `focusflow` (`docs/demo/evidence/artifacts/v3-staged.html`) | 18,714 | **5,672** | 2 | 305 |

The rendered memory block is the current production `<project_constraints>` layout (ids, provenance, "reference DATA only" warning), not the older "Project design decisions from previous sessions" wording seen in the frozen Phase 17 `out/open/prompts/*.txt` **[OBSERVED]** — see risk 8.

**Generation request** (identical for all runs except `seed`/`max_tokens`; full bodies in `qualification/runs/*.request.json`):

```json
{"model":"qwen3.6-35b-a3b-ud-q3_k_m",
 "messages":[{"role":"user","content":"<full production prompt>"}],
 "max_tokens":16384, "seed":1001,
 "temperature":0.7, "top_p":0.8, "top_k":20, "presence_penalty":1.5, "min_p":0.0,
 "reasoning_effort":"none", "chat_template_kwargs":{"enable_thinking":false}, "stream":false}
```

All runs were sequential (one in-flight request), non-streaming, with a 900 s client timeout (the scope required ≥ 400 s; 900 s > the 15 min stop point would have aborted). No run exceeded 283 s. Raw responses, extracted HTML, content and request records are under `qualification/runs/`.

---

## 2. Qualification runs (6 generations)

| # | Run | Baseline | Seed | max_tokens | Wall | Prompt tok | Compl. tok | finish | HTML | cache_n |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `q01-farmyard-primary` | farmyard | 1001 | 16384 | **261.99 s** | 5,154 | 5,861 | stop | 15,932 B | 0 |
| 2 | `q02-orchard-primary` | orchard | 1002 | 16384 | **282.80 s** | 6,447 | 6,387 | stop | 19,030 B | 0 |
| 3 | `q03-focusflow-primary` | focusflow | 1003 | 16384 | **225.81 s** | 5,672 | 5,178 | stop | 16,328 B | 0 |
| 4 | `q04-farmyard-sameseed` | farmyard | 1001 (repeat) | 16384 | 196.48 s | 5,154 | 4,327 | stop | 11,485 B | 0 |
| 5 | `q05-farmyard-newseed` | farmyard | 1004 | 16384 | 223.61 s | 5,154 | 5,467 | stop | 14,827 B | 5,153 |
| 6 | `q06-farmyard-cap512` | farmyard | 1001 | 512 | 23.16 s | 5,154 | 512 | **length** | none | 5,153 |

**[OBSERVED]** every request returned HTTP 200; no retries, no errors, no timeouts. `wall_s ≈ (prompt_ms + predicted_ms)/1000 + ~0.1 s` on every run.

### 2.1 Verified endpoint behaviours

| Check | Result |
|---|---|
| Thinking off honoured | **[OBSERVED]** 6/6 runs: no `reasoning_content` in the message, `content` non-null, `message_keys = ["content","role"]`. |
| Model id | **[OBSERVED]** 6/6 responses `"model": "qwen3.6-35b-a3b-ud-q3_k_m"` = asserted `/v1/models` id. |
| Seed echoed | **[OBSERVED]** No — response top-level keys are `choices, created, id, model, object, timings, usage`; no seed/system_fingerprint field. |
| `max_tokens` honoured vs clamped | **[OBSERVED]** cap probe at 512 produced exactly 512 completion tokens and `finish_reason:"length"`; the 16,384 cap was never reached (max completion 6,387). Earlier scouting found a huge `max_tokens` (200,000) accepted and clamped rather than 400. |
| Complete ` ```html ` block extractable | **[OBSERVED]** 5/5 full-file runs: fenced ` ```html ` block present, parsed HTML starts `<!DOCTYPE html>` and ends `</html>`; extraction regex used by `run_open.mjs` works unchanged. Cap probe: **no** block → extraction `null`. |
| Prefix cache | **[OBSERVED]** `cache_n = 0` whenever the preceding request had a different prompt (q01–q04); `cache_n = 5,153` when the immediately preceding request was the identical prompt (q05 after q04, q06 after q05). Saved prefill ≈ 14 s (prompt_ms 93 vs ~14,400). No benefit for distinct prompts. |
| Queueing / keep-alive | **[OBSERVED]** none observable: all requests sequential, `/v1/status.concurrency = {"serving":1,"requested":1}`, no `: keep-alive` frames (non-streaming). Streaming keep-alives remain as scouted in `03-DELL-ENDPOINT.md` (`QUEUE_BEAT_S = 10 s` when a request waits). |
| Throughput | **[OBSERVED]** prefill **356–380 tok/s**, decode **23.7–24.6 tok/s**; live `/metrics` during q01: `tok_s 26.0`, `prefill_tok_s_mean 364.6`, `state generating`. |

### 2.2 Determinism / seed findings **[OBSERVED]** — protocol-relevant

- Full-file, **same prompt + same seed 1001**: q01 → 5,861 completion tokens / 15,932 B; q04 → 4,327 tokens / 11,485 B. **Not byte-identical.**
- Full-file, **different seed 1004** (q05): 5,467 tokens / 14,827 B — differs (expected under sampling).
- Micro-probe A (`List five single words`, max_tokens 24, temp 0.7, seed 7, twice): contents `apple banana cherry date elderberry` vs `apple banana cherry dog elephant` → **different**.
- Micro-probe B (`20 animal names`, max_tokens 60, temp 0.7, seed 7, three times): run1 == run3, run2 differed → **not reproducible run-to-run**; seed 8 differed from seed 7 (so the seed *does* change the sampling stream).
- Controls: **temperature 0, same seed, twice → identical** (probe A and B). Temperature 0 is byte-reproducible; temperature 0.7 is not.
- The server does parse and forward the seed (`serve/server.py:1226-1228` appends `seed=N` to the engine sampling keys), and engine-side floating-point/thread-order non-determinism is the [INFERRED] cause — probing the engine internals was out of scope.

**Consequence:** the pilot plan's "8 same-seed determinism checks (2 scenarios × 4 arms)" cannot demonstrate byte-level determinism on this endpoint at a non-zero temperature. They will measure **sampling variability**, not reproducibility. [OBSERVED result; INFERRED protocol impact — Lead/protocol owner must relabel or redesign those 8 repeats.]

---

## 3. Projection and stop-rule decision

Distribution of the 5 **full-file** runs (cap probe excluded, it is not a full generation): `196.48, 223.61, 225.81, 261.99, 282.80` s → **mean 238.14 s, median 225.81 s, stdev 34.14 s, p90 274.48 s, p95 278.64 s, max 282.80 s**. Primary-baseline mean (first attempts only, cold cache) = **256.87 s**.

| Projection | 132 pilot executions | 4,800 confirmatory |
|---|---|---|
| mean (238.14 s/run) — **headline** | **8.73 h** | 317.5 h (13.2 days) |
| median (225.81 s/run) | 8.28 h | 301.1 h |
| primary-only mean (256.87 s/run) | 9.42 h | 342.5 h |
| p95 per-run (278.64 s) × n | 10.22 h | — |
| max per-run (282.80 s) × n | 10.37 h | 377.1 h |

**Stop rule (user condition 8):** projected 132-run wall time **> 10 h** OR measured p95 per run **> 8 min**.

- Projected 132-run wall time (central) = **8.73 h → below 10 h**.
- Measured p95 per run = **278.6 s = 4.64 min → below 8 min**.
- **`stop_rule_triggered = false` → proceed to the pilot is permitted by condition 8**, but the margin is **13%**: a pilot whose rolling mean exceeds **272.7 s/run** breaches the threshold; two of five measured full-file runs were already > 260 s. If the Lead wants a conservative pre-registered rule, the p95/max-based projection (10.2–10.4 h) would trigger.

**Recommendation: GO_WITH_CAVEATS** — run the pilot as a resumable background job with per-run checkpoints and a live throughput monitor, and apply the conditions in §5.

### 3.1 Preliminary message sent mid-run **[OBSERVED]**

A preliminary projection was messaged to the Lead at 12:22 AEST after run 1 (`132 × 262 s ≈ 9.6 h`, flagging that larger baselines could push it over 10 h). The completed 5-run measurement revised the central estimate **down** to 8.73 h (the two repeat runs were faster because their outputs were shorter); the final range is 8.28–10.37 h depending on estimator.

---

## 4. Suitability for the pilot

**What works for a 120 + 12 execution pilot [OBSERVED]:**

- Full-file generations are feasible: every run produced a complete, extractable `index.html` (≈11.5–19.0 KB), with `finish_reason:"stop"`, thinking disabled, ~3.3–4.7 min each.
- Prompt sizes are modest for this model's 131,072-token context (5.2–6.4k tokens; ~5% of context), so no truncation risk from prompt length.
- Throughput is stable across the three baselines (prefill 356–380 tok/s, decode 23.7–24.6 tok/s); no queueing or timeout events.
- Wall time is predictable from tokens: `wall_s ≈ prompt_tokens/370 + completion_tokens/24.2`.

**What the harness must handle [OBSERVED/INFERRED]:**

1. **Timeout ≥ 400 s per request** — recommend 900 s; observed max 282.8 s, but output length varies and the server's engine-silence guard is 300 s.
2. **Sequential, single in-flight request** — `concurrency: 1`; parallel client requests only queue.
3. **Always disable thinking** — `reasoning_effort:"none"` + `chat_template_kwargs.enable_thinking=false`. Without it: `content:null`, reasoning text only.
4. **Assert `response.model`** on every run — the server does not validate the model id.
5. **Treat `finish_reason !== "stop"` as failed/censored** — the 512-token cap probe returned `"length"` with **no html block**; extraction returns null.
6. **Do not rely on `seed` for reproducibility** — same seed ≠ same output at temp 0.7; only temperature 0 is deterministic. Record seeds, but do not assert equality or use output hashes as integrity evidence.
7. **No prefix-cache benefit for distinct pilot prompts** — `cache_n=0` unless the immediately preceding prompt was identical; budget full prefill (~14–17 s) per run.
8. **Record `usage`, `timings`, and wall time per run**; prefer a resumable job that writes a checkpoint after each execution.
9. **Respect endpoint fragility** — see risk 2: the service is not a managed service and can vanish mid-run; the harness must resume rather than fail the whole pilot.

---

## 5. Risks

1. **Thin 10 h margin (MEDIUM-HIGH).** Central projection 8.73 h is only 13% below the threshold; primary-only/max-based projections already exceed it. Mitigation: monitor rolling mean, abort/review if > 272.7 s/run; keep timeouts and retries disabled (retries inflate wall time).
2. **Endpoint liveness over a ~9 h unattended run (HIGH).** PolyStrata is a manually launched console process, not a Windows service (see `03-DELL-ENDPOINT.md` §6). Console logoff/window close/reboot ends it; no auto-restart. The AC power plan does not sleep, but process death is the real risk. Mitigation: resumable job + checkpointing; confirm with the user that the session will stay alive; do not restart the service without approval.
3. **Seed is not a determinism knob (HIGH for the plan as written).** The 8 same-seed determinism repeats will not be byte-identical; the 4 new-seed variability repeats are indistinguishable in kind from them. The protocol must relabel these 12 repeats as replicate/variability runs (or switch to temperature 0 for a determinism check, which conflicts with the non-zero sampling temperature requirement). **Needs a Lead/protocol-owner decision before pilot execution.**
4. **Output-length sampling variance drives wall-time variance.** Completion lengths ranged 4,327–6,387 tokens (wall 196–283 s). Pilot prompts differ from qualification prompts (variant HTML + pilot paraphrase), so the projection carries an unquantified shift of maybe ±15%.
5. **No batch/parallel gain.** Single slot; 132 runs strictly serial. 4,800 confirmatory executions at this rate are ~**317 h (13 days)** — not feasible as a single run on this endpoint; confirmatory planning must revisit sharding/throughput (out of scope here, flagging).
6. **Shared, unaudited machine.** The box also runs Steam, ChatGPT desktop, LM Studio, Codex, and a WSL `SidonsoftCI` distro; RAM free was 5.4 GB at scouting. Background load could slow prefill/decode and worsen the variance.
7. **Model identity vs Phase 17 (comparability).** Phase 17 open runs used `meta-models/muse-spark-open-1026` via Baseten; this endpoint is local `qwen3.6-35b-a3b-ud-q3_k_m` (UD-Q3_K_M). Full-file output shape is comparable, but model identity is not — state this explicitly in the pilot report.
8. **Prompt-builder drift vs frozen Phase 17 artefacts (comparability).** **[OBSERVED]** The frozen `phase17/out/open/prompts/*.txt` were produced by an older prompt builder whose memory block reads "Project design decisions from previous sessions (authoritative unless contradicted):". Current production `buildForgePrompt` renders `<project_constraints>` with ids/provenance. Also, the historical `run_open.mjs` passes a `memoryBlock` string that the current `buildForgePrompt` signature no longer accepts (it takes `memories`). This qualification used the **current production** path (correct for Study 02), but any claim of prompt-level identity with Phase 17 is false — pin the prompt builder version and state the difference.
9. **Qualification is not pilot data.** Six runs on one machine, one arm, three baselines; no scenario variants, paraphrases, or scoring. Nothing here is evidence about model behaviour.
10. **Untested long-run stability.** No soak test; thermal throttling, memory fragmentation, or an engine restart under 9 h of load are **[UNKNOWN]**.

---

## 6. Unknowns

- Cause of the seed non-reproducibility (sampler RNG vs floating-point/thread-order) — not investigated inside the engine.
- Whether temperature 0 reproducibility holds across server restarts or with different `--threads`/context settings — untested.
- Whether 9 h of continuous generation is stable (no soak test); whether the engine restarts silently under memory pressure.
- Exact prompt sizes/wall times for the pilot's variant HTML and paraphrase texts — expected similar (the baseline dominates the prompt) but not measured.
- Whether prefix cache could be exploited *safely* by ordering prompts so consecutive runs share a prefix; the current prompt puts the varying request before the baseline, so cache hits would be partial at best. Not a production change we may make for Study 02.
- AMD GPU VRAM/power/thermal telemetry (none exposed on Windows).

---

## 7. Evidence provenance and index

Every factual line above carries **[OBSERVED]**, **[INFERRED]** or **[UNKNOWN]**; JSON fields are direct observations from the run records unless marked. Raw evidence (not edited after capture):

| File | Contents |
|---|---|
| `qualification/prompts/{farmyard,orchard,focusflow}.txt` | The exact prompts sent (production buildForgePrompt output). |
| `qualification/prompts/manifest.json` | Prompt/baseline SHA-256, char counts, seeded/retrieved memories, retrieval budget and ids, generation timestamp. |
| `qualification/runs/records.json`, `records.jsonl` | One record per run: wall time, HTTP status, usage, timings, finish reason, model echo, thinking leakage, output sizes/hashes, html extraction flags. |
| `qualification/runs/q0*.request.json` | Request bodies (prompt elided to char count + sha256; full prompt in `prompts/`). |
| `qualification/runs/q0*.response.json` | Raw HTTP responses, byte-for-byte. |
| `qualification/runs/q0*.content_raw.txt` | Model message content before html extraction. |
| `qualification/runs/q0*.html` | Extracted complete `index.html` for the 5 full-file runs. |
| `qualification/runs/seed_probe.json`, `seed_probe2.json` | Micro-probe evidence for the determinism findings. |
| `qualification/measurements.json` | Machine-readable distribution, projection, stop rule, per-baseline table (this document's §0 is derived from it). |
| `qualification/scripts/build_prompts.mjs` | Prompt builder actually used (imports production prompt/memory modules). |
| `qualification/scripts/qualify.mjs` | Qualification runner (6 runs, sequential). |
| `qualification/scripts/analyze_final.mjs` | Distribution/projection/stop-rule computation. |
| `qualification/qualify.log` | Console log of the 6-run qualification sequence (per-run status lines). |

**Constraints honoured [OBSERVED]:** read-only on the Dell (HTTP generation calls only; no SSH changes, no restarts, no config edits, no model downloads); no access to `192.168.86.23` / `strata-pc`; no paid API calls; **pilot not run**; this qualification is excluded from pilot/confirmatory data.
