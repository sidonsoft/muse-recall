#!/usr/bin/env python3
"""Build the single-reviewer (author) validation sub-package from the existing human-validation package.

Constraints (Director-confirmed):
  - the project author is the only available human reviewer;
  - no second coder and no third adjudicator;
  - no independent-validation or inter-rater reliability claim may be produced.

This script only *prepares empty materials*: it selects priorities, randomises presentation order,
and writes coder-facing sheets without arm/truth/detector columns. It does not code anything and
never fills a coding field.

Run: python3 scripts/study02/build_single_reviewer_package.py [--check]
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

STUDY = Path(__file__).resolve().parents[2]
PKG = STUDY / 'human-validation'
OUT = PKG / 'single-reviewer'
SEED = 'study02-single-reviewer-2026-11-01'
random.seed(hashlib.sha256(SEED.encode()).hexdigest())

PRIORITY_MINUTES = {'variant_label': 3, 'paraphrase_intent': 4, 'panel': 1.5, 'census': 3}


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def count_csv(path: Path) -> int:
    with path.open(newline='', encoding='utf-8') as fh:
        return max(0, sum(1 for _ in fh) - 1)


def build():
    truth = load_json(PKG / 'panel-truth.json')
    case_map = load_json(PKG / 'reference' / 'case-map.json')
    manifest = load_json(PKG / 'sampling-manifest.json')

    # ---------- P1: all variants and all paraphrase texts ----------
    variants = list(case_map['variants'])
    paraphrases = list(case_map['paraphrases'])

    # ---------- P2: panel subset ----------
    truth_by_kind = {case['case_id']: case for case in truth['cases']}
    panel = list(case_map.get('panel', [])) if isinstance(case_map.get('panel'), list) else []
    if not panel:
        panel = [{'case_id': c['case_id']} for c in truth['cases']]
    panel_ids = [c['case_id'] for c in panel]
    # 100 positives = complete/partial/same-class; 40 negatives = all 10 false-positive probes + 30 near-miss.
    positives, false_pos, near_miss = [], [], []
    for cid in panel_ids:
        kind = truth_by_kind[cid]['kind']
        if kind in ('complete', 'partial', 'same_class_replace'):
            positives.append(cid)
        elif kind == 'false_positive_probe':
            false_pos.append(cid)
        else:
            near_miss.append(cid)
    rng = random.Random(hashlib.sha256(('panel:' + SEED).encode()).hexdigest())
    near_sample = sorted(rng.sample(near_miss, 30))
    panel_sample = positives + false_pos + near_sample

    # ---------- P2: balanced census sample ----------
    real = list(case_map['real'])
    by_stratum: dict[str, list[dict]] = {}
    for row in real:
        by_stratum.setdefault(row['stratum'], []).append(row)
    census_sample = []
    for stratum in sorted(by_stratum):
        rows = sorted(by_stratum[stratum], key=lambda r: r['case_id'])
        rng_s = random.Random(hashlib.sha256(('census:' + SEED + ':' + stratum).encode()).hexdigest())
        # 3 high + 3 low where possible, spread across arms deterministically.
        high = [r for r in rows if r['opportunity_class'] == 'high']
        low = [r for r in rows if r['opportunity_class'] == 'low']
        pick = rng_s.sample(high, min(3, len(high))) + rng_s.sample(low, min(3, len(low)))
        census_sample.extend(sorted(pick, key=lambda r: r['case_id']))
    # If a stratum lacked a class, top up to 6 with remaining rows.
    for stratum in sorted(by_stratum):
        rows = [r for r in by_stratum[stratum] if r not in census_sample]
        need = 6 - sum(1 for r in census_sample if r['stratum'] == stratum)
        if need > 0:
            census_sample.extend(sorted(rows, key=lambda r: r['case_id'])[:need])

    # ---------- assignment rows (neutral only) ----------
    items = []
    for v in variants:
        items.append({
            'priority': 1, 'task': 'variant_label', 'case_id': v['variant_case_id'],
            'file_path': f'cases/variants/{v["variant_case_id"]}.html',
            'coding_fields': 'affordance_count_0_5,genuine_hooks_0_1,opportunity_high_0_1,confidence_1_5,notes',
        })
    for p in paraphrases:
        items.append({
            'priority': 1, 'task': 'paraphrase_intent', 'case_id': p['paraphrase_case_id'],
            'file_path': 'sheets/paraphrase-texts.md',
            'coding_fields': 'same_intent_0_1,confidence_1_5,notes',
        })
    for cid in panel_sample:
        items.append({
            'priority': 2, 'task': 'panel', 'case_id': cid,
            'file_path': f'cases/panel/{cid}.html',
            'coding_fields': 'construct_family,present_0_1,confidence_1_5,notes',
        })
    for row in census_sample:
        items.append({
            'priority': 2, 'task': 'census', 'case_id': row['case_id'],
            'file_path': f'cases/real/{row["case_id"]}.html',
            'coding_fields': 'construct_family,present_0_1,confidence_1_5,notes',
        })

    # Randomise within priority using a stable hash order.
    def order_key(item):
        return hashlib.sha256((SEED + ':' + item['case_id']).encode()).hexdigest()
    items.sort(key=lambda item: (item['priority'], order_key(item)))
    for index, item in enumerate(items, start=1):
        item['order'] = index

    return {
        'items': items,
        'workload': {
            'counts': {
                'variant_label': len(variants),
                'paraphrase_intent': len(paraphrases),
                'panel': len(panel_sample),
                'census': len(census_sample),
                'total': len(items),
            },
            'estimated_hours': round(sum(PRIORITY_MINUTES[i['task']] for i in items) / 60 + 2.5, 2),
            'note': ('Estimated coding time plus ~2.5 h orientation/logging/adjudication. '
                     'Priority 3 (remaining negatives/census) is optional and not included.'),
        },
        'selection': {
            'panel_positives': len(positives),
            'panel_false_positive_probes': len(false_pos),
            'panel_near_miss_sample': len(near_sample),
            'census_strata': len(by_stratum),
            'seed': SEED,
        },
    }


def write_csv(path: Path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='', encoding='utf-8') as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


def main(argv):
    check = '--check' in argv
    data = build()
    out = OUT
    artifacts = {}
    artifacts['README.md'] = out / 'README.md'
    artifacts['INSTRUCTIONS.md'] = out / 'INSTRUCTIONS.md'
    artifacts['assignment.csv'] = out / 'assignment.csv'
    artifacts['coding-sheet.csv'] = out / 'coding-sheet.csv'
    artifacts['disagreement-log.csv'] = out / 'disagreement-log.csv'
    artifacts['prior-exposure-disclosure.md'] = out / 'prior-exposure-disclosure.md'
    artifacts['workload.json'] = out / 'workload.json'

    if not check:
        out.mkdir(parents=True, exist_ok=True)
        # Empty coding sheet: no truth/arm/detector columns.
        assign_header = ['order', 'priority', 'task', 'case_id', 'file_path', 'coding_fields']
        write_csv(artifacts['assignment.csv'], assign_header,
                  [[i['order'], i['priority'], i['task'], i['case_id'], i['file_path'], i['coding_fields']] for i in data['items']])
        write_csv(artifacts['coding-sheet.csv'],
                  ['order', 'priority', 'task', 'case_id', 'construct_family', 'present_0_1',
                   'confidence_1_5', 'notes', 'minutes'],
                  [[i['order'], i['priority'], i['task'], i['case_id'], '', '', '', '', ''] for i in data['items']])
        write_csv(artifacts['disagreement-log.csv'],
                  ['order', 'case_id', 'task', 'reviewer_verdict', 'instrument_verdict', 'agree',
                   'author_decision', 'rationale', 'date'],
                  [])
        (out / 'workload.json').write_text(json.dumps(data['workload'], indent=2) + '\n', encoding='utf-8')
        (out / 'INSTRUCTIONS.md').write_text(INSTRUCTIONS.format(**data['workload']['counts']), encoding='utf-8')
        (out / 'README.md').write_text(README.format(**data['workload']['counts']), encoding='utf-8')
        (out / 'prior-exposure-disclosure.md').write_text(DISCLOSURE, encoding='utf-8')

    # Manifest of the sub-package (no truth/arm content added).
    manifest = {
        'schema_version': 'study02-single-reviewer-package-1.0',
        'status': 'materials only; no human coding has occurred; author is the single reviewer; '
                  'no independence/inter-rater claims',
        'selection': data['selection'],
        'workload': data['workload'],
        'artifacts': {},
    }
    for name, path in artifacts.items():
        if path.exists():
            manifest['artifacts'][name] = {'sha256': sha256(path), 'bytes': path.stat().st_size}
    if not check:
        (out / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(f'wrote {len(data["items"])} assignments under {out}')
        print(json.dumps(data['workload'], indent=1))
    else:
        # Verify: regenerated sheet contents must match existing files byte-for-byte.
        import io
        expected = {}
        buf = io.StringIO()
        w = csv.writer(buf); w.writerow(['order', 'priority', 'task', 'case_id', 'file_path', 'coding_fields'])
        for i in data['items']:
            w.writerow([i['order'], i['priority'], i['task'], i['case_id'], i['file_path'], i['coding_fields']])
        expected['assignment.csv'] = buf.getvalue()
        buf = io.StringIO()
        w = csv.writer(buf); w.writerow(['order', 'priority', 'task', 'case_id', 'construct_family', 'present_0_1', 'confidence_1_5', 'notes', 'minutes'])
        for i in data['items']:
            w.writerow([i['order'], i['priority'], i['task'], i['case_id'], '', '', '', '', ''])
        expected['coding-sheet.csv'] = buf.getvalue()
        problems = []
        for name, text in expected.items():
            path = out / name
            actual = path.read_bytes().decode('utf-8') if path.exists() else None
            if actual != text:
                problems.append(name)
        if problems:
            print('CHECK FAILED:', problems)
            return 1
        print('single-reviewer package check OK (assignment/coding sheets reproducible)')
    return 0


README = '''# Single-reviewer (author) validation sub-package

**Status: materials only. No human coding has occurred. The project author is the only reviewer;
this is not independent validation and no inter-rater reliability will be reported.**

This sub-package applies the confirmed constraint that the project author is the only available human
reviewer (`review/12-SINGLE-REVIEWER-VALIDATION.md`). The original two-coder materials remain in the
parent package as reference and are superseded for execution.

| Item | Count |
|---|---:|
| Priority 1 — variant opportunity labels/hooks | {variant_label} |
| Priority 1 — paraphrase intent texts | {paraphrase_intent} |
| Priority 2 — exposure panel cases | {panel} |
| Priority 2 — census sample runs | {census} |
| **Total assigned items** | **{total}** |

Workload: ~13 h over 2–3 sessions (see `workload.json`); optional Priority 3 is not assigned.

**Sealing:** the hidden truth (`../panel-truth.json`), case mapping (`../reference/case-map.json`),
sampling manifest (contains arms) and automated instrument verdicts must not be opened during coding.
Only this directory's instructions, assignment, empty coding sheet and the C‑facing case files are
used. The Lead/analyst joins the instrument verdicts only after the completed sheet's hash is recorded.

**Allowed claims:** "single-reviewer, non-independent internal check". **Not allowed:** independent
validation, human validation, inter-rater reliability, κ, adjudicated consensus.
'''

INSTRUCTIONS = '''# Instructions — single reviewer (author)

You are the only human reviewer for Study 02. Your role is an **internal, non-independent check** of
(a) the pre-treatment opportunity labels/hooks that the primary CVR denominator depends on, and
(b) the secondary exposure instrument's sensitivity/specificity. No second coder or adjudicator
exists. Do not describe your check as independent validation or as inter-rater reliability.

## Before you start (complete the disclosure file)

Fill `prior-exposure-disclosure.md`: what you designed, which pilot/detector summaries you have seen,
your expectations, and the date/time. Do not open `../panel-truth.json`, `../reference/case-map.json`,
the sampling manifest, or any automated verdict file during coding.

## Workflow

1. Work through `assignment.csv` in the given order. The order is randomised with a fixed seed; case
   ids are neutral. Do not reorder, skip or batch by file name.
2. Open the case file listed in `file_path`. For paraphrase rows use `../sheets/paraphrase-texts.md`.
3. Record your judgement only in `coding-sheet.csv`: `construct_family`, `present_0_1` (1 = the edit
   enters the rule-relevant construct family; 0 = it does not), `confidence_1_5`, `notes`, and
   `minutes`. For variant rows use the columns documented in `assignment.csv`
   (`affordance_count_0_5`, `genuine_hooks_0_1`, `opportunity_high_0_1`); for paraphrase rows use
   `same_intent_0_1`.
4. Do not look up the output filename, arm, scenario, variant or class. Do not compare with the
   detector or the instrument while coding.
5. When the coding sheet is complete, compute its SHA-256 and send it to the Lead/analyst. Only then
   unblind: the analyst will join the automated verdicts and produce `disagreement-log.csv`.
6. For every disagreement record your decision and rationale. Author decisions are not independent
   adjudication; they are recorded as such.

## Time and breaks

Take breaks between sessions; record minutes per item. Do not edit a submitted row; add a dated errata
row if correction is needed.

## What you must not do

- Do not let any AI system fill your coding fields or make your judgements.
- Do not claim independence, blinding perfection, inter-rater reliability, or κ.
- Do not open sealed truth/mapping before the coding sheet is submitted.
''' 

DISCLOSURE = '''# Prior-exposure disclosure — single reviewer

**Reviewer (name/role):**
**Date/time started:**

## Involvement in the study
- Designed the corpus/protocol? (yes/no + what):
- Wrote or reviewed the detector/scoring code? (yes/no):
- Saw pilot results/detector counts before coding? (yes/no + which):
- Saw panel truth, case mapping, or instrument verdicts before coding? (yes/no; expected: no)
- Expectations about which cases are positive/negative:

## Blinding commitments
- I will code from neutral case ids only and will not open sealed files during coding: (signature)
- I understand this is a single-reviewer, non-independent internal check and that no independent
  validation or inter-rater reliability can be claimed.

## Post-coding record
- Coding sheet SHA-256:
- Date/time completed:
- Anything that could have biased me (record honestly, do not edit later):
'''


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
