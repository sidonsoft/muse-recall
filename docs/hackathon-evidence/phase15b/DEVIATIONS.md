# Phase 15B — protocol deviations and evidence limitations

This document records where the executed experiment differs from
[`PHASE15B_PROTOCOL.md`](../../PHASE15B_PROTOCOL.md), where the historical record is incomplete, and
what each gap means for interpretation. The protocol is **not** rewritten. Every deviation is listed
with the planned procedure, the actual procedure, the available evidence, the potential effect on
interpretation, and whether the historical record remains verifiable.

**Bottom line:** the direction of the result is robust to the coding instrument (the no-memory arm is
15/16 under both codings). The precision of the memory-arm figure is not: it is 5/16 under the
original coder and 0/16 under a post-hoc, narrower coder. Nothing here turns the trial into a
confirmatory test of the corrected coder, and nothing here supports a general claim about memory
across tasks.

## Summary

| ID | Deviation | Affects the headline counts? | Record verifiable? |
|---|---|---|---|
| A | Order formula differs from protocol text | No | Yes |
| B | Same-key fallback configured despite "no failover" | No, but unusable rate uncertain | Configured state only |
| C | Model id configured, not observed per run | No, attribution uncertain | No |
| D | Memory arm held the full decision set, not one rule | Interpretively yes | Partly |
| E | Retrieved memory ids not recorded | Interpretively yes | No |
| F | All recorded diffs are empty (harness bug) | No | Yes (bug reproduces) |
| G | Original v1 coder source lost | Yes: v1 not re-executable | Output only |
| H | Protocol and RESULTS text inconsistencies | No, but definitions matter | Yes |
| I | `rubric.json` mixes 8 pilot rows with 32 trial rows | No, if the 32 are used | Yes |

---

## Deviation A — Randomisation formula

**1. Planned procedure.** Protocol §2: "randomised once, before the first run, with a recorded seed,
and the resulting order committed with this protocol. Seed: `0x15B2026` (mixed with the run index by
`sha256(seed || index)`, sorted ascending)."

**2. Actual procedure.** The runner generated sixteen `(index, condition)` pairs and hashed:

```js
sha256(`${TRIAL_SEED}:${i}:${memory}`)
```

where `TRIAL_SEED` is interpolated in **decimal** (`22749222`), `i` is **0-based**, `memory` is the
lower-case string `true` or `false`, and the fields are separated by `:`. The 32 digests were sorted
ascending with `localeCompare`.

**3. Available evidence.** The formula is in the recovered runner
[`recovered/tools/pilot-15b.mjs`](recovered/tools/pilot-15b.mjs). Recomputing it during integration
reproduced the order of `trial-results.json` **exactly, all 32 positions**. The protocol file does
**not** contain the resulting 32-row order table that §2 says was committed with it.

**4. Potential effect on interpretation.** The design remains a fixed, interleaved, pre-computed
order, so the purpose of randomisation is served. But a reader following the protocol text would
compute a different order and could not reproduce the run sequence from the protocol alone. The
condition is part of the hash input symmetrically, so this does not bias one arm relative to the
other.

**5. Verifiable?** Yes. The formula, the order and the source outputs are all preserved.

---

## Deviation B — Fallback configuration

**1. Planned procedure.** Protocol §3: "**No failover.** No infrastructure retries. A failed run is
recorded and, if it produced no valid HTML, counted as 'no usable output' — never dropped."

**2. Actual procedure.** The runner set:

```js
FORGE_FALLBACK_API_KEY: key,
FORGE_FALLBACK_MODEL: MODEL,
```

That is the same key and the same model as the primary path. In the Forge runner, these variables
enable an automatic retry when a quota error is classified as retryable. Whether the fallback ever
activated during the 32 runs cannot be established: no server or job logs were retained, and
`trial-results.json` records only the final job status.

**3. Available evidence.** The environment block of the recovered runner, and the absence of logs.
All 32 records ended `succeeded` with zero unusable runs.

**4. Potential effect on interpretation.** A same-key, same-model retry would not change the model
identity, but it could mask a transient quota failure that the protocol said would be recorded as an
infrastructure failure. The "0 unusable" figure may therefore describe post-retry outcomes rather
than first-attempt outcomes. It does not by itself inflate or deflate violation counts.

**5. Verifiable?** Only the configuration is verifiable. Activation is not.

---

## Deviation C — Model attribution

**1. Planned procedure.** Protocol §3: the model is
`muse-spark-1.3-contributor` at `effort: high`; the CLI's `run.model.configured.model_id` "must read
`muse-spark-1.3-contributor` on every run", and a run whose reported model differs is an
infrastructure failure.

**2. Actual procedure.** The model was supplied through `MUSE_MODEL` and `FORGE_MUSE_MODEL`. The
runner did not capture the CLI's `run.model.configured` event. `trial-results.json` records a single
top-level `model` field, not a per-run observed identifier. No per-run model field exists.

**3. Available evidence.** The runner environment; the top-level `model` field; the baseline
candidate manifests (which do carry `reported_model` for the baseline generations, not for the 32
trial runs).

**4. Potential effect on interpretation.** The model attribution is a **configuration claim, not a
per-run observation**. Any statement that each of the 32 runs was independently confirmed to use
`muse-spark-1.3-contributor` overstates the record. The configured fallback was the same model, so a
fallback would not have substituted a different one.

**5. Verifiable?** No, not per run. The configured value is verifiable.

---

## Deviation D — Memory-arm composition

**1. Planned procedure.** Protocol §1 frames the hypothesis as one remembered child-safety memory:
"one: remembered child-safety memory suppresses an *incidental* violation". It lists Rule A
(child-safety) and Rule B (art direction), although Rule B's confirmatory arm is withdrawn in §3.
The protocol also contains the stale phrase "across two rules" (§1) and "One game, two rules, one
model" (§8).

**2. Actual procedure.** The memory arm was seeded by `seedForgeDemo()`, which inserts the **full
demo decision set**:

- the active child-safety rule (`This children's game must avoid flashing effects, countdown
  timers, and penalties for mistakes.`);
- the active ocean palette decision;
- the superseded sunset palette decision.

The no-memory arm deleted **every** memory row for the project. The contrast is therefore **project
memory present versus project memory absent**, not "one child-safety rule present versus absent".

**3. Available evidence.** [`scripts/lib/demo-seed.ts`](../../../scripts/lib/demo-seed.ts) and the
runner's `DELETE FROM memories` branch. No retrieved-memory identifiers were recorded per run.

**4. Potential effect on interpretation.** The design cannot isolate the causal contribution of the
child-safety rule from the presence of other project decisions. Palette decisions may have primed a
more conservative style, and the superseded sunset decision may have influenced retrieval. The
supported claim is about project memory as a bundle, in this project, not about one memory item.
Directionally, both arms differ only in memory presence, so the comparison remains meaningful.

**5. Verifiable?** The seeding code and the no-memory deletion are verifiable. Which memories were
actually retrieved into each prompt is not.

---

## Deviation E — Retrieved memory identifiers

**1. Planned procedure.** The product records retrieved decisions per job; the protocol's secondary
outcomes do not explicitly require them, but the trial design depends on memory being retrieved.

**2. Actual procedure.** `trial-results.json` records no memory ids, retrieval scores or evidence
sentences for any run. The runner read the job record but did not persist a retrieval list.

**3. Available evidence.** Absence of those fields in the preserved run records.

**4. Potential effect on interpretation.** It cannot be shown per run exactly which memories entered
the prompt, or that retrieval was identical across the 16 memory-arm runs. A failure to retrieve the
child-safety rule would bias the result **against** the hypothesis, not in its favour, but the claim
"the rule was retrieved in every memory-arm run" is unverified.

**5. Verifiable?** No.

---

## Deviation F — Empty diff files

**1. Planned procedure.** Protocol §7: "All 32 sources, **diffs**, rubric outputs, run records and
the coding script are published in the repository."

**2. Actual procedure.** The runner read the diff response as:

```js
diff.data.diff
```

but the API returns the patch at `diff.data.files[0].diff`. The assignment fell back to an empty
string, so every recorded diff file is 0 bytes. This affects all 40 recorded diff files (32 trial +
8 pilot). The runner also recorded `lines: null` as the secondary line-change metric.

**3. Available evidence.** The recovered runner, the 40 zero-byte files in
[`recovered/recorded-diffs/`](recovered/recorded-diffs/) and the API schema. The bug is
deterministic and reproduces.

**4. Potential effect on interpretation.** No original diffs exist. The outputs and the baseline are
preserved, so a reviewer can reconstruct a diff mechanically, but any such reconstruction is **not**
the recorded trial diff and must be labelled as reconstructed. No violation count depends on the
diff files; the primary coding reads the output HTML.

**5. Verifiable?** Yes: the bug, the empty files and the outputs are all preserved. The original
diffs are not.

---

## Deviation G — Original coder source

**1. Planned procedure.** Protocol §4: the rubric is fixed in the protocol and coding is "a script,
not a judgement call"; "Coded twice: once by script, once by a human against the same rubric".

**2. Actual procedure.** The v1 coder was **never committed**. Its only copy,
`video/tools/rubric.py`, was overwritten by the corrected v2 coder at 21:55:01, immediately before
the correction commit `9f5eaa1`. The two working copies are now byte-identical to the committed v2
file. The v1 **output** survives: `rubric-v1-flawed.json` is byte-identical to the `rubric.json`
committed in the results commit `2857159` (git blob `6af013e7ed965362e5f9af0b7b75b56ff20211d7`).
The v2 coder was written **after unblinding**.

**3. Available evidence.** Git history: `rubric.py` first appears in `9f5eaa1`; the results commit
`2857159` contains the v1 output JSON; the correction commit renames/copies it to
`rubric-v1-flawed.json` and adds v2. File mtimes show the v2 overwrite. The v1 behavioural defects
are visible in its output evidence strings (`penalt` substring matches) and are described in
`RESULTS.md` §3.

**4. Potential effect on interpretation.** The v1 result **cannot be re-executed from original
source**. It can be checked only against its stored per-run output. The protocol pre-registered a
rubric **text**, not code, so calling v1 "the preregistered coder" is inaccurate. The correction was
post-hoc and moved the memory-arm count from 5 to 0, i.e. in the hypothesis's favour; that is exactly
why both codings are published and why the conservative 5/16 figure should be quoted.

**5. Verifiable?** The output is verifiable. The implementation is not, and no reconstruction may be
presented as the original.

---

## Deviation H — Protocol and RESULTS text inconsistencies

**1. Planned procedure.** A single pre-registered document should describe the executed design
exactly, with one confirmatory rule, the committed run order, the fixed operational definitions and
an accurate account of what had already run.

**2. Actual procedure.** The protocol and results contain several statements that describe an
earlier design or overstate what was captured. None was edited after the trial; they are disclosed
here instead.

| Location | Statement | Relationship to the final experiment |
|---|---|---|
| Protocol header | "draft … NOT YET RUN"; "Nothing in this document has been executed." | True of the **32-run confirmatory trial**, which began at 20:10:30 after the 20:07:59 commit. **False as an absolute**: eight pilot/exploratory runs executed between 19:46 and 20:06, including the two boundary-probe runs at 20:04 and 20:06 that §3 describes. |
| Protocol §1 | "across two rules" | Stale. The art-direction arm was withdrawn before the lock (§3, Request B); the trial tests **one** rule. |
| Protocol §2 | "the resulting order committed with this protocol" | The protocol file contains no 32-row order table. The order is reproducible from the runner (Deviation A), not from the protocol. |
| Protocol §3 | Rule text B still listed | The art-direction arm was withdrawn; Rule B was not a confirmatory condition. |
| Protocol §4 | Countdown is "a countdown/timer that ends the game" | The v2 coder flags a decremented clock variable tested against zero. That is **broader** than "ends the game" (a resetting clock can match) and **narrower** than v1's named game-over requirement. The operational definition is the code's, not the sentence's. |
| Protocol §4 | Penalty includes `penalt` vocabulary | The v2 coder defines a penalty as a deduction from `score`/`points`. That is **narrower** than the protocol's vocabulary test and is the main reason the memory arm moves from 5 to 0. |
| Protocol §4 | "Coded twice … once by a human" | A human pass occurred and is described narratively in `RESULTS.md` §3, but no per-run human coding table was preserved and the pass was not blinded. See [`HUMAN_CODING.md`](HUMAN_CODING.md). |
| Protocol §5 | "If the counts are 8/8 vs 0/8 the p-value is ~8e-5" | Illustrative arithmetic from the earlier 8-per-arm pilot design. The trial used 16 per arm; its observed counts are 15/16 vs 0/16 or 15/16 vs 5/16. |
| Protocol §7 | "diffs … published" | Not satisfied: all recorded diffs are empty (Deviation F). |
| Protocol §8 | "One game, two rules, one model" | One confirmatory rule, not two. |
| RESULTS header | "no failover, no retries" | The runner configured a same-key, same-model fallback (Deviation B). |
| RESULTS header | "Every run used the funded model … at effort: high" | Configuration claim, not per-run observation (Deviation C). |
| RESULTS §1 | "**no run of 16** broke it" | True under the v2 operational definitions. Under a broader reading of "penalty" (streak/combo resets), several memory-arm outputs do penalise mistakes; see `EVIDENCE_CARD.md` Limitations. |
| RESULTS §3 table | "v1 — pre-registered, flawed coder" | Imprecise: the **rubric text** was pre-registered, the v1 **code** was not and is lost (Deviation G). |
| RESULTS §3 | "The difference is significant under the pre-registered test" | The Fisher test and α were pre-registered; the instrument that produced the 0/16 figure was not. The confirmatory claim is the v1 comparison; the v2 figure is post-hoc. |

**3. Available evidence.** The committed protocol and RESULTS, the runner, the file mtimes and the
git history.

**4. Potential effect on interpretation.** A reader who takes the protocol at face value would
overestimate the pre-registration (code as well as text), the isolation of one rule and the
completeness of the published artefacts. The disclosed, supported claims are narrower: a
memory-present versus memory-absent contrast, one rule, one model, one game, one request; v1 output
preserved; v2 post-hoc and narrow.

**5. Verifiable?** Yes: every inconsistency above is checkable against preserved files.

---

## Deviation I — Mixed pilot and trial records

**1. Planned procedure.** Protocol §2 and §5: 32 trial runs, 16 per condition; pilot evidence is
reported separately and never pooled with the trial.

**2. Actual procedure.** `rubric.json` and `rubric-v1-flawed.json` each contain **40** rows: the 32
trial outputs (`mem-01…16`, `nomem-01…16`) plus eight pilot outputs (`safety-*`, `style-*`,
`speed-*`, `clock-*`). `trial-results.json` contains exactly the 32 trial records, and
`analyze-15b.py` joins the rubric to those records by id, so the published 32-run analysis is
correct. But a naive reader who counts rows in `rubric.json` will get a different denominator.

**3. Available evidence.** The 40 keys in each rubric file; the 32 records in `trial-results.json`;
the analysis join. The eight extra rows are exactly the pilot run names in
[`recovered/pilot-runs/`](recovered/pilot-runs/).

**4. Potential effect on interpretation.** If pilot rows are mistakenly included, the memory-arm
denominator becomes 24 rather than 16 (or an arbitrary mixture), and the reported rate is wrong.
Correctly filtered, the published counts are unaffected. The pilot observations are also **not**
confirmatory and not pooled, as the protocol requires.

**5. Verifiable?** Yes: the 32-run population is defined by `trial-results.json`, and the row sets
can be reconciled exactly.

---

## Human coding

No per-run human coding table was preserved. `RESULTS.md` §3 reports that a human pass found two
coder defects, but it does not publish per-run human judgements, and no independent record of that
pass survives. The narrative is therefore **not** equivalent to blinded human coding and must not be
quoted as such. See [`HUMAN_CODING.md`](HUMAN_CODING.md).

## Reconstructed diffs

No reconstructed diffs are published. The baseline and all 32 outputs are preserved, so a reviewer
may generate diffs mechanically, but any such diff is a new artefact and must be labelled
"reconstructed after the experiment from preserved artifacts; not an original recorded diff".
The original recorded diff files are preserved, empty, in
[`recovered/recorded-diffs/`](recovered/recorded-diffs/).
