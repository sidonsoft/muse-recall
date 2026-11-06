#!/usr/bin/env python3
"""Study 02 - Rare-Trigger Reliability: power simulation for the fixed lead design.

THIS IS A SIMULATION UNDER ASSUMPTIONS, NOT OBSERVED DATA.

Usage (run WITHOUT -I: numpy lives in the user site-packages on this machine, and
-I would hide it; the confirmatory analysis script is stdlib-only and can use -I):

    python3 power_study2.py                    # full run (2,000 replicates per grid cell)
    python3 power_study2.py --reps 500         # quicker, noisier
    python3 power_study2.py --skip-validation
    python3 power_study2.py --quick            # smoke test only

Output is a plain-text transcript (normally redirected to power_study2.txt):

    python3 power_study2.py > power_study2.txt

The script is deterministic: every random stream is seeded from the constants below.
It emulates the *analysis plan* in 04-ANALYSIS-PLAN.md, not the trial itself:

  * 6 strata; 200 pre-registered high-opportunity scenarios, split 35/35/35/35/30/30
    (this within-stratum split is an ASSUMPTION - the opportunity-class allocation
    inside strata is not yet fixed in the design and must be frozen before the pilot);
  * 4 arms (none, memory, manual, corrected); 3 runs per scenario per arm;
  * unit of analysis = scenario; runs within a scenario-arm are replicated Bernoulli
    draws from one scenario-level probability;
  * H1 and H3: stratified sign-flip test on paired within-scenario CVR differences,
    equal stratum weights, two-sided p, Holm over {H1, H3}, family alpha .05; support
    also requires the pre-registered direction;
  * H2: non-inferiority, upper 90% bound of the memory-minus-manual CVR difference
    below the margin. The analysis plan uses a stratified cluster bootstrap; this
    simulation uses its normal approximation (the bootstrap's large-sample limit) and
    validates that approximation against the literal bootstrap below.

Requires numpy. Everything else is standard library.
"""

from __future__ import annotations

import argparse
import math
import time

import numpy as np

# --------------------------------------------------------------------------- #
# Fixed design / analysis constants
# --------------------------------------------------------------------------- #
STRATA = (
    'farm-arcade',
    'farm-challenge',
    'orchard-arcade',
    'orchard-challenge',
    'focus-reward',
    'focus-lively',
)
# High-opportunity scenarios per stratum. ASSUMPTION: 200 high / 200 low split evenly
# inside every stratum (35/35/35/35/30/30). Must be fixed in design/ before the pilot.
N_HIGH = (35, 35, 35, 35, 30, 30)
ARMS = ('none', 'memory', 'manual', 'corrected')
RUNS_PER_SCENARIO_ARM = 3

ALPHA = 0.05
Z975 = 1.959963984540054      # two-sided .05
Z90 = 1.6448536269514722      # one-sided .05 / two-sided .10
Z80 = 0.8416212335729143      # power .80

# Effect of sharing the scenario-level deviation across arms (proportion of the
# scenario scale that is common). Fixed at 0.5 for the primary grid; sensitivity
# analysis uses 0 and 1. This is not identifiable until the pilot: the pairing
# benefit of the design depends on it.
RHO_SHARED = 0.5

# Seeds (documented here and in 04-ANALYSIS-PLAN.md; fixed before freeze)
SIM_SEED = 2002003
PERM_SEED = 2002001           # analysis-plan sign-flip seed
BOOT_SEED = 2002002           # analysis-plan cluster-bootstrap seed

# Grid factors (fixed by the lead)
NONE_RATES = (0.50, 0.65, 0.80)
MEMORY_RATES = (0.00, 0.03, 0.10)
MANUAL_RATES = (0.00, 0.05, 0.10)
ICC_VALUES = (0.0, 0.1, 0.25, 0.4)
UNUSABLE_RATES = (0.05, 0.10, 0.20)
MARGINS = (0.10, 0.15)

# Default / headline cell: pilot-calibrated (Phase 17 gives none ~0.65 Spark /
# ~0.82 Open; memory ~0.00-0.02; manual 0.00). ICC 0.25 and 10% unusable are
# deliberately conservative central values, not estimates.
DEFAULT = dict(none=0.65, memory=0.03, manual=0.05, icc=0.25, unusable=0.10, rho=RHO_SHARED)
# Adverse-but-possible pilot outcome used for the design-change table:
ADVERSE = dict(none=0.65, memory=0.10, manual=0.00, icc=0.25, unusable=0.10, rho=RHO_SHARED)

_M0 = None


# --------------------------------------------------------------------------- #
# Numerical helpers
# --------------------------------------------------------------------------- #
def norm_cdf(x):
    """Standard normal CDF, Abramowitz & Stegun 26.2.17, |abs err| < 7.5e-8."""
    x = np.asarray(x, dtype=float)
    sign = np.where(x >= 0.0, 1.0, -1.0)
    a = np.abs(x) / math.sqrt(2.0)
    t = 1.0 / (1.0 + 0.3275911 * a)
    y = 1.0 - (
        (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
         + 0.254829592) * t * np.exp(-a * a)
    )
    return 0.5 * (1.0 + sign * y)


_ZQ = np.linspace(-8.0, 8.0, 401)
_WQ = np.exp(-_ZQ * _ZQ / 2.0)
_WQ /= _WQ.sum()
_CALIBRATION: dict[tuple[float, float], tuple[float, float, float, float]] = {}


def _moments(m0: float, s: float) -> tuple[float, float]:
    """Mean and variance of clip(m0 + s*z, 0, 1) for z ~ N(0,1)."""
    p = np.clip(m0 + s * _ZQ, 0.0, 1.0)
    m = float((p * _WQ).sum())
    var = float((((p - m) ** 2) * _WQ).sum())
    return m, var


def calibrate(mu: float, icc: float) -> tuple[float, float, float, float]:
    """Solve (m0, s) so clip(m0 + s z) has marginal mean mu and marginal ICC `icc`.

    ICC here is the binary-outcome ICC, Var(p_s)/(mu(1-mu)). Clipping makes the
    naive scale sqrt(icc*mu*(1-mu)) under-shoot for extreme mu; this calibration
    keeps the *realised* marginal ICC at the target so the grid means what it says.
    Returns (m0, s, realised_mean, realised_icc).
    """
    key = (round(float(mu), 8), round(float(icc), 8))
    if key in _CALIBRATION:
        return _CALIBRATION[key]
    if mu <= 0.0 or mu >= 1.0 or icc <= 0.0:
        out = (float(mu), 0.0, float(mu), 0.0)
        _CALIBRATION[key] = out
        return out
    target_var = icc * mu * (1.0 - mu)

    def scale_for(m0: float) -> float:
        lo, hi = 0.0, 12.0
        for _ in range(45):
            mid = 0.5 * (lo + hi)
            _, var = _moments(m0, mid)
            if var < target_var:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    lo, hi = -1.0, 2.0
    for _ in range(45):
        mid = 0.5 * (lo + hi)
        m, _ = _moments(mid, scale_for(mid))
        if m < mu:
            lo = mid
        else:
            hi = mid
    m0 = 0.5 * (lo + hi)
    s = scale_for(m0)
    m, var = _moments(m0, s)
    out = (m0, s, m, var / (mu * (1.0 - mu)))
    _CALIBRATION[key] = out
    return out


def norm_ppf(p: float) -> float:
    """Standard normal quantile by bisection on norm_cdf (deterministic, no scipy)."""
    lo, hi = -10.0, 10.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if float(norm_cdf(np.array([mid]))[0]) < p:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def simulate_deterministic(mus, rho, reps, sizes, seed):
    """Scenario-level binary outcomes with NO within-scenario replicate variance.

    Models a greedy/deterministic endpoint (or a runner that deduplicates identical
    prompts): all 3 'reps' of a scenario-arm return the same output, so the
    scenario-arm CVR is exactly 0 or 1. Between-arm scenario correlation is the
    Gaussian-copula rho. Used only as a sensitivity in section G2.
    """
    rng = np.random.default_rng(seed)
    n_s = int(sum(sizes))
    a = len(mus)
    z = rng.standard_normal((reps, n_s))
    e = rng.standard_normal((reps, n_s, a))
    latent = rho * z[:, :, None] + math.sqrt(max(0.0, 1.0 - rho * rho)) * e
    thresholds = np.array([norm_ppf(1.0 - m) for m in mus])
    return (latent > thresholds[None, None, :]).astype(float)


def strata_slices(sizes):
    out, start = [], 0
    for n in sizes:
        out.append(slice(start, start + n))
        start += n
    return out


# --------------------------------------------------------------------------- #
# Data generation and the three analyses
# --------------------------------------------------------------------------- #
def simulate(mus, icc, unusable, reps, runs, sizes, rho, rng):
    """Return scenario-arm CVR array (reps, n_scenarios, 4 arms) with NaN where no
    run in that scenario-arm was usable."""
    n_s = int(sum(sizes))
    a = len(ARMS)
    z = rng.standard_normal((reps, n_s))
    e = rng.standard_normal((reps, n_s, a))
    u = rho * z[:, :, None] + math.sqrt(max(0.0, 1.0 - rho * rho)) * e
    m0 = np.empty(a)
    s = np.empty(a)
    for i, mu in enumerate(mus):
        m0[i], s[i], _, _ = calibrate(mu, icc)
    p = m0[None, None, :] + s[None, None, :] * u
    np.clip(p, 0.0, 1.0, out=p)
    # Unusable-per-run: a run is unusable independently with probability `unusable`.
    v = rng.binomial(runs, 1.0 - unusable, size=(reps, n_s, a))
    k = rng.binomial(v, p)
    cvr = np.full((reps, n_s, a), np.nan)
    mask = v > 0
    cvr[mask] = k[mask] / v[mask]
    return cvr


def pair_perm_test(d, slices):
    """Sign-flip test on paired scenario differences.

    Statistic T = (1/G) * sum_g mean_g (equal stratum weights; G = strata with data).
    Null (sharp) distribution: independent sign flips of every observed d_s.
    Under that null Var(T) = (1/G^2) * sum_g (1/n_g^2) * sum_{s in g} d_s^2.
    The exact 10,000-permutation p-value is validated against this normal
    approximation below; power only needs the tail thresholds.
    """
    reps = d.shape[0]
    total = np.zeros(reps)
    null_var = np.zeros(reps)
    g_used = np.zeros(reps)
    n_used = np.zeros(reps)
    for sl in slices:
        dg = d[:, sl]
        valid = ~np.isnan(dg)
        ng = valid.sum(axis=1).astype(float)
        ok = ng > 0
        ngs = np.maximum(ng, 1.0)
        total += np.where(ok, np.nansum(dg, axis=1) / ngs, 0.0)
        g_used += ok
        null_var += np.where(ok, np.nansum(dg * dg, axis=1) / (ngs * ngs), 0.0)
        n_used += ng
    gc = np.maximum(g_used, 1.0)
    t = total / gc
    var = null_var / (gc * gc)
    se = np.sqrt(var)
    with np.errstate(divide='ignore', invalid='ignore'):
        z = np.where(se > 0, t / se, 0.0)
    p = 2.0 * (1.0 - norm_cdf(np.abs(z)))
    return dict(T=t, SE=se, z=z, p=p, n_used=n_used, g_used=g_used)


def pair_cluster_ci(d, slices):
    """Stratified cluster-robust point estimate and SE for a paired CVR difference.

    T = (1/G) sum_g mean_g; Var(T) = (1/G^2) sum_g s_g^2 / n_g with s_g^2 the
    within-stratum scenario-level sample variance of d. Large-sample limit of the
    stratified cluster bootstrap used by the analysis plan.
    """
    reps = d.shape[0]
    total = np.zeros(reps)
    var = np.zeros(reps)
    g_used = np.zeros(reps)
    n_used = np.zeros(reps)
    for sl in slices:
        dg = d[:, sl]
        valid = ~np.isnan(dg)
        ng = valid.sum(axis=1).astype(float)
        ok = ng > 0
        ngs = np.maximum(ng, 1.0)
        mean_g = np.where(ok, np.nansum(dg, axis=1) / ngs, 0.0)
        total += mean_g
        g_used += ok
        dev2 = np.where(valid, (dg - mean_g[:, None]) ** 2, 0.0)
        s2 = np.where(ng > 1.0, np.nansum(dev2, axis=1) / np.maximum(ng - 1.0, 1.0), 0.0)
        var += np.where(ok, s2 / ngs, 0.0)
        n_used += ng
    gc = np.maximum(g_used, 1.0)
    return total / gc, np.sqrt(var) / gc, n_used


def holm_support(p1, p3, t1, t3):
    """Holm over {H1, H3} at family alpha, plus the pre-registered direction rule."""
    first_is_h1 = p1 <= p3
    p_first = np.where(first_is_h1, p1, p3)
    p_second = np.where(first_is_h1, p3, p1)
    reject_first = p_first <= ALPHA / 2.0
    reject_second = reject_first & (p_second <= ALPHA)
    reject_h1 = np.where(first_is_h1, reject_first, reject_second)
    reject_h3 = np.where(first_is_h1, reject_second, reject_first)
    return (reject_h1 & (t1 < 0.0), reject_h3 & (t3 > 0.0))


def evaluate(cvr, sizes, margin_lo=0.10, margin_hi=0.15):
    """Run the pre-registered analyses on one simulated data set family."""
    slices = strata_slices(sizes)
    d1 = cvr[:, :, 1] - cvr[:, :, 0]   # memory - none
    d3 = cvr[:, :, 3] - cvr[:, :, 1]   # corrected - memory
    d2 = cvr[:, :, 1] - cvr[:, :, 2]   # memory - manual
    h1 = pair_perm_test(d1, slices)
    h3 = pair_perm_test(d3, slices)
    sup1, sup3 = holm_support(h1['p'], h3['p'], h1['T'], h3['T'])
    t2, se2, n2 = pair_cluster_ci(d2, slices)
    _, se1, n1 = pair_cluster_ci(d1, slices)
    _, se3, n3 = pair_cluster_ci(d3, slices)
    upper90 = t2 + Z90 * se2
    return dict(
        power_h1=float(sup1.mean()),
        power_h3=float(sup3.mean()),
        power_h2_lo=float((upper90 < margin_lo).mean()),
        power_h2_hi=float((upper90 < margin_hi).mean()),
        mean_t1=float(np.mean(h1['T'])),
        mean_t2=float(np.mean(t2)),
        mean_t3=float(np.mean(h3['T'])),
        ci90_h2=float(np.mean(2.0 * Z90 * se2)),
        ci95_h1=float(np.mean(2.0 * Z975 * se1)),
        ci95_h3=float(np.mean(2.0 * Z975 * se3)),
        mdd_h1=float((Z975 + Z80) * np.mean(se1)),
        mdd_ni_margin=float((Z90 + Z80) * np.mean(se2)),
        n_pair=float(np.mean(n2)),
    )


def run_cell(none, memory, manual, icc, unusable, reps, runs=3, sizes=N_HIGH,
             rho=RHO_SHARED, cell_seed=0):
    rng = np.random.default_rng([SIM_SEED, int(cell_seed)])
    mus = (none, memory, manual, none)  # corrected CVR = none (fixed by design)
    cvr = simulate(list(mus), icc, unusable, reps, runs, sizes, rho, rng)
    return evaluate(cvr, sizes)


# --------------------------------------------------------------------------- #
# Literal (un-approximated) procedures for the validation block
# --------------------------------------------------------------------------- #
def literal_perm_p(d, slices, rng, n_perm):
    """Exact sign-flip permutation p-value (equal stratum weights), per replicate."""
    reps = d.shape[0]
    out = np.empty(reps)
    for i in range(reps):
        row = d[i]
        valid_g = [sl for sl in slices if (~np.isnan(row[sl])).any()]
        g_used = len(valid_g)
        t_obs = 0.0
        for sl in valid_g:
            dv = row[sl][~np.isnan(row[sl])]
            t_obs += dv.mean() / g_used
        t_star = np.zeros(n_perm)
        for sl in valid_g:
            dv = row[sl][~np.isnan(row[sl])]
            # Elementwise multiply+sum, not matmul: int x float matmul raises
            # spurious FPE RuntimeWarnings on this numpy build although the
            # arithmetic is finite and identical.
            eps = rng.integers(0, 2, size=(n_perm, dv.size)) * 2 - 1
            t_star += (eps * dv).sum(axis=1) / (dv.size * g_used)
        out[i] = (1.0 + np.count_nonzero(np.abs(t_star) >= abs(t_obs) - 1e-12)) / (n_perm + 1.0)
    return out


def literal_boot_ci(d, slices, rng, n_boot, level):
    """Stratified cluster-bootstrap point estimates (percentile interval endpoints)."""
    reps = d.shape[0]
    lo = np.empty(reps)
    hi = np.empty(reps)
    for i in range(reps):
        row = d[i]
        valid_g = [sl for sl in slices if (~np.isnan(row[sl])).any()]
        g_used = len(valid_g)
        t_star = np.zeros(n_boot)
        for sl in valid_g:
            dv = row[sl][~np.isnan(row[sl])]
            idx = rng.integers(0, dv.size, size=(n_boot, dv.size))
            t_star += dv[idx].mean(axis=1) / g_used
        lo[i], hi[i] = np.quantile(t_star, [(1.0 - level) / 2.0, 1.0 - (1.0 - level) / 2.0])
    return lo, hi


# --------------------------------------------------------------------------- #
# Transcript sections
# --------------------------------------------------------------------------- #
def hline(ch='='):
    print(ch * 100)


def section(title):
    print()
    hline()
    print(title)
    hline()


def print_assumptions(reps, elapsed_calibration):
    section('A. WHAT THIS IS')
    print('SIMULATION UNDER ASSUMPTIONS - NOT OBSERVED DATA. No Phase 17, pilot or')
    print('Study 02 run record is used or implied here. Every number is a prediction')
    print('from the generative model below, conditional on the stated assumptions.')
    print()
    print(f'numpy {np.__version__}; Python {__import__("sys").version.split()[0]}')
    print(f'replicates per grid cell: {reps} (Monte Carlo SE of a power estimate <= '
          f'{0.5 / math.sqrt(reps):.3f})')
    print(f'stratified sign-flip validation uses literal 10,000-permutation test;')
    print(f'cluster-bootstrap validation uses literal resampling (see section H).')
    print(f'primary grid: 3x3x3x4x3 = 324 data-generating cells, corrected CVR = none')
    print(f'ICC calibration solved numerically in {elapsed_calibration:.1f} s')
    print()
    print('Design emulated (lead-fixed): 4 arms, 6 strata, 200 pre-registered')
    print('high-opportunity scenarios (35/35/35/35/30/30 ASSUMED within-stratum split),')
    print('3 runs per scenario-arm at a non-zero temperature, unit of analysis = scenario.')
    print()
    print('Generative model per arm a with marginal CVR mu_a:')
    print('  p_{s,a} = clip(m0_a + s_a * (rho*z_s + sqrt(1-rho^2)*e_{s,a}), 0, 1)')
    print('  z_s, e_{s,a} ~ N(0,1);  run r: violation ~ Bernoulli(p_{s,a})')
    print('  run r: unusable ~ Bernoulli(u), independent of the violation process')
    print('  m0_a, s_a calibrated so marginal CVR = mu_a and binary ICC = Var(p)/(mu(1-mu))')
    print(f'  rho = {RHO_SHARED} (shared share of the scenario deviation across arms; '
          'sensitivity in G)')
    print()
    print('Tests emulated (see 04-ANALYSIS-PLAN.md):')
    print('  H1 memory<none, H3 corrected>memory: stratified sign-flip permutation test,')
    print('     equal stratum weights, two-sided p, Holm family alpha .05, direction required.')
    print('  H2 memory non-inferior to manual: upper 90% cluster-robust bound of the CVR')
    print('     difference below the margin; margins 10 pp and 15 pp both evaluated.')
    print('  Power uses the normal approximation to each procedure; section H validates it.')


def print_calibration():
    section('B. ICC CALIBRATION (target vs realised, from the clipping model)')
    print(f'{"marginal CVR":>12} {"target ICC":>10} {"m0":>8} {"scale s":>9} '
          f'{"realised mean":>13} {"realised ICC":>12}')
    for mu in (0.0, 0.03, 0.05, 0.10, 0.50, 0.65, 0.80):
        for icc in ICC_VALUES:
            m0, s, rm, ricc = calibrate(mu, icc)
            print(f'{mu:>12.2f} {icc:>10.2f} {m0:>8.3f} {s:>9.3f} {rm:>13.3f} {ricc:>12.3f}')
    print()
    print('ICC is the binary-outcome ICC Var(p_s)/(mu(1-mu)); mu=0 or ICC=0 has no')
    print('scenario variance by construction. Clipping keeps the realised ICC equal to')
    print('the target; the realised marginal mean is held at the target mu as well.')


def grid_rows():
    """All 324 code-generating cells in a fixed order."""
    rows = []
    for none in NONE_RATES:
        for memory in MEMORY_RATES:
            for manual in MANUAL_RATES:
                for icc in ICC_VALUES:
                    for unusable in UNUSABLE_RATES:
                        rows.append((none, memory, manual, icc, unusable))
    return rows


def print_grid(rows, results):
    section('C. FULL FACTORIAL GRID - power of H1 / H2(10pp) / H2(15pp) / H3')
    print('H2 is non-inferiority of memory vs manual; margins 10 pp (lo) and 15 pp (hi).')
    print('CI90 = mean 90% cluster-robust width of the memory-manual CVR difference.')
    print('CI95H1 = mean 95% width of the memory-none CVR difference; MDD = minimum')
    print('detectable H1 difference at 80% power, pp. "n_pair" = mean valid scenario')
    print('pairs out of 200. Corrected CVR = none (fixed).')
    print()
    hdr = (f'{"none":>5} {"mem":>5} {"man":>5} {"icc":>5} {"unus":>5}  '
           f'{"H1":>5} {"H2@10":>6} {"H2@15":>6} {"H3":>5}  '
           f'{"CI90pp":>7} {"CI95pp":>7} {"MDDpp":>7} {"n_pair":>7}')
    print(hdr)
    print('-' * len(hdr))
    for (none, memory, manual, icc, unusable), r in zip(rows, results):
        print(f'{none:>5.2f} {memory:>5.3f} {manual:>5.3f} {icc:>5.2f} {unusable:>5.2f}  '
              f'{r["power_h1"]:>5.3f} {r["power_h2_lo"]:>6.3f} {r["power_h2_hi"]:>6.3f} '
              f'{r["power_h3"]:>5.3f}  {100 * r["ci90_h2"]:>7.2f} {100 * r["ci95_h1"]:>7.2f} '
              f'{100 * r["mdd_h1"]:>7.2f} {r["n_pair"]:>7.1f}')


def print_summary(rows, results):
    section('D. HEADLINE - default assumptions')
    d = DEFAULT
    r = run_cell(d['none'], d['memory'], d['manual'], d['icc'], d['unusable'],
                 reps=4000, cell_seed=900001)
    print(f'DEFAULT CELL (assumed, pilot-calibrated): none CVR {d["none"]:.2f}, '
          f'memory {d["memory"]:.3f}, manual {d["manual"]:.3f}, corrected = none, '
          f'ICC {d["icc"]:.2f}, unusable {d["unusable"]*100:.0f}%, rho {d["rho"]:.1f}')
    print('  NOTE: default manual CVR 0.05 is conservative; Phase 17 observed 0.00 on')
    print('  both models and memory 0.00 / 0.017.')
    print()
    print(f'  H1 memory < none              power = {r["power_h1"]:.3f}')
    print(f'  H2 memory non-inferior @10pp  power = {r["power_h2_lo"]:.3f}')
    print(f'  H2 memory non-inferior @15pp  power = {r["power_h2_hi"]:.3f}')
    print(f'  H3 corrected > memory         power = {r["power_h3"]:.3f}')
    print(f'  expected 90% CI width, H2 RD      = {100 * r["ci90_h2"]:.2f} pp')
    print(f'  expected 95% CI width, H1 RD      = {100 * r["ci95_h1"]:.2f} pp')
    print(f'  H2 minimum detectable NI margin at 80% power (delta=0) = '
          f'{100 * r["mdd_ni_margin"]:.2f} pp')
    print(f'  H1 minimum detectable difference at 80% power           = '
          f'{100 * r["mdd_h1"]:.2f} pp')
    print(f'  mean valid scenario pairs (H2)    = {r["n_pair"]:.1f} / 200')
    print()
    min_h1 = min(r['power_h1'] for r in results)
    min_h3 = min(r['power_h3'] for r in results)
    print(f'  Across the whole grid: minimum H1 power = {min_h1:.3f}, minimum H3 power')
    print(f'  = {min_h3:.3f} (all cells), because every grid none/memory contrast is at')
    print('  least 40 pp. H1/H3 are not the binding constraint; H2 is.')


def print_margin_slices(rows, results):
    section('E. WHERE H2 POWER FAILS - margin slices')
    print('H2 power is < 0.80 only when the true memory-manual gap is close to or above')
    print('the margin (a real difference, not a power defect), or in cells with high ICC')
    print('and a large memory/manual gap. Cells with H2@10 < 0.80:')
    print(f'{"none":>5} {"mem":>5} {"man":>5} {"icc":>5} {"unus":>5}  '
          f'{"H2@10":>6} {"H2@15":>6}')
    bad10 = [(row, r) for row, r in zip(rows, results) if r['power_h2_lo'] < 0.80]
    for (none, memory, manual, icc, unusable), r in bad10:
        print(f'{none:>5.2f} {memory:>5.3f} {manual:>5.3f} {icc:>5.2f} {unusable:>5.2f}  '
              f'{r["power_h2_lo"]:>6.3f} {r["power_h2_hi"]:>6.3f}')
    bad15 = [r for r in results if r['power_h2_hi'] < 0.80]
    print(f'\n  {len(bad10)} of {len(rows)} cells have H2@10 power < 0.80; '
          f'{len(bad15)} of {len(rows)} have H2@15 power < 0.80.')
    print()
    # The design is "calibrated" if the memory and manual rates are close. Evaluate
    # every cell whose true memory-manual gap is <= 3 pp (i.e. the non-inferiority
    # null is not already false at the margin-relevant scale).
    for label, keep in (
        ('memory <= manual + 3 pp (calibrated arm parity)', lambda m, n: (m - n) <= 0.03),
        ('true gap >= 5 pp against memory (adverse)', lambda m, n: (m - n) >= 0.05),
    ):
        sub = [(row, r) for row, r in zip(rows, results) if keep(row[1], row[2])]
        if not sub:
            continue
        print(f'  SUBSET "{label}" (n={len(sub)} cells): min H2@10 power = '
              f'{min(r["power_h2_lo"] for _, r in sub):.3f}, min H2@15 power = '
              f'{min(r["power_h2_hi"] for _, r in sub):.3f}')
    print()
    print('Reading: at the pilot-calibrated rates (memory ~= manual <= 5%) H2@10 is')
    print('powered > 0.99 in every ICC and unusable cell. The failures are exactly the')
    print('cells where the true memory rate exceeds manual by ~10 pp: there the')
    print('non-inferiority claim would be false, and the honest report is "not')
    print('established", not "underpowered". The +15 pp margin buys power only in the')
    print('middle of that adverse region; it cannot rescue a true 10 pp gap.')


def print_design_options():
    section('F. DESIGN-CHANGE OPTIONS (mission constraint default: 400 scenarios x 3 runs)')
    print('If the pilot lands on the ADVERSE rates (memory 0.10, manual 0.00) the 10 pp')
    print('margin cannot be shown at 80% power - the true gap equals the margin. The')
    print('table shows what a design change would buy. "high-op runs" = high-opportunity')
    print('executions that enter the primary CVR analysis; the 3-run rows keep the total')
    print('at 4,800 (200 low-opportunity scenarios x 4 arms x 3 runs in the default); the')
    print('5-run row needs ~8,000 total executions. "high-op" scenarios replace')
    print('low-opportunity ones within the 400 unless noted.')
    print()
    cases = [
        ('default 200 high/200 low, 3 runs', 200, 3, DEFAULT),
        ('300 high/100 low, 3 runs', 300, 3, DEFAULT),
        ('400 high/0 low, 3 runs', 400, 3, DEFAULT),
        ('200 high/200 low, 5 runs', 200, 5, DEFAULT),
        ('default 200 high/200 low, 3 runs', 200, 3, ADVERSE),
        ('300 high/100 low, 3 runs', 300, 3, ADVERSE),
        ('400 high/0 low, 3 runs', 400, 3, ADVERSE),
        ('200 high/200 low, 5 runs', 200, 5, ADVERSE),
    ]

    def sizes_for(total):
        if total == 200:
            return N_HIGH
        # Keep the design's 35:30 game:focus ratio and make the sizes sum exactly.
        game = (total * 35) // 200
        focus = (total * 30) // 200
        sizes = [game] * 4 + [focus] * 2
        remainder = total - sum(sizes)
        i = 0
        while remainder > 0:
            sizes[i % 6] += 1
            remainder -= 1
            i += 1
        return tuple(sizes)

    print(f'{"design":>36} {"rates":>8} {"hi-op":>6}  {"H2@10":>6} {"H2@15":>6} '
          f'{"CI90pp":>7} {"MDDni":>6}')
    print('-' * 84)
    for label, n_high, runs, case in cases:
        sizes = sizes_for(n_high)
        total_runs = sum(sizes) * 4 * runs
        r = run_cell(case['none'], case['memory'], case['manual'], case['icc'],
                     case['unusable'], reps=1000, runs=runs, sizes=sizes,
                     rho=case['rho'], cell_seed=800000 + n_high * 10 + runs)
        tag = 'adverse' if case is ADVERSE else 'default'
        print(f'{label:>36} {tag:>8} {total_runs:>6}  {r["power_h2_lo"]:>6.3f} '
              f'{r["power_h2_hi"]:>6.3f} {100 * r["ci90_h2"]:>7.2f} '
              f'{100 * r["mdd_ni_margin"]:>6.2f}')
    print()
    print('Increasing runs per scenario (3 -> 5) is the cheapest variance reduction for')
    print('H2 because it shrinks the within-scenario binomial noise; adding high-opportunity')
    print('scenarios shrinks both components. Going to 400 high / 0 low destroys the')
    print('pre-registered opportunity-class contrast and is NOT recommended; it is shown')
    print('only to quantify the trade-off. The mission default (400 x 3) is kept.')


def print_rho_sensitivity():
    section('G. PAIRING-CORRELATION SENSITIVITY (rho = 0, 0.5, 1)')
    print('The design pairs arms within scenario. How much the pairing helps H2 depends on')
    print('how correlated the scenario-level deviations are across arms - unknowable until')
    print('the pilot. rho=0 (arm-specific scenario effects) is the conservative corner.')
    print()
    print(f'{"case":>10} {"rho":>5} {"H2@10":>7} {"H2@15":>7} {"CI90pp":>7} {"H1":>5} {"H3":>5}')
    for case_name, case in (('default', DEFAULT), ('adverse', ADVERSE)):
        for rho in (0.0, 0.5, 1.0):
            r = run_cell(case['none'], case['memory'], case['manual'], case['icc'],
                         case['unusable'], reps=2000, rho=rho,
                         cell_seed=700000 + int(rho * 10))
            print(f'{case_name:>10} {rho:>5.1f} {r["power_h2_lo"]:>7.3f} '
                  f'{r["power_h2_hi"]:>7.3f} {100 * r["ci90_h2"]:>7.2f} '
                  f'{r["power_h1"]:>5.3f} {r["power_h3"]:>5.3f}')


def print_deterministic_endpoint():
    section('G2. DETERMINISTIC-ENDPOINT SENSITIVITY (temperature 0 / no replicate variance)')
    print('If the confirmatory endpoint cannot sample (greedy decoding) or the runner')
    print('deduplicates identical prompts, the 3 reps are copies: the scenario-arm CVR is')
    print('exactly 0 or 1 and the effective sample size is 200 scenarios, not 600 runs.')
    print('This is the worst case for the ICC assumption. Simulated directly with a')
    print('Gaussian-copula scenario-level binary outcome (no calibration model needed).')
    print()
    print(f'{"case":>10} {"rho":>5} {"H1":>5} {"H2@10":>7} {"H2@15":>7} {"H3":>5} '
          f'{"CI90pp":>7} {"MDDni":>6}')
    for case_name, case in (('default', DEFAULT), ('adverse', ADVERSE)):
        for rho in (0.0, 0.5, 1.0):
            cvr = simulate_deterministic(
                [case['none'], case['memory'], case['manual'], case['none']],
                rho, 2000, N_HIGH, 424242)
            r = evaluate(cvr, N_HIGH)
            print(f'{case_name:>10} {rho:>5.1f} {r["power_h1"]:>5.3f} '
                  f'{r["power_h2_lo"]:>7.3f} {r["power_h2_hi"]:>7.3f} '
                  f'{r["power_h3"]:>5.3f} {100 * r["ci90_h2"]:>7.2f} '
                  f'{100 * r["mdd_ni_margin"]:>6.2f}')
    print()
    print('At the pilot-calibrated rates the design still has H2@10 power 1.00 and a')
    print('~6 pp 90% CI under a deterministic endpoint; the adverse 10 pp true gap is')
    print('still not showable at 10 pp (a real difference), and 15 pp power drops to')
    print('~0.72-0.75. Section G2 therefore does not change the recommendation, but the')
    print('temperature/rep feasibility must be tested in the pilot (O3/O8).')


def print_validation():
    section('H. LITERAL-PROCEDURE VALIDATION OF THE NORMAL APPROXIMATION')
    print('Same simulated data analysed twice: (i) the literal 10,000-permutation')
    print('sign-flip test and literal 2,000-resample stratified cluster bootstrap used by')
    print('the analysis plan, (ii) the normal approximation used for the grid. This checks')
    print('the approximation, not the design assumptions.')
    print()
    v_cases = [
        ('mid-power H1/H3 (validation-only rates)', (0.50, 0.42, 0.42, 0.50), 0.25, 0.05),
        ('H2 stress (grid rates)', (0.65, 0.10, 0.00, 0.65), 0.25, 0.10),
    ]
    n_perm, n_boot, reps = 10000, 2000, 300
    print(f'{"validation case":>42}  {"procedure":>22} {"analytic":>9} {"literal":>8} '
          f'{"diff":>7}')
    print('-' * 96)
    for label, mus, icc, unusable in v_cases:
        rng = np.random.default_rng([SIM_SEED, 600001])
        cvr = simulate(list(mus), icc, unusable, reps, 3, N_HIGH, RHO_SHARED, rng)
        slices = strata_slices(N_HIGH)
        d1 = cvr[:, :, 1] - cvr[:, :, 0]
        d3 = cvr[:, :, 3] - cvr[:, :, 1]
        d2 = cvr[:, :, 1] - cvr[:, :, 2]

        an_h1 = pair_perm_test(d1, slices)
        an_h3 = pair_perm_test(d3, slices)
        an_s1, an_s3 = holm_support(an_h1['p'], an_h3['p'], an_h1['T'], an_h3['T'])
        an_t2, an_se2, _ = pair_cluster_ci(d2, slices)
        an_h2 = (an_t2 + Z90 * an_se2 < 0.10).mean()

        boot_rng = np.random.default_rng([BOOT_SEED, 600001])
        lo, hi = literal_boot_ci(d2, slices, boot_rng, n_boot, 0.90)
        lit_h2 = (hi < 0.10).mean()
        lit_ci90 = float(np.mean(hi - lo))
        an_ci90 = float(np.mean(2.0 * Z90 * an_se2))

        lo1, hi1 = literal_boot_ci(d1, slices, boot_rng, n_boot, 0.95)
        lit_ci95 = float(np.mean(hi1 - lo1))

        perm_rng = np.random.default_rng([PERM_SEED, 600001])
        lp1 = literal_perm_p(d1, slices, perm_rng, n_perm)
        lp3 = literal_perm_p(d3, slices, perm_rng, n_perm)
        ls1, ls3 = holm_support(lp1, lp3, an_h1['T'], an_h3['T'])
        lit_h1, lit_h3 = float(ls1.mean()), float(ls3.mean())
        an_ci95 = float(np.mean(2.0 * Z975 * pair_cluster_ci(d1, slices)[1]))

        for name, a, l in (
            ('H1 power', an_s1.mean(), lit_h1),
            ('H2@10 power', an_h2, lit_h2),
            ('H3 power', an_s3.mean(), lit_h3),
        ):
            print(f'{label:>42}  {"sign-flip/bootstrap":>22} {a:>9.3f} {l:>8.3f} '
                  f'{l - a:>+7.3f}')
        print(f'{"":>42}  {"H2 CI90 width (pp)":>22} {100 * an_ci90:>9.2f} '
              f'{100 * lit_ci90:>8.2f} {100 * (lit_ci90 - an_ci90):>+7.2f}')
        print(f'{"":>42}  {"H1 CI95 width (pp)":>22} {100 * an_ci95:>9.2f} '
              f'{100 * lit_ci95:>8.2f} {100 * (lit_ci95 - an_ci95):>+7.2f}')
        print()
    print(f'Literal procedures: n_perm = {n_perm} sign flips, n_boot = {n_boot} resamples,')
    print(f'{reps} replicates. Monte Carlo SE of a power difference near 0.5 is about')
    print(f'{math.sqrt(2 * 0.25 / reps):.3f}, so differences below ~0.05 are not material.')
    print('Permutation/bootstrap uses the analysis-plan seeds PERM_SEED / BOOT_SEED.')


def print_recommendation():
    section('I. RECOMMENDATION (read with section D and E)')
    print('1. 400 scenarios x 3 runs is ADEQUATE for the primary family at the default')
    print('   (pilot-calibrated) rates: H1, H3 and H2 at a +10 pp margin are each')
    print('   powered > 0.99. The design constraint can therefore stay at 400 x 3.')
    print('2. Recommended H2 margin: +10 pp. The expected 90% CI half-width on the')
    print('   memory-manual difference is ~2-3 pp, well inside 10 pp, so the stronger')
    print('   non-inferiority claim is affordable; +15 pp is a fallback only.')
    print('3. Pre-registered margin rule (fixed after the pilot, before the confirmatory')
    print('   runs): use +10 pp unless the pilot shows memory CVR >= 8% or a')
    print('   manual-minus-memory gap >= 5 pp, in which case fix +15 pp. The pilot is')
    print('   excluded from the confirmatory analysis and this rule is not revisited')
    print('   once the confirmatory runs start.')
    print('4. If the true memory-manual gap is itself >= 10 pp, no design of this size')
    print('   can show non-inferiority at 10 pp - that is a real difference, not a power')
    print('   defect. Report it as non-inferiority not established, not as equivalence.')
    print('5. Do NOT add optional stopping or interim looks to buy power. If the pilot')
    print('   demands more, the ranked options are: (i) margin +15 pp (no extra runs),')
    print('   (ii) 5 runs per scenario-arm (7,200 executions), (iii) more high-opportunity')
    print('   scenarios. Options (ii)/(iii) are contingent and must be decided at freeze.')
    print()
    print('DESIGN ISSUES FOUND (to be resolved before the freeze, not silently changed):')
    print(' a. The within-stratum allocation of the 200 high-opportunity scenarios is not')
    print('    specified in the fixed design. The simulation assumes 35/35/35/35/30/30;')
    print('    design/ must freeze the allocation before the pilot.')
    print(' b. The pairing correlation rho across arms is unidentifiable until the pilot;')
    print('    H2 power at rho=0 is shown in section G and is still adequate at 10 pp.')
    print(' c. Scenarios sharing a frozen baseline variant (10 variants per baseline')
    print('    family) are correlated beyond scenario level. The scenario-cluster')
    print('    bootstrap does not capture that; add a variant-stratified bootstrap')
    print('    sensitivity and/or a variant-cluster robust check (see 04-ANALYSIS-PLAN.md).')
    print(' d. At non-zero temperature, repetitions of an identical prompt may be cached')
    print('    or deduplicated by the runner. The runner must be frozen so every rep is a')
    print('    fresh call; otherwise reps are not technical replicates and ICC -> 1.')
    print(' e. The confirmatory endpoint/model is not yet fixed (Dell local vs Muse Spark),')
    print('    and the pilot-calibrated rates differ by model (Phase 17 none: 64.9% vs')
    print('    81.7%; unusable: 3.3% vs 0%). These power numbers assume one endpoint')
    print('    with the default rates and must be re-checked at freeze.')


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--reps', type=int, default=2000,
                    help='replicates per grid cell (default 2000)')
    ap.add_argument('--quick', action='store_true', help='smoke test: 50 reps, small grid')
    ap.add_argument('--skip-validation', action='store_true')
    args = ap.parse_args()

    t0 = time.time()
    # Warm the ICC calibration cache and report its cost.
    for mu in (0.0, 0.03, 0.05, 0.10, 0.50, 0.65, 0.80):
        for icc in ICC_VALUES:
            calibrate(mu, icc)
    t_cal = time.time() - t0

    reps = args.reps
    if args.quick:
        reps = 50

    print('Study 02 - Rare-Trigger Reliability: power simulation')
    print('generated by power_study2.py; deterministic; transcript is the deliverable')
    print(f'run started: {time.strftime("%Y-%m-%dT%H:%M:%S%z")}')
    print_assumptions(reps, t_cal)
    print_calibration()

    rows = grid_rows()
    if args.quick:
        rows = rows[:6]
        results = [run_cell(*row, reps=reps, cell_seed=i)
                   for i, row in enumerate(rows)]
    else:
        results = [run_cell(*row, reps=reps, cell_seed=i)
                   for i, row in enumerate(rows)]
    print_grid(rows, results)
    print_summary(rows, results)
    print_margin_slices(rows, results)
    print_design_options()
    print_rho_sensitivity()
    print_deterministic_endpoint()
    if not args.skip_validation and not args.quick:
        print_validation()
    print_recommendation()

    print()
    hline()
    print(f'finished in {time.time() - t0:.1f} s; {reps} replicates/cell; '
          f'{len(rows)} cells; grid total {reps * len(rows):,} simulated trials')
    print('SIMULATION UNDER ASSUMPTIONS - NOT OBSERVED DATA.')
    hline()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
