# Pilot errata — bookkeeping corrections found by the freeze-prep accounting audit

**Status:** errata note for the archived Dell exploratory pilot. The pilot **data**, its records, the
checkpoint-2 report and `PILOT-CHANGES.md` are preserved unchanged; this note records the corrections a
future reader must apply. Not a preregistration, no confirmatory data, no pilot re-run.

**Sources:** `review/01-PILOT-ACCOUNTING-AUDIT.md` (547 lines, evidence-tagged), record-level
`review/pilot-inclusion-table.json` (141 rows), deterministic `scripts/study02/audit_pilot_accounting.py`
(exit 0 = all hard invariants hold; re-runs byte-identical).

## D1 — arm allocation transcription error in two narrative sentences (not in the data)

- Checkpoint-2 report §7.2 and `PILOT-CHANGES.md` say unusable by arm **`manual` 3 / `corrected` 1**
  (and usable `manual` 30 / `corrected` 32).
- The records say **`manual` 4 / `corrected` 0** (usable **`manual` 29 / `corrected` 33**). Totals are
  still 9, and the report's own detector table (usable 28/27/26/30) already matches the records.
- No count, arm denominator, direction or pilot conclusion changes. The historical documents are kept
  as published; this errata is the authoritative figure. The freeze-readiness report uses the corrected
  values.

## D2 — prompt provenance drift for 41 of 132 records (semantic content unchanged)

- For **41/132 records** (all memory-bearing arms: `memory`, `manual`, `corrected`; all executed before
  `manifest.created_at = 2026-10-31T09:31:16Z`) the record's `prompt_sha256` does not match the committed
  prompt file or manifest entry. `none`-arm prompts are unaffected.
- Cause: prompt files were regenerated mid-pilot after resume/restart, and the production `MemoryEngine`
  assigns **fresh random memory UUIDs** on each build. The prompt bytes therefore differ in memory IDs only
  — **same byte length, same memory content, same rules/requests/baselines**.
- Consequence: the executed prompts are semantically identical; scoring and arm comparisons are unaffected.
  But the committed prompt artefacts are **not byte-exact** for those 41 runs, so prompt hashes cannot be
  used as integrity evidence for them.
- **Freeze action (mandatory for the confirmatory run):** the harness must persist the **exact prompt bytes
  actually sent**, record their hash *at execution time* (not only in a pre-built manifest), and pin memory
  IDs deterministically (or include the random IDs in the recorded prompt hash). No prompt regeneration
  after a record is written. This is added to the freeze manifest requirements.

## D3 — repeat wording: "0/8 same-seed byte-identical" is really "0/6 defined comparisons"

- 2 of the 8 same-seed repeats have an **unusable base primary**, so their comparison is undefined.
  The correct statement is: **0 of 6 defined same-seed pairs were byte-identical**; 0 of 4 new-seed pairs
  were identical; one same-seed repeat changed the detector verdict. No determinism claim is made.

## Verification of preservation

- Pilot + checkpoint-2 manifest subset: **562/562 OK**; the full checkpoint-2 manifest **706/706** verifies
  against commit `85773b3` blobs plus the 29 git-ignored raw artefacts; SSE hash list **116/116 OK**;
  `git diff 85773b3 -- pilot` is empty. The worktree differences that make some checkpoint-2 manifest lines
  fail are the declared freeze-prep edits outside `pilot/` (protocol/corpus/design/analysis scripts), not
  pilot data.
