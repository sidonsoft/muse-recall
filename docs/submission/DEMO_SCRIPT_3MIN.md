# Muse Recall — three-minute demonstration script (Phase 14A)

**Total target: ~3:00.** Run from `agent/phase14a-demo-production`, seeded project `forge-demo`
(`pnpm demo:seed`). The modification segment uses **recorded authentic inference** so the demo does
not depend on live Muse availability. No paid Muse inference is performed without explicit director
authorisation.

**Measured context (do not inflate):** five real Phase 11A modification trials took 34.1–104.2 s
(mean 55.7 s, median 48.1 s). The A/B/C memory-influence trial was run **once per condition**.

**Cast:** Forge (preview → modify → review → approve → undo), Memories (decisions, correction
history), the Phase 14A A/C evidence figure.

---

## 0:00–0:15 — The problem

- **Narration:** “AI creative tools forget. You set a palette, a safety rule, a direction — and next
  session it is gone. You re-explain it, and then you find the model quietly changed something you
  already approved.”
- **On-screen:** Title card: *“An AI creative studio that remembers your decisions, checks its
  work, and keeps you in control.”*
- **Evidence:** none required (framing).
- **Duration:** 15 s. **Fallback:** pre-recorded title card.

## 0:15–0:35 — The existing game, immediately

- **Narration:** “This is Muse Recall’s game studio, Muse Forge. It already has an approved game —
  a real Meta Muse Spark generation, version 1. Everything from here edits this approved source; it
  is not a fresh generation.”
- **On-screen:** Forge → `forge-demo`. The Phaser game is already playable (press Start, flip a
  card). Show `approved: v1`.
- **Evidence:** seeded `demo/forge-baseline/index.html` (recorded real generation, sha pinned in
  `docs/hackathon-evidence/phase14a/demo-seed.json`).
- **Duration:** 20 s. **Fallback:** `screenshots/01-forge-v1-preview.png`.

## 0:35–0:55 — Persistent memory and correction history

- **Narration:** “The project remembers its decisions. A child-safety constraint — no flashing, no
  countdown timers, no penalties for mistakes — with provenance and scope. And a palette decision
  I changed my mind about: the sunset direction is still in the audit history, marked superseded,
  with my correction reason. Only the corrected ocean decision is active — the old one never comes
  back as guidance.”
- **On-screen:** Memories → child-safety detail (content, verified, project scope). Then the sunset
  entry: status **superseded**, **SUPERSEDED BY** the ocean decision, history shows the correction
  reason.
- **Evidence:** live deterministic UI; `screenshots/02-memories-list.png`,
  `03-constraint-detail.png`, `04-palette-supersession.png`; seed record `demo-seed.json`.
- **Duration:** 20 s. **Fallback:** the three screenshots, pre-loaded.

## 0:55–1:15 — Proof that memory changed the output (authentic A/C)

- **Narration:** “This is the part that matters. One model, one identical request, one identical
  baseline, three conditions, run once each. With the sunset decision, the generated game drew the
  sunset accent. With no memory, neither palette appeared. After I corrected the decision to ocean,
  the same model drew the ocean accent — and the superseded sunset hex appears nowhere in that
  source.”
- **On-screen:** `screenshots/11-memory-influence.png`: A, B and C side by side, with the memory
  texts and the accent values (`0xFF7E5F` vs `0x4EA8DE`) and rendered coverage.
- **Evidence:** authentic Phase 12A output: `docs/hackathon-evidence/phase12/{A,B,C}-v2.html` and
  screenshots; measurements in `phase12/pilot.json`; summary in `phase14a/memory-influence.json`.
- **Duration:** 20 s. **Fallback:** the figure itself is the primary asset; it is static.

## 1:15–1:45 — An authentic Muse modification

- **Narration:** “Now a change. I capture the current preview and ask Muse to add a Next Level
  button beneath Restart. Muse edits the approved source in place. The job records which remembered
  decisions were retrieved and the SHA-256 of the exact prompt sent — so the memory being in the
  prompt is provable, not asserted.”
- **On-screen:** **Play the pre-recorded authentic run** (keep ~10 s of real generation visible),
  then cut to **window A**, where the review was staged before recording (see
  [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) §6a). The UI cannot reopen an earlier job, so keep window A on
  Forge. In deterministic replay mode, say the review is a replay of recorded bytes.
  Job card: memory ids, prompt hash, validation passed.
- **Evidence:** recorded authentic run captured in advance (job id, prompt hash, retrieved memory
  ids). If unavailable, narrate over the authentic Phase 12A C source and state it is recorded.
- **Duration:** 30 s. **Fallback:** the recording is the primary path; never substitute fake-mode
  output.

## 1:45–2:00 — The staged diff

- **Narration:** “The result is a small diff against the approved game — a few lines, not a
  rewritten file. Nothing touches the approved version until I approve it.”
- **On-screen:** Review panel: unified diff, `validation passed`, action buttons.
- **Evidence:** same recorded run; Phase 11A trials changed 1.2–10.1% of lines.
- **Duration:** 15 s. **Fallback:** `screenshots/08-review-compliant.png`.

## 2:00–2:15 — The actual approval gate

- **Narration:** “Before promoting a change, Muse Forge launches it in headless Chrome and rejects
  builds that throw on load or fail to create a canvas. That is a load-time gate. It does not play
  the game for me, it does not inspect pixels, and it does not test every mechanic — those limits
  are exactly why I still review the diff and make the call.”
- **On-screen:** The review panel’s validation state; optionally scroll to the diff. Do **not**
  show a fabricated “runtime screenshot” — the UI exposes no verification image.
- **Evidence:** `apps/server/src/forge/runtime-check.ts`; `pnpm verify:runtime` (valid passes,
  broken rejected, unapproved network origin blocked).
- **Duration:** 15 s. **Fallback:** narration over `08-review-compliant.png`.

## 2:15–2:30 — Advisory Decision Guard, honestly (~15 s)

- **Narration:** “An advisory guard also checks the new source against my remembered decisions. On
  this deliberately labelled test mutation it flags a countdown timer and a mistake penalty, citing
  my child-safety decision and the offending line. Two things plainly: this is advisory — it does
  not block approval — and it is a source-pattern check, not compliance verification.”
- **On-screen:** The packaged labelled-mutation panel: **VIOLATION DETECTED**, two findings with
  the decision reference and evidence excerpt, “Findings do not block approval in this version.”
  State that the panel is packaged evidence from the labelled mutation, which is a labelled
  test edit, not spontaneous model output. Do not approve it; return to the staged authentic
  review.
- **Evidence:** `screenshots/05-guard-advisory-mutation.png`, `06-review-mutation.png`,
  `guard-advisory.json`; source label at
  `docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html`.
- **Duration:** 15 s. **Fallback:** the panel screenshot.

## 2:30–2:45 — Approve the authentic change, then undo it

- **Narration:** “The violating test build was rejected, never approved. Back on the authentic
  modification, the decision is mine: approve — it becomes version 2 — and one click rolls back to
  version 1, its recorded parent. The history stays intact.”
- **On-screen:** Optionally flash the packaged `07-rejected-mutation.png` to show the rejection,
  then return to window A: approve → `approved: v2` → click **Undo last change** → `approved: v1`.
- **Evidence:** live deterministic UI (approval of an already-generated job needs no model call);
  `screenshots/07-rejected-mutation.png`, `09-approved-v2.png`, `10-rolled-back-v1.png`; rollback
  regression in `rollback-ancestry.json`.
- **Duration:** 15 s. **Fallback:** the three screenshots.

## 2:45–3:00 — Closing

- **Narration:** “Muse Recall: your decisions survive, they visibly shape what Muse builds, the app
  shows its evidence — including what it cannot verify — and you stay in control.”
- **On-screen:** Title card with project name and repository URL.
- **Duration:** 15 s. **Fallback:** none needed.

---

## Provenance of the packaged Phase 14A screenshots

The `docs/hackathon-evidence/phase14a/screenshots/` captures were produced in **deterministic
rehearsal mode**: the API ran with `MODEL_PROVIDER=echo` and the fake-Muse fixture transported
recorded bytes. The game content and memory rows are authentic artifacts; the provider panel
honestly shows the offline adapter. Do not present these screenshots as a live Muse session. The
authentic A/C figure (`11-memory-influence.png`) **is** real Phase 12A model output and is labelled
as such.

## Recording checklist (Phase 14A)

1. Record one full **authentic** modification on seeded `forge-demo` (segments 5–7 and 10 from the
   same job, real time). If quota is unavailable, use the pre-recorded authentic Phase 12A C run and
   say so on screen.
2. Record the memory-inspector segment (child-safety detail, supersession history).
3. Use `docs/hackathon-evidence/phase14a/screenshots/05-guard-advisory-mutation.png` for the guard
   segment, or capture the panel from the labelled-mutation job; keep the provenance label visible.
4. Never edit model output, never re-stage bytes, never present the mutation as authentic model
   output. If a run fails, re-run and re-record.
5. State “recorded earlier” whenever footage is not live. No video file exists in this repository
   unless one was actually created; the operator creates it on demo day using this script.
