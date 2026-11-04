# Muse Recall in Codespaces

## Before you start

- You need a GitHub account. The codespace runs in your account and uses your Codespaces
  allowance while it is running, so stop or delete it when you are done
  ([your codespaces](https://github.com/codespaces)).
- The first start takes about three minutes (dependencies, the Playwright browser, the
  demo seed). The editor can look empty while the container builds.
- VS Code asks whether you trust the authors of this workspace. Choose to trust it, or
  setup cannot continue.

## What you get

The container opens on the **offline exploration path**: dependencies installed, `.env`
written with `MODEL_PROVIDER=echo` (the deterministic offline provider, labelled as such
in the UI), managed Chromium installed for the approval browser check, and the
`forge-demo` project seeded. The app starts automatically when the container starts; every
reattach prints its links and health without restarting anything.

| State | Command | What it does |
| --- | --- | --- |
| First create | automatic (`setup.sh`) | install, browser, `.env`, seed — skips anything already present |
| Container start | automatic (`start.sh`) | starts `pnpm dev` in the background only if the app is not already healthy |
| Reattach | automatic (`status.sh`) | prints the app link and health; never starts or stops anything |
| Logs | `tail -f .devcontainer/.logs/dev.log` | background `pnpm dev` output |
| Stop the app | `bash .devcontainer/stop.sh` | signals only the background app tree; `bash .devcontainer/start.sh` brings it back |

Setup is safe to re-run: it keeps an existing `.env` and never reseeds an existing
`forge-demo` project, so your generated versions, staging and jobs survive. To reset the
demo to the recorded version 1: stop the app, then
`SEED_DEMO=force bash .devcontainer/setup.sh`.

## A five-minute walkthrough (offline)

Each step says what you should see. The app link is printed on every attach; it looks
like `https://<codespace>-5173.app.github.dev`.

1. **HTML Studio opens on the demo project.** The project list shows **Muse Recall demo**
   (project `forge-demo`); open it and the version history lists **v1** as the current
   approved version, the preview shows the approved game, and the recorded SHA-256 of those
   bytes is shown with the version.
   **Project memory** on the left lists two **ACTIVE** decisions (an ocean palette and a
   child-safety rule) and one **SUPERSEDED** decision (a warm sunset palette).
2. **Open the superseded decision.** Choose **Open Memory**, then click the sunset palette
   card. The detail panel shows **SUPERSEDED BY** with the active ocean palette, and its
   **History** shows *created* and then *superseded*, with the reason "Creative direction
   changed from a warm sunset mood to a cool ocean mood."
3. **Follow the replacement.** Click the ocean palette card. It shows **REPLACED 1
   EARLIER RECORD** (the sunset palette) and a history entry *created by correction*. The
   old decision is kept for audit; it is not deleted.
4. **Explain what the next generation would receive.** Open the **Retrieval explanation**
   tab, keep project **forge-demo** and mode **Forge (Studio)**, type
   `Change the colours of the game` and choose **Explain**. You should see **2 selected**:
   the child-safety rule and the ocean palette, each with its score breakdown, and the
   prompt block size. The superseded sunset palette is not among them. That is the point of
   a correction.
5. **Check the version history.** Back in HTML Studio, the **Review** column shows
   **No staged change** and, under **Version history**, **v1 Demo baseline (recorded real
   Spark generation)** marked *current*.
6. **Read the Decision Guard panel for what it is.** It reads **NOT EVALUATED** here. The
   Guard checks a *staged* change against active decisions, and the seeded project has no
   staged change. In the demo video (at 0:43) it flags a change that brings back the sunset
   palette; it is advisory and never blocks approval.
7. **Optional: make a correction yourself.** In Memory, open a decision and use
   **Correct memory**. The correction becomes the active record and the old one moves to
   superseded, exactly as in step 2. Run step 4 again to see retrieval follow it.

The recorded generate → review → approve loop is shown in the
[3:00 demo video](https://sidonsoft.github.io/muse-recall/video/muse-recall-demo.mp4).
The opening minute is recorded live Muse Spark calls; later beats mix retained model
outputs, product replays and labelled fixtures — the
[QA record](../docs/demo/video/V21_QA.md) classifies every beat, so the video never stands
as live proof of this container. The in-repo source of the same cut and its captions live
in [docs/demo/video](../docs/demo/video/).

## Optional live setup (your machine credentials, your quota)

Offline is the default. Live generation and live media are opt-in, use **your**
credentials, and spend **your** quota — setup makes no paid call on its own.

**1 · Text generation (Muse Code CLI).** The container does not install the CLI by
default: the installer follows the release channel (no pinned build exists), and a login
is a human step anyway. To enable it:

```bash
INSTALL_MUSE_CLI=1 bash .devcontainer/setup.sh   # official launcher, records the version it installed
muse login                                        # device code prints in this terminal; approve it in your browser
```

`muse login` inside Codespaces is the same device-code flow as on a laptop: the terminal
prints a code and a URL, you approve it in your own browser. This container's `open`
handling may not pop a browser for you — if nothing opens, copy the URL by hand.

> **Unverified in Codespaces.** The launcher supports Linux (that is platform
> support, verified by inspection), but the device-code login, an authenticated
> call, and running the app against it have **not** passed in an actual
> Codespace. Treat this whole section as experimental until that run exists.
> Distinguish the three states: the launcher installs a binary (detection), the
> login proves your account (authentication, unverified here), and only a
> successful job proves inference (verified by nobody yet in this container).

Switching providers restarts the app — never run a second server over the
background one. Stop the automatic instance first, change `.env`, then start
again:

```bash
bash .devcontainer/stop.sh   # stop the background app (signals only its own tree)
# set MODEL_PROVIDER=muse-cli in .env (the server reads it once, at startup)
bash .devcontainer/start.sh  # start again; reattach any time to see the links
```

Generate buttons enable only when the CLI is found on `PATH` (override with `MUSE_BIN`
for chat or `FORGE_MUSE_BIN` for Studio). A present CLI with an expired login fails at
job time with an auth error — run the System screen's **live check**
(`POST /api/health/muse`) to confirm before judging the loop.

**2 · Media and SAM (`FORGE_MUSE_API_KEY`).** A CLI login does **not** enable media: image
generation/editing, SAM segmentation, transcription, clip observation and screenshot
review authenticate with a separate server-side key. Add it as a
[Codespaces secret](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-secrets-for-your-codespaces)
named `FORGE_MUSE_API_KEY` (user or repository scope), rebuild or restart the container
so the environment picks it up, then stop and start the app (`bash .devcontainer/stop.sh`
followed by `bash .devcontainer/start.sh`). The server never sends the key to
the browser, never logs it, and reports only whether it is configured.

**3 · Which knob is which.** All three need an app restart — the server reads them once
at startup and `.env` belongs in the repository root (never commit it).

| Variable | Controls | Default |
| --- | --- | --- |
| `MODEL_PROVIDER` | chat, provider bench and `muse:probe`: `muse-cli` (real) or `echo` (offline) | `muse-cli` (`echo` in this container's `.env`) |
| `MUSE_MODEL` | chat/bench/probe model only — it does **not** change Studio generation | `muse-wonder-1.0` |
| `FORGE_MUSE_MODEL` | HTML Studio generation model; unset means the CLI's own default | unset |
| `FORGE_MUSE_API_KEY` | Studio API-mode credential (≥ 10 chars); unset means Studio rides the CLI login | unset |
| `FORGE_MEDIA_MODEL`, `FORGE_SAM_MODEL`, `FORGE_VISION_MODEL`, `FORGE_TRANSCRIBE_MODEL`, `FORGE_VIDEO_MODEL` | media endpoints; each rejects the coding model ids, so they are independent knobs | image / SAM-3.1-class / vision / transcribe / video defaults in `.env.example` |

Every live smoke check (`pnpm muse:probe`, `pnpm verify:*-live-smoke`) makes a real,
billable call: run them deliberately, with a spending limit you set. Never present a
retained output or a fixture as a live result — see the QA record above.

## Checks you can run

```bash
pnpm verify    # lint + typecheck + the full test suite
pnpm build     # production web + server builds
```

## Notes

- No secrets are needed or stored. `.env` is created from `.env.example` and is ignored
  by git. Reseeding never touches it.
- The API still binds to loopback only, and the forwarded ports stay private. Codespaces
  delivers the app's requests with `Origin: https://localhost:5173`. Only when it runs
  inside a codespace, the server also trusts that origin and the codespace's own
  forwarded address (`apps/server/src/codespaces.ts`). Other sites, ports and codespaces
  are still rejected — no public port or relaxed origin is needed, and none is added.
- Application validation needs the managed Chromium that setup installs. Without it,
  staging still works but approval cannot run its load-time browser check; rerun
  `pnpm exec playwright-core install --with-deps chromium` (needs root via sudo).
- To start over, stop the app (`bash .devcontainer/stop.sh`), delete `data/` and `workspaces/`, then run
  `bash .devcontainer/setup.sh` (or `SEED_DEMO=force` to reseed without deleting).
- **Launch count.** When the codespace is created, setup makes one anonymous request
  that adds 1 to a public counter, so the author can see how many codespaces were
  started. It is a plain `GET` to
  `https://abacus.jasoncameron.dev/hit/sidonsoft-muse-recall/codespaces-launches`, a free
  counting service with no account. Nothing is sent except the counter name: no
  username, repository contents, environment or machine details. Like any web request,
  it reveals your IP address to that service, whose logging this project does not
  control. It runs only in Codespaces (not in a local dev container), waits at most
  3 seconds and cannot make setup fail (verified against `setup.sh` 31 Oct:
  `curl --max-time 3 ... || true`). Opt-out triggers on EITHER variable set to
  ANY non-empty value — `=1` below is the conventional spelling, not a
  requirement — and the owner's own test launches increment a separate counter,
  so the public number counts real starts. To opt out, set `DO_NOT_TRACK=1` or
  `MUSE_RECALL_NO_COUNT=1` as a
  [Codespaces secret](https://github.com/settings/codespaces) before you create the
  codespace. Anyone can read the total at
  `https://abacus.jasoncameron.dev/get/sidonsoft-muse-recall/codespaces-launches`
  (observed 31 Oct: until the first real launch the key does not exist yet and the
  service answers `{"error":"Key not found"}` rather than `0` - owner test launches
  deliberately increment a separate counter, so a missing key means "no real
  launches yet", not a broken link; the key is created by the first matching `hit`).
