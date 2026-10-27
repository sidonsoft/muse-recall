# Muse Recall — demo runbook

Commands below are taken from repository scripts (`package.json` on the named branch) and the
Phase 12C verification appendix — nothing is invented. Environment facts (ports, defaults) were
read from `apps/server/src/config.ts` and `apps/web/vite.config.ts` on the same branch.

## 0. Where to run the demo

Run the demo from **`agent/phase12c-guard-advisory` (tip `260d9ce`)** — the accepted Phase 12C
branch. It contains the seeded demo project script, the recorded baseline game, the Forge
workflow, and the Decision Guard advisory UI. (This documentation branch has the docs and the
evaluation/audit assets but not the demo seed or the advisory UI.)

```bash
git clone https://github.com/sidonsoft/muse-recall.git
cd muse-recall
git checkout agent/phase12c-guard-advisory
pnpm install
```

## 1. Required environment

| Requirement | Value / check | Verified from |
| --- | --- | --- |
| Node.js | ≥ 24 | root `package.json` `engines` |
| pnpm | 10.32.1 (`corepack enable`) | root `package.json` `packageManager` |
| Google Chrome | installed (runtime check launches `channel: 'chrome'` headless) | `apps/server/src/forge/runtime-check.ts` |
| Muse CLI | `muse` on PATH, logged in with the Meta subscription | config default `MODEL_PROVIDER=muse-cli`, `MUSE_BIN=muse` |
| Quota plan | subscription first, optional contributor-key fallback on quota errors | Phase 11A trials (failover fired on all 5) |

## 2. Secret handling (read before demo day)

- **No API keys are stored in the repository.** `.env` is git-ignored; only `.env.example`
  (placeholders) is tracked.
- Optional keys are passed via environment only: `FORGE_MUSE_API_KEY` (forced primary),
  `FORGE_FALLBACK_API_KEY` (quota fallback), `MUSE_FALLBACK_API_KEY` (chat-side fallback).
  Never type values into slides or terminal screenshots; export them in a private shell.
- The key never travels in command-line arguments (it is written to the CLI's stdin), and server
  logs/errors pass through `redactSecrets` — see `docs/PHASE11_RELEASE_READINESS.md`.
- One historical test-fixture key was found in old history, removed from the tree, and rotated
  on 2026-10-27; the old value is invalid.
- Pre-demo check: confirm `git grep -l "meta_[A-Za-z0-9]" -- ':!*.example'` returns nothing that
  is a real value, and that your `.env` (if any) is not staged.

## 3. Startup (verified script names)

Use one consistent `WORKSPACE_ROOT` and `DATABASE_PATH` for the seed and the server. Suggested
demo values (scratch area, fresh each run):

```bash
export WORKSPACE_ROOT=/tmp/forge-demo-ws
export DATABASE_PATH=/tmp/forge-demo.db

pnpm demo:seed        # creates project "forge-demo" v1 from the recorded baseline
pnpm db:migrate       # optional — the server also applies migrations at startup
pnpm dev:server       # API on http://127.0.0.1:8787 (default PORT)
pnpm dev:web          # web client on http://127.0.0.1:5173 (strictPort)
```

If ports are taken, the verified override pattern is:

```bash
PORT=8899 DATABASE_PATH=… WORKSPACE_ROOT=… pnpm dev:server
VITE_PROXY_TARGET=http://127.0.0.1:8899 pnpm --filter @mml/web exec vite --port 5199
```

Sanity check: `GET http://127.0.0.1:8787/api/health` → 200.

## 4. Seed data

- `pnpm demo:seed` (12C branch) copies `demo/forge-baseline/index.html` into the project as
  **version 1** with its sha recorded. The baseline is a **recorded real
  `muse-spark-1.3-contributor` generation** (sha `79c9d67a…9ba9e41`) — authentic output, so the
  demo's starting point has no model variance.
- Seed project id: `forge-demo` (override with `SEED_PROJECT`).
- Remembered decisions for the demo: create (or seed) the child-safety decision
  ("children 5–8; avoid flashing effects, countdown timers, penalties for mistakes — Why: …")
  and the palette correction pair (sunset → ocean, with the correction reason). These are plain
  project-scoped constraint memories; enter them in the Memories view before recording.

## 5. Browser entry point

Open **http://127.0.0.1:5173** → sidebar **Forge** → project **`forge-demo`**.
Memory screens: sidebar **Memories** (decision list, history, provenance).

## 6. Demo sequence

Follow [DEMO_SCRIPT_3MIN.md](DEMO_SCRIPT_3MIN.md). Summary of UI checkpoints:

1. Forge → `forge-demo`: game preview runs, version badge **v1**.
2. Memories: decision card (content, Why rationale, provenance, project scope); palette
   correction history (original marked *superseded*, audit entries, correction reason).
3. Forge → modify request → job starts; job record shows retrieved memories + prompt hash.
4. Review panel: unified diff (expect single-digit % of lines), **validation** block
   (structural + runtime), separate **Decision Guard — Advisory** block labelled
   *pre-runtime review snapshot*.
5. Guard findings (labelled-mutation job): two high-severity findings citing the child-safety
   decision with source evidence; a third panel state may show *UNVERIFIED* notes.
6. Approve (findings present) → **v2** current. Roll back → **v1** current.

## 7. Expected UI states (what "healthy" looks like)

| Screen | Expected |
| --- | --- |
| Overview | API reachable, provider/model shown (never a key). |
| Forge project | v1 preview playable; Modify input enabled. |
| Running job | progress state; job must finish in ~0.5–2 min (observed 34–105 s; hard budget `FORGE_MAX_RUNTIME_MS` default 600 s, call budget `FORGE_MAX_CALLS` default 25). |
| Review | diff + green validation + advisory panel; Approve enabled after runtime pass. |
| Runtime failure | Approve disabled, 422 `runtime_failed` state; staged file never promoted. |
| After approval | version list shows v2; Rollback restores v1 with the audit trail intact. |
| Guard panel | findings are labelled *advisory*, non-blocking; nothing in the guard UI says "enforced". |

## 8. Recovery steps

- **Job fails (quota, network, timeout):** staging is untouched, v1 stays current; simply submit
  the request again. With `FORGE_FALLBACK_API_KEY` set, one automatic fallback retry happens on
  quota (429) errors only.
- **Runtime check fails:** that change cannot be approved; re-request instead of approving.
- **Demo state corrupted:** re-run `pnpm demo:seed` (replaces v1 deterministically); for a fully
  fresh app state, stop the server and delete `$DATABASE_PATH` + `$WORKSPACE_ROOT` (both are
  local scratch files, safe to remove).
- **Muse CLI login lost:** re-authenticate the CLI before the session; verify with a trivial
  `muse` run outside the app first.
- **Chrome missing/updated:** runtime check needs the `chrome` channel — confirm a desktop
  Chrome install before the session.

## 9. Offline / recorded fallback

Order of preference: live run → run recorded earlier this week → packaged evidence.

- Recorded run: one complete modification captured on the seeded project (see recording
  checklist in the demo script).
- Packaged evidence on cloud branches (never modify):
  - Phase 12A: `docs/hackathon-evidence/phase12/` (`pilot.json`, `{A,B,C}-v2.html`, screenshots).
  - Phase 12C: `docs/hackathon-evidence/phase12c/` (`evaluation.json`, UI + game screenshots,
    source files).
  - Phase 11A: `docs/hackathon-evidence/phase11/trials.json`.
- Rehearsal without model calls (deterministic fake Muse — for practice only; **never present
  fake-mode output as model output**):
  `FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" FAKE_MUSE_MODE=auto … pnpm dev:server`
  then `pnpm verify:forge` (9 browser checks), and `pnpm eval:guard` + `pnpm evidence:guard-ui`
  for the guard screenshots.

## 10. Pre-demo checklist

1. Fresh `pnpm install` on the demo branch; `pnpm verify` green (expect 391 passed / 3 skipped).
2. `pnpm verify:runtime` green (valid passes, broken rejected).
3. `pnpm demo:seed` → Forge shows v1; memories entered and visible in Memories view.
4. One live dry-run modification completed end to end (approve + rollback once).
5. Recorded fallback video/screens present on the demo machine.
6. `GET /api/health` 200; Chrome launches headless; Muse CLI logged in; no keys on screen.
7. Browser zoom/font size set for recording; hide bookmarks bar; private window (no extensions).
