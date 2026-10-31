# 04b — Analysis plan REV2: matched-twin design (checkpoint 2)

**Status: DRAFT for the freeze gate — not pre-registered, nothing executed.** This document
supersedes `04-ANALYSIS-PLAN.md` **for the revised matched-twin design only**. The v1 plan and its
power transcript remain on disk, unchanged, as the checkpoint-1 record and are **not** modified by
this correction. All performance numbers below are **[SIM]**: a simulation under explicit
assumptions, not observed data (`analysis/power_study2_rev2.py`, full transcript
`analysis/power_study2_rev2.txt`, 972-cell main grid + 360 H1/H3 cells + 36 allocation-comparison
cells, 2,000 replicates per cell, 2.74M simulated trials, deterministic; transcript SHA-256
`39b7ec5474d45c7a145870c785133a27b592f433fa1dcf7398662ac47fd624c5`).

**Change log.** 2026-10-31 — checkpoint-2 draft (matched-twin design). **2026-11-01 — freeze-prep
correction** (from `review/05-DESIGN-STATISTICAL-REVIEW.md`): **T6** the H2/CI clustering is
corrected from the anti-conservative per-stratum variant bootstrap to the **family-block
variant-cluster bootstrap** (old scheme retained only as a pre-declared sensitivity); **T8** one
denominator-free margin fallback rule replaces the two inconsistent variants; **max-unusable /
co-primary rule** added (§6.4); **pilot→Baseten assumption-transfer statement** added (§4.12).
All changed H2/CI/power numbers are the regenerated T6 transcript; the v1 transcript is untouched.

| Provenance tags | Meaning |
|---|---|
| **[FIXED]** | fixed by the Lead / `_internal/PLAN-CHECKPOINT2.md` |
| **[DRAFT]** | this plan's decision; needs approval before freeze |
| **[TBD]** | open; must be fixed at the freeze gate |
| **[SIM]** | simulated under the stated assumptions — **not observed data** |
| **[OBSERVED]** | pilot/qualification observation cited from the checkpoint-2 records (not confirmatory data) |

Inputs read: `_internal/PLAN-CHECKPOINT2.md` (fixed design), `review/05-DESIGN-STATISTICAL-REVIEW.md`
(§2–§7, T6/T8), `02b-PROTOCOL-REVISION-V2.md`, `04-ANALYSIS-PLAN.md` (v1 record, untouched),
`analysis/power_study2.py` (v1, untouched), `design/design-v2.json`, `corpus/*`, and the checkpoint-2
pilot records (read-only).

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

### 0.2 Headline **[SIM]** at the pilot-calibrated default (T6-corrected)

Default assumptions: `none` CVR 0.65, `memory` 0.03, `manual` 0.05, `corrected` = `none`,
`ICC_scenario` 0.25 (total between-scenario binary ICC), latent pair-level correlation share
`rho_pair` 0.30 ⇒ `rho_V = PHI+(1−PHI)rho_pair = 0.65` and within-variant ICC 0.1625 (the realised
correlation of the 3-rep CVRs is attenuated to ≈0.13 by run-level noise); the two strata of a family
share the same variants, with cross-stratum correlation c ≈0.37 (game) / 0.44 (focus); 10%
unusable; 3 reps; `rho_arm` 0.5; PHI 0.5. Primary H-only analysis: **30 H-variant clusters
(10 per family), 200 scenarios, 600 runs/arm**; the T6 family-block bootstrap is the H2/CI
estimator.

| Quantity | T6-corrected [SIM] | old per-stratum scheme (sensitivity) |
|---|---:|---:|
| H1 power (memory < none) | **1.000** | — |
| H2 power @ 8 pp | **0.999** | — |
| H2 power @ 10 pp | **1.000** | — |
| H2 power @ 15 pp | **1.000** | — |
| H3 power (corrected > memory) | **1.000** | — |
| expected 90% CI width, H2 difference | **5.89 pp** | 5.03 pp |
| expected 95% CI width, H1 difference | **15.35 pp** | 12.48 pp |
| H2 detectable NI margin at 80% power (true difference 0) | **4.45 pp** | 3.80 pp |
| H1 minimum detectable difference at 80% power | **10.97 pp** | 8.92 pp |
| design effect (primary) | **1.91** | 1.38 |
| effective scenarios / effective H-variant clusters | **104.9 / 30 (Kish ≈29.4)** | 144.6 |

The implied cross-stratum variance inflation is c = 0.361 empirically (analytic 0.391): the family-
block correction widens the default H2 CI by ~17% (5.03 → 5.89 pp) and raises DE from 1.38 to 1.91,
exactly the direction and size the design review predicted (~1.4× variance).

### 0.3 Headline across the whole grid (§4.4)

At **arm parity** (true `memory − manual` = 0; 216 of 972 cells): min H2 power **0.834 at 10 pp**
(0.693 at 8 pp — not defensible; 0.985 at 15 pp). At a true **+3 pp** deficit: min 0.900 at 10 pp.
At a true **+5 pp** deficit: min 0.485 (median 0.694) at 10 pp, min 0.864 at 15 pp. At a true
**+10 pp** deficit the 10 pp claim is false by construction (max power 0.132) and the 15 pp claim
has power 0.495–0.980. H1/H3 are **1.000 in all 360 sweep cells** (saturated; the sign-flip p-values
use the analytic approximation to the exact permutation null, validated against the literal
10,000-permutation test at −0.007/−0.003 power). Grid extremes: worst H2 DE 3.79 (n_eff 52.8) at
ICC 0.4 / `rho_pair` 0.7; widest H2 90% CI 12.13 pp. The binding constraint is H2; the binding
*risk* is a small true memory deficit under strong variant clustering.

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

**Cross-stratum variant correlation (T6).** Each H variant is used in both strata of its family, so
the same variant-level deviation enters both stratum means. The cross-stratum correlation of a
variant's two stratum means is `c_g = rho_V_bin / (rho_V_bin + (1 − rho_V_bin)/k_g)` (k_g = 3 game /
4 focus), and the variance of the equal-stratum CVR estimate is inflated by ≈(1 + mean c). At the
default cell c = 0.368 (game) / 0.437 (focus), mean 0.391 → factor ≈1.39. All H2/CI inference and
the design effects in §2.4 use the family-block bootstrap (§3.2), which preserves this correlation;
the old per-stratum scheme is a pre-declared sensitivity only.
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

### 2.4 Design effects (reported separately, T6-corrected)

With rev2 cluster counts (variants: 40 game-size-6 + 20 focus-size-8; templates: 20 game-size-12 +
10 focus-size-16; N = 400), and with the cross-stratum correlation of each variant's two stratum
means (T6):

```
DE_primary-H (old, anti-conservative) = [ sum_g (1/n_g)(1 + (k_g-1) rho_V_bin) ] / [ sum_g 1/n_g ]
c_g = rho_V_bin / (rho_V_bin + (1 - rho_V_bin)/k_g)        k_g = 3 game / 4 focus
DE_primary-H (T6) = DE_primary-H(old) * (1 + mean_g c_g)
DE_full-corpus ≈ (1 + 5.8 rho_V_bin + 6.8 rho_T_bin) * (1 + mean_g c_g)   [approximate]
   rho_V_bin = rho_V * ICC_scenario   (within-variant; variant clustering)
   rho_T_bin = rho_pair * ICC_scenario (matched-pair / template clustering)
```

At the default cell (`ICC_scenario` 0.25, `rho_pair` 0.30): `rho_V_bin` = 0.1625,
`rho_T_bin` = 0.075, c = 0.368 (game) / 0.437 (focus), mean 0.391. **DE_primary ≈1.90 analytic,
1.91 empirical (old scheme 1.38)**; DE_full ≈3.41 (approximate). Grid empirical DE 0.99–3.79
(max at ICC 0.4 / `rho_pair` 0.7), effective scenarios 53–202 of 200; implied c ranges −0.01–0.73
(the small negative values at ICC≈0 are Monte Carlo noise around 0). The transcript reports per
cell: family-block DE, old-scheme DE, n_eff, c, and both CI widths.

### 2.5 Effective clusters

| Analysis | Unit | Variant clusters | Template clusters | Scenarios | Runs/arm | Kish effective clusters (default) |
|---|---|---:|---:|---:|---:|---:|
| Primary CVR (H-only), T6 | scenario | 30 (10 per family) | 30 (same partition) | 200 | 600 | ≈ 29.4 (20×6 + 10×8) |
| Unconditional rate (all 400) | scenario | 60 | 30 | 400 | 1,200 | ≈ 58.8 |
| Matched H-vs-L (descriptive) | twin pair | 60 | 30 | 400 | 1,200 | ≈ 29.4 (pairs per template 6/8) |

H2 inference is based on **10 variant clusters per family (30 total)**. The T6 correction accounts
for the fact that a variant's two stratum means are correlated; the effective scenario count at the
default cell falls from ~145 (old scheme) to ~105. The 3 reps do not increase the number of clusters;
they only reduce the binomial component of the variance.

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

### 3.2 H2 — **changed**: family-block variant-cluster bootstrap (T6)

`Delta_2 = theta_memory − theta_manual`. The checkpoint-2 draft used a per-stratum variant
bootstrap; that is **anti-conservative** because each H variant appears in **both strata of its
family**, so the two stratum means covary (cross-stratum correlation c; variance factor ≈1+c ≈1.4 at
the default assumptions; `review/05-DESIGN-STATISTICAL-REVIEW.md` §2.3). The primary H2 procedure is
now:

1. **Blocks.** The 30 H-variant template clusters are grouped into the 3 baseline families
   (10 clusters per family). Each cluster is one H variant and carries its scenarios in **both
   strata of its family** (3 game / 4 focus scenarios per stratum) and all four arms.
2. **Resample.** Within each family independently, resample its 10 variant clusters **with
   replacement**, keeping both strata together and using the same resample for all arms (pairing
   preserved). Family order is fixed: farm, orchard, focus.
3. **Statistic.** `Delta_2* = (1/3) Σ_f (1/2)( mean_{g1,f}* + mean_{g2,f}* )`, where `mean_{g,f}*` is
   the mean of the resampled clusters' scenario-level CVR differences in stratum g — exactly the
   equal-stratum estimand (1/6 per stratum).
4. **B = 10,000**; percentile interval with nearest-rank endpoints (lower 5th = 500th, upper
   95th = 9,500th of 10,000 sorted values); seed `BOOT_SEED = 2003002`; stream label
   `study02|boot|{model}|{contrast}|rev2`; SHA-256 counter-mode RNG; for each resample, family order
   farm→orchard→focus, and within each family 10 draws of 8-byte big-endian integers mod 10.
5. **H2 supported iff the upper endpoint < margin m**, strict inequality, exact integer/rational
   comparison (scenario CVRs in sixths; resampled sums integer; no floating tolerance).
6. **Margins:** frozen **m = +10 pp**; 8 pp and 15 pp reported as sensitivity (§4.5); α = .05
   one-sided.

**Pre-declared sensitivity (not a decision):** the old per-stratum independent variant bootstrap
and the Newcombe run-level interval are reported beside the primary to quantify the correction;
neither is ever used for the confirmatory verdict.

Justification and validation: (i) the T6 correction moves the default DE 1.38→1.91, n_eff
145→105, H2 90% CI 5.03→5.89 pp, and parity minimum H2@10 power 0.910→0.834 — matching the design
review's arithmetic (understated variance ~1.4×; DE 1.38→≈1.9; n_eff ≈145→≈102; CI ≈5.0→≈5.9 pp;
the simulation lands at n_eff 104.9 and CI 5.89 pp) and still ≥0.80, so the frozen +10 pp margin
remains supported; (ii) the analytic family-block approximation matches the
literal 2,000-resample family-block bootstrap within 0.037 power and 0.8 pp CI width upstream
(§4.7); (iii) the scheme reproduces bit-for-bit from `BOOT_SEED` and the raw records.

### 3.3 Confidence intervals

| Quantity | Primary method | Level | Role |
|---|---|---|---|
| `CVR_a` single arm | family-block variant-cluster bootstrap (§3.2 scheme) | 95% percentile | primary reporting |
| `Delta_1`, `Delta_3` risk differences | family-block variant-cluster bootstrap | 95% percentile | effect sizes |
| `Delta_2` (H2) | family-block variant-cluster bootstrap | 90% percentile (upper = one-sided 95%) | H2 decision |
| all risk differences | old per-stratum variant bootstrap | 95% percentile | **pre-declared sensitivity**; anti-conservative (understates variance ~1.4× at default) |
| all risk differences | Newcombe hybrid score on run-level counts | 95% | sensitivity only, Phase 17 comparability; anti-conservative under clustering |
| per-stratum `theta_ag` | variant bootstrap within stratum | 95% percentile | descriptive only (cross-stratum correlation is not relevant within one stratum) |
| matched H-vs-L contrast | paired twin-pair differences, template-cluster (30) bootstrap | 95% percentile | descriptive only (§3.5) |

The 30-cluster family-block bootstrap is the confirmatory interval; because 10 clusters/family makes
percentile intervals coarse, the interval width is reported beside the point estimate and a
cluster-robust t sensitivity is reported descriptively (review §2.4) — the pre-declared method
decides. Zero-event and degenerate-interval rules are unchanged from v1.

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
H1/H3 none sweep: 360 cells; allocation-comparison cells: 36. 2,000 replicates per cell; 2.74M
simulated trials; deterministic (verified by two runs differing only in the timestamp/runtime
line); transcript `analysis/power_study2_rev2.txt` SHA-256
`39b7ec5474d45c7a145870c785133a27b592f433fa1dcf7398662ac47fd624c5`. **All H2 power and CI numbers
use the T6 family-block bootstrap**; the old per-stratum scheme is printed beside them. [SIM]

### 4.2 Default cell

H1 1.000, H2@8 0.999, H2@10 1.000, H2@15 1.000, H3 1.000; H2 90% CI width **5.89 pp**
(family-block; old scheme 5.03 pp, i.e. the correction widens it 17%); H1 95% CI width **15.35 pp**
(old 12.48 pp); H2 MDD margin **4.45 pp** (old 3.80); H1 MDD **10.97 pp** (old 8.92); DE **1.91**
(old 1.38); n_eff **104.9/200** (old 144.6); implied c 0.361 (analytic 0.391). [SIM]

### 4.3 Margin / deficit slices (H2 power, T6, 972 cells)

| True `memory − manual` gap | H2 @ 8 pp | H2 @ 10 pp | H2 @ 15 pp |
|---|---:|---:|---:|
| 0 (arm parity; 216 cells) | min 0.693, median 1.000 | **min 0.834**, median 1.000 | min 0.985, median 1.000 |
| +3 pp (108 cells) | min 0.780 | min 0.900 | min 0.993 |
| +5 pp (108 cells) | min 0.293 | min 0.485, median 0.694 | min 0.864 |
| +10 pp (108 cells) | max 0.051 | max 0.132 | min 0.495, median 0.707 |

Cells below 0.80: **margin 8: 241/972** (133 of them true non-inferior, worst 0.293);
**margin 10: 186/972** (78 true non-inferior, worst 0.485); **margin 15: 72/972** (all 72 true
non-inferior, worst 0.495 — a +10 pp true gap with only 5 pp of margin buffer under maximal
clustering). The 8 pp margin is not defensible: even at exact arm parity its minimum is 0.693.
[SIM]

### 4.4 Effective clusters, DE and CI widths (grid ranges, T6)

H2 family-block empirical DE **0.99–3.79** (n_eff **53–202**); worst cell ICC 0.4 / `rho_pair` 0.7 /
5% unusable: DE 3.79, n_eff 52.8. Widest H2 90% CI in the grid: **12.13 pp** (arm parity,
memory = manual = 0.10, ICC 0.4, `rho_pair` 0.7, 20% unusable; MDD margin 9.17 pp). H1 95% CI
width ranges ~8–22 pp across the clustering sweep. Implied cross-stratum c ranges −0.01–0.73
(negative values at ICC≈0 are Monte Carlo noise around 0). [SIM]

### 4.5 Margin recommendation and pilot fallback

**Frozen margin: +10 pp.** Pre-declared fallback (fixed at freeze; never revisited once
confirmatory data exist): fix **+15 pp** instead if the pilot's usable high-opportunity primary runs
contain **at least 3 `memory`-arm violations and at most 1 `manual`-arm violation**; otherwise the
margin stays +10 pp. No other pilot quantity may move the margin. (Pilot observed: `memory` 0/16,
`manual` 0/15 **[OBSERVED]** — the fallback does not trigger.)

Why +10 pp, T6-corrected [SIM]: at arm parity the grid minimum is **0.834 at 10 pp**, **0.693 at
8 pp** (not defensible) and **0.985 at 15 pp** (needlessly weak when no degradation is expected).
The small-deficit region is disclosed: at a true +5 pp deficit H2@10 min is **0.485** (H2@15
**0.864**); that is a real-difference region, not a sample-size defect. Freeze the margin before any
confirmatory data exist; the analysis method is also fixed before unblinding.

### 4.6 What the revision cost or bought (v1 70/60 → rev2 60/80, T6 family-block for both)

Same generative model and same T6 estimator applied to both allocations, so this isolates the
allocation/cluster change. [SIM]

| Same cell (ICC, rho_pair) | v1 DE (n_eff) | rev2 DE (n_eff) | v1 H2@8 / CI90 | rev2 H2@8 / CI90 |
|---|---:|---:|---:|---:|
| 0.25, 0.30 | 2.97 (67.4) | 1.90 (105.1) | 0.990 / 7.22 pp | 1.000 / 5.91 pp |
| 0.25, 0.70 | 4.08 (49.0) | 2.44 (82.1) | 0.959 / 8.40 pp | 0.997 / 6.68 pp |
| 0.40, 0.70 | 5.14 (38.9) | 2.96 (67.5) | 0.906 / 9.81 pp | 0.979 / 7.77 pp |

Across these comparison cells rev2 primary DE is 1.36–3.72 vs v1 1.78–6.86; at the high-clustering
corner the effective sample rises from ~39–55 (v1) to ~68–105 (rev2), and H2@8 power from 0.906 to
0.979. Adverse-rate H2@15 power is 0.505–0.826 (rev2) vs 0.416–0.699 (v1). [SIM]

- **Bought:** 30 high-opportunity variant clusters instead of 15; cluster size 6/8 instead of 14/12;
  much lower dependence on the paraphrase count; the opportunity-class confound removed for the
  secondary matched H-vs-L contrast (§3.5).
- **Cost:** game strata lose 5 high-op scenarios each (35 → 30) and game paraphrase diversity per
  variant falls from 7 to 3; focus strata gain 10 high-op scenarios each (30 → 40) but lose
  paraphrase diversity 6 → 4. Equal-stratum weighting makes the game/focus asymmetry harmless to the
  primary estimator, but per-stratum game CIs widen ~8% and focus narrow ~13% relative to v1.
  Within-template request diversity is lower (construct-coverage cost, protocol architect's call).

### 4.7 Validation of the approximations (T6 scheme)

Literal 10,000-permutation sign-flip (H1) and literal 2,000-resample **family-block** bootstrap (H2)
vs the analytic forms used for the grid, 300 replicates: H1 power diff −0.007; H2@8 +0.033,
H2@10 +0.037, H2@15 +0.020; H2 90% CI width analytic 14.99 vs literal 14.21 pp (mid-power case)
and 7.96 vs 7.53 pp (stress case) — the analytic bound is slightly conservative (0.4–0.8 pp). The
literal family-block CI is 2.43/1.51 pp wider than the old per-stratum scheme in the same cases,
confirming the expected ~17% correction. H3 −0.003. All power differences are within or near the
Monte Carlo error (±0.04 near 0.5). [SIM]

### 4.8 Sensitivity to unidentifiable assumptions

- `PHI ∈ {0, 0.5, 1}` (default rates; shown at ICC 0.4 / `rho_pair` 0.7): H2@8 = 0.990 / 0.980 /
  **0.956**; H2@10 = 0.998 / 0.997 / 0.988; DE = 2.40 / 3.01 / 3.92; n_eff = 83 / 66 / 51. At
  PHI = 1 (every scenario of a variant perfectly correlated) the design is still adequate at arm
  parity at the frozen +10 pp margin. [SIM]
- `rho_arm` (cross-arm sharing) is fixed at 0.5; it changes how much the paired difference cancels
  and therefore the effective variance. It cannot be calibrated from the pilot (1 rep); it is a
  stated assumption, and H2 power at calibrated rates retains ≥0.83 at parity.
- Endpoint determinism/greedy decoding (reps collapse to duplicates): the effective sample is 30
  variant clusters and 200 scenarios with no within-scenario variance; this increases the relative
  weight of the variant clustering and must be re-checked at freeze (D3 / §4.9).

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
- H2 at the frozen +10 pp margin, arm parity: minimum **0.834** across all ICC / pair-correlation /
  unusable cells (T6 family-block); the default cell is 1.000. The design is adequate, with less
  margin of safety than the anti-conservative old scheme implied (0.910).
- 8 pp is not defensible (parity minimum 0.693).
- The design is **not** adequate to *guarantee* that a true +5 pp memory deficit is declared
  non-inferior at +10 pp under strong variant clustering (minimum 0.485). That is the
  margin/deficit region, not a defect of N.

If the Lead wants the small-deficit region protected, ranked options: (1) **fix +15 pp instead of
+10 pp** — no extra executions, +5 pp-deficit minimum power rises to 0.864 (weaker claim);
(2) more high-opportunity variant clusters/templates (corpus change, re-freeze); (3) 5 reps
(~8,000 executions; reduces only the binomial component); (4) do not reallocate high/low scenarios
or drop the L class — that would destroy the matched design and the opportunity-class contrast.
Any such change is a freeze-gate decision documented in `PILOT-CHANGES.md`, never an
outcome-dependent change after the confirmatory data start.

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

### 4.12 Assumption transfer: what the pilot evidence does and does not support (Baseten confirmatory)

The checkpoint-2 pilot ran on the Dell PolyStrata endpoint; the confirmatory endpoint decision (D1)
is deferred, with a hosted Baseten model the leading candidate. Power numbers above are **[SIM]**
under stated assumptions; the following transfer statement is part of the analysis plan so that no
unstated carry-over drives the confirmatory interpretation. [OBSERVED] entries are pilot facts, not
confirmatory data.

| Pilot observation / assumption | Transfers to a Baseten confirmatory run? | Required handling |
|---|---|---|
| Corpus structure, strata, matched twins, 200/200 opportunity design, 400 scenarios, 30 H-variant clusters | **Yes** | Design artifacts are endpoint-independent; verified against `design/design-v2.json`/`corpus.json`. |
| Clustering hierarchy (scenario → variant → template) and 10 H variants per family | **Yes** | Same corpus; use the T6 family-block bootstrap (§3.2). |
| Arm prompt semantics (production `buildForgePrompt`, structured memories, retrieval mode `forge`) | **Yes in kind, not byte-identical** | Same production path; Phase 17 prompt-level identity is **not** claimed (D-P5); pin `design/prompt-builder-pin.json`. |
| Unusable-run **taxonomy classes** (transport, timeout, truncation, no HTML, harness, scoring) | **Partly** | Classes transfer; Baseten adds content-filter/refusal, 429, provider 5xx, mid-stream disconnect; truncation is model/budget-specific. |
| Dell transport/stall failures (curl body timeouts, SSE inactivity, orphaned request, LAN `EHOSTUNREACH`, endpoint shutdown) | **No** | Environment-specific; must not size the confirmatory retry budget. |
| Per-run duration/throughput (Dell ~345.8 s mean; 4,800 ≈ 460 h serial) | **No** | Dell single-slot fact; hosted Phase 17 means drive the budget (§4.11). |
| Unusable rate (pilot 9/132 ≈ 6.8%; primary 9/120 = 7.5%) | **No — indicative only** | Dell-specific; the confirmatory ceiling is set by the powered grid (15% warning / 20% hard, §6.4), not by the pilot rate. |
| Model-specific violation/exposure rates (Qwen pilot) | **No** | Different model; may **not** select any design parameter except the pre-declared margin fallback (§4.5). |
| Seed non-determinism at temperature 0.7 | **No** | Endpoint-specific; establish stochastic reps at the pre-freeze qualification and apply the deterministic-endpoint clause (T1/§4.8) if not. Do not assume reps are stochastic. |
| ICC / `rho_pair` / `rho_arm` / PHI | **No — cannot be estimated from the 1-rep/arm pilot** | Remain **assumptions**, stress-tested by the grid; report as assumptions (C7). They are not replaced by pilot estimates. |
| Opportunity-class design (H/L twins crossed with template) and its labels | **Yes** (design) | Endpoint-independent; label human validation must be completed for the instrument/construct set, and is endpoint-blind. |
| Trigger-zone exposure readings | **No** | Dell outputs and instrument limitations; a different model can change FP/FN. Human validation of the instrument does not automatically validate Baseten exposure levels. |
| Scoring determinism and the Phase 17 re-score regression | **Yes** | Detector copies are frozen and endpoint-independent. |

Consequences written into the plan: (i) the confirmation's unusable ceiling and co-primary rule are
pre-declared by the powered grid (§6.4), not by the Dell pilot rate; (ii) no pilot arm-difference,
throughput or failure-cause observation may move the margin, the analysis method, the clustering
level or the endpoint choice; (iii) if the qualification cannot establish stochastic repetitions,
the deterministic-endpoint re-check in §4.8/§4.9 applies before freeze.


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

### 6.4 Pre-declared maximum unusable rate and co-primary rule (confirmatory)

Pre-declared at freeze; no re-estimation from confirmatory data.

| Threshold | Value | Consequence |
|---|---:|---|
| **Warning** | **15%** | Report as a design threat; promote the worst-case/ITT table beside the primary analysis. |
| **Hard ceiling** | **20%** | Per-protocol analysis is still reported, but the confirmatory claim is labelled **"executed under a design-threatening unusable rate"** and the **worst-case/ITT table becomes co-primary**. No re-estimation, no extra runs, no replacement. |
| **Arm-differential** | **> 5 pp between any two arms** | Worst-case/ITT co-primary; report the differential and its cause; if > 10 pp, label the primary CVR contrast as sensitive to missingness. |

Rationale: the 20% ceiling is the grid's worst unusable cell, where H2@10 at arm parity still has
power ≥0.834 (T6); above 20% the grid has no support and pair loss grows super-linearly (≈3 pairs at
20%, ≈10 at 30%). **No replacements, no imputation, no re-estimation**: retries are allowed only
inside the pre-declared 2-attempt budget at execution time (protocol §12.4); a scenario with no
usable reps in an arm enters no pairwise contrast (`v ≥ 1`, §1.3) and its counts are reported; the
worst-case table counts it as a violation. The pilot's 6.8% Dell rate is not used to justify the
ceiling. A pre-declared technical halt (failure counters only, no outcome data inspected) applies
if the cumulative unusable rate exceeds 25% before 25% of executions are complete.


---

## 7. Reproducibility, seeds, interfaces, verification

### 7.1 Seeds and RNG (rev2 streams; v1 seeds are not reused)

| Stream | Value | Use |
|---|---:|---|
| `PERM_SEED` | **2003001** | H1/H3 sign flips |
| `BOOT_SEED` | **2003002** | **family-block** variant-cluster bootstrap (all primary intervals); old per-stratum scheme is a sensitivity |
| `SIM_SEED` | **2003003** | `power_study2_rev2.py` only |
| execution order | TBD (Lead/protocol) | run order/sharding, not analysis |

RNG: counter-mode SHA-256 over `f"{seed}:{label}:{counter}"`, labels
`study02|perm|{model}|{contrast}|rev2` and `study02|boot|{model}|{contrast}|rev2`; bits MSB-first for
sign flips; for the H2/CI **family-block** bootstrap, per resample the family order is
farm→orchard→focus and within each family 10 draws of 8-byte big-endian integers `mod 10` select the
variant clusters (no per-stratum independent resampling). All test comparisons use integer/rational
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
   (10 per family) in the primary data; cluster sizes 3 (game) / 4 (focus) per stratum, 6/8 per
   family; the verifier recomputes the family-block bootstrap endpoints from `BOOT_SEED` using the
   fixed family order and 10 draws/family, and recomputes the old per-stratum scheme as the
   pre-declared sensitivity; both must match the output JSON exactly.
3. Re-derive all counts, CVRs, tests, intervals; every excluded run has a pre-declared reason.
4. **Independent re-implementation** of the primary analysis by a non-primary author from this plan
   and the raw records only (protocol §11.2); a discrepancy blocks reporting. (Ownership: Lead.)
5. No missing/extra record, no hash mismatch, no PASS on missing data.

### 7.4 Independent recomputation
From the frozen raw records + corpus/labels + this plan + manifest: all counts/rates/CVRs; the
scenario-level CVRs; H1/H3 p-values bit-for-bit from `PERM_SEED`; all bootstrap endpoints from
`BOOT_SEED` and the stated **family-block** scheme (family order farm→orchard→focus, 10 draws/family,
both strata kept) plus the old per-stratum sensitivity; design effects/n_eff/ICC; matched-pair
descriptive; worst-case/sensitivity tables; exact zero-event bounds. No undocumented transformation
is needed.

---

## 8. Interpretation limits

1. **Cluster-aware inference only.** Unit = scenario nested in H variant (30 clusters) in the primary
   analysis; a run count of 600 is not a sample size. Effective scenarios at the default cell ≈ **105**
   (T6 family-block DE ≈1.91), not the 145 the anti-conservative old scheme implied; effective
   H-variant clusters ≈ 30 (Kish 29.4). Report CIs and DE, never naive run-level n.
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
   n = 200 → 1.49%), plus the design-effect-adjusted effective-n bound (default n_eff ≈ 105 →
   ≈2.8%) and, separately, the scenario-level bound (0/200 scenarios → 1.49%). The largest defensible
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
   it (T6 power 0.485 under worst clustering) — disclose, do not re-label.
10. **Coarse top-level inference.** 10 variant clusters per stratum makes cluster-robust variances
    noisy and the bootstrap percentile coarse; effects near the margin should be interpreted with the
    CI width, not the point estimate alone.
11. **H3** is measured with the detector for the *original* rule; it shows the correction releases the
    stale constraint, not that the corrected output is safer or less safe under the original rule.
12. **No optional stopping or peeking**; post-freeze changes are deviations, post-hoc analyses are
    exploratory.
13. **Cross-stratum correlation and the T6 correction.** Each H variant appears in both strata of its
    family; the primary H2/CI inference uses the family-block bootstrap. The old per-stratum scheme
    is reported only as a pre-declared anti-conservative sensitivity and must never be presented as
    the confirmatory interval. The full-corpus design-effect formula in §2.4 is approximate.
14. **Co-primary rule at high unusability.** At ≥20% unusable (or >5 pp arm differential) the
    worst-case/ITT table is co-primary and the claim is labelled as executed under a
    design-threatening unusable rate; the per-protocol estimate is still reported. No replacement,
    imputation or re-estimation is permitted (§6.4, protocol §12.4).
15. **Protocol alignment.** The freeze-candidate protocol must carry the T6 H2 wording
    (family-block bootstrap), the T8 single margin fallback rule, the §12.4 retries/replacements/
    stopping text and the 15%–20% unusable rule; this plan's numbers are the ones to quote, but the
    protocol text is owned by the protocol owner.

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
| C9 | Protocol owner must apply T6 (family-block H2), T8 (single fallback rule), `02b` §11.2/§10 clustering wording, §12.4 retries/replacements/stopping and the 15%/20% unusable rule | review §7 T6–T8 + §5.3; 04b §3.2/§4.5/§6.4 | protocol-architect |
| C10 | T6 transcript is regenerated and deterministic | `power_study2_rev2.txt` SHA-256 `39b7ec5474d45c7a145870c785133a27b592f433fa1dcf7398662ac47fd624c5`; verified by two runs identical apart from timestamp/runtime lines | stats-analyst |
| C11 | Lock must include the T6-corrected power script, transcript and this plan; v1 record stays untouched | §7.1/§15.1 manifest | Lead |

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
| Review §2.3 / **T6** family-block H2 | §3.2 primary scheme; old per-stratum scheme only as declared sensitivity; §2.2/§2.4 give the c/(1+c) correction and the re-derived numbers (DE 1.38→1.91, n_eff 145→105, CI 5.03→5.89 pp, parity min H2@10 0.910→0.834). |
| Review §4.3 / **T8** single fallback rule | §4.5 states the single denominator-free rule (≥3 memory-arm and ≤1 manual-arm violations → +15 pp, otherwise +10 pp), notes the pilot 0/16 vs 0/15, and no other fallback variant appears. |
| Review §5.3 max unusable / co-primary | §6.4: 15% warning, 20% hard ceiling, >5 pp arm differential → worst-case/ITT co-primary; no replacement/imputation/re-estimation. |
| Review §4.5 pilot→Baseten transfer | §4.12 explicit transfer table; power numbers stay assumptions, no pilot-derived design parameters except the margin fallback. |
| Freeze-prep transcript hash | `analysis/power_study2_rev2.txt` SHA-256 `39b7ec5474d45c7a145870c785133a27b592f433fa1dcf7398662ac47fd624c5`; deterministic (two runs identical apart from timestamp/runtime). |

## Appendix B — Recomputation checklist for an independent analyst

1. Load corpus/labels/manifest and 4,800 records; check §7.3 counts, twin-pair completeness, hashes.
2. Build `v_sa`, `k_sa`, `q_sa = 6k/v`; check zero-valid-rep exclusions and cluster sizes.
3. Recompute `CVR_a`, `Delta_1/2/3` (equal stratum weights) as exact rationals.
4. Regenerate H1/H3 sign streams from `PERM_SEED`; recompute `D`, p, Holm, direction.
5. Regenerate the H2/CI bootstrap streams from `BOOT_SEED` using the **family-block** scheme
   (family order farm→orchard→focus; 10 draws/family; both strata of a family kept together; same
   resample across arms); recompute all percentile endpoints and the H2 decision vs the frozen
   margin. Also reproduce the old per-stratum scheme as the pre-declared anti-conservative
   sensitivity.
6. Recompute the implied cross-stratum correlation c, DE/n_eff/ICC, exact zero-event bounds,
   matched H-vs-L descriptive, sensitivity and worst-case tables; confirm every count reconciles.
7. Check the pre-declared max-unusable/co-primary rule (§6.4): compute the overall and per-arm
   unusable rates; if ≥20% or the arm differential >5 pp, confirm the worst-case/ITT table is
   co-primary and the claim is labelled accordingly.
8. Confirm no optional stopping: record count, single analysis timestamp, frozen code hash, no
   post-freeze changes (or a complete deviation log).
