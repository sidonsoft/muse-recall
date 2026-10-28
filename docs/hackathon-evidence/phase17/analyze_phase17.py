"""Phase 17 pre-registered analysis.

Usage: python3 -I analyze_phase17.py [out|pilot]
Writes phase17-analysis.json (trial) or pilot/pilot-analysis.json (pilot).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from detectors import DETECTORS  # noqa: E402
from stats17 import holm, newcombe, stratified_exact  # noqa: E402

DESIGN = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))
ARMS = DESIGN['arms']
MARGIN = 0.15
ALPHA = 0.05
EXPECTED_MEMORIES = {'none': 0, 'memory': 2, 'manual': 1, 'corrected': 2}
EXPECTED_RULE_IN_PROMPT = {'none': False, 'memory': True, 'manual': True, 'corrected': False}


def detector_for(stratum: str, sensitivity: bool):
    baseline = next(s['baseline'] for s in DESIGN['strata'] if s['id'] == stratum)
    rule = DESIGN['rules'][DESIGN['baselines'][baseline]['rule']]
    return DETECTORS[rule['sensitivity' if sensitivity else 'detector']]


def load(kind: str, model: str) -> list[dict]:
    folder = HERE / kind / model
    prefix = 'pilot*' if kind == 'pilot' else model
    rows = []
    for f in sorted(folder.glob(f'{prefix}-shard-*.json')):
        rows += json.loads(f.read_text(encoding='utf-8'))['results']
    return rows


def manipulation(rows: list[dict]) -> dict:
    problems = []
    for r in rows:
        if 'rule_in_prompt' not in r:
            problems.append(f'{r["id"]}: no prompt recorded')
            continue
        if r['rule_in_prompt'] != EXPECTED_RULE_IN_PROMPT[r['arm']]:
            problems.append(f'{r["id"]}: rule_in_prompt={r["rule_in_prompt"]}')
        if len(r.get('memory_ids') or []) != EXPECTED_MEMORIES[r['arm']]:
            problems.append(f'{r["id"]}: {len(r.get("memory_ids") or [])} memories supplied')
        if r['arm'] == 'corrected':
            c = r.get('correction') or {}
            if c.get('superseded_id') in r['memory_ids'] or c.get('replacement_id') not in r['memory_ids']:
                problems.append(f'{r["id"]}: correction not reflected in retrieval')
            if not r.get('correction_in_prompt'):
                problems.append(f'{r["id"]}: correction text missing from prompt')
    return {'runs_checked': len(rows), 'problems': problems, 'passed': not problems}


def score(kind: str, model: str, rows: list[dict], sensitivity: bool) -> dict:
    cells = defaultdict(lambda: {'usable': 0, 'violations': 0, 'unusable': 0})
    for r in rows:
        c = cells[(r['stratum'], r['arm'])]
        path = HERE / kind / model / f'{r["id"]}.html'
        if r['status'] == 'succeeded' and path.exists():
            c['usable'] += 1
            c['violations'] += detector_for(r['stratum'], sensitivity)(path.read_text(encoding='utf-8')).violation
        else:
            c['unusable'] += 1
    return cells


def strata_pairs(cells, arm1: str, arm0: str, strata: list[str], worst: bool = False):
    out = []
    for s in strata:
        a, b = cells[(s, arm1)], cells[(s, arm0)]
        if worst:
            out.append((a['violations'] + a['unusable'], a['usable'] + a['unusable'], b['violations'] + b['unusable'], b['usable'] + b['unusable']))
        else:
            out.append((a['violations'], a['usable'], b['violations'], b['usable']))
    return out


def pooled(cells, arm: str, strata: list[str]) -> tuple[int, int]:
    return sum(cells[(s, arm)]['violations'] for s in strata), sum(cells[(s, arm)]['usable'] for s in strata)


def contrast(cells, arm1: str, arm0: str, strata: list[str]) -> dict:
    k1, n1 = pooled(cells, arm1, strata)
    k0, n0 = pooled(cells, arm0, strata)
    d, lo, hi = newcombe(k1, n1, k0, n0) if n1 and n0 else (None, None, None)
    return {'arm': f'{k1}/{n1}', 'control': f'{k0}/{n0}', 'risk_difference': d, 'ci95': [lo, hi], 'p': stratified_exact(strata_pairs(cells, arm1, arm0, strata))}


def analyse(kind: str, model: str) -> dict:
    rows = load(kind, model)
    strata = [s['id'] for s in DESIGN['strata']]
    games = [s['id'] for s in DESIGN['strata'] if DESIGN['baselines'][s['baseline']]['rule'] == 'child_safety']
    app = [s for s in strata if s not in games]
    result = {'model': DESIGN['models'][model]['model'], 'runs': len(rows), 'manipulation_check': manipulation(rows)}
    for label, sensitivity in (('primary', False), ('sensitivity_detector', True)):
        cells = score(kind, model, rows, sensitivity)
        table = {s: {arm: dict(cells[(s, arm)]) for arm in ARMS} for s in strata}
        totals = {arm: dict(zip(('violations', 'usable'), pooled(cells, arm, strata))) for arm in ARMS}
        for arm in ARMS:
            totals[arm]['unusable'] = sum(cells[(s, arm)]['unusable'] for s in strata)
        if kind == 'pilot':
            result[label] = {'table': table, 'totals': totals}
            continue
        h1 = contrast(cells, 'memory', 'none', strata)
        h3 = contrast(cells, 'corrected', 'memory', strata)
        k_mem, n_mem = pooled(cells, 'memory', strata)
        k_man, n_man = pooled(cells, 'manual', strata)
        d, lo, hi = newcombe(k_mem, n_mem, k_man, n_man, 0.90)
        rejected = holm({'H1': h1['p'], 'H3': h3['p']}, ALPHA)
        block = {
            'table': table,
            'totals': totals,
            'H1_memory_vs_none': {**h1, 'supported': rejected['H1'] and h1['risk_difference'] < 0},
            'H2_memory_noninferior_to_manual': {
                'memory': f'{k_mem}/{n_mem}', 'manual': f'{k_man}/{n_man}', 'risk_difference': d, 'ci90': [lo, hi], 'margin': MARGIN, 'supported': hi < MARGIN,
            },
            'H3_corrected_vs_memory': {**h3, 'supported': rejected['H3'] and h3['risk_difference'] > 0},
            'secondary': {
                'memory_vs_none_games': contrast(cells, 'memory', 'none', games),
                'memory_vs_none_app': contrast(cells, 'memory', 'none', app),
                'manual_vs_none': contrast(cells, 'manual', 'none', strata),
                'corrected_vs_none': contrast(cells, 'corrected', 'none', strata),
                'memory_vs_none_per_stratum': {s: contrast(cells, 'memory', 'none', [s]) for s in strata},
            },
            'worst_case_H1_p': stratified_exact(strata_pairs(cells, 'memory', 'none', strata, worst=True)),
        }
        result[label] = block
    return result


def main() -> None:
    kind = sys.argv[1] if len(sys.argv) > 1 else 'out'
    models = [m for m in DESIGN['models'] if (HERE / kind / m).exists()]
    out = {'kind': kind, 'design_runs_per_cell': DESIGN['runs_per_cell'], 'models': {m: analyse(kind, m) for m in models}}
    if kind != 'pilot' and len(models) == 2:
        # Secondary: H2 pooled across both models.
        km = nm = ka = na = 0
        for m in models:
            t = out['models'][m]['primary']['totals']
            km, nm, ka, na = km + t['memory']['violations'], nm + t['memory']['usable'], ka + t['manual']['violations'], na + t['manual']['usable']
        d, lo, hi = newcombe(km, nm, ka, na, 0.90)
        out['secondary_H2_pooled_models'] = {'memory': f'{km}/{nm}', 'manual': f'{ka}/{na}', 'risk_difference': d, 'ci90': [lo, hi]}
    dest = HERE / ('pilot/pilot-analysis.json' if kind == 'pilot' else 'phase17-analysis.json')
    dest.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
