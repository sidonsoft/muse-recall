# Study 02 — freeze-readiness report (review gate)

> **Post-decision update (2026-11-01):** the Director's response to this report was **CONDITIONAL
> GO for Baseten qualification (≤$6), NO-GO for confirmatory execution, preregistration freeze and
> freeze tag**. Preparation progress, decision-register compliance and remaining blockers are tracked
> in [`review/11-QUALIFICATION-PREP-STATUS.md`](11-QUALIFICATION-PREP-STATUS.md). This report remains the
> review-gate evidence snapshot.

**Status:** offline preparation complete; **review gate reached**. No confirmatory experiment was
started, the preregistration is **not frozen**, no freeze tag was pushed, and **no paid API call was
made**. The Dell/Qwen work remains an archived exploratory pilot and is never pooled with future
observations.

**Branch:** `study02/freeze-prep` (base `85773b3`, checkpoint 2). This report consolidates four
independent reviews: pilot accounting (`review/01`), Baseten/provider (`review/02`, `review/03`),
design/statistics (`review/05`), human validation (`review/04`), and the offline fixes (`review/06`).

| Evidence class | Location | Meaning |
|---|---|---|
| Exploratory | `pilot/`, `07-ENDPOINT-QUALIFICATION.md`, `10-CHECKPOINT2-REPORT.md` | Dell/Qwen pilot observations; excluded from confirmatory data |
| Qualification (future) | `qualification-baseten/` | Baseten contract/transport validation only; excluded from confirmatory data |
| Confirmatory (does not exist) | — | Frozen design, frozen corpus, frozen analysis; not started |

---

## 1. Reconciled pilot accounting

Independently rebuilt from `pilot/records/`, `pilot/manifest.json`, `pilot/pilot-plan.json` and
`pilot/replacements/records/`; record-level table in `review/pilot-inclusion-table.json` (141 rows)
and `review/01-PILOT-ACCOUNTING-AUDIT.md`.

| Quantity | Records | Note |
|---|---:|---|
| Planned executions | 132 | 120 primary (rep 0) + 12 repeats |
| Original records present | 132 | 0 missing, 0 duplicated, 0 extra |
| Usable original records | 123 | 111 usable primary + 12 usable repeats |
| Unusable originals | 9 | all primary; all transport/stall timeouts; no scoring failures |
| Replacement records | 9 | one per unusable primary, user-approved pilot-only rule; **9/9 usable** |
| **Primary arm denominators** | **111** | `none` 28 + `memory` 27 + `manual` 26 + `corrected` 30 |

The 12 repeats are **excluded from every primary denominator** (`pilot_repeat_probe` membership); the
9 replacements are **supplementary only** (`pilot_replacement_supplementary`); every pilot record carries
`excluded_from_confirmatory`. Failures: `manual` 4, `memory` 3, `none` 2, `corrected` 0; by stratum
farm-arcade 3, farm-challenge 2, orchard-arcade 1, focus-reward 2, focus-lively 1, orchard-challenge 0.
Because failures remove runs, the per-stratum primary denominators are 17–20 rather than 20; the
pre-registered **worst-case/ITT** table (unusable counted as violation) is the safeguard, and the
confirmatory run forbids replacements (§8).

**Corrected-arm semantics (critical for reading H3).** The frozen detectors score violations of the
**original** rule (`child_safety_broad` / `calm_motion`). The `corrected` arm stores the corrected
decision via the production correction route, so its intended behaviour is **adherence to the corrected
rule** — e.g. animation or mistake penalties that the original rule forbade are now permitted and may
legitimately appear. Higher **original-rule** violation counts in `corrected` therefore indicate that the
corrected decision is being followed, **not** a safety regression. H3 (`corrected > memory` on the
original-rule detector) measures release of the obsolete constraint; it does **not** measure whether the
output is good, safe, or compliant with the correction. There is no direct detector for "adheres to the
corrected rule", so the results must never be reported as "corrected output is less safe".

**Bookkeeping corrections (D1–D3, data unchanged).** `review/07-PILOT-ERRATA.md` records: (D1) the
checkpoint-2 report and `PILOT-CHANGES.md` narrative says unusable `manual` 3 / `corrected` 1, but the
records say **`manual` 4 / `corrected` 0** (usable `manual` 29 / `corrected` 33); totals and denominators
are unchanged and the report's own detector table already matched the records. (D2) **Prompt provenance
drift:** 41/132 records (memory-bearing arms, executed before the manifest was regenerated) have
`prompt_sha256` values that do not match the committed prompt artefacts because prompt files were rebuilt
with fresh random memory UUIDs — same byte length, same content, no semantic change, but committed prompt
bytes are not byte-exact for those runs. (D3) 2 of 8 same-seed repeats have an unusable base primary, so the
correct statement is **0/6 defined same-seed pairs byte-identical**, not 0/8. None of these changes a count,
denominator, direction or pilot conclusion; D2 adds a mandatory confirmatory harness requirement (§8).

**Replacement/transport integrity.** All 9 failures occurred in the pre-streaming transport era
(24 primary runs, 37.5 % failure) and **zero** in the SSE-streaming era (96 primary runs, 0 failures).
Failure was therefore governed by the transport era, not by arm outcome (failed runs produced no output and
could not be outcome-scored). The audit's permutation checks found **no era × arm or era × stratum
confounding** (era×arm p = 0.265, era×stratum p = 0.729, era×failure p = 0.851; failure~arm p = 0.309,
failure~stratum p = 0.636; non-streaming 0/16 vs SSE 9/116 = 7.8 %). The only content-level change was the
memory-UUID regeneration (D2; content identical). Safeguards: replacements never enter primary denominators
(`scores.jsonl` has 123 original rows only), are outcome-blind and one-per-failure; a replacement-inclusive
pilot sensitivity left H1/H3 signs unchanged (H3 +27.8 pp per-protocol, +16.7 pp worst-case ITT, +27.8 pp
replacement-inclusive, high-opportunity); worst-case ITT is mandatory beside every table; the confirmatory
run uses one qualified transport, records it per run, and prohibits replacements. **Direct answer: no —
neither replacements nor transport changes can silently alter arm comparisons in this pilot under the
safeguards actually in force**, and the confirmatory design removes the mechanism.

---

## 2. Defects: resolved and unresolved

| ID | Defect | Status entering freeze prep | Freeze relevance |
|---|---|---|---|
| D-P1 | Endpoint not deterministic even at temperature 0/seed (Dell; Baseten documentation says the same) | **Resolved as wording**: pilot repeats are repeatability probes; confirmatory reps are stochastic repetitions only if determinism is established; otherwise reported as duplicates with the ICC component unidentified | Protocol §5 relabelled; provider clause T2 added |
| D-P2/D-P3 | Node fetch 300 s timeout; post-restart LAN reachability | **Resolved** (curl transport); Dell only | Does not transfer to Baseten |
| D-P4 | Client abort ≠ server abort (queue behind orphan) | **Process fixed** (idle gate); Dell only | Not applicable to hosted provider; confirmatory halts only on failure counters |
| D-P5 | Prompt-builder drift vs Phase 17 | **Resolved with pin**: `design/prompt-builder-pin.json` pins current production `buildForgePrompt`/runner/engine/context by SHA-256; prompt-level identity with Phase 17 is **not** claimed | Pinned source must enter freeze manifest; text change T3 applied |
| D-P6 | `corpus.json` lacked `template_id`/`twin_id` | **Resolved**: generator patched; every scenario + label record now carries `template_id`, `twin_id`, `variant_role`; labels now **20 fields**; variants byte-identical; `gen_corpus.py --check` reproduces 68 files | Schema wording updated across design/protocol docs (T9) |
| D-P7 | Corpus diversity limited (shared family engines; high raw-text similarity; paraphrases few for games) | **Open decision** (accept + sensitivity vs expand before freeze) | Reported in `08-CORPUS-DIVERSITY.md` §11; see decision D-13 |
| D-P8 | No independent human validation of exposure instrument / labels | **Open blocker** | Human-validation protocol prepared (`review/04`); gate must pass before freeze or the exposure layer must be removed/demoted |
| D-P9/D-P10 | Non-streaming connection loss; server mid-stream stall | **Resolved for Dell** (SSE + inactivity abort); Dell only | Not transferable; Baseten streaming contract verified (SSE, usage with `include_usage`) |
| D-P11 | Sustained-load degradation / throughput | **Archived** with Dell pilot | Dell archived; no further Dell runs planned |
| D-P12 (new) | H2 per-stratum variant bootstrap breaks cross-stratum variant correlation (variance understated ≈1.4×) | **Correction in progress** (`04b` family-block bootstrap; design review §2.3) | Must be in the frozen analysis plan |
| D-P13 (new) | H2 margin fallback rule contradictory across `04b` §4.5 vs power transcript | **Correction in progress** (single denominator-free rule) | Must be fixed before freeze |
| D-P14 (new) | Exposure instrument: baseline construct-key saturation in H twins and same-class replacement blindness; H/L exposure not comparable | **Documented limitation** (design review `[TRIAGE]`) | Limit claims; exposure secondary only; human-validation gate |
| D-P15 (new) | D1: narrative arm allocation error in checkpoint-2 report/`PILOT-CHANGES` (`manual` 3/`corrected` 1 vs records `manual` 4/`corrected` 0) | **Documented** in `review/07-PILOT-ERRATA.md`; historical docs preserved | Use corrected figures; no denominator change |
| D-P16 (new) | D2: prompt provenance drift for 41/132 pilot records (fresh random memory UUIDs on prompt rebuild; content unchanged) | **Documented**; freeze action required | Confirmatory harness must persist exact sent prompt bytes + execution-time hash + pinned memory IDs |
| D-P17 (new) | D3: "0/8 same-seed identical" is really 0/6 defined comparisons | **Documented** in errata | Correct wording in any future summary |

No pilot or locked artefact was modified during freeze prep; the historical `MANIFEST-checkpoint2.sha256`
applies to commit `85773b3`, and a separate freeze-prep manifest is produced with this work.

---

## 3. Proposed Baseten configuration (model-and-provider change)

This is **not a faster equivalent of the Dell endpoint**. It changes model identity, tokenizer,
reasoning-token accounting, determinism assumptions, transport/rate limits, data handling and cost.
Full verification in `review/02-BASETEN-CONTRACT.md` (official pages accessed 2026-11-01).

| Item | Status |
|---|---|
| Endpoint | `https://inference.baseten.co/v1/chat/completions` — **verified official** |
| Auth | `Authorization: Bearer <key>` primary; legacy `Api-Key` accepted — **verified**; keys `b10_…`; 30-day unused-key revocation |
| Model slug | Public slug is **`meta-models/muse-spark-open`**. The repo/Phase-17 slug **`meta-models/muse-spark-open-1026` is not publicly documented**; the dated slug worked for 240/240 Phase 17 runs on 2026-10-28. **Must be resolved and pinned with the account before qualification** |
| Version identity | No public snapshot guarantee; responses expose only `model` echo; **no `system_fingerprint`/model revision field**; request IDs via `x-baseten-request-id`. Version identity is therefore **unverified** |
| Format | OpenAI chat-completions schema; one completion; no structured outputs/JSON mode |
| Sampling controls | `temperature` 0–4, `top_p`, `top_k`, `min_p`, penalties, `stop`, `seed`, `stream`, `stream_options`, reasoning controls — verified. **Baseten states seed and temperature 0 do not guarantee reproducible output** |
| Token limits | Muse Spark Open **1M context** (public); chat schema `max_tokens` up to 262,144 (default 4,096); per-model output cap **not public**; Phase 17 used 32,000 and observed max 29,368 |
| Streaming | SSE `data:` chunks, terminal `[DONE]`; **usage only when `stream_options.include_usage` is set**; failures can occur after HTTP 200 — verified |
| Rate limits | RPM/TPM with `x-ratelimit-*` headers; 429/529 and `Retry-After`; actual workspace limits **unverified** |
| Data handling | Zero data retention for synchronous inference; usage metadata retained 92 days — verified |
| Prompt path | **Current production** `buildForgePrompt` (structured `memories` → `renderMemoryLayout(..., 'forge')`), pinned by SHA-256 in `design/prompt-builder-pin.json`; **no prompt-level identity with Phase 17** |
| Credential | **Blocker:** `$BASETEN_API_KEY` and `$S02_BASETEN_API_KEY` are unset. Requirement: a dedicated **`S02_BASETEN_API_KEY`** (team/inference-only, least privilege), never committed/logged, revoked after the run; a historical key path in `~/.zshrc` was recorded but **not read and must not be reused** |

The Dell/Qwen configuration (`qwen3.6-35b-a3b-ud-q3_k_m`, PolyStrata 0.1.45) is archived in
`03-DELL-ENDPOINT.md` / `07-ENDPOINT-QUALIFICATION.md`; **no further Dell runs are planned**.

---

## 4. Bounded qualification run (proposal — requires approval before any paid call)

Exact plan: `review/03-QUALIFICATION-PLAN.md`. Evidence class: `qualification-baseten/`, excluded from
both pilot and confirmatory datasets.

| Element | Specification |
|---|---|
| Requests | **32** inference requests: 24 core (6 strata × 4 arms, paired same scenario), 4 same-seed repeats (2 cells × 2, launched 4-in-flight), 2 truncation probes (`max_tokens` 1,024 / 8,192), 1 reasoning-control probe, 1 smoke |
| Parameters | Frozen production prompt path + arm manipulation checks; planned sampler parameters sent explicitly; `max_tokens` 32,000 for full-file requests; streaming where required to test SSE |
| Token ceilings (worst case, not expected) | input **248,500**; output **937,280** |
| Cost | Public-rate formula `in×$1.25/M + cached×$0.15/M + out×$4.25/M`; expected ≈ **$2.25**, worst case **$4.30** at public rates; **hard cap $6.00** including permitted retries. **The exact USD cap must be approved from the account rate card** (the repo records no Baseten rate) |
| Duration | Phase 17 prior mean 51.7 s/run → **≈35–65 min** (planning 60 min; pause/review at 2 h). **Unverified prior**, not measured Baseten throughput |
| Concurrency | Sequential core; repeat block tests 1→4 in flight to observe rate limits; no retry storms |
| Timeout/retry | Per-attempt timeout established in the plan; at most the declared attempt budget; every attempt and failure cause recorded; no silent failover |
| Stop conditions | Auth failure; repeated 429/5xx; full-file completeness below the pre-declared threshold; truncation rate above threshold; p95 latency above threshold; token/cost ceiling reached; any sign the slug/version differs from the approved choice |
| What is tested | Full-file output completeness; scoring compatibility (frozen scorer consumes outputs, 0 scoring errors); truncation semantics (`finish_reason:"length"`, no false success); latency; transport reliability/SSE; rate-limit headers/behaviour; repeatability (not determinism) |
| Logging | Requested vs returned model identity; provider/version metadata available; `x-baseten-request-id`; usage; timing; `finish_reason`; attempts; errors |
| Approval gate | Credential, slug/version/limits, 32-request composition, token/USD ceilings, output isolation, dry-run first. Any missing item ⇒ **NO-GO** |

---

## 5. Human-validation requirements (freeze blocker)

Protocol: `review/04-HUMAN-VALIDATION-PROTOCOL.md`. **No human validation has occurred; AI review is
not human validation and must never be labelled as such.**

- **Sample:** census of all **111 usable primary pilot runs**; a **200-case seeded known-truth diagnostic
  panel** (100 planted positives incl. partial/same-class-replacement cases, 100 near-miss negatives;
  offline, no model calls); census of all **60 variants** for opportunity labels/hooks; census of
  **14 corpus + 4 pilot-only paraphrases** for intent.
- **Design:** two independent blinded coders (condition/arm hidden, randomised order); coding guide with
  construct-family definitions, positive/negative exemplars and false-positive/false-negative modes;
  third-coder adjudication; all disagreements retained; coder training and pre-test.
- **Agreement:** Cohen's κ per construct family and overall, raw agreement, cluster-bootstrap CIs;
  achievable precision is ±9 pp raw (±12 pp after 30-scenario clustering), κ ±0.11–0.13 — enough to
  screen for gross failure, not to certify near-threshold agreement.
- **Gate:** pre-declared **PASS / CONDITIONAL / FAIL** thresholds. PASS = instrument may be described as
  a validated descriptive measure; CONDITIONAL = retained only as a labelled unvalidated reading with an
  interpretation floor (exposure arm contrasts <~20 pp not interpreted); FAIL = exposure layer removed or
  demoted to an appendix, never presented as validated.
- **Claims dependency:** **no primary claim** (H1/H2/H3) depends on the exposure instrument — the primary
  CVR denominator is the pre-treatment `opportunity_class`. The instrument gates only secondary/descriptive
  exposure findings (exposure rates, stability, measured-exposure CVR, "opportunity was taken up", arm
  exposure contrasts, matched H-vs-L **exposure**). The load-bearing human-validated construct for
  Meridian's rare-trigger question is the **opportunity label/hook** set, not the exposure detector.
- **Known instrument limits (documented, from `[TRIAGE]` only):** low detection is mostly
  stratum/request-driven, not arm-driven; game H twins already carry timer/streak construct keys while L
  twins do not, so **exposure is not comparable between H and L twins**; same-class replacement is
  invisible to the diff. None of this affects the primary detector outcome.

**If human coders cannot be resourced, the only compliant freeze path is to remove/demote the exposure
instrument and every exposure-conditioned analysis, and say so explicitly.** Freezing exposure as
validated without the gate is not permitted.

---

## 6. Revised design and power justification

Full review: `review/05-DESIGN-STATISTICAL-REVIEW.md`; plan: `04b-ANALYSIS-PLAN-REV2.md`.

| Element | Freeze-candidate position |
|---|---|
| Design | 4 arms × 6 strata × 400 scenarios × 3 reps = **4,800** executions; strata 60/60/60/60/80/80; corpus 60 variants (3 families × 10 templates × matched H/L twins); **200 high / 200 low** opportunity scenarios, class crossed with template |
| Unit of analysis | **Unique scenario**; 3 repetitions are technical replicates, not independent units; arms paired within scenario |
| Clustering | scenario → variant (H or L twin) → template; for the H-only primary, variant ≡ template partition (**30 clusters**, 10/stratum); **H2 must cluster at the variant level**. Correction required: **family-block bootstrap** (design review D-P12); expected variance ≈1.4× larger (DE ~1.9, effective scenarios ~102, H2 90 % CI ~5.9 pp) |
| Primary estimand | CVR on the pre-treatment high-opportunity scenario class, equal-stratum weighted |
| Tests | H1/H3 stratified paired sign-flip permutation, exact arithmetic, Holm family α = .05, direction required; H2 non-inferiority via family-block cluster bootstrap, one-sided α = .05 |
| Margin | **+10 pp** recommended (defensible; 8 pp is underpowered and not recommended). Single **denominator-free fallback rule**: +15 pp only if evidence shows **≥3 memory-arm violations and ≤1 manual-arm violation** in the high-opportunity usable set. Pilot data (0/16 memory, 0/15 manual) do **not** trigger the fallback |
| Power | 400 × 3 remains **adequate at the frozen +10 pp margin** after the family-block correction. Corrected (T6) simulation: default-cell H1/H2/H3 = 1.000; H2 90% CI width **5.89 pp** (old stratified 5.03); family-block design effect **1.91** (old 1.38), effective scenarios **104.9/200**; **H2@10 arm-parity grid minimum 0.834** (0.693 at 8 pp — 8 pp is not defensible; 0.985 at 15 pp); H2 detectable margin at 80 % power 4.45 pp. H1/H3 saturated. At a true +5 pp memory deficit H2@10 minimum is 0.485 — a disclosed real-difference region, not an N defect. ICC, pair correlation, arm correlation and PHI remain **assumptions** (pilot has 1 rep/arm); report sensitivity, do not estimate them from the pilot |
| Assumptions transferred from Dell pilot | Opportunity-class design/corpus/detectors/scoring path, arm prompt semantics, scenario clustering structure |
| Assumptions **not** transferred | Dell transport/stall/unusable rate, Dell latency/throughput, model-specific violation rates, tokenizer/token counts; these require Baseten qualification or sensitivity analysis |
| Exclusions / retries / replacements / missing / stopping | Maximum 2 attempts per execution; **replacements prohibited** in confirmatory; hosted-provider unusable classes (content refusal, 429, 5xx, mid-stream disconnect) recorded with provider reason; no imputation; `v ≥ 1` rule for pairwise contrasts; no outcome-based exclusion; no interim analysis/optional stopping; pre-declared technical halt only on failure counters (>25 % unusable before 25 % complete, resume same frozen order); **15 % unusable warning / 20 % hard ceiling**, worst-case/ITT co-primary at ≥20 % or arm differential >5 pp |
| Endpoint selection | Pre-registered **feasibility/validity gates only** (contract verified, slug/version pinned, completeness, scoring compatibility, truncation, reliability, rate-limit/cost feasibility). **Never selected on treatment effects** |

---

## 7. Estimated confirmatory cost and duration (grounded, but not yet measured on Baseten)

Explicitly **not verified**: the earlier "7–8 h / 12 shards" estimate is not treated as established. The
only measured Baseten throughput in the repository is Phase 17's committed trial (240 Muse Spark Open
runs, **mean 51.7 s**, max 177 s, 6 shards), which is a **prior**, not a current contract guarantee.

| Quantity | Estimate | Basis |
|---|---|---|
| Executions | 4,800 confirmatory (+ up to 10 % attempt headroom ≈5,280 queue capacity) | frozen design |
| Tokens (scale from Phase 17 Open) | ≈**24.0 M input / 76.2 M output** for 4,800 (Phase 17: 1.20 M / 3.81 M per 240 runs; completion includes ~52 % reasoning tokens) | prior scaling, unverified for Study-02 prompts |
| Duration at prior 51.7 s/run | 6 shards ≈**11.6 h**; 12 shards ≈**5.8 h**; 24 shards ≈**2.9 h** (base, no retries/queue) | Phase-17 prior; actual concurrency/rate limits unknown until qualification |
| Cost at public rates ($1.25 input / $4.25 output per 1M) | input ≈$30 + output ≈$324 ⇒ ≈**$354**; plausible range ≈**$200–$450** depending on completion/reasoning length; add ~10 % headroom | public rate card; account rate card may differ; qualification will measure real token use |
| Qualification | expected ≈$2.25, worst ≈$4.30, hard cap **$6.00** at public rates | `review/03` |
| Archived Dell comparison (not usable for Baseten) | 461 h serial for 4,800 at the pilot mean 345.8 s/run; pilot itself 12.7 h model time | measured Dell pilot, archived |

A confirmatory shard/concurrency plan and USD cap should be set **after qualification**, from measured
Baseten latency, token use and rate limits — not from the unverified prior.

---

## 8. Decisions required from you before any paid/confirmatory step

1. **D-01 Credential:** approve issuance of a dedicated `S02_BASETEN_API_KEY` (team/inference-only,
   least privilege, named owner, revoked after use). Never commit/log it.
2. **D-02 Model identity:** resolve and pin the exact slug/version with the Baseten account
   (`meta-models/muse-spark-open` vs the repo's `-1026`), plus context/output/rate limits; confirm
   whether a dated snapshot is contractually fixed.
3. **D-03 Qualification budget:** approve the **32-request** composition, token ceilings
   (248,500 input / 937,280 output) and **USD hard cap** from the account rate card (public-rate
   worst case $4.30; proposed cap $6.00), plus dry-run-first and stop conditions.
4. **D-04 Qualification isolation:** approve outputs only under `qualification-baseten/`, excluded
   from pilot and confirmatory datasets.
5. **D-05 Human coding resource:** approve two blinded coders + adjudicator and the census/panel plan
   (`review/04`). Without this, choose the compliant fallback: remove/demote all exposure-conditioned
   analyses before freeze.
6. **D-06 Exposure gate:** approve the PASS/CONDITIONAL/FAIL gate and the pre-declared interpretation
   floor; confirm that no primary claim is allowed to depend on the exposure instrument.
7. **D-07 Statistical corrections:** approve the H2 family-block bootstrap correction and the unified
   +10 pp margin fallback rule (D-P12/D-P13); no margin/analysis change based on outcome.
8. **D-08 Unusable-rate policy:** approve ≤2 attempts, no replacements, 15 % warning / 20 % hard
   ceiling, arm-differential >5 pp co-primary rule, and technical-halt-only stopping.
9. **D-09 Endpoint go/no-go:** approve that the confirmatory endpoint is selected only from
   feasibility/validity gates after qualification (no effect-based selection).
10. **D-10 Sampling/repeat meaning:** decide the Baseten sampling setting and state explicitly whether
    3 reps are stochastic repetitions or duplicate-collapse technical repeats (provider does not
    guarantee determinism at any setting).
11. **D-11 Confirmatory budget:** approve the confirmatory USD cap and shard/concurrency plan after
     qualification (prior-based estimate ≈$200–$450 and ≈3–12 h depending on shards; unverified).
12. **D-12 Corpus diversity:** accept the current corpus + sensitivity analysis, or commission an
    expansion before freeze (D-P7).
13. **D-13 Freeze mechanics:** approve the final v0.3 protocol merge, hash manifest, commit/tag/push
    route (after your approval only).
14. **D-14 Prompt provenance:** approve the mandatory harness rule that every confirmatory record persists
    the exact prompt bytes sent, their execution-time SHA-256, and pinned/deterministic memory IDs (D-P16),
    and that a prompt artifact is never regenerated after a record is written.

---

## 9. What is explicitly *not* done

- No confirmatory generation, no endpoint switch executed, no qualification calls, no paid calls.
- No preregistration freeze, no freeze tag, no modification of the frozen submission or Phase 15B/17
  locked artefacts, no change to the product integration branch.
- No Dell re-runs; the Dell configuration is archived.
- No human validation performed; no claim of validated exposure labels yet.
- No USD figure is committed; the account rate card is required.

## 10. Artefacts and verification

| Artefact | Path |
|---|---|
| Pilot accounting | `review/01-PILOT-ACCOUNTING-AUDIT.md`, `review/pilot-inclusion-table.json`, `scripts/study02/audit_pilot_accounting.py` |
| Baseten contract | `review/02-BASETEN-CONTRACT.md` |
| Qualification plan | `review/03-QUALIFICATION-PLAN.md` |
| Human validation | `review/04-HUMAN-VALIDATION-PROTOCOL.md` |
| Design/statistics review | `review/05-DESIGN-STATISTICAL-REVIEW.md` |
| Offline fixes | `review/06-OFFLINE-FIXES.md`, `design/prompt-builder-pin.json` |
| Pilot errata (D1–D3) | `review/07-PILOT-ERRATA.md` |
| Corpus (updated metadata) | `corpus/` (`template_id`, `twin_id`, `variant_role`; 20-field labels; variants byte-identical) |
| Protocol candidate | `02-PROTOCOL-DRAFT.md`, `02b-PROTOCOL-REVISION-V2.md`, `04b-ANALYSIS-PLAN-REV2.md` |
| Freeze-prep manifest | `MANIFEST-freeze-prep.sha256` (generated with this work) |

Verification performed during this pass: pilot record counts and arm denominators independently
reconciled; `gen_corpus.py --check` reproduces 68 files byte-identically; 60/60 variant HTML files
byte-identical before/after metadata propagation; `test_scoring.py` passes and reproduces the Phase 17
committed counts; pilot analysis files restored byte-identically (hashes `6f4546ca…`, `26cf130c…`);
no secrets printed or committed; historical `MANIFEST-checkpoint2.sha256` remains valid for commit
`85773b3`.
