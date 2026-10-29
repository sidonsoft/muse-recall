# Live run — Reading Nook, operated by a DeepSeek Harness subagent

**Run:** 2026-10-29, 02:05–02:22 UTC. **Status:** one exploratory live run, not a trial. Nothing
here is pre-registered, and no number below should be pooled with Phase 15–17.

> **Update (2026-10-29, 03:20 UTC).** F1–F5 have fixes on separate branches, **not yet merged into
> `main`**. The same run was repeated on code combining them: see
> [`after/AFTER_FIXES.md`](after/AFTER_FIXES.md). This file records the original run as it happened.

A DeepSeek Harness (`dsh`) headless worker acted as the human operator of Muse Recall. It created
a project, saved six decisions, asked live Muse Spark for a single-file app, reviewed every staged
change against the source and approved or rejected it, corrected one decision, and kept a log.
Every claim in this file was checked against the server's own records, the staged bytes, or a
real browser. Where the operator's log and the server disagreed, the server is quoted.

## Setup

| Item | Value |
| --- | --- |
| Muse Recall | worktree at `d2d0d10` + `5f8c058` (docs only since `12918fd`); API on `127.0.0.1:8797`, isolated database and workspace |
| Generator | Muse Code CLI 1.4.14, CLI default model (Forge passed no `--model`; the job record does not store which model ran), `FORGE_REASONING_EFFORT=low` |
| Health probe | live round-trip on `muse-wonder-1.0`, 4.7 s |
| Operator | `dsh --profile headless`, `deepseek-flash` with reasoning effort `high` (overlay), one session `session-9495c27d-…` resumed across four phases |
| Operator tools | [`mr.sh`](mr.sh) (logs every call to [`calls.log`](calls.log)); brief: [`OPERATOR_BRIEF.md`](OPERATOR_BRIEF.md); tasks: `task-phase1.md`…`task-phase4.md` |
| Data handling | the brief, API responses and app source went to DeepSeek's API; the generator prompts went to Meta's Muse service |

## The app that came out

[`reading-nook-v4.html`](reading-nook-v4.html) — one self-contained file, 20,232 bytes, SHA-256
`cb76bb64a5277686c73f35572a681586dcd399be5cc2f633d8e40b1ed8de94fb`. A reading log for children
aged 7–10: add books, log pages per day, Monday–Sunday bar chart, weekly goal, My Shelf with a
one-sentence note per finished book, and JSON export/import. Teal and navy palette, data in
`localStorage`, no network.

| Version | Job | Base | Change |
| --- | --- | --- | --- |
| 1 | `454add49` | — | Generate (third attempt; prompt written by the operator) |
| 2 | `4f1b44c8` | 1 | "Apply the current palette decision from memory to the whole app." |
| 3 | `4506a841` | 2 | Book notes |
| 4 | `a7e23ab8` | 3 | Export and import |

Rejected: `7713abca`, `b245b932` (generate), `7e4955e7` (focus sprint), `6abd42ee` (Book notes on v1).

**Browser check (v4, plain `http://127.0.0.1` origin):** added a 40-page book, set a 60-page goal,
logged 50 pages → 40 counted and recorded on Thursday 2026-10-29, book moved to My Shelf; saved a
note; reloaded — book, goal, log and note all restored from `localStorage`. Export produced
`reading-nook-log.json` (409 bytes, all four fields); after clearing storage, importing that file
through the real file input restored everything with "Welcome back! Your reading log is loaded."
The download was captured in-page, not saved to disk.

**Cost of the whole run:** 8 jobs, 52 model calls, 1,790,530 input tokens, 30,122 output tokens,
337 s of model time.

## Decisions under test

| Id | Type | Decision | Guard support |
| --- | --- | --- | --- |
| `0398cbf1` | constraint | No countdown timers or time pressure | `countdown-mechanics` |
| `ac94ae63` | constraint | No flashing or blinking | `flashing-effects` |
| `14d8a1be` | constraint | No colour-only cues | `colour-only-cue` (red/green only) |
| `ea63df00` → `dc9b6be4` | preference | Warm orange/gold/peach on cream → corrected to cool teal/navy on soft white | `superseded-palette` |
| `266a5fbd` | technical_decision | Offline only: `localStorage`, no network, no external assets | none |
| `0432b4b9` | constraint | Ages 7–10: ≥44 px targets, plain words, no rankings | none |

## Product findings

### F1 — Forge retrieval reads only the first 12 words of the request (high)

Forge builds its retrieval query as `"<project id>\n<prompt>"`, and the tokenizer keeps the first
12 non-stopword tokens without removing repeats (`packages/memory-engine/src/fts.ts:12`, `:148`).
For the v1 prompt that was exactly:

`reading nook build reading nook reading log children aged 7 10 child`

Everything after "child" was never searched. Constraints and goals are pinned and arrive anyway;
a `preference` or `technical_decision` only arrives if one of those 12 tokens matches it. So:

- Jobs `7713abca` and `b245b932` were supplied **4 of 6** decisions. The palette and offline
  decisions were never candidates (`candidate_count: 4`), even though the second prompt said
  "colour palette" and "localStorage" — at the end. The memory budget (6 / 3,000 chars) was not the
  cause: 1,228 characters were used.
- Both outputs violated exactly the two missing decisions (green palette, no storage; the storage
  miss has a second cause, F2).
- The same decisions are found with short queries: `"palette"` returns the palette preference;
  `"make it offline with localStorage"` returns the offline decision.
- The offline decision reached the model once in eight jobs (`a7e23ab8`, export/import).

**Fix direction:** drop the project id from the text query, deduplicate tokens, and either raise
the cap or always supply every active project decision when the project has only a handful.

### F2 — The Forge system prompt overrides a saved decision, silently (high)

`apps/server/src/forge/prompt.ts:43` tells the model *"Do not use browser storage (localStorage,
sessionStorage, IndexedDB)"*, and `:40` allows network assets from `cdn.jsdelivr.net`. Decision
`266a5fbd` asks for the opposite on both counts. Muse Spark followed the platform; its own log on
`b245b932` reads: "the request asked for localStorage, but this task forbids browser storage, so
data lives in memory only and resets on reload."

Muse Recall accepted the decision without a warning, and the Guard marks it
`unsupported_decision`. Storage only appeared after the operator wrote "This project decision
overrides any generic instruction against browser storage" into the prompt.

**Fix direction:** detect decisions that conflict with the platform contract when they are saved,
or let a project opt into storage explicitly.

### F3 — The in-app preview cannot show persistence (medium)

Inside `/api/forge/projects/reading-nook/preview`, `localStorage.setItem` throws `SecurityError`
(the CSP sandbox gives the document an opaque origin). The app wraps storage in `try/catch`, so it
runs but saves nothing. An owner reviewing in Muse Recall cannot see that persistence works; it does
work in the exported file (browser check above).

### F4 — The palette rule cannot block a palette written in words (medium)

`superseded-palette` blocks only when hex codes from the **superseded decision's text** appear in
the source (`packages/decision-guard/src/index.ts:665–695`). The original decision said "orange,
gold and peach", so it had no hexes. On `6abd42ee` the corrected cool decision was supplied, the
source was entirely warm (`#e8862e`, `#e8a838`, `#f6c9a0`), and the Guard reported
`rule_unverified` — "superseded palette term appears, but only as prose/comment without styling
evidence". That reason is wrong: the warm values are the stylesheet. A source hex is never mapped
to a colour family.

### F5 — A silent 15-minute timer passes the countdown rule (medium)

Asked for "a 15-minute focus sprint", Muse Spark wrote `SPRINT_LEN = 15*60*1000` and a
`window.setTimeout(…)`, with no visible numbers and the copy "There is no rush and no timer to
beat". The Guard evaluated `0398cbf1` on `7e4955e7` and recorded neither a finding nor an
unverified entry — in effect a pass. The rule's patterns (`countdown`, `timeLeft`, `time--`, …) do
not match a single long timeout. The operator rejected it as a timed, time-pressured activity.
Whether a hidden timer breaks "no time pressure" is a judgement call; the Guard should abstain here
rather than stay silent.

### F6 — A correction does not apply itself to unrelated changes (expected; replicated)

After the palette correction, the Book notes request on v1 (`6abd42ee`) **was** supplied the new
cool decision. Muse Spark still kept the retired warm palette, explaining "existing controls, layout
and behaviour untouched". Only the explicit request "Apply the current palette decision from memory
to the whole app" (`4f1b44c8`) recoloured it — a value-only diff, no markup or script changes. Once
the cool palette was in the approved source, later changes kept it. This matches the V21 demo's
failure beat, on a different app.

### F7 — Smaller observations

- Two staged changes on the same base can be open at once (`6abd42ee` and `4f1b44c8`, both on v1).
  Approval is protected: approving a change staged on an older version returns `version_conflict`
  ("Regenerate it") (`apps/server/src/forge/runner.ts:926`). A duplicate approve returned 409.
- Modifications cost far more than generation: 201k–395k input tokens and 6–11 calls per modify,
  against about 94k and 3 calls per generate.
- Staging copies are deleted on approve and reject, so staged HTML cannot be fetched afterwards;
  the operator's saved copies are the only record (their hashes match the approved versions).
- v1's stored version summary is the first 500 characters of the generation prompt, not a summary.
- The job record does not store which Muse model ran (see Setup).
- App-level: the book picker is a free-text box with suggestions, so a child must type or choose the
  exact title; import replaces the log without asking.

## Operator (dsh) findings

| | What happened | Evidence |
| --- | --- | --- |
| Review quality | Every violation listed above was caught by the operator's source review, not by the Guard. It also found three functional bugs in the first v1 (weekly total counted pages beyond the book's end; week not keyed by date; banner never hides), all of which I reproduced. | `OPERATOR_RUN_LOG.md` steps 3–11; `staged-1.html:244–245` |
| **Logged an action it never took** | Step 7 says "succeeded then **rejected**" and lists a reject call. No reject reached the server (`calls.log`, server log); the job stayed open for three minutes. Told only that "at least one action does not match", it audited all six jobs, found this one, rejected it and added a correction note. | `calls.log` lines 43–46; Step 9 |
| Sloppiness | Duplicate approve on `454add49` (409); submitted step 8 before acting on step 7. | `calls.log` |
| Wrong diagnosis | Concluded that preferences and technical decisions "were simply not selected until the wording matched strongly". The real cause is F1's 12-token cap. | Step 12 |
| The workaround | It got a compliant v1 by restating every decision, with hex values, in the prompt — the exact behaviour Muse Recall exists to remove. | job `454add49` prompt |

**Lesson for agent operators:** reconcile an agent's narrative against server state before relying
on it. The judgement was good; the bookkeeping was not.

## What this run does not show

- One app, one run, one generator configuration, low reasoning effort. No rates.
- The operator is an LLM following a written standard, not a human; its approvals reflect that
  standard.
- The browser check covers the final version only, in one browser, on one day.

## Files

| File | What it is |
| --- | --- |
| [`reading-nook-v4.html`](reading-nook-v4.html) | The approved app (v4) |
| [`OPERATOR_RUN_LOG.md`](OPERATOR_RUN_LOG.md) | dsh's log, verbatim, including its correction note |
| [`calls.log`](calls.log) | Every API call the operator made, with HTTP status |
| [`staged/`](staged/) | The staged HTML of all eight jobs, as saved by the operator at review time |
| [`ground-truth/`](ground-truth/) | Server snapshots: project and version history, every job (guard, usage, supplied memory ids), memories with history |
| `OPERATOR_BRIEF.md`, `task-phase*.md`, `mr.sh`, `collect.py` | What the operator was told and the tools it used |
| [`SHA256SUMS`](SHA256SUMS) | Hashes of everything above |
