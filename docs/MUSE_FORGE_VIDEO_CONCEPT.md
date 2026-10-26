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
