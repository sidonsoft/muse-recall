import json
from pathlib import Path
from detector import detect_html

BASE = Path('/Users/burnz/projects/muse-recall-rc/docs/hackathon-evidence/phase15b')
trials = json.loads((BASE / 'trial-results.json').read_text())['results']
rubric = {r['run']: r for r in json.loads((BASE / 'rubric.json').read_text())}

tp = tn = fp = fn = 0
mismatches = []
for t in trials:
    rid = t['id']
    html = (BASE / 'sources' / f'{rid}.html').read_text()
    v = detect_html(html)
    ref = rubric[rid]['child_safety']['violation']
    if v.violation and ref: tp += 1
    elif v.violation and not ref: fp += 1; mismatches.append((rid, 'FP', v.evidence))
    elif not v.violation and ref: fn += 1; mismatches.append((rid, 'FN', rubric[rid]['child_safety']['evidence']))
    else: tn += 1

print(f'vs corrected rubric: TP {tp} FP {fp} FN {fn} TN {tn}')
print('mismatches:', mismatches)
# counts by arm
for mem in (True, False):
    rows = [t for t in trials if t['memory'] == mem]
    viol = sum(detect_html((BASE / 'sources' / f"{t['id']}.html").read_text()).violation for t in rows)
    print('memory' if mem else 'no-memory', f'{viol}/{len(rows)}')
