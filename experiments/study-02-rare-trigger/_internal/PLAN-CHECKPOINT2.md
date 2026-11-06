# Checkpoint 2 — internal execution plan (not a deliverable)

**Approved by user (2026-10-31):** conditional approval for the Dell pilot. Scope: endpoint
qualification, expansion of opportunity templates, corpus construction, deterministic scoring,
30-scenario pilot (120 primary + 12 repeat executions). **Forbidden:** confirmatory experiment,
freezing the preregistration, paid API calls. Full-file output comparability with Phase 17.
Pilot data completely separate from confirmatory data. No claim of independent human validation.

## Decisions fixed for this checkpoint

1. **Opportunity-class confounding resolved by matched twin templates.** Every baseline family gets
   **10 structural templates** `T00–T09`, each instantiated twice:
   - `v00–v09` = high-opportunity configuration (H; ≥3 declared affordance hooks);
   - `v10–v19` = low-opportunity configuration (L; ≤1 hook) of the **same template** (v(10+i) is the
     twin of v(i), differing only in the hook configuration).
   Opportunity class is therefore crossed with structural template (matched pairs), not confounded
   with variant identity; high-opportunity templates double from 5 to 10 per family.
2. **Corpus allocation revised** (400 unchanged, 200 high / 200 low unchanged):
   - 4 game strata × **60** scenarios = 20 variants × 3 frozen paraphrases;
   - 2 focus strata × **80** scenarios = 20 variants × 4 frozen paraphrases;
   - high per game stratum = 10 H variants × 3 = 30; high per focus stratum = 10 H variants × 4 = 40;
     high total = 4×30 + 2×40 = **200**, low total = **200**.
   - 3 reps ⇒ 4,800 confirmatory executions (unchanged, not executed now).
3. **Pilot (separate data):** 30 scenarios = 5 per stratum, using variants `v00, v01, v02` (H twins)
   and `v10, v11` (L twins) with a **pilot-only paraphrase `p00`** for each request (not in the
   corpus). Executions: 30 × 4 arms × 1 rep = **120 primary**. Repeats: 3 scenarios × 4 arms =
   **12 extra** (8 same-seed determinism checks: 2 scenarios × 4 arms; 4 new-seed variability checks:
   1 scenario × 4 arms). All under `pilot/`, never pooled with confirmatory data.
4. **Scoring:** study-local frozen copy of the Phase 17 detectors + Phase 16 child-safety detector,
   hash-pinned; deterministic scoring of primary + sensitivity detectors, trigger-zone exposure,
   construct sets, hashes. Validated by re-scoring the Phase 17 committed outputs and reproducing
   the committed counts, plus fixture tests.
5. **Endpoint qualification:** real production-prompt full-file generations on Dell (thinking off,
   seeds, model id asserted), measuring wall time, prompt/completion tokens, tok/s, cache hits,
   determinism. Projection for 132 pilot executions computed from measurements.
6. **Go/no-go (user condition 8):** if projected pilot wall time for 132 executions is **> 10 h**
   or measured p95 per run is **> 8 min**, STOP before the pilot, deliver the qualification and
   projection, and request review. If ≤ 10 h, run the pilot as a resumable background job and report
   actual throughput against the projection.

## File ownership (disjoint writes)

| Owner | Files |
|---|---|
| dell-scout | `07-ENDPOINT-QUALIFICATION.md`, `qualification/` |
| protocol-architect | `design/design-v2.json`, `design/corpus-spec-v2.md`, `corpus/`, `scripts/study02/gen_corpus.py`, `08-CORPUS-DIVERSITY.md`, `pilot/pilot-plan.json` |
| harness-engineer | `scoring/`, `scripts/study02/score.py`, `scripts/study02/runner.mjs`, `scripts/study02/run_pilot.mjs`, `scripts/study02/test_*.py`, `09-SCORING.md` |
| stats-analyst | `04b-ANALYSIS-PLAN-REV2.md`, `analysis/power_study2_rev2.py`, `analysis/power_study2_rev2.txt` |
| Lead | `10-CHECKPOINT2-REPORT.md`, `README.md` updates, pilot execution control, `MANIFEST-checkpoint2.sha256`, commit/PR |

Corpus interface (contract; protocol-architect produces, harness consumes):
`corpus/corpus.json` (array of 400 scenario objects: `scenario_id`, `stratum`, `variant_id`,
`request_id`, `paraphrase_text`, `opportunity_class`, `label_record`), `corpus/variants/*.html`,
`corpus/paraphrases.json`, `corpus/labels.json`, `pilot/pilot-plan.json` (30 pilot scenarios +
12 repeat specs), `corpus/corpus.sha256`.

## Hard rules (unchanged)

No confirmatory run, no freeze, no paid API calls, no model downloads, no changes to the frozen
submission or to Phase 15B/17 locked artefacts, full-file outputs, pilot separate, no claims of
human validation, no fabricated results.
