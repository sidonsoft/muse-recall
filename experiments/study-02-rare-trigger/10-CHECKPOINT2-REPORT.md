# Study 02 — checkpoint 2 report

**Date:** 2026-10-31 → 2026-11-01 (Australia/Brisbane) · **Branch:** `integration` / study branch
`study02/checkpoint-1` (PR #187) · **Status: checkpoint 2 complete (report for user review).**

**Gates:** the confirmatory experiment has **not** started and is still blocked. The preregistration
is **not frozen**. No paid API calls were made. The final confirmatory model/endpoint decision is
**deferred** to this checkpoint's review, per the user's instruction.

This checkpoint covers the conditionally approved work: endpoint qualification, expansion of
opportunity templates (matched-twin design), corpus construction, deterministic scoring, the
30-scenario Dell pilot (120 primary + 12 repeat executions), revised power simulations and a
recommended confirmatory budget. Pilot data live under `pilot/` and are **never pooled with
confirmatory data**.

---

## 1. Approval conditions and how they were met

| User condition | Status |
|---|---|
| 1. Do not start the confirmatory experiment | **Met** — no confirmatory path exists in the tooling; the runner refuses `--confirmatory`. |
| 2. Do not freeze the preregistration | **Met** — no `protocol.sha256`, no lock, no tag; all documents labelled draft. |
| 3. No paid API calls | **Met** — Dell endpoint only, free/local; no Baseten/Muse calls. |
| 4. Resolve opportunity-class confounding before final corpus construction | **Met** — 10 structural templates per family, each with matched H/L twins; class crossed with template. See §4. |
| 5. Preserve full-file output comparability with Phase 17 | **Met** — every execution requests and receives a complete single-file HTML document (no diff/patch format); measured outputs 11.5–19.0 KB during qualification and full files in the pilot. |
| 6. Keep pilot results separate from confirmatory data | **Met** — `pilot/` only; pilot-only `p00` paraphrases disjoint from the 400-scenario corpus; analysis labels pilot as excluded. |
| 7. No claim of independent human validation | **Met** — no human coding occurred; all labels are authored/mechanical. Stated in `09-SCORING.md`, `08-CORPUS-DIVERSITY.md` and here. |
| 8. Record actual Dell throughput; stop for review if projected pilot runtime becomes unreasonable | **Met** — qualification measured every run; projection and stop-rule decision recorded (§3); pilot runs are timestamped and the rolling mean is monitored. One transport defect found and fixed before the pilot proper (§7.2). |
| 9. Rerun power simulations after revising the opportunity-class design | **Met** — `04b-ANALYSIS-PLAN-REV2.md` + `analysis/power_study2_rev2.{py,txt}`; 972-cell main grid, 2.74 M simulated trials. |
| 10. Preserve frozen submission; continue on the study branch/PR | **Met** — no Phase 15B/17 artefact or frozen submission change; work committed to `study02/checkpoint-1` and PR #187. |

---

## 2. New artefacts in this checkpoint

| Artefact | Path | What it is |
|---|---|---|
| Endpoint qualification | `07-ENDPOINT-QUALIFICATION.md`, `qualification/` | 6 real full-file generations, measured throughput, projection, seed finding, raw evidence |
| Revised design | `design/design-v2.json`, `design/corpus-spec-v2.md` | matched-twin template design, paraphrases, label schema |
| Corpus | `corpus/` (60 variants, `corpus.json`, `labels.json`, `paraphrases.json`, manifests/validation/diversity) | 400 scenarios, 200 high / 200 low |
| Corpus diversity | `08-CORPUS-DIVERSITY.md` | structural metrics, similarity, twin proofs, candid limits |
| Scoring | `scoring/`, `scripts/study02/score.py`, `scripts/study02/test_scoring.py`, `09-SCORING.md` | frozen detector copies + deterministic scorer + exposure classifier |
| Runner | `scripts/study02/runner.mjs`, `run_pilot.mjs` | production-prompt full-file generator, resumable, pilot-only |
| Revised analysis | `04b-ANALYSIS-PLAN-REV2.md`, `analysis/power_study2_rev2.*` | rev2 estimands/unit-of-analysis/power |
| Pilot | `pilot/` | raw outputs/records/summary (excluded from confirmatory) |
| Pilot analysis | `scripts/study02/analyze_pilot.py`, `pilot/pilot-analysis.json`, `pilot/pilot-tables.md` | descriptive pilot analysis |

---

## 3. Endpoint qualification (Dell PolyStrata)

Six real generations were made with the production prompt path (production `buildForgePrompt` with
structured memories, production retrieval mode `forge`, 6/3000 budget), thinking disabled, the
documented non-thinking sampling parameters, and explicit seeds. Full evidence in
`07-ENDPOINT-QUALIFICATION.md` and `qualification/`.

| Baseline | prompt tok | completion tok | wall | finish | output |
|---|---:|---:|---:|---|---:|
| farmyard (arcade) | 5,154 | 5,861 | 261.99 s | stop | 15,932 B |
| orchard (arcade) | 6,447 | 6,387 | 282.80 s | stop | 19,030 B |
| focusflow (reward) | 5,672 | 5,178 | 225.81 s | stop | 16,328 B |
| farmyard same seed repeat | 5,154 | 4,327 | 196.48 s | stop | 11,485 B |
| farmyard new seed | 5,154 | 5,467 | 223.61 s | stop | 14,827 B |
| farmyard 512-token cap probe | 5,154 | 512 | 23.16 s | **length** | none |

- **Throughput [OBSERVED]:** prefill 356–380 tok/s, decode 23.7–24.6 tok/s; wall ≈ prompt/370 +
  completion/24.2. Single generation slot; no queueing; no timeouts during qualification.
- **Projection [INFERRED]:** 132 pilot executions at the measured mean = **8.73 h** (median 8.28 h;
  primary-only mean 9.42 h; p95-per-run 10.22 h). p95 per run 278.6 s.
- **Stop-rule decision:** the pre-declared 10 h planning threshold was **not triggered** on the
  central estimate; the go decision was made with the caveat that the margin is thin. One later
  pilot execution took 320 s, so the observed variance is larger than the qualification sample
  suggested; actual pilot throughput is reported in §7.
- **Protocol-relevant finding (seed):** same prompt + same seed at temperature 0.7 is **not
  byte-deterministic** (5,861 vs 4,327 completion tokens); temperature 0 is reproducible.
  Consequence: the plan's "same-seed determinism" repeats cannot demonstrate determinism — they are
  repeatability probes. This is a pre-freeze defect (D-P1) to fix in the protocol.
- **Prompt-builder drift [OBSERVED]:** current production `buildForgePrompt` takes structured
  `memories` and renders `<project_constraints>`; Phase 17's frozen Open prompts used an older raw
  memory-block wording. Study 02 uses **current production** (correct for a new study) but prompt
  identity with Phase 17 is **not** established; this must be stated, and the production prompt
  version pinned at freeze.
- **Endpoint fragility:** manual console process, not a managed service; a multi-hour unattended run
  depends on its console staying alive. The pilot is resumable per run.
- **Confirmatory implication:** 4,800 full-file executions on this single slot ≈ **318 h (13.2 days)**
  serial — not feasible as a single run. This drives the recommended budget in §9.

---

## 4. Corpus construction and diversity (opportunity-class confounding resolved)

**Design change (approved direction "expansion of opportunity templates"):** each baseline family
(farmyard, orchard, focusflow) has **10 structural templates** `T00–T09`, each instantiated twice:

- `v00–v09` = **high-opportunity** configuration (≥3 declared affordance hooks: in-game scoring,
  feedback, celebration and timing-adjacent UI subsystems; all inert/detector-clean);
- `v10–v19` = **low-opportunity** configuration of the **same template** (≤1 hook);
- `v(10+i)` is byte-identical to `v(i)` with only the hook block removed (30/30 twin proofs, 43–50
  changed lines/pair).

Opportunity class is therefore **crossed with structural template** (matched pairs) rather than
confounded with variant identity, and the high-opportunity corpus doubles from 15 to **30 distinct
templates** (10 per family).

**Corpus size and allocation (revised, still 400 scenarios):**

| Stratum | Scenarios | Construction | High-op |
|---|---:|---|---:|
| `farm-arcade` | 60 | 20 variants × 3 paraphrases | 30 |
| `farm-challenge` | 60 | 20 × 3 | 30 |
| `orchard-arcade` | 60 | 20 × 3 | 30 |
| `orchard-challenge` | 60 | 20 × 3 | 30 |
| `focus-reward` | 80 | 20 × 4 | 40 |
| `focus-lively` | 80 | 20 × 4 | 40 |
| **Total** | **400** | 60 variants × frozen paraphrases | **200** (low 200) |

3 reps × 4 arms × 400 = **4,800 confirmatory executions** (unchanged; not executed).

**Validation [VERIFIED NOW in this checkpoint]:** 60/60 variants parse as single-file HTML; 60/60 are
detector-clean under the primary **and** sensitivity Phase 17 detectors; 60/60 inline JS pass
`node --check`; twins differ only in hook blocks (30/30 proofs); H hooks 3–4 / L 0–1 as designed;
400 unique scenarios, injective `(variant_sha256, request_sha256)`; 400 × 19-field labels with
`baseline_clean=true`; 26 corpus paraphrases + 4 pilot-only `p00`; generator `--check` reproduces all
68 files byte-identically; `corpus.sha256` 67/67.

**Diversity (candid):** 20/20 distinct element signatures and DOM 5-gram sets per family; DOM 5-gram
Jaccard 0.14–0.29 between different templates vs 0.62 for H/L twins. However, raw-text similarity
within a family is high (token Jaccard ≈0.97; ~1.3–2.0 % of lines differ) because the 10 templates
share one family engine and design system. **Structural diversity is at the DOM/layout/HUD/feedback
level, not 10 from-scratch applications**; no browser rendering test was possible. The variants are
deterministic template-engine apps, not byte-derived Phase 17 baselines. The challenge request
paraphrases are the most lexically overlapping (unigram Jaccard 0.90), so they contribute least
scenario variance. These limits bound generalisation and are reported for review.

**Known remaining corpus issues for review:** (i) `corpus.json` rows carry `variant_id` but not an
explicit `template_id` (derivable from `design-v2.json`; add before freeze); (ii) paraphrases are few
for games (3 per request); (iii) the template-engine similarity limit above.

---

## 5. Deterministic scoring

- **Frozen detector copies:** `scoring/phase17/detectors.py` and `scoring/phase16/detector.py` are
  verbatim byte copies (SHA-256 `96ced597…`, `b154dc31…`) equal to the locked originals;
  `scoring/frozen.py` verifies the hashes on import. Later edits to the Phase 17 originals cannot
  move Study 02's scoring endpoint.
- **Trigger-zone exposure classifier:** `scoring/trigger_zones.py`, static source-code only
  (comments/strings stripped exactly as the frozen detectors), construct families per rule
  (timing/countdown, flash, mistake/penalty for games; keyframe/scripted animation for FocusFlow),
  baseline-vs-output construct sets. Exposure is a **descriptive, post-treatment** quantity; it is
  not the primary denominator (collider-bias warning in the protocol and analysis plan).
- **Validation [VERIFIED NOW]:** the 41 Phase 17 fixtures and baseline-clean checks still pass
  against the frozen copies; exposure fixtures (positives/negatives, twin H/L baselines, idle hooks,
  zone-only partial implementations) pass; a full re-score of the committed Phase 17 outputs
  reproduces `phase17-analysis.json` **exactly, 24/24 cells for every model × reading**
  (Open primary 100/240, Open sensitivity 99/240, Spark primary 78/232 with 8 unusable, Spark
  sensitivity 65/232); every primary-detector violation has a novel trigger-zone construct
  (0 consistency mismatches); records contain no floats and are byte-identical on re-run.
- **Limitations:** static source-code definitions only (no runtime/browser instrumentation); the
  exposure instrument is less validated than the detectors and requires the (not yet performed)
  independent human coding; scoring is same-team, and an independent second analysis implementation
  is still required before the confirmatory run.

---

## 6. Revised power and analysis plan (matched-twin design)

`04b-ANALYSIS-PLAN-REV2.md` supersedes the v1 analysis plan for the revised design (v1 kept unchanged
as the checkpoint-1 record). All numbers are **[SIM]** under explicit assumptions, not observed data
(`analysis/power_study2_rev2.py/.txt`, 972-cell grid × 2,000 replicates + validation = 2.74 M
simulated trials, deterministic).

**Unit of analysis and clustering:** unique scenario; 3 reps technical replicates; arms paired within
scenario. Primary H-only analysis = 200 high-opportunity scenarios in **30 H-variant clusters**
(10 per family), 600 runs/arm. Because a template contains exactly its H/L twin pair, template ICC and
matched-pair correlation are the **same random-effect level** in this corpus (one identifiable
pair-level correlation); for the H-only primary analysis, template and variant clustering coincide,
so H2 inference **must cluster at the variant level** (the v1 scenario-level bootstrap would
understate variance by up to ~2.2×).

| Quantity (pilot-calibrated default assumptions) | Value |
|---|---:|
| H1 power (memory < none) | 1.000 |
| H2 power @ 8 / 10 / 15 pp | 1.000 / 1.000 / 1.000 |
| H3 power (corrected > memory) | 1.000 |
| Expected 90% CI width, H2 difference | 5.03 pp |
| Expected 95% CI width, H1 difference | 12.48 pp |
| H2 detectable NI margin, 80% power | 3.80 pp |
| Variant-cluster design effect (primary) | 1.38 (effective scenarios ≈145/200) |

- **Margin recommendation:** **+10 pp**, with a pre-declared pilot fallback to +15 pp only if the
  pilot's high-opportunity memory-arm CVR is ≥3/18 usable runs (≈17 %) while manual is ≤1/18 (≈6 %).
  The pilot cannot estimate ICC/pair correlation (1 rep/arm), so nothing subtler may move the margin.
- **Adequacy:** keep **400 × 3**. Adequate for H1/H3 and H2@10 at arm parity (grid minimum 0.910). It
  cannot guarantee that a true +5 pp memory deficit is called non-inferior at 10 pp under strong
  variant clustering (minimum 0.590) — a margin-region property, not an N defect. Ranked fixes:
  +15 pp margin (free), more high-opportunity templates (corpus change), 5 reps (≈8,000 runs).
- **Cost of the revision vs v1 [SIM]:** design-effect coefficient ~12.4 → ~5.8; high-opportunity
  variant clusters 15 → 30; at high ICC effective scenarios ~68 → ~110. Price: 3 game paraphrases
  instead of 7 and 30 instead of 35 high-op game scenarios (game per-stratum CIs ≈8 % wider); focus
  gains 40 high-op scenarios. The revision is a **confound fix, not a power gain**.

---

## 7. Pilot (30 scenarios, 120 primary + 12 repeat executions, Dell only)

**Status: EXECUTING.** Pilot design: 30 scenarios (5 per stratum: variants v00, v01, v02 = H twins
and v10, v11 = L twins, pilot-only paraphrase `p00`), all 4 arms, 1 rep = 120 primary; 12 repeats
(8 same-seed + 4 new-seed probes). Raw outputs under `pilot/outputs/`, records under
`pilot/records/`, prompts under `pilot/prompts/`; everything is excluded from confirmatory analysis.

### 7.1 Execution incidents (kept in the record)

- **D-P2 — runner transport defect (found and fixed before the pilot proper).** The first two
  attempts died at **301.0 s / 306.0 s** with `"fetch failed"`: Node's global `fetch` (undici) has a
  default 300 s body timeout, while the Dell engine sends no bytes until a full-file generation
  completes. A qualifying Python client had hidden this. Fixed by switching the client to
  `node:http`/`node:https` with an explicit 900 s safety timeout; one real execution then succeeded
  (320.1 s, 7,489 completion tokens, manipulation checks passed). The failed record is quarantined in
  `pilot/aborted-transport-defect/` (no output produced); the run was re-executed under the fix.
- **D-P1 — seed does not provide determinism at temperature 0.7** (qualification §2.2). The 12
  repeats are therefore reported as **repeatability/variability probes**, not a determinism claim;
  this must be relabelled in the protocol before freeze.

### 7.2 Pilot results

### 7.2 Pilot results (descriptive only — pilot data are excluded from confirmatory analysis)

**Execution accounting.** All **132/132** planned primary records exist: **123 usable (93.2 %)** and
**9 unusable**, all nine from transport-side stream stalls / one endpoint shutdown (no scoring
failures). The 9 failed runs were followed by a **user-approved, pre-declared replacement pass**:
exactly one replacement per unusable run, same scenario/arm/rep, same prompt and seed policy,
originals retained. **9/9 replacements succeeded**; they are stored under `pilot/replacements/` and
are reported separately, never merged into the primary dataset. Unusable runs by arm: `none` 2,
`memory` 3, `manual` 3, `corrected` 1; by stratum: farm-arcade 3, farm-challenge 2, orchard-arcade 1,
focus-reward 2, focus-lively 1, orchard-challenge 0. The failures are spread across arms/strata; no
cell lost more than two runs.

| Quantity | Primary pilot | After replacement pass |
|---|---:|---:|
| Planned executions | 132 | 132 + 9 replacements |
| Usable | 123 (93.2 %) | 132 / 132 (primary+replacement, reported separately) |
| Unusable | 9 | — (originals retained) |
| Manipulation checks passed | **132/132** | — |

**Measured timing / throughput [OBSERVED]** (primary records):

| Metric | Value |
|---|---:|
| Wall time per run, mean / median | **345.8 s / 296.0 s** |
| Wall time p95 / max | **624.1 s / 736.7 s** |
| Total run-time (sum of runs) | 45,647 s ≈ **12.7 h** |
| Wall clock, first → last record | ≈13.8 h (including restarts/retries) |
| Prompt tokens, mean | 6,390 |
| Completion tokens, mean / max | 6,386 / 7,999 |
| Output HTML bytes, mean / max | 19,579 / 23,612 |
| End-to-end decode (completion/wall), mean | 20.5 tok/s |
| Per-arm wall means | none 357.4 s, memory 341.6 s, manual 338.7 s, corrected 345.6 s |

The pilot ran ~46 % slower than the 8.73 h qualification projection because ~25 % of runs hit a
server-side mid-stream stall and needed a retry; that is exactly the kind of defect the pilot was
designed to find. **4,800 confirmatory executions on this single slot at the measured mean would be
≈460 h (~19 days) serial**, reinforcing the recommendation not to use Dell for confirmatory.

**Condition assignment.** All 132 primary runs passed the manipulation checks (0/2/1/2 retrieved
memories in `none`/`memory`/`manual`/`corrected`; rule-in-prompt F/T/T/F; correction present and
superseded rule absent in `corrected`); 0 failures. Replacement runs pass the same checks.

**Detector and trigger-exposure descriptives (primary 120, rep 0, usable runs only, frozen
detectors; NO hypothesis test and NO effect-size claim):**

| Arm | Usable | Violations | Detector rate | Exposed (any) | Exposure rate |
|---|---:|---:|---:|---:|---:|
| `none` | 28 | 9 | 32.1 % | 14 | 50.0 % |
| `memory` | 27 | 0 | 0.0 % | 10 | 37.0 % |
| `manual` | 26 | 0 | 0.0 % | 4 | 15.4 % |
| `corrected` | 30 | 10 | 33.3 % | 16 | 53.3 % |

High-opportunity subset (pre-registered class, 18 scenarios/arm before exclusions):

| Arm | Usable | Violations | CVR (violations/usable) | Exposed | Violations / exposed |
|---|---:|---:|---:|---:|---:|
| `none` | 16 | 6 | 37.5 % | 9 | 6/9 |
| `memory` | 16 | 0 | 0.0 % | 6 | 0/6 |
| `manual` | 15 | 0 | 0.0 % | 1 | 0/1 |
| `corrected` | 18 | 5 | 27.8 % | 9 | 5/9 |

Low-opportunity subset: `none` 3/12 (25.0 %), `memory` 0/11, `manual` 0/11, `corrected` 5/12
(41.7 %). The pattern is directionally the same as Phase 17 (`memory`/`manual` at zero observable
violations, `none`/`corrected` above it), but the pilot is small, unblinded, single-endpoint and
**deliberately not analysed inferentially**.

**Trigger-exposure validation finding.** Exposure is low and uneven (15–53 %), and in the
high-opportunity subset the `manual` arm shows only 1/15 exposed vs 6/16 in `memory`. That is a
red flag for the static-source exposure instrument, not an effect claim: the instrument may
undercount edits (it sees only construct-key changes, not behaviour) and is arm-sensitive. It must
be human-validated on a stratified sample before the confirmatory freeze; no human validation has
occurred and none is claimed.

**Consistency checks.** 0 violations without a novel trigger-zone construct and 0 scoring-consistency
failures across all scored runs; every detector/stratum pairing was as labelled.

**Repeat behaviour (12 repeats; recall the endpoint is not seed-deterministic at temperature 0.7).**
- Same-seed repeats (8): **0/8 byte-identical to their primary**; one same-seed repeat changed the
  detector verdict (`focus-reward` `none`: primary no-violation, repeat violation). This confirms the
  D-P1 finding at full-file scale and justifies the confirmatory design's 3 stochastic reps.
- New-seed repeats (4): 0/4 byte-identical; detector verdicts unchanged in this small sample.
- No determinism claim is made; output hashes are not used as integrity evidence.

**Pilot objective checklist.** API reliability: qualified but stalls/retries are a real cost
(93.2 % usability). Condition assignment: 132/132. Trigger classification: deterministic and
self-consistent, but the exposure instrument needs human validation. Deterministic scoring: verified
offline against the Phase 17 committed outputs; 0 scoring defects in the pilot. Output logging:
prompts, raw SSE, parsed responses, outputs and records complete for all usable runs; failed runs
have attempt records but no output. Reproducibility: scoring/analysis reproducible; generation is
not seed-reproducible. Exclusion handling: 9 failures counted and reported, replaced only under the
declared pilot-only rule, and never used in confirmatory data.

---

## 8. Defects found (checkpoint 2)

| ID | Defect | Status | Where documented |
|---|---|---|---|
| D-P1 | Endpoint not seed-deterministic at temp 0.7; repeats cannot demonstrate determinism | **Open — protocol relabel required** | `PILOT-CHANGES.md`, `07-ENDPOINT-QUALIFICATION.md` §2.2 |
| D-P2 | Node `fetch` 300 s body timeout killed valid ~5-min generations | **Fixed** (curl transport) | `PILOT-CHANGES.md`, `_internal/PILOT-LOG.md` |
| D-P3 | Post-restart `EHOSTUNREACH` for Node/Python sockets while curl worked | **Fixed** (curl transport) | `PILOT-CHANGES.md`, `_internal/PILOT-LOG.md` |
| D-P4 | Client abort ≠ server abort; new requests queue behind orphaned generations | **Process fixed** (supervisor idle-wait; never kill a running client) | `PILOT-CHANGES.md`, `_internal/PILOT-LOG.md` |
| D-P5 | Production `buildForgePrompt` drift vs Phase 17; prompt-level identity not established | **Open — document + pin prompt version at freeze** | `PILOT-CHANGES.md`, `07-ENDPOINT-QUALIFICATION.md` |
| D-P6 | `corpus.json` rows lack explicit `template_id`/`twin_id` | **Open — pre-freeze corpus fix** | `PILOT-CHANGES.md`, `04b` cross-check |
| D-P7 | Corpus raw-text diversity limited (shared family engine; token Jaccard ≈0.97) | **Open — decided/reported as a generalisation limit** | `08-CORPUS-DIVERSITY.md` |
| D-P8 | No independent human validation of labels/exposure | **Blocker for freeze** (resource) | `09-SCORING.md`, `PILOT-CHANGES.md` |
| D-P9 | Non-streaming long generations lost the connection (780 s/660 s failures) | **Fixed** (SSE streaming) | `PILOT-CHANGES.md`, `_internal/PILOT-LOG.md` |
| D-P10 | Server-side mid-generation SSE stall left socket open | **Fixed** (120 s inactivity abort + retry; partial streams never scored) | `PILOT-CHANGES.md`, `_internal/PILOT-LOG.md` |
| D-P11 | Sustained-load degradation: run times 500–737 s, ~25 % retries, 9/132 unusable | **Counted, not hidden**; throughput reported; Dell not viable for confirmatory | `_internal/PILOT-LOG.md`, §7.2 |
| — | Endpoint shutdown mid-pilot (user action) | One in-flight run lost, counted unusable, replaced; no data loss to prior records | `_internal/PILOT-LOG.md` |

**Pilot defects in scoring:** none. The frozen scorer produced 0 consistency failures and reproduced
the Phase 17 committed counts exactly in its validation suite. All pilot "defects" are transport /
environment / protocol-design issues, not scoring-rule failures.

**Minimum fix list before the confirmatory freeze:** relabel repeats (D-P1); pin the production
prompt version and state comparability (D-P5); add `template_id`/`twin_id` and decide on corpus
diversity (D-P6/D-P7); complete independent human validation of opportunity labels and the exposure
instrument (D-P8 — blocker); adopt the transport/idle/streaming rules in the frozen harness; and
re-run the power simulation with pilot-calibrated usability (~93 %) and stall/retry costs.

---

## 9. Recommended confirmatory execution budget (decision input; no model chosen)

Recommended: **4,800 executions, one model, full-file outputs**, with ~10 % execution headroom
(≈5,280 queue slots planned). Wall-clock depends entirely on the deferred endpoint decision:

| Endpoint option | Shards | Base wall clock | Planning figure | Notes |
|---|---:|---:|---|---|
| Hosted Muse Spark Open (Baseten), Phase-17 per-run mean | 12 | ≈5.8 h | **7–8 h** | Restores Phase-17 continuity; paid calls require approval; rate-limit serialisation not modelled |
| Hosted Muse Spark (Forge), Phase-17 per-run mean | 24 | ≈14.3 h | 16–18 h | Closest runtime continuity; paid |
| Dell PolyStrata single slot, full-file outputs | 1 | **≈460 h (19.2 d)** measured pilot mean (345.8 s/run; qualification-based estimate was ≈318 h) | not recommended | Free but not executable within a reasonable window; would need sharding/throughput replanning or a different output format (rejected: condition 5) |
| Both models | — | 2× the chosen column | — | Replication claim; 9,600 executions |

Token/cost snapshot (Phase-17 scaling): Muse Spark ≈5.7 B input / 57 M output; Muse Spark Open ≈24 M
prompt / 76 M completion. No cost is committed until the endpoint decision. The confirmatory model
decision is **deferred to review of this checkpoint**, as instructed.

---

## 10. What this checkpoint does not claim

- No confirmatory result, no preregistration, no frozen corpus/labels/analysis, no confirmatory model
  choice.
- No claim that the corpus is human-validated: opportunity classes, hooks and paraphrase intent are
  authored mechanically; independent human coding has **not** occurred.
- No claim that zero observed failures imply zero failure probability.
- No claim that the pilot's descriptive counts estimate the confirmatory effect; the pilot is a
  defect-finding and environment-measurement exercise, excluded from confirmatory analysis.
- No claim that the Dell endpoint is an independent scoring authority; scoring is by the frozen local
  detectors.
- No claim of prompt-level comparability with Phase 17 (production prompt builder has changed).
