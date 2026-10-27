"""Phase 15B analysis: score the 32 runs against the locked rubric and test the hypothesis.

Pre-registered: one confirmatory Fisher exact test at alpha 0.05 (family of one).
Unusable runs are reported in the denominator, never dropped.

Usage: python3 video/tools/analyze-15b.py
"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRIAL = ROOT / 'pilot15b'


def fisher_two_tailed(a, b, c, d):
    """Two-tailed Fisher exact test for [[a, b], [c, d]]."""
    n = a + b + c + d
    r1, r2, c1, c2 = a + b, c + d, a + c, b + d
    denom = math.comb(n, r1)

    def prob(x):
        return math.comb(c1, x) * math.comb(c2, r1 - x) / denom

    observed = prob(a)
    return sum(prob(x) for x in range(max(0, r1 - c2), min(r1, c1) + 1) if prob(x) <= observed + 1e-12)


def main():
    results = json.loads((TRIAL / 'trial-results.json').read_text())['results']
    rubric = {r['run']: r for r in json.loads((TRIAL / 'rubric.json').read_text())}

    cells = {'memory': {'viol': 0, 'ok': 0, 'unusable': 0, 'runs': []},
             'no-memory': {'viol': 0, 'ok': 0, 'unusable': 0, 'runs': []}}

    for r in results:
        arm = 'memory' if r['memory'] else 'no-memory'
        entry = {'id': r['id'], 'status': r['status']}
        if r['status'] != 'succeeded':
            cells[arm]['unusable'] += 1
            entry['unusable'] = True
        else:
            score = rubric.get(r['id'])
            if not score:
                cells[arm]['unusable'] += 1
                entry['unusable'] = True
            else:
                viol = score['child_safety']['violation']
                cells[arm]['viol' if viol else 'ok'] += 1
                entry['violation'] = viol
                entry['evidence'] = score['child_safety']['evidence']
        cells[arm]['runs'].append(entry)

    # Confirmatory table: violations vs compliant, among usable runs.
    a = cells['memory']['viol']          # memory, violated
    b = cells['memory']['ok']            # memory, compliant
    c = cells['no-memory']['viol']       # no memory, violated
    d = cells['no-memory']['ok']         # no memory, compliant

    p = fisher_two_tailed(a, b, c, d) if (a + b) and (c + d) else None

    out = {
        'n_runs': len(results),
        'unusable': {k: v['unusable'] for k, v in cells.items()},
        'table': {
            'rows': ['rule remembered', 'no memory'],
            'columns': ['violated', 'compliant'],
            'rule_remembered': [a, b],
            'no_memory': [c, d],
        },
        'rate': {
            'rule_remembered': (a / (a + b)) if (a + b) else None,
            'no_memory': (c / (c + d)) if (c + d) else None,
        },
        'fisher_two_tailed_p': p,
        'alpha': 0.05,
        'cells': cells,
    }

    (TRIAL / 'analysis.json').write_text(json.dumps(out, indent=2))

    print(f"runs completed: {len(results)}")
    print(f"unusable: rule-remembered {cells['memory']['unusable']}, no-memory {cells['no-memory']['unusable']}")
    print()
    print(f"{'':<18}{'violated':>10}{'compliant':>11}")
    print(f"{'rule remembered':<18}{a:>10}{b:>11}")
    print(f"{'no memory':<18}{c:>10}{d:>11}")
    print()
    if p is not None:
        print(f"violation rate: memory {a/(a+b):.1%}  vs  no memory {c/(c+d):.1%}")
        print(f"Fisher exact (two-tailed): p = {p:.3g}   alpha = 0.05")
        print("result:", "SIGNIFICANT" if p < 0.05 else "not significant")
    else:
        print("insufficient usable runs in at least one cell")


if __name__ == '__main__':
    main()
