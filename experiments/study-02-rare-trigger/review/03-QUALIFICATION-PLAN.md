# Study 02 — Baseten qualification plan (bounded, approval-gated)

**Reviewer:** `baseten-reviewer` (AI review, not human validation)
**Date:** 2026-11-01 (Australia/Brisbane) · **Branch:** `study02/freeze-prep` (base `85773b3`)
**Status:** plan only. **No request in this document has been executed. No paid call was made. No
credential was read or printed.** Execution requires the explicit approvals in §1.

> **2026-11-01 amendment (confirmed hackathon constraints).** The authorized environment is the
> already-configured Pi provider entry `baseten-muse` / **`meta-models/muse-spark-open-1026`** (context
> 1,048,576; output 32,768; configured costs 1.25 / 4.25 / 0.15). The **existing hackathon key** is
> reused from the Pi configuration (no dedicated replacement key is available or required), and
> **provider credits are supplied** (no purchase/account creation). A2 and the credential/billing
> blockers are therefore resolved offline. The only remaining gate is the Director's **final
> execution authorization**. See `review/13-CONFIRMED-ENVIRONMENT-AND-QUALIFICATION-AMENDMENT.md`;
> this document's §1 rows are updated accordingly.

This plan validates the **provider contract and transport** for the proposed confirmatory endpoint
(Baseten-hosted Muse Spark Open). It is **not** pilot data and **not** confirmatory data. Every output
produced by it belongs to `experiments/study-02-rare-trigger/qualification-baseten/` and must never be
pooled with `pilot/` or with any future confirmatory dataset.

Contract findings and evidence tags: see `review/02-BASETEN-CONTRACT.md`. In particular, the exact
dated slug `meta-models/muse-spark-open-1026` is **not publicly documented** [NOT PUBLIC] and must be
resolved from the account before request 1; the public alias is `meta-models/muse-spark-open`
[VERIFIED OFFICIAL DOC — https://www.baseten.co/library/muse-spark-open/ — accessed 2026-11-01].
Baseten also states that **neither `seed` nor `temperature: 0` guarantees reproducible output**
[VERIFIED — https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01], so every
repeat below is a **repeatability** measurement, not a determinism check.

---

## 1. Approval gate — what must be approved before execution

| # | Approval item | Proposed value (this plan) | Why it is required |
|---|---|---|---|
| **A1** | **Credential** | Reuse the **existing hackathon key** stored in the Pi provider configuration (`providers.baseten-muse.apiKey`, mode 600); the harness loads it in memory via `scripts/study02/provider_config.mjs` and records only a non-reversible fingerprint (`700791232a0c87b1`). No dedicated replacement key, env export, purchase or rotation is required. The key value is never printed, logged or committed. | One hackathon key exists for this use; a dedicated key is unavailable. The loader fails closed if the configured key is missing/invalid and never falls back to another key. |
| **A2** | **Model identity** | The authorized model is **already configured** as `baseten-muse` → `meta-models/muse-spark-open-1026` (name “Muse Spark Open 1026”; context 1,048,576; output 32,768; costs 1.25/4.25/0.15). No other model may be used and the configuration is not edited. Observable version metadata is limited to the configured id/name/limits/cost; no snapshot/revision/system-fingerprint guarantee is available locally or publicly. | This is the only authorized model and it will not change; no invention or alias substitution. The missing snapshot guarantee is recorded as a **reproducibility limitation**: the provider may route the id to a different underlying snapshot, so identity is treated as endpoint metadata observed per request, and a change halts/reports. |
| **A3** | **Request count** | **32 inference requests** exactly as specified in §3 (24 core + 4 repeats + 2 truncation + 1 reasoning-control + 1 smoke). No additional requests without a new approval. | Bounds spend and scope; qualification is contract validation, not effect estimation. |
| **A4** | **Token / cost ceiling** | Prompt ceiling **248,500** tokens; completion ceiling **937,280** tokens; worst-case reservation **$4.294065** at the configured prices, **$6.00 hard cap** (≈$1.706 headroom, ≈11 full-cap retries). Credits are supplied for hackathon use; no purchase/account action is required. | Bounds spend and scope. Enforcement uses `scripts/study02/cost_cap.mjs` (pre-dispatch reservation + actual-usage settlement + hard stop); the configured cost fields are the rate inputs, with any account/contract difference resolved before execution. |
| **A5** | **Output location** | `experiments/study-02-rare-trigger/qualification-baseten/` only. Never `pilot/`, never `qualification/` (Dell), never a confirmatory path. | Evidence-class separation is a freeze requirement; qualification artefacts must never be mistaken for pilot or confirmatory observations. |
| **A6** | **Scope limits** | No confirmatory generations; no preregistration freeze/tag; no corpus, pilot, manifest or locked-artefact edits; no Pi/provider configuration change; existing key reused; `--dry-run` executed first; no git commit by the reviewer. | Matches `_internal/PLAN-FREEZE-PREP.md`; the checkpoint-2 gates are still closed. |

**Decision rule:** A1, A2, A4 and A5 are resolved offline under the confirmed hackathon environment (key present in Pi config; model configured and unchanged; credits supplied; output isolation ready). A3/A6 are plan commitments. **The only remaining gate is the Director's final execution authorization of the 32-request run within the $6 cap.** Until then the answer is NO-GO for execution; the plan remains an offline artefact.

---

## 2. Purpose, non-goals and evidence class

**What qualification is for**

1. Prove the Baseten contract in practice: auth, slug, request/response schema, streaming, usage,
   request IDs, error shapes, rate-limit headers.
2. Prove the **Study 02 prompt path** (current production `buildForgePrompt` + retrieval + arms) produces
   **complete single-file HTML** on this model at the intended token cap.
3. Prove the **frozen scorer** can consume qualification outputs without change (extraction, detector
   copies, determinism of scoring).
4. Measure latency, token usage, truncation and transport reliability so the Lead can size the
   confirmatory run and its cost.
5. Characterise **repeatability** (not determinism) and observe 1 → 4 in-flight behaviour.

**Non-goals**

- No hypothesis test, no effect-size estimate, no comparison to the Dell pilot or Phase 17 counts.
- No confirmatory generation, no corpus/labels change, no protocol change, no freeze.
- No attempt to disable or bypass provider rate limits; no retry storms.
- No claim that qualification performance predicts confirmatory throughput.

**Evidence class:** `qualification-baseten/` = provider/contract validation only, **excluded from
confirmatory data**. It may be cited only as endpoint evidence in the freeze-readiness report.

---

## 3. Request budget and composition (exact)

**Total: 32 inference requests.** The unit of a request is one `POST /v1/chat/completions`.

### 3.1 Core cells — 24 requests

Design: **6 strata × 4 arms**, one scenario per stratum, the same scenario for all four arms (paired
condition assignment, manipulation checks possible). Select the first high-opportunity variant
(`v00`) of each stratum and one frozen corpus paraphrase from `corpus/`; record the exact
`scenario_id`/`variant_id`/`paraphrase_id` in the qualification manifest before execution. Do not use
pilot-only `p00` paraphrases (they are disjoint from the corpus and belong to the archived pilot).

| Block | Requests | Composition | Output requirement |
|---|---:|---|---|
| R01–R24 core | 24 | `farm-arcade`, `farm-challenge`, `orchard-arcade`, `orchard-challenge`, `focus-reward`, `focus-lively` × arms `none`, `memory`, `manual`, `corrected` | Complete `index.html` (fenced ` ```html ` or raw `<html`…`</html>`), `finish_reason: "stop"` |

Why 24 and not fewer or more:

- **6 strata × 4 arms is the minimum that exercises every cell type in the confirmatory design.** Any
  fewer and at least one arm/stratum combination is untested; any more repeats a cell that is already
  covered and adds cost without new contract information.
- 24 gives 6 observations per arm and 4 per stratum — enough to see systematic extraction/scoring
  problems, not enough to estimate anything inferentially (and it is not used to).
- It includes all four condition-assignment patterns (`none` 0 memories, `memory` 2, `manual` 1,
  `corrected` 2 + supersession), which is where prompt-path bugs surface.

### 3.2 Repeats — 4 requests

| Block | Requests | Composition | Purpose |
|---|---:|---|---|
| R28–R31 repeats | 4 | **2 cells × 2 repeats**: cell C1 = `farm-arcade` H / `memory` arm (clone of its core request); cell C2 = `focus-reward` H / `none` arm (clone of its core request). Same prompt bytes, same `seed` value, same parameters as the core run. Launched **concurrently, 4 in flight**, after the sequential phase. | Repeatability measurement + the only 4-in-flight/rate-limit observation. |

Explicitly **not** determinism: per the provider, same seed and even temperature 0 do not guarantee
identical output. Report `byte_identical` counts, token-length variability and detector-verdict
stability descriptively. Do not compute a “determinism rate” from n = 2 cells × 2.

### 3.3 Truncation probes — 2 requests

| Block | Requests | Composition | Purpose |
|---|---:|---|---|
| R25–R26 | 2 | Clone of R01 (`farm-arcade` H / `none`) with `max_tokens: 1024` and `max_tokens: 8192` | Verify cap semantics: exact token count, `finish_reason:"length"`, absent/incomplete HTML, no false success. These outputs are **never scored as violations**; a truncated run is a censored/failed run. |

### 3.4 Reasoning-control probe — 1 request

| Block | Requests | Composition | Purpose |
|---|---:|---|---|
| R27 | 1 | Clone of the `farm-arcade` H / `memory` core request with `reasoning_effort: "none"` (no `reasoning.max_tokens`), `max_tokens: 32000` | Phase 17 ran with **default reasoning** (~51.7 % of completion tokens were reasoning). This probe establishes whether reasoning can be turned off on this slug, what the output shape/usage looks like, and whether full-file completeness survives. It informs a confirmatory configuration decision; it is **not** one of the 24 core cells. |

### 3.5 Smoke — 1 request

| Block | Requests | Composition | Purpose |
|---|---:|---|---|
| R00 | 1 | Short user prompt, `max_tokens: 64`, temperature 0 | Cheapest possible end-to-end check of auth, resolved slug, response schema, `id`, `x-baseten-request-id`, `[DONE]`, usage and rate-limit headers before spending on full generations. Abort the run if it does not pass. |

### 3.6 Parameters (all requests unless stated)

| Parameter | Value | Rationale |
|---|---|---|
| `model` | Resolved Study 02 slug (confirmed in A2; proposed `meta-models/muse-spark-open-1026`) | Identity pinned by exact slug. |
| `messages` | One `user` message with the full production prompt (no system message; matches Phase 17 and the Dell path) | Prompt-path continuity. |
| `temperature` | `0` | Matches Phase 17; no determinism claim. |
| `max_tokens` | `32000` (core, repeats, reasoning probe); probes as specified | Phase 17 cap; observed p99 28,359 / max 29,368 on Baseten, so headroom is thin — truncation is a stop condition. |
| `top_p`, `top_k`, `min_p`, penalties | **Not sent** (model defaults), i.e. do not carry Dell sampler values (`top_p 0.8`, `top_k 20`, `presence_penalty 1.5`) into a new provider | Phase 17 sent none of them; sending Dell values would be an unrecorded sampler change. |
| `reasoning_effort` / `reasoning` | Not sent (default) for all requests except R27 | Phase 17 default. |
| `seed` | Fixed explicit integer per run (record it), same value for a repeat pair | Reproducible request identity; not a determinism assumption. |
| `stream` | `true`; `stream_options: {"include_usage": true}` | Streaming is the safe transport for long full-file generations (D-P9) and gives TTFT; usage arrives in the final chunk. |
| `stop` | None | Do not add a sentinel stop before the model's normal `</html>` completion; a missing sentinel is itself a failure mode. |

---

## 4. Token ceilings and maximum cost

### 4.1 Token ceilings (worst case, not expected)

Prompt ceiling uses **8,000 tokens/request** (expected ≈6,200; see derivation below). Completion
ceiling uses the per-request `max_tokens` cap, not observed lengths.

| Class | Requests | Input ceiling | Output ceiling |
|---|---:|---:|---:|
| Core full-file | 24 | 24 × 8,000 = 192,000 | 24 × 32,000 = 768,000 |
| Repeats | 4 | 4 × 8,000 = 32,000 | 4 × 32,000 = 128,000 |
| Reasoning probe | 1 | 8,000 | 32,000 |
| Truncation probes | 2 | 2 × 8,000 = 16,000 | 1,024 + 8,192 = 9,216 |
| Smoke | 1 | 500 | 64 |
| **Total** | **32** | **248,500** | **937,280** |

### 4.2 Cost formula

Using the **public** Muse Spark Open rate card verified 2026-11-01 (https://www.baseten.co/library/muse-spark-open/):

```
cost_usd = (uncached_input_tokens / 1,000,000) × $1.25
         + (cached_input_tokens   / 1,000,000) × $0.15
         + (output_tokens         / 1,000,000) × $4.25
```

**Worst case, zero cache benefit, no retries:** 0.2485 × $1.25 + 0.93728 × $4.25 =
**$0.3106 + $3.9834 = $4.294 ≈ $4.30 USD.**

**Expected case:** input ≈6,200 × 31 + 20 ≈ 192,220 tokens; output ≈16,000 × 29 + 9,216 + 64 ≈
473,280 tokens → **≈$0.24 + $2.01 = ≈$2.25 USD** (range ≈$1.80–$3.50 if output averages 13k–24k).

**Hard cap with permitted retries:** up to 6 full-cap retry attempts add ≤192,000 output and ≤48,000
input → +$0.816 + $0.060 = +$0.876 → **≈$5.17 USD**. Set the runner's `--max-usd` to **$6.00** so the
cap is never crossed, and treat that as a **public-rate ceiling**, not a committed price.

**Important:** the account rate card may differ (enterprise/contract/fast variant). The user must
approve the actual USD cap from the account rate card before execution; if the account rate is higher,
the approved cap is the account-rate-scaled ceiling, not $6.00. The repository records no Baseten
rate.

### 4.3 Derivation of the prompt-token estimate

| Source | Prompt chars | Prompt tokens | Chars/token |
|---|---:|---:|---:|
| Phase 17 Open (Baseten), n=240 [REPO EVIDENCE] | 16,598 mean | 5,001 mean | 3.32 |
| Study 02 Dell pilot, n=132 [REPO EVIDENCE] | 20,518 mean | 6,390 mean | 3.45 |

Study 02 prompts are **~24 % longer in characters** than Phase 17 prompts. Using the Phase 17
Baseten ratio: 20,518 / 3.32 ≈ **6,180 prompt tokens** → round up to 6,200 expected and **8,000
ceiling**. The tokenizer differs from Qwen's, so the qualification run must confirm server-reported
`usage.prompt_tokens`; 8,000 has ~29 % headroom over the estimate and remains 0.8 % of the 1M context.

### 4.4 Derivation of the completion-length expectation

Phase 17 Open usage on the same model family (n=240) [REPO EVIDENCE — computed from
`docs/hackathon-evidence/phase17/out/open/open-shard-*.json`]:

| Metric | Value |
|---|---:|
| Completion tokens mean / median | 15,876 / 14,960 |
| p95 / p99 / max | 25,689 / 28,359 / **29,368** |
| Reasoning tokens mean / share of completion | 8,211 / **51.7 %** |
| Runs above 28,000 completion tokens | 5 / 240 (2.1 %) |

Two consequences: (i) the confirmatory `max_tokens` must exceed the output distribution's upper tail,
and **32,000 leaves only 2,632 tokens of headroom at the observed max**, so `finish_reason:"length"`
is a real risk and a stop condition; (ii) completion tokens — not prompts — dominate cost (~93 %), so
a reasoning-on vs reasoning-off decision is a material cost decision (R27 probes it).

---

## 5. Execution schedule and concurrency

| Phase | Concurrency | Requests | Notes |
|---|---:|---:|---|
| 0. Dry run | 0 | 0 | `--dry-run`: build all prompts, validate scenario selection, print count/ceilings/cost, check `S02_BASETEN_API_KEY` presence (length only, never the value), require `--max-usd`. Sends **zero** inference requests. |
| 1. Preflight (optional, non-inference) | — | 0 inference | With the credential, read `GET https://api.baseten.co/v1/model_apis/{url-encoded-slug}` (management API) for `context_length`, pricing and `rate_limits`; alternatively rely on the smoke response's `x-ratelimit-*` headers. No inference request is sent. |
| 2. Smoke | 1 | 1 | R00. Abort on any failure. |
| 3. Sequential core | 1 | 27 | R01–R24, R25–R26 (truncation), R27 (reasoning). One request in flight; wait for each to finish (or fail) before starting the next. |
| 4. Concurrent repeats | 4 | 4 | R28–R31 launched simultaneously. Record per-request start/finish, headers, retries. This is the **only** concurrency probe; do not increase beyond 4. |

The order of the core cells is the frozen execution order of the 24 cells (record it; do not reorder
ad hoc). Stop at any stop condition in §7; resuming after a stop requires a new approval.

**Concurrency interpretation.** Four in flight validates that the account allows at least 4 concurrent
requests and reveals the effective RPM/TPM headers. It does **not** validate the confirmatory shard
count (checkpoint §9 assumes 12 shards). The Lead must combine these headers with the management-API
rate limits before choosing shards; if the account is on a Basic-unverified tier
(15 RPM / 100,000 TPM default), even 4 concurrent full-file runs could throttle, and the no-go/reshard
decision belongs to the Lead, not to this plan.

---

## 6. Timeout and retry policy

| Policy | Value | Rationale |
|---|---|---|
| Per-request client timeout | **900 s** (15 min) | 5× the Phase 17 Baseten max (177.1 s) and the same bound used for the Dell full-file runs; a managed service can queue, and reasoning output can lengthen generation. |
| Stream inactivity abort | **120 s** with no SSE bytes | Transport-level failure detection (D-P10 lesson, applied provider-neutrally); abort the attempt, keep the partial stream, treat as failed, retry once. |
| Attempts per request | **max 2** (1 retry) | Bounded; every attempt recorded separately and counted against spend. |
| Retryable | `429`, `529`, `500`, `502`, `503`, `504`, connection reset, socket timeout, stream ends without `[DONE]` or finish reason | Documented transient/overload classes. |
| Backoff | 5 s then 20 s, with jitter; honour `Retry-After` when present | Documented guidance. |
| Never retry | `400`, `401`, `402`, `403`, `404`, authentication failures, model-not-found | Deterministic client/config errors; retrying burns time and risks key lockout noise. |
| No-resume rule | A retry is a **new request**; never resume an interrupted stream and never merge partial output with retry output | Provider documents that retry starts fresh. |
| Failure handling | Partial/failed attempt output is kept under `requests/…/attempt-N.partial` and never scored or treated as a usable generation | Mirrors the pilot rule that partial streams are never scored (D-P10). |
| Clock | Record UTC start/end per attempt, plus provider `created` and request IDs | Correlate with usage/cost records. |

---

## 7. Stop conditions

The runner must abort **immediately** (no further requests) when any condition below is met, write a
stop record with the triggering evidence, and leave the outputs in place. Resuming requires a new
approval.

| # | Condition | Threshold | Action |
|---|---|---|---|
| S1 | Auth failure | any `401`/`403` | Stop; do not retry; report status/body (redacted); never print or rotate the key silently. |
| S2 | Model/slug problem | `404`, or smoke model echo ≠ requested slug, or slug unresolved | Stop; require provider/account confirmation (A2). Do not substitute the public alias. |
| S3 | Rate limiting | 3 consecutive `429` after backoff, any unresolved `529`, or `x-ratelimit-remaining-*` = 0 with retries | Pause; record headers; do not increase concurrency; stop if it persists > 10 min. |
| S4 | Server errors | any `500`/`502`/`503`/`504` that survives the single retry | Stop the batch. |
| S5 | Truncation | ≥2 of the 24 core requests return `finish_reason:"length"` (≥8.3 %), or any core truncation that is not explainable by the cap probes | Stop; adjudicate `max_tokens`/output limit with the provider; do not continue on a truncated corpus. |
| S6 | Completeness | < 20/24 core requests produce a complete extractable HTML file (80 % floor) | Stop; the transport/prompt path is not fit for the confirmatory endpoint. |
| S7 | Latency | p95 per-request wall time > **300 s**, or projected remaining qualification wall time > **2 h** | Pause and report; do not silently extend. |
| S8 | Cost/token cap | accumulated worst-case cost (using `max_tokens`, not observed usage) would exceed `--max-usd`; or total tokens exceed the approved ceilings | Stop before the next request. |
| S9 | Identity drift | any response `model` echo differs from the confirmed slug within the run | Stop; provider may have re-pointed the alias. |
| S10 | Credential hygiene | the key or an `Authorization` value appears in any log/output; or a `b10_` pattern is found in the output tree | Stop; revoke/rotate the key; do not commit. |
| S11 | Unexpected error class | undocumented status/body or a stream that cannot be parsed | Stop and report; do not guess. |
| S12 | Scoring failure | frozen scorer raises, or extraction feeds reasoning text into a detector | Stop scoring; keep outputs; report as a scoring-compatibility failure. |

---

## 8. What is tested (and how pass/fail is judged)

| Property | How measured | Pass / fail |
|---|---|---|
| **Full-file output completeness** | Extract via the frozen Phase 17 regex (` ```html ` fence, fallback raw `<html`), require start `<!DOCTYPE html>`/`<html` and end `</html>`; record bytes and hash | Pass: ≥20/24 core complete (target 24/24). Fail: S6. |
| **Scoring compatibility** | Run the frozen scorer (`scoring/frozen.py` + detector copies, hashes verified on import) on all 24 core outputs plus the 4 repeats; re-run to confirm byte-identical scoring; assert no floats and 0 consistency failures | Pass: 0 scoring-consistency failures, deterministic re-score, no reasoning text scored. Fail: S12. |
| **Truncation semantics** | R25/R26 at 1,024/8,192: exactly the requested completion count, `finish_reason:"length"`, HTML incomplete/absent; core at 32,000: 0 truncations | Pass: caps behave; 0/24 core truncated. Fail: S5. |
| **Latency** | Wall time, TTFT (first SSE byte), completion throughput; p50/p95/max; compare to Phase 17 prior (mean 51.7 s, max 177.1 s) as a **prior**, not a target | Pass: p95 ≤ 300 s and total within 2 h. Soft-fail: slower but explainable; record, do not extrapolate silently. |
| **Transport reliability** | HTTP status per attempt, `[DONE]` present, finish reason present, retry count, partial-stream detection, stream-inactivity aborts | Pass: 0 unexplained failures; every retry recorded. |
| **Rate-limit behaviour** | `x-ratelimit-*` headers on smoke/core; 4-in-flight repeats; 429/529 handling and `Retry-After` | Pass: 4 concurrent requests complete without persistent 429/529; headers captured. Fail: S3. |
| **Repeatability** | 2 cells × 2 repeated requests at identical prompt/seed/params: byte equality, output length, detector verdict | Descriptive only (provider explicitly does not promise determinism). Report byte-identical count, token-length spread, verdict stability. No pass threshold; it informs the confirmatory design (which already uses 3 stochastic reps). |
| **Identity/metadata** | Requested vs echoed `model`; response `id`; `x-baseten-request-id`; `created`; usage fields (`prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `cached_tokens`) | Pass: all required fields present and consistent; `model` echo matches. Fail: S2/S9 if not. |
| **Reasoning control (R27)** | `reasoning_effort:"none"`: does the response shape change, do `reasoning_tokens` drop, is the HTML complete? | Informational; no pass/fail. If `none` is ignored or breaks completeness, the confirmatory run keeps default reasoning. |
| **Credential/log redaction** | Post-run grep for `b10_`, `Authorization`, `Bearer `, `Api-Key `, and the env-var value across the output tree and logs | Pass: zero hits. Fail: S10. |
| **Data-handling statement** | Confirm no prompt/output is stored by the provider for synchronous requests (ZDR policy), and record which pages were read on which date | Pass: ZDR accepted and documented in the qualification report; the report states it is the provider's policy, not independently audited. |

---

## 9. Repeatability treatment (explicit policy)

1. **No determinism claim.** The provider states that neither `seed` nor `temperature: 0` guarantees
   reproducible output for Muse Spark Open, and that seed determinism is not guaranteed across
   hardware or model versions.
2. The 4 repeats are **repeatability measurements**: same prompt, same seed, same parameters, run
   after the sequential block. They estimate within-cell variability (byte identity, length spread,
   detector-verdict stability), not reproducibility.
3. Output hashes are **not** integrity evidence and must never be used to claim deterministic
   generation. They remain useful as artefact identifiers only.
4. The repeat pair is run at 4-in-flight, so its latency is **not** comparable to the sequential core
   latency; report them separately.
5. This supersedes and extends D-P1: the D-P1 relabel (repeats = variability probes) is **required**
   for the Baseten confirmatory protocol, not optional.

---

## 10. Logging requirements

Every attempt writes a self-describing record. No credential — and no header that could contain one —
may appear anywhere in the tree.

### 10.1 Per-attempt artefacts

| Artefact | Contents |
|---|---|
| `requests/<run_id>/attempt-<n>.request.json` | Request body **without** the prompt inline (prompt saved once as `prompt.txt`); parameters; `model`; `stream`; `max_tokens`; seed; `prompt_sha256`; `prompt_chars`; runner version; git commit |
| `requests/<run_id>/prompt.txt` | Exact prompt bytes sent (hash matches the record) |
| `responses/<run_id>/attempt-<n>.sse` | Raw SSE stream, byte-for-byte (kept even on failure) |
| `responses/<run_id>/attempt-<n>.json` | Parsed final response (reconstructed from SSE) |
| `responses/<run_id>/attempt-<n>.headers.json` | **Allow-list only**: `x-baseten-request-id`, `x-ratelimit-*`, `retry-after`, `content-type`, `date`. Never `authorization`. |
| `outputs/<run_id>.html` | Extracted complete HTML (usable runs only) |
| `records/<run_id>.json` | The record described below |

### 10.2 Required record fields

`run_id`, `phase`, `cell` (stratum × arm), `scenario_id`, `variant_id`, `paraphrase_id`, `arm`,
`rep`, `prompt_sha256`, `prompt_chars`, **requested_model**, **echoed_model**, `response_id`,
`x_baseten_request_id`, `http_status`, `created`, `usage` (`prompt_tokens`, `completion_tokens`,
`reasoning_tokens`, `cached_tokens`, total), `finish_reason`, `stop_reason` if present,
`stream_done_marker` (bool), `chunk_count`, `ttft_s`, `wall_s`, `attempt`, `retry_reason`,
`output_sha256`, `output_bytes`, `html_complete`, `extractor` (regex id/version), `error_code`,
`error_message` (redacted), `rate_limit_headers`, `started_at_utc`, `ended_at_utc`, `runner_version`,
`git_commit`, `prompt_builder_pin`.

### 10.3 Redaction and hygiene rules

- One `redact()` function applied to every string written to a log, record or console: remove the
  credential value, `Authorization` header values, and anything matching
  `b10_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}`.
- Never use `curl -v` / `--trace` against the inference host. If transport debugging is unavoidable,
  log only the request line, status and allow-listed headers.
- The key is supplied only via `S02_BASETEN_API_KEY`; the runner must not write environment dumps,
  process tables or shell history into the output tree.
- Post-run gate: `grep -RInE 'b10_[A-Za-z0-9]{8}\.|Authorization|Bearer |Api-Key ' qualification-baseten/`
  must return nothing before the artefact is committed or handed to the Lead.
- `manifest.json` records hashes of every artefact, the key **prefix** (`b10_xxxxxxxx`), creator/owner
  and creation date, and the exact model slug/version confirmation.

---

## 11. Output location and isolation

```
experiments/study-02-rare-trigger/qualification-baseten/     (exists, empty at 85773b3)
├── PLAN.md                     # pointer to this plan + frozen request list
├── plan/request-list.json      # the 32 requests, frozen before execution
├── requests/<run_id>/...
├── responses/<run_id>/...
├── outputs/<run_id>.html
├── records/<run_id>.json
├── scoring/                    # frozen-scorer outputs on qualification HTML
├── logs/run.log                # redacted console log
├── manifest.json               # hashes, key prefix, model identity confirmation
└── REPORT.md                   # written after the run; contract status + go/no-go input
```

Rules: nothing is copied into `pilot/`, `qualification/` (Dell), `corpus/`, `design/`, `scoring/` or
any future confirmatory directory; the analysis plan must never read this tree; every file is labelled
`qualification — excluded from confirmatory data`. Directory permissions `700`; no credential file or
env dump inside.

---

## 12. Go / no-go criteria for the confirmatory Baseten endpoint

Qualification is the input to this decision; the Lead owns the final call.

**GO — all of the following must hold**

1. Exact slug and version binding confirmed and pinned (A2); no unresolved alias; provider statement or
   account metadata recorded.
2. Auth, schema, streaming, usage, request ID and rate-limit headers all observed and consistent; smoke
   passed.
3. **24/24 core requests** produce complete extractable HTML with `finish_reason:"stop"` (or at most one
   transport failure that succeeded on retry, fully recorded).
4. **0/24 core truncations** at `max_tokens: 32000`; if any truncation is observed, the cap/output
   limit is re-established with the provider before re-planning.
5. Frozen scorer runs on all core outputs with **0 consistency failures**, reproducible re-score, and no
   reasoning text scored.
6. Repeats are treated as repeatability (non-determinism confirmed or not), and the confirmatory design
   requires no determinism assumption.
7. Latency and cost extrapolate within the approved token/cost ceilings; rate limits support the planned
   confirmatory shard count (or the Lead resharding the run with a recorded decision).
8. ZDR/data handling documented and accepted; credential redaction verified; output tree isolated and
   hashed.

**NO-GO — any of these**

- Slug/version unresolved, alias-only without a stability guarantee, or identity drift during the run.
- Completeness below 20/24; any core truncation at 32,000; caps not honoured.
- Frozen scorer inconsistency, or reasoning text reaching a detector.
- Persistent 429/529 at 4 in flight, or rate limits that cannot support at least 6 concurrent requests.
- Auth/model errors, unexpected error classes, undocumented billing surprises.
- Key hygiene failure (any credential trace in the output tree).
- Request count, token ceiling or USD cap not approved (A1–A6 incomplete).

---

## 13. Duration estimate (explicitly an unverified prior)

The only measured Baseten prior in the repository is Phase 17 Open: **n = 240**, mean wall **51.7 s**,
median 46.9 s, max 177.1 s, 240/240 usable, 6 runs needing a second attempt, measured while 12 shards
ran concurrently (6 Spark + 6 Open) — [REPO EVIDENCE — `docs/hackathon-evidence/phase17/RESULTS.md`
§9 and computed from `out/open/open-shard-*.json`]. This is **not** verified Study 02 throughput:
Study 02 prompts are ~24 % longer, the model configuration may differ, and the sequential phase runs at
concurrency 1.

| Phase | Requests | Estimate at 51.7 s/req | Slower scenario (2×) |
|---|---:|---:|---:|
| Smoke + sequential core + truncation + reasoning | 28 | ≈24 min | ≈48 min |
| Concurrent repeats (4 in flight) | 4 | ≈1–2 min | ≈3–4 min |
| Setup, dry-run, preflight, manifest | — | ≈10 min | ≈15 min |
| **Total** | **32** | **≈35 min** | **≈65 min** |

**Planning figure: 60 minutes; pause threshold (S7): 2 hours.** Mark this entire estimate
**[UNVERIFIED PRIOR — Phase 17 Baseten, different prompt/model configuration]**; it must not be quoted
as measured Baseten throughput for Study 02, and it must not be used to predict the confirmatory
4,800-run wall time (the Lead's budget uses measured priors with explicit uncertainty).

---

## 14. Post-run outputs and hand-off

If (and only if) A1–A6 are approved and the run executes, the operator produces:

| Output | Owner |
|---|---|
| `qualification-baseten/REPORT.md` — contract status item by item, request/retry accounting, token/latency tables, truncation/repeatability results, redaction check, data-handling statement, go/no-go recommendation | operator / Lead review |
| `qualification-baseten/manifest.json` — artefact hashes, model identity confirmation, key prefix/owner, rate-limit headers, exact parameters | operator |
| `review/02-BASETEN-CONTRACT.md` update — change [UNVERIFIED]/[NOT PUBLIC] items to verified with evidence, or keep them open | baseten-reviewer (future revision) |
| Confirmatory budget input — token/cost formula updated with measured values | Lead |

Until then, this plan and `02-BASETEN-CONTRACT.md` are the stop point: **no paid calls, no confirmatory
generations, no freeze.**

---

## 15. Approval checklist (copy-paste for the user decision)

- [ ] **A1** Dedicated `S02_BASETEN_API_KEY` created (team/inference-only) and exported; legacy key not reused; owner/rotation named.
- [ ] **A2** `meta-models/muse-spark-open-1026` resolved/confirmed (or written provider alternative + stability statement); context/output/rate limits recorded.
- [ ] **A3** 32 inference requests approved exactly as §3.
- [ ] **A4** Token ceilings approved (input 248,500 / output 937,280) and **USD cap** approved from the account rate card (public-rate worst case $6.00).
- [ ] **A5** Output location `experiments/study-02-rare-trigger/qualification-baseten/` approved and kept separate from pilot/confirmatory.
- [ ] **A6** Scope limits acknowledged: no confirmatory generations, no freeze/tag, dry-run first, no corpus/pilot edits.
