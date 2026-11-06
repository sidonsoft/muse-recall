#!/usr/bin/env python3
"""Study 02 deterministic scorer.

Given a frozen scenario label record and one full-file output HTML, emit a
JSON record with the applicable primary detector verdict, the sensitivity
verdict, trigger-zone exposure (baseline-vs-output construct diff), the
construct key sets, and consistency assertions.

No floats, no tolerances, no timestamps: the same inputs always produce the
same bytes. All rule matching goes through the frozen detector copies in
``scoring/`` (``scoring/frozen.py``); their SHA-256 values are verified on
import. Comments and strings are handled exactly as the frozen detectors
handle them, because their pre-processing functions are imported, not copied.

Single run::

    python3 scripts/study02/score.py \
        --label corpus/labels.json --scenario-id s02.farm-arcade.farmyard-v00.p00 \
        --output pilot/outputs/<run_id>.html --arm memory --rep 0 \
        --variants-dir corpus/variants

Batch over runner records::

    python3 scripts/study02/score.py --records-dir pilot/records \
        --labels corpus/labels.json --variants-dir corpus/variants \
        --out analysis/scores.jsonl

The scorer never decides whether a run is *usable*: that is the runner's
``status``/``finish_reason`` field, evaluated before scoring.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDY = HERE.parent.parent
SCORING = STUDY / 'scoring'
sys.path.insert(0, str(SCORING))

import frozen  # noqa: E402
import trigger_zones  # noqa: E402

ARMS = ('none', 'memory', 'manual', 'corrected')
EXPECTED = {
    'game': ('child_safety_broad', 'child_safety'),
    'focus': ('calm_motion', 'calm_motion_broad'),
}
SCORING_VERSION = 's02-scoring-0.1'


class ScoringError(Exception):
    """Input is missing or invalid; no score is emitted for this run."""


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha256_text(text: str) -> str:
    return frozen.sha256_text(text)


def sha256_file(path: Path) -> str:
    return frozen.sha256_bytes(path.read_bytes())


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ScoringError(f'cannot read JSON {path}: {exc}') from exc


def _normalize_label(record: dict) -> dict:
    record = dict(record)
    if 'scenario_id' not in record and isinstance(record.get('pilot_scenario_id'), str):
        record['scenario_id'] = record['pilot_scenario_id']
    return record


def load_label(path: Path, scenario_id: str | None) -> dict:
    """Load one label record from a JSON object, a JSONL file or an array."""
    if path.suffix == '.jsonl':
        labels = load_labels(path)
        if scenario_id:
            if scenario_id not in labels:
                raise ScoringError(f'scenario {scenario_id!r} not in {path}')
            return labels[scenario_id]
        if len(labels) != 1:
            raise ScoringError(f'{path} holds {len(labels)} labels; pass --scenario-id')
        return next(iter(labels.values()))
    data = read_json(path)
    if isinstance(data, dict):
        # Either a single label record, or scenario_id -> record.
        if scenario_id and scenario_id in data and isinstance(data[scenario_id], dict):
            return _normalize_label(data[scenario_id])
        if 'scenario_id' in data or 'pilot_scenario_id' in data:
            record = _normalize_label(data)
            if scenario_id and record['scenario_id'] != scenario_id:
                raise ScoringError(
                    f'label file holds scenario {record["scenario_id"]!r}, not {scenario_id!r}'
                )
            return record
        raise ScoringError('label JSON object has no scenario_id')
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and (item.get('scenario_id') or item.get('pilot_scenario_id')) == scenario_id:
                return _normalize_label(item)
        raise ScoringError(f'scenario {scenario_id!r} not in label list')
    raise ScoringError('labels must be a JSON object, array or mapping by scenario_id')


def load_labels(path: Path) -> dict:
    """scenario_id -> label record, from a JSON array/object or JSONL file."""
    if path.suffix == '.jsonl':
        labels = {}
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            labels[rec['scenario_id']] = rec
        return labels
    data = read_json(path)
    if isinstance(data, list):
        return {rec['scenario_id']: rec for rec in data}
    if isinstance(data, dict):
        if 'scenario_id' in data:
            return {data['scenario_id']: data}
        return {k: v for k, v in data.items() if isinstance(v, dict)}
    raise ScoringError('unsupported labels file shape')


def resolve_baseline(label: dict, variants_dir: Path, explicit: Path | None) -> tuple[Path, str]:
    if explicit is not None:
        path = explicit
        if not path.exists():
            raise ScoringError(f'baseline not found: {path}')
        return path, 'explicit'
    for field in ('baseline_path', 'variant_path'):
        if label.get(field):
            path = (STUDY / label[field]).resolve()
            if path.exists():
                return path, field
    for field in ('variant_id', 'baseline_id'):
        value = label.get(field)
        if not value:
            continue
        for candidate in (variants_dir / f'{value}.html', variants_dir / value):
            if candidate.exists():
                return candidate, field
    raise ScoringError(
        f'no baseline HTML found for {label.get("scenario_id")!r}: pass --baseline, '
        f'--variants-dir, or a baseline_path/variant_id in the label record'
    )


def detector_flags(verdict) -> dict:
    """JSON-native flags; values are matched source snippets (strings) or bools."""
    flags = {}
    for key, value in verdict.flags.items():
        flags[key] = value if isinstance(value, bool) else str(value)
    return flags


def score_run(
    label: dict,
    output_path: Path,
    arm: str,
    rep: int,
    *,
    baseline_path: Path | None = None,
    variants_dir: Path | None = None,
    run_id: str | None = None,
) -> dict:
    if arm not in ARMS:
        raise ScoringError(f'arm must be one of {ARMS}, got {arm!r}')
    if not isinstance(rep, int) or isinstance(rep, bool) or rep < 0:
        raise ScoringError(f'rep must be a non-negative integer, got {rep!r}')
    if not output_path.exists():
        raise ScoringError(f'output not found: {output_path}')
    scenario_id = label.get('scenario_id')
    stratum = label.get('stratum')
    if not scenario_id:
        raise ScoringError('label record has no scenario_id')
    if not stratum:
        raise ScoringError('label record has no stratum')

    family = trigger_zones.family_for_stratum(stratum)
    expected_primary, expected_sensitivity = EXPECTED[family]
    label_primary = label.get('applicable_detector')
    label_sensitivity = label.get('applicable_sensitivity_detector')
    detector_source = 'label_record'
    if label_primary is None and label_sensitivity is None:
        label_primary, label_sensitivity = expected_primary, expected_sensitivity
        detector_source = 'derived_from_stratum'
    detector_fields_match = (
        label_primary == expected_primary and label_sensitivity == expected_sensitivity
    )
    if not detector_fields_match:
        raise ScoringError(
            f'label detector fields disagree with the stratum family: '
            f'{label_primary!r}/{label_sensitivity!r} vs '
            f'{expected_primary!r}/{expected_sensitivity!r}'
        )

    variants = variants_dir if variants_dir is not None else STUDY / 'corpus' / 'variants'
    baseline_file, baseline_source = resolve_baseline(label, variants, baseline_path)
    baseline_html = baseline_file.read_text(encoding='utf-8')
    output_html = output_path.read_text(encoding='utf-8')

    baseline_sha = sha256_text(baseline_html)
    recorded_baseline_sha = label.get('baseline_sha256') or (label.get('hashes') or {}).get('variant_sha256')
    output_sha = sha256_text(output_html)

    errors = []
    if recorded_baseline_sha and recorded_baseline_sha != baseline_sha:
        errors.append(
            f'baseline_sha256 mismatch: label {recorded_baseline_sha}, resolved file {baseline_sha}'
        )

    primary = frozen.DETECTORS[label_primary](output_html)
    sensitivity = frozen.DETECTORS[label_sensitivity](output_html)
    baseline_primary = frozen.DETECTORS[label_primary](baseline_html)
    baseline_sensitivity = frozen.DETECTORS[label_sensitivity](baseline_html)
    if baseline_primary.violation:
        errors.append(
            f'baseline is not clean under {label_primary}: {detector_flags(baseline_primary)}'
        )
    if baseline_sensitivity.violation:
        errors.append(
            f'baseline is not clean under {label_sensitivity}: {detector_flags(baseline_sensitivity)}'
        )

    zone = trigger_zones.classify(output_html, stratum, baseline_html)
    if primary.violation and not zone['exposed']:
        errors.append('primary detector violation but no novel trigger-zone construct')
    if sensitivity.violation and not zone['exposed']:
        errors.append('sensitivity detector violation but no novel trigger-zone construct')

    record = {
        'scoring_version': SCORING_VERSION,
        'frozen_detectors_sha256': frozen.frozen_hashes(),
        'run_id': run_id,
        'scenario_id': scenario_id,
        'stratum': stratum,
        'arm': arm,
        'rep': rep,
        'output_sha256': output_sha,
        'output_bytes': len(output_html.encode('utf-8')),
        'baseline_sha256': baseline_sha,
        'baseline_sha256_recorded': recorded_baseline_sha,
        'baseline_source': baseline_source,
        'baseline_file': str(baseline_file.relative_to(STUDY)) if baseline_file.is_relative_to(STUDY) else str(baseline_file),
        'label_sha256': sha256_text(canonical_json(label)),
        'applicable_detector': label_primary,
        'applicable_sensitivity_detector': label_sensitivity,
        'detector_source': detector_source,
        'detectors': {
            'primary': {
                'name': label_primary,
                'violation': bool(primary.violation),
                'flags': detector_flags(primary),
            },
            'sensitivity': {
                'name': label_sensitivity,
                'violation': bool(sensitivity.violation),
                'flags': detector_flags(sensitivity),
            },
        },
        'violation': bool(primary.violation),
        'sensitivity_violation': bool(sensitivity.violation),
        'trigger_zone': zone,
        'construct_keys': {
            'baseline': zone['baseline_keys'],
            'output': zone['output_keys'],
            'novel': zone['novel_keys'],
        },
        'exposed': bool(zone['exposed']),
        'consistency': {
            'ok': not errors,
            'violation_implies_novel_construct': bool(not primary.violation or zone['exposed']),
            'sensitivity_violation_implies_novel_construct': bool(
                not sensitivity.violation or zone['exposed']
            ),
            'detector_fields_match_stratum': detector_fields_match,
            'errors': sorted(errors),
        },
    }
    return record


def write_record(record: dict, out: Path | None) -> None:
    text = json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + '\n'
    if out is None:
        sys.stdout.write(text)
    else:
        out.write_text(text, encoding='utf-8')


def score_single(args) -> int:
    labels_path = Path(args.label)
    if args.scenario_id:
        label = load_label(labels_path, args.scenario_id)
    else:
        label = load_label(labels_path, None)
    output = Path(args.output)
    record = score_run(
        label,
        output,
        args.arm,
        args.rep,
        baseline_path=Path(args.baseline) if args.baseline else None,
        variants_dir=Path(args.variants_dir) if args.variants_dir else None,
        run_id=args.run_id,
    )
    write_record(record, Path(args.out) if args.out else None)
    if args.strict and not record['consistency']['ok']:
        return 3
    return 0


def labels_from_pilot_plan(plan: dict, variants_dir: Path) -> dict:
    """Mechanically derive label records for the 30 pilot scenarios.

    The pilot plan is the authoritative identity/seed source; detector fields
    are derived from the stratum family and baseline hashes are computed. This
    is recorded in label_provenance so a pilot score is never mistaken for a
    frozen corpus label.
    """
    labels = {}
    for entry in plan.get('pilot_scenarios') or []:
        scenario_id = entry.get('pilot_scenario_id') or entry.get('scenario_id')
        stratum = entry.get('stratum')
        variant_id = entry.get('variant_id')
        if not scenario_id or not stratum or not variant_id:
            raise ScoringError('pilot plan scenario is missing pilot_scenario_id/stratum/variant_id')
        family = trigger_zones.family_for_stratum(stratum)
        primary, sensitivity = EXPECTED[family]
        variant_file = variants_dir / f'{variant_id}.html'
        if not variant_file.exists():
            raise ScoringError(f'pilot variant missing: {variant_file}')
        html = variant_file.read_text(encoding='utf-8')
        labels[scenario_id] = {
            'scenario_id': scenario_id,
            'stratum': stratum,
            'baseline_family': family,
            'variant_id': variant_id,
            'baseline_sha256': sha256_text(html),
            'applicable_detector': primary,
            'applicable_sensitivity_detector': sensitivity,
            'opportunity_class': entry.get('opportunity_class'),
            'trigger_types': list(trigger_zones.FAMILY_TRIGGER_TYPES[family]),
            'paraphrase_id': entry.get('paraphrase_id'),
            'label_provenance': {'source': 'pilot/pilot-plan.json', 'derivation': 'mechanical; not a frozen corpus label'},
        }
    if len(labels) != 30:
        raise ScoringError(f'pilot plan must hold 30 pilot scenarios (found {len(labels)})')
    return labels


def score_batch(args) -> int:
    records_dir = Path(args.records_dir)
    variants_dir = Path(args.variants_dir) if args.variants_dir else STUDY / 'corpus' / 'variants'
    labels = {}
    if args.labels:
        labels.update(load_labels(Path(args.labels)))
    if args.pilot_plan:
        labels.update(labels_from_pilot_plan(read_json(Path(args.pilot_plan)), variants_dir))
    if not labels:
        raise ScoringError('batch scoring needs --labels or --pilot-plan')
    out_path = Path(args.out) if args.out else None
    lines = []
    problems = 0
    scored = 0
    for record_file in sorted(records_dir.glob('*.json')):
        run = read_json(record_file)
        run_id = run.get('run_id') or record_file.stem
        if run.get('status') != 'succeeded':
            continue
        scenario_id = run.get('scenario_id')
        label = labels.get(scenario_id) if scenario_id else None
        if label is None:
            problems += 1
            lines.append({'run_id': run_id, 'scoring_error': f'no label for {scenario_id!r}'})
            continue
        rel = run.get('output_path') or run.get('output_file')
        output = Path(rel) if rel else (STUDY / 'pilot' / 'outputs' / f'{run_id}.html')
        if not output.is_absolute():
            output = (STUDY / output).resolve()
        try:
            record = score_run(
                label,
                output,
                run['arm'],
                int(run['rep']),
                variants_dir=variants_dir,
                run_id=run_id,
            )
        except ScoringError as exc:
            problems += 1
            lines.append({'run_id': run_id, 'scoring_error': str(exc)})
            continue
        scored += 1
        if not record['consistency']['ok']:
            problems += 1
        lines.append(record)
    text = ''.join(canonical_json(line) + '\n' for line in lines)
    if out_path is None:
        sys.stdout.write(text)
    else:
        out_path.write_text(text, encoding='utf-8')
    print(f'scored {scored} runs; problems {problems}', file=sys.stderr)
    return 0 if problems == 0 else 3


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Study 02 deterministic scorer')
    parser.add_argument('--label', help='label record JSON (object, array or mapping)')
    parser.add_argument('--scenario-id', help='scenario id when --label holds many records')
    parser.add_argument('--output', help='output HTML file to score')
    parser.add_argument('--arm', help='none | memory | manual | corrected')
    parser.add_argument('--rep', type=int, help='repetition index (0-based)')
    parser.add_argument('--baseline', help='baseline variant HTML (default: resolve from label)')
    parser.add_argument('--variants-dir', help='directory of frozen corpus variant HTML files')
    parser.add_argument('--run-id')
    parser.add_argument('--out', help='write the record here instead of stdout')
    parser.add_argument('--strict', action='store_true', help='exit 3 on consistency errors')
    parser.add_argument('--records-dir', help='batch: score every succeeded runner record')
    parser.add_argument('--labels', help='batch: labels JSON/JSONL for the records')
    parser.add_argument('--pilot-plan', help='batch: derive pilot labels mechanically from pilot/pilot-plan.json')
    args = parser.parse_args(argv)

    try:
        if args.records_dir:
            if not args.labels and not args.pilot_plan:
                parser.error('--records-dir requires --labels or --pilot-plan')
            return score_batch(args)
        missing = [name for name in ('label', 'output', 'arm', 'rep') if getattr(args, name) in (None, '')]
        if missing:
            parser.error('single-run scoring requires --label --output --arm --rep')
        return score_single(args)
    except ScoringError as exc:
        print(f'scoring error: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
