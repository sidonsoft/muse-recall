# Study 02 — Rare-Trigger Reliability

**Status: CHECKPOINT 1 COMPLETE — audit, protocol draft and Dell endpoint discovery. NOT
preregistered, NOT frozen, NO experimental results.** The confirmatory experiment has not started
and must not start until the statistical analyst's unit-of-analysis approval, the Phase 1 audit and
a frozen preregistration are all in place (and the user approves). The Dell pilot may proceed
earlier, but its data are kept separate from the confirmatory dataset.

This directory is the working area for a preregistered follow-up to the Muse Recall Phase 17
evaluation (`docs/hackathon-evidence/phase17/`). The follow-up answers a specific criticism:

> Meridian: Phase 17's zero observed violations in the `memory` arm may reflect scenarios in which
> the violation opportunity rarely occurred, not genuine constraint retention.

The study replaces the original marginal statistic (violations / usable runs) with a **conditional
violation rate (CVR): violations among runs that had a valid trigger opportunity**, and reports
trigger prevalence, trigger exposure and actual violations as three separate quantities.

---

## Repository context

| | |
|---|---|
| Repository | `sidonsoft/muse-recall` |
| Working branch | `integration` (this checkout `/Users/burnz/projects/muse-memory-lab`) |
| Study directory | `experiments/study-02-rare-trigger/` |
| Original study | `docs/hackathon-evidence/phase17/` (locked; not modified) |
| Frozen submission | tags `submission-v14`, `submission-v15` and `main` — **not modified** |
| Target line | follow-up to Phase 17; does not replace or revise it |

Nothing in this directory changes production application behaviour. No Phase 15B/17 locked artifact
(`protocol.sha256`, `SHA256SUMS`, `out/`, `pilot/`, `LOCK.md`, `CORRECTIONS*`) is modified.

---

## Deliverables (mission Phase 6 numbering)

| # | Deliverable | File / directory | Status |
|---|---|---|---|
| 1 | Experimental protocol | [`02-PROTOCOL-DRAFT.md`](02-PROTOCOL-DRAFT.md) | **DRAFT** — 18 sections; not frozen |
| 2 | Preregistration document | `design/protocol.sha256` + `LOCK` (future) | **NOT YET** — created only after pilot, fixes and approval |
| 3 | Frozen scenario corpus | `design/corpus-spec.md` + future `corpus/` | **CONTRACT ONLY** — corpus does not exist yet |
| 4 | Expected-outcome labels | schema in protocol §8 / `design/design-draft.json` | **SCHEMA ONLY** — 19-field label file not generated |
| 5 | Reproducible execution harness | future `scripts/study02/` | **PENDING** — design + endpoint contract ready |
| 6 | Pilot report | future `pilot/` | **PENDING** — pilot not executed |
| 7 | Confirmatory results report | future `results/` | **PENDING** — not started (gate) |
| 8 | Statistical analysis | [`04-ANALYSIS-PLAN.md`](04-ANALYSIS-PLAN.md) + [`analysis/`](analysis/) | **PLAN + SIMULATED POWER ONLY** — no observed data |
| 9 | Reproduction instructions | [`REPRODUCTION.md`](REPRODUCTION.md) | Checkpoint scope documented; full run pending |
| 10 | Public technical summary for Meridian | [`06-PUBLIC-SUMMARY-DRAFT.md`](06-PUBLIC-SUMMARY-DRAFT.md) | **DRAFT OUTLINE** — no results to summarise yet |

Checkpoint support documents:

| Document | Contents |
|---|---|
| [`01-AUDIT.md`](01-AUDIT.md) | Phase 1 audit: artefacts, arms/trigger definitions, detector reproducibility, provenance gaps, reuse matrix |
| [`03-DELL-ENDPOINT.md`](03-DELL-ENDPOINT.md) | Dell PolyStrata endpoint: machine metadata, API contract, measured throughput, pilot configuration |
| [`05-CHECKPOINT-REPORT.md`](05-CHECKPOINT-REPORT.md) | Findings, verified-vs-unresolved, decisions required before freeze |
| [`MANIFEST-checkpoint1.sha256`](MANIFEST-checkpoint1.sha256) | SHA-256 of every checkpoint artefact (integrity of this checkpoint, not a preregistration lock) |
| [`_internal/BRIEF.md`](_internal/BRIEF.md) | Team working brief (internal, not an output for Meridian) |

---

## Study design in one table (draft, not frozen)

| Element | Draft |
|---|---|
| Arms | `none`, `memory`, `manual`, `corrected` (identical semantics to Phase 17) |
| Strata | `farm-arcade`, `farm-challenge`, `orchard-arcade`, `orchard-challenge`, `focus-reward`, `focus-lively` (Phase 17 continuity) |
| Corpus | 400 unique scenarios = 4 game strata × 70 (10 variants × 7 paraphrases) + 2 focus strata × 60 (10 × 6) |
| Opportunity | 200 high-opportunity / 200 low-opportunity scenarios, assigned by frozen corpus construction (pre-treatment) |
| Repetitions | 3 per scenario per arm, non-zero sampling (0.7 / 0.8 draft) |
| Executions | 4,800 confirmatory + 240 pilot (all executed; no optional stopping) |
| Primary metric | CVR on the pre-registered high-opportunity subset, equal-stratum weighted |
| Unit of analysis | the unique scenario (3 reps are technical replicates; arms paired within scenario) |
| Primary tests | H1/H3 stratified paired sign-flip permutation (Holm); H2 cluster-bootstrap non-inferiority, +10 pp margin (draft) |
| Order | SHA-256 key `sha256("2760742:<scenario_id>:<arm>:<rep>")`, seed `0x02A2026`, 8 deterministic shards |
| Pilot | 30 pilot-only scenarios covering all six strata, Dell endpoint only, excluded from confirmatory data |

See the protocol draft for the authoritative wording. No number in this table is frozen.

---

## Headline checkpoint findings

1. **The original detector and analysis are reproducible from committed evidence.** The Phase 17
   detector fixtures pass 41/41, the lock manifest verifies 17/17, the output manifest 1205/1205, a
   full independent re-score of the 472 committed HTML outputs matches all 96 analysis cells, and
   the committed analysis JSON reproduces byte-for-byte. However, the *generation* step is not
   reproducible (no model endpoint replay) and the verifiers are same-author.
2. **Meridian's criticism is materially correct.** No Phase 17 artefact defines, measures or
   conditions on trigger opportunity (`grep -rin 'opportunit'` over the evidence tree: 0 matches).
   Two strata had zero `none`-arm violations and therefore "contribute nothing to H1"; the
   `memory` arm's 0/58 and 1/60 are unconditional counts.
3. **The Dell endpoint is usable for the pilot but not for the full 4,800-run confirmatory pass.**
   `qwen3.6-35b-a3b-ud-q3_k_m` (Qwen3.6-35B-A3B, UD-Q3_K_M) on PolyStrata 0.1.45, OpenAI-compatible
   `POST /v1/chat/completions`, no auth, single generation slot, ~25 tok/s decode / ~303 tok/s
   prefill. Full-file HTML outputs (Phase 17 mean ≈ 6.2k tokens) imply ≈200–600 s/run and
   ≈11–33 days of continuous serial execution for 4,800 runs. This is a freeze blocker, not a
   harness-tuning detail.
4. **The unit of analysis and power are resolved for the draft design** (scenario-level clustering;
   3 reps technical; +10 pp H2 margin; power ≥0.99 at calibrated rates) but an independent second
   implementation of the analysis is still required, and the opportunity-class design has a
   variant-level confound that must be resolved before freeze.
5. **Nothing is preregistered.** The protocol is a draft; the corpus, labels, harness and analysis
   script do not exist yet; the pilot has not run; no confirmatory data exist.

---

## Next gate (not executed in this checkpoint)

1. Resolve the decisions in [`05-CHECKPOINT-REPORT.md`](05-CHECKPOINT-REPORT.md) §6, especially the
   confirmatory endpoint/model, output format/throughput plan, human-coding resource and the
   opportunity-class design fix.
2. Build the corpus + label generator, endpoint client, runner, scoring and order/verifier scripts.
3. Run the 30-scenario Dell pilot; report it separately; fix defects; write `PILOT-CHANGES.md`.
4. Freeze (protocol, design, corpus, labels, analysis, ordering, seeds, run config), hash into
   `design/protocol.sha256`, commit and push a tag **before** the first confirmatory run.
5. Only then execute the confirmatory experiment and publish results without suppressing negative
   findings.

**No claims are made here that zero observed failures establish zero failure probability.**
