# For judges: start here

Pick one of three paths. Each works on its own, and each says what it cannot show.
The whole page is about running what is in this repository today — no hosted service,
no account, no infrastructure to provision.

[Guide](README.md) · [Getting started](getting-started.md) · [HTML Studio](html-studio.md) ·
[Project memory](project-memory.md) · [Limitations](limitations.md)

**First command — about two minutes:**

```bash
pnpm install --frozen-lockfile
pnpm judge:check
```

`pnpm install` downloads the workspace's dependencies from the package registry. The check
itself makes no network request and no model call, sends no credential, and writes nothing.
On the published `v0.1.0` tag this command does not exist — that tag predates it; the rest of
this page works there.

It prints a setup panel (CLI / media API / browser / offline demo), then the exact
commands for all three paths. Read the panel before you start the server: most failed
first runs are a missing prerequisite, not a broken app.

## The three paths

| Path | What you can see with your own eyes | What it needs | What it cannot show |
| --- | --- | --- | --- |
| **1 · Explore offline** | The seeded `forge-demo` project: an approved application with version history, ACTIVE and SUPERSEDED decisions, retrieval explanation for the next generation, audit history after a correction | Nothing but Node 24+ and pnpm 10.x. `MODEL_PROVIDER=echo` is the deterministic offline provider, not a model | Live generation. The Generate buttons are disabled here, on purpose |
| **2 · Generate live applications** | Prompt → staged proposal → preview / source / diff / memory references / Decision Guard findings → approve publishes a version; request a change and compare | Meta Muse Code CLI installed and `muse login`, plus a verification browser (`pnpm exec playwright-core install chromium`). A codespace as shipped runs `echo` instead, where these buttons are disabled — see below | Approving without a browser check: a staged application is loaded in a real browser before approval is offered |
| **3 · Live media and SAM** | Image generation and editing, selecting an object and extracting a transparent cutout, transcription, clip observation, screenshot review of a staged change | A separate **server-side** `FORGE_MUSE_API_KEY` in `.env`, and provider quota | Being covered by a CLI login. The CLI login does not configure media at all |

Pick path 1 if you have five minutes. Pick path 2 if you want to see the loop the demo
video is about, on your own machine. Pick path 3 if you are checking the media claims —
and note it spends quota and can incur charges.

## Path 1 · Explore offline

```bash
pnpm demo:seed                     # run this BEFORE starting the server
MODEL_PROVIDER=echo pnpm dev
```

Open <http://127.0.0.1:5173> (the API serves on `127.0.0.1:8787`) and open the project
**forge-demo**. You should see:

- the Studio opening on the project **Muse Recall demo** (id `forge-demo`) with **version 1
  approved** in the version list — the recorded SHA-256 of those bytes is shown with it — and
  the approved application in the preview;
- project memory with two **ACTIVE** decisions (an ocean palette, and no flashing effects or
  countdown timers) and one **SUPERSEDED** decision — the retired `#FF7E5F` sunset palette —
  whose record links to the ocean palette that replaced it, with its correction history;
- **Retrieval explanation** for project `forge-demo`, mode **Forge (Studio)**, prompt
  `Change the colours of the game`: it selects the active decisions and leaves the superseded
  one out — that is what a correction does to later work;
- **Decision Guard** reading **NOT EVALUATED** until something is staged: it evaluates a
  *staged* change, and a freshly seeded project has none. It is advisory and never blocks
  approval.

Re-running `pnpm demo:seed` resets `forge-demo` to its recorded version 1. The
[System screen](html-studio.md) then shows the offline provider banner — that banner is
this path working, not a failure. No model call, no media call and no credential is
needed anywhere on this path.

## Path 2 · Generate live applications

Wherever the CLI is installed — your own machine, or a codespace you provisioned yourself:

```bash
muse --version                                   # Meta Muse Code CLI on PATH
muse login                                       # once per machine
pnpm exec playwright-core install chromium       # the verification browser
MODEL_PROVIDER=muse-cli pnpm dev
```

Then, in HTML Studio:

1. Create a project and add a decision, e.g. *"No countdown timers or flashing effects."*
2. Describe a small application and generate it. A job runs the coding CLI; wait for the
   staged proposal.
3. Inspect preview, source, diff, the memory references that generation received, Decision
   Guard findings and dependency disclosures. The verification step loads the staged
   application in a real browser first — a page that throws on start cannot be approved
   silently.
4. **Approve** publishes an immutable version; **reject** leaves the current version
   unchanged.
5. Change a project decision, correct the memory, and then explicitly request the
   matching application change. A corrected memory changes future context; it does not
   rewrite an application by itself.

Expected wall-clock: a small application usually stages in a couple of minutes; the hard
budget is `FORGE_MAX_RUNTIME_MS` (10 minutes by default).

## Path 3 · Live media and SAM

```bash
cp .env.example .env        # .env is git-ignored; never commit a key
# set FORGE_MUSE_API_KEY, then restart:
MODEL_PROVIDER=muse-cli pnpm dev
```

Expected: image generate/edit, reference-object selection and cutout, transcription and
clip observation return results, and screenshot review of a staged change becomes
available. The setup panel's **Media API** row changes from missing to *configured*: it
reports that `FORGE_MUSE_API_KEY` is present and long enough, and that the probe made no
request — provider access and remaining quota stay unverified until you make a call.

A CLI login does not enable this path: media endpoints authenticate with the server-side
`FORGE_MUSE_API_KEY`. Keys stay server-side — they are never sent to the browser, never
placed in a child process environment, and travel to the CLI over stdin rather than argv
(see [security](../../SECURITY.md) and [configuration](../../.env.example)). Quota
failover exists and is opt-in (`MUSE_FALLBACK_API_KEY`, `FORGE_FALLBACK_MODEL`). Live
smoke checks exist for every media surface (`pnpm verify:media-live-smoke`,
`pnpm verify:image-live-smoke`, `pnpm verify:review-live-smoke`) — they make real,
billable calls, so run them deliberately.

## Codespaces: what the container gives you

A codespace opens the app in about three minutes with dependencies installed, `.env`
written with `MODEL_PROVIDER=echo`, the verification browser installed, and `forge-demo`
already seeded. Everything in **Path 1** works there.

**As shipped, it does not generate live applications.** The image installs no Muse Code CLI,
and the default provider is `echo`, so **Generate change** and **New app** are disabled with a
note beside them saying why. That is a deliberate starting configuration, not a ceiling:
installing the CLI yourself, running `muse login`, and starting with `MODEL_PROVIDER=muse-cli`
is the same Path 2 you would run locally. **This project has not run Path 2 from a
codespace**, so nothing here claims that it works there; `pnpm judge:check` reads that
machine's actual configuration and reports what it finds — the CLI row is `not here` when
the offline provider is selected, `missing` with the live provider and no binary,
`unverified` when one is (login is never probed), and it never says
"configured" just because `MODEL_PROVIDER` is set.

Setup preserves existing demo state, starts the app once on container start, and only
prints status on reattach. Stop the background instance with
`bash .devcontainer/stop.sh` before changing providers; restart with
`bash .devcontainer/start.sh`. `SEED_DEMO=force` explicitly resets the demo;
`SEED_DEMO=never` skips seeding. Browser installation and a headless launch check run
as the application user; failed installation warns and leaves exploration available.
A fresh cloud Codespace has not been verified in this review.

If you generate from a codespace, note the browser: `pnpm dev` does not install Chromium
there beyond the container's post-create step, and approval requires a staged application to
load in a real browser.

The container's own README documents the walkthrough and one network detail worth knowing:
codespace setup makes a single anonymous launch-counter request, opt-out with
`DO_NOT_TRACK=1` or `MUSE_RECALL_NO_COUNT=1` ([.devcontainer/README.md](../../.devcontainer/README.md)).

## The startup status panel

The same four rows appear in three places, from one probe, so they cannot disagree:

| Where | How |
| --- | --- |
| In the terminal | the API prints `Setup status …` on every start, and warns if the demo is not seeded |
| In the app | **System** screen → **Setup readiness**, the first panel below the offline-provider banner |
| Without starting anything | `pnpm judge:check` |
| Machine-readable | `GET /api/health` → `setup` block (loopback only; `curl -s http://127.0.0.1:8787/api/health`) |

Row meanings, including the ones that are easy to misread:

| State | Word in that row | Meaning | What to do |
| --- | --- | --- | --- |
| `ready` | `configured` (media), `installed` (browser), `seeded` (demo) | the prerequisite is present, by a read-only check | the word says what was checked, not that it works end to end |
| `missing` | `MISSING` | needed and absent | run the `fix:` line the row prints |
| `not_available` | `not here` | this setup deliberately omits it — for example the deliberately selected `echo` provider | choose another path, or change the configuration; this is not a broken install |
| `not_probed` | `unverified` | the piece may be present, but a deeper fact was not checked — CLI login, a browser that was never launched, a demo nobody inspected | `muse login`, or a live check: **System → live check** (`POST /api/health/muse`) |

The probe performs **no model call, no network request and no quota spend**, and never
prints a secret value. CLI login, provider access and remaining quota are reported as
unverified rather than guessed, because a startup panel that infers them starts lying the
first time a token expires. The **Offline demo** row is the exception: it is checked, and
says so — the project record, the version that project reports approved, and that version's
bytes against their recorded hash, all read-only.

## Troubleshooting

| Symptom | What it means | Fix |
| --- | --- | --- |
| Studio opens with no project, or memory looks empty | nothing is seeded yet | stop the server, `pnpm demo:seed`, start it again — seeding before the first start is required |
| **Generate change** / **New app** disabled, with a note | `MODEL_PROVIDER=echo`, or no Muse CLI on this machine (a codespace as shipped) | that is Path 1; for Path 2 install the CLI, `muse login`, and run `MODEL_PROVIDER=muse-cli pnpm dev` |
| Generation never produces a staged change, CLI errors mention auth | the CLI is present but not logged in | `muse login` (login state is never probed by the server) |
| Review says the verification browser "could not be launched" | no managed Chromium for the selected policy | `pnpm exec playwright-core install chromium`, or set `FORGE_RUNTIME_BROWSER=chrome` with Chrome installed |
| Verification reports `Blocked network request to <origin>` | the generated page asked for a host outside the runtime allowlist — the guard working | leave it: the disclosure is part of the review record; only an application that needs no unapproved host can be approved |
| Media actions say unconfigured, then fail after you set a key | key too short or not read: `.env` belongs in the repository root and `FORGE_MUSE_API_KEY` needs ≥ 10 characters | fix `.env`, restart, re-read the **Media API** row |
| Media works then fails mid-session | provider quota or rate limits | check provider quota; optionally configure `MUSE_FALLBACK_API_KEY` / `FORGE_FALLBACK_MODEL` |
| Server exits at startup with `EADDRINUSE` | port 8787 or 5173 is held by an earlier run | stop that process (`lsof -ti:8787` finds it). If you move the API port, also set `VITE_PROXY_TARGET` for the web dev server |
| Browser console shows origin/host refusals on API calls | you opened the app from an address the loopback guard does not trust | use <http://127.0.0.1:5173>; other origins need `CORS_ORIGINS`. Codespaces origins are trusted automatically |
| `pnpm install` or scripts fail on an old Node | the server uses built-in `node:sqlite` | Node **24+** (`node --version`); pnpm 10.x via `corepack enable && corepack prepare pnpm@10.32.1 --activate` |
| Something else looks unhealthy | the health route answers "is the server sick", not "can I do the thing" | `pnpm judge:check`, then `GET /api/health`; `pnpm verify` proves the workspace build |

## What this build deliberately is not

Single user, one machine, loopback-bound API with no authentication unless you set
`ACCESS_TOKEN`; no hosted application, no accounts, no collaboration, no mobile client.
Approval checks that a staged application loads and renders, not that every interaction is
correct; Decision Guard and screenshot review are advisory. Full list in
[limitations](limitations.md).
