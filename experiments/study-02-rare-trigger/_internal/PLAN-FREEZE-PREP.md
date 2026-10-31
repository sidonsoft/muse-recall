# Freeze-preparation brief (checkpoint 3 review gate) — internal

**Status:** offline preparation only. **No confirmatory run, no preregistration freeze, no freeze
tag, no paid API calls.** Work on branch `study02/freeze-prep` (base `85773b3`, checkpoint 2). Do not
modify the frozen submission, Phase 15B/17 locked artifacts (`protocol.sha256`, `SHA256SUMS`,
`out/`, `pilot/`, `LOCK.md`, `CORRECTIONS*`), or the product integration branch. Do not print,
write or commit any credential.

## Mission

Prepare Study 02 for a future confirmatory freeze with **Baseten-hosted Muse Spark Open**
(`meta-models/muse-spark-open-1026`) proposed as the replacement for the slow Dell/Qwen endpoint.
The Dell work stays an **archived exploratory pilot**. Its data, reports, incident history and
hashes are preserved unchanged and are **never combined** with future confirmatory observations.

Four independent reviews are produced and then consolidated by the Lead into one
freeze-readiness report. Evidence classes stay separate:

| Class | Location | Meaning |
|---|---|---|
| Exploratory (Dell pilot) | `pilot/`, `07-*`, `10-CHECKPOINT2-REPORT.md` | Observed on Dell/Qwen; excluded from confirmatory data |
| Qualification (Baseten, future) | `qualification-baseten/` | Provider/contract validation only; excluded from confirmatory data |
| Confirmatory (future) | does not exist | Frozen design, frozen corpus, frozen analysis |

## Reviews and file ownership (disjoint)

| Reviewer | Deliverables | Scope |
|---|---|---|
| accounting-auditor | `review/01-PILOT-ACCOUNTING-AUDIT.md`, `review/pilot-inclusion-table.json`, `scripts/study02/audit_pilot_accounting.py` | Reconcile 132 original records / 123 usable originals / 9 replacements / arm denominators totalling 111; record-level inclusion table; corrected-arm semantics; replacement/transport confounding check |
| baseten-reviewer | `review/02-BASETEN-CONTRACT.md`, `review/03-QUALIFICATION-PLAN.md` | Verify the current official Baseten/Muse Spark Open contract; model/provider change record; bounded qualification plan with exact request/token budget, stop rules, cost format; credential handling |
| design-reviewer | `review/04-HUMAN-VALIDATION-PROTOCOL.md`, `review/05-DESIGN-STATISTICAL-REVIEW.md` | Blinded human-validation protocol for the exposure instrument and labels; claims dependency map; design/power/margin/exclusions/stopping review for the Baseten confirmatory plan |
| freeze-fixer | `review/06-OFFLINE-FIXES.md`, `design/prompt-builder-pin.json`, patched `scripts/study02/gen_corpus.py`, regenerated `corpus/corpus.json` + `corpus/labels.json` + `corpus/corpus.sha256` + `corpus/validation.json`, minimal protocol repeat-relabel edits | Finish prompt-builder pinning, template_id/twin_id propagation, repeat relabeling, corpus diversity addendum; prove variants are byte-identical after regeneration |
| Lead | `review/00-FREEZE-READINESS-REPORT.md`, `MANIFEST-freeze-prep.sha256`, commit/push | Consolidation, measured-throughput cost/duration estimate, explicit decisions required, verification |

## Non-negotiable constraints

- No paid Baseten calls; no confirmatory generations; no freeze/tag. The Baseten credential is not
  in the environment (`$BASETEN_API_KEY` absent) — do not ask for it to be printed; record the
  blocker and the exact approval needed.
- Never print, log or commit a key. If a credential file is found, record only its path and mode.
- Do not alter pilot data or checkpoint-2 hashes; new fixes go in new commits and a new manifest.
  The historical `MANIFEST-checkpoint2.sha256` applies to commit `85773b3`.
- Keep the Dell pilot exclusive: no Dell runs are planned; further Dell runs are unnecessary unless a
  specific unresolved question requires them (record the question if so).
- Treat repeated requests as repeatability measurements unless determinism is actually established.
- Do not select endpoint, margin or analysis to favour treatment effects; state assumptions and
  sensitivity analyses explicitly.
- Mark AI-generated review as review, never as human validation.

## Context pointers

- Checkpoint-2 report: `10-CHECKPOINT2-REPORT.md`; pilot changes D-P1..D-P11: `PILOT-CHANGES.md`.
- Protocol/revision/analysis: `02-PROTOCOL-DRAFT.md`, `02b-PROTOCOL-REVISION-V2.md`,
  `04b-ANALYSIS-PLAN-REV2.md`, `analysis/power_study2_rev2.*`.
- Corpus: `design/design-v2.json`, `design/corpus-spec-v2.md`, `corpus/`.
- Scoring: `09-SCORING.md`, `scoring/`, `scripts/study02/test_scoring.py`.
- Endpoint evidence: `07-ENDPOINT-QUALIFICATION.md`, `03-DELL-ENDPOINT.md`.
- Phase 17 Baseten precedent: `docs/hackathon-evidence/phase17/design.json`,
  `run_open.mjs`, `RESULTS.md` (measured prior: ~52 s/run, 6 shards, 480 runs).
