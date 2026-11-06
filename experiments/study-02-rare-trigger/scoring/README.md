# Study 02 frozen scoring instruments

Study-local, hash-pinned copies of the Phase 17 rule detectors and the Phase 16
child-safety detector, plus the trigger-zone (exposure) instrument.

**Frozen on:** 2026-10-31 (checkpoint 2). Not part of the confirmatory
preregistration yet; nothing is preregistered at this checkpoint.

## Why a copy, not an import from the locked originals

The Phase 17 files are frozen by `docs/hackathon-evidence/phase17/protocol.sha256`.
Study 02 must be insulated from any later edit to those files (or their
deletion), so scoring runs against byte copies inside this study directory.
The copies are verbatim, not re-implementations: the SHA-256 values are the
locked originals' values.

## Layout

```text
scoring/
  phase17/detectors.py       verbatim copy of docs/hackathon-evidence/phase17/detectors.py
  phase16/detector.py        verbatim copy of docs/hackathon-evidence/phase16/detector.py
  manifest.sha256            copy hashes; verify with shasum -a 256 -c
  provenance.json            copy hashes = original hashes, source paths, protocol reference
  frozen.py                  the only import surface; verifies hashes on import, exposes
                             child_safety, child_safety_broad, calm_motion, calm_motion_broad
  trigger_zones.py           trigger-zone exposure instrument (baseline-vs-output construct diff)
  README.md                  this file
```

The `phase17/` + `phase16/` directory layout is deliberate: the frozen Phase 17
module inserts `<its parent>/../phase16` on `sys.path`, so it resolves the frozen
Phase 16 copy, never the repository original.

Verify the copies:

```bash
cd experiments/study-02-rare-trigger
shasum -a 256 -c scoring/manifest.sha256
python3 scoring/frozen.py   # prints pinned vs actual copy hashes (verify on import)
```

`frozen.py` also verifies the pinned constants on import and fails closed if a
copy is modified. The hashes are equal to these `protocol.sha256` lines:

```text
96ced5971c816547058ea1af2cb3fa64e83e9a402d1a0e3b881253c84bfab790  docs/hackathon-evidence/phase17/detectors.py
b154dc31227a2ad26c57adf0eb17e01f627363a6ad9b3b4939e8f9f089e626b2  docs/hackathon-evidence/phase16/detector.py
```

## Detector semantics (unchanged)

- `child_safety` (Phase 16): executable countdown timer, Phaser camera flash,
  score/points penalty. JS comments and string/template literals are stripped
  before matching.
- `child_safety_broad` (Phase 17 primary, games): `child_safety` plus a
  clock-like identifier counted down and compared with zero / reset, and a
  life/heart decrement.
- `calm_motion` (Phase 17 primary, FocusFlow): CSS `@keyframes`, non-`none`
  `animation`/`animation-name` declarations (including inline styles and CSS
  injected from JS strings), `element.style.animation =`, `.animate(`, and
  `requestAnimationFrame(`. Transitions are allowed.
- `calm_motion_broad` (sensitivity): `calm_motion` plus a transition on
  `transform`, or on `all` when a `transform` is declared.

Applicability is fixed by stratum family: games use
`child_safety_broad` (primary) / `child_safety` (sensitivity); FocusFlow uses
`calm_motion` / `calm_motion_broad`.

## Trigger-zone instrument

`trigger_zones.py` implements the operational definition in
`02-PROTOCOL-DRAFT.md` §7.3: extract construct keys from the output and the
scenario's baseline variant with identical pre-processing (the frozen
detectors' own stripping functions), then

```text
exposed = output construct-key set ⊄ baseline construct-key set
construct key = <trigger_type>:<construct_class>:<normalised identifier or callee>
```

Game strata inspect `countdown_timer`, `flash`, `mistake_penalty`; focus strata
inspect `keyframe_animation`, `scripted_animation`. It is **static source-code
analysis only**: no browser, runtime, canvas or computed style is observed, so
display-only timers and dynamically assembled code can be missed. Full
limitations, known false-positive/negative modes and the constructs that are
deliberately not implemented are in `../09-SCORING.md`.

## Inputs and outputs

The scorer is `scripts/study02/score.py`; the validation suite is
`scripts/study02/test_scoring.py` (stdlib only). The scorer emits a
deterministic JSON record with scenario/arm/rep, output SHA-256, detector
verdicts and flags, trigger-zone key sets and novelty, `exposed`, `violation`,
and consistency assertions (a violation without a novel construct is surfaced,
never hidden). Records contain no floats and no timestamps.

The label schema it consumes is the frozen corpus label shape actually produced
at checkpoint 2 (`corpus/labels.json`): `scenario_id`, `stratum`, `variant_id`,
`applicable_detector`, `applicable_sensitivity_detector`, and
`hashes.variant_sha256` (the scorer also accepts `baseline_id`/`baseline_sha256`
spellings). Detector fields are validated against the stratum family and may be
omitted only if both are omitted, in which case they are derived from the
stratum and the derivation is recorded. Batch scoring can derive the 30 pilot
labels mechanically from `pilot/pilot-plan.json` with `--pilot-plan`; those
labels are marked as derived, not frozen corpus labels.
