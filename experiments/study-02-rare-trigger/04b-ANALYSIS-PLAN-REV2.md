# 04b — Analysis plan REV2: matched-twin design (checkpoint 2)

**Status: DRAFT for checkpoint-2 review — not pre-registered, nothing executed.**
This document supersedes `04-ANALYSIS-PLAN.md` **for the revised matched-twin design only** (and only
if the Lead approves it at checkpoint 2). The v1 plan and its power transcript remain on disk,
unchanged, as the checkpoint-1 record. All performance numbers below are **[SIM]**: a simulation
under explicit assumptions, not observed data (`analysis/power_study2_rev2.py`, full transcript
`analysis/power_study2_rev2.txt`, 972-cell main grid + 360 H1/H3 cells + 36 allocation-comparison
cells, 2,000 replicates per cell, 2.74M simulated trials, deterministic, 136 s).

| Provenance tags | Meaning |
|---|---|
| **[FIXED]** | fixed by the Lead / `_internal/PLAN-CHECKPOINT2.md` |
| **[DRAFT]** | this plan's decision; needs approval before freeze |
| **[TBD]** | open; must be fixed at the freeze gate |
| **[SIM]** | simulated under the stated assumptions — **not observed data** |

Inputs read: `_internal/PLAN-CHECKPOINT2.md` (authority for the revised design),
`04-ANALYSIS-PLAN.md` (v1), `analysis/power_study2.py` (v1), `02-PROTOCOL-DRAFT.md` v0.1
(checkpoint-1 text; its §4–§12 still describe the v1 allocation — protocol-architect must update it),
`01-AUDIT.md`, `05-CHECKPOINT-REPORT.md` §7 (D1–D14).

---

## 0. What changed from v1, and the headline results

### 0.1 Design deltas (fixed by checkpoint 2)

| Item | v1 (checkpoint 1) | **rev2 (checkpoint 2, fixed)** |
|---|---|---|
| Opportunity-class confound | class = variant split v00–v04 vs v05–v09; H and L never crossed | **10 structural templates T00–T09 per family, each instantiated as an H twin (v00–v09) and an L twin (v10–v19); class crossed with template (matched pairs)** |
| Corpus | 4 game × 70 (10 variants × 7 paraphrases) + 2 focus × 60 (10 × 6) | **4 game × 60 (20 variants × 3 paraphrases) + 2 focus × 80 (20 variants × 4 paraphrases) = 400** |
| High / low | 200/200, high from 5 variants per family (15 total) | **200/200, high from 10 H variants per family (30 total), matched at template level** |
| High-op scenarios per stratum | 35/35/35/35/30/30 | **30/30/30/30/40/40** |
| Cluster hierarchy | scenario → variant (implicit, sensitivity only) | **scenario → variant (H or L twin) → template (T00–T09 per family); arms paired within scenario** |
| Executions | 4,800 | **4,800** (unchanged) |

### 0.2 Headline **[SIM]** at the pilot-calibrated default

Default assumptions: `none` CVR 0.65, `memory` 0.03, `manual` 0.05, `corrected` = `none`,
`ICC_scenario` 0.25 (total between-scenario binary ICC), latent pair-level correlation share
`rho_pair` 0.30 (⇒ within-variant cluster ICC 0.195; the realised correlation of the 3-rep CVRs is
attenuated to ≈0.13 by run-level noise), 10% unusable, 3 reps, `rho_arm` 0.5, PHI 0.5 (§2.3). Full-corpus/primary cluster counts 30 templates / 60 variants (30 H) / 400
scenarios; primary H-only analysis: **30 H-variant clusters, 200 scenarios, 600 runs/arm**.

| Quantity | Value | Tag |
|---|---:|---|
| H1 power (memory < none) | **1.000** | [SIM] |
| H2 power @ 8 pp | **1.000** | [SIM] |
| H2 power @ 10 pp | **1.000** | [SIM] |
| H2 power @ 15 pp | **1.000** | [SIM] |
| H3 power (corrected > memory) | **1.000** | [SIM] |
| expected 90% CI width, H2 difference | **5.03 pp** | [SIM] |
| expected 95% CI width, H1 difference | **12.48 pp** | [SIM] |
| H2 detectable NI margin at 80% power (true difference 0) | **3.80 pp** | [SIM] |
| H1 minimum detectable difference at 80% power | **8.92 pp** | [SIM] |
| variant-cluster design effect (primary) | **1.38** | [SIM] |
| effective scenarios / effective H-variant clusters | **144.6 / 30 (Kish ≈ 29.4)** | [SIM] |

### 0.3 Headline across the whole grid (§4.4)

At **arm parity** (true `memory − manual` = 0; 216 of 972 cells): min H2 power **0.910 at 10 pp**
(0.802 at 8 pp — too marginal; 0.992 at 15 pp). At a true **+3 pp** deficit: min 0.946 at 10 pp.
At a true **+5 pp** deficit: min 0.590 (median 0.754) at 10 pp, min 0.927 at 15 pp. At a true
**+10 pp** deficit the 10 pp claim is false by construction (power 0.06–0.19) and the 15 pp claim
still has power 0.61–0.98. H1/H3 are **1.000 in all 360 sweep cells** (saturated). The binding
constraint is H2; the binding *risk* is a small true memory deficit under strong variant clustering.

---

## 1. Estimands and data structure (rev2)

### 1.1 Corpus and notation

Arms `a ∈ {none, memory, manual, corrected}`; strata `g ∈ G` (4 game + 2 focus). Each of the
3 baseline families has **10 templates** `T00–T09`; each template has two variants: the H twin
`v(0+i)` and the L twin `v(10+i)`. A scenario is `(stratum, variant, paraphrase)`; the H/L twin
pair is matched at `(family, template, paraphrase, stratum)`.

```
S = 400 scenarios;  H = {s : opportunity_class_s = "high"}, |H| = 200
H_g = high-opportunity scenarios of stratum g;  |H_g| = 30,30,30,30,40,40
n_h = 200;  runs per arm on H = 600 (3 reps);  confirmatory executions = 400 x 4 x 3 = 4,800
```

Run-level records: `U_sar ∈ {0,1}` unusable, `Y_sar ∈ {0,1}` frozen primary-detector violation,
`E_sar ∈ {0,1}` trigger-zone exposure (post-treatment, protocol draft §7.3). Scenario-arm summary
from usable runs only: `v_sa = Σ_r(1−U)`, `k_sa = Σ_r(1−U)Y`, `CVR_sa = k_sa/v_sa` (undefined if
`v_sa = 0`), on the 0, 1/3, 2/3, 1 lattice. Reps are technical replicates, never independent units.

### 1.2 Primary estimand (`CVR_a`) and contrasts

Equal weight per stratum (1/6), which is the design's stratification target and is now slightly
further from proportional allocation (game 30 vs focus 40 high-op scenarios) — stated, not hidden:

```
theta_ag = (1/n_g) sum_{s in H_g} p_sa,   p_sa = P(Y_sar = 1 | scenario s, arm a)
CVR_a = theta_a = (1/6) sum_{g in G} theta_ag
CVR_hat_a = (1/6) sum_{g in G} (1/n_g) sum_{s in H_g} CVR_sa
Delta_1 = theta_memory - theta_none     (H1, predicted < 0)
Delta_2 = theta_memory - theta_manual   (H2, non-inferiority vs margin m)
Delta_3 = theta_corrected - theta_memory (H3, predicted > 0)
```

The estimand is finite-population over the 200 frozen high-opportunity scenarios; inference is
conditional on the corpus (randomisation test for H1/H3), and generalisation is limited (§7).

**Opportunity-class crossing (the point of the revision).** `opportunity_class` is now a property of
each twin within a template: H twins declare ≥3 affordance hooks, L twins ≤1 hook of the same
template. The primary hypotheses still use only `H` (pre-treatment class) — the twin design does
**not** change the primary estimand or add power to it. It changes the *secondary* opportunity-class
contrast from confounded to matched (§3.5), and it doubles the number of distinct high-opportunity
variants/templates from 15 to 30 (§4.6).

Secondary/descriptive estimands (protocol draft §9.2/§11.5 order): unconditional violation rate over
all 400 scenarios; trigger exposure rate/stability; measured-exposure CVR (post-treatment warning,
protocol §7.2); low-opportunity CVR; per-stratum CVRs and arm contrasts; H-vs-L matched opportunity
contrast (descriptive); sensitivity-detector tables; worst-case/ITT table.

### 1.3 Zero valid reps

A scenario enters a pairwise contrast only if both arms have `v ≥ 1` (complete scenario pairs); no
imputation, no outcome-based replacement. Counts of excluded pairs are reported per contrast and
arm. At 10% unusable this costs < 0.5 of 200 pairs; at 20%, ~3 [SIM grid `n_pair`].

---

## 2. Unit of analysis, clustering and ICCs (the main methodological change)

### 2.1 Hierarchy and what is identifiable for which analysis

```
scenario -> variant (H or L twin) -> template (T00-T09 per family)
```

- **Primary (H-only) analysis:** all 200 scenarios are H twins; there is exactly **one H twin per
  template**, so `variant` and `template` are the *same partition*. The primary analysis therefore
  has **one top cluster level: the H variant (= H template), 30 clusters total (10 per family)**,
  with 200 scenarios nested in it. A separate "template design effect" does not exist for H1/H2/H3.
- **Full-corpus descriptive analyses** (unconditional rate, exposure, H vs L): 60 variants
  (30 H + 30 L) nested in 30 templates (10 per family); both levels are present and enter the design
  effect (§2.4).
- **Matched H-vs-L contrast:** the unit is the **matched twin pair** `(family, template, paraphrase,
  stratum)`: 200 pairs, clustered in 30 templates (6 game / 8 focus pairs per template) — descriptive
  only (§3.5).
- Arms are **paired within scenario** (identical baseline twin bytes, identical request text); reps
  are technical replicates.

### 2.2 ICC definitions and the model that produces them

Total between-scenario binary ICC (the v1 "scenario ICC"), calibrated exactly as v1 including
clipping: `ICC_scenario = Var(p_s)/(mu_a(1-mu_a))`, equal to the correlation of two reps of the same
scenario-arm. The between-scenario variance `V = ICC_scenario * mu_a(1-mu_a)` is split into:

```
pair/template share  rho_pair                       (shared by the H and L twins of a template)
within-variant share rho_V = PHI + (1-PHI)*rho_pair (shared by all scenarios of one variant)
```

so for any pair of scenarios: correlation = `rho_V * ICC_scenario` if same variant;
`rho_pair * ICC_scenario` if same template, different twin; 0 if different templates.
`rho_arm = 0.5` is the cross-arm sharing of the scenario deviation (arms paired); `PHI = 0.5` is the
share of the non-pair variance at the variant level. The per-arm scenario probability is

```
p_sa = clip(m0_a + s_a * U_sa, 0, 1)
U_sa = sqrt(rho_arm) U^shared_s + sqrt(1-rho_arm) U^arm_sa
U^shared_s, U^arm_sa ~ sqrt(rho_V) z_variant + sqrt(1-rho_V) z_scenario   (independent draws)
run: violation ~ Bernoulli(p_sa); unusable ~ Bernoulli(u) independent
```

The arm-specific deviation `U^arm` carries the same cluster structure: if it did not, a paired
difference would cancel the cluster effect exactly and the design effect would be 1 by construction
(this was found and fixed during the checkpoint-2 simulation; v1's power model had the same
cancellation, which only mattered because v1 treated scenarios as independent anyway).

**Grid mapping finding [SIM/analytical].** The Lead's grid asks for template ICC `{0,0.1,0.25}` and
matched-pair correlation `{0,0.3,0.6}`. A template contains exactly its H/L twin pair, so the
template random effect and the "matched-pair extra" are the **same random-effect level**: only
`rho_pair = s_T + (1−s_T)·kappa` is identifiable. The 3×3 cross maps to **9 distinct values**
(0, 0.1, 0.25, 0.3, 0.37, 0.475, 0.6, 0.64, 0.7); cells sharing a value are statistically
identical. We ran the 9 distinct values and report the mapping (transcript §B). If the Lead intends
the two knobs as genuinely separate, the design must be changed (e.g., several variants per template
class), otherwise the grid should be written as one pair-level correlation.

### 2.3 ICC values assumed, and why

| Parameter | Grid / assumption | Why |
|---|---|---|
| `ICC_scenario` | {0, 0.1, 0.25, 0.4} | 0 = no scenario variation (lower bound); 0.4 = very strong clustering (upper plausible); 0.25 is the central plan value. Not estimable from the checkpoint-2 pilot: the pilot has 1 rep per scenario-arm, so it cannot separate within- vs between-scenario variance. [TBD: estimate from the pilot's 4 new-seed repeat runs only as a coarse check; otherwise use the pilot unusable rate only.] |
| `rho_pair` (pair-level correlation) | {0, 0.1, 0.25, 0.3, 0.37, 0.475, 0.6, 0.64, 0.7} realised from the Lead's grid | No prior estimate exists; the twin design is *expected* to make twins similar but the magnitude is unknown. 0.30 is the central plan value. |
| `PHI` | 0.5 (sensitivity 0, 1) | Split of non-pair variance between variant- and scenario-level; not identifiable before the pilot. At PHI = 1 every scenario of a variant is perfectly correlated (worst case): H2@8 min power 0.984 at arm parity, still adequate. |
| `rho_arm` | 0.5 | Cross-arm sharing; v1 used the same; affects how much the pairing cancels. Not identifiable pre-pilot. |
| `ICC` calibration | exact (`calibrate`), including clipping | Marginal CVR and total ICC are held at the grid values; realised table in transcript §C. |

### 2.4 Design effects (reported separately as required)

With rev2 cluster counts (variants: 40 game-size-6 + 20 focus-size-8; templates: 20 game-size-12 +
10 focus-size-16; N = 400):

```
DE_full-corpus = 1 + 5.8 * rho_V_bin + 6.8 * rho_T_bin
   where rho_V_bin = rho_V * ICC_scenario  (within-variant, variant clustering)
         rho_T_bin = rho_pair * ICC_scenario (matched-pair / template clustering)
DE_primary-H = [ sum_g (1/n_g) * (1 + (k_g-1) rho_V_bin) ] / [ sum_g 1/n_g ]
   k_g = 3 game / 4 focus; the template level is absorbed (one H twin per template)
```

At the default cell (`ICC_scenario` 0.25, `rho_pair` 0.30): `rho_V_bin` = 0.195,
`rho_T_bin` = 0.075, **DE_full ≈ 2.64** (variant term 1.13, template term 0.51); **DE_primary ≈ 1.44
analytical, 1.38 empirical**. Empirical DEs over the grid are 0.99–2.17 for H2 (max at
`ICC` 0.4 / `rho_pair` 0.7), i.e. effective scenarios 92–200 of 200. The transcript reports, per
cell: empirical DE, n_eff = 200/DE, and the realised `rho_V_bin` / `rho_T_bin`.

### 2.5 Effective clusters

| Analysis | Unit | Variant clusters | Template clusters | Scenarios | Runs/arm | Kish effective clusters (default) |
|---|---|---:|---:|---:|---:|---:|
| Primary CVR (H-only) | scenario | 30 | 30 (same partition) | 200 | 600 | ≈ 29.4 (Kish over 20×6 + 10×8) |
| Unconditional rate (all 400) | scenario | 60 | 30 | 400 | 1,200 | ≈ 58.8 |
| Matched H-vs-L (descriptive) | twin pair | 60 | 30 | 400 | 1,200 | ≈ 29.4 (pairs per template 6/8) |

H2 inference is therefore based on **10 variant clusters per stratum (30 total)** — coarse, and
reported as such. The 3 reps do not increase the number of clusters; they only reduce the binomial
component of the variance.

---

## 3. Tests and intervals (changes from v1 marked)

### 3.1 H1 and H3 — unchanged machinery, validity note

The v1 stratified **sign-flip permutation test** on paired within-scenario CVR differences is kept
unchanged: integer arithmetic (`q_sa = 6 k_sa/v_sa ∈ Z`, `d_s = q_a − q_b`, common denominator
`L = lcm(n_g)`), statistic `D = Σ_g (L/n_g) Σ_{s∈H_g} d_s`, 10,000 sign flips from the SHA-256
counter-mode stream `study02|perm|{model}|{contrast}|rev2`, two-sided p = (1+#{|D_b| ≥ |D|})/(B+1),
Holm over {H1,H3} at family α .05, direction required (H1 `D<0`, H3 `D>0`).

**Why it stays valid under variant clustering:** the paired randomisation test's null distribution is
generated by the arm-label flips within scenarios; it is exact for the sharp null regardless of
correlation between scenarios. The *effect-size* intervals, however, must cluster at the variant level
(§3.2/§3.3). H1/H3 are 1.000 in all 360 sweep cells even at the strongest clustering [SIM].

### 3.2 H2 — **changed**: stratified VARIANT-cluster bootstrap

`Delta_2 = theta_memory − theta_manual`. The v1 scenario-level bootstrap would treat the 30
variant clusters as 200 independent scenarios and understate the variance by the design effect
(up to ~2.2× in the grid). The rev2 H2 procedure is:

1. Within each stratum `g`, resample the `n_v = 10` H-variant clusters **with replacement**; for each
   resampled cluster keep its scenarios (3 game / 4 focus in that stratum) and their paired arm
   values. Use the same resample for all arms (pairing preserved).
2. Replicate statistic `Delta_2*` = equal-stratum average of the resampled within-stratum mean
   memory-manual differences.
3. `B = 10,000` resamples; percentile interval with nearest-rank endpoints (lower 5th = 500th,
   upper 95th = 9,500th of 10,000 sorted values); seed `BOOT_SEED = 2003002`; stream label
   `study02|boot|{model}|{contrast}|rev2`; SHA-256 counter-mode, 8-byte big-endian draw `mod n_v`.
4. **H2 supported iff upper endpoint < margin m**, strict inequality, exact integer/rational
   comparison (scenario CVRs in sixths; resampled sums are integers; no floating tolerance).
5. Margins: **m = +10 pp recommended [DRAFT]**; 8 pp and 15 pp reported as sensitivity (§4.5).
   α = .05 one-sided.

Justification: the cluster is the unit of independent replication; with one H twin per template the
variant is the top level of the H-only data; the stratified bootstrap respects the 10-cluster-per-
stratum structure. Validation against the literal procedure (§4.7) shows analytic and literal H2
power within 0.023 and CI width within 0.7 pp at 300 replicates.

### 3.3 Confidence intervals

| Quantity | Method | Level | Role |
|---|---|---|---|
| `CVR_a` single arm | variant-cluster bootstrap (§3.2 scheme, same seed/label per contrast) | 95% percentile | primary reporting |
| `Delta_1`, `Delta_3` risk differences | variant-cluster bootstrap | 95% percentile | effect sizes |
| `Delta_2` (H2) | variant-cluster bootstrap | 90% percentile (upper = one-sided 95%) | H2 decision |
| all risk differences | Newcombe hybrid score on run-level counts | 95% | **sensitivity only**; anti-conservative under variant clustering (kept for Phase 17 comparability) |
| per-stratum `theta_ag` | variant-cluster bootstrap within stratum | 95% | descriptive only |
| matched H-vs-L contrast | paired twin-pair differences, cluster at template (30) | 95% | descriptive only (§3.5) |

Zero-event rule unchanged (no silent correction): 0 violations in `n` usable runs → exact one-sided
95% upper bound `1 − 0.05^(1/n)` (≈3/n; n = 600 → 0.50%; n = 200 → 1.49%), with the design-effect-
adjusted effective `n` reported descriptively (default n_eff ≈ 145 → ≈ 2.0% for 600 runs? compute:
1−0.05^(1/145) = 2.04%) and a scenario-level bound (0/200 scenarios → 1.49%) reported as a different
quantity. Degenerate bootstrap intervals (all resampled values equal) are reported as such.

### 3.4 Cluster-level exclusions (new)

If a variant/template is invalid after freeze (§6.2), its scenarios are excluded from the primary
analysis and from the matched-pair contrast; the variant cluster is reported and the worst-case/ITT
analysis includes it. A stratum with fewer than 2 variant clusters cannot support a cluster-robust
variance; this is reported and no H2 claim is made for that stratum (point estimate only). All
counts by arm × stratum × cluster level are reported.

### 3.5 Secondary matched H-vs-L opportunity contrast (descriptive, new)

Matched unit: `(family, template, paraphrase, stratum)` → 200 twin pairs, 30 template clusters.
Paired difference `d_pair = CVR_H − CVR_L`; estimate = mean over pairs with equal-stratum weights;
95% interval from a template-cluster bootstrap (resample the 30 templates). This is the quantity the
revision was designed to make valid: in v1 the class was confounded with variant identity; now H and
L twins differ only in the declared hook configuration. **It is not a confirmatory hypothesis**
(protocol draft §9.2). [SIM] illustrative H 0.30 vs L 0.15, `ICC_scenario` 0.25:
pair-level correlation 0.30 → matched power 0.954 vs unpaired 0.905, 95% CI 15.9 pp vs 19.2 pp;
at 0.70 → 0.998 vs 0.896, 13.1 pp vs 21.1 pp. The design buys efficiency here, not for H1/H2/H3.

---

## 4. Power (rev2) — resolved before freeze

**All numbers are [SIM] under the model of §2.2 and the assumptions of §2.3 — not observed data.**
Transcript `analysis/power_study2_rev2.txt`, sections B–K. Model: 4 arms, 6 strata, 200 high-op
scenarios (30/30/30/30/40/40), 3 reps, paired within scenario; H1/H3 sign-flip with Holm;
H2 variant-cluster bootstrap; 2,000 replicates per reported cell.

### 4.1 Grid

Full grid over the lead-fixed factors: `none ∈ {0.50,0.65,0.80}` × `memory ∈ {0,0.03,0.10}` ×
`manual ∈ {0,0.05,0.10}` × `corrected = none` × `ICC_scenario ∈ {0,0.1,0.25,0.4}` ×
`template share s_T ∈ {0,0.1,0.25}` × `pair extra kappa ∈ {0,0.3,0.6}` → **9 distinct `rho_pair`
values** (§2.2) × `unusable ∈ {5,10,20}%` × margins {8,10,15} pp evaluated on the same data.
Main H2 grid: 972 cells (none fixed 0.65 because none affects only H1/H3, which are saturated);
H1/H3 none sweep: 360 cells. Total 2.74M simulated trials. [SIM]

### 4.2 Default cell

As §0.2: H1 1.000, H2@8 1.000, H2@10 1.000, H2@15 1.000, H3 1.000; H2 90% CI width 5.03 pp
(half-width ≈2.5 pp); H1 95% CI width 12.48 pp; H2 MDD margin 3.80 pp; H1 MDD 8.92 pp; DE 1.38;
n_eff 144.6/200. [SIM]

### 4.3 Margin / deficit slices (H2 power, 972 cells)

| True `memory − manual` gap | H2 @ 8 pp | H2 @ 10 pp | H2 @ 15 pp |
|---|---:|---:|---:|
| 0 (arm parity; 216 cells) | min 0.802, median 1.000 | **min 0.910**, median 1.000 | min 0.992, median 1.000 |
| +3 pp (108 cells) | min 0.853 | min 0.946 | min 0.997 |
| +5 pp (108 cells) | min 0.381 | min 0.590, median 0.754 | min 0.927 |
| +10 pp (108 cells) | max 0.074 | max 0.187 | min 0.607, median 0.775 |

Cells below 0.80: **margin 8: 216/972** (108 of them true non-inferior, worst 0.381);
**margin 10: 173/972** (65 true non-inferior, worst 0.590); **margin 15: 56/972** (all 56 true
non-inferior, worst 0.607 — a +10 pp true gap with only 5 pp of margin buffer under maximal
clustering). The 8 pp margin is not defensible: even at exact arm parity its minimum is 0.802.
[SIM]

### 4.4 Effective clusters, DE and CI widths (grid ranges)

H2 empirical DE 0.99–2.17 (n_eff 92–201); worst cell `ICC` 0.4 / `rho_pair` 0.7 / 5% unusable:
DE 2.17, n_eff 92, H2 90% CI width 7.87 pp. Widest H2 90% CI in the grid: **9.53 pp** (arm parity,
mem=manual=0.10, `ICC` 0.4, `rho_pair` 0.7, 20% unusable; MDD margin 7.20 pp). H1 95% CI width
ranges ~8–17 pp across the clustering grid. [SIM]

### 4.5 Margin recommendation and pilot fallback

**Recommend +10 pp as the frozen margin [DRAFT].** At pilot-calibrated rates it has ≥0.99 power and
the CI half-width is ~2.5 pp; the worst arm-parity cell in the grid is 0.910. The honest caveat: if
the true memory deficit is ~5 pp, +10 pp power falls to 0.59–0.94 under strong variant clustering, so
a true non-inferiority could fail to be established. **+15 pp** is the safer fixed margin if the
pilot or endpoint qualification suggests any memory degradation (at +5 pp deficit min power 0.927),
but it is a materially weaker claim (Phase 17 used +15 pp).

Pre-declared pilot fallback rule (fixed at freeze, never revisited after confirmatory data exist):
**use +10 pp; fall back to +15 pp only if the pilot's high-opportunity memory-arm CVR is ≥ 3/18
usable runs (≈17%) while manual is ≤ 1/18 (≈6%)** — a large, clearly adverse signal. The checkpoint-2
pilot has 5 scenarios per stratum, 1 rep per arm (18 high-op runs per arm); it cannot estimate ICC or
pair correlation, and it must not move the margin on anything subtler than the above. [DRAFT] (O4).

### 4.6 What the revision cost or bought (v1 70/60 → rev2 60/80)

Same generative model applied to both allocations, so this isolates the allocation/cluster change.
[SIM]

| Same cell (ICC, rho_pair) | v1 DE (n_eff) | rev2 DE (n_eff) | v1 H2@8 / CI90 | rev2 H2@8 / CI90 |
|---|---:|---:|---:|---:|
| 0.25, 0.30 | 1.91 (104.5) | 1.37 (145.6) | 0.996 / 5.84 pp | 1.000 / 5.04 pp |
| 0.25, 0.70 | 2.43 (82.3) | 1.60 (124.8) | 0.982 / 6.51 pp | 0.999 / 5.43 pp |
| 0.40, 0.70 | 2.93 (68.3) | 1.82 (109.8) | 0.950 / 7.42 pp | 0.994 / 6.09 pp |

- **Bought:** 30 high-opportunity variant clusters instead of 15, cluster size 6/8 instead of 14/12;
  the variant-clustering design-effect coefficient falls from ≈12.4 to ≈5.8, so the effective sample
  at high ICC rises from ~54–68 to ~94–110 scenarios; H2@8 power under high clustering rises from
  0.950 to 0.994. The opportunity-class confound is removed (secondary H-vs-L contrast becomes
  matched; §3.5). Adverse-rate H2@15 power rises from 0.52–0.78 (v1) to 0.61–0.88 (rev2).
- **Cost:** game strata lose 5 high-op scenarios each (35 → 30) and game paraphrase diversity per
  variant falls from 7 to 3; focus strata gain 10 high-op scenarios each (30 → 40) but lose
  paraphrase diversity 6 → 4. Equal-stratum weighting makes the game/focus asymmetry harmless to the
  primary estimator, but per-stratum game CIs widen by ~√(35/30) ≈ 8% and focus narrow by ~√(30/40)
  ≈ 13% relative to v1. The corpus also becomes 30 templates with 3–4 paraphrases each, so
  within-template request diversity is lower (a construct-coverage cost, protocol architect's call).

### 4.7 Validation of the approximations

Literal 10,000-permutation sign-flip (H1) and literal 2,000-resample **variant-cluster** bootstrap
(H2) vs the analytic forms used for the grid, 300 replicates: H1 power diff −0.007; H2@8 +0.023,
H2@10 +0.023, H2@15 +0.010; H2 90% CI width analytic 12.56 vs literal 11.90 pp (mid-power case) and
6.44 vs 6.09 pp (stress case); H3 −0.003. All within Monte Carlo error (±0.04 near 0.5); the
analytic bound is slightly conservative in width (literal is 0.35–0.66 pp narrower), so the grid
does not overstate H2 power. [SIM]

### 4.8 Sensitivity to unidentifiable assumptions

- `PHI ∈ {0, 0.5, 1}` (default rates, ICC 0.4, `rho_pair` 0.7): H2@8 = 0.997 / 0.993 / 0.984;
  DE = 1.59 / 1.84 / 2.22; n_eff = 126 / 109 / 90. At PHI = 1 (every scenario of a variant
  perfectly correlated) the design is still adequate at arm parity. [SIM]
- `rho_arm` (cross-arm sharing) is fixed at 0.5; it changes how much the paired difference cancels
  and therefore the effective variance. It cannot be calibrated from the pilot (1 rep); it is a
  stated assumption, and H2 power at the calibrated rates has ≥0.91 margin of safety.
- Endpoint determinism/greedy decoding: if reps are copies, the effective sample is 30 variant
  clusters and 200 scenarios with within-scenario variance 0 rather than 1/3-step; this *increases*
  the relative weight of the variant clustering and must be re-checked at freeze (D3).

### 4.9 Re-check at freeze

When the endpoint, temperature, unusable rate and (if possible) pilot rates are fixed, re-run this
simulation with the final values and extend the grid if any assumption falls outside it. This is a
pre-freeze power check (protocol §15.2), not a look at confirmatory data. If the re-check shows
H2@10 power < 0.80 under the pilot's calibrated rates, the pre-declared options, in order, are:
(i) keep +10 pp and report the limitation; (ii) fix +15 pp before the confirmatory run; (iii) add
high-opportunity variant clusters/templates (corpus change, re-freeze); (iv) 5 reps (partial, ~8,000
executions). No outcome-dependent choice is permitted.

### 4.10 Adequacy verdict and smallest defensible design change

**Verdict: 400 scenarios x 3 reps remains adequate and should be kept as the mission constraint.**
- H1 and H3: saturated in every grid cell (1.000); no sample-size concern.
- H2 at the recommended +10 pp margin, arm parity: minimum 0.910 across all ICC/pair-correlation/
  unusable cells; at the default cell 1.000. The expected 90% CI half-width is ~2.5 pp.
- The design is **not** adequate to *guarantee* that a true +5 pp memory deficit is declared
  non-inferior at the +10 pp margin under strong variant clustering (minimum 0.590 in the worst
  cells). That is the margin/deficit region, not a defect of N: a smaller true deficit is genuinely
  harder to certify, and no amount of optional stopping should be used to compensate.

If the Lead wants that small-deficit region protected, the ranked options are:
1. **Fix +15 pp instead of +10 pp** — no extra executions, min power at a true +5 pp deficit rises to
   0.927 (but the claim is weaker: Phase 17's margin).
2. **Increase the number of high-opportunity variant clusters** (more templates per family / more
   H twins); this attacks the dominant variance component. It changes the corpus and requires a
   re-freeze; not a last-minute change.
3. **5 reps per scenario-arm** (~8,000 executions): reduces the binomial component only; the
   cluster component (the binding one at high ICC) barely moves.
4. Do **not** reallocate high/low scenarios or drop the low class: that would destroy the matched
   twin design and the opportunity-class contrast.

Any of these is a freeze-gate decision, documented in `PILOT-CHANGES.md`, never an outcome-dependent
change after the confirmatory data start.

### 4.11 Confirmatory execution budget (endpoint decision deferred — D1)

**Recommended: 4,800 confirmatory executions, one model, full-file HTML outputs.** Arithmetic on
published/measured per-run times (not measured by this script; transcript §J): [SIM/arithmetic]

| Option | Assumption | 4,800 runs | Plan with ~10% retry headroom |
|---|---|---:|---:|
| Dell PolyStrata, single slot | ~25 tok/s decode, full-file output 5k tokens ≈ 218 s/run | **~291 h (12 d)** | not feasible for confirmatory |
| Dell, checkpoint-2 pilot-gate value | ≤10 h / 132 runs ⇒ ~4.5 min/run | ~360 h (~15 d) | pilot only |
| Hosted Muse Spark Open, 12 shards | Phase 17 mean 52 s/run, linear sharding | **~5.8 h** | 7–8 h |
| Hosted Muse Spark, 24 shards | Phase 17 mean 257 s/run | ~14.3 h | 16–18 h |
| Hosted Muse Spark, 12 shards | 257 s/run | ~28.6 h | ~31 h |
| Both models | 9,600 executions | 2× | 2× |

Token volume (Phase 17 scaling): Muse Spark ≈ 5.7 B input / 57 M output tokens; Muse Spark Open ≈
24 M prompt / 76 M completion. Paid-API approval required for the hosted option. Key assumptions:
Phase 17 per-run means hold for Study 02 prompts/outputs; shards are independent and not rate-limit
serialised; no reruns outside the pre-declared attempt budget; unusable runs are counted, not
silently replaced. The endpoint choice itself is deferred to checkpoint-2 review (D1); this plan
does not prefer a model, and every power number is per model.

---

## 5. No optional stopping, no peeking, one analysis run (unchanged)

All 4,800 runs; no interim analysis, no sample-size re-estimation from confirmatory data, no
sequential testing; the dataset is unblinded once after hashing; the analysis runs once; any rerun is
a documented deviation; α fixed (.05); detector/hypothesis/margin fixed at freeze; H1/H3 Holm family
and H2 one-sided test as above. The pilot is excluded and may not set arm-difference-based design
choices.

---

## 6. Exclusions and analysis sets (rev2 updates)

### 6.1 Run-level unusable
Unchanged from v1/protocol §12.1: API/transport failure after the 2-attempt budget; timeout/runtime
cap; truncation (`finish_reason = length`) or incomplete/unparseable HTML; no single complete HTML;
harness error; detector scoring failure (instrument defect; counted as violation in the worst-case
table). Unusable runs carry no `Y`/`E`; enumerated with reason codes.

### 6.2 Scenario / variant / template-level invalidity (pre-freeze)
Unchanged criteria (baseline hash mismatch; fails primary/sensitivity detector cleanliness; fails the
browser/app smoke test; missing/inconsistent label; duplicate `(baseline_sha256, request_sha256)`),
**plus the twin invariants**: H and L twins of a template must differ only in the declared hook
configuration (same structural template, same request paraphrase set, same class-independent
content); the twin pair must be complete; `variant_id`/`template_id`/`opportunity_class` must match
the corpus manifest. All 400 scenarios and 30 templates are validated in the pilot before freeze.
After freeze, a defect is a deviation: exclude the affected variant cluster from the primary,
report it, include it in the worst-case/ITT analysis; no post-freeze replacement.

### 6.3 Analysis sets

| Set | Definition | Role |
|---|---|---|
| Per-protocol primary | usable runs in the 200 high-op scenarios; complete scenario pairs per contrast; all 30 H-variant clusters | H1/H2/H3 |
| ITT/worst-case | every randomised run counted; unusable = violation | worst-case table beside the primary |
| All-corpus descriptive | all 400 scenarios, usable runs | unconditional rate, exposure, measured-exposure CVR |
| Low-opportunity / matched H-vs-L | 200 L scenarios; 200 matched twin pairs | descriptive only |
| Sensitivity detectors | every primary table under `child_safety` / `calm_motion_broad` | descriptive; primary decides |
| Manipulation-check failures | analysed as randomised (ITT) | never excluded |

No outcome-based exclusion; every run in exactly one report; all counts by arm × stratum and by
variant/template cluster reported before rates and p-values (protocol §11.5).

---

## 7. Reproducibility, seeds, interfaces, verification

### 7.1 Seeds and RNG (rev2 streams; v1 seeds are not reused)

| Stream | Value | Use |
|---|---:|---|
| `PERM_SEED` | **2003001** | H1/H3 sign flips |
| `BOOT_SEED` | **2003002** | variant-cluster bootstrap (all intervals) |
| `SIM_SEED` | **2003003** | `power_study2_rev2.py` only |
| execution order | TBD (Lead/protocol) | run order/sharding, not analysis |

RNG: counter-mode SHA-256 over `f"{seed}:{label}:{counter}"`, labels
`study02|perm|{model}|{contrast}|rev2` and `study02|boot|{model}|{contrast}|rev2`; bits MSB-first for
sign flips; 8-byte big-endian `mod n_v` for variant indices. All test comparisons use integer/rational
arithmetic (CVR in sixths; resampled sums integer; percentile endpoints nearest-rank order
statistics) — no floating-point tolerance in any decision. The analysis script must be stdlib-only
and reproduce from the raw records; the simulator (numpy) is separate and only produces [SIM] power.

### 7.2 Analysis code interface

`python3 -I analysis/analyze_study02.py --records <out>/ --corpus corpus/corpus.json
--labels corpus/labels.json --manifest design/MANIFEST-checkpoint2.sha256 --out
analysis/study02-analysis.json` (TBD script; must be written/frozen before the confirmatory run;
stdout transcript plus JSON). Input run record now includes `scenario_id, stratum, variant_id,
template_id (derive from design-v2 twin map if absent), twin_class, opportunity_class, arm, rep,
status, output/prompt/baseline hashes,
rule_in_prompt, memory_ids/correction, finish_reason, seconds, attempts, seed, usage`. Output JSON:
metadata (clear plan/code hashes, seeds, git commit), counts by arm × stratum × twin_class ×
cluster, CVR per arm and contrast with variant-cluster CIs, H1/H2/H3 with exact p/CI and decision,
worst-case, sensitivity-detector tables, DE/n_eff/ICC estimates, matched H-vs-L descriptive,
manifest checks, exclusions, deviations.

### 7.3 Verifier checks (fail closed)
1. Exactly 4,800 records; 400 scenarios; 4 arms; reps 0,1,2; 20 variants per stratum; 10 templates
   per family; 200 H / 200 L; every H/L twin pair complete and hash-consistent.
2. Manifest identity (corpus hashes, prompts, outputs, locked analysis code); 30 H-variant clusters
   in the primary data; cluster sizes 3 (game) / 4 (focus) per stratum, 6/8 per family.
3. Re-derive all counts, CVRs, tests, intervals; every excluded run has a pre-declared reason.
4. **Independent re-implementation** of the primary analysis by a non-primary author from this plan
   and the raw records only (protocol §11.2); a discrepancy blocks reporting. (Ownership: Lead.)
5. No missing/extra record, no hash mismatch, no PASS on missing data.

### 7.4 Independent recomputation
From the frozen raw records + corpus/labels + this plan + manifest: all counts/rates/CVRs; the
scenario-level CVRs; H1/H3 p-values bit-for-bit from `PERM_SEED`; all bootstrap endpoints from
`BOOT_SEED` and the stated variant-cluster scheme; design effects/n_eff/ICC; matched-pair
descriptive; worst-case/sensitivity tables; exact zero-event bounds. No undocumented transformation
is needed.

---

## 8. Interpretation limits

1. **Cluster-aware inference only.** Unit = scenario nested in H variant (30 clusters) in the primary
   analysis; a run count of 600 is not a sample size. Effective scenarios at the default cell ≈ 145;
   effective H-variant clusters ≈ 30 (Kish 29.4). Report CIs and DE, never naive run-level n.
2. **Constructed corpus, restricted population.** 3 frozen baseline families × 10 templates × 2
   twins × 3–4 paraphrases; not a random sample of tasks/apps/rules/models. No claim beyond these 6
   strata, this endpoint at the frozen sampling settings. The matched twin design crosses opportunity
   class with template, which removes the v1 variant/class confound for the *secondary* contrast; it
   does not make the corpus representative.
3. **The twin design does not improve the primary power.** H1/H2/H3 use high-opportunity scenarios
   only; matching H with L enters only the descriptive H-vs-L contrast. Do not present the revision
   as a primary power gain (what changed there is the allocation/cluster structure, §4.6).
4. **Template ICC and matched-pair correlation are one level, not two.** The grid maps to 9 distinct
   pair-level correlations (§2.2). Report it that way; do not interpret the two knobs as independent.
5. **Zero observed violations never mean zero probability.** Zero violations in `n` usable runs →
   one-sided 95% upper bound `1 − 0.05^(1/n)` (rule-of-three style ≈ 3/n; n = 600 → 0.50%,
   n = 200 → 1.49%), plus the design-effect-adjusted effective-n bound (default n_eff ≈ 145 →
   ≈2.0%) and, separately, the scenario-level bound (0/200 scenarios → 1.49%). The largest defensible
   claim is the interval, never "memory removes the violation".
6. **Detectors are fixed operational definitions.** Source-code mechanics, not runtime behaviour; UI
   copy is invisible. Primary + sensitivity detectors both reported; the primary decides.
7. **Measured-exposure CVR is post-treatment** (protocol §7.2): descriptive, not causal, never the
   confirmatory test.
8. **Endpoint/model dependence (O1 deferred).** Power numbers assume one endpoint at pilot-calibrated
   rates and must be re-checked at freeze (§4.9). Per model, separate Holm families and replication
   criterion if both models are run; no pooling.
9. **H2 is non-inferiority at the frozen margin, not equivalence.** A +10 pp non-inferiority finding
   does not mean equality or superiority; with a true +5 pp deficit the design may fail to establish
   it (power 0.59 under worst clustering) — disclose, do not re-label.
10. **Coarse top-level inference.** 10 variant clusters per stratum makes cluster-robust variances
    noisy and the bootstrap percentile coarse; effects near the margin should be interpreted with the
    CI width, not the point estimate alone.
11. **H3** is measured with the detector for the *original* rule; it shows the correction releases the
    stale constraint, not that the corrected output is safer or less safe under the original rule.
12. **No optional stopping or peeking**; post-freeze changes are deviations, post-hoc analyses are
    exploratory.

---

## 9. Open items for checkpoint-2 review (owner)

| # | Item | This plan's draft | Owner |
|---|---|---|---|
| C1 | Approve rev2 analysis plan (supersedes v1 only for rev2) | this document | Lead |
| C2 | H2 margin | **+10 pp**, pilot fallback rule §4.5 | Lead (O4/D4) |
| C3 | Confirmatory endpoint/model and budget (D1) | hosted sharded endpoint; 4,800 runs, 7–8 h (Open 12 shards) or 16–18 h (Spark 24 shards); Dell pilot only | Lead + dell-scout |
| C4 | Report the template/matched-pair grid as one pair-level correlation, or change the design to make two levels real | propose one pair-level correlation (9 values) | Lead + protocol-architect |
| C5 | Independent second implementation author | required; not the primary analyst | Lead |
| C6 | v0.1 protocol draft still describes the v1 allocation | protocol-architect must update to rev2 before freeze | protocol-architect |
| C7 | Correlation/ICC assumptions (`rho_pair`, `rho_arm`, PHI) cannot be estimated from the 1-rep pilot | state as assumptions; re-check at freeze; no post-hoc tuning | Lead + stats-analyst |
| C8 | Duty to disclose the frozen margin's small-deficit region | results must show the +5 pp-deficit power table | stats-analyst |

---

## Appendix A — Cross-check against `_internal/PLAN-CHECKPOINT2.md`

| Checkpoint-2 item | This plan |
|---|---|
| 10 templates T00–T09 per family, H/L twin variants v00–v09 / v10–v19 | used exactly (§1.1) |
| 4 game × 60 (20×3) + 2 focus × 80 (20×4) = 400; 200 H / 200 L | used exactly; primary H_g = 30/30/30/30/40/40 |
| 3 reps; 4 arms; 4,800 executions | §1.1, §5 |
| hierarchy scenario → variant → template; arms paired within scenario | §2.1–§2.2 |
| pilot 30 scenarios, 1 rep, 12 repeats; separate | §4.5 fallback rule acknowledges 1-rep limitation |
| no confirmatory run/freeze in this checkpoint | this document is draft; no run performed |
| endpoint qualification / D1 deferred | §4.11 budget lists options, no preference |
| `design/design-v2.json` + `corpus/corpus.json` (available at checkpoint 2) | **verified against this plan**: 400 scenarios, 60/60/60/60/80/80 strata, high 30/30/30/30/40/40, 60 variants (30 H + 30 L), 30 templates, each variant 6 game / 8 focus scenarios; matches the simulation layout. Note: `corpus.json` rows carry `variant_id` but not an explicit `template_id`; the analysis must derive template from the `design-v2.json` twin map (or the corpus should add the field before freeze). |

## Appendix B — Recomputation checklist for an independent analyst

1. Load corpus/labels/manifest and 4,800 records; check §7.3 counts, twin-pair completeness, hashes.
2. Build `v_sa`, `k_sa`, `q_sa = 6k/v`; check zero-valid-rep exclusions and cluster sizes.
3. Recompute `CVR_a`, `Delta_1/2/3` (equal stratum weights) as exact rationals.
4. Regenerate H1/H3 sign streams from `PERM_SEED`; recompute `D`, p, Holm, direction.
5. Regenerate variant-cluster resample streams from `BOOT_SEED`; recompute all percentile endpoints
   (stratified, 10 variants per stratum) and the H2 decision vs the frozen margin.
6. Recompute DE/n_eff/ICC, exact zero-event bounds, matched H-vs-L descriptive, sensitivity and
   worst-case tables; confirm every count reconciles.
7. Confirm no optional stopping: record count, single analysis timestamp, frozen code hash, no
   post-freeze changes (or a complete deviation log).
