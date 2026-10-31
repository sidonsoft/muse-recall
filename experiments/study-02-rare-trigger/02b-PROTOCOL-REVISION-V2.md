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
| 5 | 8 same-seed repeats described as "determinism checks" | **12 repeats are repeatability/variability probes** (the endpoint is not seed-deterministic at temperature 0.7) | Pilot defect D-P1 (see `PILOT-CHANGES.md`) |
| 6 | Prompt path assumed byte-comparable to Phase 17 `run_open.mjs` | **Current production `buildForgePrompt` (structured `memories`) is used; prompt-level identity with Phase 17 is NOT established** and must be stated + the production prompt version pinned at freeze | Production prompt builder changed after Phase 17; the old `memoryBlock` argument no longer exists |
| 7 | Pilot: 30 scenarios × 4 arms × 2 reps = 240 | **Pilot: 30 scenarios × 4 arms × 1 rep = 120 + 12 repeats = 132** (approved budget) | User-approved pilot budget; throughput |
| 8 | No opportunity template families; hooks implicit | **30 templates with declared affordance hook blocks (H) and twin L configurations**, all detector-clean | Corpus construction requirement from checkpoint 2 |
| 9 | Execution order seed `0x02A2026`, formula in protocol §6 | Unchanged for the design; **pilot seeds are plan-fixed** (`pilot-plan.json`) with an independent derived-seed cross-check recorded per run | Pilot runtime finding; confirmatory seed derivation to be finalised at freeze |
| 10 | 4,800 confirmatory executions | **Unchanged** (400 × 4 × 3) | — |

## 2. Section-by-section supersession map (for the eventual v0.3 merge)

| v0.1 section | Status in v0.2 |
|---|---|
| §4 strata, baseline families, 400-scenario corpus | **Superseded** by `design/design-v2.json` and `design/corpus-spec-v2.md` (templates, twins, 60/60/60/60/80/80 allocation) |
| §5 repetitions, sampling, total executions | Total unchanged (4,800); sampling params confirmed by the Dell qualification; repeats self-consistency wording superseded by (5) above |
| §6 order and sharding | Unchanged in substance; the exact confirmatory seed/order formula will be fixed at freeze |
| §7 trigger prevalence/exposure/violation/CVR | Unchanged in substance; opportunity class now matched at template level |
| §8 frozen expected-outcome labels | Unchanged schema (19 fields); corpus labels now exist in `corpus/labels.json` (still draft until freeze; human validation NOT done) |
| §9 hypotheses/estimands | Unchanged; H2 margin from `04b` (+10 pp, fallback rule) |
| §10 unit of analysis | Superseded: variant-cluster inference is mandatory for H2 (`04b` §2) |
| §11 statistical analysis structure | Superseded by `04b-ANALYSIS-PLAN-REV2.md` for the matched-twin design |
| §12 exclusions | Unchanged; pilot adds one observed unusable-run class (client transport timeout) and one environment class (queued request) to the harness-defect catalogue |
| §13 pilot | Superseded: 30 scenarios × 4 arms × 1 rep + 12 repeats; Dell only; excluded from confirmatory analysis |
| §14 confirmatory environment | **Still an open decision** (deferred to checkpoint-2 review). Budget options in `10-CHECKPOINT2-REPORT.md` §9 |
| §15 lock policy | Unchanged in intent; plus: the production prompt version and the curl/HTTP transport notes must be pinned in the lock |
| §16 threats to validity | Add: matched-twin corpus is template-engine-generated (high raw-text similarity); no human validation; prompt not byte-identical to Phase 17; Dell endpoint non-service/fragility |
| §17 open decisions | Updated list in `10-CHECKPOINT2-REPORT.md` §9 / `PILOT-CHANGES.md` |

## 3. Design constraints that remain fixed until freeze

- 4 arms (`none`, `memory`, `manual`, `corrected`), 6 strata, 400 scenarios, 200 high / 200 low,
  3 reps, 4,800 confirmatory executions.
- Full-file HTML outputs (no diff/patch format), non-zero sampling at a fixed setting, thinking off.
- Primary estimand = CVR on the pre-registered high-opportunity scenarios, equal-stratum weighted.
- No optional stopping, no interim looks, one analysis run on the frozen dataset.
- No confirmatory run and no freeze until the user approves after checkpoint 2.

## 4. What the pilot changed (pre-freeze changes to fold in)

See `PILOT-CHANGES.md`. The consolidated protocol v0.3 must incorporate the fixes and their
provenance; no pilot-derived effect size may be used to choose a design parameter
(`04b` §4.8 pre-declared margin rule excepted).
