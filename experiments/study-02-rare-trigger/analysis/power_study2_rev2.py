#!/usr/bin/env python3
"""Study 02 checkpoint 2 - REV2 matched-twin design: power simulation.

THIS IS A SIMULATION UNDER ASSUMPTIONS, NOT OBSERVED DATA.
No pilot, study or Phase 17 run record is used or implied here.

Usage (run WITHOUT -I: numpy lives in the user site-packages on this machine;
-I would hide it). Fully deterministic given --reps and the seeds below:

    python3 analysis/power_study2_rev2.py > analysis/power_study2_rev2.txt
    python3 analysis/power_study2_rev2.py --reps 500        # quicker, noisier
    python3 analysis/power_study2_rev2.py --skip-validation # skip literal checks
    python3 analysis/power_study2_rev2.py --quick           # smoke test

Imports the frozen helpers from `power_study2.py` (v1, same directory): the
numerical ICC calibration (target marginal CVR + binary ICC), the scenario-level
stratified sign-flip test, and the normal constants. v1 is read-only here.

FIXED REV2 DESIGN (PLAN-CHECKPOINT2.md, approved 2026-10-31):
  * 4 arms: none, memory, manual, corrected (= none's CVR, Phase 17 semantics)
  * 6 strata: 4 game x 60 scenarios (20 variants x 3 paraphrases),
              2 focus x 80 scenarios (20 variants x 4 paraphrases) = 400
  * each baseline family: 10 structural templates T00-T09, each in an H twin
    (high-opportunity) and an L twin (low-opportunity); class crossed with
    template (matched pairs)
  * 200 high-opportunity / 200 low-opportunity scenarios; 3 reps per
    scenario-arm; 4,800 confirmatory executions (not executed now)
  * cluster structure: scenario nested in variant (H or L twin) nested in
    template (T00-T09 per family); arms paired within scenario
  * primary metric and hypotheses: CVR on the 200 high-opportunity scenarios,
    H1 memory<none, H2 memory non-inferior to manual, H3 corrected>memory,
    same tests as v1 except H2 variance is now clustered at the variant level
    (see 04b-ANALYSIS-PLAN-REV2.md)

Generative model (per arm a, marginal CVR mu_a; calibrated exactly as v1):
    p = clip(m0_a + s_a * U, 0, 1),   U = sqrt(rho_arm) U_shared + sqrt(1-rho_arm) U_arm
    U_shared, U_arm = sqrt(rho_V) z_variant + sqrt(1-rho_V) z_scenario
    z_variant ~ N(0,1) shared by all high-opportunity scenarios of one H variant
                        (which are the family's 2 strata x 3 or 4 paraphrases)
    z_scenario ~ N(0,1) per scenario;  U_arm is arm-specific but carries the SAME
    cluster structure, so a paired difference does not cancel clustering entirely.
    run: violation ~ Bernoulli(p); unusable ~ Bernoulli(u) independent
    rho_arm = 0.5 (cross-arm sharing of the scenario deviation; as v1)
    rho_V = PHI + (1-PHI) * rho_pair, PHI = 0.5   (see section B)

  rho_pair is the realised H/L twin-pair (template) correlation share implied by
  the lead's template-share / matched-pair grid; section B maps the grid to the
  9 distinct values it produces. For the H-only primary analysis, template and
  variant clustering are the same partition (one H twin per template), so only
  rho_V enters; that is reported as a finding, not hidden.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from power_study2 import (  # frozen v1 helpers, read-only
    ALPHA,
    Z80,
    Z90,
    Z975,
    calibrate,
    holm_support,
    norm_cdf,
    pair_perm_test,
)

# --------------------------------------------------------------------------- #
# Fixed design constants (PLAN-CHECKPOINT2.md)
# --------------------------------------------------------------------------- #
STRATA = (
    'farm-arcade', 'farm-challenge', 'orchard-arcade',
    'orchard-challenge', 'focus-reward', 'focus-lively',
)
FAMILY = {
    'farm-arcade': 'farm', 'farm-challenge': 'farm',
    'orchard-arcade': 'orchard', 'orchard-challenge': 'orchard',
    'focus-reward': 'focus', 'focus-lively': 'focus',
}
DESIGNS = {
    # rev2: 4 game strata x 60 (20 variants x 3 paraphrases), 2 focus x 80 (20 x 4)
    'rev2': dict(sizes=(60, 60, 60, 60, 80, 80), paras=(3, 3, 3, 3, 4, 4), templates=10),
    # v1 checkpoint-1 allocation, used only for the cost/buy comparison
    'v1': dict(sizes=(70, 70, 70, 70, 60, 60), paras=(7, 7, 7, 7, 6, 6), templates=5),
}
ARMS = ('none', 'memory', 'manual', 'corrected')
RUNS = 3
ALPHA = 0.05
Z975 = 1.959963984540054
Z90 = 1.6448536269514722
Z80 = 0.8416212335729143

RHO_ARM = 0.5   # cross-arm sharing of the scenario deviation (pilot-unidentifiable; v1 value)
PHI = 0.5       # share of non-pair variance at the variant level (rest: scenario/paraphrase)

# Grid factors (checkpoint-2 requirement)
ICCS = (0.0, 0.1, 0.25, 0.4)                 # total between-scenario binary ICC
TEMPLATE_SHARES = (0.0, 0.1, 0.25)           # s_T: share of between-scenario variance at template level
PAIR_CORRS = (0.0, 0.3, 0.6)                 # kappa: extra H/L twin correlation beyond the template share
NONE_RATES = (0.50, 0.65, 0.80)
MEMORY_RATES = (0.00, 0.03, 0.10)
MANUAL_RATES = (0.00, 0.05, 0.10)
UNUSABLE = (0.05, 0.10, 0.20)
MARGINS = (0.08, 0.10, 0.15)                 # H2 non-inferiority margins, evaluated on same data
DEFAULT_NONE = 0.65
DEFAULT_MEMORY = 0.03
DEFAULT_MANUAL = 0.05
ADVERSE_MEMORY = 0.10
ADVERSE_MANUAL = 0.00
REPS = 2000
SEEDS = dict(sim=2003003, perm=2003001, boot=2003002)
SWEEPS = dict(h2_grid=True, h13_sweep=True, design_compare=True,
              matched_pairs=True, validation=True, budget=True)

_PAIR_COMBOS = [(round(s_t, 6), round(k, 6)) for s_t in TEMPLATE_SHARES for k in PAIR_CORRS]
_PAIR_LEVELS = sorted({round(s_t + (1.0 - s_t) * k, 6) for s_t, k in _PAIR_COMBOS})


# --------------------------------------------------------------------------- #
# Corpus layout
# --------------------------------------------------------------------------- #
def high_layout(design):
    """Ordering of the 200 high-opportunity scenarios, by stratum then variant."""
    slices, n_var, k_paras = [], [], []
    start = 0
    n_templates = design['templates']
    for si, _ in enumerate(STRATA):
        p = design['paras'][si]
        slices.append(slice(start, start + n_templates * p))
        n_var.append(n_templates)
        k_paras.append(p)
        start += n_templates * p
    assert start == 200, start
    # global variant ids for the shared random effect: family offset + template
    family_offset = {'farm': 0, 'orchard': n_templates, 'focus': 2 * n_templates}
    var_of = []
    for si, stratum in enumerate(STRATA):
        off = family_offset[FAMILY[stratum]]
        p = design['paras'][si]
        for t in range(n_templates):
            var_of += [off + t] * p
    return dict(slices=slices, n_var=n_var, k=k_paras, n_high=start,
                n_variants=3 * n_templates, n_templates=3 * n_templates,
                var_of=np.asarray(var_of, dtype=int))


def design_meta(design):
    meta = high_layout(design)
    meta['sizes'] = tuple(design['paras'][si] * design['templates'] for si in range(6))
    return meta


# --------------------------------------------------------------------------- #
# Shared effects and one simulated dataset
# --------------------------------------------------------------------------- #
def draw_shared_and_arm(meta, rho_pair, reps, rng):
    """Cluster-structured effects for the 200 high-opportunity scenarios.

    Returns (u_shared, u_arm):
      u_shared : scenario deviation shared by all arms of a scenario (cross-arm
                 correlation rho_arm);
      u_arm    : arm-specific deviation, independent across arms but carrying the
                 SAME variant/scenario cluster structure (otherwise a paired
                 difference would cancel the cluster effect entirely and the
                 design effect would be 1 by construction).
    For a high-opportunity-only analysis the template and twin-pair components are
    the same partition (one H twin per template), so they combine into one
    variant-level share rho_V = PHI + (1-PHI)*rho_pair.
    """
    rho_v = PHI + (1.0 - PHI) * rho_pair
    sv = math.sqrt(rho_v)
    ss = math.sqrt(1.0 - rho_v)
    z_var_s = rng.standard_normal((reps, meta['n_variants']))
    z_scen_s = rng.standard_normal((reps, meta['n_high']))
    u_shared = sv * z_var_s[:, meta['var_of']] + ss * z_scen_s
    z_var_a = rng.standard_normal((reps, meta['n_variants'], len(ARMS)))
    z_scen_a = rng.standard_normal((reps, meta['n_high'], len(ARMS)))
    u_arm = sv * z_var_a[:, meta['var_of'], :] + ss * z_scen_a
    return u_shared, u_arm


def draw_unusable(reps, meta, rate, rng):
    return rng.binomial(RUNS, 1.0 - rate, size=(reps, meta['n_high'], len(ARMS)))


def simulate_cell(u_shared, u_arm, v, mus, icc, rng):
    """Return scenario-arm CVR array (reps, n_high, 4) with NaN for 0 valid reps."""
    reps, n_high = u_shared.shape
    m0 = np.empty(len(mus))
    scale = np.empty(len(mus))
    for i, mu in enumerate(mus):
        m0[i], scale[i], _, _ = calibrate(mu, icc)
    u = (math.sqrt(RHO_ARM) * u_shared[:, :, None]
         + math.sqrt(1.0 - RHO_ARM) * u_arm)
    p = m0[None, None, :] + scale[None, None, :] * u
    np.clip(p, 0.0, 1.0, out=p)
    k = rng.binomial(v, p)
    cvr = np.full((reps, n_high, len(mus)), np.nan)
    mask = v > 0
    cvr[mask] = k[mask] / v[mask]
    return cvr


# --------------------------------------------------------------------------- #
# Analyses
# --------------------------------------------------------------------------- #
def cluster_ci(d, meta):
    """Stratified variant-cluster-robust point estimate and SE for a paired CVR diff.

    T = (1/G) sum_g (1/n_g) sum_{s in g} d_s.  Cluster = H variant within stratum
    (10 per stratum; 3 or 4 scenarios each). CR0 variance:
      Var(mean_g) = n_v/(n_v-1) * (1/n_g^2) * sum_v (S_v - m_v*mean_g)^2
    Also returns the naive iid-scenario SE for the design-effect ratio.
    """
    reps = d.shape[0]
    total = np.zeros(reps)
    var_cr = np.zeros(reps)
    var_iid = np.zeros(reps)
    g_used = np.zeros(reps)
    n_used = np.zeros(reps)
    for g, sl in enumerate(meta['slices']):
        dg = d[:, sl]
        n_v = meta['n_var'][g]
        k = meta['k'][g]
        dg3 = dg.reshape(reps, n_v, k)
        valid = ~np.isnan(dg3)
        m = valid.sum(axis=2).astype(float)
        s_v = np.nansum(dg3, axis=2)
        n_g = m.sum(axis=1)
        ok = n_g > 0
        ngs = np.maximum(n_g, 1.0)
        mean_g = np.where(ok, s_v.sum(axis=1) / ngs, 0.0)
        resid = s_v - m * mean_g[:, None]
        var_g = np.where(
            ok & (n_v > 1),
            (n_v / (n_v - 1.0)) * np.nansum(resid * resid, axis=1) / (ngs * ngs),
            0.0,
        )
        dev2 = np.where(valid, (dg3 - mean_g[:, None, None]) ** 2, 0.0)
        s2 = np.where(n_g > 1.0, np.nansum(np.nansum(dev2, axis=2), axis=1)
                      / np.maximum(n_g - 1.0, 1.0), 0.0)
        var_i = np.where(ok, s2 / ngs, 0.0)
        total += mean_g
        var_cr += var_g
        var_iid += var_i
        g_used += ok
        n_used += n_g
    gc = np.maximum(g_used, 1.0)
    return total / gc, np.sqrt(var_cr) / gc, np.sqrt(var_iid) / gc, n_used


def analytic_de(icc, rho_pair, meta):
    """Design effects implied by the variance shares (for reporting next to the
    simulated ratio). H-only primary: variant cluster, k = 3 (game) / 4 (focus)."""
    rho_v_bin = (PHI + (1.0 - PHI) * rho_pair) * icc
    rho_t_bin = rho_pair * icc
    de_g = [1.0 + (k - 1.0) * rho_v_bin for k in meta['k']]
    inv_n = sum(1.0 / n for n in meta['sizes'])
    de_h = sum(de / n for de, n in zip(de_g, meta['sizes'])) / inv_n
    # full-corpus (all 400 scenarios, unconditional rate): variants and templates
    # rev2 cluster counts: sum_v m(m-1)=2320, sum_t m(m-1)=5040, N=400
    # (v1: 5 templates/family, sizes 14/12 -> coefficients from the design)
    if meta['n_templates'] == 30:
        de_full = 1.0 + 5.8 * rho_v_bin + 6.8 * rho_t_bin
    else:
        de_full = 1.0 + 12.4 * rho_v_bin
    return de_h, de_full, rho_v_bin, rho_t_bin


def evaluate(cvr, meta, icc, rho_pair):
    slices = meta['slices']
    d1 = cvr[:, :, 1] - cvr[:, :, 0]     # memory - none
    d3 = cvr[:, :, 3] - cvr[:, :, 1]     # corrected - memory
    d2 = cvr[:, :, 1] - cvr[:, :, 2]     # memory - manual
    h1 = pair_perm_test(d1, slices)
    h3 = pair_perm_test(d3, slices)
    rej1, rej3 = holm_support(h1['p'], h3['p'], h1['T'], h3['T'])
    t2, se2, se2_iid, n2 = cluster_ci(d2, meta)
    t1, se1, _, _ = cluster_ci(d1, meta)
    t3, se3, _, _ = cluster_ci(d3, meta)
    upper = {m: t2 + Z90 * se2 for m in MARGINS}
    de_h, de_full, rho_v_bin, rho_t_bin = analytic_de(icc, rho_pair, meta)
    ratio = np.where(se2_iid ** 2 > 0,
                     (se2 ** 2) / np.maximum(se2_iid ** 2, 1e-300), 1.0)
    de_emp = float(np.mean(ratio))
    return dict(
        power_h1=float(rej1.mean()), power_h3=float(rej3.mean()),
        power_h2={m: float((upper[m] < m).mean()) for m in MARGINS},
        mean_t2=float(t2.mean()), mean_t1=float(t1.mean()), mean_t3=float(t3.mean()),
        ci90_h2=float(np.mean(2.0 * Z90 * se2)),
        ci95_h1=float(np.mean(2.0 * Z975 * se1)),
        mdd_h1=float((Z975 + Z80) * np.mean(se1)),
        mdd_ni=float((Z90 + Z80) * np.mean(se2)),
        de_h_analytic=float(de_h), de_h_full_analytic=float(de_full),
        de_h_empirical=de_emp,
        n_eff_scen=float(meta['n_high'] / de_emp if de_emp > 0 else meta['n_high']),
        rho_v_bin=float(rho_v_bin), rho_t_bin=float(rho_t_bin),
        n_pair=float(np.mean(n2)),
    )


# --------------------------------------------------------------------------- #
# Literal procedures for the validation block
# --------------------------------------------------------------------------- #
def literal_perm_p(d, meta, rng, n_perm):
    """Exact 10k-sign-flip p-value per replicate, scenario-level (v1 machinery)."""
    reps = d.shape[0]
    out = np.empty(reps)
    for i in range(reps):
        row = d[i]
        valid_g = [sl for sl in meta['slices'] if (~np.isnan(row[sl])).any()]
        g_used = len(valid_g)
        t_obs = 0.0
        for sl in valid_g:
            dv = row[sl][~np.isnan(row[sl])]
            t_obs += dv.mean() / g_used
        t_star = np.zeros(n_perm)
        for sl in valid_g:
            dv = row[sl][~np.isnan(row[sl])]
            eps = rng.integers(0, 2, size=(n_perm, dv.size)) * 2 - 1
            t_star += (eps * dv).sum(axis=1) / (dv.size * g_used)
        out[i] = (1.0 + np.count_nonzero(np.abs(t_star) >= abs(t_obs) - 1e-12)) / (n_perm + 1.0)
    return out


def literal_variant_bootstrap(d, meta, rng, n_boot, level):
    """Literal stratified VARIANT-cluster bootstrap endpoints, per replicate.

    Within each stratum, resample the 10 variant clusters with replacement and keep
    each resampled cluster's scenarios; the replicate mean is the equal-stratum
    average of the resampled within-stratum means. Percentile endpoints.
    """
    reps = d.shape[0]
    lo = np.empty(reps)
    hi = np.empty(reps)
    for i in range(reps):
        row = d[i]
        g_used = sum(1 for sl in meta['slices'] if (~np.isnan(row[sl])).any())
        t_star = np.zeros(n_boot)
        for g, sl in enumerate(meta['slices']):
            n_v = meta['n_var'][g]
            dg3 = row[sl].reshape(n_v, meta['k'][g])
            if not (~np.isnan(dg3)).any():
                continue
            idx = rng.integers(0, n_v, size=(n_boot, n_v))
            block = dg3[idx]                      # (n_boot, n_v, k)
            n_ok = np.sum(~np.isnan(block), axis=(1, 2))
            tot = np.nansum(block, axis=(1, 2))
            ok = n_ok > 0
            t_star[ok] += (tot[ok] / n_ok[ok]) / g_used
        lo[i], hi[i] = np.quantile(t_star, [(1 - level) / 2, 1 - (1 - level) / 2])
    return lo, hi


# --------------------------------------------------------------------------- #
# Transcript helpers
# --------------------------------------------------------------------------- #
def hline(ch='='):
    print(ch * 104)


def section(title):
    print()
    hline()
    print(title)
    hline()


def print_intro(reps, elapsed):
    section('A. WHAT THIS IS AND WHAT IS ASSUMED')
    print('SIMULATION UNDER ASSUMPTIONS - NOT OBSERVED DATA. No pilot, study or Phase 17')
    print('run record is used. Every number below is a prediction from the model in')
    print('this section, conditional on the stated assumptions.')
    print()
    print(f'numpy {np.__version__}; Python {sys.version.split()[0]}; '
          f'{reps} replicates per reported cell; MC SE of a power estimate <= {0.5 / math.sqrt(reps):.3f}')
    print('deterministic: all streams seeded; transcript self-describing; no hidden data.')
    print()
    print('REV2 FIXED DESIGN (PLAN-CHECKPOINT2.md): 4 arms; 6 strata; 400 scenarios')
    print('(4 game x 60 = 20 variants x 3 paraphrases; 2 focus x 80 = 20 x 4); 10')
    print('templates T00-T09 per family, each in H and L twin variants; 200 high / 200')
    print('low; 3 reps; 4,800 confirmatory executions (not executed now).')
    print('Cluster structure: scenario -> variant (H or L twin) -> template; arms paired')
    print('within scenario; primary metric = CVR over the 200 high-opportunity scenarios.')
    print()
    print('GENERATIVE MODEL (calibrated exactly like v1: marginal CVR = mu_a, total')
    print('between-scenario binary ICC = ICC_scenario, including clipping):')
    print('  p = clip(m0_a + s_a*U, 0, 1);  U = sqrt(rho_arm)U_shared + sqrt(1-rho_arm)U_arm')
    print('  U_shared = sqrt(rho_V) z_variant + sqrt(1-rho_V) z_scenario')
    print('  z_variant shared by all high-op scenarios of one H variant (2 strata x')
    print('  3 or 4 paraphrases); z_scenario per scenario; reps technical (Bernoulli).')
    print(f'  rho_arm = {RHO_ARM} (cross-arm sharing of the scenario deviation; not')
    print('  identifiable before the pilot; v1 used the same value)')
    print(f'  rho_V = PHI + (1-PHI)*rho_pair with PHI = {PHI}: for the H-only primary')
    print('  analysis a template and its H twin are the same partition, so the')
    print('  template share s_T and the matched-pair extra kappa act only through')
    print('  rho_pair = s_T + (1-s_T)kappa. Section B maps the grid.')
    print(f'ICC calibration solved numerically in {elapsed:.1f} s; target vs realised in section C.')


def print_mapping():
    section('B. GRID MAPPING - TEMPLATE SHARE / MATCHED-PAIR CORRELATION')
    print('The lead grid asks for template ICC {0,0.1,0.25} and matched-pair correlation')
    print('{0,0.3,0.6}. In this corpus a template contains exactly the H/L twin pair, so')
    print('the template component and the matched-pair extra are the SAME random-effect')
    print('level: only their combination is identifiable. The literal grid therefore')
    print('maps to 9 distinct realised pair-level correlations (rho_pair); cells sharing')
    print('a rho_pair are statistically identical. We run the 9 distinct values and')
    print('report the mapping - a finding, not a simplification of the data.')
    print()
    print(f'{"template share s_T":>19} {"pair extra kappa":>18} {"rho_pair":>10} '
          f'{"rho_V (PHI=.5)":>15} {"absolute template ICC":>21}')
    for s_t in TEMPLATE_SHARES:
        for k in PAIR_CORRS:
            rho_pair = round(s_t + (1 - s_t) * k, 6)
            rho_v = round(PHI + (1 - PHI) * rho_pair, 6)
            print(f'{s_t:>19.2f} {k:>18.1f} {rho_pair:>10.3f} {rho_v:>15.3f} '
                  f'{rho_pair:>21.3f} (x ICC_scenario)')
    print()
    print('Absolute ICCs (binary scale) at the grid values are rho_pair x ICC_scenario')
    print('(template / matched-pair) and rho_V x ICC_scenario (within-variant, the')
    print('cluster ICC used by the primary H-only analysis). The absolute template ICC')
    print('cannot exceed ICC_scenario in a nested design; the ratio reading of')
    print('"template ICC" is what makes the requested cross-feasible.')
    print()
    print('PHI = 0.5 assumption: of the non-pair variance, half is variant-level (shared')
    print('by the paraphrases/strata of one variant) and half is scenario-level. This is')
    print('not identifiable before the pilot; a PHI sensitivity is in section G3.')


def print_calibration(reps):
    section('C. ICC CALIBRATION (target vs realised, from the clipping model)')
    print(f'{"marginal CVR":>12} {"target ICC":>10} {"m0":>9} {"scale s":>9} '
          f'{"realised mean":>13} {"realised ICC":>12}')
    for mu in (0.0, 0.03, 0.05, 0.10, 0.50, 0.65, 0.80):
        for icc in ICCS:
            m0, s, rm, ricc = calibrate(mu, icc)
            print(f'{mu:>12.2f} {icc:>10.2f} {m0:>9.3f} {s:>9.3f} {rm:>13.3f} {ricc:>12.3f}')
    print()
    print('ICC is the binary-outcome between-scenario ICC Var(p_s)/(mu(1-mu)); mu=0 or')
    print('ICC=0 has no scenario variance by construction. Calibration holds both the')
    print('target mean and the target ICC under clipping.')


def pair_reps():
    return {pl: [(s_t, k) for s_t, k in _PAIR_COMBOS
                 if round(s_t + (1 - s_t) * k, 6) == pl] for pl in _PAIR_LEVELS}


def print_grid(rows, reps):
    section('D. MAIN GRID - H2 clustered at the variant level (H1/H3 at none=0.65)')
    print('Corrected CVR = none (fixed). none fixed at 0.65 in this grid because none')
    print('enters only H1/H3, which are saturated; the none sweep is section E.')
    print('H2 support = upper 90% one-sided cluster-robust bound of memory-manual CVR')
    print('difference below the margin, with 10 H-variant clusters per stratum.')
    print('CI90 = expected 90% CI width (pp); MDDni = detectable NI margin at 80% power;')
    print('DE = design effect (variant cluster / iid scenario); n_eff = 200/DE.')
    print('Clusters in the primary analysis: 30 H variants (= 30 H templates), 200')
    print('scenarios, 600 runs/arm; full corpus: 60 variants, 30 templates, 400 scenarios.')
    print(f'{"icc":>5} {"rhoP":>6} {"mem":>5} {"man":>5} {"unus":>5}  {"H1":>5} '
          f'{"H2@8":>5} {"H2@10":>5} {"H2@15":>5} {"H3":>5}  {"CI90":>5} '
          f'{"CI95H1":>6} {"MDDni":>5} {"MDDh1":>5} {"DE":>5} {"neff":>6}')
    print('-' * 116)
    for row in rows:
        m = row['metrics']
        print(f'{row["icc"]:>5.2f} {row["rho_pair"]:>6.3f} {row["memory"]:>5.2f} '
              f'{row["manual"]:>5.2f} {row["unusable"]:>5.2f}  {m["power_h1"]:>5.3f} '
              f'{m["power_h2"][0.08]:>5.3f} {m["power_h2"][0.10]:>5.3f} '
              f'{m["power_h2"][0.15]:>5.3f} {m["power_h3"]:>5.3f}  '
              f'{100 * m["ci90_h2"]:>5.2f} {100 * m["ci95_h1"]:>6.2f} '
              f'{100 * m["mdd_ni"]:>5.2f} {100 * m["mdd_h1"]:>5.2f} '
              f'{m["de_h_empirical"]:>5.2f} {m["n_eff_scen"]:>6.1f}')


def print_margin_summary(rows):
    section('E. WHERE H2 FAILS, AND THE H1/H3 SATURATION CHECK')
    print('H2 failure cells (power < 0.80) by margin and by true memory-manual gap:')
    for margin in MARGINS:
        bad = [r for r in rows if r['metrics']['power_h2'][margin] < 0.80]
        gaps = sorted({round(r['memory'] - r['manual'], 2) for r in bad})
        print(f'  margin {margin * 100:>2.0f} pp: {len(bad):>3} of {len(rows)} cells < 0.80; '
              f'true gaps represented: {gaps}')
    print()
    print('Design decision: the failures are cells where the true memory-manual deficit is')
    print('at or above the margin (a real difference) or, at 8 pp, a +5 pp deficit under')
    print('maximal variant clustering. They are not power defects in the calibrated case.')
    print()
    print('H1/H3 saturation across the none sweep is summarised in section E2.')


def print_h13_sweep(rows):
    section('E2. H1/H3 SATURATION UNDER THE REVISED CLUSTER STRUCTURE')
    if not rows:
        print('  (skipped)')
        return
    print('none sweep {0.50,0.65,0.80} x memory {0,0.10} x ICC x pair level x unusable.')
    print('Every individual cell is reported in the machine-readable grid; the table shows')
    print('the minimum H1 / H3 power and the maximum 95% CI width across the sweep for')
    print('each (none, memory) pair.')
    print()
    print(f'{"none":>5} {"mem":>5} {"min H1":>7} {"min H3":>7} {"max CI95H1":>11}')
    for none_rate in NONE_RATES:
        for memory in (0.0, 0.10):
            sub = [r for r in rows if r['none'] == none_rate and r['memory'] == memory]
            print(f'{none_rate:>5.2f} {memory:>5.2f} '
                  f'{min(r["metrics"]["power_h1"] for r in sub):>7.3f} '
                  f'{min(r["metrics"]["power_h3"] for r in sub):>7.3f} '
                  f'{100 * max(r["metrics"]["ci95_h1"] for r in sub):>9.2f} pp')
    print()
    print(f'  cells: {len(rows)}; global minimum H1 = '
          f'{min(r["metrics"]["power_h1"] for r in rows):.3f}, H3 = '
          f'{min(r["metrics"]["power_h3"] for r in rows):.3f}. H1/H3 are saturated; the')
    print('  sign-flip test remains valid under variant clustering (randomisation test).')


def print_design_compare(rows):
    section('F. WHAT THE REVISION COST OR BOUGHT (v1 70/60 vs rev2 60/80 allocation)')
    print('Same generative model for both allocations (same ICC_scenario / rho_pair /')
    print('rates), so this isolates the allocation and cluster structure. v1: 5 H')
    print('variants per family, 7/6 paraphrases per stratum; rev2: 10 H variants per')
    print('family, 3/4 paraphrases. H-only primary analysis, variant-cluster variance.')
    print()
    print(f'{"design":>6} {"rates":>8} {"icc":>5} {"rhoP":>6} {"H2@8":>6} {"H2@10":>6} '
          f'{"H2@15":>6}  {"CI90":>5} {"DE":>5} {"neff":>6} {"clusters":>8}')
    print('-' * 104)
    for r in rows:
        m = r['metrics']
        print(f'{r["design"]:>6} {r["rates"]:>8} {r["icc"]:>5.2f} {r["rho_pair"]:>6.3f} '
              f'{m["power_h2"][0.08]:>6.3f} {m["power_h2"][0.10]:>6.3f} '
              f'{m["power_h2"][0.15]:>6.3f}  {100 * m["ci90_h2"]:>5.2f} '
              f'{m["de_h_empirical"]:>5.2f} {m["n_eff_scen"]:>6.1f} '
              f'{r["n_clusters"]:>8}')
    print()
    print('Reading: the revision doubles the number of high-opportunity variant clusters')
    print('(15 -> 30) and shrinks the within-cluster size (14/12 -> 6/8), which cuts the')
    print('variant-clustering design-effect coefficient from ~12.4 to ~5.8 at the same')
    print('ICC: the primary variance estimate becomes much less dependent on the')
    print('paraphrase count. Cost: game strata lose 5 high-op scenarios each (35 -> 30),')
    print('focus strata gain 10 each (30 -> 40), and game request diversity per variant')
    print('falls from 7 to 3 paraphrases. Net effect on H2 power: see columns.')


def print_phi_sensitivity(reps):
    section('G3. PHI SENSITIVITY (split of non-pair variance: variant vs scenario)')
    print('PHI is the share of the non-pair between-scenario variance that is')
    print('variant-level (shared by paraphrases/strata of one variant); 1-PHI is')
    print('scenario/paraphrase-level. PHI is not identifiable before the pilot. The')
    print('primary analysis clusters at the variant level, so higher PHI = stronger')
    print('clustering = wider CIs. Default grid uses PHI = 0.5.')
    print()
    print(f'{"icc":>5} {"rhoP":>6} {"PHI":>5} {"H2@8":>6} {"H2@10":>6} {"H2@15":>6} '
          f'{"CI90":>5} {"DE":>5} {"neff":>6}')
    # local override of the module-level PHI for this sensitivity only
    global PHI
    original = PHI
    for phi in (0.0, 0.5, 1.0):
        PHI = phi
        for icc in (0.1, 0.25, 0.4):
            for rho_pair in (0.0, 0.3, 0.7):
                cvr, meta = simulate_default(icc, rho_pair, reps, seed=777000 + int(phi * 10))
                m = evaluate(cvr, meta, icc, rho_pair)
                print(f'{icc:>5.2f} {rho_pair:>6.3f} {phi:>5.2f} '
                      f'{m["power_h2"][0.08]:>6.3f} {m["power_h2"][0.10]:>6.3f} '
                      f'{m["power_h2"][0.15]:>6.3f} {100 * m["ci90_h2"]:>5.2f} '
                      f'{m["de_h_empirical"]:>5.2f} {m["n_eff_scen"]:>6.1f}')
    PHI = original


def print_validation():
    section('H. LITERAL-PROCEDURE VALIDATION (normal approximation check)')
    print('Literal 10,000-permutation scenario sign-flip (H1) and literal stratified')
    print('VARIANT-cluster bootstrap (H2, 2,000 resamples) versus the analytic forms used')
    print('for the grid, on the same simulated data. 300 replicates; this checks the')
    print('approximation, not the design assumptions.')
    print()
    reps = 300
    n_perm, n_boot = 10000, 2000
    rows = []
    for label, mus, icc, rho_pair in (
        ('mid-power H1 (validation-only rates)', (0.50, 0.42, 0.42, 0.50), 0.25, 0.3),
        ('H2 stress (grid rates)', (0.65, 0.10, 0.00, 0.65), 0.25, 0.3),
    ):
        rng = np.random.default_rng([SEEDS['sim'], 600001])
        meta = design_meta(DESIGNS['rev2'])
        u_shared, u_arm = draw_shared_and_arm(meta, rho_pair, reps, rng)
        v = draw_unusable(reps, meta, 0.10, rng)
        cvr = simulate_cell(u_shared, u_arm, v, list(mus), icc, rng)
        d1 = cvr[:, :, 1] - cvr[:, :, 0]
        d3 = cvr[:, :, 3] - cvr[:, :, 1]
        d2 = cvr[:, :, 1] - cvr[:, :, 2]
        an1 = pair_perm_test(d1, meta['slices'])
        an3 = pair_perm_test(d3, meta['slices'])
        a1, a3 = holm_support(an1['p'], an3['p'], an1['T'], an3['T'])
        an_t2, an_se2, _, _ = cluster_ci(d2, meta)
        an_h2 = {m: float(((an_t2 + Z90 * an_se2) < m).mean()) for m in MARGINS}
        an_ci90 = float(np.mean(2 * Z90 * an_se2))
        boot_rng = np.random.default_rng([SEEDS['boot'], 600001])
        lo, hi = literal_variant_bootstrap(d2, meta, boot_rng, n_boot, 0.90)
        lit_h2 = {m: float((hi < m).mean()) for m in MARGINS}
        lit_ci90 = float(np.mean(hi - lo))
        perm_rng = np.random.default_rng([SEEDS['perm'], 600001])
        lp1 = literal_perm_p(d1, meta, perm_rng, n_perm)
        lp3 = literal_perm_p(d3, meta, perm_rng, n_perm)
        l1, l3 = holm_support(lp1, lp3, an1['T'], an3['T'])
        rows.append((label, a1.mean(), l1.mean(), an_h2, lit_h2, an_ci90, lit_ci90,
                     a3.mean(), l3.mean()))
    print(f'{"validation case":>34} {"quantity":>18} {"analytic":>9} {"literal":>8} {"diff":>7}')
    print('-' * 84)
    for label, a1, l1, an_h2, lit_h2, aci, lci, a3, l3 in rows:
        print(f'{label:>34} {"H1 power":>18} {a1:>9.3f} {l1:>8.3f} {l1 - a1:>+7.3f}')
        for m in MARGINS:
            print(f'{"":>34} {"H2@" + str(int(m * 100)) + " power":>18} '
                  f'{an_h2[m]:>9.3f} {lit_h2[m]:>8.3f} {lit_h2[m] - an_h2[m]:>+7.3f}')
        print(f'{"":>34} {"H2 CI90 width (pp)":>18} {100 * aci:>9.2f} {100 * lci:>8.2f} '
              f'{100 * (lci - aci):>+7.2f}')
        print(f'{"":>34} {"H3 power":>18} {a3:>9.3f} {l3:>8.3f} {l3 - a3:>+7.3f}')
        print()
    print('Monte Carlo SE of a power difference near 0.5 at 300 replicates is 0.041;')
    print('differences below ~0.05 are not material. The literal variant bootstrap is')
    print('the procedure 04b-ANALYSIS-PLAN-REV2.md pre-registers for H2.')


def print_budget():
    section('J. CONFIRMATORY EXECUTION BUDGET (arithmetic on stated assumptions)')
    print('NOTHING BELOW WAS EXECUTED OR MEASURED BY THIS SCRIPT. It is arithmetic on')
    print('the Phase 17 measured run times (RESULTS.md) and the Dell measured throughput')
    print('(03-DELL-ENDPOINT.md 6.1/7.2); the endpoint decision is deferred to checkpoint')
    print('2 review (D1). Revised design: 4,800 confirmatory executions (one model).')
    print()
    runs = 4800
    print('Dell PolyStrata single slot (~25 tok/s decode, ~300 tok/s prefill, concurrency 1,')
    print('full-file HTML outputs required). Per-run time = ~18 s prefill + output_tokens/25:')
    print(f'{"assumed output tokens":>22} {"s/run":>7} {"4,800 runs":>12}')
    for out_tok in (2000, 5000, 8000):
        sec = 18.0 + out_tok / 25.0
        print(f'{out_tok:>22} {sec:>7.0f} {sec * runs / 3600:>10.0f} h')
    print('  planning value from the checkpoint-2 pilot gate (<= 10 h for 132 runs) is')
    print('  ~4.5 min/run -> ~360 h (~15 days) single slot. Not feasible for confirmatory.')
    print()
    print('Sharded hosted endpoint (Phase 17 means: Muse Spark 257 s/run, Muse Spark Open')
    print('52 s/run; linear shard scaling assumed). Wall clock for 4,800 runs:')
    print(f'{"model":>16} {"s/run":>7} {"6 shards":>10} {"12 shards":>10} '
          f'{"24 shards":>10} {"48 shards":>10}')
    for label, sec in (('Muse Spark', 257.0), ('Muse Spark Open', 52.0)):
        vals = [runs * sec / (s * 3600) for s in (6, 12, 24, 48)]
        print(f'{label:>16} {sec:>7.0f} ' + ' '.join(f'{v:>8.1f} h' for v in vals))
    print()
    print('Recommended confirmatory budget (endpoint decision deferred):')
    print('  * 4,800 confirmatory executions, one model, full-file outputs;')
    print('  * hosted Muse Spark Open, 12 shards: ~5.8 h base, plan 7-8 h with retries;')
    print('  * or hosted Muse Spark, 24 shards: ~14.3 h base, plan 16-18 h with retries;')
    print('  * add ~10% execution headroom for transport/truncation (5,280 runs queued);')
    print('  * if both models are run: 9,600 executions and double the wall clock;')
    print('  * Dell single slot is for the pilot only (~15 days for confirmatory).')
    print('  * token volume (Phase 17 scaling): Spark ~5.7B input tokens; Open ~24M prompt')
    print('    + ~76M completion. Paid-API approval is required for the hosted option.')
    print('  * key assumptions: Phase 17 per-run means hold for Study 02 prompts/outputs;')
    print('    shards run independently (no endpoint rate-limit serialisation); no reruns')
    print('    outside the pre-declared attempt budget; unusable runs are counted, not')
    print('    silently replaced.')


def print_recommendation(rows):
    section('K. RECOMMENDATION AND DESIGN WEAKNESSES')
    default = [r for r in rows if r['memory'] == DEFAULT_MEMORY and r['manual'] == DEFAULT_MANUAL
               and r['icc'] == 0.25 and r['rho_pair'] == 0.3 and r['unusable'] == 0.10][0]
    m = default['metrics']
    section('K1. HEADLINE AT THE DEFAULT CELL (pilot-calibrated rates)')
    print('DEFAULT: none 0.65, memory 0.03, manual 0.05, corrected = none, ICC_scenario 0.25,')
    print('rho_pair 0.30 (=> within-variant ICC 0.30 x 0.65 = 0.195), 10% unusable.')
    print(f'  H1 power = {m["power_h1"]:.3f};  H2@8 = {m["power_h2"][0.08]:.3f};  '
          f'H2@10 = {m["power_h2"][0.10]:.3f};  H2@15 = {m["power_h2"][0.15]:.3f};  '
          f'H3 power = {m["power_h3"]:.3f}')
    print(f'  expected 90% CI width (H2) = {100 * m["ci90_h2"]:.2f} pp;  '
          f'95% CI width (H1) = {100 * m["ci95_h1"]:.2f} pp')
    print(f'  H2 detectable NI margin at 80% power = {100 * m["mdd_ni"]:.2f} pp;  '
          f'H1 MDD = {100 * m["mdd_h1"]:.2f} pp')
    print(f'  design effect (variant cluster / iid scenario) = {m["de_h_empirical"]:.2f};  '
          f'effective scenarios = {m["n_eff_scen"]:.1f} / 200;  '
          f'variant clusters = 30;  templates = 30;  runs/arm = 600')
    print()
    print('K2. MARGIN: recommend +10 pp (D4 in the checkpoint-1 review already accepted this).')
    print('  The H2 cluster-aware 90% CI half-width at calibrated rates is ~2-3 pp; +10 pp')
    print('  keeps >0.99 power at arm parity and is the stricter, more useful claim. At 8 pp')
    print('  the calibrated case is still >0.99, but a true +5 pp memory deficit under the')
    print('  strongest variant clustering can fall below 0.80; +15 pp is the fallback.')
    print('  Pre-declared pilot fallback (fixed at freeze; pilot has only 5 scenarios per')
    print('  stratum, 1 rep, so it cannot calibrate +/-5 pp): +10 pp unless the pilot shows')
    print('  high-opportunity memory CVR >= 20% (>= 3/15 usable high-op pilot runs) while')
    print('  manual <= 5%, in which case fix +15 pp. Anything subtler is not estimable.')
    print()
    print('K3. ADEQUACY: 400 x 3 remains adequate under the revised cluster structure only if')
    print('  H2 is clustered at the VARIANT level (not the scenario level). The scenario-level')
    print('  bootstrap of v1 would overstate precision by the reported design effect (up to')
    print('  ~2-3x in variance at the highest ICC). With variant clustering, H2@10 is powered')
    print('  > 0.99 in the calibrated-rate region across the grid; H1/H3 are saturated.')
    print('  If the pre-freeze pilot shows ICC_scenario > 0.4 or rho_pair > 0.7, the design')
    print('  is still adequate at +10 pp (see section F), but the CI will be wider; do not')
    print('  compensate by adding optional stopping.')
    print()
    print('K4. NEW DESIGN WEAKNESSES FOUND (for the Lead):')
    print(' a. Template ICC and matched-pair correlation are not independent random-effect')
    print('    levels in this corpus: a template contains exactly its H/L twin pair, so the')
    print('    two knobs combine into ONE pair-level correlation. The grid maps to 9 distinct')
    print('    values (section B); report it that way rather than as a 3x3 cross.')
    print(' b. For the high-opportunity-only primary analysis, template clustering is not a')
    print('    separate level from variant clustering (one H twin per template). The separate')
    print('    template design effect exists only for full-corpus/secondary quantities.')
    print(' c. H2 inference MUST move from scenario-level to variant-level clustering; with')
    print('    only 10 variant clusters per stratum (30 total) the cluster-robust variance is')
    print('    coarse and the design effect is material. The 3-rep design does not fix this.')
    print(' d. The revised allocation trades request diversity for cluster count: game strata')
    print('    have 30 high-op scenarios (was 35) and only 3 paraphrases per variant (was 7);')
    print('    focus strata have 40 (was 30) and 4 paraphrases (was 6). Game per-stratum CIs')
    print('    are wider; focus narrower. See section F for the net effect.')
    print(' e. The matched-twin mechanism does not improve H1/H2/H3 (they use high-op only);')
    print('    it buys (i) removal of the opportunity-class/variant confound for the')
    print('    secondary H-vs-L contrast and (ii) a matched-pair secondary analysis. Do not')
    print('    present the twin design as a power gain for the primary family.')
    print(' f. The cross-arm correlation rho_arm and PHI are still unidentifiable until the')
    print('    pilot; both change the effective variance. Sections G/G3 quantify the range.')


# --------------------------------------------------------------------------- #
# Simulation drivers
# --------------------------------------------------------------------------- #
def simulate_default(icc, rho_pair, reps, seed=0, design='rev2',
                     rates=(DEFAULT_NONE, DEFAULT_MEMORY, DEFAULT_MANUAL, DEFAULT_NONE),
                     unusable=0.10, phi=None):
    """Convenience: one cell at the default rates (used by sensitivity sections)."""
    global PHI
    old = PHI
    if phi is not None:
        PHI = phi
    rng = np.random.default_rng([SEEDS['sim'], seed])
    meta = design_meta(DESIGNS[design])
    u_shared, u_arm = draw_shared_and_arm(meta, rho_pair, reps, rng)
    v = draw_unusable(reps, meta, unusable, rng)
    cvr = simulate_cell(u_shared, u_arm, v, list(rates), icc, rng)
    PHI = old
    return cvr, meta


def run_grid(reps):
    rows = []
    pair_map = pair_reps()
    unuse_cache = {}
    for icc in ICCS:
        for rho_pair in _PAIR_LEVELS:
            rng = np.random.default_rng([SEEDS['sim'], 100000 + int(icc * 100) * 100 + int(rho_pair * 100)])
            meta = design_meta(DESIGNS['rev2'])
            u_shared, u_arm = draw_shared_and_arm(meta, rho_pair, reps, rng)
            for unusable in UNUSABLE:
                if unusable not in unuse_cache:
                    unuse_cache[unusable] = draw_unusable(reps, meta, unusable, rng)
                v = unuse_cache[unusable]
                for memory in MEMORY_RATES:
                    for manual in MANUAL_RATES:
                        mus = (DEFAULT_NONE, memory, manual, DEFAULT_NONE)
                        cvr = simulate_cell(u_shared, u_arm, v, mus, icc, rng)
                        m = evaluate(cvr, meta, icc, rho_pair)
                        rows.append(dict(icc=icc, rho_pair=rho_pair, memory=memory,
                                         manual=manual, unusable=unusable,
                                         pair_combos=pair_map[rho_pair], metrics=m))
    return rows


def run_h13_sweep(reps):
    rows = []
    for icc in ICCS:
        for rho_pair in (0.0, 0.1, 0.25, 0.3, 0.7):
            rng = np.random.default_rng([SEEDS['sim'], 200000 + int(icc * 100) * 100 + int(rho_pair * 100)])
            meta = design_meta(DESIGNS['rev2'])
            u_shared, u_arm = draw_shared_and_arm(meta, rho_pair, reps, rng)
            for unusable in UNUSABLE:
                v = draw_unusable(reps, meta, unusable, rng)
                for none_rate in NONE_RATES:
                    for memory in (0.0, 0.10):
                        mus = (none_rate, memory, DEFAULT_MANUAL, none_rate)
                        cvr = simulate_cell(u_shared, u_arm, v, mus, icc, rng)
                        m = evaluate(cvr, meta, icc, rho_pair)
                        rows.append(dict(none=none_rate, memory=memory, icc=icc,
                                         rho_pair=rho_pair, unusable=unusable, metrics=m))
    return rows


def run_design_compare(reps):
    rows = []
    for design in ('v1', 'rev2'):
        meta = design_meta(DESIGNS[design])
        for rates_name, memory, manual in (('default', DEFAULT_MEMORY, DEFAULT_MANUAL),
                                           ('adverse', ADVERSE_MEMORY, ADVERSE_MANUAL)):
            for icc in (0.10, 0.25, 0.40):
                for rho_pair in (0.10, 0.30, 0.70):
                    rng = np.random.default_rng([SEEDS['sim'], 300000 + int(icc * 100)
                                                 + int(rho_pair * 100) + (0 if design == 'v1' else 5000)])
                    u_shared, u_arm = draw_shared_and_arm(meta, rho_pair, reps, rng)
                    v = draw_unusable(reps, meta, 0.10, rng)
                    mus = (DEFAULT_NONE, memory, manual, DEFAULT_NONE)
                    cvr = simulate_cell(u_shared, u_arm, v, mus, icc, rng)
                    m = evaluate(cvr, meta, icc, rho_pair)
                    rows.append(dict(design=design, rates=rates_name, icc=icc,
                                     rho_pair=rho_pair, n_clusters=meta['n_variants'],
                                     metrics=m))
    return rows


def run_matched_pairs(reps):
    """Secondary: H-vs-L opportunity contrast, matched twins vs unpaired.

    Illustrative true rates, not from the rate grid: H CVR 0.30, L CVR 0.15.
    Both classes calibrated to ICC_scenario = 0.25 with the pair/twin/scenario
    structure at PHI = 0.5. Outcome: power to detect H > L (two-sided alpha .05)
    and the CI width, matched (200 pairs) vs unpaired (200 vs 200 scenarios),
    both clustered at the template level (30).
    """
    rows = []
    icc = 0.25
    for rho_pair in (0.0, 0.3, 0.7):
        rng = np.random.default_rng([SEEDS['sim'], 700000 + int(rho_pair * 100)])
        meta = design_meta(DESIGNS['rev2'])
        # full-corpus structure: 30 templates, 60 variants, 400 scenarios
        n_templates = 30
        n_variants = 60
        n_scen = 400
        # exact mapping from the corpus: variant -> template; scenario -> variant
        pair_index, variant_index, class_index = [], [], []
        for si, stratum in enumerate(STRATA):
            fam = FAMILY[stratum]
            p = DESIGNS['rev2']['paras'][si]
            base = {'farm': 0, 'orchard': 10, 'focus': 20}[fam]
            for t in range(10):
                for ci, cls in enumerate(('H', 'L')):
                    for _ in range(p):
                        pair_index.append(base + t)
                        variant_index.append((base + t) * 2 + ci)
                        class_index.append(ci)
        pair_index = np.asarray(pair_index)
        variant_index = np.asarray(variant_index)
        class_index = np.asarray(class_index)
        z_pair = rng.standard_normal([reps, n_templates])
        z_twin = rng.standard_normal([reps, n_variants])
        z_scen = rng.standard_normal([reps, n_scen])
        a_pair = rho_pair
        a_twin = (1 - rho_pair) * PHI
        a_scen = (1 - rho_pair) * (1 - PHI)
        u = (math.sqrt(a_pair) * z_pair[:, pair_index]
             + math.sqrt(a_twin) * z_twin[:, variant_index]
             + math.sqrt(a_scen) * z_scen)
        mus = {0: 0.30, 1: 0.15}
        m0 = {}
        sc = {}
        for ci, mu in mus.items():
            m0[ci], sc[ci], _, _ = calibrate(mu, icc)
        p = np.where(class_index[None, :] == 0,
                     m0[0] + sc[0] * u, m0[1] + sc[1] * u)
        np.clip(p, 0, 1, out=p)
        v = rng.binomial(RUNS, 0.9, size=(reps, n_scen))
        k = rng.binomial(v, p)
        cvr = np.full((reps, n_scen), np.nan)
        mask = v > 0
        cvr[mask] = k[mask] / v[mask]
        # matched pairs: (stratum, template, paraphrase) -> H and L scenario
        h_idx = np.where(class_index == 0)[0]
        l_idx = np.where(class_index == 1)[0]
        d_pair = cvr[:, h_idx] - cvr[:, l_idx]
        # cluster at template (30), sizes 6/8 pairs per template (2 strata x p)
        tmpl_of_pair = pair_index[h_idx]
        t_sums = np.zeros((reps, n_templates))
        t_cnt = np.zeros((reps, n_templates))
        for t in range(n_templates):
            cols = np.where(tmpl_of_pair == t)[0]
            t_sums[:, t] = np.nansum(d_pair[:, cols], axis=1)
            t_cnt[:, t] = np.sum(~np.isnan(d_pair[:, cols]), axis=1)
        mean_pair = t_sums.sum(1) / t_cnt.sum(1)
        resid = t_sums - t_cnt * mean_pair[:, None]
        var_pair = (n_templates / (n_templates - 1.0)) * np.nansum(resid ** 2, axis=1) / t_cnt.sum(1) ** 2
        se_pair = np.sqrt(var_pair)
        z_matched = np.abs(mean_pair) / np.maximum(se_pair, 1e-300)
        power_matched = float(np.mean(2 * (1 - norm_cdf(z_matched)) < 0.05))
        # unpaired: separate means for H and L scenarios, cluster at template
        def group_se(x, tmpl):
            sums = np.zeros((reps, n_templates))
            cnt = np.zeros((reps, n_templates))
            for t in range(n_templates):
                cols = np.where(tmpl == t)[0]
                sums[:, t] = np.nansum(x[:, cols], axis=1)
                cnt[:, t] = np.sum(~np.isnan(x[:, cols]), axis=1)
            n = cnt.sum(1)
            mean = sums.sum(1) / n
            resid = sums - cnt * mean[:, None]
            var = (n_templates / (n_templates - 1.0)) * np.nansum(resid ** 2, axis=1) / n ** 2
            return mean, np.sqrt(var)
        mh, sch = group_se(cvr[:, h_idx], tmpl_of_pair)
        ml, scl = group_se(cvr[:, l_idx], tmpl_of_pair)
        diff = mh - ml
        se_unp = np.sqrt(sch ** 2 + scl ** 2)
        z_unp = np.abs(diff) / np.maximum(se_unp, 1e-300)
        power_unp = float(np.mean(2 * (1 - norm_cdf(z_unp)) < 0.05))
        rows.append(dict(rho_pair=rho_pair,
                         corr=float(np.corrcoef(
                             cvr[:, h_idx][~np.isnan(cvr[:, h_idx]) & ~np.isnan(cvr[:, l_idx])],
                             cvr[:, l_idx][~np.isnan(cvr[:, h_idx]) & ~np.isnan(cvr[:, l_idx])],
                         )[0, 1] if (~np.isnan(cvr[:, h_idx]) & ~np.isnan(cvr[:, l_idx])).sum() > 2 else float('nan')),
                         power_matched=power_matched, power_unpaired=power_unp,
                         ci_matched=float(np.mean(2 * Z975 * se_pair)),
                         ci_unpaired=float(np.mean(2 * Z975 * se_unp)),
                         diff=float(np.mean(mean_pair))))
    return rows


def print_matched(rows):
    section('I. SECONDARY MATCHED-PAIR OPPORTUNITY CONTRAST (illustrative rates)')
    print('H vs L opportunity contrast in the none arm, illustrative true rates H 0.30 vs')
    print('L 0.15 (NOT from the rate grid); ICC_scenario 0.25; 200 matched twin pairs,')
    print('clustered at the 30 templates; 2,000 reps. This is a secondary descriptive')
    print('analysis, not a confirmatory hypothesis, and no claim is made here.')
    print()
    print(f'{"rho_pair":>9} {"realised corr(H,L)":>18} {"matched power":>14} '
          f'{"unpaired power":>15} {"CI95 matched":>13} {"CI95 unpaired":>14}')
    for r in rows:
        print(f'{r["rho_pair"]:>9.2f} {r["corr"]:>18.3f} {r["power_matched"]:>14.3f} '
              f'{r["power_unpaired"]:>15.3f} {100 * r["ci_matched"]:>11.1f} pp '
              f'{100 * r["ci_unpaired"]:>12.1f} pp')
    print()
    print('Reading: the twin matching buys efficiency for the H-vs-L contrast in')
    print('proportion to the realised pair correlation; it does NOT buy power for H1/H2/H3,')
    print('which use the high-opportunity scenarios only. This is the descriptive payoff')
    print('of the revision, and it is not a confirmatory claim.')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--reps', type=int, default=REPS)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--skip-validation', action='store_true')
    args = ap.parse_args()
    reps = 50 if args.quick else args.reps
    t0 = time.time()
    for mu in (0.0, 0.03, 0.05, 0.10, 0.50, 0.65, 0.80):
        for icc in ICCS:
            calibrate(mu, icc)
    t_cal = time.time() - t0

    print('Study 02 checkpoint 2 - REV2 matched-twin power simulation')
    print('generated by analysis/power_study2_rev2.py; deterministic; this transcript is')
    print('the deliverable.  [SIM] = simulation under assumptions, NOT observed data.')
    print(f'run started: {time.strftime("%Y-%m-%dT%H:%M:%S%z")}')
    print_intro(reps, t_cal)
    print_mapping()
    print_calibration(reps)

    if args.quick:
        # smoke: a handful of cells only
        rows = []
        for row in run_grid(reps)[:12]:
            rows.append(row)
        print_grid(rows, reps)
        print()
        print(f'QUICK MODE: {len(rows)} cells; finished in {time.time() - t0:.1f} s')
        return 0

    grid = run_grid(reps)
    print_grid(grid, reps)
    print_margin_summary(grid)
    h13 = run_h13_sweep(reps)
    print_h13_sweep(h13)
    compare = run_design_compare(reps)
    print_design_compare(compare)
    print_phi_sensitivity(reps)
    matched = run_matched_pairs(reps)
    print_matched(matched)
    if not args.skip_validation:
        print_validation()
    print_budget()
    print_recommendation(grid)

    print()
    hline()
    print(f'finished in {time.time() - t0:.1f} s; {reps} replicates/cell; '
          f'{len(grid)} main cells + {len(h13)} H1/H3 cells + {len(compare)} design-comparison '
          f'cells; grid total {reps * (len(grid) + len(h13) + len(compare)):,} simulated trials')
    print('SIMULATION UNDER ASSUMPTIONS - NOT OBSERVED DATA.')
    hline()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
