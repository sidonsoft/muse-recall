# Revised demonstration storyboard — Muse Recall / HTML Studio

> **SUPERSEDED — historical document.** The canonical storyboard is
> [V2_DEMO_RECORDING_PLAN.md](V2_DEMO_RECORDING_PLAN.md). This file is retained for history and must
> not be used for the V2 recording.

**Status:** proposal for director approval. **No video has been rendered, replaced, or
uploaded.** The existing MP4 is a protected artifact.

**Protected artifact (primary workspace, untracked in this branch):**
`video/cut/Muse_Recall_CutA_1080p.mp4` in the primary workspace (untracked, outside this
branch; 1920×1080, 172 s, 11.3 MB). It was only read with `ffprobe` and frame extraction; it
was not modified.

---

## 1. Comparison: existing footage vs revised UX

Frames were inspected from the protected MP4 at 0:25 and 1:45 and compared with the
revised Studio at 1920×1080, 1440×900, and 1280×720.

| Dimension | Existing MP4 (CutA) | Revised UX | Material for the submission? |
| --- | --- | --- | --- |
| Product identity | “Muse Memory Lab · memory companion”; nav “Forge” | “MUSE RECALL”; “Build with Muse Spark. Remember what matters.”; “HTML Studio” | **Yes.** The current video names a different product. |
| Category | “AI game studio”; “playable approved game” | “AI development workspace”; “working browser application” | **Yes.** It fixes the core positioning problem. |
| Navigation | Eight items, five marked P3/P5/P6 and non-functional | Four working surfaces only | **Yes.** Removes roadmap noise in every frame. |
| Preview prominence | Preview shared width with a 340 px prompt column and a 312 px generic inspector; clipped at 1280×720 | Preview is the centre column, ~750 px wide at 1440; fills height; no generic inspector | **Yes.** The artifact reads as the hero. |
| Source / diff | Unified diff in a `<pre>`, no source view after approval | Preview / Source / Changes tabs; syntax-coloured source, line numbers, coloured diff, artifact SHA and size | **Yes.** Demonstrates inspectability. |
| Memory | Visible only in the Memories screen; not connected to the development workspace | Project memory rail beside the prompt, active/superseded, “supplied to this generation”, link to detail | **Yes.** Makes the differentiator visible in the core shot. |
| Decision Guard | Dense 9–10 px panel below the diff, sometimes below the fold | Review rail: readable findings, advisory banner, bounded evidence, always beside approval | **Yes.** Guard becomes legible at 1080p. |
| Approval / rollback | Approve/Reject inside a dense diff card; “Undo last change” top-right | Sticky approval block, staged/current chips, version history, two-step rollback confirmation | **Yes.** Human control is obvious. |
| Export | Absent | “Download HTML” with an explicit non-self-contained caveat | Moderate. Useful proof of a real artifact; not a reason alone to re-record. |
| Readability at 1080p | 9–11 px metadata; long paragraphs; some content below fold | 10.5–13 px text, wider panels, shorter labels | **Yes.** Recording compression punishes tiny type. |
| Product completeness | Non-functional nav entries and a system dashboard on entry | Landing view is HTML Studio; empty states explain the workflow | **Yes.** First frame sells the product. |
| Demo mechanics | Recorded replay for modification, correctly labelled in edit | Same replay discipline remains available; new UI has explicit staged/current states | Neutral. Must preserve the label. |

### Recommendation

**Re-record a V2 only after director approval.** The existing CutA is a competent edit and a
valid fallback, but it would now show a product name and category the submission no longer
claims. That is not a polish issue; it is a positioning mismatch a judge would see in the
first ten seconds.

Do **not** silently replace CutA. Keep it as the approved fallback and produce V2 alongside
it, with the same provenance labels. If approval is withheld, submit the revised UX
screenshots and CutA with a note; do not present CutA as the new UI.

---

## 2. Recording target

- **Length:** 172 s (2:52), matching the existing cut.
- **Viewport:** 1920×1080, browser at 100% zoom, no OS chrome.
- **Project:** `forge-demo`, seeded with `pnpm demo:seed` (v1 approved, three decisions).
- **State before recording:** no staged change; Studio loaded; preview ready; Memory screen
  warmed in a second tab.
- **Inference:** none live during recording. Modification footage is the labelled replay of
  recorded Phase 12A C source. No paid inference without director approval.
- **Font size check:** verify the smallest visible text is ≥10.5 px CSS and readable after
  1080p compression.

---

## 3. Three-minute storyboard

| # | Time | Segment | On screen (revised UI) | Spoken narration (draft) | Provenance / evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:15 | **Muse Spark builds** | Title card: MUSE RECALL / “Build with Muse Spark. Remember what matters.” | “Most AI builders give you a chat and a first draft. Muse Recall gives you a working application — and remembers how you got there.” | Framing only. |
| 2 | 0:15–0:38 | **The artifact is the hero** | HTML Studio, `forge-demo`, v1 approved, preview running. Point at Preview / Source / Changes, then the memory rail. | “This is HTML Studio, powered by Meta's Muse Spark. Version one is a real, approved browser application — running sandboxed. Its source and every change are one click away, and the project's decisions sit beside the prompt.” | Seeded `demo/forge-baseline/index.html`; recorded real generation; version summary. |
| 3 | 0:38–0:58 | **Recall remembers** | Click a memory card; Memory screen opens on the child-safety decision. Back to Studio; show sunset superseded and ocean active in the rail. | “These are decisions, not chat scrollback. A child-safety rule, and a palette I changed my mind about: the sunset decision stays audited but superseded, so only the corrected ocean decision is active.” | Live deterministic UI; seeded decisions; correction history. |
| 4 | 0:58–1:18 | **Authentic memory influence** | Existing `11-memory-influence.png` figure, with provenance lower-third. | “Did memory actually change the output? In the Phase 12A trial — one model, one request, three conditions — the sunset memory drew the sunset accent; with no memory, neither appeared; the corrected ocean memory drew the ocean accent, with the superseded value absent.” | Authentic Phase 12A output and prompt hash. **One run per condition — directional, not statistical.** Do not show replay ids here. |
| 5 | 1:18–1:42 | **Muse Spark develops** | Studio: “Change this app”, type a change, optionally capture, Generate. Show queued/running status, then staged preview. | “Now change it. This request edits the approved source in place. It is staged as a reviewable version — the current application is untouched.” | Recorded replay of Phase 12A C source. **Overlay: “Replay of recorded Phase 12A Muse output.”** |
| 6 | 1:42–2:02 | **Inspect and review** | Changes tab: coloured diff, +/− counts, summary. Switch to Source: line numbers, highlighted HTML, artifact SHA and byte count. Right rail shows validation and Decision Guard. | “Before anything is published, I can read the diff and the exact staged source. The server has already parsed it and loaded it in headless Chrome; a blank render or a page error would stop approval.” | Staged bytes; validation and runtime gate. **Load-time only** — say so briefly. |
| 7 | 2:02–2:20 | **Decision Guard warns** | Review rail guard panel, a labelled mutation finding with rule, severity, decision reference, explanation, evidence excerpt. | “Decision Guard is independent and advisory. It checks supported source patterns against my own decisions and cites the evidence. It warns — it does not block, and it is not a compliance certificate.” | Labelled mutation / packaged evidence, not model output. Guard overlay if the panel is from evidence. |
| 8 | 2:20–2:38 | **The developer decides** | Approve → v2 published; preview now approved v2; show version history with v1 recoverable. Then rollback two-step confirmation → v1 current. | “I approve, and the verified bytes become version two. If I change my mind, rollback follows the recorded parent — v1 comes back. Memory guides, Guard warns, I decide.” | Replay footage continues under the label; approval and rollback are real pipeline operations on the replay bytes. |
| 9 | 2:38–2:52 | **Close** | Title card: “Muse Spark builds it. Recall remembers why. You remain in control.” Repository URL; advisory/limitations line. | “Muse Spark builds it. Recall remembers why. You remain in control.” | Disclaimer: Guard advisory; runtime check load-time only; A/C trial one run per condition. |

Total: **172 s**.

---

## 4. Mandatory provenance overlays

| Window | Overlay | Reason |
| --- | --- | --- |
| 1:18–2:02 | `Replay of recorded Phase 12A Muse output.` | The modification/diff footage is replayed from recorded authentic source, not generated live. |
| 2:02–2:20 | `Labelled mutation — packaged evidence, not model output.` | The guard finding is shown from a labelled mutation used in the accuracy audit. |
| 2:20–2:38 | `Replay of recorded Phase 12A Muse output.` | Approval/rollback operate on the replay-staged bytes. |
| 4 segment | `One run per condition — directional, not statistical.` | A/C trial limitation. |
| End card | `Decision Guard is advisory. Runtime verification is load-time only.` | Prevents overclaiming. |

The overlay is mandatory on every frame of replay footage, as in the existing runbook. Keep
it at ≥24 pt, white on a 90%-opaque black bar, inside the 1080p safe area.

---

## 5. Shot list / operator cues

1. **Warm state:** run `pnpm demo:seed`; start `pnpm dev`; open `http://127.0.0.1:5173`;
   confirm Studio shows `forge-demo`, `v1 approved`, artifact SHA `79c9d67a…`.
2. **Capture at 1920×1080** with the browser viewport exactly 1920×1080. Hide bookmarks
   bar; use a clean profile.
3. **No fabricated progress.** Do not add percentages; the UI shows queued / running /
   staged / approved, which is what the backend knows.
4. **Do not open the old Forge labels.** The UI now says HTML Studio, Change this app,
   Preview, Source, Changes.
5. **Guard evidence:** use the packaged labelled-mutation state; keep the overlay. Do not
   imply the guard ran on a live model generation.
6. **Export (optional, 4 s):** click Download HTML only if the take has slack; the toast
   discloses that a CDN reference still needs network. Do not call the file self-contained.
7. **Rollback:** show the confirmation step; it names the restore target. Do not cut it.

---

## 6. What this storyboard deliberately omits

- No live-paid-inference segment. If the director wants one, it needs a separate approval and
  a fallback recording.
- No claim that Decision Guard prevents violations, that runtime verification tests
  gameplay/interactions, or that retrieved memory caused a specific output outside the
  controlled trial.
- No “autonomous agent” language. The human approval step is the point.
- No game-only framing. The game is the demonstration artifact; the product category is HTML
  application development.

---

## 7. Approval request

Director approval is requested for:

1. Re-recording V2 against this storyboard at 172 s.
2. Keeping CutA as the approved fallback, untouched.
3. Using the existing labelled-replay evidence with the overlays above.

Until approval, no video is rendered and no submission is made.
