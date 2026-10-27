# Muse Recall — demo runbook (Phase 14A)

**Demo branch:** `agent/phase14a-demo-production`
**Release candidate base:** `agent/phase12e-release-hardening` at
`156c65c9a55833e00f6764f4fee20d93eec17e49`
**Submission docs:** cherry-picked commit `84e6a8c` (docs only; no production files changed).

Everything below is taken from scripts in `package.json` on this branch and from the Phase 14A
rehearsal evidence (`docs/hackathon-evidence/phase14a/`). No live Muse inference was run while
preparing Phase 14A; every recorded Forge case uses already-recorded bytes.

> **Authenticity rule.** The seeded v1 game is a recorded real `muse-spark-1.3-contributor`
> generation. The A/B/C memory-influence screenshots are authentic Phase 12A model output. The
> guard demonstration uses a **labelled deterministic mutation** of authentic source and is never
> presented as spontaneous model output. The rehearsal screenshots come from the deterministic
> transport fixture; they are labelled as such wherever they appear.

## 0. Where to run the demo

```bash
git clone https://github.com/sidonsoft/muse-recall.git
cd muse-recall
git checkout agent/phase14a-demo-production
pnpm install
```

This branch is the release candidate **plus** the submission documents, the Phase 14A fixes, the
demo seed and the evidence. Do not run the demo from the Phase 13 documentation branch — it does
not contain the Forge product code.

## 1. Required environment

| Requirement | Value / check | Source |
| --- | --- | --- |
| Node.js | ≥ 24 | root `package.json` `engines` |
| pnpm | 10.32.1 (`corepack enable`) | root `package.json` `packageManager` |
| Google Chrome | installed (runtime verification launches `channel: 'chrome'`, headless) | `apps/server/src/forge/runtime-check.ts` |
| Muse CLI | only for a live run: `muse` on PATH, logged in with the Meta subscription | `MODEL_PROVIDER=muse-cli` default |
| Network | the preview and runtime check load Phaser from `https://cdn.jsdelivr.net` | CSP + runtime allowlist |

## 2. Secret handling (read before demo day)

- No API keys are stored in the repository. `.env` is git-ignored; only `.env.example`
  (placeholders) is tracked.
- Optional keys are passed via environment only: `FORGE_MUSE_API_KEY` (forced primary),
  `FORGE_FALLBACK_API_KEY` (quota fallback), `MUSE_FALLBACK_API_KEY` (chat-side fallback). Export
  them in a private shell; never type values into slides, terminal screenshots or the runbook.
- The key never travels in command-line arguments (it is written to the CLI's stdin), and server
  logs/errors pass through `redactSecrets`.
- One historical test-fixture key was found in old history, removed from the tree, and rotated on
  2026-10-27; the old value is invalid.
- Pre-demo check: `git grep -l "meta_[A-Za-z0-9]" -- ':!*.example'` must not return a real value,
  and `.env` must not be staged.

## 3. Startup

Use one consistent `DATABASE_PATH` and `WORKSPACE_ROOT` for the seed and the server. Both accept
absolute paths; relative values resolve against `apps/server` for the seed **and** the server, so
they always agree.

```bash
export WORKSPACE_ROOT=/tmp/forge-demo-ws
export DATABASE_PATH=/tmp/forge-demo.db

pnpm demo:seed        # v1 game + the three remembered decisions
pnpm dev:server       # API on http://127.0.0.1:8787
pnpm dev:web          # web client on http://127.0.0.1:5173 (strictPort)
```

If ports are taken, the verified override pattern is:

```bash
PORT=8899 DATABASE_PATH=… WORKSPACE_ROOT=… pnpm dev:server
VITE_PROXY_TARGET=http://127.0.0.1:8899 pnpm --filter @mml/web exec vite --port 5199
# Vite forwards the browser Host header (changeOrigin=false), so the API accepts
# the local web origin in addition to its own port.
```

Sanity checks: `GET http://127.0.0.1:8787/api/health` → 200, and the web client loads.

## 4. Seed data

`pnpm demo:seed` performs two things in one command:

1. **Workspace** — writes project `forge-demo` as **version 1** from
   `demo/forge-baseline/index.html`, a recorded real `muse-spark-1.3-contributor` generation
   (sha256 `79c9d67a…9ba9e41`), and records that hash in `state.json`.
2. **Memory** — uses the production memory engine (`create` + transactional `correct`) to store:
   - the child-friendly design **constraint**: *“This children’s game must avoid flashing effects,
     countdown timers, and penalties for mistakes.”* (active, verified),
   - the initial **sunset palette** decision (verified, then superseded),
   - the corrected **ocean palette** decision (*primary accent `#4EA8DE`, dark text `#102A43`*),
     which supersedes sunset with the audit reason “Creative direction changed from a warm sunset
     mood to a cool ocean mood.”

There is no manual database editing and no manual memory entry. The command prints the ids and
statuses; the evidence record is `docs/hackathon-evidence/phase14a/demo-seed.json`.

Re-running is safe and idempotent: memory rows are found by exact content across active and
superseded status, a consistent seed adds nothing, and `state.json` is byte-identical. The
workspace is reset to v1 (any demo v2+ is discarded), which is the documented recovery path.

## 5. Browser entry point

Open **http://127.0.0.1:5173** → sidebar **Forge** → project **`forge-demo`**.
Memory screens: sidebar **Memories** (active/superseded decisions, provenance, history).

## 6. Demo sequence (recorded-inference-first)

### 6a. Pre-stage the authentic review (do this before recording)

The Forge UI shows the **current** job review only; it cannot reopen an earlier job's diff. Do not
navigate away from Forge after staging the authentic modification, or the review state is lost.
Navigating away from Forge unmounts the review, so use two windows:

- **Window A (review):** open Forge → `forge-demo`, run the authentic modification — live with
  director authorisation, or by replaying the recorded authentic C bytes with the fake-Muse fixture
  in `copy` mode — and **leave the review open**. Do not touch window A until the modification
  segment.
- **Window B (stage):** the same app, used for the opening game shot, the memory/decision segment
  and (optionally) the A/C figure. At 1:15, switch to window A.

For a deterministic replay of the authentic C modification, start the API with the recorded bytes
instead of the live CLI (this is a replay, not a model call):

```bash
FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" FAKE_MUSE_MODE=copy \
FAKE_MUSE_HTML="$PWD/docs/hackathon-evidence/phase12/C-v2.html" pnpm dev:server
```

Then:

1. Show the staged authentic review in window A (job card, diff, validation).
2. For the guard segment, show the **packaged** labelled-mutation panel
   (`screenshots/05-guard-advisory-mutation.png`). It is a real production-pipeline capture of the
   labelled mutation; state that it is packaged evidence, and do not imply it was generated live in
   this session.
3. Return to window A and approve the authentic modification, then undo.

Trying to stage the mutation as well in the same deterministic session does not work: the fixture's
recorded source is fixed at server start, and a restart discards the in-memory job registry. The
packaged panel is the reliable path. In
deterministic replay mode the authentic review is a replay of recorded bytes, not a new model run;
say so if anyone asks. The recorded footage is authentic; the transport is deterministic.

Follow [DEMO_SCRIPT_3MIN.md](DEMO_SCRIPT_3MIN.md). UI checkpoints:

1. **Forge → `forge-demo`** — the playable Phaser game runs immediately; version badge **v1**.
2. **The problem** — name the forgotten-decision failure mode (narration only).
3. **Memories** — show the child-safety decision (content, rationale, project scope, provenance)
   and the palette history: the sunset decision is marked **superseded**, the ocean correction is
   **active**, and the correction reason is in the append-only history.
4. **Memory influence** — show the authentic Phase 12A A/C evidence
   (`docs/hackathon-evidence/phase14a/screenshots/11-memory-influence.png`): sunset memory drew
   `0xFF7E5F`, the corrected ocean memory drew `0x4EA8DE`, the no-memory control drew neither.
5. **Modify** — play the pre-recorded authentic modification (window A already holds its staged
   review from §6a). The job record shows retrieved memory ids and the prompt hash.
6. **Staged diff** — a small unified diff against the approved source, not a regenerated file.
7. **The actual approval gate** — the app **does not** play the game interactively at approval
   time. *“Before promoting a change, Muse Forge launches it in headless Chrome and rejects builds
   that throw on load or fail to create a canvas.”* It does not test gameplay, rendered pixels or
   later interactions, and it produces no verification screenshot.
8. **Advisory Decision Guard** — show the packaged labelled-mutation panel and the finding citing
   the remembered child-safety decision and the offending source line. State plainly that this is a
   labelled test mutation, that the check is advisory, that it never blocks approval, and that it is
   a source-pattern check — not compliance verification.
9. **Approve** — return to window A's authentic compliant modification and approve it; it becomes
   **v2**.
   Nothing is promoted without the human decision; saving to memory requires a user-written
   decision (the model's summary is never used).
10. **Roll back** — one click restores **v1**, the recorded parent of the current version (not
    simply the previous array entry). The version badge and job history remain consistent.

Do **not** approve the intentionally violating build during the primary demonstration.

## 7. Expected UI states (what “healthy” looks like)

| Screen | Expected |
| --- | --- |
| System | API reachable; provider/model shown (never a key). With `MODEL_PROVIDER=echo` the provider is honestly labelled “Deterministic offline provider (not a model)”. |
| Forge project | v1 preview playable; Modify input enabled; `approved: v1`. |
| Running job | progress; a rehearsal job finishes in about a second, a real Muse job in ~35–105 s; hard budget `FORGE_MAX_RUNTIME_MS` default 600 s, call budget 25. |
| Review | diff + `validation passed` + `Decision Guard — Advisory`; Approve enabled. |
| Runtime failure | 422 `runtime_failed`; the staged file is never promoted. |
| Approve | `Change approved`; badge `approved: v2`; job shows `succeeded v2`. |
| Undo | notice `Restored the previous approved version.`; badge `approved: v1`; `can_rollback` false at a root version. |
| Guard panel | labelled advisory; findings cite a decision id; “Findings do not block approval in this version.”; never a green PASS badge or a compliance claim. |
| Memory detail | superseded palette shows `SUPERSEDED BY` the active ocean decision and the correction reason in history. |

## 8. Recovery steps

- **Job fails (quota, network, timeout):** staging is untouched, v1 stays current; resubmit. With
  `FORGE_FALLBACK_API_KEY`, one automatic fallback retry happens on quota (429) errors only.
- **Runtime check fails:** that change cannot be approved; re-request instead of approving.
- **Demo state corrupted:** stop the servers, delete `$DATABASE_PATH` and `$WORKSPACE_ROOT`, re-run
  `pnpm demo:seed`, restart. Both are local scratch files.
- **Inconsistent memory seed:** the seed fails loudly if the child-safety decision is not active or
  the palette pair is inconsistent; delete the demo database and re-seed rather than layering a
  second history.
- **Muse CLI login lost:** re-authenticate before the session; verify with a trivial `muse` run.
- **Chrome missing/updated:** the runtime gate needs the `chrome` channel; confirm a desktop Chrome
  install.

## 9. Offline / recorded fallback

Preference order: live authenticated run → recorded authentic run → packaged evidence. Do not
require live Muse availability during the presentation.

- Recorded authentic inference is the primary path for the modification segment: capture one run
  in advance at full speed on the seeded project and show it at real or lightly accelerated pace.
- Packaged Phase 14A evidence: `docs/hackathon-evidence/phase14a/screenshots/` (UI states, guard
  advisory, approval, rollback) and `memory-influence.png` (authentic A/C).
- Authentic Phase 12A/12C/12E evidence remains at `docs/hackathon-evidence/phase12/`,
  `phase12c/`, `phase12e/`; it is never modified by this submission.
- The packaged Phase 14A screenshots were captured with `MODEL_PROVIDER=echo` and the fake-Muse
  transport (deterministic rehearsal). Their game bytes and memory rows are authentic artifacts,
  but the provider panel shows the offline adapter — do not present them as a live Muse session.
  `screenshots/11-memory-influence.png` is authentic Phase 12A model output.
- Deterministic rehearsal without any model call (practice and evidence only — **never present
  fake-mode output as model output**):

  ```bash
  FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" FAKE_MUSE_MODE=auto \
    pnpm dev:server
  pnpm evidence:phase14a        # production pipeline, no model call
  pnpm evidence:phase14a-ui     # real API + Vite + Chrome screenshots
  ```

## 10. Pre-demo checklist

1. Fresh `pnpm install` on `agent/phase14a-demo-production`; `pnpm verify` green.
2. `pnpm verify:runtime` green (valid scene passes, broken scene rejected, unapproved origin blocked).
3. `pnpm demo:seed` runs twice without duplicating memories; Forge shows v1; Memories shows three
   decisions with sunset superseded.
4. One end-to-end rehearsal completed: mutation finding → reject, authentic modification → approve
   → undo; either live (with director authorisation) or recorded.
5. Recorded fallback capture present on the demo machine; screenshots open offline.
6. `GET /api/health` 200; Chrome launches headless; Muse CLI logged in if going live; no keys on
   screen; `.env` not displayed.
7. Browser zoom/font set for recording; bookmarks hidden; private window (no extensions).

## 11. Known limits to state honestly

- Decision Guard is **advisory only**, checks source patterns (five rule families), and is not
  comprehensive compliance verification. Its accuracy is measured, including false positives and
  false negatives.
- The runtime gate checks load-time failure and canvas creation; it does **not** play the game,
  inspect pixels, test every mechanic, or guarantee that later interaction cannot crash.
- Memory influence is one controlled trial per condition (n = 1); results are directional, not
  statistically significant. Accent selection was observed; the remembered dark text colour was
  not applied.
- The app is a single-user, loopback-only build: no authentication, no multi-tenant hosting.
- No demo video exists in this repository. The screenshots and this runbook are the recording-ready
  assets; do not claim footage unless a file was actually created.
