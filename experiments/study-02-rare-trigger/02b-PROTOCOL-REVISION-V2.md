# Study 02 — protocol revision v0.2 (checkpoint 2)

**Status: DRAFT revision notice — the protocol is still NOT frozen and nothing is preregistered.**
This document records the design changes made between checkpoint 1 (`02-PROTOCOL-DRAFT.md` v0.1) and
checkpoint 2. It supersedes the v0.1 sections listed below; the v0.1 document is kept unchanged as
the checkpoint-1 record. The consolidated protocol v0.3 will be issued **at the freeze gate**, after
the pilot findings are folded in and the user approves.

Related: `design/design-v2.json` (machine-readable design), `design/corpus-spec-v2.md` (corpus
contract), `04b-ANALYSIS-PLAN-REV2.md` (revised analysis/power), `07-ENDPOINT-QUALIFICATION.md`,
`10-CHECKPOINT2-REPORT.md`.

---

## 1. What changed, and why

| # | v0.1 (checkpoint 1) | v0.2 (checkpoint 2) | Reason |
|---|---|---|---|
| 1 | 10 variants/family, `v00–v04` high / `v05–v09` low; opportunity class confounded with variant identity | **10 structural templates `T00–T09` per family, each instantiated as an H twin (`v00–v09`) and an L twin (`v10–v19`); class crossed with template (matched pairs)** | User condition 4: resolve the opportunity-class confound before final corpus construction |
| 2 | 4 game strata × 70 (10 variants × 7 paraphrases) + 2 focus × 60 (10 × 6) | **4 game strata × 60 (20 variants × 3 paraphrases) + 2 focus × 80 (20 × 4)** = 400 | Consequence of (1): 20 variants/stratum; rescale paraphrases to keep 400 and 200/200 high/low |
| 3 | High-op scenarios per stratum 35/35/35/35/30/30 | **30/30/30/30/40/40** | Consequence of (1)–(2); 200 high total preserved |
| 4 | Cluster hierarchy: scenario → variant (sensitivity only) | **scenario → variant (H or L twin) → template**; H2 inference clusters at the **variant** level | Template = its H/L twin pair, so the two levels are partly collinear (see `04b` §2); the v1 scenario-level bootstrap would understate H2 variance up to ~2.2× |
| 5 | 8 same-seed repeats described as "determinism checks" | **12 repeats are repeatability/variability probes, not determinism checks** (0/8 same-seed repeats byte-identical at temperature 0.7; 0/4 new-seed repeats identical). **Confirmatory 3 reps are stochastic repetitions/technical replicates** of the same scenario×arm at the frozen setting; if the endpoint is deterministic there, they collapse to duplicates and that is reported as a limitation. | Pilot defect D-P1 (see `PILOT-CHANGES.md`) |
| 6 | Prompt path assumed byte-comparable to Phase 17 `run_open.mjs` | **Current production `buildForgePrompt` (structured `memories`) is used; prompt-level identity with Phase 17 is NOT established** and must be stated + the production prompt version pinned at freeze | Production prompt builder changed after Phase 17; the old `memoryBlock` argument no longer exists |
| 7 | Pilot: 30 scenarios × 4 arms × 2 reps = 240 | **Pilot: 30 scenarios × 4 arms × 1 rep = 120 + 12 repeats = 132** (approved budget) | User-approved pilot budget; throughput |
| 8 | No opportunity template families; hooks implicit | **30 templates with declared affordance hook blocks (H) and twin L configurations**, all detector-clean | Corpus construction requirement from checkpoint 2 |
| 9 | Execution order seed `0x02A2026`, formula in protocol §6 | Unchanged for the design; **pilot seeds are plan-fixed** (`pilot-plan.json`) with an independent derived-seed cross-check recorded per run | Pilot runtime finding; confirmatory seed derivation to be finalised at freeze |
| 10 | 4,800 confirmatory executions | **Unchanged** (400 × 4 × 3) | — |

## 2. Section-by-section supersession map (for the eventual v0.3 merge)

| v0.1 section | Status in v0.2 |
|---|---|
| §4 strata, baseline families, 400-scenario corpus | **Superseded** by `design/design-v2.json` and `design/corpus-spec-v2.md` (templates, twins, 60/60/60/60/80/80 allocation) |
| §5 repetitions, sampling, total executions | Total unchanged (4,800); sampling params confirmed by the Dell qualification; the §5 wording is relabelled: confirmatory repetitions are **stochastic repetitions (technical replicates)** of the same scenario×arm, not determinism checks and not independent scenarios; a deterministic endpoint collapses them to duplicates, reported as a limitation (see (5) above). Determinism is **established** by the pre-freeze qualification, not assumed; for a hosted provider every sampler field is explicit and echoed in the record, the observed model id is asserted per run, and provider reinterpretation is recorded (§5.1, T1/T2). |
| §6 order and sharding | Unchanged in substance; the exact confirmatory seed/order formula will be fixed at freeze |
| §7 trigger prevalence/exposure/violation/CVR | Unchanged in substance; opportunity class now matched at template level |
| §8 frozen expected-outcome labels | **Schema updated to the generated 20-field record** (checkpoint-1 fields plus `template_id`, `twin_id`, `variant_role`); corpus labels now exist in `corpus/labels.json` (still draft until freeze; human validation NOT done). Join vocabulary fixed: `twin_id` = matched pair, `variant_role ∈ {H,L}` = twin member and source of `opportunity_class`, `twin_class` = alias of `variant_role`, `template_id` = structural template; grouping on `twin_id` alone is a defect (T9). |
| §9 hypotheses/estimands | Unchanged; H2 margin and its pre-declared fallback are defined only in `04b-ANALYSIS-PLAN-REV2.md` §4.5 as corrected 2026-11-01 (protocol §9.1 points there and does not restate the rule; T8). |
| §10 unit of analysis | Superseded: the scenario unit and H-variant partition coincide for the H-only primary analysis — **30 H-variant clusters, 10 per family**; H1/H3 within-scenario paired sign-flip; H2 family-block variant-cluster bootstrap per `04b` §3.2/§4.5 as corrected 2026-11-01; a scenario-level bootstrap is not valid for H2 and is not reported as its sensitivity (T7). |
| §11 statistical analysis structure | Superseded by `04b-ANALYSIS-PLAN-REV2.md` for the matched-twin design |
| §12 exclusions | **Updated by §12.4 (T4):** confirmatory retries capped at 2 attempts (execution-time only, no failover); **replacements prohibited** (the pilot's replacement pass was a pilot-only, user-approved exception); hosted-provider unusable classes (content refusal, 429, 5xx, mid-stream disconnect); missing outcomes use the `v ≥ 1` rule; no outcome-based exclusion or optional stopping; pre-declared technical halt (>25 % unusable before 25 % complete); 15 % warning / **20 % hard ceiling** with worst-case/ITT co-primary at ≥20 % or a >5 pp arm difference. |
| §13 pilot | Superseded: 30 scenarios × 4 arms × 1 rep + 12 repeats; Dell only; excluded from confirmatory analysis |
| §14 confirmatory environment | **Endpoint/model still open** (deferred to checkpoint-2 review). **Prompt path fixed (T3):** current production `buildForgePrompt` with structured `memories`, pinned by `design/prompt-builder-pin.json` plus the four source files; Phase 17 prompt-level identity is **not** claimed. |
| §15 lock policy | Unchanged in intent; plus (T3/T10): prompt-builder pin + four pinned source files, human-validation record (report, guide, sheets, adjudication log), trigger-zone instrument and validation thresholds are added to the lock; a change to the validation guide/thresholds after coding begins is a deviation and is reported. |
| §16 threats to validity | Add: matched-twin corpus is template-engine-generated (high raw-text similarity); no human validation; prompt not byte-identical to Phase 17; Dell endpoint non-service/fragility; exposure claims are **validation-conditional** (PASS/CONDITIONAL/FAIL per `review/04-HUMAN-VALIDATION-PROTOCOL.md`), H-vs-L exposure is not comparable because of baseline construct-key saturation, and a scenario-level bootstrap is not a valid H2 sensitivity (T5/T7). |
| §17 open decisions | Updated list in `10-CHECKPOINT2-REPORT.md` §9 / `PILOT-CHANGES.md` |

## 3. Design constraints that remain fixed until freeze

- 4 arms (`none`, `memory`, `manual`, `corrected`), 6 strata, 400 scenarios, 200 high / 200 low,
  3 stochastic repetitions (technical replicates; see the §5 relabel), 4,800 confirmatory executions.
- Full-file HTML outputs (no diff/patch format), non-zero sampling at a fixed setting, thinking off.
- Primary estimand = CVR on the pre-registered high-opportunity scenarios, equal-stratum weighted.
- Prompt path = current production `buildForgePrompt` (pinned); no prompt-level identity with Phase 17
  is claimed.
- Exposure analyses are conditional on the pre-freeze human-validation verdict; the H-vs-L exposure
  contrast is never permitted, and exposure-stability is reported only on PASS.
- No optional stopping, no interim looks, one analysis run on the frozen dataset.
- No confirmatory run and no freeze until the user approves after checkpoint 2.

## 4. What the pilot changed (pre-freeze changes to fold in)

See `PILOT-CHANGES.md`. The consolidated protocol v0.3 must incorporate the fixes and their
provenance; no pilot-derived effect size may be used to choose a design parameter
(`04b` §4.8 pre-declared margin rule excepted).


## 4. Single-reviewer amendment (2026-11-01)

The confirmed environment has only the project author as a human reviewer; the two-coder/κ plan is
superseded for execution by `review/12-SINGLE-REVIEWER-VALIDATION.md` and the protocol §8.4 amendment.
No independent or inter-rater claim is permitted; exposure-conditioned analyses are demoted/removed
if the single-reviewer check is inadequate. The primary H1/H2/H3 remain detector/opportunity-label
based and unaffected by the exposure instrument.
