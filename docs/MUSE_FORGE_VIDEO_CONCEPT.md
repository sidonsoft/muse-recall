# Muse Forge — three-minute video concept

**Only shots backed by verified capability are included.** Today the generation and
screenshot-edit steps run through `muse exec` + a browser; the in-app preview/approval loop is
the 24-hour build gate. If that gate fails, record the fallback (Handover) instead.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Quick cuts: a sketch of a game, code, a screenshot, a bug report; a developer switching tabs | "Making a small game means jumping between an idea, code, art, and testing — and every new session starts by re-explaining what the game is." |
| 0:20–0:45 | Muse Forge project; prompt: "A colourful farmyard memory game for 4–7 year olds, touch and mouse, six pairs." Generate | "Describe the game. Muse writes a complete Phaser prototype into the project workspace." |
| 0:45–1:20 | Game loads in the preview; play: flip two cards, match a pair, mismatch flips back; score and moves update; resize to mobile | "It is playable immediately: matching, scoring, restart, touch and mouse, responsive layout." |
| 1:20–1:55 | Capture preview screenshot; attach it; type: "Bigger cards, sunset background, better victory animation." Diff appears; approve; preview refreshes | "Instead of describing the screen in words, you point at it. Muse reads the screenshot, finds the source, and proposes the change. You see the diff, then approve it." |
| 1:55–2:25 | End session. New session (zero history); memory panel shows audience, style, controls, difficulty; ask: "Add level 2, keep the design direction." | "The design decisions live in project memory, not the transcript. A fresh session extends the game while keeping the audience, style and controls." |
| 2:25–2:45 | Correct "mobile-first" → "desktop-first"; old memory shows superseded; regenerate; game still plays | "When a decision changes, the old one is superseded — not silently mixed with the new one." |
| 2:45–3:00 | Title card + evidence strip (test counts, real Muse) | "Muse Forge — describe it, play it, point at it, and keep it consistent. Built on Meta Muse." |

## Production rules

- Real inference only; show the actual generated game running.
- Rehearse the screenshot→edit→approve path; it is the longest model wait (14 calls, ~10 min in
  the experiment). Pre-generate the base game and record the edit live if needed — disclose it.
- Do not claim image generation (Muse Image is not configured here), asset pipelines, or a
  full visual editor; only the scoped loop described above.
- Keep the "superseded" memory state visible on screen for the correction beat.

---

## Phase 9 storyboard — the in-app MVP

This is the version the product now supports end to end. Times are real measured operations;
cuts are allowed for waits, but the recording must not imply instant generation.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00–0:20 | The Forge view, empty preview. Cut to a code editor, a terminal, and a browser tab side by side | "Making a small browser game means juggling code, a preview, screenshots and a chat window — and every new session starts by re-explaining the game." |
| 0:20–0:45 | Type the game description, click **Generate game**. Job card appears: running, calls and tokens counting | "Describe the game. Muse writes a single self-contained Phaser file into a staging copy — not the live project." |
| 0:45–1:10 | Staged badge appears, preview loads, play: flip cards, score moves, mismatch flips back, switch to mobile width | "It is playable immediately, with mouse and touch and a responsive layout. The badge says staged — this is not approved yet." |
| 1:10–1:40 | Click **Approve**; version v1. Click **Capture preview**; the screenshot thumbnail appears. Type the visual change request. Click **Generate change** | "Approve the first version. Then point at the screen: the game canvas is captured and attached to the request." |
| 1:40–2:00 | Diff panel: validation passed, `-`/`+` lines; click **Approve**; preview refreshes; v2 | "Muse proposes a source change. You see the diff and the validation result before anything is applied. Approve, and the preview updates." |
| 2:00–2:25 | New Forge project? No — stay: show approved versions, then **Undo last change** back to v1 | "Every approved version is preserved. One click restores the previous game — no Git required." |
| 2:25–2:45 | Re-open the project; show memory provenance in the job card ("2 project memories used") and the approval checkbox "Save the decision to project memory" | "Project decisions retrieved before each job shape the prompt; approval can save the decision, with provenance, for the next session." |
| 2:45–3:00 | Final gameplay shot + title | "Muse Forge: describe it, play it, point at it, keep what works." |

Production rules: record on a fresh database, run the real workflow once for the take, cut the
wait rather than fake it, and never claim Muse play-tested the game — the browser verification is
shown separately.
