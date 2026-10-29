# Focused demo — correctable project memory

**Purpose:** a short submission demo for the strongest supported contribution: correctable
project memory connected to a reviewable software-building workflow.
**Length:** 2:50.47 (final cut), including a separate evidence card.
**Audience:** hackathon judges who have not used the product.
**Status:** **recorded 29 October 2026.** The cut is a continuous live screen recording
(1920×1080, 2:50) with a visible cursor, speed-ramped generation waits, and insert cards for
memory, Guard and evidence. The voice describes the palette by name and reads results as “one of
sixty.” The video is kept **out of git** by policy; QA is kept alongside the video, outside git.
The pre-recording storyboard below is retained as the plan. The recorded cut added a
repeat-request beat where Guard flags the stale palette, then a theme request that lands ocean.

The demo uses the palette pair from the authentic Phase 12A trial, where the same request was
run with a sunset constraint active (A) and with the ocean constraint superseding it (C). The
screenshots and sources for those runs already exist. They are evidence inserts, not footage
of a new live run.

---

## 1. The constraint and the correction

**Saved constraint (initial):**

> Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and
> #2D1E2F for dark text. Avoid aggressive neon colours.

**Correction (replacement requirement):**

> Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.

**Correction reason (recorded in history):**

> Creative direction changed from a warm sunset mood to a cool ocean mood.

These are the Phase 12A and demo-seed texts. The correction is a **replacement requirement**
(use ocean, not sunset), not a request to make an optional feature available. Phase 17's
correction was different: it **released** restrictions without naming a replacement. This demo's
replacement pair is Phase 12A evidence, one run per condition. Use a **fresh project with this
palette decision only** for the live take; other decisions would add Guard checks and complicate
the before/after comparison.

**Why this pair:** the outcome is visible in the preview (button colour) and testable in the
source (the sunset hex before, the ocean hex after, no sunset hex after). The Decision Guard has
a supported `superseded-palette` rule for exactly this comparison. Phase 12A recorded the same
request under both decisions: A's `Next Level` button is sunset; C's is ocean. Phase 12A used a
Phaser build, so its source writes `0xFF7E5F` / `0x4EA8DE`; a new inline-CSS app may write
`#FF7E5F` / `#4EA8DE`, in either case. Accept all four forms.

---

## 2. Storyboard (pre-recording plan)

| # | Time | On screen | Action | Narration cue | Evidence status |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:16 | HTML Studio, empty project memory | Problem line; open **Add decision**, paste the sunset constraint, **Save decision** | "Every session, you restate requirements…" | **RECORD** (UI only; no model) |
| 2 | 0:16–0:30 | Generation prompt and staged preview | Prompt: build a simple farm-animal memory game with a Restart button and no level controls yet; generate; approve v1 | "Muse Spark writes one index.html…" | **RECORD** (live Muse) or use the authentic recorded v1 baseline with an on-screen "recorded baseline" label |
| 3 | 0:30–0:48 | New Studio session, empty request field | "Add a Next Level button beneath the Restart button." Submit; show job running, then staged | "A new session, no request history…" | **RECORD** (live Muse) |
| 4 | 0:48–1:04 | Project memory rail, **Preview**, **Source**, **Changes**, **Review** | Show the sunset decision marked supplied; show the sunset hex (`#FF7E5F` or `0xFF7E5F`, any case) in staged source; show orange button; show Guard `NOT VERIFIED` (palette rule needs a correction); reject | "Guard's palette rule needs a correction…" | **RECORD** (UI) + **AVAILABLE** [`A-v2-visible.png`](../hackathon-evidence/phase12/A-v2-visible.png), [`A-v2.html`](../hackathon-evidence/phase12/A-v2.html) |
| 5 | 1:04–1:24 | Memory Inspector | Open the sunset decision → **Correct** → enter ocean text and reason → **Supersede with correction**; show old `superseded`, new `active`, **Superseded by**, history; show retrieval explainer excludes the old id | "The old record stays in history; the new one is active." | **RECORD** (UI writes only) / **FIXTURE** end state via `pnpm demo:seed` |
| 6 | 1:24–1:41 | New staged change | Repeat the same request; show ocean decision supplied; show the ocean hex (`#4EA8DE` or `0x4EA8DE`, any case), no sunset hex, blue button; show Guard `NO VIOLATION DETECTED · SUPPORTED CHECKS` | "Now the source uses the ocean hex…" | **RECORD** (live Muse) + **AVAILABLE** [`C-v2-visible.png`](../hackathon-evidence/phase12/C-v2-visible.png), [`C-v2.html`](../hackathon-evidence/phase12/C-v2.html) |
| 7 | 1:41–1:54 | Review rail and version history | Read the diff, approve v2; show v1/v2 history and the rollback control; do not roll back | "v1 stays in history; rollback can restore it." | **RECORD** (UI) + **AVAILABLE** Phase 12A approval/rollback record in [`pilot.json`](../hackathon-evidence/phase12/pilot.json) |
| 8 | 1:54–2:15 | Evidence card | Hold on the Phase 17 arm table and the Phase 12A replacement note; no UI action | "Phase 17's correction only released restrictions…" | **BUILD FROM EXISTING EVIDENCE** (Phase 17 results and Phase 12A stills); no new model footage |

**Editing note:** cut generation and modification latency. Show the job completing, not the
wait. Hold the evidence card long enough to read the denominator and the Phase 12A distinction.
The closing narration is deliberately split so the evidence card is not competing with the
Review rail.

---

## 3. Narration (pre-recording plan)

> AI builders are fast at the first draft, weak at the second week. Every session, you
> restate requirements. A change forgets one, and the regression shows up later. Change your
> mind, and the old preference can keep coming back.
>
> This is **Muse Recall**, a local-first HTML Studio for Muse Spark. I save one constraint: a
> sunset palette, accent `#FF7E5F`, dark text `#2D1E2F`, no neon. I generate a simple memory
> game and approve v1.
>
> Now a new Studio session, no request history. I ask only: *"Add a Next Level button beneath
> the Restart button."* Recall retrieves the sunset decision; preview and source show the orange
> accent. The job records the decision. Guard's palette rule needs a correction, so it says
> **not verified** — not a pass. I reject this staged change.
>
> In Memory, I correct the decision to the ocean palette, `#4EA8DE` with `#102A43`. The old
> record becomes **superseded**; the new one is active. One transaction, not an edit.
>
> I run the same request. Recall supplies ocean, not sunset. The source uses the ocean hex and
> no sunset hex; the button is blue. Guard's supported palette check now reports **no violation
> detected** — not a certificate.
>
> I approve v2. v1 stays in history; rollback can restore it. Phase 17's correction only
> released restrictions; the sunset-to-ocean **replacement** is Phase 12A, one run per
> condition. Phase 17 cut original-rule violations from 37/57 to 0/58 on Spark and 49/60 to
> 1/60 on Spark Open; it matched retyping. Six fixed tasks, not general correctness. Persistent
> memory is not new; correctable, reviewable memory is the point.

Word count: 260. At ~145 words per minute this is about 1:48, leaving ~27 seconds for source
reading, pauses and the evidence card inside 2:15.

---

## 4. What is already available

Use these as evidence inserts, never as footage of the new sequence unless the new run actually
reproduces them.

| Asset | What it shows | Status |
| --- | --- | --- |
| [`A-v2-visible.png`](../hackathon-evidence/phase12/A-v2-visible.png) | The same request under the sunset constraint; orange **Next Level** button | Authentic Phase 12A output, screenshot captured after approval |
| [`C-v2-visible.png`](../hackathon-evidence/phase12/C-v2-visible.png) | The same request under the corrected ocean decision; blue **Next Level** button | Authentic Phase 12A output |
| [`A-v2.html`](../hackathon-evidence/phase12/A-v2.html) / [`C-v2.html`](../hackathon-evidence/phase12/C-v2.html) | `0xFF7E5F` in A; `0x4EA8DE` in C; no sunset hex in C. Phase 12A is a Phaser build; a new inline-CSS app may use `#`. Compare both notations, case-insensitively. | Authentic model output |
| [`pilot.json`](../hackathon-evidence/phase12/pilot.json) | Prompt hashes, memory ids, approval, runtime check, rollback for A/B/C | Authentic run records |
| `pnpm demo:seed` | Project `forge-demo` with v1 and three decisions, including sunset superseded by ocean | Deterministic fixture using the production memory engine and a recorded real baseline |

The Phase 12A conditions are **separate runs**, not one live project with an in-app correction.
The pre-recording plan's S1/S4–S7 UI actions were recorded live; S2/S3/S6 model calls were
live Muse. The Phase 12A stills remain evidence inserts from separate runs.

---

## 5. Deterministic fixture path (no model call)

This is the only path that can be run without Muse. It is a **fixture demonstration**, not a
live generation.

```bash
mkdir -p /tmp/mrl-demo-fixture
DATABASE_PATH=/tmp/mrl-demo-fixture/demo.db \
WORKSPACE_ROOT=/tmp/mrl-demo-fixture/ws \
pnpm demo:seed

DATABASE_PATH=/tmp/mrl-demo-fixture/demo.db \
WORKSPACE_ROOT=/tmp/mrl-demo-fixture/ws \
MODEL_PROVIDER=echo pnpm dev
```

Open <http://127.0.0.1:5173>, select project **Muse Recall demo** (`forge-demo`).

**What it demonstrates:**

- Three project decisions created through the production engine: a child-safety constraint, a
  sunset palette decision marked `superseded`, and the ocean replacement marked `active`.
- The supersession chain and history in Memory.
- v1 in version history and the review rail.

**What it does not demonstrate:**

- Saving a new constraint from the Studio form (the seed already created it).
- A live Spark generation or modification.
- The correction being performed in the UI (the seed already performed it).
- The staged source using the ocean accent. The seeded v1 is the recorded baseline, not a new
  generation under the active decision.

If using this path, label it on screen: **"Deterministic fixture — no model call; recorded v1
baseline."** Do not narrate it as a live run.

---

## 6. Live recording path (executed for the recorded cut)

This path was executed on 29 October 2026 with `muse-spark-1.3-contributor` at `high` effort.
The current cut is a continuous screen recording with insert cards, not a screenshot-only slideshow.

**Configuration.** Use an isolated database, workspace, port and browser profile. Set an
explicit Forge model; do not rely on the `.env.example` default. Forge is **project-scoped**:
"new session" in the narration means a fresh page load with no request history, not a chat
session. The memory persists in the project database, not in browser state.

```bash
export DATABASE_PATH=/tmp/mrl-demo-live/demo.db
export WORKSPACE_ROOT=/tmp/mrl-demo-live/ws
export MODEL_PROVIDER=muse-cli
export FORGE_MUSE_MODEL=muse-spark-1.3-contributor
export FORGE_REASONING_EFFORT=high
export FORGE_RUNTIME_BROWSER=managed
pnpm dev
```

Check the Studio header shows the configured model before recording. If the default ports are
occupied, use isolated ports and matching `CORS_ORIGINS` / `VITE_PROXY_TARGET`; do not disturb
another running instance.

**Prompts, verbatim:**

1. Save decision (type **Constraint**):
   > Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and
   > #2D1E2F for dark text. Avoid aggressive neon colours.
2. Generate:
   > Build a simple one-screen farm-animal memory match game in a single HTML file, with a
   > Restart button and no level controls yet. Use inline CSS and JavaScript only.
3. First modification (new Studio session):
   > Add a Next Level button beneath the Restart button.
4. Correction (Memory Inspector):
   > Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.
   >
   > Reason: Creative direction changed from a warm sunset mood to a cool ocean mood.
5. Second modification (same request as 3):
   > Add a Next Level button beneath the Restart button.

**Generation gate (S2).** v1 must use the stored sunset accent in `#` or `0x` notation, in any
case (`#FF7E5F`, `#ff7e5f`, `0xFF7E5F`, `0xff7e5f`). If it does not, the constraint was not
applied; stop, re-run, or use the recorded baseline with a visible label. Do not add the accent
by hand.

**Expected checks:**

| Check | Before correction (S4) | After correction (S6) |
| --- | --- | --- |
| Retrieved decision | Sunset decision id in the job's `memory_ids` | Ocean decision id supplied; sunset id absent |
| Staged source | Sunset hex present in either notation, any case | Ocean hex present and sunset hex absent in both notations, any case |
| Preview | Orange Next Level button | Blue Next Level button |
| Guard | `NOT VERIFIED` — "palette decision is not a correction; superseded history unknown" | `NO VIOLATION DETECTED · SUPPORTED CHECKS` with `superseded-palette`; zero findings; not a certificate |
| Review | Staged, rejected; v1 unchanged | Staged, approved as v2; v1 remains in history |
| Version | — | v2 current, `can_rollback: true`; rollback target is v1 |
| Job record | `prompt_sha256`, `memory_ids`, `base_version` | Same, with the corrected decision and no old id |

If a check does not reproduce, stop and report the deviation. Do not edit the footage to imply
it did.

---

## 7. Recording checklist

- [ ] Isolated database, workspace and ports; no reuse of research or demo data.
- [ ] Explicit `FORGE_MUSE_MODEL` and `FORGE_REASONING_EFFORT`; header checked.
- [ ] Constraint and correction texts pasted verbatim; check both `#` and `0x` notation, case-insensitively.
- [ ] Sunset job staged and rejected, not approved.
- [ ] Correction shows `superseded` → `active`, `Superseded by`, and history.
- [ ] Ocean job shows the source hex in either notation and the preview colour.
- [ ] Before locking the voice-over, confirm the live flow shows `NOT VERIFIED` before the
      correction and `NO VIOLATION DETECTED · SUPPORTED CHECKS` after it. If the labels differ,
      change the narration, not the footage.
- [ ] Guard wording is "advisory", "supported checks", "not compliance certification".
- [ ] Version history shows v1 and v2; rollback is described, not implied to have run unless it
      is actually run.
- [ ] On-screen label for any deterministic fixture or recorded-baseline insert.
- [ ] Captions include the exact counts and the phrase "six fixed tasks, not general
      correctness."
- [ ] No claim that the correction percentages mean the model followed a replacement requirement.
- [ ] No paid inference beyond the recording session; no research evidence modified.

---

## 8. What not to claim

- **Not** "persistent memory is unprecedented." The contribution is the integration.
- **Not** "the corrected arm followed a replacement requirement." The detector measures the
  original rule; the rise suggests the superseded restriction was released. Phase 17's correction
  was permissive; the sunset-to-ocean replacement is Phase 12A, one run per condition.
- **Not** "Decision Guard enforced / blocked / certified anything." It is advisory and does not
  block approval.
- **Not** "Phase 17 proves general application correctness, runtime safety or transfer."
- **Not** "the app supports arbitrary providers in production." Only the Muse Code CLI and the
  deterministic `echo` provider are implemented; the open model was research-only.
- **Not** "this is a live run" when showing the seeded fixture or a Phase 12A still.

## 9. Recorded cut (29 October 2026)

**File:** `Muse_Recall_Demo_V21_1080p.mp4` (the V21 cut). Kept out of git by policy and not
linked from the repository; **upload pending**.
**Duration:** 170.47 s (2:50.47) · 1920×1080 · 30 fps · H.264/AAC. **Voice:** ElevenLabs George;
377 words.
**SHA-256:** `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308` · 12,721,832 bytes.
**Captions:** sidecar `Muse_Recall_Demo_V21.srt`, 36 cues; burned in. **QA:** `V21_QA.md`,
contact sheet and poster are kept alongside the video, outside git.

| Approx. time | Beat |
|---|---|
| 0:00 | New intro: the second week is the hard part |
| 0:08 | Problem statement; live Studio montage |
| 0:25 | Save the sunset constraint; generate; approve v1 |
| 0:43 | New session; request Next Level; sunset source; Guard `NOT VERIFIED`; reject |
| 0:58 | Correct the decision to ocean; sunset superseded, ocean active |
| 1:13 | Repeat the Next Level request; sunset remains; Guard flags `superseded-palette`; reject |
| 1:31 | Ask for the current art direction from memory; ocean source; Guard `NO VIOLATION DETECTED · SUPPORTED CHECKS` |
| 1:49 | Approve v2; version history v1/v2 |
| 1:58 | Phase 17 evidence card, with the Phase 12A replacement distinction |
| 2:32 | Limits card; closing brand card |

**What the live run showed:** the repeat feature request still used the old sunset palette, and
the advisory Guard caught it. Only the explicit theme request — using the active decision from
memory — produced the ocean version. The cut keeps that failure and recovery; it does not claim
the correction applied itself. The narration describes the palette by name instead of reading
hex codes, and speaks the result counts as “thirty-seven of fifty-seven,” “zero of fifty-eight,”
“forty-nine of sixty,” and “one of sixty.” The closing limits page separates what the demo
supports from what it does not.
