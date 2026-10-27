# Muse Recall — three-minute demonstration script

**Total target: ~3:00.** Recorded authentic evidence is preferred for every time-sensitive step:
a real Muse modification takes roughly 35–105 s per run (measured: mean 55.7 s, median 48.1 s,
range 34.1–104.2 s across five real trials), so the generation step should be captured in advance
at full speed and shown at real or lightly accelerated pace — never fabricated.

**Recording base:** branch `agent/phase12c-guard-advisory`, seeded project `forge-demo`
(`pnpm demo:seed`). All runs below are real production paths; see [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md)
for setup and per-run commands.

**Cast of screens:** Forge tab (game preview → modify → review → approve → versions), Memory
inspector (decisions + history).

---

## 0:00–0:20 — The problem

- **Narration:** "AI creative tools are fast — until you close the session. Next time, the model
  has forgotten the palette you chose, the rule you set, the change you already reviewed. You
  re-explain everything, hunt for unexpected edits, and fix regressions the assistant introduced."
- **On-screen:** Title card with the message: *"An AI creative studio that remembers your
  decisions, checks its work, and keeps you in control."* Optional quick cut: a plain chat window
  re-explaining constraints.
- **Required evidence:** none (framing only).
- **Expected duration:** 20 s.
- **Fallback:** none needed — pre-recorded title.

## 0:20–0:45 — Introduce Muse Recall and the existing game

- **Narration:** "This is Muse Recall, in its game studio, Muse Forge. It already has an approved
  game — a real Meta Muse generation, version 1. Everything from here is a *modification of this
  approved source*, not a fresh generation."
- **On-screen:** Open the app → Forge tab → project `forge-demo`. Show the running game preview
  and the version badge (v1, seeded from the recorded baseline). Briefly show the sidebar: memory,
  conversations, Forge.
- **Required evidence:** live UI with the seeded baseline (`demo/forge-baseline/index.html`, a
  recorded real `muse-spark-1.3-contributor` generation; sha pinned by the seed script).
- **Expected duration:** 25 s.
- **Fallback:** if the app is down, open the pre-recorded capture of this same screen.

## 0:45–1:10 — A remembered creative decision

- **Narration:** "In a previous session we set decisions: this is a game for young children — no
  flashing effects, no countdown timers, no penalty for mistakes — *and why*. Notice I can also
  correct a decision: the art direction changed from a warm sunset palette to a cool ocean
  palette. The old decision stays in history, but it never comes back as guidance."
- **On-screen:** Memory inspector: open the child-safety decision (content + rationale, provenance,
  project scope). Open the palette decision's history: correction with reason, superseded original
  marked superseded, append-only audit entries.
- **Required evidence:** live deterministic UI — no model call. For an alternative take, the
  Phase 12A evidence screenshots show the superseded-vs-corrected constraint pair.
- **Expected duration:** 25 s.
- **Fallback:** pre-recorded capture of the inspector; never rely on live data entry.

## 1:10–1:45 — Ask Muse to modify the existing game

- **Narration:** "Now I ask for a change — 'make it more exciting, while honoring our design
  decisions.' The app pulls the current decisions into the prompt — and it records exactly which
  decisions and which prompt bytes were sent, so we can prove the memory was actually used."
- **On-screen:** Type the request in Forge → submit. Show the job start, the retrieved-memory list,
  the recorded prompt hash. **Play the pre-recorded generation run** (captured at full speed
  beforehand from the same seeded project; keep at least ~10 s of real-time generation visible so
  the wait is authentic).
- **Required evidence:** one real recorded run on the seeded baseline (or the live run if time and
  quota allow). The memory block + `prompt_sha256` are production-recorded on the job.
- **Expected duration:** 35 s.
- **Fallback:** the pre-recorded run *is* the primary path. If even the recording fails, cut to the
  Phase 12A recorded A/B/C outputs (`A-v2.html` vs `C-v2.html` screenshots) as proof that
  modification + memory influence happened, and narrate over them.

## 1:45–2:15 — Source changes and runtime verification

- **Narration:** "The result is a small diff against the approved game — a few lines changed, not a
  rewritten file. And before I can even approve, the app has *played the game itself*: it launches
  the modified build headless in Chrome, fails on any page error, and confirms the game renders."
- **On-screen:** Review panel: unified diff (call out the change size), structural validation
  result, runtime verification result with the rendered game screenshot.
- **Required evidence:** from the same recorded run: the diff panel and the runtime check output.
  Comparable recorded numbers: real trials changed 1.2–10.1% of lines, all runtime-verified.
- **Expected duration:** 30 s.
- **Fallback:** static diff screenshot from the run recording; the runtime check is part of the
  same job record and appears even in the fallback evidence.

## 2:15–2:40 — Decision Guard advisory findings (honestly)

- **Narration:** "An advisory Decision Guard also checks the new source against our remembered
  decisions. On this deliberately-mutated build it flags a countdown timer and a score penalty,
  citing the child-safety decision itself with the offending line as evidence. Two things we say
  plainly: this check is advisory — it informs me, it does not block — and it is a source-pattern
  check, not full compliance verification. We audited its accuracy and kept the human in charge on
  purpose."
- **On-screen:** Review panel, guard section: the two findings with decision citation + evidence
  excerpts, and the "pre-runtime review snapshot / advisory" labels. Optionally one UNVERIFIED
  note to show honesty.
- **Required evidence:** the labelled-mutation case (real production path; the in-page banner
  states it is a test mutation, not spontaneous model output). Recorded captures exist:
  `ui-decision-guard-advisory.png`, `ui-review-page.png` in the Phase 12C evidence.
- **Expected duration:** 25 s.
- **Fallback:** show the recorded screenshots and state they come from the evaluation run; keep the
  honesty sentence regardless.

## 2:40–2:55 — Approve and roll back

- **Narration:** "The decision is mine. With every finding visible, I approve — the change becomes
  version 2, the diff and memory trail are recorded — and one click rolls back to version 1.
  Nothing sticks without my approval, and nothing is lost when I undo."
- **On-screen:** Click Approve (with advisory findings on screen) → version 2 appears → Roll back →
  version 1 is current again. Show the version history list.
- **Required evidence:** live deterministic UI (approval of an already-generated job needs no model
  call). Verified behaviour: approval succeeds with findings present; rollback restores the base.
- **Expected duration:** 15 s.
- **Fallback:** pre-recorded approve + rollback capture, or the recorded
  `ui-approved-with-findings.png` plus the rollback shots from the run.

## 2:55–3:00 — Closing

- **Narration:** "Muse Recall: your decisions survive, they shape what Muse builds, the app shows
  evidence — and you stay in control."
- **On-screen:** Title card: project name + one-line message + repo/URL placeholder.
- **Required evidence:** none.
- **Expected duration:** 5 s.
- **Fallback:** none.

---

## Recording checklist (do before demo day)

1. Record one full modification run on seeded `forge-demo` (segment 4 + 5 + 7 footage from the
   same job, end to end, real time).
2. Record the memory-inspector segment (4 + 6 footage can be one session).
3. Capture the guard-findings panel from the labelled-mutation job (or reuse
   `pnpm evidence:guard-ui` output).
4. Keep every source artifact: job id, prompt hash, diff, runtime screenshot. Do not re-stage or
   edit model output; if a run fails, re-run and re-record — do not fabricate.
