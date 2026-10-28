# Phase 17 — review disposition

**Date:** 2026-10-29. **Scope:** PR #2 (`phase17-results` → `main`). **Status:** post-run review;
no trial was rerun, no locked file was edited, no original output was changed, and history was not
rewritten.

This file records the verified disposition of the ten review findings, the trial-integrity audit,
the lock/checksum results and the provenance reconciliation. Claims stay limited to the six
tested strata and the two tested models.

## 1. Findings

Legend: **confirmed** — reproduced from code or evidence; **refuted** — the evidence contradicts
the claim; **latent** — a real code defect that did not affect this experiment.

### F1. Fisher exact test direction and two-sided definition

**Refuted as a defect.** `stats17.stratified_exact` builds the null distribution of the total
violations in arm 1 as the convolution of the per-stratum hypergeometrics, then sums every total
whose probability is no greater than the observed one (Fisher's rule, two-sided, ties included).
That is the definition pre-registered in `PROTOCOL.md` §4. The observed statistic is the arm-1
total, so a low observed count (H1: `memory`) and a high one (H3: `corrected`) are both handled
symmetrically. An independent rational implementation reproduces the same tail sets.

### F2. Fixed numerical tolerance and tiny p-values

**Confirmed.** The tail rule ends with `+ 1e-15`, an absolute floor. When the exact tail is below
~1e-15 it also admits less probable outcomes, so nine of the twelve reported p-values were
inflated upper bounds (Muse Spark H1: exact 6.52 × 10⁻²⁰ reported as 2.02 × 10⁻¹⁶; Muse Spark
Open H1: exact 1.12 × 10⁻²⁴ reported as 4.72 × 10⁻¹⁶). See `STATS_CORRECTION.md` for the full
table, the method and the checksums. The published values were conservative; no verdict changes.
The reviewer's alternative p-values were not retrievable through the PR API (no review bodies),
so they are assessed against the exact table rather than quoted.

### F3. Risk differences, intervals, H2 direction/margin, sensitivity detectors, worst case

**Verified, no change.** Recomputed from the records: every risk difference and 95% Newcombe
interval matches the published value to the printed precision; H2 uses the upper 90% bound with
the pre-registered +15 pp margin in the correct direction (`memory − manual`), +4.5 pp
(Muse Spark) and +7.1 pp (Muse Spark Open); the sensitivity-detector tables re-derive; the
worst-case treatment adds each unusable run to both the numerator and the denominator of its arm.
Worst-case p-values were affected by F2 in the same way and are corrected in the same file.

### F4. The locked verifier accepts a missing `protocol.sha256`

**Confirmed.** `scripts/verify-phase17.ts` prints “protocol is a DRAFT” and continues when the
manifest is absent, then prints PASS if the other checks pass. The locked file was not edited.
`scripts/verify-phase17-strict.ts` now fails when the manifest is absent, and
`pnpm verify:research17` runs it after the legacy verifier.

### F5. Overly permissive p-value comparison in the locked verifier

**Confirmed.** `close()` uses `Math.max(|expected| * 1e-9, 1e-15)`, so for any expected p below
1e-15 a reported value of 0 is accepted, and the verifier cannot distinguish the inflated values
from the exact ones. The strict validator uses a relative-only comparison (no absolute floor) for
the pinned original values and re-derives the corrected values exactly.

### F6. A succeeded Muse Spark record could lack its output because copying failed

**Latent, not manifested.** In `run_spark.mjs` the job status is assigned before the staging
`index.html` is copied, and the `catch` block cannot downgrade an already-`succeeded` record. A
missing staging file would therefore leave `status = "succeeded"` with no output. Audit of all 232
succeeded Muse Spark records: **0 lacked an output file, 0 had a hash or byte-count mismatch**
(see §2). The defect is recorded for future runners and not patched here.

### F7. The eight excluded Muse Spark runs may not be genuine budget failures

**Refuted.** Each of the eight has a copied Forge job record whose `created_at` → `finished_at`
interval is exactly 1800 s (range 1802.6–1803.2 s wall including teardown), `status = "failed"`
and `error = "Job exceeded the 1800s runtime budget."`. The exclusion rule was pre-registered
(§5 of the protocol). The eight are spread over arms (3 none, 2 memory, 2 manual, 1 corrected), so
the per-protocol comparison is not biased toward an arm.

### F8. Transport failures, retries, truncation or server lifecycle altered inclusion

**Partly confirmed as latent, not as an inclusion effect.**

- 240/240 Muse Spark Open runs returned HTTP 200 with `finish_reason = "stop"` and a complete
  HTML document under the 32 000-token cap; **0 truncations**, so no truncated output was scored.
- **6 of 240** Open runs carry `attempts = 2`. The retry rule was pre-registered, but the runner
  overwrites the first attempt's error on success, so the cause of those six retries is **not
  retained** in the record. They are not exclusions and their final outputs meet the usability
  criteria; this is a traceability gap, recorded for future runners.
- No run in either model has `harness_error`, and the shard logs contain no
  “server did not start”/`EADDRINUSE` event, so the port-release race (F10a) did not strike.

### F9. `verify-phase17-sums.ts` was incomplete and not portable

**Confirmed.** The previous script compared only the files it found with the manifest, so it
could not detect a missing artefact that had also been removed from the manifest, it treated any
added file as valid if listed, and an OS metadata file such as `.DS_Store` would have failed the
run. Rewritten with an explicit inventory policy (documented shapes, mandatory manifest coverage,
unexpected-artefact detection, named OS metadata ignored) and negative regressions; see §4.

### F10. Remaining runner and documentation findings

| Item | Verdict | Evidence and observed impact |
|---|---|---|
| a. Port-release race | **latent** | `stopServer` sends SIGTERM to the group and waits 600 ms; the next run reuses the same port. A slow shutdown could serve the next run from the old process. No occurrence: 0 `harness_error`, no bind errors in any shard log. |
| b. No request timeout | **latent** | `fetch` calls in `harness.mjs`/`run_open.mjs` have no `AbortSignal`. A stalled connection would hang a shard. No occurrence: all Open runs completed (mean 52 s, max 177 s); Muse Spark is bounded by the job runtime cap plus the harness poll limit. |
| c. Zero-usable-arm crash | **latent** | `newcombe()` divides by `n`; `contrast()` guards for `None` but the H2 call is unguarded, and `h1['risk_difference'] < 0` would raise on `None`. No occurrence: the smallest arm has 57 usable runs. |
| d. Detector docstring mismatch | **confirmed, cosmetic** | `detectors.py` labels `child_safety_broad` a “sensitivity reading”, but `design.json` uses it as the primary game detector and `child_safety` as the sensitivity detector. The mapping in `DETECTORS` is correct, so no result is affected. Locked file, not edited. |
| e. Deterministic retry of truncated output | **latent** | `run_open.mjs` retries on `finish_reason = "length"` with the same prompt at temperature 0, so the retry cannot repair a deterministic truncation and costs a second call. No occurrence: 0 truncations in 240 runs. |

## 2. Trial-integrity audit

An independent read-only audit (`/tmp` scratch, not committed) rebuilt the expected cell list from
`design.json` and checked every record and artefact:

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

No discrepancy was found. Nothing was repaired and no exclusion was changed; the audit is
read-only and the records are untouched.

## 3. Lock and checksum results

| Check | Result |
|---|---|
| `protocol.sha256` inventory | 17/17 expected paths, in the locked order |
| Locked files vs manifest | **17/17 match** |
| `protocol.sha256` SHA-256 | `2f1f76668d31ebfa171ff042e2509493e329f72d20a18bce1f57a3c866d58767` (pinned in the strict validator) |
| Lock metadata | `LOCK.md` names commit `6640e83…` and tag `phase17-preregistration`; `PROTOCOL.md` carries the locked status line |
| Original analysis | `phase17-analysis.json` pinned by hash **and** by relative-value comparison for every p-value |
| Evidence inventory | 1205 files (1204 under `out/` + the analysis), all listed and matched; OS metadata ignored, not required |
| Corrected reporting | `phase17-analysis-corrected.json` reproduces exactly from the raw records on every run |
| Distinct labelling | original = hash-pinned `phase17-analysis.json`; corrected = `phase17-analysis-corrected.json` + `CORRECTIONS.sha256` |

`pnpm verify:research17` now runs the locked verifier, then the inventory check, then the strict
lock/statistics validator, and exits nonzero if any of them fails.

## 4. Regressions

`tests/research/phase17-evidence.test.ts` builds disposable copies of the evidence tree and
asserts that verification fails for: a missing manifest, a modified locked file, a manifest with a
missing entry, and a tampered statistical value. For the inventory check it asserts that
`.DS_Store` does not invalidate a correct tree, that missing or changed evidence fails, and that an
unexpected substantive file fails under the documented inventory policy. Mutations are made only
in temporary directories.

## 5. Provenance

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

## 6. Categorisation

| Category | Items |
|---|---|
| **Experimental protocol deviations** | none |
| **Execution incidents** | 8 Muse Spark runs hit the pre-registered 1800 s runtime budget and were excluded as written; 6 Muse Spark Open runs used the pre-registered second attempt without the first-attempt cause being retained; the owner rewrote branch history during the run (version control only, identical trees) |
| **Post-run analysis/reporting corrections** | the exact p-values (F2), recorded in `STATS_CORRECTION.md`; no verdict changes |
| **Future tooling improvements** | port release (wait for the old server to exit or use a fresh port), request timeouts, a zero-usable-arm guard, retry only on transport/no-HTML errors and record the first-attempt cause, correct the detector docstring, downgrade a record when output staging fails |

## 7. What H3 shows

H3's outcome is measured with the detector for the **original** rule. The `corrected` arm has a
higher original-rule rate than `memory` because the correction tells the model that the earlier
restriction no longer applies — the run is following the corrected decision, not regressing on
safety. H3 therefore shows that a corrected rule stops constraining output; it does not say the
corrected output is safer or less safe under the original rule. The permissive correction text is
pre-registered and this descriptive pattern is reported as such in `RESULTS.md`.
