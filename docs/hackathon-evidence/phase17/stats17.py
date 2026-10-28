"""Phase 17 statistics: exact stratified test, Newcombe interval, Fisher.

Pure standard library so the verifier and the power simulation use the same code.
"""
from __future__ import annotations

import math


def hypergeom(n1: int, n0: int, m: int) -> dict[int, float]:
    """P(a violations in the first group | margins), a from max(0, m-n0) to min(n1, m)."""
    den = math.comb(n1 + n0, m)
    return {a: math.comb(n1, a) * math.comb(n0, m - a) / den for a in range(max(0, m - n0), min(n1, m) + 1)}


def stratified_exact(strata: list[tuple[int, int, int, int]]) -> float:
    """Two-sided exact conditional test of no association, stratified.

    Each stratum is (k1, n1, k0, n0): violations and usable runs in the two arms.
    The statistic is the total violations in arm 1; its null distribution is the
    convolution of the per-stratum hypergeometric distributions. Two-sided p sums
    every total no more probable than the observed one (Fisher's rule).
    """
    dist = {0: 1.0}
    observed = 0
    for k1, n1, k0, n0 in strata:
        if n1 == 0 or n0 == 0:
            continue
        observed += k1
        h = hypergeom(n1, n0, k1 + k0)
        nxt: dict[int, float] = {}
        for t, p in dist.items():
            for a, q in h.items():
                nxt[t + a] = nxt.get(t + a, 0.0) + p * q
        dist = nxt
    p_obs = dist.get(observed, 0.0)
    return min(1.0, sum(p for p in dist.values() if p <= p_obs * (1 + 1e-9) + 1e-15))


def fisher(a: int, b: int, c: int, d: int) -> float:
    return stratified_exact([(a, a + b, c, c + d)])


def wilson(k: int, n: int, z: float) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def newcombe(k1: int, n1: int, k2: int, n2: int, level: float = 0.95) -> tuple[float, float, float]:
    """Risk difference p1 - p2 with the Newcombe hybrid score interval."""
    z = {0.95: 1.959963984540054, 0.90: 1.6448536269514722}[level]
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1, z)
    l2, u2 = wilson(k2, n2, z)
    d = p1 - p2
    return d, d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)


def holm(pvalues: dict[str, float], alpha: float) -> dict[str, bool]:
    order = sorted(pvalues, key=pvalues.get)
    rejected: dict[str, bool] = {}
    still = True
    for i, name in enumerate(order):
        still = still and pvalues[name] <= alpha / (len(order) - i)
        rejected[name] = still
    return rejected
