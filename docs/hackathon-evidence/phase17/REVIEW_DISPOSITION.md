# Phase 17 — review disposition

**Date:** 2026-10-29. **Scope:** PR #2 (`phase17-results` → `main`). **Status:** post-run review;
no trial was rerun, no locked file was edited, no original output was changed, and history was not
rewritten.

This file records the disposition of the reviewer's ten findings, the additional verification done
alongside them, the trial-integrity audit, the lock/checksum results and the provenance
reconciliation. Claims stay limited to the six tested strata and the two tested models.

## 1. The reviewer's ten findings

The numbering below is the reviewer's. **R1–R4 are fixed in this PR; R5–R10 are real defects that
did not occur in the 480 runs, and they live in locked files, so they are documented for future
runners rather than patched.**

### R1. Inflated p-values (fixed)

**Confirmed.** The locked tail rule ends with `+ 1e-15`, an absolute floor, so nine of the twelve
reported p-values were upper bounds rather than exact values (Muse Spark H1: exact 6.52 × 10⁻²⁰
reported as 2.02 × 10⁻¹⁶; Muse Spark Open H1: exact 1.12 × 10⁻²⁴ reported as 4.72 × 10⁻¹⁶).
`RESULTS.md` now reports the exact values as a dated post-run correction; the exact recomputation
is in `exact_stats.py` and `phase17-analysis-corrected.json`; the as-run `phase17-analysis.json`
is preserved unchanged. No verdict changes. Details and checksums: `STATS_CORRECTION.md`.

### R2. The verifier passed with no lock manifest (fixed)

**Confirmed.** `scripts/verify-phase17.ts` treated an absent `protocol.sha256` as a draft and
still printed PASS. The locked file is unchanged; `scripts/verify-phase17-strict.ts` now fails
when the manifest or the lock metadata (`LOCK.md`, the locked status line) is missing, and
`pnpm verify:research17` runs it after the legacy verifier.

### R3. The p-value comparison accepted almost any tiny number (fixed)

**Confirmed.** The legacy `close()` used `Math.max(|expected| × 1e-9, 1e-15)`, so for any expected
p below 1e-15 a reported 0 compared equal. The strict validator uses a relative-only comparison
with no absolute floor, and the regression suite asserts that 0 and 1e-30 do **not** match
2.02 × 10⁻¹⁶.

### R4. A stray `.DS_Store` broke the checksum check (fixed)

**Confirmed.** `scripts/verify-phase17-sums.ts` walked every file under `out/`, so OS metadata
either failed the run or had to be added to the manifest. The rewritten inventory policy ignores
explicitly named OS metadata (`.DS_Store`, AppleDouble `._*`, `Thumbs.db`, `desktop.ini`,
`.localized`) and refuses to let the manifest list it. Required evidence stays mandatory: every
documented artefact must be present and listed, and unlisted or undocumented substantive files
are rejected. Regressions cover all three behaviours.

### R5. Port-release race (not patched)

**Latent, did not occur.** `stopServer` signals the process group and waits 600 ms; the next run
in the shard reuses the same port, so a slow shutdown could serve the next run from the old
process. No occurrence in this experiment: zero `harness_error` records, no
“server did not start”/`EADDRINUSE` in any shard log. Future runners should wait for the old
process to exit (or allocate a fresh port). Recorded, not patched: `harness.mjs` is locked.

### R6. No request timeout (not patched)

**Latent, did not occur.** The `fetch` calls in `harness.mjs` and `run_open.mjs` carry no
`AbortSignal`, so a stalled connection would hang a shard. No occurrence: all 240 Open runs
completed (mean 52 s, max 177 s) and every Muse Spark run is bounded by the job runtime cap plus
the harness poll limit. Future runners should add an abort timeout to every request.

### R7. Crash when an arm has no usable runs (not patched)

**Latent, did not occur.** `newcombe()` divides by `n`; `contrast()` guards for `None` but the H2
call is unguarded, and `h1['risk_difference'] < 0` would raise on `None`. No occurrence: the
smallest arm has 57 usable runs. Future runners should fail with a clear message (or switch to an
exact interval) when an arm has zero usable runs.

### R8. A succeeded run recorded with no output (not patched)

**Latent, did not occur.** In `run_spark.mjs` the job status is assigned before the staging
`index.html` is copied, and the `catch` block cannot downgrade an already-`succeeded` record, so a
missing staging file would leave `status = "succeeded"` with no output. Audit: **0 of 232**
succeeded Muse Spark records lacked an output, and none had a hash or byte-count mismatch. Future
runners should copy first and only then set the status, downgrading on failure.

### R9. Wrong detector description (not patched)

**Confirmed, cosmetic.** `detectors.py` calls `child_safety_broad` a “sensitivity reading”, but
`design.json` uses it as the primary game detector and `child_safety` as the sensitivity detector.
The `DETECTORS` mapping is correct, so no result is affected. Locked file; the discrepancy is
recorded here and in `STATS_CORRECTION.md`’s detector references rather than edited.

### R10. Retry repeats a truncated reply (not patched)

**Latent, did not occur.** `run_open.mjs` retries on `finish_reason = "length"` with the same
prompt at temperature 0, so the retry cannot repair a deterministic truncation and costs a second
call. No occurrence: 0 truncations in 240 Open runs (all final `finish_reason = "stop"`). Future
runners should treat truncation as terminal or change the request (length or continuation) rather
than repeat it, and record the first-attempt cause.

## 2. Additional verification performed

These were not reviewer findings; they were checked so the frozen result could be relied on.

- **Fisher direction and two-sided definition.** The null distribution of the arm-1 total is the
  convolution of the per-stratum hypergeometrics and the tail sums every outcome no more probable
  than the observed one (Fisher's rule, ties included) — the pre-registered definition. Low
  observed counts (H1 `memory`) and high ones (H3 `corrected`) are handled symmetrically.
- **Risk differences, intervals, H2, sensitivity, worst case.** All recomputed from the records and
  unchanged. H2 uses the upper 90% Newcombe bound in the direction `memory − manual`: +4.5 pp
  (Muse Spark) and +7.1 pp (Muse Spark Open), both below the +15 pp margin.
- **The eight excluded Muse Spark runs.** Each has a Forge job record whose `created_at` →
  `finished_at` interval is exactly 1800 s, `status = "failed"` and the runtime-budget error.
- **Transport, retries, truncation, server lifecycle.** 240/240 Open runs returned HTTP 200 with
  `finish_reason = "stop"`; 6 runs used the pre-registered second attempt, and the runner does not
  retain the first-attempt cause (a traceability gap, not an inclusion change).

## 3. Trial-integrity audit

An independent read-only audit rebuilt the expected cell list from `design.json` and checked every
record and artefact:

| Check | Result |
|---|---|
| Expected record identities (6 strata × 4 arms × 10 runs × 2 models = 480) | **480/480 present, 0 missing, 0 extra** |
| Duplicates / id-arm-stratum mismatches | 0 |
| Records per cell | 10 in all 48 cells |
| Prompts present and hash-matched | 480/480 |
| Succeeded runs with output, hash and byte count matched | 472/472 |
| Succeeded Muse Spark runs with no output | **0** |
| Unusable runs with an output file | 0 |
| Muse Spark job records copied | 240/240 (232 succeeded, 8 failed) |
| Shard summaries | 12/12, shard metadata consistent |
| Manipulation checks (rule text, 0/2/1/2 memories, correction supersedes and appears) | **480/480 pass, 0 failures** |
| Muse Spark Open usability (HTTP 200, `finish_reason = "stop"`, complete HTML) | **240/240** |
| Muse Spark Open attempts | 234 at attempt 1, 6 at attempt 2 |
| Exclusions | 8, all Muse Spark, all 1800 s runtime budget, all with job records |

No discrepancy was found. Nothing was repaired and no exclusion was changed.

## 4. Lock and checksum results

| Check | Result |
|---|---|
| `protocol.sha256` inventory | 17/17 expected paths, in the locked order |
| Locked files vs manifest | **17/17 match** |
| `protocol.sha256` SHA-256 | `2f1f76668d31ebfa171ff042e2509493e329f72d20a18bce1f57a3c866d58767` (pinned) |
| Lock metadata | `LOCK.md` names commit `6640e83…` and tag `phase17-preregistration`; `PROTOCOL.md` carries the locked status line |
| Original analysis | `phase17-analysis.json` pinned by hash **and** by relative-value comparison for every p-value |
| Evidence inventory | 1205 files (1204 under `out/` + the analysis), all listed and matched; OS metadata ignored, not required |
| Corrected reporting | `phase17-analysis-corrected.json` reproduces exactly from the raw records on every run |
| Distinct labelling | original = hash-pinned `phase17-analysis.json`; corrected = `phase17-analysis-corrected.json` + `CORRECTIONS.sha256` |

`pnpm verify:research17` runs the locked verifier, then the inventory check, then the strict
lock/statistics validator, and exits nonzero if any of them fails.

## 5. Regressions

`tests/research/phase17-evidence.test.ts` builds disposable copies of the evidence tree and
asserts that verification fails for: a missing manifest, missing lock metadata, a modified locked
file, a manifest with a missing entry, and a tampered statistical value. For the inventory check
it asserts that `.DS_Store` does not invalidate a correct tree, that missing or changed evidence
fails, and that unlisted and undocumented substantive files fail. It also proves the comparison
itself: 0 and 1e-30 never match a tiny expected p, and a 0.3% change is rejected. Mutations are
made only in temporary directories.

## 6. Provenance

- The protocol was locked by commit `6640e83f3c999cd1349420ad5e95bc329fff7d36`, pushed
  2026-10-28 11:18:28 UTC, before the first run. An annotated tag
  `phase17-preregistration` (`303eb4d5…`) points at it and is still on `origin`.
- The repository history was later rewritten by the repository owner to drop commit-message
  trailers. The rewritten lock commit is `52ce00f` locally and `da821d7` on this PR branch; both
  trees are identical to `6640e83` (`git diff 6640e83 52ce00f` and `git diff 6640e83 da821d7` are
  empty).
- **What the hashes establish:** the content of the 17 locked files and of the manifest itself is
  fixed by `protocol.sha256` (SHA-256 above), the manifest was in a commit that existed on
  `origin` before the first run, and the same manifest and files verify today. The 480 records and
  their outputs are bound to that identity because the analysis and the verifier re-derive every
  count from them under the locked detectors.
- **What they cannot establish:** there is no per-run attestation that the locked bytes were the
  bytes on disk during every run, and the history rewrite means the pre-registration commit SHA
  differs between the public tag (`6640e83`) and this branch (`da821d7`). The tag and the
  empty-tree diff are the bridge; the SHA-256 of the manifest is the content identity.

## 7. Categorisation

| Category | Items |
|---|---|
| **Experimental protocol deviations** | none |
| **Execution incidents** | 8 Muse Spark runs hit the pre-registered 1800 s runtime budget and were excluded as written; 6 Muse Spark Open runs used the pre-registered second attempt without the first-attempt cause being retained; the owner rewrote branch history during the run (version control only, identical trees) |
| **Post-run analysis/reporting corrections** | the exact p-values (R1), recorded in `STATS_CORRECTION.md`; no verdict changes |
| **Future tooling improvements** | R5 port release, R6 request timeouts, R7 zero-usable-arm guard, R8 copy-then-status, R10 retry policy and first-attempt logging, R9 docstring |

## 8. What H3 shows

H3's outcome is measured with the detector for the **original** rule. The `corrected` arm has a
higher original-rule rate than `memory` because the correction tells the model that the earlier
restriction no longer applies — the run is following the corrected decision, not regressing on
safety. H3 therefore shows that a corrected rule stops constraining output; it does not say the
corrected output is safer or less safe under the original rule. The permissive correction text is
pre-registered and this descriptive pattern is reported as such in `RESULTS.md`.
