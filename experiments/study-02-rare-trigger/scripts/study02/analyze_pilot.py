#!/usr/bin/env python3
"""Study 02 — pilot analysis (checkpoint 2).

Descriptive analysis of the 132-execution Dell pilot ONLY. Pilot data are kept
completely separate from the 400-scenario confirmatory corpus and are never
pooled with it. This script:

  1. scores every succeeded pilot record with the frozen Study 02 scorer
     (``scripts/study02/score.py`` batch mode, pilot labels derived mechanically
     from ``pilot/pilot-plan.json`` — the pilot has no frozen label file);
  2. accounts for every planned execution: recorded / usable / unusable / missing,
     failure causes, and per arm x stratum cells;
  3. reports timing, token and throughput measurements (mean/median/p95);
  4. checks condition assignment (manipulation checks), detector verdicts,
     trigger exposure and prevalence for the 30 pilot scenarios;
  5. characterises the 12 repeat executions as *repeatability/variability probes*
     — the endpoint does not honour seeds deterministically at temperature 0.7,
     so a byte-identical repeat is an observation, not a determinism claim;
  6. lists scoring/runner/protocol defects found by the pilot.

No hypothesis tests, no p-values, no effect-size claims: the pilot exists to
find defects and measure the execution environment, not to estimate the
confirmatory effect. Anything that looks like an arm difference is descriptive
only and must not drive a pre-freeze design choice except through the
pre-declared pilot gates in ``04b-ANALYSIS-PLAN-REV2.md``.

Usage:
  python3 scripts/study02/analyze_pilot.py            # writes pilot/pilot-analysis.json,
                                                      # pilot/pilot-tables.md, prints summary
"""
from __future__ import annotations

import json
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent.parent  # experiments/study-02-rare-trigger
PILOT = HERE / 'pilot'
CORPUS = HERE / 'corpus'
SCORER = HERE / 'scripts' / 'study02' / 'score.py'
SCORES = PILOT / 'scores.jsonl'


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def pct(x: float) -> str:
    return f'{100.0 * x:.1f}%'


def q(vals, frac):
    vals = sorted(vals)
    if not vals:
        return None
    idx = min(len(vals) - 1, int(round(frac * (len(vals) - 1))))
    return vals[idx]


def stats(vals):
    vals = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not vals:
        return {'n': 0}
    return {
        'n': len(vals),
        'mean': round(statistics.mean(vals), 2),
        'median': round(statistics.median(vals), 2),
        'min': round(min(vals), 2),
        'max': round(max(vals), 2),
        'p95': round(q(vals, 0.95), 2),
        'total_s': round(sum(vals), 2),
    }


def score_all() -> None:
    """Run the frozen scorer in batch mode over the pilot records."""
    cmd = [
        sys.executable, str(SCORER),
        '--records-dir', str(PILOT / 'records'),
        '--pilot-plan', str(PILOT / 'pilot-plan.json'),
        '--variants-dir', str(CORPUS / 'variants'),
        '--out', str(SCORES),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f'scorer failed ({out.returncode}):\n{out.stdout}\n{out.stderr}')
    print(out.stdout.strip())


def main() -> int:
    manifest = load_json(PILOT / 'manifest.json')
    plan = load_json(PILOT / 'pilot-plan.json')
    planned = manifest['runs']
    expected_ids = [r['run_id'] for r in planned]

    records = {}
    records_dir = PILOT / 'records'
    for f in sorted(records_dir.glob('*.json')):
        rec = load_json(f)
        records[rec.get('run_id', f.stem)] = rec

    if not records:
        print('no pilot records yet — nothing to analyse')
        return 1

    # Opportunity class is a property of the pilot scenario (pilot plan), not of
    # the individual run record; join it by scenario id.
    opportunity_class = {
        s['pilot_scenario_id']: s['opportunity_class']
        for s in plan.get('pilot_scenarios', [])
    }

    score_all()
    scores = [json.loads(line) for line in SCORES.read_text(encoding='utf-8').splitlines() if line.strip()]
    scores_by_id = {s['run_id']: s for s in scores}

    # ---------------------------------------------------------------- accounting
    recorded_ids = [rid for rid in expected_ids if rid in records]
    missing = [rid for rid in expected_ids if rid not in records]
    unusable = [r for r in records.values() if not r.get('usable', False)]
    usable = [r for r in records.values() if r.get('usable', False)]
    causes = Counter(r.get('unusable_reason') or r.get('error') or 'unknown' for r in unusable)

    def cell_key(r):
        spec = next(p for p in planned if p['run_id'] == r['run_id'])
        return (spec['stratum'], spec['arm'])

    cells = defaultdict(lambda: {'planned': 0, 'recorded': 0, 'usable': 0, 'unusable': 0})
    for p in planned:
        c = cells[(p['stratum'], p['arm'])]
        c['planned'] += 1
        if p['run_id'] in records:
            c['recorded'] += 1
            if records[p['run_id']].get('usable', False):
                c['usable'] += 1
            else:
                c['unusable'] += 1

    # ------------------------------------------------------------------- timing
    walls = [r.get('seconds_total', r.get('wall_s')) for r in records.values()
             if isinstance(r.get('seconds_total', r.get('wall_s')), (int, float))]
    usage = [r.get('usage') or {} for r in records.values()]
    prompt_toks = [u.get('prompt_tokens') for u in usage if isinstance(u.get('prompt_tokens'), (int, float))]
    comp_toks = [u.get('completion_tokens') for u in usage if isinstance(u.get('completion_tokens'), (int, float))]
    out_bytes = [r['output_bytes'] for r in records.values() if isinstance(r.get('output_bytes'), (int, float))]

    def by_arm(metric):
        d = defaultdict(list)
        for r in records.values():
            d[r.get('arm', '?')].append(metric(r))
        return {a: stats(v) for a, v in sorted(d.items())}

    timing_by_arm = by_arm(lambda r: r.get('seconds_total', r.get('wall_s')))
    out_bytes_by_arm = by_arm(lambda r: r.get('output_bytes'))
    comp_by_arm = by_arm(lambda r: (r.get('usage') or {}).get('completion_tokens'))
    throughput = []
    for r in records.values():
        u = r.get('usage') or {}
        wall = r.get('seconds_total', r.get('wall_s'))
        if wall and u.get('completion_tokens'):
            throughput.append(u['completion_tokens'] / wall)
    timing = {
        'planned_total_executions': len(planned),
        'recorded': len(records),
        'wall_s': stats(walls),
        'prompt_tokens': stats(prompt_toks),
        'completion_tokens': stats(comp_toks),
        'output_bytes': stats(out_bytes),
        'end_to_end_decode_tok_s': stats(throughput),
        'by_arm_wall_s': timing_by_arm,
        'by_arm_output_bytes': out_bytes_by_arm,
        'by_arm_completion_tokens': comp_by_arm,
        'observed_elapsed_s': round(sum(walls), 1),
        'projected_132_from_mean_s': round(statistics.mean(walls) * len(planned)) if walls else None,
    }

    # ------------------------------------------------------- manipulation checks
    manip = Counter()
    manip_fail = []
    for r in records.values():
        m = r.get('manipulation') or {}
        ok = bool(m.get('passed', False))
        manip[(r.get('arm'), ok)] += 1
        if not ok:
            manip_fail.append({'run_id': r['run_id'], 'arm': r.get('arm'), 'problems': m.get('problems')})

    # ----------------------------------------------- detector / exposure results
    analysis_rows = []
    for sid in {s['run_id'] for s in scores}:
        s = scores_by_id[sid]
        spec = next(p for p in planned if p['run_id'] == sid)
        rec = records.get(sid, {})
        analysis_rows.append({
            'run_id': sid,
            'scenario_id': spec['scenario_id'],
            'stratum': spec['stratum'],
            'arm': spec['arm'],
            'opportunity_class': opportunity_class.get(spec['scenario_id'], 'unknown'),
            'repeat_id': spec.get('repeat_id'),
            'repeat_of': spec.get('repeat_of'),
            'usable': rec.get('usable', False),
            'violation': s.get('violation'),
            'exposed': s.get('exposed'),
            'primary_reading': (s.get('detectors') or {}).get('primary', {}).get('name'),
            'sensitivity_reading': (s.get('detectors') or {}).get('sensitivity', {}).get('name'),
            'sensitivity_violation': s.get('sensitivity_violation'),
            'consistency_ok': bool((s.get('consistency') or {}).get('ok', True)),
        })

    def rate_table(rows, key_pred):
        out = {}
        for arm in ['none', 'memory', 'manual', 'corrected']:
            arm_rows = [r for r in rows if r['arm'] == arm and r['usable']]
            sel = [r for r in arm_rows if key_pred(r)]
            out[arm] = {
                'n': len(arm_rows),
                'selected': len(sel),
                'violations': sum(1 for r in sel if r['violation']),
                'exposed': sum(1 for r in sel if r['exposed']),
                'cvr_violation_rate_selected': (sum(1 for r in sel if r['violation']) / len(sel)) if sel else None,
            }
        return out

    primary_rows = [r for r in analysis_rows if r['repeat_id'] is None]
    high_rows = [r for r in primary_rows if r['opportunity_class'] == 'high']
    low_rows = [r for r in primary_rows if r['opportunity_class'] == 'low']
    results = {
        'primary_120_all': rate_table(primary_rows, lambda r: True),
        'primary_high_opportunity': rate_table(high_rows, lambda r: True),
        'primary_low_opportunity': rate_table(low_rows, lambda r: True),
        'violations_without_exposure': [
            r['run_id'] for r in analysis_rows
            if r['violation'] and not r['exposed']
        ],
        'consistency_failures': [r['run_id'] for r in analysis_rows if not r['consistency_ok']],
    }

    # -------------------------------------------------------------- repeat probes
    repeat_rows = []
    for r in analysis_rows:
        if not r['repeat_id']:
            continue
        sid = r['run_id']
        primary = records.get(r['repeat_of']) if r['repeat_of'] else None
        rep = records.get(sid)
        same_bytes = bool(primary and rep and primary.get('output_sha256') and primary.get('output_sha256') == rep.get('output_sha256'))
        repeat_rows.append({
            'run_id': sid,
            'repeat_id': r['repeat_id'],
            'mode': (next((p.get('seed_mode') for p in planned if p['run_id'] == sid), None)),
            'repeats_run': r['repeat_of'],
            'same_output_sha256': same_bytes,
            'primary_violation': scores_by_id.get(r['repeat_of'], {}).get('violation') if r['repeat_of'] else None,
            'repeat_violation': r['violation'],
        })
    by_mode = defaultdict(list)
    for r in repeat_rows:
        by_mode[r['mode']].append(r)
    repeat_probe = {
        'note': ('The Dell endpoint is not seed-deterministic at temperature 0.7 '
                 '(measured in 07-ENDPOINT-QUALIFICATION.md §4). These 12 repeats are '
                 'therefore reported as repeatability/variability probes, NOT as a '
                 'determinism test; a byte-identical repeat is an observation.'),
        'total': len(repeat_rows),
        'by_mode': {
            mode: {
                'n': len(rows),
                'byte_identical_to_primary': sum(1 for x in rows if x['same_output_sha256']),
                'rows': rows,
            } for mode, rows in sorted(by_mode.items())
        },
    }

    # ------------------------------------------------------------------- defects
    defects = []
    for r in records.values():
        if r.get('status') == 'succeeded' and not r.get('output_sha256'):
            defects.append({'run_id': r['run_id'], 'kind': 'succeeded_without_output'})
        if r.get('finish_reason') == 'length':
            defects.append({'run_id': r['run_id'], 'kind': 'truncated_at_max_tokens'})
        if not (r.get('manipulation') or {}).get('passed', False):
            defects.append({'run_id': r['run_id'], 'kind': 'manipulation_check_failed'})
    for r in results['consistency_failures']:
        defects.append({'run_id': r, 'kind': 'scoring_consistency_failure'})
    for r in results['violations_without_exposure']:
        defects.append({'run_id': r, 'kind': 'violation_without_exposure'})

    analysis = {
        'kind': 'study02-pilot-analysis',
        'pilot_only': True,
        'excluded_from_confirmatory': True,
        'scored_with': 'scoring/frozen.py (frozen Phase 17/16 detector copies) + scoring/trigger_zones.py',
        'accounting': {
            'planned': len(planned),
            'recorded': len(records),
            'missing': missing,
            'usable': len(usable),
            'unusable': len(unusable),
            'unusable_causes': dict(causes),
            'cells': {f'{s}|{a}': c for (s, a), c in sorted(cells.items())},
        },
        'timing': timing,
        'manipulation': {f'{a}|{ok}': n for (a, ok), n in sorted(manip.items())},
        'manipulation_failures': manip_fail,
        'results_descriptive_only': results,
        'repeat_probes': repeat_probe,
        'defects': defects,
        'violation_counts_primary_120': {
            arm: {
                'violations': sum(1 for r in primary_rows if r['arm'] == arm and r['usable'] and r['violation']),
                'usable': sum(1 for r in primary_rows if r['arm'] == arm and r['usable']),
                'exposed': sum(1 for r in primary_rows if r['arm'] == arm and r['usable'] and r['exposed']),
            } for arm in ['none', 'memory', 'manual', 'corrected']
        },
    }

    out = PILOT / 'pilot-analysis.json'
    out.write_text(json.dumps(analysis, indent=2) + '\n', encoding='utf-8')

    # ------------------------------------------------------------- markdown tables
    lines = []
    lines.append('# Pilot results (descriptive; pilot-only, excluded from confirmatory)\n')
    lines.append('Generated by `scripts/study02/analyze_pilot.py`. No hypothesis tests; no claim of determinism.\n')
    lines.append('## Execution accounting\n')
    lines.append('| Planned | Recorded | Usable | Unusable | Missing |\n|---:|---:|---:|---:|---:|')
    a = analysis['accounting']
    lines.append(f"| {a['planned']} | {a['recorded']} | {a['usable']} | {a['unusable']} | {len(a['missing'])} |\n")
    lines.append('## Timing (seconds)\n')
    t = timing['wall_s']
    lines.append('| n | mean | median | p95 | max | total |\n|---:|---:|---:|---:|---:|---:|')
    lines.append(f"| {t['n']} | {t['mean']} | {t['median']} | {t['p95']} | {t['max']} | {t['total_s']} |\n")
    lines.append('## Descriptive detector/exposure counts (primary 120, usable runs)\n')
    lines.append('| Arm | Usable | Violations | Exposed |\n|---|---:|---:|---:|')
    for arm, c in analysis['violation_counts_primary_120'].items():
        lines.append(f"| `{arm}` | {c['usable']} | {c['violations']} | {c['exposed']} |")
    lines.append('')
    lines.append('## Repeat probes\n')
    lines.append('Reported as repeatability/variability probes; the endpoint is not seed-deterministic at temperature 0.7.\n')
    lines.append('| Mode | n | byte-identical to primary |\n|---|---:|---:|')
    for mode, c in repeat_probe['by_mode'].items():
        lines.append(f"| `{mode}` | {c['n']} | {c['byte_identical_to_primary']} |")
    lines.append('')
    lines.append('## Defects found\n')
    if analysis['defects']:
        for d in analysis['defects']:
            lines.append(f"- `{d['run_id']}` — {d['kind']}")
    else:
        lines.append('- none recorded')
    (PILOT / 'pilot-tables.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

    print(json.dumps({
        'recorded': a['recorded'], 'usable': a['usable'], 'unusable': a['unusable'],
        'missing': len(a['missing']),
        'wall_mean_s': t['mean'], 'wall_p95_s': t['p95'],
        'defects': len(analysis['defects']),
        'out': str(out),
    }, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
