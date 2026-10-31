# Study 02 — reproduction instructions (checkpoint scope)

This file records how to reproduce everything the checkpoint asserts. The full confirmatory
reproduction procedure will be written when the corpus, harness and frozen manifest exist. Until
then, treat every number in this directory except the [VERIFIED NOW] results as a draft.

Run all commands from the repository root (`/Users/burnz/projects/muse-memory-lab`), on branch
`integration` (base commit `97cab5b` at checkpoint time, plus the checkpoint commit that adds this
directory). Tools used: Python 3.9.6, Node v26.8.1, pnpm 10.32.1.

## 0. Verify the checkpoint artefact manifest

```bash
sha256sum -c experiments/study-02-rare-trigger/MANIFEST-checkpoint1.sha256
# expect 13/13 OK (the manifest lists every checkpoint artefact except itself)
```

The manifest is an integrity record for this checkpoint, **not** the preregistration lock. The
preregistration manifest (`design/protocol.sha256`) does not exist yet and will cover a different,
frozen file set.

> **Warning — never run evidence scripts in place.** `docs/hackathon-evidence/phase17/analyze_phase17.py`
> writes `phase17-analysis.json` into its own directory. Running it from the repository writes to a
> tracked, hash-manifested evidence file. Always copy the evidence directory to `/tmp` first, as
> below. (This happened once during the audit and was caught and restored; `SHA256SUMS` verifies the
> restored file.)

## 1. Verify the Phase 17 lock and raw-output manifests

```bash
git checkout integration

# 17 locked pre-run files
sha256sum -c docs/hackathon-evidence/phase17/protocol.sha256          # 17/17 OK

# 1204 raw outputs + as-run analysis
cd docs/hackathon-evidence/phase17
sha256sum -c SHA256SUMS                                               # 1205/1205 OK
cd -
```

## 2. Verify the detector fixtures and baseline cleanliness

```bash
python3 -I docs/hackathon-evidence/phase17/test_detectors.py
# expect: "41 fixtures pass; baselines clean: ..." / "all detector tests passed"
```

## 3. Reproduce the Phase 17 analysis (out-of-tree)

```bash
rm -rf /tmp/study02-repro && mkdir -p /tmp/study02-repro
cp -R docs/hackathon-evidence/phase17 docs/hackathon-evidence/phase16 /tmp/study02-repro/
cd /tmp/study02-repro/phase17
rm -f phase17-analysis.json phase17-analysis-corrected.json
python3 -I analyze_phase17.py out
sha256sum phase17-analysis.json
# expect f384fca782cc7b0f8c8675f4218b98ef1ebbfbc9e0eedd4b0f1687e598fd9d64
diff <(sha256sum phase17-analysis.json | cut -d' ' -f1) \
     <(sha256sum /Users/burnz/projects/muse-memory-lab/docs/hackathon-evidence/phase17/phase17-analysis.json | cut -d' ' -f1)
```

## 4. Reproduce the corrected exact p-values

```bash
cd /tmp/study02-repro/phase17
python3 -I exact_stats.py --check          # exits 0 when the corrected values reproduce
```

## 5. Re-run the full repository verifier (optional, slower)

```bash
pnpm install                               # if node_modules is absent
pnpm verify:research17                     # detectors, lock, sums, counts, verdicts
```

Note: `verify:research17` prints the *as-run* (pre-correction) p-values; `verify-phase17-strict.ts`
checks the corrected reporting. Both are same-author tools — passing them is not independent
verification.

## 6. Reproduce the power simulation

```bash
python3 experiments/study-02-rare-trigger/analysis/power_study2.py \
  > /tmp/power-rerun.txt                    # ~35 s, numpy required
diff <(sed -E 's/run (started|finished).*//' /tmp/power-rerun.txt) \
     <(sed -E 's/run (started|finished).*//' \
       experiments/study-02-rare-trigger/analysis/power_study2.txt)
# expect no differences other than runtime/timestamp lines
```

The simulation is deterministic under a fixed seed and is a **simulation under assumptions, not
observed data**. Its first line states this.

## 7. Validate the machine-readable design draft

```bash
python3 - <<'PY'
import json
d = json.load(open('experiments/study-02-rare-trigger/design/design-draft.json'))
assert d['status'] == 'draft'
assert d['total_runs']['confirmatory'] == 4800
assert d['total_runs']['pilot'] == 240
assert d['execution_totals']['confirmatory_executions'] == 4800
assert d['execution_totals']['high_opportunity_scenario_clusters'] == 200
assert len(d['strata']) == 6 and len(d['arms']) == 4
assert d['seed_hex'] == '0x02A2026'
print('design draft arithmetic OK')
PY
```

## 8. Verify the Dell endpoint report's live claims (read-only)

The full discovery log is in `03-DELL-ENDPOINT.md` §8. The safe re-checks are liveness and identity
only — do not load the model, do not restart the server, do not touch the Strata PC:

```bash
curl -s http://192.168.86.39:8080/health
curl -s http://192.168.86.39:8080/v1/models
curl -s http://192.168.86.39:8080/v1/status
```

Note the caveats in that report: SSH to `dell` lands in Windows `cmd.exe`; the process is not a
managed service; the endpoint is unauthenticated on the LAN; thinking is on by default.

## 9. Re-derive the feasibility arithmetic

```bash
python3 - <<'PY'
import glob, statistics
sizes = [len(open(f,'rb').read()) for f in glob.glob(
    'docs/hackathon-evidence/phase17/out/open/*.html')]
mean_bytes = statistics.mean(sizes)
tokens = mean_bytes / 4                      # rough bytes-per-token estimate
decode_s = tokens / 25                       # measured Dell decode rate
prefill_s = 7000 / 303                       # ~7k-token prompt at measured prefill rate
per_run = decode_s + prefill_s + 0.5
print(f"mean output {mean_bytes:.0f} B ~ {tokens:.0f} tok")
print(f"per run ~{per_run:.0f} s; 4800 runs ~{4800*per_run/86400:.1f} days serial")
PY
```

## 10. What cannot be reproduced yet

- Phase 15B/17 **generation** (no endpoint replay; original model state unavailable).
- Phase 15B's v1 scoring source (lost; only its per-run output survives).
- The Study 02 corpus, labels, harness, pilot and confirmatory results — they do not exist yet.
- Any claim of independent verification: the checkpoint's audit and verifiers are same-team work.
  The preregistered analysis must be independently re-implemented and, where human coding is used,
  independently coded.

---

# Checkpoint 2 additions (corpus, scoring, pilot) — 2026-10-31

These commands reproduce the checkpoint-2 artefacts. The pilot is Dell-only and free/local; the
confirmatory experiment does not exist in the tooling.

## 11. Validate the expanded corpus (deterministic, no network)

```bash
cd experiments/study-02-rare-trigger
python3 scripts/study02/gen_corpus.py --check       # reproduces all 68 generated files byte-identically
python3 - <<'PY'
import json
v = json.load(open('corpus/validation.json'))
assert v['ok'] and v['counts']['scenarios'] == 400 and v['counts']['scenarios_high'] == 200
assert v['counts']['variants'] == 60 and v['counts']['twin_pairs'] == 30
assert v['counts']['strata'] == {
    'farm-arcade': 60, 'farm-challenge': 60, 'orchard-arcade': 60,
    'orchard-challenge': 60, 'focus-reward': 80, 'focus-lively': 80}
print('corpus validation OK')
PY
sha256sum -c corpus/corpus.sha256 | tail -2   # 67/67 OK (run from the study directory)
```

## 12. Validate the frozen scoring endpoint

```bash
cd experiments/study-02-rare-trigger
python3 scripts/study02/test_scoring.py
# expects: 41 Phase 17 fixtures + baseline-clean; exposure fixtures; and an exact
# re-score of docs/hackathon-evidence/phase17/out reproducing phase17-analysis.json
```

## 13. Re-run the pilot dry-run (zero model calls)

```bash
cd /Users/burnz/projects/muse-memory-lab
pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_pilot.mjs --dry-run
# expects: 132/132 prompts, 120 primary + 12 repeats, 0 manipulation failures
```

## 14. Resume the pilot (Dell endpoint; Lead only, exclusive use)

```bash
pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/run_pilot.mjs --resume
# resumable: an existing pilot/records/<run_id>.json is never re-executed.
# Never run this concurrently with endpoint qualification or another client.
```

## 15. Recompute the pilot analysis

```bash
cd experiments/study-02-rare-trigger
python3 scripts/study02/analyze_pilot.py
# writes pilot/scores.jsonl, pilot/pilot-analysis.json, pilot/pilot-tables.md
```

The pilot analysis is descriptive only; it excludes itself from the confirmatory dataset and makes
no determinism claim (the Dell endpoint is not seed-deterministic at temperature 0.7 — see
`07-ENDPOINT-QUALIFICATION.md` §2.2).

## 16. Endpoint qualification evidence

`qualification/` holds the six real generations (prompts, requests, raw responses, extracted HTML,
records, measurements and the seed probes). The machine-readable summary is the JSON block in
`07-ENDPOINT-QUALIFICATION.md` §0; the raw per-run records are `qualification/records.json`.

---

# Checkpoint 2 final additions (pilot complete)

## 17. Verify the checkpoint-2 artefact manifest

```bash
cd experiments/study-02-rare-trigger
sha256sum -c MANIFEST-checkpoint2.sha256 | grep -v OK   # expect no output
sha256sum -c MANIFEST-checkpoint2.sha256 | grep -c OK   # 705/705 OK
```

The manifest covers every committed study file. Raw SSE stream transcripts
(`pilot/raw/*.sse.txt`, `pilot/replacements/raw/*.sse.txt`, 116 files, ~152 MB) are retained on the
authoring machine but **not committed** because of size; their SHA-256 values are committed in
`pilot/raw/SHA256SUMS-sse.txt`, and the parsed per-attempt responses, final HTML outputs, prompts and
records they produced are committed and covered by the manifest. Verify the local SSE transcripts
with `sha256sum -c pilot/raw/SHA256SUMS-sse.txt` on a machine that has them.

## 18. Verify the replacement executions

```bash
python3 - <<'PY'
import json, glob
prim = [json.load(open(f)) for f in glob.glob('pilot/records/*.json')]
repl = [json.load(open(f)) for f in glob.glob('pilot/replacements/records/*.json')]
fails = [r for r in prim if not r['usable']]
assert len(prim) == 132 and len(fails) == 9
assert len(repl) == len(fails) and all(r['usable'] for r in repl)
assert all(r['replacement_for'] for r in repl)
assert {r['replacement_for'] for r in repl} == {r['run_id'] for r in fails}
print('replacement policy consistent:', len(repl), 'replacements for', len(fails), 'originals')
PY
```

## 19. Recompute the final pilot analysis

```bash
python3 scripts/study02/analyze_pilot.py
# writes pilot/scores.jsonl, pilot/pilot-analysis.json, pilot/pilot-tables.md,
# pilot/replacements-scores.jsonl (replacements reported separately)
```

The analysis is descriptive only and explicitly excludes itself from the confirmatory dataset; the
endpoint is not seed-deterministic at temperature 0.7, so no determinism claim is made.
