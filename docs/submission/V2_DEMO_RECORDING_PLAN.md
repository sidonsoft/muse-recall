# V2 demonstration — recording plan (live FocusFlow)

**Status: canonical storyboard for the final release candidate.** It supersedes
`REVISED_DEMO_STORYBOARD.md`, `DEMO_SCRIPT_3MIN.md`, `VIDEO_STORYBOARD.md` and
`RECUT_BRIEF_PHASE15A.md` for the V2 recording. Those documents are retained as history and must not
be used as the current storyboard. **No video has been rendered, replaced, or uploaded.** The
existing MP4 is a protected artifact and is not touched by this plan.

**Protected artifact:** `video/cut/Muse_Recall_CutA_1080p.mp4` in the primary workspace
(untracked on this branch; 1920×1080, 172 s, 11.3 MB). It remains the approved fallback.

**Evidence base:** live Muse Spark runs on 2026-10-28 (AEST) recorded in
[`../demo/NON_GAME_HTML_VALIDATION.md`](../demo/NON_GAME_HTML_VALIDATION.md) and
[`../demo/LIVE_MUSE_CONFIGURATION.md`](../demo/LIVE_MUSE_CONFIGURATION.md). FocusFlow is a
non-game task planner; it is the new centrepiece, not a replacement for the game evidence.

---

## 1. What changed since the approved replay storyboard

The approved 172 s storyboard (`docs/submission/REVISED_DEMO_STORYBOARD.md`) was written when the
modification segment had to be a **labelled replay** of recorded Phase 12A source because live
paid inference was not authorised. That constraint has changed: the director authorised a live
demonstration, and the live FocusFlow generation and modification have now been run and validated.

This plan therefore proposes a **live-footage V2** while keeping the approved replay storyboard as
the fallback. It does not retroactively relabel the replay as live, and it does not remove the
mandatory replay overlays if any replay footage remains in the cut.

| Existing approved segment | This plan | Reason |
|---|---|---|
| 1. Muse Spark builds (0:00–0:15) | Opening with **FocusFlow v2 approved** | Same framing; non-game artifact is the proof of the broader category |
| 2. Artifact is the hero (0:15–0:38) | Same, with FocusFlow preview/source/diff | Same UI, new artifact |
| 3. Recall remembers (0:38–0:58) | Same, with five FocusFlow decisions including two captured at approval | Shows decisions persisting across iterations |
| 4. Authentic A/C influence (0:58–1:18) | **Keep the authentic Phase 12A figure** as the causal evidence | FocusFlow retrieval is not a controlled causal test; do not overclaim it |
| 5. Muse Spark develops (1:18–1:42) | **Live FocusFlow modification** (or a fresh recording run) | Live inference is now authorised; keep the replay fallback labelled |
| 6. Inspect and review (1:42–2:02) | Same, with live diff/source and the load-time gate | |
| 7. Decision Guard warns (2:02–2:20) | **Packaged Phase 12C/12E labelled-mutation finding** + live FocusFlow advisory limitation | No live violation was manufactured; the packaged finding is labelled |
| 8. The developer decides (2:20–2:38) | **Approve v2; show rejected attempt 1 and the rejected no-op probe** | Real approvals and rejections, with attempt history |
| 9. Close (2:38–2:52) | **Phase 15B conservative result** (2:28–2:40) + close (2:40–2:52) | Adds the research evidence without exceeding 2:52 |

The revision keeps the 172 s target from the approved storyboard. It is **not** a 3:00 target:
172 s gives 8 s of headroom inside the three-minute limit and matches the existing cut.

---

## 2. Evidence classes — never conflate

| Class | What it is | Live assets | On-screen label |
|---|---|---|---|
| **A. Live FocusFlow generation** | Real `muse-spark-1.3-contributor` generation, job `e358246a…`, attempt 2 | `v2-staged.html`, `ui-01…05`, `v2-*` screenshots | `Live Muse Spark generation — 2026-10-28, job e358246a…` |
| **A′. Rejected first generation** | Real generation, job `1621b9db…`; failed the sandbox form test | `v1-staged.html`, `v1-failure-form-blocked.png` | `Attempt 1 — rejected: native form blocked by preview sandbox` |
| **B. Live FocusFlow modification** | Real `muse-spark-1.3-contributor` edit, job `aeb6b175…`, base v1 → v2 | `v3-staged.html`, `ui-06…10`, `v3-*` screenshots | `Live Muse Spark modification — job aeb6b175…` |
| **C. Live memory-respecting refusal** | Real modification job `0ecc11a0…`; model refused a countdown because of remembered rule; file unchanged; rejected | `v4-staged.html`, `v4-model-response.txt` | `Live run — model honoured the remembered rule; no change promoted` |
| **D. Authentic Phase 12A influence** | Original one-run-per-condition A/B/C evidence | `docs/hackathon-evidence/phase12/*`, `phase12/pilot.json` | `Authentic Phase 12A output — one run per condition` |
| **E. Labelled Guard mutation** | Deterministic test edit, not model output | `docs/hackathon-evidence/phase12e/sources/…`, `05-guard-advisory-mutation.png` | `Labelled mutation — packaged evidence, not model output.` |
| **F. Phase 15B trial** | Original 32-run trial; the protocol pre-registered the **rubric text**, not scoring code | [`../hackathon-evidence/phase15b/`](../hackathon-evidence/phase15b/) on this branch | `Phase 15B original automated coding: 15/16 no memory vs 5/16 memory` |

Rules:

- A/A′/B/C may be shown as live footage; they are never spliced to look like one uninterrupted
  generation.
- D is a separate controlled experiment and is **not** evidence that FocusFlow's amber accent was
  caused by memory.
- E is never described as model output.
- F is never merged into the FocusFlow evidence or relabelled as a FocusFlow result.

---

## 3. Recording target

| Property | Value |
|---|---|
| Length | **172 s (2:52)**, hard ceiling 180 s |
| Viewport | 1920×1080, browser 100% zoom, no OS chrome |
| Product | `MUSE RECALL` — HTML Studio, project `focusflow`, current version **v2** |
| Provider | `muse-cli`; chat `muse-spark-1.3`; Forge `muse-spark-1.3-contributor`; effort `high` |
| Server | isolated demo server; never the production database |
| Starting state | v2 approved; no staged change; preview loaded; Memory view warmed in a second tab |
| Live inference | **Only if the recording run is a new, genuine job.** Do not replay old bytes as live. |
| Existing MP4 | Untouched; V2 assets under `video/v2-live/` with distinct filenames |

### 3.1 Recording-run protocol

The evidence runs are already complete. If the video needs moving footage of a generation, record
a **new** live run on a dedicated copy of the demo state:

1. Copy `$HOME/muse-demo-live/demo.db` and `$HOME/muse-demo-live/ws/` to
   `$HOME/muse-demo-live-recording/`; start the server on a separate port.
2. Confirm FocusFlow v2 is current and the five decisions are active.
3. Record the screen continuously from before the request until the staged result and review.
4. Preserve the new job id, prompt SHA-256, artifact SHA-256, usage, and validation result in
   `video/v2-live/provenance.json`.
5. If the new run is approved, its version becomes v3; if it is rejected, v2 stays current. Either
   is valid footage, but the narration must match the outcome.
6. Do not reuse the evidence-run job id for the recording run. Do not edit the recorded bytes.

If the director prefers not to record a new run, the existing **stills** (`ui-01…10`,
`v2-approved-*.png`, `v3-*`) may be used as stills with the job ids on screen. They must not be
presented as continuous live footage.

---

## 4. Storyboard (172 s)

| # | Time | Segment | On screen | Narration | Evidence / overlay |
|---|---|---|---|---|---|
| 1 | 0:00–0:14 | **Muse Spark builds** | Title card: MUSE RECALL / “Build with Muse Spark. Remember what matters.” Then HTML Studio with FocusFlow v2 running. | “Most AI builders give you a chat and a first draft. Muse Recall gives you a working application — and remembers the decisions that made it.” | Framing. |
| 2 | 0:14–0:36 | **The artifact is the hero** | FocusFlow v2 approved. Preview with priorities and the high-priority remaining count. Click Preview / Source / Changes. Memory rail visible. | “This is HTML Studio, powered by Meta's Muse Spark. Version two is a real, approved browser application — a task planner, not a game — running sandboxed. Its source and every change are one click away.” | Live v2, job `aeb6b175…`; artifact SHA `1d0ea67f…`. |
| 3 | 0:36–0:56 | **Recall remembers** | Memory rail: five active decisions. Open one captured at approval (M4/M5). Show `used` on the decisions supplied to the modification. | “These are decisions, not chat scrollback: a single-file constraint, an amber identity, plain-verb copy, and the two decisions I captured when I approved each version. The rail says exactly what was supplied — and warns that retrieval is not proof of causation.” | Live deterministic UI; memory ids M1–M5. |
| 4 | 0:56–1:14 | **Authentic influence** | Phase 12A A/C figure with provenance lower-third. | “Did memory actually change output? In the Phase 12A trial — one model, one request, three conditions — the sunset decision drew the sunset accent, no memory drew neither, and the corrected ocean decision drew the ocean accent. One run per condition: directional, not statistical.” | **Authentic Phase 12A output.** Do not use FocusFlow retrieval as causal proof. Overlay: `One run per condition — directional, not statistical.` |
| 5 | 1:14–1:36 | **Muse Spark develops** | Live modification: request visible, generation running, staged result. If using a new recording run, its job id appears here. | “Now a change. Add task priorities and a compact high-priority remaining count — keeping the visual style and every existing control. The request edits the approved source in place. Nothing is published yet.” | **Live Muse Spark modification — job aeb6b175…** (or the recording run's id). Overlay: `Generation time condensed — approximately 2 minutes elapsed.` |
| 6 | 1:36–1:54 | **Inspect and review** | Changes tab: diff. Source tab: line numbers, artifact SHA and size. Review rail: validation passed. | “Before anything is published, I can read the diff and the exact staged source. The server parsed it and loaded it in headless Chrome; a blank render or a page error would stop approval. That check is load-time only — it does not play the app.” | Staged bytes; `validation.ok`, `runtime_verified: true`. Say “load-time only”. |
| 7 | 1:54–2:12 | **Decision Guard warns** | Packaged guard finding: rule, severity, decision reference, explanation, evidence excerpt. Then cut to the live FocusFlow advisory panel showing `NOT VERIFIED` with its limitations. | “Decision Guard is independent and advisory. It checks only the supported source patterns and cites the evidence. This packaged finding is from the accuracy audit. On the live FocusFlow run it had nothing to flag: when I asked for a countdown, Muse Spark refused because the project remembered the no-countdown rule. Guard still would not claim compliance for rules it cannot check.” | **Mandatory overlay: `Labelled mutation — packaged evidence, not model output.`** Live panel: `advisory`, `not_verified`. |
| 8 | 2:12–2:28 | **The developer decides** | Approve v2; version history shows v1 recoverable. Cut to the rejected attempt 1 (sandbox form failure) and the rejected no-op probe. Optional: two-step rollback, then restore v2 before recording ends. | “I approve, and the verified bytes become version two. Version one stays recoverable. When the first generation failed in the sandbox, I rejected it; when a later request conflicted with a remembered rule and produced no change, I rejected that too. Memory guides, Guard warns, I decide.” | Real approval `2026-10-27T19:45:07Z`; rejected jobs `1621b9db…`, `0ecc11a0…`. |
| 9 | 2:28–2:40 | **Experimental evidence** | Phase 15B results card. | “In the Phase 15B child-safety trial — one model, one game, one request — the original automated coding flagged 15 of 16 without project memory and 5 of 16 with it. A post-hoc review found those five flags were text promising no penalties; corrected coding found 0 of 16 under narrower definitions. The original scorer was not preserved, but its per-run output is published.” | **Overlay:** `Original automated coding: 15/16 no memory vs 5/16 memory (p=0.0006). Post-hoc corrected: 15/16 vs 0/16. One model, game, rule, request.` |
| 10 | 2:40–2:52 | **Close** | Title card: “Muse Spark builds it. Recall remembers why. You decide.” Repository URL. | “Muse Spark builds it. Recall remembers why. You decide.” | End-card disclaimer. |

**Timeline arithmetic:** 14 + 22 + 20 + 18 + 22 + 18 + 18 + 16 + 12 + 12 = **172 s**, contiguous,
ending at **2:52**.

---

## 5. Mandatory provenance overlays

The overlays are not optional, not conditional on a viewer question, and not removed to fit the
runtime. Style: lower-third, white ≥24 pt on a 90%-opaque black bar, inside the 1080p safe area.

| Window | Exact text | Applies to |
|---|---|---|
| 1:14–1:54 | `Live Muse Spark modification — job aeb6b175-01a6-4c9b-93a1-757cddf475e1` | Live modification / staged review footage |
| 1:14–1:36 | `Generation time condensed — approximately 2 minutes elapsed.` | The 116 s live job, condensed |
| 1:54–2:12 | `Labelled mutation — packaged evidence, not model output.` | The guard finding insert |
| 0:56–1:14 | `Authentic Phase 12A output — one run per condition.` | A/C figure |
| 0:56–1:14 | `Directional, not statistical.` | A/C figure |
| 2:28–2:40 | `Phase 15B original automated coding: 15/16 no memory vs 5/16 memory (p=0.0006). Post-hoc corrected: 15/16 vs 0/16. One model, game, rule, request.` | Results card |
| End card | `Decision Guard is advisory. Runtime verification is load-time only. Retrieval is not proof of causal influence outside the controlled trials.` | Close |
| Any replay frame | `Replay of recorded Phase 12A Muse output.` | Only if replay footage is retained |

If the director retains any replay footage from the approved storyboard, the existing replay
windows remain exactly as specified in `docs/submission/DEMO_SCRIPT_3MIN.md`:
1:16.0–2:08.0 and 2:23.0–2:40.0, with the labelled-mutation label at 2:08.0–2:23.0. This plan
does not shorten or remove them.

---

## 6. Retake and rejection disclosure

The final cut may use **attempt 2** for the generation and the single modification job. That is a
retake, not the first attempt.

- Attempt 1 (`1621b9db…`) was a real Muse Spark generation that failed browser validation because
  the preview sandbox blocks native form submission. It was rejected. Its artifact and failure
  record are preserved.
- Attempt 2 (`e358246a…`) is the selected generation and became v1.
- The modification (`aeb6b175…`) became v2.
- The guard probe (`0ecc11a0…`) was a genuine no-op refusal and was rejected.

If the video shows attempt 2, the narration or a lower-third must not imply it was the first
attempt. Required disclosure:

> `Retake with an added sandbox instruction — attempt 1 was rejected after a sandbox form failure; attempt 2 selected.`

The retake kept the original request and added a human-written sandbox constraint paragraph. The
prompt hashes differ (`0ed6bcb7…` for attempt 1 vs `bbf6a0ef…` for attempt 2); the prompt is
preserved in `$HOME/muse-demo-live/runs/v2-prompt.txt`.

If the video shows the rejected attempt 1, label it:

> `Attempt 1 — rejected: native form blocked by preview sandbox.`

Do **not** silently edit generated code and present it as untouched Muse output. The retake used a
changed prompt (the sandbox constraint); the prompt is preserved in
`$HOME/muse-demo-live/runs/v2-prompt.txt`.

---

## 7. Decision Guard segment — what can and cannot be claimed

**Can claim:**

- Guard is independent, deterministic, and advisory; it never blocks approval.
- It evaluates the staged source against the decisions recorded on the job.
- It reports supported-rule findings with bounded evidence, and reports `not_verified` rather than
  claiming compliance for unsupported decisions.
- The packaged Phase 12C/12E finding is a labelled mutation, not model output.
- In the live FocusFlow run, Guard returned no violation because the model complied with the
  remembered no-countdown rule; the panel still showed `NOT VERIFIED` for unsupported decisions.

**Cannot claim:**

- That Guard prevents violations, certifies compliance, or replaces human review.
- That Guard ran on live model output if the finding shown is the packaged mutation.
- That the live FocusFlow `not_verified` panel is a violation finding.

If the director wants a live violation finding on screen, it must come from a new, preserved live
run whose source actually violates a supported rule; it must carry its own job id and overlay.
Do not manufacture one by editing the staged source.

---

## 8. Phase 15B numbers — exact wording and source

The public headline is the **original automated coding (v1)**, the conservative result. The
protocol pre-registered the **rubric text**, not scoring code; the v1 implementation was never
committed and was overwritten, so only its per-run output survives. The corrected v2 coder was
created **after unblinding**.

| Scoring | Memory | No memory |
|---|---:|---:|
| Original automated coding (v1) | **5/16** | **15/16** |
| Corrected post-hoc coder (v2) | 0/16 | 15/16 |

- Original v1: Fisher exact two-tailed **p = 0.000635** (pre-registered test, original instrument).
- Corrected v2: **p = 5.66e-08**, but produced **after unblinding**; it is not a pre-registered
  number and is not confirmatory.
- Source: [`docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md`](../hackathon-evidence/phase15b/EVIDENCE_CARD.md)
  and [`RESULTS.md`](../hackathon-evidence/phase15b/RESULTS.md) on this branch.
- Do not merge these numbers into FocusFlow evidence or present them as a FocusFlow result.
- Do not say “memory eliminated violations” on screen without the corrected/post-hoc label.
- The exploratory boundary probe is the reason Guard exists as a backstop: in that game probe,
  remembered memory did **not** override an explicit instruction to add a countdown.

---

## 9. Asset manifest

| Asset | Path | Use |
|---|---|---|
| FocusFlow v1 generation review | `$HOME/muse-demo-live/screenshots/ui-01-studio-review.png` | Opening / review |
| Initial diff | `ui-02-diff.png` | Review |
| Source inspection | `ui-03-source.png` | Review |
| Decision capture | `ui-04-decision.png` | Human control |
| v1 approved | `ui-05-approved.png` | Approval |
| Modification review | `ui-06-modification-review.png` | Live development |
| Modification diff | `ui-07-modification-diff.png` | Inspect |
| Modification source | `ui-08-modification-source.png` | Inspect |
| Modification decision | `ui-09-modification-decision.png` | Human control |
| v2 approved | `ui-10-approved-v2.png` | Hero shot |
| FocusFlow v2 app | `v2-approved-desktop.png`, `v2-approved-mobile.png` | App proof |
| Priority states | `v3-desktop-priorities.png`, `v3-mobile.png` | App proof |
| Rejected v1 | `v1-failure-form-blocked.png` | Honest failure |
| Phase 12A figure | `docs/hackathon-evidence/phase12/…`, `phase14a/memory-influence.png` | Causal evidence |
| Guard finding | `docs/hackathon-evidence/phase12e/screenshots/05-guard-advisory-mutation.png` | Guard insert |
| Phase 15B card | [`docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md`](../hackathon-evidence/phase15b/EVIDENCE_CARD.md) | Results |

V2 output files (distinct from CutA):

```text
video/v2-live/
├── Muse_Recall_V2_Live_1080p.mp4
├── provenance.json
├── overlays/
└── stills/
```

Never write to `video/cut/Muse_Recall_CutA_1080p.mp4`.

---

## 10. Pre-recording checklist

- [ ] Director approves live footage (or explicitly chooses the replay fallback).
- [ ] Demo server on an isolated database; `MODEL_PROVIDER=muse-cli`; live health check passes.
- [ ] Forge model is `muse-spark-1.3-contributor`; chat is `muse-spark-1.3`; effort `high`.
- [ ] Budgets are the supported maxima; no secret visible in terminal, logs, or browser.
- [ ] FocusFlow v2 approved; five decisions active; no staged change.
- [ ] Memory view warmed; Studio loaded; preview ready.
- [ ] Recording run (if any) has a fresh job id and provenance file.
- [ ] 1920×1080, 100% zoom, no bookmarks bar, no personal notifications.
- [ ] Smallest text ≥10.5 px CSS; check after 1080p compression.
- [ ] Phase 15B card uses the original automated coding (15/16 vs 5/16, p=0.0006) as the headline; corrected 0/16 is labelled post-hoc.
- [ ] Guard insert uses the labelled mutation overlay.
- [ ] Existing MP4 hash recorded before and after; must be unchanged.

---

## 11. Post-recording QC

- [ ] Duration ≤180 s; target 172 s.
- [ ] Every live segment carries its job id and model/config overlay.
- [ ] Any condensed wait carries `Generation time condensed — approximately N minutes elapsed.`
- [ ] No replay footage without the replay label.
- [ ] No labelled mutation without its label.
- [ ] No implication that attempt 2 was the first attempt.
- [ ] No claim that retrieval caused the amber accent; the A/C trial is the causal evidence.
- [ ] No claim that Guard blocked, prevented, or certified anything.
- [ ] No claim that runtime verification tested interactions; it is load-time only.
- [ ] Phase 15B numbers match the original table; corrected numbers labelled post-hoc.
- [ ] Protected MP4 hash unchanged.
- [ ] Submission not made without director approval.

---

## 12. Production decisions for director sign-off

1. **Approve live FocusFlow footage** for segments 2, 3, 5, 6, 7 (with the packaged Guard insert),
   and 8, keeping the authentic Phase 12A figure for segment 4.
2. **Approve the 172 s target** (2:52), or authorise a longer cut up to 180 s.
3. **Approve the retake disclosure** for attempt 1 → attempt 2.
4. **Approve the packaged labelled-mutation Guard insert**, since no live violation was
   manufactured.
5. **Confirm CutA remains the fallback** and is not overwritten.

Until those decisions are recorded, no video is rendered and no submission is made.
