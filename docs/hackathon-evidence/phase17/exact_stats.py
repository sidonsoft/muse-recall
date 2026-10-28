"""Post-run exact re-analysis of the Phase 17 pre-registered tests.

The locked analysis (`analyze_phase17.py` + `stats17.py`) computes the stratified
exact p-value with a floating-point rule

    p <= p_observed * (1 + 1e-9) + 1e-15

The `+ 1e-15` is an absolute floor: whenever the observed tail probability is far
below 1e-15 (which it is in four of the eight pre-registered tests), the rule
also counts every outcome whose probability is at most 1e-15, so the reported
value becomes an upper bound near 1e-16…1e-15 rather than the exact p. The
locked implementation and its output (`phase17-analysis.json`) are preserved
unchanged as the as-run record; this module recomputes the same pre-registered
tests in exact rational arithmetic and records the exact values.

No test, stratum, arm, detector, exclusion or verdict rule is changed here.

Usage (from anywhere):
    python3 -I docs/hackathon-evidence/phase17/exact_stats.py --write
    python3 -I docs/hackathon-evidence/phase17/exact_stats.py --check

`--check` exits nonzero unless the committed corrected file reproduces exactly
from the raw trial records. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from fractions import Fraction
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent.parent.parent

METHOD = (
    'exact rational stratified test (Fraction arithmetic), Fisher\'s rule '
    '(two-sided: sum every outcome no more probable than the observed one, '
    'ties included), with Newcombe hybrid score intervals; no tolerance'
)

MARGIN = Fraction(15, 100)
ALPHA = Fraction(5, 100)
EXPECTED_MEMORIES = {'none': 0, 'memory': 2, 'manual': 1, 'corrected': 2}


def load_design(root: Path) -> dict:
    return json.loads((root / 'docs/hackathon-evidence/phase17/design.json').read_text(encoding='utf-8'))


def detectors(root: Path):
    sys.path.insert(0, str(root / 'docs/hackathon-evidence/phase17'))
    from detectors import DETECTORS  # noqa: F401  (import after sys.path)

    return DETECTORS


def analyse_model(root: Path, design: dict, model: str) -> dict:
    det = detectors(root)
    folder = root / 'docs/hackathon-evidence/phase17/out' / model
    strata = [s['id'] for s in design['strata']]
    baseline = {s['id']: s['baseline'] for s in design['strata']}
    rows = []
    for f in sorted(folder.glob(f'{model}-shard-*.json')):
        rows += json.loads(f.read_text(encoding='utf-8'))['results']

    def rule_of(stratum):
        return design['rules'][design['baselines'][baseline[stratum]]['rule']]

    def cells(sensitivity: bool):
        c = defaultdict(lambda: {'usable': 0, 'violations': 0, 'unusable': 0})
        for r in rows:
            cell = c[(r['stratum'], r['arm'])]
            html = folder / f"{r['id']}.html"
            if r['status'] == 'succeeded' and html.exists():
                name = rule_of(r['stratum'])['sensitivity' if sensitivity else 'detector']
                cell['usable'] += 1
                cell['violations'] += det[name](html.read_text(encoding='utf-8')).violation
            else:
                cell['unusable'] += 1
        return c

    def pairs(c, arm1, arm0, worst=False):
        out = []
        for s in strata:
            a, b = c[(s, arm1)], c[(s, arm0)]
            if worst:
                out.append((a['violations'] + a['unusable'], a['usable'] + a['unusable'],
                            b['violations'] + b['unusable'], b['usable'] + b['unusable']))
            else:
                out.append((a['violations'], a['usable'], b['violations'], b['usable']))
        return out

    def exact_p(prs) -> Fraction:
        dist = {0: Fraction(1)}
        observed = 0
        for k1, n1, k0, n0 in prs:
            if n1 == 0 or n0 == 0:
                continue
            observed += k1
            m = k1 + k0
            den = comb(n1 + n0, m)
            h = {a: Fraction(comb(n1, a) * comb(n0, m - a), den)
                 for a in range(max(0, m - n0), min(n1, m) + 1)}
            nxt = defaultdict(Fraction)
            for t, p in dist.items():
                for a, q in h.items():
                    nxt[t + a] += p * q
            dist = nxt
        p_obs = dist.get(observed, Fraction(0))
        return sum((p for p in dist.values() if p <= p_obs), Fraction(0))

    def pooled(c, arm):
        return sum(c[(s, arm)]['violations'] for s in strata), sum(c[(s, arm)]['usable'] for s in strata)

    def wilson(k, n, z):
        if n == 0:
            return 0.0, 1.0
        p = k / n
        d = 1 + z * z / n
        centre = (p + z * z / (2 * n)) / d
        half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
        return max(0.0, centre - half), min(1.0, centre + half)

    def newcombe(k1, n1, k2, n2, level=0.95):
        z = {0.95: 1.959963984540054, 0.90: 1.6448536269514722}[level]
        if n1 == 0 or n2 == 0:
            raise ValueError('Newcombe interval needs at least one usable run per arm')
        p1, p2 = k1 / n1, k2 / n2
        l1, u1 = wilson(k1, n1, z)
        l2, u2 = wilson(k2, n2, z)
        d = p1 - p2
        return d, d - ((p1 - l1) ** 2 + (u2 - p2) ** 2) ** 0.5, d + ((u1 - p1) ** 2 + (p2 - l2) ** 2) ** 0.5

    def holm(pvalues):
        order = sorted(pvalues, key=pvalues.get)
        out, still = {}, True
        for i, name in enumerate(order):
            still = still and pvalues[name] <= ALPHA / (len(order) - i)
            out[name] = still
        return out

    published = json.loads((root / 'docs/hackathon-evidence/phase17/phase17-analysis.json').read_text(encoding='utf-8'))['models'][model]
    result = {}
    for label, sensitivity, key in (
        ('primary', False, 'primary'),
        ('sensitivity_detector', True, 'sensitivity_detector'),
    ):
        c = cells(sensitivity)
        p1 = exact_p(pairs(c, 'memory', 'none'))
        p3 = exact_p(pairs(c, 'corrected', 'memory'))
        k1, n1 = pooled(c, 'memory')
        k0, n0 = pooled(c, 'none')
        k3, n3 = pooled(c, 'corrected')
        ka, na = pooled(c, 'manual')
        d1, l1, u1 = newcombe(k1, n1, k0, n0)
        d3, l3, u3 = newcombe(k3, n3, k1, n1)
        d2, l2, u2 = newcombe(k1, n1, ka, na, 0.90)
        rejected = holm({'H1': p1, 'H3': p3})
        block = {
            'totals': {
                arm: {
                    'violations': sum(c[(s, arm)]['violations'] for s in strata),
                    'usable': sum(c[(s, arm)]['usable'] for s in strata),
                    'unusable': sum(c[(s, arm)]['unusable'] for s in strata),
                }
                for arm in design['arms']
            },
            'H1_memory_vs_none': {
                'arm': f'{k1}/{n1}', 'control': f'{k0}/{n0}',
                'risk_difference': d1, 'ci95': [l1, u1],
                'p': float(p1), 'published_p': published[key]['H1_memory_vs_none']['p'],
                'supported': bool(rejected['H1'] and d1 < 0),
            },
            'H2_memory_noninferior_to_manual': {
                'memory': f'{k1}/{n1}', 'manual': f'{ka}/{na}',
                'risk_difference': d2, 'ci90': [l2, u2], 'margin': 0.15,
                'supported': bool(u2 < 0.15),
            },
            'H3_corrected_vs_memory': {
                'arm': f'{k3}/{n3}', 'control': f'{k1}/{n1}',
                'risk_difference': d3, 'ci95': [l3, u3],
                'p': float(p3), 'published_p': published[key]['H3_corrected_vs_memory']['p'],
                'supported': bool(rejected['H3'] and d3 > 0),
            },
            'worst_case_H1': {
                'p': float(exact_p(pairs(c, 'memory', 'none', worst=True))),
                'published_p': published[key]['worst_case_H1_p'],
            },
        }
        result[label] = block
    return result


def build(root: Path) -> dict:
    design = load_design(root)
    models = [m for m in design['models'] if (root / 'docs/hackathon-evidence/phase17/out' / m).exists()]
    return {
        'kind': 'phase17-post-run-stats-correction',
        'status': 'corrects reported p-values only; the pre-registered tests, cells, detectors, exclusions and verdict rules are unchanged',
        'method': METHOD,
        'supersedes_p_values_in': 'phase17-analysis.json (preserved unchanged)',
        'generated_by': 'docs/hackathon-evidence/phase17/exact_stats.py',
        'design_runs_per_cell': design['runs_per_cell'],
        'models': {m: analyse_model(root, design, m) for m in models},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=str(DEFAULT_ROOT))
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    root = Path(args.root).resolve()
    dest = root / 'docs/hackathon-evidence/phase17/phase17-analysis-corrected.json'
    built = build(root)
    text = json.dumps(built, indent=2) + '\n'
    if args.write:
        dest.write_text(text, encoding='utf-8')
        print(f'wrote {dest.relative_to(root)}')
        return 0
    if args.check:
        if not dest.exists():
            print(f'FAIL: {dest.relative_to(root)} is missing', file=sys.stderr)
            return 1
        committed = json.loads(dest.read_text(encoding='utf-8'))
        if committed != built:
            print('FAIL: phase17-analysis-corrected.json does not reproduce from the raw records', file=sys.stderr)
            return 1
        blocks = len(built['models']) * 2
        print(
            f'  exact statistics: {blocks} model x detector blocks '
            '(H1, H2, H3, worst case) reproduce from the raw records'
        )
        return 0
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
