# Study 02 — Baseten / Muse Spark Open provider contract review

**Reviewer:** `baseten-reviewer` (AI review, not human validation)
**Date:** 2026-11-01 (Australia/Brisbane) · **Branch:** `study02/freeze-prep` (base `85773b3`)
**Status:** offline review for the freeze-preparation gate. **No API calls were made, no credential was
read, no confirmatory generation occurred.** This document records the contract that a future
qualification run (`review/03-QUALIFICATION-PLAN.md`) must verify against a live account.

**Evidence tags used**

| Tag | Meaning |
|---|---|
| **[VERIFIED OFFICIAL DOC — URL — accessed 2026-11-01]** | Read directly on an official Baseten/Meta page on 2026-11-01 (Australia/Brisbane). |
| **[REPO EVIDENCE]** | Observed in this repository's committed artefacts (path + line/section cited). |
| **[UNVERIFIED]** | Neither verified on an official page nor in the repo; must be established by the qualification run or the provider. |
| **[NOT PUBLIC]** | Not documented publicly; only the provider/account can answer. |

Public pages change; every official claim below was read on **2026-11-01** and is cited with its URL.
A page that does not state something is not treated as evidence that the thing is impossible.

---

## 0. Verdict

**The Baseten *platform* contract is well documented. The Study 02 *model deployment* is not.**

- **Verified official:** OpenAI-compatible chat-completions transport at
  `https://inference.baseten.co/v1/chat/completions`; `Bearer` and legacy `Api-Key` auth; request and
  response schema; sampling/streaming/reasoning parameters; SSE format; rate-limit mechanism and
  default tiers; request-ID header; error shapes; zero data retention for synchronous inference;
  per-token pricing for Muse Spark Open ($1.25 / $0.15 cached / $4.25 per 1M input/cached/output);
  1M-token context for Muse Spark Open; and the explicit statement that **neither `seed` nor
  `temperature: 0` guarantees reproducible output** for Muse Spark Open.
- **Not public:** the exact dated slug **`meta-models/muse-spark-open-1026`** appears on no public
  Baseten page; the public Model API slug is **`meta-models/muse-spark-open`**
  [VERIFIED — library page + changelog]. The `-1026` form is [REPO EVIDENCE] only (it worked for 240
  Phase 17 runs on 2026-10-28). No public snapshot/version-immutability guarantee, no
  `system_fingerprint`, no provider-side model-version field in the response, and no per-model output
  token limit are documented.
- **Blocker:** no `$BASETEN_API_KEY` (and no `$S02_BASETEN_API_KEY`) is present in this environment.
  One credential-bearing file is known from repository history (`/Users/burnz/.zshrc`, mode `600`);
  it was **not read**, and it must not be reused as the Study 02 credential.
- **Consequence:** the provider change is **not** a faster equivalent of the Dell endpoint. It changes
  model identity, tokenizer, reasoning-token accounting, determinism assumptions, transport and
  concurrency semantics, data handling and cost. It must be recorded as a **new model-and-provider
  configuration**, and the Dell pilot stays an archived exploratory dataset that is never pooled with
  Baseten observations.

---

## 1. Contract verification, item by item

### 1.1 Endpoint and auth

| Item | Finding | Tag |
|---|---|---|
| Base URL | `https://inference.baseten.co/v1` (OpenAI SDK `base_url`); chat route `/chat/completions` | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01] |
| Full chat URL | `https://inference.baseten.co/v1/chat/completions` | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01] |
| Repo use of the same endpoint | Phase 17 and Phase 16B both posted to `https://inference.baseten.co/v1/chat/completions` | [REPO EVIDENCE — `docs/hackathon-evidence/phase17/run_open.mjs:92-95`, `docs/hackathon-evidence/phase17/design.json:21`, `research/phase16b/run_baseten.mjs:47-49`] |
| Auth scheme | Both accepted: `Authorization: Bearer <key>` (primary; OpenAI clients) and legacy `Authorization: Api-Key <key>`. "Baseten also accepts the legacy `Api-Key` scheme on every endpoint, so existing scripts … continue to work." | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/organization/api-keys — accessed 2026-11-01; also the OpenAPI `securitySchemes` in https://docs.baseten.co/reference/inference-api/chat-completions] |
| Repo auth scheme | Phase 17 sent `authorization: Api-Key ${KEY}` from `BASETEN_API_KEY`; Phase 16B read that variable **out of `~/.zshrc`** at run time (an anti-pattern not to repeat) | [REPO EVIDENCE — `run_open.mjs:28,94`; `research/phase16b/run_baseten.mjs:8-11`; `research/phase16b/baseten_once.mjs:4-8`] |
| Key format / scope | Keys use the `b10_` prefix (`b10_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}`), enabling secret scanning. Three types: personal, team (optional environment/model scoping), and org management. A team key can be created with **"Call Model APIs"** permission (inference only). Environment-scoped team keys restrict which environments (and optionally models) can be called. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/organization/api-keys — accessed 2026-11-01] |
| Key lifetime | Baseten auto-revokes keys that have not authenticated a request for **30 days** (policy since 2026-10-24). Revocation is permanent; rotate by creating a new key, switching clients, then revoking the old one. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/organization/api-keys — accessed 2026-11-01] |
| Key scope for Study 02 | Should be a **dedicated team key, inference-only ("Call Model APIs") or environment-scoped**, named for Study 02; personal keys are acceptable only if a team key cannot be issued, and must be revoked after the run. Confirmation of which type the account can issue is [UNVERIFIED] until the account owner is asked. | [UNVERIFIED — account-specific] |

### 1.2 Model identifier, version identity and limits

| Item | Finding | Tag |
|---|---|---|
| Public Model API slug | **`meta-models/muse-spark-open`** is the slug used in Baseten's own library page, launch blog and changelog examples. | [VERIFIED OFFICIAL DOC — https://www.baseten.co/library/muse-spark-open/ ; https://www.baseten.co/blog/muse-spark-open-launch/ ; https://www.baseten.co/resources/changelog/muse-spark-open-and-nemotron-35-super-vl-available-on-baseten/ — accessed 2026-11-01] |
| Repo slug | Phase 17 and Phase 16B used **`meta-models/muse-spark-open-1026`**; 240/240 Open runs succeeded on 2026-10-28 | [REPO EVIDENCE — `docs/hackathon-evidence/phase17/design.json:21`, `run_open.mjs:29`, `out/open/open-shard-*.json` `model` block; `research/phase16b/run_baseten.mjs:22-23,47`] |
| Does the `-1026` slug exist publicly? | **No public page found.** The model library has exactly **one** Muse Spark model ("Muse Spark Open", family "Muse Spark"); no dated variant or version picker is listed. The `-1026` suffix is consistent with date-stamped slugs used by Baseten (the public schema examples use e.g. `deepseek-ai/DeepSeek-V4.1-Flash-1017`), but no official page states the snapshot policy or reserves `-1026`. | [NOT PUBLIC — searched Baseten docs, model library, family page, changelog, blog; no hit for `muse-spark-open-1026` on 2026-11-01] |
| Version/snapshot identity | No documented per-model versioning or snapshot-immutability guarantee for Model APIs. Deprecation policy: ≥30 days' notice before a model ID becomes inactive; no promise that a dated slug is a frozen weights snapshot. Responses expose only a `model` echo (no `system_fingerprint`, no version/revision field). | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/deprecation — accessed 2026-11-01; response schema https://docs.baseten.co/reference/inference-api/chat-completions]; version metadata gap [NOT PUBLIC] |
| What "version identity" is available | Request side: exact `model` slug. Response side: `model` echo, completion `id`, and `x-baseten-request-id` header. Phase 17's records stored the requested/echoed model only, not the request-ID header or any version metadata. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors (x-baseten-request-id) — accessed 2026-11-01]; [REPO EVIDENCE — Phase 17 shard records lack request-ID fields] |
| Context window | Muse Spark Open: **1M-token context window**, omnimodal input (text/image/video/audio), text output. The pages state "1M"; they do not publish the exact 2^20 token count, so the enforceable `context_length` must be read from the account (management API) rather than assumed. | [VERIFIED OFFICIAL DOC — https://www.baseten.co/blog/muse-spark-open-launch/ (2026-10-27 update); https://www.baseten.co/library/muse-spark-open/ ; https://research.meta.ai/blog/muse-spark-open — accessed 2026-11-01]; exact token count [UNVERIFIED — account metadata needed] |
| Output token limit | Not published per model. The Chat Completions schema allows `max_tokens` 1…**262,144** (default 4,096) with a context-reservation caveat: if input + `max_tokens` exceeds the model context, `max_tokens` is truncated; if the request exceeds context by more than 16k tokens or `max_tokens` signals no preference, reservation is throttled to 49,512 tokens; higher `max_tokens` slightly deprioritises scheduling. Phase 17 successfully used **32,000**. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01]; per-model output cap [NOT PUBLIC]; Phase 17 cap [REPO EVIDENCE — `design.json:24`] |
| Model-specific limits lookup | The management API `GET https://api.baseten.co/v1/model_apis/{name}` returns `context_length`, `cost_per_million_input_tokens`, `cost_per_million_output_tokens` and `rate_limits`. The docs supported-models table is rendered dynamically and did not expose rows in the fetched text. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/management-api/model-apis/gets-a-model-api-by-name — accessed 2026-11-01]; table contents [NOT PUBLIC in fetched form] |
| Public model size / serving form | 816B total, 42.7B active MoE, served in NVFP4 on 4×GB300, hybrid global/local attention; 46 of 62 layers local (2048-token sliding window), 16 global. Not relevant to the API contract but relevant to latency/throughput priors. | [VERIFIED OFFICIAL DOC — https://www.baseten.co/blog/muse-spark-open-launch/ — accessed 2026-11-01; https://research.meta.ai/blog/muse-spark-open] |

**Bottom line on identity:** the Study 02 plan may *propose* `meta-models/muse-spark-open-1026`, but the
**exact resolved slug, its version binding, its context/output limits and its rate limits must be
confirmed from the account** (`GET /v1/models`, `baseten model-api list/describe`, or provider support)
before any qualification request is sent. If the account cannot resolve the dated slug, the public
`meta-models/muse-spark-open` alias is **not** a drop-in substitute: it may move to new weights without
notice, so its use needs a written provider statement of stability for the study window.

### 1.3 Chat-completions request/response schema

| Item | Finding | Tag |
|---|---|---|
| API shape | OpenAI-compatible Chat Completions; request requires `model` and `messages` (`system`/`user`/`assistant`/`tool` roles); content may be a string or multimodal parts | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01] |
| Response fields | `id`, `object`, `created`, `model`, `choices[]` with `message.content` / `tool_calls`, `finish_reason` (`stop`/`length`/`tool_calls`), `usage` (only with streaming when `stream_options.include_usage`); usage includes `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens` | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01] |
| Muse Spark Open feature notes | Supports tool calling and audio input. **Does not support structured outputs or JSON mode.** Accepts `logprobs`/`top_logprobs` but **ignores** them. `n > 1` returns HTTP 400. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01] |
| Reasoning output | Muse Spark Open supports "reasoning output"; the gateway exposes `reasoning` (`max_tokens`) and `reasoning_effort` (`none`…`max`), but per-model honouring is documented only for some models. Phase 16B read `choices[0].message.reasoning_content`; Phase 17 usage shows reasoning tokens are real on this model (mean 8,211 reasoning tokens/run, 51.7 % of completion tokens). | [VERIFIED OFFICIAL DOC — request schema + https://www.baseten.co/blog/muse-spark-open-launch/ — accessed 2026-11-01]; [REPO EVIDENCE — `research/phase16b/baseten_once.mjs:22-23`; Phase 17 `usage.completion_tokens_details.reasoning_tokens` across `out/open/open-shard-*.json`]; `reasoning_effort:"none"` honouring on this slug [UNVERIFIED] |
| `max_tokens` semantics | Caps generated tokens; `finish_reason:"length"` means the cap interrupted generation and (per docs) the answer can be incomplete. Phase 17 treated any `length` as unusable. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/streaming and https://docs.baseten.co/inference/errors — accessed 2026-11-01]; [REPO EVIDENCE — `run_open.mjs:102-104`] |

### 1.4 Sampling controls

The request schema documents these controls [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01]. **Support varies by model**, and Muse Spark Open's own page adds the determinism caveat in §1.6.

| Control | Documented range/default | Study 02 relevance |
|---|---|---|
| `temperature` | 0–4 (no stated default in schema; model-dependent) | Phase 17 used 0; D-P1 showed temp 0 is the only reproducible setting on Dell. Baseten makes no reproducibility promise even at 0. |
| `top_p` | >0–1, default 1 | Dell pilot used 0.8. Baseten value must be a deliberate, recorded choice; per-model honouring to be probed. |
| `top_k` | default 50, `-1` disables | Dell used 20. Not needed unless matched. |
| `min_p` | default 0 | Dell used 0. |
| `presence_penalty` / `frequency_penalty` | number, default 0 | Dell used presence 1.5; **do not silently carry Dell values over** — they are sampler changes, not transport changes. |
| `max_tokens` | 1–262,144, default 4,096 | Phase 17 used 32,000; p99 observed completion was 28,359 and max 29,368 → only 2,632 tokens of headroom. |
| `stop` | string or up to 32 strings, each ≤1,000 chars | Available; unused in Phase 17. Could stop before `</html>` sentinel if safe, but a missing sentinel is a failure mode — probe first. |
| `seed` | integer; "Determinism is not guaranteed across different hardware or model versions." | Present but **not** a determinism knob (see §1.6). |
| `stream` | bool, default false | SSE streaming available. |
| `stream_options` | `include_usage` (default true), `continuous_usage_stats` | Usage in final chunk for streaming. |
| `reasoning` / `reasoning_effort` | `max_tokens` cap / `none`…`max` | Phase 17 sent neither (default reasoning). Study 02 must decide deliberately; `none` honouring unverified. |
| `n` | only 1 supported | No multi-sample in one request. |
| `logprobs` / `top_logprobs` | accepted, ignored by Muse Spark Open | No token-level scoring path. |
| structured outputs / JSON mode | **not supported** on Muse Spark Open | HTML must come from free text + code-fence extraction. |

### 1.5 Streaming / SSE

| Item | Finding | Tag |
|---|---|---|
| Transport | SSE with `data:` records, terminal `data: [DONE]`; deltas arrive as `choices[].delta.content` (and `finish_reason` when done). Inspect the terminal marker *and* the finish reason: a `200` response can end early without an error event, and a token-limit stop still emits the usual marker. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/streaming and https://docs.baseten.co/inference/errors#streaming-responses — accessed 2026-11-01] |
| Usage while streaming | Only present when `stream_options.include_usage` is true (default true); arrives in the final chunk. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/chat-completions — accessed 2026-11-01] |
| Repo streaming precedent on Baseten | **None.** Phase 17 Open used a single non-streaming response; Phase 16B likewise. The Study 02 streaming design exists only for Dell (D-P9/D-P10). | [REPO EVIDENCE — `run_open.mjs:89-120` non-streaming; `research/phase16b/run_baseten.mjs:45-60`] |
| Reasoning deltas in a stream | Not documented per field name; the schema's `DeltaMessage` lists `role`, `content`, `tool_calls` only, yet non-streaming responses can carry `reasoning_content`. Stream shape for reasoning on this model is [UNVERIFIED] and must be captured raw in qualification. | [UNVERIFIED — schema has no reasoning delta field; repo proves non-streaming `reasoning_content` exists] |
| Timeouts on the platform | Dedicated sync predict timeout is 1,200 s and is not user-configurable; Model API requests that time out return `504`. No separate Model API inference-service timeout is published. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/overview (timeouts) and https://docs.baseten.co/inference/errors (504) — accessed 2026-11-01] |

### 1.6 Determinism (decisive for the protocol)

> **"Neither `seed` nor `temperature: 0` guarantees reproducible output."**
> — Baseten Model APIs overview, Muse Spark Open "Defaults and limitations",
> [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01]

The schema also says the seed is for "deterministic generation. Determinism is not guaranteed across
different hardware or model versions." [VERIFIED — same date, chat-completions reference].

**Consequence:** D-P1 (Dell seed non-determinism) is not a Dell-only defect. On Baseten the correct
design is **repeatability measurement, never determinism**. Same-prompt/same-seed repeats are
variability probes; output hashes are not integrity evidence; the confirmatory design's 3 stochastic
reps remain the correct response (they were already justified at full-file scale: 0/8 same-seed
repeats byte-identical on Dell [REPO EVIDENCE — `PILOT-CHANGES.md` D-P1, `10-CHECKPOINT2-REPORT.md`
§7.2]). No temperature-0 determinism claim may be made for Baseten without a dedicated probe, and even
then only as an empirical finding for that model/version/day.

### 1.7 Rate limits and concurrency

| Item | Finding | Tag |
|---|---|---|
| Mechanism | Per-model RPM (requests) and TPM (input + output tokens; cached and uncached input count equally). Limits replenish continuously. `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens` headers on responses. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/pricing-and-limits — accessed 2026-11-01] |
| Account defaults | Basic (unverified) 15 RPM / 100,000 TPM; Basic (verified) 120 RPM / 500,000 TPM; Pro 120 RPM / 1,000,000 TPM; Enterprise custom. A model, service tier or org can override. | [VERIFIED OFFICIAL DOC — same URL — accessed 2026-11-01] |
| Account-specific limits | Must be read from `GET https://api.baseten.co/v1/model_apis/{url-encoded-slug}` (`rate_limits`) with the account key; can also be read from response headers. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/management-api/model-apis/gets-a-model-api-by-name — accessed 2026-11-01]; actual Study 02 values [UNVERIFIED] |
| Overload | `429` = rate limit or no capacity; `529 Overloaded` = capacity exhausted (not account limit), retry with backoff/jitter and honour `Retry-After`. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors — accessed 2026-11-01] |
| Repo concurrency prior | Phase 17 ran **6 shards per model** (12 shards total) for 480 runs and Open achieved 240/240 usable with mean 51.7 s, max 177.1 s; 234/240 succeeded first attempt, 6 needed a second attempt. This is evidence the account could sustain roughly six concurrent Open requests on 2026-10-28, **not** a guarantee for the confirmatory window. | [REPO EVIDENCE — `docs/hackathon-evidence/phase17/RESULTS.md` §9; `design.json` `shards: 6`; computed from `out/open/open-shard-*.json`] |
| Concurrency implication | 4,800 runs must be sharded; the 12-shard plan in checkpoint §9 assumes this account keeps ≥12 concurrent slots (or more, given rate limits). Qualification must measure 1 → 4 in-flight and record headers so the Lead can set shard count safely. | [INFERRED from official limits + repo prior] |

### 1.8 Request IDs and provider/version metadata

| Metadata | Status | Tag |
|---|---|---|
| Completion `id` in body | Documented (`chatcmpl-…` example) | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/pricing-and-limits — accessed 2026-11-01] |
| `x-baseten-request-id` response header | Documented; support asks for it when raising issues | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors — accessed 2026-11-01] |
| `model` echo | Documented response field; Phase 17 asserted it in principle, but only stored the requested string | [VERIFIED OFFICIAL DOC — chat-completions reference]; [REPO EVIDENCE — records store `model` only] |
| `system_fingerprint` | **Not in the documented response schema** (schema is `additionalProperties: false` with `id/object/created/model/choices/usage`); no repo occurrence | [NOT PUBLIC] |
| Model version / snapshot / weights digest in response | Not documented; no `version`, `revision` or deployment field for Model APIs | [NOT PUBLIC] |
| Phase 17 logging gap | The Phase 17 runner stored `usage`, `finish_reason`, `http`, `attempts`, `seconds`, model slug — it did **not** store response `id`, `x-baseten-request-id`, rate-limit headers, or raw response bodies | [REPO EVIDENCE — `run_open.mjs:89-123`, `out/open/open-shard-0.json` record keys] |
| Requirement | Qualification must log the raw response/SSE plus `id`, `x-baseten-request-id`, all `x-ratelimit-*` headers, `created`, `model` echo and full `usage`. Identity is pinned by **slug + request date + provider IDs**, because no weights digest is exposed. | [plan requirement; see 03] |

### 1.9 Error shapes

| Status | Meaning / documented recovery | Tag |
|---|---|---|
| `400` | Invalid request/parameters (e.g. `n > 1` on this model) | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors — accessed 2026-11-01] |
| `401` / `403` | Missing/invalid/revoked key, or key not permitted for the workspace/model | [VERIFIED OFFICIAL DOC — same URL] |
| `402` | Billing/payment problem | [VERIFIED OFFICIAL DOC — same URL] |
| `404` | Wrong model slug / endpoint (model not found for Model APIs) | [VERIFIED OFFICIAL DOC — same URL] |
| `413` | Body too large (100 MB edge limit; not a Study 02 risk at ~20 KB prompts) | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/reference/inference-api/overview — accessed 2026-11-01] |
| `429` | Rate limit/no capacity; exponential backoff; inspect which remaining header hit zero | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors — accessed 2026-11-01] |
| `499` | Client disconnected before response; server cancels in-flight work (client-side timeout signal) | [VERIFIED OFFICIAL DOC — same URL] |
| `500` / `502` / `503` / `504` | Internal / gateway / unavailable / timeout; bounded backoff; 504 for Model API timeouts | [VERIFIED OFFICIAL DOC — same URL] |
| `529` | Overloaded, non-standard status; retry with backoff and `Retry-After`; some clients treat unknown 5xx as fatal | [VERIFIED OFFICIAL DOC — same URL] |
| Error body | `{"error": "<message>"}` **or** a structured error object; shape depends on endpoint/source. Save status + body + model slug + timestamp + request ID. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors — accessed 2026-11-01] |
| Streaming failures | Can occur **after HTTP 200** with no new status and possibly no error object; treat missing `[DONE]`/finish reason as failure; keep partial output separate; retry starts a new request (no resume) | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/errors#streaming-responses — accessed 2026-11-01] |

### 1.10 Data retention, logging and regions

| Item | Finding | Tag |
|---|---|---|
| Sync inference retention | **Zero data retention (ZDR) by default**: Baseten "does not store model inputs, outputs, or weights"; this applies to synchronous inference. Async inference inputs are retained while queued (up to 72 h), outputs not stored. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/observability/security and https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01; launch blog states ZDR by default] |
| Usage/billing metadata | Model API usage data retained **92 days**; cost data from 2026-08-05; metadata includes token counts and request counts per key/user/model. This is usage metadata, not prompt/output content. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/pricing-and-limits — accessed 2026-11-01] |
| Regions | Model APIs use a shared endpoint; serving regions can change. Compliance/region pinning is a managed policy that must be confirmed with support if required. | [VERIFIED OFFICIAL DOC — https://docs.baseten.co/inference/model-apis/overview — accessed 2026-11-01] |
| Study 02 implication | Prompts/outputs leave the local machine and are processed by a third party; source-code-shaped prompts are Study 02 corpus variants (no personal data). ZDR is acceptable for this study, but the confirmatory report should state third-party processing and that ZDR is the provider's stated policy, not independently audited here. | [review judgement] |

### 1.11 Pricing (used only for the cost formula; see 03)

| Item | Rate | Tag |
|---|---|---|
| Muse Spark Open input | **$1.25 / 1M tokens** | [VERIFIED OFFICIAL DOC — https://www.baseten.co/library/muse-spark-open/ — accessed 2026-11-01] |
| Cached input | **$0.15 / 1M tokens** (automatic prefix cache) | [VERIFIED OFFICIAL DOC — same URL; caching mechanics https://docs.baseten.co/inference/model-apis/pricing-and-limits] |
| Output | **$4.25 / 1M tokens** | [VERIFIED OFFICIAL DOC — same URL] |
| Committed/account rate | The **repository records no Baseten rate**. The public library card is a planning estimate, not the account's committed price (enterprise/contract/fast-variant rates can differ). The exact USD cap must be approved by the user from the account rate card before execution. | [UNVERIFIED — account-specific] |
| Cache caveat | Cache hits are automatic but not guaranteed; planning must assume **zero cache benefit** for a worst-case ceiling. | [plan assumption] |

---

## 2. What is not public — exact list to confirm with the provider/account

These are the open items that block a clean contract sign-off. Each must be resolved **before** the
qualification run is executed (all but item 1 are also account read calls, not inference requests):

1. **Slug resolution.** Does `meta-models/muse-spark-open-1026` resolve in this workspace, and is it a
   frozen dated snapshot or an alias of `meta-models/muse-spark-open`? Confirm via `GET /v1/models`
   and `GET https://api.baseten.co/v1/model_apis/meta-models%2Fmuse-spark-open-1026`. If the dated slug
   does not resolve, do **not** substitute the public alias silently.
2. **Version stability for the study window.** Written provider statement of what happens to that slug
   on the next model refresh, whether it can be reserved/allow-listed for the confirmatory run, and
   what deprecation notice applies. Public policy promises 30 days for deprecations, but no
   immutability for dated slugs.
3. **Per-model output limit and context.** Confirmed `context_length` and the maximum accepted
   `max_tokens` for this exact slug (the public docs give a schema max of 262,144 and a 1M context, but
   not this model's enforced output cap). Also confirm whether reasoning tokens count against
   `max_tokens` (Phase 17 usage strongly implies they do).
4. **Reasoning controls.** Whether `reasoning_effort: "none"` / `reasoning.max_tokens` are honoured on
   this slug, and whether reasoning deltas appear in streaming responses (field name/order).
5. **Sampling honouring.** Which of `temperature`, `top_p`, `top_k`, `min_p`, `presence_penalty`,
   `frequency_penalty`, `stop`, `seed` are actually honoured on this model (the schema is
   gateway-wide; "support varies by model").
6. **Rate limits and concurrency** for this workspace + slug: RPM, TPM, and any concurrent-request
   limit (management API `rate_limits` supports `CONCURRENT_REQUEST`, `UNCACHED_INPUT_TOKEN`,
   `OUTPUT_TOKEN` types). Needed to set the confirmatory shard count.
7. **Request-ID / version metadata in practice.** Confirm `x-baseten-request-id` is returned on
   inference responses (documented for support use) and whether any provider-side version identifier
   exists beyond the `model` echo.
8. **Error-body variants seen in practice** (for example `{"error": {...}}` vs `{"error": "..."}`,
   `Retry-After` presence on 429/529).
9. **Account rate card** (per 1M input/cached/output) and whether cached input is billed as documented
   for this model/account.
10. **Credential type available** (team "Call Model APIs" / environment-scoped vs personal) and who
    owns rotation/revocation.

---

## 3. Model-and-provider change record (not a faster equivalent Dell)

The Dell pilot is **archived exploratory evidence**. Its throughput and behaviour **cannot** be used
to predict Baseten, and Baseten observations are never pooled with it. The table records every
material difference and its consequence.

### 3.1 Material differences

| Dimension | Dell PolyStrata (archived pilot) | Baseten Muse Spark Open | Consequence for Study 02 |
|---|---|---|---|
| **Model family / version identity** | Local `qwen3.6-35b-a3b-ud-q3_k_m` (Qwen3.6 35B-A3B, UD-Q3_K_M quantisation), model ID asserted from local `/v1/models`; no provider version | `meta-models/muse-spark-open-1026` (Muse Spark Open 816B-A42B, NVFP4; public alias `meta-models/muse-spark-open`); dated slug not publicly documented; no snapshot guarantee | **New model and new provider.** Identity must be pinned by slug + date + provider IDs; no claim of equivalence to the Dell pilot or to Phase 17 unless the resolved version is shown to match. [REPO EVIDENCE — `07-ENDPOINT-QUALIFICATION.md` §0, §5 risk 7] |
| **Tokenizer / prompt accounting** | Qwen tokenizer; pilot prompt mean **6,390** tokens for **20,518** chars (≈3.45 chars/token); completion mean 6,386, max 7,999 | Different tokenizer; Phase 17 Open prompt mean **5,001** tokens for **16,598** chars (≈3.32 chars/token); completion mean **15,876** (reasoning 8,211, 51.7 %) | Prompt-token counts must be re-measured; Study 02's ~20.5 KB prompts estimate **≈6,200 prompt tokens** on the Phase 17 ratio (ceiling 8,000). Completion budget is roughly **2–2.5×** the Dell pilot because reasoning tokens are included. [REPO EVIDENCE — pilot records; Phase 17 `usage` fields] |
| **Context limits** | 131,072 tokens (Qwen config) | **1,048,576 tokens** context; `max_tokens` schema max 262,144; per-model output cap unpublished | Context is not a constraint (≈0.6 % used); the constraint is output cap + truncation headroom. Phase 17 used 32,000 and observed max 29,368. |
| **Sampling / determinism** | temp 0.7, top_p 0.8, top_k 20, presence 1.5, min_p 0, thinking disabled, explicit per-run seed; **not** seed-deterministic at 0.7; temp 0 byte-reproducible | Gateway accepts temperature/top_p/top_k/min_p/penalties/seed; **Baseten explicitly states neither `seed` nor `temperature: 0` guarantees reproducible output** for Muse Spark Open; reasoning on by default in Phase 17 | **No determinism assumption anywhere.** Repeats are repeatability/variability probes (D-P1 relabel carries over and is stronger on Baseten). Sampler values must be chosen deliberately and recorded; do not copy Dell's `presence_penalty: 1.5`/`top_p: 0.8` and call it equivalent. |
| **API semantics** | llama.cpp-style local OpenAI-compatible server; non-streaming full JSON; no provider metadata; local `/slots` and `/metrics` control plane; manual console process | Managed OpenAI-compatible Model APIs; SSE streaming with `[DONE]`; no structured outputs/JSON mode on this model; logprobs ignored; `n=1`; reasoning content/tokens; `x-baseten-request-id`; 429/529 overload semantics | Harness must be rewritten for the Baseten transport, not parameter-tweaked. `stream: true` is the safe default (D-P9 lesson), but Baseten stream shape and reasoning deltas are unverified and must be captured raw. Anything that parses `message.content` must ignore `reasoning_content` for scoring. |
| **Rate limiting / concurrency** | Single generation slot; requests queue; supervisor waits for idle; 25 % of pilot runs hit mid-stream stalls | Managed multi-tenant; RPM + TPM per workspace/model; continuous replenishment; 429/529; sharding possible; Phase 17 sustained 6 concurrent Open shards | **Throughput is a different regime.** Dell's 345.8 s/run (stalled, single-slot) must never be extrapolated to Baseten; conversely Phase 17's 52 s/run is an unverified prior, not a guarantee. Confirmatory shard count depends on account RPM/TPM, not Dell slots. |
| **Provider version metadata** | None; response top-level keys `choices, created, id, model, object, timings, usage`; seed not echoed | `id`, `model` echo, `created`, `x-baseten-request-id`; **no `system_fingerprint`**, no weights digest | Log what exists; record the provider's request ID so a later dispute/version question is traceable. Phase 17 did not log it — do not repeat that gap. |
| **Data handling** | LAN-local machine under the team's control; prompts/outputs never leave the network | Third-party managed service; ZDR for synchronous inference; usage metadata retained 92 days; shared endpoint with changeable regions | New data-handling statement required in the confirmatory report; ZDR is the provider's policy (not independently audited here); local archive of prompts/outputs remains the study record. |
| **Cost** | Free/local (electricity only) | Per-token paid; public card $1.25/$0.15/$4.25 per 1M input/cached/output; account rate may differ | Qualification and confirmatory cost must be approved; **no paid call** until the approval gate in §5 / `03-QUALIFICATION-PLAN.md` is satisfied. |
| **Operational fragility** | Manual console process; can vanish mid-run; resumable runner required | Managed availability; may still return 5xx/429/529 or end a stream early after 200 | Retry/backoff rules change: bounded retries with backoff are documented and expected on Baseten; Dell's "never kill a client / wait for idle" rule is Dell-specific and must not be carried over blindly. |

### 3.2 Consequences

**Prompt construction.** Study 02's prompt is the **current production `buildForgePrompt`** path: it
takes structured `memories: RetrievedMemory[]` and renders `<project_constraints>` via
`renderMemoryLayout(..., 'forge')`, with ids/provenance and a "reference data only" warning
[REPO EVIDENCE — `apps/server/src/forge/prompt.ts:22-30,76-88`; `packages/memory-engine/src/context.ts:91-137`].
Phase 17's frozen Open prompts were produced by an older builder whose `memoryBlock` string argument no
longer exists (§D-P5; [REPO EVIDENCE — `07-ENDPOINT-QUALIFICATION.md` §2, §5 risk 8]). Therefore:

- Study 02 is correct to use current production, but it is **not prompt-identical to Phase 17**; the
  prompt builder/version must be pinned at freeze and the comparability limit stated.
- Prompt length differs again: Phase 17 Open mean 16,598 chars; Study 02 pilot prompts mean 20,518
  chars (+24 %). On Baseten this ~6,200 prompt tokens is negligible against 1M context but must be
  re-measured server-side, and prompt hashes (not just byte counts) must be logged.
- The memory block content is arm-dependent (`none` 0, `memory` 2, `manual` 1, `corrected` 2 memories
  in the Dell pilot); Baseten must reproduce the same condition assignment, not re-tune retrieval for
  the new model.

**Scoring compatibility.** The frozen detectors (`scoring/phase17/detectors.py`,
`scoring/phase16/detector.py`, hashes pinned) operate on extracted HTML source only. Baseten does not
change the scorer, but it can change the **output wrapper** (markdown fence, commentary, reasoning
text) and the **length/truncation distribution**. Phase 17's fence-extraction worked 240/240 on
Baseten [REPO EVIDENCE — `run_open.mjs:104-108`; RESULTS.md §1], which is encouraging but not a
substitute for running the frozen scorer on the qualification outputs (planned). Scoring must never
receive `reasoning_content`; only extracted `index.html` is scored. Truncated outputs
(`finish_reason:"length"`, no complete `</html>`) are **failures**, never scored as violations or
non-violations.

**Execution concurrency and reproducibility.** Dell forced concurrency 1 and a single-slot supervisor
(D-P4). Baseten permits sharded concurrency bounded by RPM/TPM; Phase 17's 6 shards and 52 s/run are
the only measured prior and are **unverified for Study 02** (different prompts/model configuration).
Reproducibility is weaker on Baseten by the provider's own statement: no seed determinism, no
temperature-0 guarantee, no weights digest. The study therefore carries:
(i) 3 stochastic reps per cell in the confirmatory design (already planned);
(ii) no byte-equality or hash-integrity claims for generations;
(iii) an explicit "provider version unknown/unpinned" limitation unless the dated slug is confirmed
stable.

**Archive statement.** The Dell pilot remains archived exploratory data. Its files, reports,
incident history and checkpoint-2 hashes are unchanged; no Dell runs are planned; no Dell observation
enters the Baseten qualification or the future confirmatory dataset. The Baseten provider change is a
**new configuration**, and any comparison to the pilot or Phase 17 is descriptive and explicitly
limited by model, prompt, tokenizer and version differences.

---

## 4. Credential handling design

### 4.1 Current blocker (recorded, not worked around)

| Fact | Evidence |
|---|---|
| `$BASETEN_API_KEY` is **not set** in this environment | `[ -n "${BASETEN_API_KEY:-}" ]` → false, checked 2026-11-01 |
| `$S02_BASETEN_API_KEY` is **not set** | same check, 2026-11-01 |
| No credential file exists inside the repository (only `.env.example` is tracked) | `git ls-files` filter for `.env`/`credential`/`secret`; working tree |
| A credential-bearing file exists at `/Users/burnz/.zshrc`, mode `-rw-------` (0600, owner `burnz`) — repository history shows Phase 16B/17 read `BASETEN_API_KEY` from it | [REPO EVIDENCE — `research/phase16b/run_baseten.mjs:8-11`; `research/phase16b/baseten_once.mjs:6-8`]. **Path and mode only were recorded; content was never read, printed or copied.** |
| The historical variable name must not be silently reused | [review decision] |

**This review does not request the key's value and does not attempt to source the file.** The key must
be supplied by the user through an explicit, dedicated mechanism at execution time.

### 4.2 Separate credential design (required before any paid call)

| Requirement | Design |
|---|---|
| Env var | **`S02_BASETEN_API_KEY`** — a Study 02-specific variable, **not** `BASETEN_API_KEY`. This prevents accidental reuse of the general-purpose/legacy key and makes the study's spend attributable and revocable on its own. |
| Key type/scope | Dedicated **team key with "Call Model APIs"** (inference-only) and, if the org supports it, environment-scoped to the Model API environment. Personal key only as a documented fallback, revoked after the run. Never an org management/API-key-administration key. |
| Storage | User exports it in the operator shell or a secret manager for the run only. No `.env` file committed, no shell-profile edit, no key in command-line arguments, no key in JSON request captures. The historical pattern of reading the key out of `~/.zshrc` inside the runner is **prohibited** for Study 02. |
| Log redaction | All runner output passes through a single `redact()` function applied to (a) URL/headers logged by the HTTP client, (b) error strings/bodies, (c) verbose/curl diagnostics. Redact `Authorization` values, any `b10_[A-Za-z0-9]{8}\.[A-Za-z0-9]{32}` match, and the env var value if it ever appears. Never use `curl -v`/`--trace` against the inference host; if transport debugging is needed, log the request line and a header **allow-list**, never raw headers. |
| Pre-commit check | A qualification post-run check greps the output tree and logs for `b10_`, `Authorization`, `Bearer `, `Api-Key ` and the env-var name with a value; any hit fails the run and the artefact must not be committed. Optionally run `gitleaks` (a `.gitleaks.toml` is present at the repo root, untracked) before committing any new artefact. |
| Rotation / revocation | Create the key immediately before the run; record only its **visible prefix** (`b10_xxxxxxxx`), creation date and owner in the qualification manifest. Revoke it immediately after the qualification run (and a new key for the confirmatory run). If the key is exposed, revoke first, then rotate. Note Baseten auto-revokes keys unused for 30 days — plan key creation close to execution. |
| `--dry-run` mode | A required runner mode that: validates the plan and scenario selection; builds all prompts through the production path; prints requested model slug, request count, token ceilings and cost formula result; verifies that `S02_BASETEN_API_KEY` **is present without printing it** (`set`/length only); and **sends zero requests to the inference host**. It must exit non-zero if the key is absent so a paid run cannot be started by accident. `--dry-run` must also refuse to run if `--max-usd` is unset. |
| Budget guard | Runner requires an explicit `--max-usd` and `--max-requests` and aborts before the next request if the accumulated worst-case cost (using `max_tokens`, not observed usage) would exceed them. |

### 4.3 Approval needed for the credential

1. User creates a **dedicated team/inference-only Baseten key** for Study 02 (or explicitly approves a
   personal key as fallback), exports it as `S02_BASETEN_API_KEY` in the execution shell, and confirms
   the account owner/who will revoke it.
2. User confirms the key's **workspace, type, and rate limits** (or authorises the management-API
   read that returns them).
3. User confirms that the legacy `~/.zshrc` `BASETEN_API_KEY` (path recorded above) must **not** be
   used for Study 02 and that no one will source it into the run.

---

## 5. Approval gate (summary; full plan in `03-QUALIFICATION-PLAN.md`)

Nothing in this document authorises a paid call. Before the qualification run may execute, the user
must approve **all** of the following in one explicit decision:

| # | Approval | Value proposed in `03-QUALIFICATION-PLAN.md` |
|---|---|---|
| 1 | **Credential** | Dedicated `S02_BASETEN_API_KEY` (team/inference-only), exported by the user; legacy `BASETEN_API_KEY` not reused; revoked after run |
| 2 | **Model identity** | Resolved slug + version binding confirmed by the account (`meta-models/muse-spark-open-1026` or a written provider alternative) before request 1 |
| 3 | **Request count** | **32 inference requests**: 24 core (6 strata × 4 arms) + 4 repeats + 2 truncation probes + 1 reasoning-control probe + 1 smoke |
| 4 | **Token / cost ceiling** | Prompt ceiling 248,500 tokens; completion ceiling 937,344 tokens; worst-case **$6.00 USD** at public rates; actual USD cap from the account rate card to be approved by the user |
| 5 | **Output location** | `experiments/study-02-rare-trigger/qualification-baseten/` only; strictly outside `pilot/` and any future confirmatory dataset |
| 6 | **Scope limits** | No confirmatory generations, no freeze/tag, no corpus/pilot/manifest modification, no commit by the reviewer, dry-run first |

If any item is missing, the answer is **NO-GO** for paid execution; the review and the plan remain
valid offline artefacts.

---

## 6. Sources (all accessed 2026-11-01, Australia/Brisbane)

**Official Baseten documentation**
- Chat Completions reference (schema, params, auth schemes): https://docs.baseten.co/reference/inference-api/chat-completions
- Inference API overview (endpoints, timeouts): https://docs.baseten.co/reference/inference-api/overview
- Model APIs overview (Muse Spark Open feature notes, determinism statement, ZDR, model list): https://docs.baseten.co/inference/model-apis/overview
- Pricing and limits (billing, cache, rate limits, headers, 529): https://docs.baseten.co/inference/model-apis/pricing-and-limits
- Streaming (SSE, `[DONE]`, incomplete responses): https://docs.baseten.co/inference/streaming
- Inference errors (`x-baseten-request-id`, status semantics, streaming recovery): https://docs.baseten.co/inference/errors
- Deprecation policy: https://docs.baseten.co/inference/model-apis/deprecation
- API keys (types, `b10_` format, Bearer + legacy `Api-Key`, 30-day revocation): https://docs.baseten.co/organization/api-keys
- Secure model inference / data privacy: https://docs.baseten.co/observability/security
- Management API: get a Model API by name (`context_length`, `rate_limits`): https://docs.baseten.co/reference/management-api/model-apis/gets-a-model-api-by-name
- CLI `baseten model-api` (list/describe/predict/usage): https://docs.baseten.co/reference/cli/baseten/model-api

**Official Baseten model pages**
- Muse Spark Open model library (slug, pricing $1.25/$0.15/$4.25): https://www.baseten.co/library/muse-spark-open/
- Muse Spark family page (one public model): https://www.baseten.co/library/family/muse-spark/
- Launch blog (1M context, NVFP4, ZDR, reasoning output): https://www.baseten.co/blog/muse-spark-open-launch/
- Changelog (slug `meta-models/muse-spark-open`): https://www.baseten.co/resources/changelog/muse-spark-open-and-nemotron-35-super-vl-available-on-baseten/

**Official Meta pages**
- Muse Spark Open announcement (816B/42B, 1M context, release date 2026-10-15): https://research.meta.ai/blog/muse-spark-open
- Weights/model card link: https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B-NVFP4 (public model card; content not used as a Baseten contract source)

**Repository evidence**
- `docs/hackathon-evidence/phase17/design.json`, `run_open.mjs`, `RESULTS.md`, `out/open/open-shard-*.json`
- `research/phase16b/run_baseten.mjs`, `baseten_once.mjs`, `RESULTS_OPEN.md`
- `experiments/study-02-rare-trigger/07-ENDPOINT-QUALIFICATION.md`, `PILOT-CHANGES.md` (D-P1/D-P5/D-P9/D-P10), `10-CHECKPOINT2-REPORT.md` §3/§9
- `apps/server/src/forge/prompt.ts`, `packages/memory-engine/src/context.ts`

---

## 7. Appendix — measured repo priors used for budgeting

From the Phase 17 Open records (`docs/hackathon-evidence/phase17/out/open/open-shard-*.json`, n=240)
and the Study 02 Dell pilot records:

| Metric | Phase 17 Open (Baseten) | Study 02 Dell pilot |
|---|---:|---:|
| Runs | 240 (6 shards, temperature 0, max_tokens 32,000) | 132 primary (single slot) |
| Usable | 240/240 | 123/132 |
| Attempts: 1 / 2 | 234 / 6 | — |
| Wall seconds mean / median | **51.7 / 46.9** | 345.8 / 296.0 |
| Wall seconds max | 177.1 | 736.7 |
| Prompt tokens mean (min–max) | **5,001** (4,427–5,632) | 6,390 (5,576–6,892) |
| Completion tokens mean | **15,876** | 6,386 |
| Completion tokens p95 / p99 / max | **25,689 / 28,359 / 29,368** | max 7,999 |
| Reasoning tokens mean / share | 8,211 / **51.7 %** | n/a (thinking disabled) |
| Cached prompt tokens mean | 4,797 (not assumed for Study 02 budgeting) | 0–5,153 |
| Prompt chars mean | 16,598 | 20,518 |
| Output HTML bytes mean / max | 24,916 / 48,162 | 19,579 / 23,612 |

Caveats: the Phase 17 wall times were measured with **12 shards running concurrently** (6 Spark + 6
Open) and are **not** verified Study 02 throughput; the Phase 17 prompt builder differs from current
production (D-P5); the token-level and completion-length distribution will shift with Study 02's
corpus and the current prompt. These numbers are **priors for a bounded plan**, not a performance
prediction.
