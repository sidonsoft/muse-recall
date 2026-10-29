# Getting started

Set up Muse Recall on a local machine, load the recorded demo, and make a first reviewed change.

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)

## Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | **>= 24.0.0** | The server uses the built-in `node:sqlite` module; there is no native SQLite build. |
| pnpm | 10.x (`packageManager` is `pnpm@10.32.1`) | Workspace install and scripts. `corepack enable && corepack prepare pnpm@10 --activate` is one way to install it. |
| Meta Muse Code CLI | 1.4.x, `muse` on `PATH`, logged in | Real chat and HTML Studio generation. `muse login` once; `muse --version` to check. |
| Playwright Chromium | current managed build | Needed for the default managed approval/runtime checks and for `verify:studio-workflow`. Install with `pnpm exec playwright-core install chromium`; `FORGE_RUNTIME_BROWSER=chrome` is the explicit system-Chrome alternative. |

The repository is verified on Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13 and SQLite 3.53.4 on
macOS. The supported floor in `package.json` is Node 24.

The app is local-first. It needs no hosted service, database server or account beyond the Muse CLI
login. `MODEL_PROVIDER=echo` removes even that dependency for browsing and chat; see
[Offline mode](#offline-mode).

## Install and run

```bash
git clone https://github.com/sidonsoft/muse-recall.git muse-recall
cd muse-recall
pnpm install

pnpm demo:seed        # optional: recorded project, three decisions, v1 approved
pnpm dev              # API on 127.0.0.1:8787, web on 127.0.0.1:5173
```

Open <http://127.0.0.1:5173>. HTML Studio is the landing surface and the seeded project
`forge-demo` is selected by default.

`pnpm demo:seed` is safe to run once before starting the server. It resets the `forge-demo`
workspace to the recorded version 1, so do not re-run it after you have generated or approved
versions in that project unless you intend to reset the demo.

### What the seed contains

- The recorded real Spark baseline for **Farmyard Memory Match**, approved as version 1.
- A child-safety constraint.
- A sunset palette decision that is superseded during seeding by the ocean palette decision.
- Fixed timestamps, so repeated seeding of an untouched project is deterministic.

The seed goes through the production memory engine for decisions, not direct SQL. Its output prints
the database path and the decision ids.

## Environment configuration

The defaults are local-first and require no `.env`. If you want to change server settings, note
where the file is read:

> The API loads `.env` from **its own working directory**. Under the pnpm scripts that directory is
> `apps/server`, not the repository root.

So the effective command is:

```bash
cp .env.example apps/server/.env
```

or pass the variable for one command:

```bash
MODEL_PROVIDER=echo pnpm dev
```

`pnpm demo:seed` resolves relative `DATABASE_PATH` and `WORKSPACE_ROOT` values against
`apps/server` too, so the seed and server agree on the default locations. The seed reads only the
process environment, not `apps/server/.env`. If you move the database or workspace, give the same
value to both commands, for example:

```bash
DATABASE_PATH=/absolute/path/muse.db WORKSPACE_ROOT=/absolute/path/workspaces pnpm demo:seed
DATABASE_PATH=/absolute/path/muse.db WORKSPACE_ROOT=/absolute/path/workspaces pnpm dev
```

The main settings are documented in [`.env.example`](../../.env.example) and summarized in the
[README configuration table](../../README.md#configuration). The defaults that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Keep the API on loopback. |
| `DATABASE_PATH` | `./data/muse-memory-lab.db` | Relative to the server working directory (`apps/server`), unless absolute. |
| `WORKSPACE_ROOT` | `./workspaces` | Forge jobs, staging and approved versions; also relative to `apps/server`. |
| `MODEL_PROVIDER` | `muse-cli` | `muse-cli` for real inference, `echo` for the deterministic offline provider. |
| `MUSE_MODEL` | `muse-wonder-1.0` | Chat/provider default, not the Studio default. Set the Studio model with `FORGE_MUSE_MODEL`. |
| `MEMORY_MAX_MEMORIES` / `MEMORY_MAX_CHARACTERS` | `8` / `4000` | Default-profile retrieval budget. |
| `FORGE_RUNTIME_BROWSER` | `managed` | Use Playwright-managed Chromium; `chrome` explicitly selects system Chrome, with no automatic fallback. |

Keep `.env` out of git. It is ignored by the repository.

## First run

1. **Open or create a project.** The project switcher in HTML Studio opens an existing project or
   creates an empty one from an id. Project ids are lowercase letters, digits and hyphens, 2–64
   characters.
2. **Add a decision before generating.** In **Project memory**, choose **Add decision**, write the
   constraint or preference, and pick its type. The seeded project already has three decisions.
3. **Generate.** In **Development → New app**, describe the application (at least 10 characters) and
   submit. A real generation is a Muse CLI job and can take minutes; the job status and logs are
   visible while it runs.
4. **Review the staged change.** The result is not current yet. Use **Preview**, **Source** and
   **Changes** to inspect it, and read the Decision Guard panel as advisory evidence.
5. **Approve or reject.** Approval runs the load-time browser check and promotes exactly the checked
   bytes to a new immutable version. Rejection removes the staging copy and leaves the current
   version untouched.
6. **Modify.** With an approved version, switch to **Change this app**, describe the change (at least
   3 characters), and optionally capture the preview as a visual reference.
7. **Inspect the memory.** Open **Memory** to see provenance, history and retrieval evidence, or use
   the retrieval explainer to compare the **Forge (Studio)** and **Default** modes.

The full lifecycle, including rollback and recovery, is in [HTML Studio](html-studio.md).

## Offline mode

```bash
MODEL_PROVIDER=echo pnpm dev
```

The deterministic `echo` provider needs no credentials or network. It is labelled as offline in the
UI and API, and it refuses to impersonate Muse. Use it to browse the seeded project, inspect memory
and exercise the API in CI.

**HTML Studio generation still needs the Muse Code CLI even when `MODEL_PROVIDER=echo`.** Forge
spawns `muse` directly; the chat provider setting does not replace it. The offline provider does not
fabricate a Studio generation.

## Verification commands

The root `package.json` is the source of truth. These are the useful entry points:

| Command | What it does |
| --- | --- |
| `pnpm verify` | Lint, typecheck and the unit/integration test suite. |
| `pnpm build` | Production web and server builds. |
| `pnpm muse:probe` | One real headless Muse call, with latency and token usage. |
| `MML_LIVE_MUSE=1 pnpm test` | Adds the opt-in live Muse integration tests. |
| `pnpm verify:runtime` | Exercises the load-time browser check used at approval. |
| `pnpm verify:security` | Reproduces the foreign-origin rejection and same-origin acceptance in a browser. |
| `pnpm verify:forge-workflow` | Backend generate/stage/diff/approve/reject/rollback against the deterministic provider. |
| `pnpm verify:studio-workflow` | Managed Chromium end-to-end workflow. Requires `pnpm build` and the managed Chromium build; it starts its own API, web preview, database, workspace and ports. |
| `pnpm verify:forge` | HTML Studio browser loop against `FORGE_VERIFY_BASE` (default `http://127.0.0.1:5173`); requires running servers. |

The full script list, including benchmarks and research verifiers, is in the
[repository README](../../README.md#verify-dont-trust). Verification labels are not
interchangeable: syntax checks, a load-time browser check, an interactive browser suite and human
review prove different things.

## Where state lives

| State | Default location |
| --- | --- |
| Memories, history, sessions, tool audit | `apps/server/data/muse-memory-lab.db` (SQLite, WAL enabled) |
| Forge project state and versions | `apps/server/workspaces/forge/<project-id>/` |
| Staged jobs | `apps/server/workspaces/forge/<project-id>/staging/<job-id>/` |
| Job records | `apps/server/workspaces/forge/<project-id>/jobs/<job-id>.json` |
| Browser drafts and selected project | The browser's `localStorage`; not server state |

To start from a clean slate, stop the server and remove the database and workspace directories.
That deletes memories and approved versions permanently; there is no restore endpoint.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `muse` not found or generation fails immediately | `muse --version`, `muse login`, and `pnpm muse:probe`. If the binary is not on `PATH`, set `MUSE_BIN` (chat) or `FORGE_MUSE_BIN` (Studio) to an absolute path. |
| Chat works offline but Studio generation fails | `MODEL_PROVIDER=echo` does not power Forge. Point the Studio at a working Muse CLI or set `FORGE_MUSE_BIN`. |
| Approval fails with a browser-launch message | Install managed Chromium with `pnpm exec playwright-core install chromium`, or deliberately set `FORGE_RUNTIME_BROWSER=chrome`. There is no silent fallback. |
| Settings in `.env` appear ignored | The server reads `apps/server/.env`, not the repository-root `.env`. For `demo:seed`, pass the same variables inline or export them. |
| `EADDRINUSE` on 5173 or 8787 | Stop the other process. Vite uses a strict port. If you move the API port, also set `VITE_PROXY_TARGET` for the web dev server. |
| `403 forbidden_origin` from a script | State-changing requests with a foreign or `null` `Origin` are rejected. Call from the app origin, add the origin to `CORS_ORIGINS`, or use a non-browser client with no `Origin`. This guard is not authentication. |
| `no_current_version` when modifying | Generate and approve a first version before requesting a modification. |
| A job shows `interrupted` after a restart | Interrupted jobs are not resumed by design. Inspect the staged files and start a new job. |

## Next

- [Project memory](project-memory.md) — how decisions are stored, corrected and retrieved.
- [HTML Studio](html-studio.md) — the complete stage/review/approve/reject/rollback workflow.
- [Limitations](limitations.md) — what the local beta does not do.

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
