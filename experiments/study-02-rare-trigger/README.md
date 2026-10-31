# Study 02 — Rare-Trigger Reliability

**Status: CHECKPOINT 2 IN PROGRESS.** Endpoint qualification, the expanded matched-twin corpus,
deterministic scoring and the revised power analysis are complete; the approved 30-scenario Dell
pilot (120 primary + 12 repeat executions) is executing. **The confirmatory experiment has NOT
started, the preregistration is NOT frozen, and the confirmatory model/endpoint is NOT decided.**
Nothing here is a confirmatory result.

This directory is the working area for a preregistered follow-up to the Muse Recall Phase 17
evaluation (`docs/hackathon-evidence/phase17/`). The follow-up answers a specific criticism:

> Meridian: Phase 17's zero observed violations in the `memory` arm may reflect scenarios in which
> the violation opportunity rarely occurred, not genuine constraint retention.

The study replaces the original marginal statistic (violations / usable runs) with a **conditional
violation rate (CVR): violations among runs that had a valid trigger opportunity**, and reports
trigger prevalence, trigger exposure and actual violations as three separate quantities. See
[`10-CHECKPOINT2-REPORT.md`](10-CHECKPOINT2-REPORT.md) for the checkpoint-2 report and
[`05-CHECKPOINT-REPORT.md`](05-CHECKPOINT-REPORT.md) for the checkpoint-1 record.

---

## Repository context

| | |
|---|---|
| Repository | `sidonsoft/muse-recall` |
| Working branch | `integration`; study branch `study02/checkpoint-1` (draft PR #187) |
| Study directory | `experiments/study-02-rare-trigger/` |
| Original study | `docs/hackathon-evidence/phase17/` (locked; not modified) |
| Frozen submission | tags `submission-v14`, `submission-v15` and `main` — **not modified** |
| Confirmatory gate | blocked until audit + unit-of-analysis approval + frozen preregistration + user approval |

Nothing here changes production application behaviour or any Phase 15B/17 locked artefact
(`protocol.sha256`, `SHA256SUMS`, `out/`, `pilot/`, `LOCK.md`, `CORRECTIONS*`). Pilot and
qualification data are excluded from any confirmatory dataset.

---

## Checkpoint-2 deliverables

| Artefact | Path | Status |
|---|---|---|
| Endpoint qualification (6 real generations, throughput, stop-rule decision) | [`07-ENDPOINT-QUALIFICATION.md`](07-ENDPOINT-QUALIFICATION.md), [`qualification/`](qualification/) | **Complete** |
| Expanded matched-twin corpus (60 variants, 400 scenarios, 200/200, labels) | [`corpus/`](corpus/), [`design/design-v2.json`](design/design-v2.json), [`design/corpus-spec-v2.md`](design/corpus-spec-v2.md) | **Complete (draft, not frozen)** |
| Corpus diversity analysis | [`08-CORPUS-DIVERSITY.md`](08-CORPUS-DIVERSITY.md) | **Complete, with candid limits** |
| Deterministic scoring (frozen detectors + exposure classifier + validation) | [`09-SCORING.md`](09-SCORING.md), [`scoring/`](scoring/), [`scripts/study02/score.py`](scripts/study02/score.py), [`scripts/study02/test_scoring.py`](scripts/study02/test_scoring.py) | **Complete and validated against Phase 17** |
| Resumable full-file pilot runner | [`scripts/study02/runner.mjs`](scripts/study02/runner.mjs), [`scripts/study02/run_pilot.mjs`](scripts/study02/run_pilot.mjs), [`scripts/study02/supervise_pilot.sh`](scripts/study02/supervise_pilot.sh) | **Complete; pilot-only (refuses confirmatory)** |
| 30-scenario pilot (120 + 12 executions) | [`pilot/`](pilot/) | **Executing** |
| Pilot analysis | [`scripts/study02/analyze_pilot.py`](scripts/study02/analyze_pilot.py), [`pilot/pilot-analysis.json`](pilot/pilot-analysis.json), [`pilot/pilot-tables.md`](pilot/pilot-tables.md) | **Pipeline ready; final numbers after completion** |
| Revised analysis plan + power (matched-twin design) | [`04b-ANALYSIS-PLAN-REV2.md`](04b-ANALYSIS-PLAN-REV2.md), [`analysis/power_study2_rev2.py`](analysis/power_study2_rev2.py), [`analysis/power_study2_rev2.txt`](analysis/power_study2_rev2.txt) | **Complete (SIM only)** |
| Protocol revision notice v0.2 | [`02b-PROTOCOL-REVISION-V2.md`](02b-PROTOCOL-REVISION-V2.md) | **Draft** |
| Pilot changes / defect list (pre-freeze) | [`PILOT-CHANGES.md`](PILOT-CHANGES.md) | **Live** |
| Checkpoint-2 report (endpoint, corpus, pilot, defects, power, budget) | [`10-CHECKPOINT2-REPORT.md`](10-CHECKPOINT2-REPORT.md) | **In progress** |
| Reproduction instructions | [`REPRODUCTION.md`](REPRODUCTION.md) | Checkpoint-1 + checkpoint-2 commands |
| Public technical summary for Meridian | [`06-PUBLIC-SUMMARY-DRAFT.md`](06-PUBLIC-SUMMARY-DRAFT.md) | **Draft, no results** |
| Checkpoint-1 documents | `01-AUDIT.md`, `02-PROTOCOL-DRAFT.md`, `03-DELL-ENDPOINT.md`, `04-ANALYSIS-PLAN.md`, `05-CHECKPOINT-REPORT.md`, `design/corpus-spec.md`, `design/design-draft.json` | Preserved unchanged as the checkpoint-1 record |

---

## Revised design in one table (draft, not frozen)

| Element | Design v0.2 |
|---|---|
| Arms | `none`, `memory`, `manual`, `corrected` (Phase 17 semantics) |
| Strata | `farm-arcade`, `farm-challenge`, `orchard-arcade`, `orchard-challenge`, `focus-reward`, `focus-lively` |
| Corpus | 400 scenarios = 4 game strata × 60 (20 variants × 3 paraphrases) + 2 focus × 80 (20 × 4) |
| Variants | 60 single-file apps: 3 families × 10 structural templates × matched H/L twins |
| Opportunity | 200 high-opportunity / 200 low-opportunity, class crossed with template (matched pairs) |
| Reps | 3 per scenario per arm; non-zero sampling (temperature 0.7 / top_p 0.8), thinking disabled |
| Executions | 4,800 confirmatory (not executed) |
| Primary metric | CVR on the 200 high-opportunity scenarios, equal-stratum weighted |
| Unit of analysis | unique scenario; reps technical; **H2 clustered at the variant level** |
| Primary tests | H1/H3 stratified paired sign-flip permutation (Holm); H2 variant-cluster bootstrap non-inferiority, **+10 pp** recommended margin |
| Order | SHA-256 key, seed `0x02A2026` (confirmatory formula finalised at freeze) |
| Pilot | 30 scenarios × 4 arms × 1 rep + 12 repeats = 132, Dell only, excluded from confirmatory data |

---

## Headline checkpoint-2 findings

1. **Endpoint qualified.** Dell `qwen3.6-35b-a3b-ud-q3_k_m` (PolyStrata 0.1.45) serves full-file
   generations at ~24 tok/s decode / ~365 tok/s prefill; projected 132 pilot executions 8.7 h
   (central) vs the 10 h planning threshold, so the stop rule was not triggered. It **is not
   seed-deterministic at temperature 0.7**, and 4,800 confirmatory runs on this single slot would
   take ≈318 h — the confirmatory endpoint decision is deferred.
2. **Opportunity-class confound resolved.** 10 templates/family each in high/low twin configurations,
   class crossed with template; high-opportunity templates 15 → 30. Corpus validated: 60/60
   detector-clean, twins differ only in hook blocks, 400 unique scenarios, 200/200, labels generated.
   Diversity limit reported honestly: structural not from-scratch app diversity (raw-text Jaccard
   ≈0.97 within family).
3. **Scoring is deterministic and reproduced.** Frozen Phase 17/16 detector copies hash-pinned; a
   full re-score of the committed Phase 17 outputs reproduces `phase17-analysis.json` exactly
   (24/24 cells per model × reading); exposure classifier fixture-tested. No human validation
   occurred — no human-validation claim is made.
4. **Power revised.** 400 × 3 remains adequate (H1/H3 saturated; H2@10 min 0.910 at arm parity under
   the worst clustering cell); recommended margin +10 pp with a coarse pre-declared pilot fallback.
   The revision is a confound fix, not a power gain.
5. **Pilot defects found and handled** (see `PILOT-CHANGES.md`): Node fetch 300 s body timeout (fixed
   with a curl transport), a post-restart LAN reachability quirk (curl used), client-abort ≠
   server-abort queueing (idle-slot supervisor), seed non-determinism (protocol relabel required),
   production prompt-builder drift (comparability caveat), corpus `template_id` field to add, and
   the missing human-coding resource (blocker for freeze).

---

## Next gate

1. Finish and analyse the pilot; record every defect (`PILOT-CHANGES.md`, `10-CHECKPOINT2-REPORT.md`).
2. User review of checkpoint 2: confirmatory endpoint/model, human-coding resource, corpus-diversity
   decision, and the remaining open items.
3. Fold pilot changes into the consolidated protocol v0.3; generate spares/validation; freeze
   (protocol, design, corpus, labels, scoring, runner, analysis, order, seeds) and push a tag
   **before** the first confirmatory run.
4. Only then execute the confirmatory experiment and publish results without suppressing negative
   findings.

**No claim is made that zero observed failures establish zero failure probability.**
