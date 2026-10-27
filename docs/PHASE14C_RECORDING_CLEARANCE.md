# Phase 14C — Final Recording Clearance

**Status:** complete — documentation only; **GO for recording**, conditional on the mandatory replay
overlay. No merge, no submission, no production-code change.

**Mode:** documentation only. No paid Muse inference, no new model evaluation, no UI feature change.

**Work branch:** `agent/phase14c-recording-clearance` (created from the required baseline; not
merged).

## 1. Exact baseline

| Item | Required | Observed | Result |
| --- | --- | --- | --- |
| Repository | `sidonsoft/muse-recall` | `origin https://github.com/sidonsoft/muse-recall.git` | exact |
| Branch | `agent/phase14a-demo-production` | `agent/phase14a-demo-production` | exact |
| SHA | `4d668bb047eceada02bd124d7f69cde44b3adbed` | `4d668bb047eceada02bd124d7f69cde44b3adbed` | exact |
| Worktree | clean | `git status --porcelain` returned nothing | clean |

The branch `agent/phase14c-recording-clearance` was created only after those checks. No merge into
`main` was performed.

## 2. Files changed

| File | Change |
| --- | --- |
| `docs/submission/DEMO_SCRIPT_3MIN.md` | Rewritten to 358 spoken words / 172 s, with segment timing table, mandatory replay disclosure and exact overlay windows. |
| `docs/submission/DEMO_RUNBOOK.md` | Added §R mandatory replay disclosure, §R5 evidence classes A–E, corrected §6a/§6 workflow labels, and §9a recording checklist. |
| `docs/submission/SUBMISSION_COPY.md` | 100-word description reduced to 99 words; 300-word description reduced to 290; loose claims corrected. |
| `docs/PHASE14C_RECORDING_CLEARANCE.md` | This report. |

No production code, tests, fixtures, package manifests, evidence artifacts or screenshots were
modified. `git diff -- apps packages tests scripts demo experiments` is empty. No new paid Muse call
was made and no model evaluation was run.

## 3. P1-A — three-minute script

### 3.1 Narration counts

| Metric | Before | After | Target | Result |
| --- | --- | --- | --- | --- |
| Spoken words | 464 | **358** | 345–360 | pass |
| Total duration | 180 s (3:00) | **172 s (2:52)** | 170–175 s | pass |
| Slowest segment | 4.27 words/s (segment 7, 64 words / 15 s) | **2.44 words/s** (segment 5, 61 words / 25 s) | plausible speaking speed | pass |

Counting method: whitespace-delimited tokens inside the narration quotes only. Headings, operator
instructions, on-screen labels and the replay disclosure are excluded. The previous count of 464 was
reproduced with the same method before editing.

### 3.2 Final timeline (segment by segment)

| # | Segment | Time | Dur. | Words | Words/s |
| --- | --- | --- | --- | --- | --- |
| 1 | The problem | 0:00–0:17 | 17 s | 31 | 1.82 |
| 2 | Playable approved game | 0:17–0:35 | 18 s | 34 | 1.89 |
| 3 | Memory and correction history | 0:35–0:53 | 18 s | 33 | 1.83 |
| 4 | Authentic A/C influence | 0:53–1:16 | 23 s | 51 | 2.22 |
| 5 | Modification + replay label | 1:16–1:41 | 25 s | 61 | 2.44 |
| 6 | Staged diff | 1:41–1:53 | 12 s | 24 | 2.00 |
| 7 | Runtime gate, accurately | 1:53–2:08 | 15 s | 36 | 2.40 |
| 8 | Advisory Decision Guard | 2:08–2:23 | 15 s | 36 | 2.40 |
| 9 | Approve, then roll back | 2:23–2:40 | 17 s | 28 | 1.65 |
| 10 | Closing value statement | 2:40–2:52 | 12 s | 24 | 2.00 |
| **Total** | | **2:52** | **172 s** | **358** | **2.08 avg** |

Timeline arithmetic: 17 + 18 + 18 + 23 + 25 + 12 + 15 + 15 + 17 + 12 = **172 s**. The boundaries
are contiguous and end at **2:52**.

### 3.3 Requirement coverage

| Requirement | Where it is met |
| --- | --- |
| Playable game within 20 s | Segment 2 opens at **0:17** with `forge-demo` v1 already playable. |
| Problem established immediately | Segment 1, 0:00–0:17. |
| A/C memory influence is the centrepiece | Segment 4, 0:53–1:16, authentic Phase 12A provenance; the word “centrepiece” is spoken. |
| Modification workflow explained | Segment 5: capture preview → ask Muse → edits approved source → job records decisions and prompt hash. |
| Staged diff shown | Segment 6, 1:41–1:53. |
| Runtime gate described accurately | Segment 7: headless Chrome, load failure/canvas only, explicitly not gameplay/pixel/mechanic testing. |
| Decision Guard ≈15 s | Segment 8 is exactly 15 s and states advisory, labelled mutation, no blocking, no compliance verification. |
| Approve and roll back authentic source | Segment 9: authentic Phase 12A C source → v2 → undo to v1, the recorded parent. |
| Clear closing value statement | Segment 10: decisions survive, visibly shape output, changes stay reviewable/reversible. |
| Evidence limitations preserved | On-screen lower-thirds plus the script’s “Evidence limitations carried into the recording” section (n = 1, text colour not applied, replay split, load-time gate, advisory guard, no video yet). |

## 4. P1-B — replay evidence integrity

### 4.1 The correction

The replayed Phase 12A C output was originally generated with **one** active ocean memory. The seeded
replay project retrieves **two** active memories: the child-safety constraint and the ocean decision.
The replay job’s memory ids and prompt hash therefore do **not** correspond to the original
generation.

| Field | Original Phase 12A C generation | Seeded replay job |
| --- | --- | --- |
| Job id | `6a246238-4066-4b68-b091-1ab1e0a8a7d8` | `63835e4b-19cc-46dc-85df-21ac1c2e9113` |
| Active memories | **one** — ocean `aceff9cf-0f0a-4cdf-9465-39e98ba8d423` | **two** — ocean `981df37d-…` + child-safety `8f3f36b7-…` |
| Prompt SHA-256 | `cc3a3967cfacd9d83e7f007708d1609040c2762f0adc256d9db6bba930c4b8a2` | `11be307df87f6fcddf085200d32d731a9286ce53cd3a53386441bc352d5b4984` |
| Source bytes | `docs/hackathon-evidence/phase12/C-v2.html`, sha256 `26c6a53451c0d4a3521a4d878a6d577c34a013f56411c3ec8c83de0ad8bd823f` | same bytes, copied by `tests/fixtures/fake-muse.mjs` |
| What it supports | authentic memory influence (A/C experiment) | staging, review, approval and rollback workflow |

The replay hash also appears on the labelled-mutation job because both run in the same seeded project
with the same two active memories. That coincidence is expected and is a further reason it cannot
serve as original-generation proof.

### 4.2 Exact mandatory disclosure

The exact on-screen text is:

> **Replay of recorded Phase 12A Muse output.**

It is mandatory, visible and unconditional — not a verbal aside and not contingent on a viewer
asking. The Forge UI cannot display it, so it is an explicit video-editing overlay:

- **Style:** lower-third, white 24 pt-or-larger text on a 90%-opaque black bar, readable at 1080p.
- **Window 1:** **1:16.0 → 2:08.0** — replay modification (segment 5), replay-staged diff
  (segment 6), actual runtime check on the replay-staged bytes (segment 7).
- **Window 2:** **2:23.0 → 2:40.0** — approval and rollback of the replay-staged authentic source
  (segment 9).
- **Guard insert (2:08.0 → 2:23.0):** replace it with
  `Labelled mutation — packaged evidence, not model output.`
- **No gap:** the label is present on every replay frame. If the edit changes, the windows follow the
  first and last replay frame; the caption is never dropped.

### 4.3 Evidence provenance corrections

| Old presentation | Corrected presentation |
| --- | --- |
| “Say the review is a replay if anyone asks.” | Mandatory on-screen label for every replay frame, with exact edit timings. |
| “The job record shows retrieved memory ids and the prompt hash” without qualification. | The replay job’s ids/hash describe the replay only; they are not proof of the original generation. |
| Replay and A/C discussed in one breath. | Replay demonstrates **staging, review, approval and rollback**; the A/C experiment demonstrates **authentic memory influence**. Separate claims, never combined. |
| Child-safety visible in the seeded project near the C replay. | The original C generation retrieved **one** memory (ocean); the child-safety constraint did **not** shape it. |
| Original C provenance absent from the video instructions. | Segment 4 carries original C job `6a246238…`, memory `aceff9cf…`, prompt sha `cc3a396…`, n = 1 and the unapplied dark text colour. |

The final runbook now distinguishes five evidence classes that must not be conflated:

| Class | Meaning | Label |
| --- | --- | --- |
| **A. Authentic Phase 12A generation** | Real model output; C job `6a246238…`, one ocean memory, prompt sha `cc3a396…` | `Authentic Phase 12A model output — one run per condition` |
| **B. Deterministic replay** | Authentic C bytes transported by the fake-Muse fixture; job `63835e4b…`, two memories, prompt sha `11be307…` | `Replay of recorded Phase 12A Muse output.` |
| **C. Labelled Decision Guard mutation** | Deterministic test edit of authentic source, not spontaneous model output | `Labelled mutation — packaged evidence, not model output.` |
| **D. Actual runtime approval checks** | Real headless-Chrome load check on staged bytes, at approval time; load-time only | `Actual load-time gate on staged bytes` |
| **E. Authentic approved-source rollback** | Approval of authentic C source and undo to v1, its recorded parent; real state change | `Authentic source approval + rollback to recorded parent` |

## 5. P2 — submission word limits

| Section | Before | After | Limit | Target margin | Result |
| --- | --- | --- | --- | --- | --- |
| 100-word description | 117 | **99** | 100 | 95–99 | pass |
| 300-word description | 331 | **290** | 300 | 285–295 | pass |

Counts are whitespace-delimited over the section body only, excluding headings. The method
reproduced the old counts (117 and 331) before editing.

Claims corrected:

- “Every version can be rolled back” removed; the text now says approved changes roll back to their
  parent.
- “Constraints are force-included even when your words barely match them” replaced with pinned
  constraints included **within a hard context budget** — no unlimited inclusion.
- The Decision Guard is described only as **advisory** and “not an enforcement gate”; no enforcement
  claim.
- The runtime gate is described as **load-time only** and explicitly does not play the game, inspect
  pixels, or test every mechanic — no complete gameplay-verification claim.
- “Every change ends in … rollback” replaced with “Each change is human-approved, diffed, and can
  roll back to its recorded parent.”
- “Causally demonstrated” in the technical summary softened to “demonstrated in the controlled A/C
  trial.”
- A known-limitations bullet now records the replay/source split and the mandatory label.

## 6. Verification record

| Check | Result |
| --- | --- |
| Baseline SHA | `4d668bb047eceada02bd124d7f69cde44b3adbed` exact; branch exact; worktree clean before branching. |
| Spoken-word count | 10 narration segments, **358** words; per-segment `[31, 34, 33, 51, 61, 24, 36, 36, 28, 24]`. |
| Timing arithmetic | 10 table rows; durations sum to **172 s**; contiguous from 0:00 to **2:52**; table words sum to **358**; maximum **2.44 words/s**. |
| Submission counts | 100-word section **99**; 300-word section **290**. |
| Documentation links | All relative Markdown links in the three edited submission docs resolve; **0 missing**. |
| Evidence-path checks | All concrete backticked repo paths in the four edited docs resolve (21 checked, 0 missing). The two brace forms `{A,B,C}-v2.html` expand to three existing files each. |
| Evidence hashes | `C-v2.html` = `26c6a534…bd823f`; baseline = `79c9d67a…9ba9e41`; labelled mutation = `c5dfd00a…80650e` — all match the evidence records. |
| Git diff inspection | Only `docs/submission/DEMO_SCRIPT_3MIN.md`, `DEMO_RUNBOOK.md`, `SUBMISSION_COPY.md` and this report changed. `git diff -- apps packages tests scripts demo experiments` is empty. |
| Paid inference / evaluation | None run. |

## 7. Recording checklist

1. **Replay caption.** `Replay of recorded Phase 12A Muse output.` visible at **1:16.0–2:08.0** and
   **2:23.0–2:40.0**; no replay frame unlabelled.
2. **Original A/C provenance.** Segment 4 shows original C job `6a246238…`, one memory
   `aceff9cf-…`, prompt sha `cc3a396…`, n = 1 and the unapplied dark text colour.
3. **No misleading prompt-hash shot.** The replay hash `11be307…` never appears beside “proof”,
   “original”, or the A/C figure.
4. **Guard mutation disclosure.** Labelled-mutation banner and
   `Labelled mutation — packaged evidence, not model output.` visible; narration says “advisory” and
   “does not block approval”.
5. **Correct approval and rollback footage.** Approve the authentic recorded C source (not the
   violating mutation) to v2, then undo to v1, the recorded parent; replay overlay stays on.
6. **No visible API keys.** No `.env`, key values, terminal history, or provider headers in frame.
7. **Final video duration.** 170–175 s; target **172 s (2:52)**, **358** spoken words.

## 8. Remaining blockers

No documentation or technical blocker remains for **starting** the recording. The following are
operator/director gates, not code defects:

1. **The video does not exist yet.** The duration check (170–175 s) can only happen after capture.
2. **The overlay is a manual edit.** If the editor cannot add the two exact windows, the replay
   footage cannot be used. There is no new UI feature to fall back on, by instruction.
3. **The original A/C provenance card must be built into segment 4.** It must not show replay ids or
   the replay hash.
4. **Director review of the final cut is pending.** Submission remains held.
5. **Known limits remain unchanged:** A/C is n = 1 per condition; the guard is advisory; the runtime
   gate is load-time only; no authentication/multi-user deployment.

## 9. GO / NO-GO recommendation

**GO — record now.** The two P1 presentation issues and the P2 submission-copy issue are cleared in
documentation, with counts and evidence provenance verified.

This is a **conditional GO**:

- The recording is usable only if the replay label is present in both mandated windows and the
  original A/C provenance is shown for the influence claim.
- **Submission remains HOLD / NO-GO** until the recorded file passes the seven-item checklist and
  the director approves it.
- If the overlay is omitted, or the replay hash is presented as original-generation proof, the
  recording is **NO-GO**.

No merge was performed. No submission was made. Awaiting director approval.
