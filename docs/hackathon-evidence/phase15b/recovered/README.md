# Phase 15B — recovered research tooling and baseline artefacts

**Status:** recovered after the experiment. Nothing in this directory was committed while the
trial ran. These are byte-for-byte copies of files that existed only in an untracked directory on
the original development machine.

| | |
|---|---|
| Recovered on | 2026-10-28 |
| Source machine | the original development host |
| Source worktree | `/Users/burnz/projects/muse-memory-lab` |
| Source branch | `agent/phase15b` |
| Source commit at recovery | `9f5eaa19698f6b969b53671cc7fca5fb0fafd415` |
| Source directory | `video/` (excluded locally by `.git/info/exclude`, line `video/`) |
| Copy method | `shutil.copy2` — byte-for-byte, source mtimes preserved |
| Integrity | [`SHA256SUMS`](SHA256SUMS) and [`recovery-manifest.json`](recovery-manifest.json) |

## Why these files were not in the repository

The experiment ran from an untracked working directory. The repository's `.gitignore` does **not**
exclude `video/`; the exclusion was a **local-only** entry in `.git/info/exclude`:

```
# Video production (local only, never committed)
video/
```

That entry is not part of the repository, so the presence of these files was invisible to anyone
who cloned `sidonsoft/muse-recall`. This directory is the first publication of the files that
survived.

Two consequences must be stated plainly:

1. These artefacts were **untracked during the experiment**. Their inclusion here does not imply
   they were committed, reviewed or frozen before the trial.
2. Recovery is **not reconstruction**. No recovered script has been edited, reformatted or repaired
   to make the historical results reproducible.

## What was recovered

| Group | Files | What it is |
|---|---:|---|
| `tools/` | 4 | The trial runner (`pilot-15b.mjs`), the analysis script (`analyze-15b.py`), the baseline generator (`gen-baseline.mjs`) and the model-attribution probe (`model-check.mjs`) |
| `baseline/` | 17 | All five baseline candidate HTML files, both candidate manifests and the candidate screenshots |
| `pilot-runs/` | 11 | Phase 15B pilot run records (3 JSON) and the eight pilot outputs, including the two boundary-probe outputs. **Excluded from the 32-run analysis.** |
| `recorded-diffs/` | 40 | The diff files exactly as recorded — all 0 bytes, because of the harness bug documented in [`../DEVIATIONS.md`](../DEVIATIONS.md) (Deviation F). 32 are trial runs and 8 are pilot runs. |

The **corrected** scorer (`rubric.py`, v2) is already published at
[`../rubric.py`](../rubric.py). It is not duplicated here. Its SHA-256 is
`74b2c2551c476c7c6c28fa4b5f958137575357160ca02e11e21eb5d3c8baa5ea`.

The **original** scorer (v1) is not in this directory and exists nowhere: its working copy
`video/tools/rubric.py` was overwritten by v2 at 21:55:01 on 2026-10-27. Only the v1 output JSON
survives, at [`../rubric-v1-flawed.json`](../rubric-v1-flawed.json). See
[`../PROVENANCE_MANIFEST.md`](../PROVENANCE_MANIFEST.md) §5.

## What was not recovered

- The original v1 scoring implementation (`rubric.py` as it existed before 21:55:01).
- Per-run model identifiers from `run.model.configured`.
- Per-run retrieved memory identifiers.
- Any per-run human coding table. Only a narrative account survives in `RESULTS.md` §3.
- The non-empty diff files the protocol promised; the recorded files are empty because the runner
  read the wrong response field.
- Server or job logs that would show whether fallback activated.

None of these gaps is filled by inference in this directory.

## Verification

From this directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Every line must report `OK`. The chosen baseline
`baseline/sky-pairs-high-cand2.html` must hash to
`5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03`, matching the protocol and
`trial-results.json`.
