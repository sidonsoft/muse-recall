# Muse Forge — feasibility report

Branch `experiment/muse-forge` from `79ac5a2`. All generation used real Muse
(`muse-wonder-1.0`, Muse Code 1.4.13). Artifacts: `experiments/muse-forge/game/`,
`docs/assets/muse-forge-*.png`.

## Experiment A — generate a playable game: **PASS (with caveats)**

- Prompt: single-file Phaser 3 game, 12 cards / 6 pairs, touch+mouse, score/moves, restart,
  win overlay, responsive, pastel farm background, no external assets
  (`/tmp/game-prompt.txt`).
- Result: `index.html`, 480 lines / 16,560 bytes, **7 model calls, 254,449 input tokens**,
  ~2 minutes.
- Verification: Muse ran `node --check` (OK); we independently extracted the inline script
  (`node --check` OK) and loaded it in Chrome via Playwright: canvas 1125×900, correct HUD
  ("Pairs: 0/6", "Moves: 0", Restart), 12 leaf-back cards, farm background, responsive at
  390×844. No JS errors (only a favicon 404).
- Manual interventions: none. Muse did **not** play-test; our browser check did.
- Not verified: an automated win-condition run (we flipped two cards but did not match all six).

## Experiment B — visual modification from a screenshot: **PASS (with caveats)**

- Input: the rendered screenshot (`muse-forge-before.png`) + text request (larger cards, sunset
  background, victory animation) + `--workspace` source access.
- Result: 480 → 560 lines (16,560 → 19,800 bytes), **14 calls, 636,379 input tokens**.
  Muse reported card area +32%, a 4-stop sunset gradient, and a staggered victory bounce;
  `node --check` OK.
- Browser: page loads, canvas renders, two cards flip, responsive at mobile size, no JS errors.
- Caveat: we did **not** visually confirm each requested change; `muse-forge-after.png` exists
  for human review. Muse itself did not browser-verify.
- This is genuine screenshot-conditioned editing: the model received the image and edited the
  matching source. No hand-written description was substituted.

## Experiment C — persistent creative memory: **PASS at retrieval + prompt level; PARTIAL for gameplay**

- Seeded six constraints in the real `MemoryEngine` (audience 4–7, farmyard style, Phaser CDN,
  touch+mouse, progressive difficulty, mobile-first).
- Retrieval for "add another level … platform and responsive layout" returned 3 memories
  including mobile-first.
- Correction (mobile-first → desktop-first) created a new memory with 1 history entry; the
  next retrieval **excluded the old id** and included the new one (desktop-first).
- The corrected memory block was injected into a real Muse coding prompt: the game grew
  19,800 → 26,260 bytes, contains Level 2 logic (3 mentions), `node --check` OK, page loads and
  renders.
- Caveats: retrieval selected 3 of 6 constraints (the block was not exhaustive); we did not
  play-test Level 2 or prove the layout is desktop-first beyond the prompt; the bridge from
  memory engine to Muse CLI is a prompt-assembly script, not the app's runtime.

## Experimental findings that matter

1. Muse is a capable but **expensive** generator: a trivial file cost 85k tokens; the game cost
   254k; a visual edit cost 636k. A product must cap iterations.
2. **No built-in browser verification** — preview/testing must be ours.
3. Image input is genuine; visual iteration is viable.
4. Memory influences code only if the retrieval block is injected into the coding prompt; the
   app currently injects it into chat turns, not into workspace edits.

## Gate results

| Gate | Result |
| --- | --- |
| 1. Capability verification | **PASS** |
| 2. Playable generation | **PASS** (no manual code fixes; win state unverified) |
| 3. Visual iteration | **PASS** via screenshot + workspace (no in-app editor yet) |
| 4. Persistent memory → code | **PARTIAL** (retrieval + prompt verified; gameplay effect unverified) |
| 5. Product selection | See `MUSE_FORGE_PRODUCT_COMPARISON.md` |
