# Muse Recall — three-minute demonstration script (Phase 14C recording clearance)

**Baseline:** `agent/phase14a-demo-production` at
`4d668bb047eceada02bd124d7f69cde44b3adbed`; seeded project `forge-demo` (`pnpm demo:seed`).
The modification segment uses **recorded authentic Phase 12A source via a labelled replay** so the
demo does not depend on live Muse availability. No paid Muse inference is performed without explicit
director authorisation.

**Spoken narration:** **358 words**, counted programmatically as whitespace-delimited tokens in the
narration quotes. Headings and operator instructions are excluded.

**Recording target:** **172 seconds (2:52)**, within the required 170–175 s. The playable game is on
screen from **0:17**, inside the first 20 seconds. The slowest segment is 2.44 words/second
(≈146 wpm); no segment requires unrealistic speaking speed.

**Measured context (do not inflate):** five real Phase 11A modification trials took 34.1–104.2 s
(mean 55.7 s, median 48.1 s). The A/B/C memory-influence trial was run **once per condition**.

**Cast:** Forge (preview → modify → review → approve → undo), Memories (decisions, correction
history), the authentic Phase 12A A/C evidence figure.

> **MANDATORY REPLAY DISCLOSURE — read before recording.** The modification, staged-diff, runtime
> and approve/rollback footage in this script is a **replay of previously generated source**, not a
> new Muse generation. The on-screen label is exactly:
> **“Replay of recorded Phase 12A Muse output.”**
> The seeded replay project retrieves **two** active memories (the child-safety constraint and the
> ocean decision). The original Phase 12A C generation retrieved **one** active memory (the ocean
> decision, `aceff9cf-0f0a-4cdf-9465-39e98ba8d423`). The replay job's memory ids and prompt hash
> describe **the replay**, not the original generation. Never show them as proof of the original
> Phase 12A output, and never imply that the child-safety constraint shaped the original C output.
> The replay demonstrates **staging, review, approval and rollback**; the A/C experiment demonstrates
> **authentic memory influence**. Keep those two claims separate.

---

## Timeline and spoken-word budget

| # | Segment | Time | Dur. | Spoken words | Words/s | On screen |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The problem | 0:00–0:17 | 17 s | 31 | 1.82 | Title card; no product UI yet |
| 2 | Playable approved game | 0:17–0:35 | 18 s | 34 | 1.89 | Forge → `forge-demo`, v1 running |
| 3 | Memory and correction history | 0:35–0:53 | 18 s | 33 | 1.83 | Memories: child-safety, sunset superseded, ocean active |
| 4 | Authentic A/C influence | 0:53–1:16 | 23 s | 51 | 2.22 | `11-memory-influence.png` with original provenance |
| 5 | Modification + replay label | 1:16–1:41 | 25 s | 61 | 2.44 | Replay footage; mandatory overlay starts at 1:16.0 |
| 6 | Staged diff | 1:41–1:53 | 12 s | 24 | 2.00 | Review panel unified diff; overlay continues |
| 7 | Runtime gate, accurately | 1:53–2:08 | 15 s | 36 | 2.40 | Validation state; overlay continues |
| 8 | Advisory Decision Guard | 2:08–2:23 | 15 s | 36 | 2.40 | Packaged labelled-mutation panel; switch label |
| 9 | Approve, then roll back | 2:23–2:40 | 17 s | 28 | 1.65 | Replay review; overlay returns at 2:23.0 |
| 10 | Closing value statement | 2:40–2:52 | 12 s | 24 | 2.00 | Title card and repository URL |
| **Total** | | **2:52** | **172 s** | **358** | **2.08 avg** | |

**Timeline arithmetic:** 17 + 18 + 18 + 23 + 25 + 12 + 15 + 15 + 17 + 12 = **172 s**. Segment
boundaries are contiguous and end at **2:52**.

## Exact replay-overlay timing

The Forge UI cannot display a replay provenance label, so the label **must** be added in video
editing. It is mandatory, not conditional on a viewer asking.

- **Overlay text:** `Replay of recorded Phase 12A Muse output.`
- **Style:** lower-third, white 24 pt-or-larger text on a 90%-opaque black bar, visible at 1080p.
- **Window 1:** **1:16.0 → 2:08.0** (segments 5–7: replay modification, replay-staged diff, actual
  runtime check on the replay-staged bytes).
- **Window 2:** **2:23.0 → 2:40.0** (segment 9: approval and rollback of the replay-staged source).
- **No gap:** the label must be present on every frame of replay footage. If the edit differs, keep
  these two windows aligned to the first and last replay frame rather than dropping the label.
- **Guard insert (2:08.0 → 2:23.0):** replace the replay label with
  `Labelled mutation — packaged evidence, not model output.` The guard panel is not replay footage.

---

## 0:00–0:17 — The problem

- **Narration:** “AI creative tools forget. You set a palette, a safety rule, a direction — and next
  session it is gone. You re-explain it, then find the model changed something you approved.”
- **On-screen:** Title card: *“An AI creative studio that remembers your decisions, checks its
  staged work, and keeps you in control.”*
- **Evidence:** none required (framing).
- **Duration:** 17 s. **Fallback:** pre-recorded title card.

## 0:17–0:35 — The playable game, immediately

- **Narration:** “This is Muse Forge, Muse Recall's game studio. It has an approved game — a real
  Meta Muse Spark generation, version one. Everything here edits this approved source; it is not a
  fresh generation.”
- **On-screen:** Forge → `forge-demo`. The Phaser game is already playable (press Start, flip a
  card). Show `approved: v1`.
- **Evidence:** seeded `demo/forge-baseline/index.html` (recorded real generation, sha pinned in
  `docs/hackathon-evidence/phase14a/demo-seed.json`).
- **Duration:** 18 s. **Fallback:** `screenshots/01-forge-v1-preview.png`.

## 0:35–0:53 — Persistent memory and correction history

- **Narration:** “The project remembers. A child-safety constraint with provenance and scope. And a
  palette I reconsidered: the sunset decision stays audited but superseded, with my correction
  reason. Only the corrected ocean decision is active.”
- **On-screen:** Memories → child-safety detail (content, verified, project scope). Then the sunset
  entry: status **superseded**, **SUPERSEDED BY** the ocean decision, history shows the correction
  reason. Lower-third: `Seeded project — two active memories: ocean + child-safety`.
- **Evidence:** live deterministic UI; `screenshots/02-memories-list.png`,
  `03-constraint-detail.png`, `04-palette-supersession.png`; seed record `demo-seed.json`.
- **Duration:** 18 s. **Fallback:** the three screenshots, pre-loaded.

## 0:53–1:16 — Authentic A/C memory influence (the centrepiece)

- **Narration:** “The centrepiece: authentic memory influence in Phase 12A's original trial —
  one model, one request, three conditions — the sunset decision drew the sunset accent. With no
  memory, neither appeared. After correction, C retrieved one active memory, the ocean decision, and
  drew the ocean accent; the superseded sunset hex appears nowhere.”
- **On-screen:** `screenshots/11-memory-influence.png`: A, B and C side by side, with the memory
  texts and accent values (`0xFF7E5F` vs `0x4EA8DE`) and rendered coverage. Provenance lower-third:
  `Authentic Phase 12A output. C job 6a246238…; memory aceff9cf… (ocean only); prompt sha256 cc3a396…`
  and `One run per condition — directional, not statistical. The remembered dark text colour was not applied.`
- **Do not** show the replay job's ids or hash in this segment. The original C run retrieved one
  memory; the child-safety constraint was **not** part of that generation.
- **Evidence:** authentic Phase 12A output: `docs/hackathon-evidence/phase12/{A,B,C}-v2.html` and
  screenshots; measurements in `phase12/pilot.json`; summary in
  `phase14a/memory-influence.json`. Original C job: `6a246238-4066-4b68-b091-1ab1e0a8a7d8`;
  `prompt_sha256` `cc3a3967cfacd9d83e7f007708d1609040c2762f0adc256d9db6bba930c4b8a2`.
- **Duration:** 23 s. **Fallback:** the figure itself is the primary asset; it is static.

## 1:16–1:41 — Modification workflow, labelled as replay

- **Narration:** “Now a change. I capture the preview and ask Muse to add a Next Level button beneath
  Restart. Muse edited the approved source; the job recorded retrieved decisions and a prompt hash.
  This is a replay of recorded Phase 12A Muse output. It shows staging, review, approval and
  rollback — not the original generation; its ids and hash describe this replay.”
- **On-screen:** Start the replay under the mandatory overlay
  **“Replay of recorded Phase 12A Muse output.”** at **1:16.0**. The job is a deterministic replay of
  the recorded C bytes, not a new generation; keep the overlay on through its progress and then cut
  to **window A**, where the review was staged before recording (see
  [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) §6a). The UI cannot reopen an earlier job, so keep window A on
  Forge. Job card: replay memory ids, replay prompt hash, validation passed — **do not** frame the
  replay hash as proof of the original 12A generation.
- **Evidence:** recorded authentic Phase 12A C source (`docs/hackathon-evidence/phase12/C-v2.html`,
  sha256 `26c6a534…bd823f`) transported by the fake-Muse fixture. Original generation provenance:
  job `6a246238…`, one memory `aceff9cf…`, prompt sha `cc3a396…`. Replay job `63835e4b…` retrieved
  `981df37d…` and `8f3f36b7…` with prompt sha `11be307…`; those values describe the replay only.
- **Duration:** 25 s. **Fallback:** the recording is the primary path; never substitute fake-mode
  output for model output.

## 1:41–1:53 — The staged diff

- **Narration:** “The result is a small diff against the approved game — a few lines, not a
  rewritten file. Nothing is promoted until I approve.”
- **On-screen:** Review panel: unified diff, `validation passed`, action buttons. Replay overlay
  remains visible.
- **Evidence:** same replayed authentic C source; Phase 11A trials changed 1.2–10.1% of lines.
- **Duration:** 12 s. **Fallback:** `screenshots/08-review-compliant.png`.

## 1:53–2:08 — The actual approval gate

- **Narration:** “Before promoting, Muse Forge launches the build in headless Chrome and rejects
  builds that throw on load or fail to create a canvas. Load-time only: it does not play the game,
  inspect pixels, or test mechanics.”
- **On-screen:** The review panel's validation state; optionally scroll to the diff. This is the
  **actual** runtime verification, executed on the replay-staged bytes at approval time — not a
  screenshot and not a gameplay test. The replay overlay remains visible because the staged bytes
  are replayed source. Do **not** show a fabricated “runtime screenshot” — the UI exposes no
  verification image.
- **Evidence:** `apps/server/src/forge/runtime-check.ts`; `pnpm verify:runtime` (valid passes,
  broken rejected, unapproved network origin blocked).
- **Duration:** 15 s. **Fallback:** narration over `08-review-compliant.png`.

## 2:08–2:23 — Advisory Decision Guard, honestly (~15 s)

- **Narration:** “An advisory guard checks source patterns against remembered decisions. On this
  labelled mutation, it flags a countdown timer and a mistake penalty, citing my child-safety
  decision. It does not block approval; it is not compliance verification.”
- **On-screen:** The packaged labelled-mutation panel: **VIOLATION DETECTED**, two findings with the
  decision reference and evidence excerpt, “Findings do not block approval in this version.” Replace
  the replay overlay with `Labelled mutation — packaged evidence, not model output.` State that the
  panel is packaged evidence from the labelled mutation, which is a labelled test edit, not
  spontaneous model output. Do not approve it; return to the staged authentic review.
- **Evidence:** `screenshots/05-guard-advisory-mutation.png`, `06-review-mutation.png`,
  `guard-advisory.json`; source label at
  `docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html`.
- **Duration:** 15 s. **Fallback:** the panel screenshot.

## 2:23–2:40 — Approve the authentic recorded source, then roll back

- **Narration:** “On the authentic source, the decision is mine: approve — it becomes version two —
  then one click rolls back to version one, its parent. History stays intact.”
- **On-screen:** Restore the replay overlay at **2:23.0**. Optionally flash the packaged
  `07-rejected-mutation.png` to show the rejection, then return to window A: approve → `approved: v2`
  → click **Undo last change** → `approved: v1`. This is authentic Phase 12A C source and an
  authentic approval/rollback of that source; the transport is a replay.
- **Evidence:** live deterministic UI (approval of already-generated source needs no model call);
  `screenshots/07-rejected-mutation.png`, `09-approved-v2.png`, `10-rolled-back-v1.png`; rollback
  regression in `rollback-ancestry.json` (undo restores the recorded parent, not the array
  neighbour).
- **Duration:** 17 s. **Fallback:** the three screenshots.

## 2:40–2:52 — Closing

- **Narration:** “Muse Recall: your decisions survive, visibly shape what Muse builds, and every
  change stays reviewable, reversible, and yours. Memory you can prove and control.”
- **On-screen:** Title card with project name and repository URL. Remove all replay overlays; do not
  imply the closing card is model output.
- **Duration:** 12 s. **Fallback:** none needed.

---

## Evidence limitations carried into the recording

1. **A/C:** one run per condition (n = 1); directional, not statistically significant. Accent
   selection was observed; the remembered dark text colour was not applied. State this on screen in
   segment 4.
2. **Replay:** the replay retrieves two active memories and has different ids/hash from the original
   C generation. It demonstrates workflow, not original causation. The mandatory overlay and the
   provenance split above carry this limitation.
3. **Runtime gate:** load-time only — page errors and canvas creation. It does not play the game,
   inspect pixels, test every mechanic, or prove later interactions cannot crash.
4. **Decision Guard:** advisory only; source-pattern checks, five rule families; never blocks
   approval and is not compliance verification. The demonstration is a labelled mutation.
5. **Video:** no demo video exists in this repository. This script is recording-ready; the operator
   creates the file on demo day and must not claim footage before it exists.

## Provenance of the packaged Phase 14A screenshots

The `docs/hackathon-evidence/phase14a/screenshots/` captures were produced in **deterministic
rehearsal mode**: the API ran with `MODEL_PROVIDER=echo` and the fake-Muse fixture transported
recorded bytes. The game content and memory rows are authentic artifacts; the provider panel
honestly shows the offline adapter. Do not present these screenshots as a live Muse session. The
authentic A/C figure (`11-memory-influence.png`) **is** real Phase 12A model output and is labelled
as such.

## Recording checklist (Phase 14C)

1. **Replay caption:** add `Replay of recorded Phase 12A Muse output.` at 1:16.0–2:08.0 and
   2:23.0–2:40.0; verify it is visible on every replay frame.
2. **Original A/C provenance:** in segment 4, show the original Phase 12A C job id, the single
   memory id `aceff9cf…`, and prompt hash `cc3a396…`; state n = 1 and the unapplied text colour.
3. **No misleading prompt-hash shot:** never place the replay prompt hash
   (`11be307…`) beside “proof”, “original”, or the A/C figure; it describes the replay only.
4. **Guard mutation disclosure:** keep the labelled-mutation banner and the
   `Labelled mutation — packaged evidence, not model output.` overlay visible; say “advisory” and
   “does not block approval”.
5. **Correct approval and rollback footage:** approve the authentic recorded C source, not the
   mutating test build; roll back to v1, the recorded parent, and keep the overlay on.
6. **No visible API keys:** no `.env`, key values, terminal history, or provider headers on screen;
   confirm with a final frame-by-frame check.
7. **Final video duration:** 170–175 s; the 14C edit target is 172 s (2:52), with 358 spoken words.

If a run fails, re-run and re-record. Never edit model output, re-stage bytes, or present the
labelled mutation as authentic model output.
