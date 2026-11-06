# Study 02 — checkpoint 1 report

**Date:** 2026-10-31 (Australia/Brisbane) · **Branch:** `integration` · **Base commit:** `97cab5b`
**Scope of this checkpoint:** mission Phase 1 (audit), Phase 2 draft (protocol design), Phase 3
(Dell endpoint discovery), plus the unit-of-analysis/power work needed before a freeze.
**Not in scope:** pilot execution, preregistration freeze, confirmatory execution, results.

**Gate status:** the confirmatory experiment is **blocked by design** until (i) the audit is
accepted, (ii) the statistical analyst's unit of analysis is approved, and (iii) the preregistration
is frozen. None of those is true yet. The Dell pilot may proceed earlier, but its records will be
kept in `pilot/` and never pooled with confirmatory data.

---

## 1. What was done

| Workstream | Output | Owner |
|---|---|---|
| Phase 1 audit | `01-AUDIT.md` (431 lines) | auditor |
| Protocol draft + corpus/label design | `02-PROTOCOL-DRAFT.md`, `design/corpus-spec.md`, `design/design-draft.json` | protocol-architect |
| Dell PolyStrata discovery | `03-DELL-ENDPOINT.md` (421 lines) | dell-scout |
| Analysis plan + unit of analysis + power | `04-ANALYSIS-PLAN.md`, `analysis/power_study2.py`, `analysis/power_study2.txt` | stats-analyst |
| Integration, verification, this report | `README.md`, `05-CHECKPOINT-REPORT.md`, `06-PUBLIC-SUMMARY-DRAFT.md`, `REPRODUCTION.md` | Lead |

Ledger discipline: no tracked file was modified except one accidental in-place run of
`analyze_phase17.py` by the Lead, caught immediately, restored from git and hash-verified against
`SHA256SUMS` (`f384fca7…`); the working tree is clean for all pre-existing files. All other work is
new, untracked files under `experiments/study-02-rare-trigger/`.

---

## 2. Verified now (not merely asserted)

These were re-executed in this checkout on 2026-10-31, independent of the original authors' claims.
Commands are in `REPRODUCTION.md`.

| Check | Result | Tag |
|---|---|---|
| Phase 17 detector fixtures + baseline cleanliness | `41 fixtures pass`, 3 baselines clean | [VERIFIED NOW] |
| Phase 17 lock manifest `protocol.sha256` | **17/17 OK** | [VERIFIED NOW] |
| Phase 17 output manifest `SHA256SUMS` | **1205/1205 OK** | [VERIFIED NOW] |
| Full re-score of committed raw outputs (472 HTML) with the frozen detectors | **96/96 model×reading cells match** the committed `phase17-analysis.json` | [VERIFIED NOW] |
| Re-run of `analyze_phase17.py` on committed `out/` | analysis JSON byte-identical (SHA-256 `f384fca7…`) | [VERIFIED NOW] |
| `exact_stats.py --check` and independent `Fraction` re-derivation | corrected exact p-values match (e.g. Spark H1 `6.52258e-20`) | [VERIFIED NOW] |
| `pnpm verify:research17` | PASS (detector tests, lock, sums, counts, verdicts) | [VERIFIED NOW] |
| Power simulation determinism | 630-line transcript reproduces identically (only timestamps/runtime differ) | [VERIFIED NOW] |
| Study-draft arithmetic | 4×70 + 2×60 = 400 scenarios; 4×35 + 2×30 = 200 high-opportunity; 400×4×3 = 4,800; 30×4×2 = 240 pilot | [VERIFIED NOW] |

What is **not** verified: the generation step (no endpoint replay of Phase 15B/17), Phase 15B's v1
coder (lost), the original models' 2026-10-28/29 runtime state, and any claim requiring independent
scoring. The Phase 17 "independent check" and the audit are same-team artefacts.

---

## 3. Phase 1 audit — findings

Full detail in `01-AUDIT.md`. Condensed:

| ID | Finding | Severity | Consequence |
|---|---|---|---|
| W1 | **No conditioning on trigger opportunity anywhere in Phase 15B/17.** No opportunity definition, label or scenario unit exists; two strata had zero `none`-arm violations and "contribute nothing to H1"; `memory` 0/58 (Spark) and 1/60 (Open) are unconditional counts. | **Critical** | Directly the criticism; Study 02 must label opportunity pre-treatment, balance it, and make CVR primary. |
| W2 | Post-run p-value correction: locked `stats17.stratified_exact` and the verifier both carried a `+1e-15` absolute floor; 9/12 published p-values were inflated upper bounds (e.g. Open H1 as-run `4.72e-16` vs exact `1.12e-24`). Fixed only by post-hoc reporting. | High | Study 02 must not reuse that tail rule; use exact/rational arithmetic with no tolerance floor. |
| W3 | R5–R10 latent defects remain in locked runner/harness files (port race, no request timeout, zero-arm crash, status-before-copy, truncated-reply retry, wrong docstring). | High (tooling reuse) | Study 02 harness must fix them; do not copy Phase 17 runners verbatim. |
| W4 | Lock provenance is "tag + history rewrite": the pre-run record is rewritten-away commit `6640e83` preserved by tag on `origin`; local commits post-date the trial. | High | Study 02 must lock by push/tag before the first run, not by local mtime. |
| W5 | Phase 15B evidence is structurally weak: v1 coder lost, v2 written after unblinding (moved memory arm 5/16→0/16), human coding narrative/unblinded, recorded diffs 0 bytes. | High (15B claims) | Do not cite 15B as human-coded/blinded/pre-registered code; only the conservative v1 comparison is confirmatory. |
| W6 | No independent scoring: detectors, analysis, verifiers and "integrity audit" are same-author. | Medium–High | Study 02 needs a second independent implementation and human label validation. |
| W7 | Repeated runs are not independent scenarios; unit of analysis was the run; temperature 0 for the Open path; no variability model. | Medium | Scenario-level clustering + nonzero-temperature reps in Study 02. |
| W8 | Zero observed failures ≠ zero failure probability. One-sided 95% upper bound on 0/58 is ≈5.0%. | Medium | Report CVR with intervals; never claim elimination/zero probability. |
| W9–W12 | Design-specific limits (FocusFlow baseline merely compliant, permissive correction, Open replicates task not runtime); pilot not in a hash manifest; post-run manifests not in the lock; correction chain outside the pre-registered manifest. | Medium/Low | Keep same caveats; manifest pilot data; state provenance limits. |

**Reuse matrix:** detectors + fixtures, `newcombe`/`holm`/`wilson`, the `Fraction` exact tail
(pattern), harness/runner patterns, the three clean baselines, rule/correction/context/request texts,
and the verifier pattern can be reused. The 400-scenario corpus, opportunity/exposure instruments,
Dell client, cluster-aware analysis, manifests and human-coding pipeline must be built.

---

## 4. Phase 2 — protocol draft (NOT frozen)

`02-PROTOCOL-DRAFT.md` has 18 sections; `design/design-draft.json` is the machine-readable draft;
`design/corpus-spec.md` is the corpus contract. Highlights:

- **Estimand change (the method fix):** primary metric is `CVR = violations / valid-trigger-opportunity
  runs` on the **200 pre-treatment high-opportunity scenarios** (200/200 balance is a design
  constant, not an inferred quantity). `trigger prevalence` (200/400), `trigger exposure`
  (run-level post-treatment engagement, descriptive only, with an explicit collider-bias warning)
  and `actual violations` (frozen Phase 17 detectors) are never conflated and get separate tables.
- **Arms/strata:** Phase 17's four arms and six strata reused for continuity; rule, correction,
  context and request texts quoted verbatim from `phase17/design.json`.
- **400 scenarios:** 10 deterministic, rule-clean baseline variants per baseline family × frozen
  request paraphrases (7 for each game request, 6 for each focus request); scenario ids
  `s02.<stratum>.<family>-v<nn>.<paraphrase>`; uniqueness = injective
  `(baseline_sha256, request_sha256)`.
- **3 reps × 4 arms × 400 = 4,800** confirmatory executions, non-zero sampling draft
  `temperature 0.7 / top_p 0.8 / top_k 20 / presence_penalty 1.5`; thinking disabled per request
  (`reasoning_effort: "none"` + `enable_thinking: false`), because the Dell default is thinking-on.
- **Order:** seed `0x02A2026` = 2760742; `order_key = sha256("2760742:<scenario_id>:<arm>:<rep>")`,
  ASCII-codepoint sort, 8 deterministic shards (one serial queue on Dell), independently verifiable
  from seed + scenario list.
- **Frozen expected outcomes:** 19-field per-scenario label schema (`opportunity_class`,
  `opportunity_hooks`, `trigger_types`, `applicable_detector`, `baseline_clean`,
  `required_compliant_invariant`, hashes, provenance); generated by a deterministic stdlib script
  from baseline structure (never model-generated); validated by two blinded human coders on a
  stratified sample + pilot, κ reported, disagreements adjudicated before freeze.
- **Predefined exclusions / no optional stopping:** unusable runs (2-attempt API budget, timeout,
  truncation/incomplete HTML, harness error, scoring failure) counted and reported; scenario
  invalidity only pre-freeze; per-protocol primary, ITT/worst-case secondary; all 4,800 runs;
  no interim analysis; one analysis run on the frozen dataset; post-freeze changes append-only.
- **What cannot be claimed:** zero failures ≠ zero probability; no generalisation beyond the tested
  scenarios/rules/model; detector construct validity is an irreducible limitation; exposure-based
  CVR is not the confirmatory estimand.

---

## 5. Unit of analysis and power — resolved for the draft

`04-ANALYSIS-PLAN.md` is a pre-registrable plan; `analysis/power_study2.py` + `.txt` are a
**simulation under assumptions, not data** (deterministic; 324-cell grid × 2,000 replicates).

| Decision | Result |
|---|---|
| Unit of analysis | the unique scenario, nested in stratum; 3 reps are technical replicates; arms paired within scenario. Equal-stratum-weighted CVR over the 200 high-opportunity scenarios. |
| H1 / H3 | two-sided stratified paired sign-flip permutation test, 10,000 permutations, exact integer/rational arithmetic, SHA-256 counter-mode RNG seed 2002001, direction required; Holm over {H1, H3}, family α = .05. |
| H2 | non-inferiority: upper 90% stratified cluster-bootstrap bound (10,000 resamples, seed 2002002) of `CVR_memory − CVR_manual` below the margin. |
| H2 margin | **recommend +10 pp** (stronger than Phase 17's +15 pp), with a coarse pre-declared pilot fallback to +15 pp only if pilot high-opportunity memory CVR ≥ 8% while manual ≤ 3%. |
| Power at drafted/default assumptions | H1 1.000, H2@10 1.000, H2@15 1.000, H3 1.000; expected 90% CI width (H2) 4.57 pp; 95% CI width (H1) 10.15 pp; H2 minimum detectable margin 3.46 pp. |
| Adequacy | `400 × 3` is adequate at pilot-calibrated rates; H2 is the only binding constraint and is ≥0.993 at arm parity. Under adverse rates the honest outcome can be "non-inferiority not established". |
| Re-check at freeze | required with pilot-calibrated rates, usable rate and ICC; no outcome-dependent design change. |
| Still needed | an **independent second implementation** of the primary analysis by a non-primary author (protocol requirement; Phase 17's R1/R3 lesson). |

---

## 6. Phase 3 — Dell PolyStrata endpoint (pilot execution environment)

Full contract and caveats in `03-DELL-ENDPOINT.md`. Summary:

| Property | Observed value |
|---|---|
| Endpoint | `http://192.168.86.39:8080/v1/chat/completions` (OpenAI-compatible; no auth; reachable from Mac ~2 ms) |
| Model | `qwen3.6-35b-a3b-ud-q3_k_m` — Qwen3.6-35B-A3B MoE (35B total / 3B active), UD-Q3_K_M GGUF 15.93 GiB |
| Runtime | PolyStrata 0.1.45 (Python `serve.server` + `strata-poly.exe` HIP engine; ROCm) on Windows 11 Pro |
| Hardware | i7-10700 (8C/16T), 31.7 GB RAM, AMD RX 5700 XT 8 GB (only 698/10496 experts in VRAM; mostly CPU) |
| Context / output | 131,072 context, 32,768 max output, KV q8_0 |
| Sampling defaults | non-thinking: temp 0.7, top_p 0.8, top_k 20, min_p 0, presence_penalty 1.5 |
| Throughput | ~303 tok/s prefill, ~25 tok/s decode, **single generation slot** (FIFO) |
| Gotchas | thinking-on by default (must disable per request); `model` not validated server-side (assert observed id per run); not a managed service; unauthenticated LAN; no `/v1/completions`; Dell clock UTC+11 vs Mac UTC+10 (epochs agree) |

**The Dell endpoint is an experimental execution environment, not an independent scoring
authority.** Scoring must be done by the frozen local detectors, not by the endpoint or its runtime.

**Feasibility (arithmetic from measured throughput, not a result):** Phase 17 full-file outputs mean
≈24.9 KB ≈ 6.2k tokens. At ~25 tok/s decode plus prompt/prefill, a full-file run is ≈200–600 s. The
4,800-run confirmatory pass on the Dell single slot would take ≈**11–33 days of continuous serial
execution**; a 240-run pilot ≈18 h, a 120-run pilot ≈9 h. `03-DELL-ENDPOINT.md` §7.2 correctly
estimated 8–25 h only for 100–300-token outputs — the real task outputs are much larger. This is the
dominant open scheduling risk.

---

## 7. Decisions required before freeze

Each item is a genuine decision, not a formality. "Lead recommendation" is a proposal for the user
to accept or overrule; none has been applied to the draft silently.

| # | Decision | Lead recommendation | Blocking? |
|---|---|---|---|
| D1 | **Confirmatory model/endpoint** (Dell local / Muse Spark / hosted Muse Spark Open / both) | **Hosted Muse Spark Open with sharded parallel runs** (≈52 s/run in Phase 17, ≈12 h for 4,800 at 6 shards; restores continuity with Phase 17's Open path). Requires paid-API approval — prohibited for the *pilot* only. Keep Dell for the pilot. Alternatively Muse Spark for the closest continuity (≈57 h at 6 shards). | **Yes — freeze blocker** |
| D2 | If Dell must host confirmatory: accept ~2–3 weeks wall clock, change output format (e.g. unified-diff responses reconstructed deterministically), or reduce N | Do **not** reduce N silently; if Dell is mandatory, prototype a diff/patch output format in the pilot and re-derive power/exclusions (patch-apply failures become arm-correlated exclusions and must be piloted). | Yes |
| D3 | Sampling temperature/top_p and seed policy | 0.7 / 0.8 for the Dell pilot; for the confirmatory model fix one non-zero setting (or explicitly re-define the estimand if the endpoint is greedy). Seeds per `(scenario, arm, rep)`. | Yes |
| D4 | H2 margin | Accept **+10 pp** with the pre-declared pilot fallback to +15 pp. | No (recommend accept) |
| D5 | H3 in primary family | Keep {H1, H3} Holm family as Phase 17. | No (recommend accept) |
| D6 | **Human coders** for opportunity labels: 2 blinded coders, ≥12 stratified scenarios + pilot, κ reported, independent of label author | **Blocker**: the agent team cannot supply independent human coders. The user must provide them, or the study must be downgraded to "single-coder labels, declared post-hoc/limited" — which removes the independent-validation claim the mission requires. | **Yes — resource blocker** |
| D7 | Scenario generation approach | Deterministic recipe script (no LLM generation); Lead reviews all 30 variant diffs; browser smoke test; detector-clean under primary + sensitivity. | No |
| D8 | Pilot replicates | **1 rep × 4 arms × 30 scenarios = 120 runs** (plus a 12-run repeat subset for reproducibility) instead of 240; preserves "30 scenarios" and halves Dell time. | No (recommend accept) |
| D9 | Analysis machinery + independent second implementation | Accept `04-ANALYSIS-PLAN.md`; assign the independent implementation/checker to a non-primary author (auditor can be re-tasked). | Yes (before confirmatory) |
| D10 | Spare/replacement scenarios | Small frozen spare list validated during the pilot + pre-declared replacement rule; no replacement after freeze. | No |
| D11 | Lock route and timing | Commit + annotated tag + push to `origin` **before** the first confirmatory run, with `LOCK.md` evidence. | Yes (before run) |
| D12 | **Opportunity-class confound** (new, from stats review): high-opportunity = variants `v00–v04`, so the class is confounded with variant identity and the high-op corpus has only 5 baseline variants per game family (15 distinct high-op baselines total) | Options: (a) accept with variant-cluster bootstrap + leave-one-variant-out jackknife (current plan, weak generalisation); (b) expand to more distinct variant templates per family; (c) cross opportunity hooks with paraphrase specificity so each variant contributes to both classes. Choose before freeze; (b)/(c) change the power grid and require a re-run. | **Yes — design blocker** |
| D13 | Output format: full-file HTML (Phase 17-comparable) vs diff/patch (Dell-feasible) | Full-file if a hosted endpoint is approved; if Dell-only, pilot the diff format and treat patch-apply failure as a pre-declared exclusion. | Depends on D1 |
| D14 | External registration (OSF or similar) in addition to the repo tag | Optional; if used, register the same frozen text. | No |

Additional unresolved items propagated from the audit (`01-AUDIT.md` §8): detector freeze (copy into
the study directory with its own manifest — recommended), use (or non-use) of Phase 17 outputs to
calibrate the exposure instrument (must be declared exploratory and kept out of confirmatory
analysis), and whether the pilot may reuse any Phase 17 prompts (recommended: no).

---

## 8. What this checkpoint does **not** establish

- It does **not** establish any effect of memory, prompting or correction. No Study 02 data exist.
- It does **not** preregister anything. The protocol is a draft; the corpus, labels, harness and
  analysis script do not exist.
- It does **not** validate the Dell endpoint as a scoring authority; it is only an execution
  environment. Its outputs will be scored by frozen local detectors.
- It does **not** establish that 4,800 runs are executable; the measured throughput says they are
  not executable on the Dell single slot in reasonable time.
- It does **not** repair any Phase 15B/17 claim; the audit's "claims that must NOT be repeated" list
  (`01-AUDIT.md` §7) remains in force.

---

## 9. Immediate next steps (after user decisions)

1. Resolve D1/D2/D6/D12 (blockers) and D3/D8/D9; record the decisions in a dated decision log.
2. Build `scripts/study02/`: variant + paraphrase generator, label generator, order/verifier,
   Dell/hosted endpoint client, runner, frozen detector copy, scoring, analysis script, manifest
   tooling.
3. Generate the 400-scenario corpus + 19-field labels; Lead review; human validation sample.
4. Run the 30-scenario Dell pilot (1 rep), report separately, fix defects, write `PILOT-CHANGES.md`.
5. Re-run power with pilot-calibrated rates/ICC/unusable rates; fix H2 margin and test choices.
6. Freeze everything into `design/protocol.sha256`; commit; tag; push; verify from a clean clone.
7. Execute the confirmatory experiment; preserve raw outputs/metadata; report all runs, including
   failed/incomplete/excluded; compute CVR + CIs; publish without suppressing negative findings.
