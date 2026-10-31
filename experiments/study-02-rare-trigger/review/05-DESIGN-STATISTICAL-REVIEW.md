# 05 — Design and statistical review: Baseten confirmatory plan (freeze readiness)

**Status:** pre-freeze review deliverable (checkpoint 3). **Not a preregistration, nothing executed.**
**Owner:** design-reviewer. **Write scope:** this file and `review/04-HUMAN-VALIDATION-PROTOCOL.md` only.
No code, corpus, protocol, pilot, manifest or locked artifact was modified. No git commit/checkout. No paid calls.
**Branch:** `study02/freeze-prep` (base `85773b3`). Working tree at review time contained uncommitted
freeze-fixer changes to `02-PROTOCOL-DRAFT.md`, `02b-PROTOCOL-REVISION-V2.md`, `08-CORPUS-DIVERSITY.md`,
`corpus/*`, `scripts/study02/gen_corpus.py` and new `design/prompt-builder-pin.json`,
`review/06-OFFLINE-FIXES.md` (noted where relevant; not modified by me).

Evidence tags: **[DOC §]** cited document; **[VERIFIED]** independently recomputed/read this session;
**[TRIAGE]** AI diagnostic (not human validation); **[OBSERVED]** pilot data; **[SIM]** simulation;
**[PROPOSED]** pre-declared decision to freeze; **[TBD]** open at freeze.

---

## 0. Verdict summary

| # | Review question | Verdict | Evidence |
|---|---|---|---|
| 1 | Inference unit = unique scenario, reps technical | **Confirmed**, with one wording fix | 04b §1.1/§2.1; protocol §10; §3 below |
| 2 | Clustering scenario → variant → template; H2 at variant level | **Confirmed** for H-only primary (variant ≡ template partition, 30 clusters, 10/stratum) — **but the pre-declared H2 bootstrap breaks the cross-stratum variant correlation**; fix required | 04b §2.1/§3.2; §2.3 below (new finding) |
| 3 | Matched H/L structure; 60/60/60/60/80/80; 200/200 | **Confirmed by recomputation**; two field-vocabulary issues to freeze | `corpus/corpus.json`, `labels.json`, `validation.json`; §3 |
| 4 | 400 × 4 arms × 3 reps = 4,800 | **Confirmed** (arithmetic and corpus counts) | §4.1 |
| 5 | +10 pp H2 margin and pilot fallback rule | **+10 pp defensible**; fallback rule **contradicts itself across documents** (04b §4.5 vs power transcript K2: 3/18 vs 3/15 and manual ≤1/18 vs ≤5 %) — must be reconciled to one denominator-free rule | §4.3 |
| 6 | Multiplicity: Holm {H1,H3} + H2 one-sided separately | **Method sound**, but the two-family FWER structure must be stated and the O5 open decision closed | §4.4 |
| 7 | Exclusions/retries/replacements/missing outcomes/stopping for Baseten | **Incomplete for a hosted provider** (content-filter/refusal, 429, provider 5xx, truncation semantics not covered); policy text required | §5 |
| 8 | 400×3 adequately powered under pilot unusable rate and Baseten variability | **Adequate** under pilot 6.8 % and under the whole 5–20 % grid; **conditionally adequate** if Baseten reps collapse to duplicates; ICC/pair/ρ_arm/PHI remain assumptions, not estimates | §4.2, §4.5 |
| 9 | Maximum unusable rate for the confirmatory run | **Pre-declare 20 % hard ceiling / 15 % warning**, plus a 5 pp arm-differential rule | §5.3 |
| 10 | Forbid outcome-dependent endpoint/margin/analysis choice | **Required**; feasibility/validity-only selection criteria supplied | §6 |
| 11 | Claims dependency map | **No primary claim depends on the exposure instrument**; the load-bearing construct for the primary is the human-validated opportunity label | §1 |
| 12 | Exact text changes before freeze | Supplied in §7 (10 items, with replacement wording) | §7 |

**Bottom line:** the design is **freeze-ready on paper** after the §7 text changes; the two substantive
statistical corrections are (a) the **cross-stratum variant bootstrap** (§2.3) and (b) the **margin-fallback
reconciliation** (§4.3). The irreducibly open items are the human validation (D-P8, `04-HUMAN-VALIDATION-PROTOCOL.md`),
the endpoint/prompt pin (D-P5; freeze-fixer's `design/prompt-builder-pin.json` now supplies the substance),
and the ICC/pair-correlation assumptions, none of which can be estimated from the 1-rep/arm pilot.

---

## 1. Claims dependency map

### 1.1 Verified definitional facts

- **Primary CVR uses the pre-treatment opportunity class, not measured exposure.**
  `02-PROTOCOL-DRAFT.md` §7.1 defines CVR as violations ÷ runs in the **high-opportunity scenario class**;
  §7.2 is explicit: "the denominator is the set of runs belonging to scenarios with
  `opportunity_class == "high"` … This is a **pre-treatment** scenario property, fixed before any run";
  measured exposure is "**Secondary (descriptive only)** … post-treatment … never the confirmatory test".
  `04b-ANALYSIS-PLAN-REV2.md` §1.2 defines `H = {s : opportunity_class_s = "high"}`, |H| = 200, and
  `theta_ag = (1/n_g) Σ_{s ∈ H_g} p_sa`. **[DOC]** No measured-exposure quantity appears in H1/H2/H3.
- `04b` §1.2: "The primary hypotheses still use only `H` (pre-treatment class) — the twin design does not
  change the primary estimand". **[DOC]**
- The exposure instrument (`scoring/trigger_zones.py`) is not imported anywhere in the primary estimand
  path; the scorer's primary outcome is the frozen detector's `violation` (`09-SCORING.md` §1, §2.1). **[VERIFIED]**

### 1.2 Dependency table

| Claim / analysis | Detector | Opportunity labels + hooks | Paraphrases | Exposure instrument | Design/corpus | Notes |
|---|:--:|:--:|:--:|:--:|:--:|---|
| **H1** `CVR_memory < CVR_none` (high-op) | ✔ | ✔ | ✔ (design) | — | ✔ | paraphrases are in every arm; they define scenarios, not arm contrast |
| **H2** `CVR_memory − CVR_manual < m` (NI) | ✔ | ✔ | ✔ (design) | — | ✔ | margin/CI machinery independent of exposure |
| **H3** `CVR_corrected > CVR_memory` | ✔ | ✔ | ✔ (design) | — | ✔ | detector for the *original* rule (interpretation limit, 04b §8.11) |
| Unconditional violation rate | ✔ | — | ✔ | — | ✔ | all 400 scenarios |
| Measured-exposure CVR | ✔ | ✔ | ✔ | **✔** | ✔ | post-treatment; descriptive; **instrument-gated** |
| Exposure rate per arm × stratum | — | ✔ | ✔ | **✔** | ✔ | **instrument-gated**; instrument-only |
| Exposure stability across reps | — | ✔ | ✔ | **✔** | ✔ | **instrument-gated**; only 12 probe executions exist (D-P1) |
| Low-opportunity CVR | ✔ | ✔ | ✔ | — | ✔ | near-zero/underpowered; exact upper bounds only |
| Arm contrasts on CVR (secondary) | ✔ | ✔ | ✔ | — | ✔ | descriptive |
| Sensitivity-detector tables | ✔ (sensitivity copy) | ✔ | ✔ | — | ✔ | primary decides |
| Matched H-vs-L **CVR** contrast | ✔ | ✔ | ✔ (matching factor) | — | ✔ | labels are the load-bearing construct |
| Matched H-vs-L **exposure** contrast | — | ✔ | ✔ | **✔** | ✔ | **invalid at any verdict** (H/L baseline key saturation, 04 doc §2.3/F3) |
| "Opportunity was actually taken up" (mechanism/interpretation) | — | ✔ (label says it existed) | ✔ | **✔** | ✔ | exposure + semantic coding (V6) are the only evidence of uptake |
| Meridian answer ("zero was not vacuous") | ✔ (`none`/`corrected` violations) | **✔** (labels say the opportunity existed) | ✔ | optional supporting | ✔ | **the label validation is the load-bearing gate**, plus behavioural evidence: `none` 11/65 high-op violations **[OBSERVED]** |
| Manipulation checks (ITT never excluded) | — | — | — | — | ✔ | arm-condition assignment, not outcome |

### 1.3 Implications per hypothesis and for secondary analyses

- **H1/H2/H3:** unaffected by the exposure instrument. They *do* depend on the opportunity labels being a
  valid pre-treatment construct (V4): if labels are miscalibrated, the CVR conditional is diluted or
  ill-defined (protocol §16.2 states this). Remedy path is in 04 §8.5 (output-blind re-derivation + re-freeze;
  never post-hoc relabelling).
- **Secondary exposure-conditioned analyses (2, 3, 7):** fully instrument-gated; the PASS/CONDITIONAL/FAIL
  matrix in 04 §7.4/§8.1 controls whether they are reported, labelled, or removed. They are descriptive and
  must never be promoted to a confirmatory denominator (protocol §7.2; 04b §8.7).
- **Paraphrases:** because the request text is identical across arms within a scenario, a paraphrase-intent
  error **cannot bias an arm contrast**; it affects (i) the meaning/generalisability of the estimand and
  (ii) the matched H-vs-L contrast (paraphrase is a matching factor). So paraphrase validation is a
  construct-coverage gate, not an arm-contrast-validity gate. State this to prevent over-claiming either way.
- **No primary claim depends on the instrument — confirmed.** If any future secondary analysis is promoted to
  primary (it must not be), that promotion would create an instrument dependency and would be a pre-freeze
  hypothesis change, not a post-hoc decision.

---

## 2. Inference unit, clustering and the statistical machinery

### 2.1 Verified against 04b

| Check | Result |
|---|---|
| Unit = unique scenario; arms paired within scenario; reps technical replicates, never pooled | ✔ 04b §1.1/§2.1; protocol §10 |
| Hierarchy `scenario → variant (H/L twin) → template` | ✔ 04b §2.1 |
| H-only primary: variant and template are the **same partition** (one H twin per template) → 30 clusters, 10 per family/stratum | ✔ 04b §2.1/§2.5; **[VERIFIED]** corpus: 30 H variants, 200 H scenarios, 6/8 scenarios per H variant (3/4 within a stratum) |
| H2 inference at the **variant** level (v1 scenario bootstrap would understate variance) | ✔ 04b §3.2; required by 02b row 4 |
| H1/H3 stratified sign-flip permutation on paired within-scenario differences; exact under the sharp null regardless of clustering | ✔ 04b §3.1 (correct: the randomisation distribution is generated by within-scenario arm-label flips) |
| `q_sa = 6k_sa/v_sa ∈ Z` for v ∈ {1,2,3} usable reps | ✔ exact (6k, 3k, 2k); no floating tolerance in the decision — 04b §3.2 step 4 |
| Zero-event rule `1 − 0.05^(1/n)` with n_eff and scenario-level variants reported separately | ✔ 04b §3.3 |
| No optional stopping / one analysis / seeds PERM 2003001, BOOT 2003002 | ✔ 04b §5, §7.1 |

### 2.2 Open wording/consistency defects

- Protocol §10 (v0.1) still says "primary clustering is the scenario; a predeclared sensitivity analysis
  clusters at the baseline variant level" — **superseded**: variant-level clustering is mandatory for H2,
  and for the H-only analysis scenario and variant are the same partition. Must be rewritten (T7).
- Protocol §11.2 still says H2 is a "cluster-bootstrap … bootstrap resamples scenarios within strata" —
  **superseded** by 04b §3.2 (variant-cluster bootstrap). Must be rewritten (T6).

### 2.3 **New finding — the pre-declared H2 bootstrap breaks the cross-stratum variant correlation**

`04b` §3.2 step 1 resamples "within each stratum `g` … the `n_v = 10` H-variant clusters with replacement",
independently per stratum. But each H variant appears in **two strata of its family** (`corpus.json`:
every variant is in 2 strata; **[VERIFIED]** 60/60 variants, 12 strata-variant cells per family, 2 strata per
variant). The estimand `CVR = (1/6) Σ_g θ_g` therefore has **positive covariance between the two strata that
share a variant**: with the §2.2 generative model, the cross-stratum correlation of the same variant's stratum
means is

  c ≈ ρ_V·ICC / (ρ_V·ICC + (1 − ρ_V·ICC)/k_g),  k_g = 3 (game) or 4 (focus),

i.e. **c ≈ 0.42 (game) / 0.49 (focus)** at the default `ICC_scenario` 0.25, `rho_pair` 0.30
(ρ_V·ICC = 0.195). With 6 equal-weight strata and 3 shared (family) stratum pairs among 15 pairs,
`Var ∝ (6 + 6c)/36` versus the independence assumption `6/36`, i.e. **variance understated by (1 + c) ≈ 1.4×**
(SE × 1.19) for the variant component. Consequences at the default cell: DE 1.38 → ≈ 1.9; n_eff ≈ 145 → ≈ 102;
H2 90 % CI width 5.03 pp → ≈ 5.9 pp (my arithmetic, **not a simulation** — it should be re-derived by
`power_study2_rev2.py`). At arm parity H2@10 power likely remains > 0.85 (the grid's DE 2.17 cell still gives
0.910 at 0.15-… — the grid's worst cell has DE 2.17 with n_eff 92; the crossing raises the default cell toward
that, so the grid's *stress* cells remain the relevant bound), but the plan's own DE formula (`04b` §2.4)
also assumes independence across strata and is therefore optimistic for the secondary full-corpus quantities.

**Recommendation (pre-freeze):** resample the **10 variants per family as a block**, keeping both strata's
scenarios and both arms — this preserves the correlation. Equivalently, an unstratified 30-cluster bootstrap
with equal-stratum weighting applied to the resampled clusters. Pre-declare the family-block bootstrap as the
**primary** H2 interval and the current stratified scheme as the sensitivity; then re-run the power grid with
the corrected scheme and report both. This is a method correction, not an outcome-dependent change: it is
made before any confirmatory data exist. If the Lead prefers to keep the current scheme, it must be disclosed
as anti-conservative for H2 and the corrected scheme reported alongside.

### 2.4 Additional inference cautions (pre-declare as sensitivity, not decision)

- **10 clusters/stratum** makes percentile intervals coarse and possibly anti-conservative. Report a
  studentized/BCa or cluster-robust t (29 df) interval as sensitivity beside the pre-declared percentile
  interval; **the pre-declared method decides**.
- **Equal-stratum weighting** is a designed estimand (1/6 per stratum), not proportional allocation:
  state it next to every pooled number (04b §1.2 does).
- The 30 H-variant clusters are not independent draws (shared family engines; token Jaccard ≈ 0.97 within
  family, `08-CORPUS-DIVERSITY.md` §4): inference is conditional on the corpus; report the variant-cluster
  DE and never a naive run-level n (04b §8.1).

---

## 3. Matched H/L structure and corpus counts (verified)

Recomputed from `corpus/corpus.json`, `corpus/labels.json`, `corpus/validation.json` (read-only):
**[VERIFIED]**

| Check | Required / claimed | Found | Verdict |
|---|---|---|---|
| Scenarios | 400 | 400 | ✔ |
| Strata | 60/60/60/60/80/80 | 60/60/60/60/80/80 | ✔ |
| High / low | 200 / 200 | 200 / 200 | ✔ |
| High-op per stratum | 30/30/30/30/40/40 | 30/30/30/30/40/40 | ✔ |
| Variants | 60 (30 H + 30 L) | 60 (30 H, 30 L) | ✔ |
| Templates | 30 (10/family), each with an H and an L twin | 30; 30 twin pairs complete (`validation.json` `twin_pairs: 30`, twin proofs 30/30 hold) | ✔ |
| Scenarios per variant | 6 game / 8 focus (cross-stratum) | 40 variants × 6 + 20 variants × 8 | ✔ |
| Scenarios per (variant, stratum) | 3 game / 4 focus | 3 / 4 | ✔ |
| Paraphrases | 26 corpus (arcade 3, challenge 3, reward 4, lively 4) + 4 pilot-only | 26 + 4 (`paraphrases.json` `counts`) | ✔ |
| Labels | 400 records | 400; now **20** fields (`variant_role` added) | ✔ (schema text must be updated, T9) |
| Hooks | H ≥ 3, L ≤ 1 | H observed 3–4, L observed 0–1 (`validation.json` `hook_rules`) | ✔ |
| `opportunity_class` ⇒ H/L | consistent | 0 mismatches; `variant_role == 'H'` ⇔ class `high` enforced by generator | ✔ |
| Baseline cleanliness | primary + sensitivity detector clean | 60/60 clean (`validation.json`) | ✔ |
| Twin difference | only the hook block | twin proofs hold 30/30; 43–50 changed lines/pair | ✔ (construction-level only — `08` §9.6) |

**Field-vocabulary issues that must be frozen (text change T9):**
1. `labels.json`/`corpus.json` now carry `variant_role` ∈ {H, L} **and** `twin_id = "twin-Txx"` (the *pair*
   id), while `04b` §7.2's run-record interface asks for `twin_class` and `twin_id`. A naive join on
   `twin_id` would group both twins as one "twin". Pre-declare in the protocol: **`twin_id` = pair id;
   `variant_role` = the H/L member; `twin_class` in the analysis script = `variant_role`** (or rename one
   side). Otherwise the verifier's "every H/L twin pair complete and hash-consistent" check (§7.3) is
   ambiguous.
2. Protocol §8.2's 19-field flat label schema (with `baseline_sha256`, `paraphrase_id`, `request_sha256` at
   top level) does not match the as-built schema (nested `hashes`, `paraphrase`, `baseline_clean` as an
   object, `provenance`, 20 fields). The protocol must describe the as-built schema or the corpus must be
   regenerated to the protocol schema — **do not freeze two descriptions**.
3. `corpus.json` and `labels.json` in the working tree are **regenerated, uncommitted** (freeze-fixer), and
   `corpus.sha256` has changed; the historical `MANIFEST-checkpoint2.sha256` applies only to `85773b3`.
   The freeze manifest must be taken **after** review of the regenerated files, and the Lead must confirm
   `gen_corpus.py --check` reproduces them byte-identically (freeze-fixer's `06-OFFLINE-FIXES.md` §6
   reports this; re-verify at freeze).

---

## 4. Design arithmetic, power, margin, multiplicity

### 4.1 Arithmetic (verified)

- 400 scenarios × 4 arms × 3 reps = **4,800** confirmatory executions **[VERIFIED]**.
- High-opportunity primary data: 200 scenarios × 4 arms × 3 = 2,400 runs; **600 runs/arm**; 30 H-variant
  clusters (10 per family, **10 per stratum**); cluster sizes 6 (game) / 8 (focus) across the family's two
  strata, 3 / 4 within a stratum. ✔ (04b §2.5; corpus verified).
- Reps do **not** increase cluster count; they reduce only the binomial component (04b §2.5) — so the binding
  constraint is cluster variance, and 5 reps would be a weak remedy (04b §4.10).

### 4.2 Rev2 power grid review — does 400×3 remain adequate?

The grid (972 main cells + 360 H1/H3 cells + 36 allocation cells, 2,000 replicates/cell, MC SE ≤ 0.011,
deterministic) is internally coherent and its validation against literal procedures holds (H2 power within
0.023, CI within 0.7 pp — 04b §4.7). Key readings **[SIM]**:

| Quantity | Default cell | Grid range | Reading |
|---|---:|---|---|
| H1 power | 1.000 | 1.000 in all 360 cells | saturated; no concern |
| H3 power | 1.000 | 1.000 in all 360 cells | saturated; no concern |
| H2 power @ 8 pp, arm parity | 1.000 | **min 0.802** | **8 pp is not defensible** as a fixed margin |
| H2 power @ 10 pp, arm parity | 1.000 | **min 0.910** | adequate across the entire ICC/pair/unusable grid |
| H2 power @ 15 pp, arm parity | 1.000 | min 0.992 | safest, weakest claim |
| H2 power @ 10 pp, true +5 pp deficit | — | **min 0.590** | disclosed limitation, not an N defect |
| H2 90 % CI width | 5.03 pp | ≤ 9.53 pp (worst cell) | with 10 clusters/stratum the CI is wide in stress cells |
| DE / n_eff (primary) | 1.38 / 144.6 | up to 2.17 / 92 | plus the §2.3 crossing correction |
| H2 detectable NI margin @ 80 % power (true diff 0) | 3.80 pp | — | the design can *support* a margin near 4 pp; 10 pp is conservative |

**Verdict (a) — under the pilot's observed unusable rate: adequate.** Pilot unusable = 9/132 = **6.8 %**
(primary 9/120 = 7.5 %) **[OBSERVED]**, which is **below** the grid's 10 % default and well below the 20 %
worst case in which H2@10 still has min power 0.910. The grid's unusable dimension therefore brackets the
pilot observation comfortably. **However** the pilot's 9 failures are all Dell transport/stall/timeout or the
endpoint shutdown (`PILOT-CHANGES.md`), i.e. **not transferable** to Baseten (§4.5).

**Verdict (b) — under plausible Baseten-specific variability: conditionally adequate.** The grid covers the
plausible ranges of the *unidentifiable* parameters (ICC 0–0.4; pair correlation 0–0.7; PHI 0–1; ρ_arm 0.5
fixed; unusable 5–20 %). It does **not** model: (i) the cross-stratum variant correlation (§2.3) — correct
and re-derive; (ii) a *deterministic* endpoint collapsing reps to duplicates; (iii) provider-side model
version drift mid-run (a deviation, not a power issue); (iv) output-length/truncation behaviour of a
different model, which changes the unusable mix. Under (i) the default design moves toward its stress cells
and H2@10 power at parity remains ≈ 0.9 (to be re-derived); under (ii) the effective sample is 200
scenarios/arm in 30 clusters and H2 must be re-derived at the k=1 design effect (**re-run §4.9 required at
freeze, as 04b already requires**).

### 4.3 Margin and the pre-declared fallback rule

- **+10 pp is the defensible frozen margin [PROPOSED].** Justification: at arm parity the whole grid is
  ≥ 0.910 at 10 pp, while 8 pp fails (min 0.802) even at exact parity and is therefore not defensible;
  15 pp is safer but a materially weaker claim (Phase 17 used +15 pp) and min power 0.992 makes it
  needlessly weak when no degradation is expected. The small-deficit region must be disclosed (04b §8.9;
  report the +5 pp-deficit power table).
- **The fallback rule is inconsistent across documents — must be reconciled before freeze.**
  `04b` §4.5: "+10 pp; fall back to +15 pp only if the pilot's high-opportunity memory-arm CVR is
  ≥ 3/18 usable runs (≈17 %) while manual is ≤ 1/18 (≈6 %)".
  `analysis/power_study2_rev2.txt` K2: "… unless the pilot shows high-opportunity memory CVR ≥ 20 %
  (≥ 3/15 usable high-op pilot runs) while manual ≤ 5 %".
  Different denominators (18 vs 15), different manual thresholds (≤1/18 vs ≤5 %). **[VERIFIED by reading both]**
  **Proposed denominator-free replacement (T8):** *"Fix +10 pp unless the pilot's usable high-opportunity
  primary runs show at least 3 `memory`-arm violations **and** at most 1 `manual`-arm violation; in that case
  fix +15 pp. No other pilot quantity may move the margin."* Justification: both documents intend the same
  combined count signal at ≈ 3/15–3/18 (17–20 %) vs ≤ 1/15–1/18 (≤ 6 %); the count form avoids a denominator
  that is itself an exclusion outcome; the pilot observed **0/16 memory and 0/15 manual** violations
  **[OBSERVED]**, so **the fallback does not trigger** and the margin stays **+10 pp**.
- **Explicit prohibition (for the freeze protocol):** no endpoint, margin, analysis set, estimator, interval
  method, clustering level, weighting or exclusion rule may be selected because it produces a more favourable
  effect, a smaller p, or a passing non-inferiority verdict. The margin is fixed by the pre-declared rule and
  power before any confirmatory data; the analysis method is fixed in 04b before unblinding; any change after
  data exist is a documented deviation with both as-frozen and as-deviated results (protocol §15.3).

### 4.4 Multiplicity

- Superiority family {H1, H3} with Holm at family α = .05, direction required (H1 `D<0`, H3 `D>0`);
  H2 non-inferiority at one-sided α = .05 (upper 95 % one-sided bound of `Δ2` below the margin). **[DOC 04b §3, protocol §9.1]**
- **Sound, with two required statements:** (i) the two families are **separate confirmatory claims**, so
  study-level FWER across all three hypotheses is **not** controlled at .05; report all three p/CI regardless
  and state the family structure in the results; (ii) O5 (whether H3 belongs to the superiority family) must
  be **closed before freeze** — the draft includes it, and the alternative family {H1} is descriptive-only.
  A post-freeze family redefinition would be a deviation (protocol §15.3).
- H3 direction is a prediction, not a two-sided claim; H1/H3 use two-sided p **with the direction additionally
  required** (Phase 17 convention) — state that this is a planned directional decision rule, not a
  one-sided test.

### 4.5 Which pilot assumptions transfer to Baseten, and which do not

| Pilot observation/assumption | Transfers to Baseten? | Reasoning / required action |
|---|---|---|
| Corpus structure, strata, matched twins, opportunity-class design, 400 scenarios | **Yes** | Design artifacts are endpoint-independent; verified in corpus |
| Clustering hierarchy and 30 H-variant clusters | **Yes** | Same corpus; but fix the cross-stratum bootstrap (§2.3) |
| Arm prompt semantics (production `buildForgePrompt`, structured memories, retrieval mode `forge`) | **Yes in kind, not bytes** | Same production path; prompt-level identity with Phase 17 is **not** established (D-P5); freeze the pin (`design/prompt-builder-pin.json`) |
| Unusable-run taxonomy classes (transport, timeout, truncation, no HTML, harness, scoring) | **Partly** | Classes transfer; the *causes* differ. Baseten adds: content-filter/refusal, 429 rate limit, provider 5xx, mid-stream disconnect.  Truncation (`finish_reason=length`) is model/budget-specific |
| Dell transport/stall failures (curl body timeouts, SSE inactivity, orphaned request, LAN `EHOSTUNREACH`, endpoint shutdown) | **No** | Environment-specific (D-P2/D-P3/D-P4/D-P9/D-P10); do not use them to size the confirmatory retry budget |
| Per-run duration/throughput (345.8 s mean; 4,800 ≈ 460 h serial on Dell) | **No** | Dell single-slot fact; Phase 17 hosted means ~52 s/run (Open) drive the Baseten budget (`04b` §4.11) |
| Unusable rate 6.8 % | **No (indicative only)** | Dell-specific; Baseten Open had 240/240 usable in Phase 17, but Study 02 asks for full-file outputs at a different prompt path — treat as an assumption, monitor |
| Model-specific violation/exposure rates (Qwen; `none` 9/28, `memory` 0/27, etc.) | **No** | Different model; pilot rates must never select design parameters (except the pre-declared margin fallback) |
| Seed non-determinism at temperature 0.7 (D-P1) | **No** | Endpoint-specific; Baseten's determinism is unknown. Do **not** assume reps are stochastic: establish it at the pre-freeze qualification and apply the deterministic-endpoint clause if not |
| ICC / pair correlation / ρ_arm / PHI | **No — cannot be estimated** | Pilot has 1 rep/arm; 12 repeat probes cannot estimate ICC. They remain **assumptions**, stress-tested by the grid; report as such (04b §2.3, C7) |
| Opportunity-class design (H/L twins crossed with template) | **Yes** | Design fix survives the endpoint change; the *label validation* is what must transfer (human coding is endpoint-blind) |
| Exposure instrument readings (15–53 %, arm-sensitive) | **No** | Dell outputs and instrument limitations; a different model can change FP/FN. Human validation stays valid for the instrument-as-such but is an extrapolation to Baseten outputs (04 §11.3) |
| Scoring determinism / Phase 17 re-score regression | **Yes** | Detector copies are frozen and endpoint-independent |

---

## 5. Exclusions, retries, replacements, missing outcomes, stopping (confirmatory run)

### 5.1 Current policy (protocol §12) and the gaps

Protocol §12.1 pre-declares 6 unusable classes, a **2-attempt budget**, no failover, no post-hoc replacement,
and ITT/worst-case reporting; §12.3 forbids outcome-based exclusion; §11.4 forbids optional stopping. That
core is sound. **Gaps for a hosted Baseten run:**

| Gap | Required pre-freeze decision |
|---|---|
| **Content-filter / safety refusal** (provider may filter "child safety" rule text or outputs) | Add an unusable class: *provider refusal / filtered response*, recorded with the provider's reason code. **Counted, never retried beyond the attempt budget, never replaced.** Because the filter could correlate with arm (rule text present in `memory`/`manual`/`corrected` prompts), report refusal rate by arm; if any arm > 5 %, escalate as a design threat (worst-case co-primary) |
| **429 rate limit / provider 5xx / mid-stream disconnect** | Transport class; retried only within the 2-attempt budget; every attempt recorded; backoff declared (e.g. fixed 30 s, no adaptive escalation that could change length distributions) — **[PROPOSED]**, must be fixed at freeze |
| **Truncation** | `finish_reason == length` unusable (already §12.1.3); `max_tokens` fixed from the qualification so that a complete file fits; never retried (a retry would be a longer-budget run) |
| **Missing outcome** | If a scenario–arm has 0 usable reps, that scenario is excluded **only from the pairwise contrast** (`v ≥ 1` rule, 04b §1.3), with counts reported per contrast; no imputation; no replacement. The ITT/worst-case table includes the scenario with unusable = violation |
| **Retries vs replacements** | Retry = same execution, within the 2-attempt budget, during execution, recorded. Replacement = a **new execution after the fact** — **not permitted** for the confirmatory run. The pilot's one-replacement-per-unusable rule (`PILOT-CHANGES.md`, user-approved) is **pilot-only and must not be reused** |
| **Harness/version drift** | Any model/provider version or harness change mid-run is a deviation (§15.3); the run stops for the version check if the observed model id differs from the frozen id (fail-closed verifier) |
| **Stopping** | No outcome-based stopping, no interim looks. **Permitted pre-declared technical halt:** if the cumulative unusable rate exceeds 25 % **and** fewer than 25 % of runs are complete, halt for infrastructure repair using **failure counters only** (no outcome data inspected), retain all records, resume the same frozen order, and report the halt. This is not optional stopping on the primary outcome and must be written as such |

### 5.2 Replacements — prohibited in the confirmatory run

The protocol must say, in the exclusions section, that **replacements are prohibited** (the pilot's
replacement pass was a pilot-only, user-approved exception used to assess transport behaviour; it produced 9
successful replacements that are retained but never enter confirmatory data). Rationale: a post-hoc
replacement is an outcome-adjacent selection mechanism (even if the stated reason is transport), and with 4,800
runs it would make the execution set depend on the run's own failure pattern. Retry-only is the confirmatory rule.

### 5.3 Pre-declared maximum unusable rate (with justification)

| Threshold | Value | Consequence | Justification |
|---|---:|---|---|
| **Warning** | **15 %** | Report as a design threat; worst-case/ITT table promoted beside the primary | 15 % loses ≈ 1–2 of 200 scenario pairs (`v ≥ 1` both arms: P(pair lost) ≈ 2·0.15³ ≈ 0.7 % → ~1.3 pairs) and sits inside the grid's powered region |
| **Hard ceiling** | **20 %** | The per-protocol analysis is still reported, but the **confirmatory claim is labelled "executed under a design-threatening unusable rate"** and the worst-case/ITT table becomes **co-primary**; a pre-declared remediation (only: report both analyses; no re-estimation, no extra runs) applies | 20 % is the grid's worst unusable cell, where H2@10 at arm parity still has min power **0.910** and pair loss ≈ 3 of 200 (P ≈ 2·0.2³ = 1.6 %); above 20 % the power grid has no support and pair loss grows super-linearly (30 % → ≈ 10 pairs) |
| **Arm-differential** | **> 5 pp between any two arms** | Worst-case/ITT co-primary; report the differential and its cause; if differential > 10 pp, the primary CVR contrast is labelled sensitive to missingness | A 5 pp arm difference in unusability can move a per-protocol CVR contrast by several pp if unusability correlates with the outcome (truncation plausibly does: longer outputs are both more likely to truncate and more likely to contain mechanics). The worst-case table bounds it |

The maximum is **20 %**, pre-declared at freeze, with **no re-estimation** from confirmatory data. The pilot's
6.8 % is not used to justify the ceiling (Dell-specific); the ceiling is set by the powered grid.

---

## 6. Endpoint selection: pre-registered, feasibility/validity-based only

**Explicit prohibition (to be written into the freeze protocol):** the endpoint, model, margin, analysis set,
estimator, clustering level, interval method or exclusion rule **must not be selected because it produces a
favourable effect**. At endpoint-selection time no confirmatory outcome exists; candidate comparisons may use
only qualification-level evidence (capability, transport success, latency, contract, version stability, cost) —
never an arm difference. The pilot's arm differences may **not** choose the endpoint; the only pre-declared
pilot-based rule in the study is the H2-margin fallback (§4.3), which concerns the margin, not the endpoint.

**Pre-registered selection procedure.** Order the candidates in advance and take the **first** that passes all
gates; record the decision and the evidence:

| Gate | Requirement | Why it is a validity/feasibility gate |
|---|---|---|
| G1 Arm-semantics preservation | Production retrieval for `memory`; correction route for `corrected`; rule text in the request for `manual`; no rule for `none` | The arms must mean what the protocol says (protocol §14: an endpoint that cannot preserve the arm semantics "cannot be used") |
| G2 Output contract | Full complete single-file HTML per run; no diff/patch; parseable; `max_tokens` sufficient | Condition 5 (Phase 17 comparability) and the detector's input assumption |
| G3 Sampling contract | Accepts `temperature` 0.7 / `top_p` 0.8 (or the frozen setting) and an explicit seed; returns the observed model id per run | The estimand is defined at the frozen sampling setting; greedy-only changes the estimand and the rep meaning |
| G4 Version stability | A pinned provider revision id available and stable over the whole run window; assert per run | Version drift mid-run invalidates pooling (protocol §16.5) |
| G5 Throughput/budget | Can complete 4,800 executions in the approved window/budget with ≤ 20 % unusable | Deterministic feasibility; not an effect |
| G6 Qualification success | ≥ 99 % of qualification executions usable with complete HTML; observed model id matches | Transport/model validity before committing 4,800 runs |
| G7 Contract/provenance | Provider terms permit the run; version and request payloads are recordable; credential handled per policy | Provenance and integrity |
| G8 Cost | Within the user-approved budget, stated per-model; no hidden per-token escalation | User decision, recorded |

Candidates in pre-declared order **[PROPOSED]**: (1) Baseten-hosted `meta-models/muse-spark-open-1026`
(Phase 17 continuity, lowest budget); (2) Muse Spark via Forge (closest runtime continuity, higher cost);
(3) both models as two separate confirmatory experiments (replication claim; 9,600 executions, double wall
clock; **no pooling of p-values** across models — separate Holm families per §4.4 and per 04b §8.8). The
qualification plan is owned by the Baseten reviewer (`review/03-QUALIFICATION-PLAN.md`); this section only fixes
the selection rule.

**Post-selection power re-check (§4.9):** with the endpoint fixed, re-run `power_study2_rev2.py` with the
qualified unusable rate, the observed determinism status, and the corrected bootstrap (§2.3). If H2@10 power at
the calibrated rates falls below 0.80, the pre-declared options in order are: (i) keep +10 pp and report the
limitation; (ii) fix +15 pp before the run; (iii) add high-opportunity variant clusters (corpus change →
re-freeze); (iv) 5 reps (~8,000 runs; weak because it attacks only the binomial component). **No
outcome-dependent choice** (04b §4.9, §4.10).

---

## 7. Required text changes for the freeze-candidate protocol (exact replacement wording)

State as checked at review time: freeze-fixer's `review/06-OFFLINE-FIXES.md` §3 has **already applied** the
repeat relabel to `02-PROTOCOL-DRAFT.md` §5/§5.1/§5.2 and `02b` rows 5/§2/§3. The items below are the
**residual** changes needed for a coherent freeze candidate. File names are as they exist now; the freeze
candidate is the future `PROTOCOL.md` (v0.3 merge), so the section numbers refer to `02-PROTOCOL-DRAFT.md`.

**T1 — `02-PROTOCOL-DRAFT.md` §5.2 (reps purpose) — remaining fix.** Add after item 2 ("Exposure
stability"):
> "Item 2 is reported **only if** the trigger-zone exposure instrument passes the pre-freeze human-validation
> gate (§7.3, §8.4; `review/04-HUMAN-VALIDATION-PROTOCOL.md`). Otherwise exposure-stability is not reported as
> a measurement."
And replace the §5.2 closing sentence with:
> "Confirmatory repetitions carry the stochastic-repetition meaning **only if** the pre-freeze determinism
> qualification establishes that the frozen endpoint is stochastic at the frozen sampling setting. Determinism
> is **not assumed**: it is established, or the reps are reported as technical repeats that collapse to
> duplicates, with the ICC scenario-variance component unidentified (protocol §16.6, `04b` §4.8)."

**T2 — `02-PROTOCOL-DRAFT.md` §5.1 (sampling) — provider clause.** Append to the "Status: provisional"
paragraph:
> "If the confirmatory endpoint is a hosted provider, every sampler field above is still sent explicitly on
> every request and echoed in the record; the provider's observed model id is asserted per run. If the
> provider ignores or reinterprets a parameter, the run records the returned sampling metadata and the
> deterministic-endpoint clause above applies — the design is not silently changed."

**T3 — prompt-builder decision and pin (D-P5).** In §14 (confirmatory environment), replace "Requirements
regardless of choice…" with an added decision paragraph:
> "**Prompt path (fixed, not open):** Study 02 confirmatory runs use the **current production
> `buildForgePrompt`** (`apps/server/src/forge/prompt.ts`, structured `memories` via
> `renderMemoryLayout(..., 'forge')`), together with the pinned `apps/server/src/forge/runner.ts`,
> `packages/memory-engine/src/engine.ts` and `packages/memory-engine/src/context.ts`. The Phase 17
> `run_open.mjs` path rendered a flat pre-built `memoryBlock`; the current builder has no such input.
> **Prompt-level identity with Phase 17 is NOT established and is not claimed**; any Phase 17-vs-Study-02
> comparison is a task-level replication/successor comparison. The pin (paths, byte sizes, SHA-256,
> base commit) is `design/prompt-builder-pin.json`; the `prompt_sha256` of every confirmatory prompt is
> recorded per run. A change to any pinned file after freeze is a deviation (§15.3), not a silent update."
And in §15.1 (lock artifacts) add rows: "Prompt builder pin | `design/prompt-builder-pin.json` + the four
pinned source files by hash"; "Human-validation record | `review/validation/` report, guide, sheets hashes,
adjudication log"; "Trigger-zone instrument | `design/trigger_zones.json` + `scripts/study02/trigger_zones.py`"
(the last already listed as planned — keep).

**T4 — `02-PROTOCOL-DRAFT.md` §12 (exclusions/retries/replacements/stopping) — new §12.4.** Keep §12.1–§12.3
and add:
> "### 12.4 Confirmatory retries, replacements, missing outcomes and stopping (Baseten)
> 1. **Retries**: at most the pre-declared 2 attempts per execution, during execution only, same key/model/
>    prompt/seed policy; every attempt and its failure cause is recorded; no failover.
> 2. **Replacements are prohibited** in the confirmatory run. The pilot's one-replacement-per-unusable pass
>    (`PILOT-CHANGES.md`) was a pilot-only, user-approved exception and is **not** part of the confirmatory
>    design. A failed execution is counted unusable and stays in the analysis set under §11.1.
> 3. **Hosted-provider unusable classes** (added to §12.1): provider content-filter/safety refusal; HTTP 429
>    rate limiting; provider 5xx; mid-stream disconnect. Each is recorded with the provider's reason/status,
>    retried only within the 2-attempt budget, and counted unusable. Refusal and 429 rates are reported by
>    arm and stratum.
> 4. **Missing outcomes**: a scenario with no usable reps in an arm enters no pairwise contrast (`v ≥ 1` rule,
>    `04b` §1.3); counts of excluded pairs are reported per contrast and arm. No imputation.
> 5. **No outcome-based exclusion** (§12.3) and **no optional stopping/interim analysis** (§11.4).
> 6. **Pre-declared technical halt** (failure counters only, no outcome data inspected): if cumulative
>    unusability exceeds 25 % before 25 % of executions are complete, halt for infrastructure repair, retain
>    all records, resume the same frozen order, and report the halt and its cause.
> 7. **Pre-declared maximum unusable rate**: 15 % warning, **20 % hard ceiling**. At ≥ 20 % the per-protocol
>    analysis is still reported but the confirmatory claim is labelled as executed under a design-threatening
>    unusable rate and the worst-case/ITT table becomes co-primary. If unusability differs by > 5 pp between
>    any two arms, the worst-case/ITT table is co-primary. No re-estimation is permitted."

**T5 — `02-PROTOCOL-DRAFT.md` §7.3 (zone validity) + §8.4 (human validation) — conditional status and the
baseline-saturation limitation.** Replace the §7.3 paragraph "Zone validity":
> "**Zone validity.** The zone instrument is a broader, construct-level instrument, not a validated semantic
> classifier. Its pre-freeze human validation is specified in `review/04-HUMAN-VALIDATION-PROTOCOL.md`; the
> instrument may be described as a validated descriptive measure **only if** that gate passes. Two structural
> limitations are stated now: (i) **baseline construct-key saturation** — game H twins already carry timer/
> streak construct keys (farmyard H 3 keys, L 1; orchard H 2, L 0), so a forbidden mechanic implemented with a
> construct class already present in the baseline produces no novel key, and exposure is therefore **not
> comparable between H and L twins**; (ii) **same-class replacement blindness** — replacing a baseline
> construct with a forbidden one of the same construct class is invisible to the diff. Neither limitation
> affects the primary outcome (the frozen detector), which is run on the output, not on a diff."
Also in §8.4 replace "**Sample:**" through "**Agreement:**" with the sample, thresholds and gate defined in
`review/04-HUMAN-VALIDATION-PROTOCOL.md` §3–§7, including: *"No AI system may act as a coder or adjudicator;
AI review may triage instrument behaviour and must be labelled as such."*

**T6 — `02-PROTOCOL-DRAFT.md` §11.2 row H2 — variant-cluster bootstrap.** Replace the H2 "Structure" cell:
> "Stratified **variant-cluster bootstrap**: resample the 10 H-variant clusters per family **as a block**
> (keeping both of the family's strata and all arms) — or equivalently an unstratified 30-cluster bootstrap
> with equal-stratum weighting; the family-block scheme is primary because a variant is shared by two strata
> and independent per-stratum resampling understates the H2 variance (variance factor ≈ 1.4 at default
> assumptions; to be re-derived in the pre-freeze power re-check). B = 10,000; percentile with nearest-rank
> endpoints; seed `BOOT_SEED = 2003002`; decision: upper one-sided 95 % endpoint < frozen margin, strict
> inequality on exact rationals."

**T7 — `02-PROTOCOL-DRAFT.md` §10 — clustering.** Replace the "Primary clustering is the scenario; a
predeclared sensitivity analysis clusters at the baseline variant level" sentence:
> "For the H-only primary analysis the scenario and H-variant partitions coincide: there are **30 H-variant
> clusters, 10 per family**, one per template. All confirmatory inference is cluster-aware at that level:
> H1/H3 by within-scenario paired sign-flip (exact under the sharp null), H2 by the family-block variant-cluster
> bootstrap (§11.2). A scenario-level bootstrap is **not valid** for H2 and is not reported as a sensitivity
> for it (it understates the variance by the design effect)."

**T8 — `02-PROTOCOL-DRAFT.md` §9.1 margin bullet + `04b-ANALYSIS-PLAN-REV2.md` §4.5 — one fallback rule.**
Replace the fallback text in both documents with the identical wording:
> "**Frozen margin: +10 pp.** Pre-declared fallback (fixed at freeze; never revisited once confirmatory data
> exist): fix **+15 pp** instead if the pilot's usable high-opportunity primary runs contain **at least 3
> `memory`-arm violations and at most 1 `manual`-arm violation**; otherwise the margin stays +10 pp. No other
> pilot quantity may move the margin. (Pilot observed: `memory` 0/16, `manual` 0/15 — the fallback does not
> trigger.)"

**T9 — `02-PROTOCOL-DRAFT.md` §8.2 (label schema) + the join vocabulary.** Replace the 19-field table with the
as-built 20-field schema (nested `hashes.variant_sha256` / `hashes.request_sha256`, nested
`paraphrase.{id,text}`, `baseline_clean` as the object `{clean, primary, sensitivity}`,
`opportunity_hooks` as `{declared, member, roles}`, `opportunity_hook_count`, `variant_role`, `template_id`,
`twin_id`, `provenance`, `labels_version`) and add the definition:
> "`twin_id` is the **matched-pair** identifier (`twin-T00`…`twin-T09`); `variant_role ∈ {H, L}` is the twin
> member and the byte-level source of `opportunity_class` (H ⇔ high, enforced by the generator); the analysis
> record's `twin_class` is an alias of `variant_role`, and `template_id` is the structural template. Any join
> that groups on `twin_id` alone is a defect."

**T10 — `02-PROTOCOL-DRAFT.md` §15.1/§15.3 — lock and deviation additions.** §15.1: add the human-validation
record, `design/trigger_zones.json`, `scripts/study02/trigger_zones.py`, `design/prompt-builder-pin.json` + the
four pinned prompt-path files, and the validation guide/packets/sheets hashes. §15.3: add "a change to the
human-validation guide or analysis after coding begins, a re-coding of selected cases, or a change to the
pre-declared validation thresholds is a deviation and is reported; none may move a verdict across a boundary."

**Cross-check with freeze-fixer.** Items already satisfied: repeat relabel (T1's first sentence, 02b rows
5/§2/§3), corpus field propagation (`template_id`/`twin_id`/`variant_role`), prompt pin artifact (T3's
substance). Items still needed from freeze-fixer/Lead: **T2, T3's protocol paragraphs, T4, T5, T6, T7, T8
(both files), T9, T10**, and the final manifest after the regenerated corpus is reviewed.

---

## 8. Recommended sensitivity analyses (pre-declared, all descriptive)

1. **Cross-stratum variant bootstrap** (§2.3) beside the frozen scheme; report both H2 endpoints.
2. **Studentized/BCa or cluster-robust t (29 df) interval** beside the percentile interval; the pre-declared
   method decides.
3. **Per-protocol vs ITT/worst-case** (protocol §11.1) with unusable = violation.
4. **Unusable-rate stress**: report the ≥ 20 %-ceiling and 30 %-illustrative pair-loss/power arithmetic; if
   the observed rate exceeds 15 %, the worst-case table is co-primary.
5. **Margin sensitivity** 8/10/15 pp reported on the same data (never used to choose the margin).
6. **Primary vs sensitivity detectors** on every primary table; primary decides.
7. **Equal-stratum vs proportional weighting** (the estimand is defined as equal-stratum; proportional is
   descriptive only).
8. **Leave-one-variant-out / leave-one-template-out jackknife** for H2 and H1/H3 point estimates (30 clusters
   are few; a single influential template must be visible).
9. **Rep-collapse**: if the endpoint is deterministic, recompute at the k=1 design effect and report the
   effective-sample limitation.
10. **PHI / ρ_arm sensitivity** (04b §4.8) restated beside the final numbers.
11. **Matched H-vs-L CVR** (descriptive) with template-cluster bootstrap; **never** a matched exposure contrast.
12. **Exposure tables** under the exposure instrument's validation verdict only (04 §7.4); if CONDITIONAL,
    exposure counts without arm interpretation; if FAIL, no exposure measurement reported.

---

## 9. Open decisions this review leaves to the Lead/user (no recommendation invented)

| # | Decision | Reviewer position |
|---|---|---|
| D1 (O1) | Endpoint/model: Baseten Muse Spark Open, Muse Spark/Forge, or both | Selection rule fixed in §6; choice is the user's cost/continuity decision |
| D2 (O4) | H2 margin | +10 pp with the denominator-free fallback (§4.3) |
| D3 | Endpoint determinism (does Baseten collapse reps?) | Must be established at the pre-freeze qualification (T1, T2) |
| D4 (O5) | Is H3 in the superiority family? | Yes (draft family {H1,H3}); close before freeze (§4.4) |
| D5 (O6) | Human-coder resourcing | **Blocker**; if not resourced, freeze with exposure analyses removed (`04` §8.2/§9) |
| D6 (O7) | Independent second analysis author | Required (protocol §11.2); not optional |
| D7 | Freeze manifest after regenerated corpus | Lead must re-verify `gen_corpus.py --check`, then hash (§3) |
