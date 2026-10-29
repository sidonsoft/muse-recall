# Live run, repeated after the fixes

**Run:** 2026-10-29, 03:06–03:20 UTC. **Status:** one exploratory repeat of the
[original run](../FINDINGS.md), on code that combines the five fix branches. Not a trial; one run
per condition, so differences are observations, not rates.

## What changed between the runs

| | Original run | This run |
| --- | --- | --- |
| Code | worktree at `5f8c058` (≡ `origin/main` `12918fd` for application code) | `integrate/live-run-fixes` at `c4ab6d7` = `origin/main` + `fix/forge-retrieval-token-cap` (`c8b5b08`), `fix/forge-storage-contract` (`095582f`), `fix/preview-storage-shim` (`d748d56`), `fix/guard-palette-countdown` (`2cc3687`, `6db8b6d`) |
| Build checks | 644 tests | lint, typecheck clean; 676 tests pass, 3 skipped |
| Server settings | isolated DB/workspace, Muse Code CLI default model, `FORGE_REASONING_EFFORT=low` | identical |
| Decisions, prompts, requests | — | identical text, word for word (`task-after-phase*.md`) |
| Operator | dsh headless, `deepseek-flash`, effort high | same, in a **fresh** session with no memory of the first run; one added rule: confirm server status before and after every approve/reject |

## Side by side

| Step | Original run | After the fixes | Finding |
| --- | --- | --- | --- |
| v1 generate, identical prompt | 4 of 6 decisions supplied; green palette, no storage; rejected. Needed **3 generations** and an operator prompt restating every decision | **6 of 6** supplied; warm palette, guarded `localStorage`, no network; **approved first time** | F1, F2 fixed |
| 15-minute focus sprint | Silent `setTimeout(…, 15*60*1000)`; Guard **PASS**; operator rejected | Same code shape; Guard **UNVERIFIED**: "a 15-minute timer bounds an activity (setTimeout delay SPRINT_LEN = 15 * 60 * 1000); time pressure cannot be ruled out", assessment `not_verified`, 0 findings; operator rejected | F5 fixed |
| Book notes after the palette correction | Warm stylesheet kept; Guard **UNVERIFIED** "only as prose/comment"; operator rejected | Warm stylesheet kept again; Guard **BLOCK · violation_detected**: "superseded warm palette reintroduced as active styling: #E07B39, #EF8F3C, #F7B267, …"; operator rejected | F4 fixed; F6 unchanged (expected) |
| "Apply the current palette decision" | Recoloured to teal/navy; approved | Recoloured to teal/navy (`#0e7c86 #16395f #2a7f9e`); palette check passes; approved | — |
| Book notes on the cool version | Approved | Approved | — |
| Export / import | Approved | Approved | — |
| Preview persistence | `localStorage` threw `SecurityError`; nothing saved | App's own save code works inside the sandboxed preview (browser check); resets on reload, as documented | F3 fixed |
| Operator log vs server | One reject logged but never sent | 6 of 6 approve/reject actions in `calls.log` and the server log; self-audit table matches | protocol rule |

**Browser check of this run's v4** (`reading-nook-v4-after.html`, SHA-256 `9c2f4d63…`): inside
the combined build's preview, adding a book and goal writes to storage; as a standalone file the book
survives a reload, "Save My Log to a File" produces `reading-log.json`, and loading it after clearing
storage restores the book and goal.

**Cost:** 6 jobs, 49 model calls, 1,742,677 input tokens, 21,374 output tokens, 242 s of model time
(original: 8 jobs, 52 calls, 1,790,530 / 30,122, 337 s). Two fewer jobs because v1 passed first time.

## What did not change

- **F6 — a correction still does not apply itself.** After the palette correction, the colour-free
  Book notes request kept the warm stylesheet even though the cool decision was supplied. The Guard now
  blocks it; the model behaviour is the same as before. Only the explicit request recoloured the app.
- **The hidden timer is still written.** Asked for a "15-minute focus sprint", Muse Spark again wrote a
  silent 15-minute timer, and its own summary claimed there was no time pressure. The Guard now says so;
  a person still has to decide.
- **The model still left one green.** v1 used a single green status colour (`--good: #2e7d4f`) on an
  otherwise warm palette. The operator approved without mentioning it. Its hue (~145°) is outside both
  palette families, so the Guard ignores it by design.

## New findings from this run

| | Finding | Evidence |
| --- | --- | --- |
| N1 | **The retrieval preview no longer matches Forge.** `POST /api/retrieval/preview` still uses the default pinned types, so it showed 4 of 6 decisions for a query whose Forge job received all six. The "explain retrieval" view now understates what Forge sends. | `OPERATOR_RUN_LOG.md` step 1 and "What failed"; job `b0b5bc8c` `memory_ids` |
| N2 | **Approve and reject rewrite `finished_at`.** v1's job finished at 03:07:38 and reads 03:08:37 (the approval time) afterwards; the job `status` stays `succeeded` on approval. | `calls.log` lines 12 and 17; `ground-truth/job-b0b5bc8c.json` |
| N3 | **The correction response shows the old record as still active.** `engine.correct()` returns the targets as loaded before its `UPDATE`, so the response's `superseded` list says `status: active`, `superseded_by: null`; a fresh GET shows the true state. | `packages/memory-engine/src/engine.ts`, `correct()` return; step 6 |
| N4 | Operator slip: one decision save returned 400 (most likely shell quoting) and was retried; all six were saved. | `calls.log` line 6 |

## Files

| File | What it is |
| --- | --- |
| [`reading-nook-v4-after.html`](reading-nook-v4-after.html) | The approved app (v4) from this run |
| [`OPERATOR_RUN_LOG.md`](OPERATOR_RUN_LOG.md) | dsh's log, verbatim, with its self-audit and findings |
| [`calls.log`](calls.log) | Every API call the operator made |
| [`staged/`](staged/) | Staged HTML of all six jobs as saved by the operator (`staged-v2.html` is the rejected sprint; the file names are the operator's) |
| [`ground-truth/`](ground-truth/) | Server snapshots: project and versions, every job, memories with history |
| `task-after-phase1.md`…`task-after-phase4.md` | What the operator was told |
