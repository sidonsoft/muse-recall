# Muse Recall

### Correctable project memory for AI-built software.

AI app builders forget. A new session starts from zero, a change quietly drops an earlier
decision, and an old preference keeps coming back after you change your mind.

**Muse Recall** is a local-first HTML Studio for Meta's Muse Spark that remembers your
project's decisions, lets you correct them, and makes every change wait for your review.

**[▶ Watch the 2:50 demo](docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true)** ·
**[Project website](https://sidonsoft.github.io/muse-recall/)** ·
**[Try it in your browser](https://codespaces.new/sidonsoft/muse-recall?quickstart=1)** ·
**[Check the evidence yourself](#reproduce-the-evidence)**

### Headline result: retrieved memory changed the code Muse Spark wrote

**What was measured.** Phase 17 is a pre-registered trial of 480 runs on two Meta
models, across two games and a non-game task planner. Each project carried one rule: a
child-safety rule for the games (no flashing effects, countdown timers or penalties for
mistakes) and a no-animation rule for the planner. Each run then asked for one of four
changes that a model could satisfy by breaking the rule, such as "make the game more exciting
and challenging, like an arcade game". A code detector, fixed and pushed before the first run, checked the generated source
for the rule being broken.

| Runs where the generated source broke the rule | Muse Spark | Muse Spark Open |
| --- | ---: | ---: |
| No project memory | 37 of 57 | 49 of 60 |
| Project memory retrieved by Muse Recall | **0 of 58** | **1 of 60** |
| The same rule retyped by hand into every request | 0 of 58 | 0 of 60 |

Counts are over usable runs (8 of 240 Muse Spark runs hit the 30-minute cap; none on Muse
Spark Open). Memory vs no memory: exact two-sided p = 6.5 × 10⁻²⁰ and 1.1 × 10⁻²⁴.

**How we read it.** Retrieved memory did as well as retyping the rule by hand, without anyone
retyping it. It is not better than a well-written prompt; it saves writing that prompt every
time. The trial covers six fixed tasks and measures source code, not runtime behaviour or
general correctness. [Full results, the correction arm and the limits](#what-the-evidence-shows)

![Current HTML Studio reviewing staged v2 of Farmyard Memory Match: the live preview, the project decisions supplied to the change, the Decision Guard advisory and the approve/reject controls](docs/assets/readme-2026-10-29/studio-review.png)

[![Muse Recall demo video poster: Muse Spark builds it, Recall remembers why, you decide](docs/demo/video/Muse_Recall_Demo_V21_Poster.jpg)](docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true)

**Demo video** — 2:50, recorded 29 October 2026 from a live Muse Spark session.
[**Watch (mp4, 1080p, 12.7 MB)**](docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true) ·
[captions (SRT)](docs/demo/video/Muse_Recall_Demo_V21.srt) ·
[transcript](docs/demo/video/Muse_Recall_Demo_V21_Transcript.txt) ·
[what the cut shows](docs/demo/CORRECTABLE_MEMORY_DEMO.md#9-recorded-cut-29-october-2026).
The video also plays on the [project website](https://sidonsoft.github.io/muse-recall/), a
one-page overview with the loop and the evidence (a static landing page, not a hosted copy
of the app; source in [`website/`](website/)).

## For judges

Describe a browser app and Muse Spark writes one `index.html`; ask for a change and it edits
the approved source. Around that loop, Muse Recall does three things:

1. **It remembers.** Project decisions are stored as records with provenance, and the
   most relevant active ones are supplied to each later generation.
2. **You can correct it.** A correction supersedes the old decision instead of overwriting
   it, so stale guidance stops coming back and the history stays auditable.
3. **Nothing changes until you approve it.** Each change waits as a preview, its source and
   a diff. Approval publishes exactly the bytes that were checked, and you can roll back.

**Does the memory change the code?** Yes, in the trial above: with retrieved project memory
the rule was broken in 0 of 58 Muse Spark runs, against 37 of 57 without memory.
[What the evidence shows](#what-the-evidence-shows) has the correction arm and the limits.

### Try it

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sidonsoft/muse-recall?quickstart=1)

**In the browser, no install:** click the badge above. You need a GitHub account; the first
start takes about three minutes, and VS Code asks you to trust the workspace (accept it so
setup can continue). The codespace seeds the demo project and opens the app on the offline
provider; no Muse account or key is needed. Generating new code needs the Muse CLI, so
follow the [five-minute offline walkthrough](.devcontainer/README.md#a-five-minute-walkthrough-offline).
Setup sends one anonymous request to count codespace launches; what it sends and how to
opt out are in the [Codespaces notes](.devcontainer/README.md#notes).

**Locally:**

```bash
git clone https://github.com/sidonsoft/muse-recall.git muse-recall && cd muse-recall
pnpm install
cp .env.example .env
pnpm demo:seed                  # seeded game, three decisions (one superseded), v1 approved
MODEL_PROVIDER=echo pnpm dev    # no Muse account needed; open http://127.0.0.1:5173
```

Without Muse, the offline provider lets you browse the seeded project: the app, its
memory and provenance, the retrieval explanation, Decision Guard and version history.
Generating or changing an app needs the Muse Code CLI; see [Quickstart](#quickstart).
The [user guide](docs/guide/README.md) walks through setup, project memory, HTML Studio,
architecture and limitations.

### Reproduce the evidence

Every Phase 17 count and p-value can be re-derived from the 480 retained run records in this
repository. It needs Node and `python3`, no Muse account and no network after `pnpm install`,
and takes under a minute:

```bash
pnpm verify:research17   # lock, 1205-file inventory, counts, as-run and corrected p-values
```

It prints the counts above for each model and ends with three `PASS` lines. Its first block
shows the preserved as-run p-values (about 10⁻¹⁶); the exact values quoted in this README are
the [post-run correction](docs/hackathon-evidence/phase17/STATS_CORRECTION.md), checked in the
last block. The protocol was locked at commit
[`6640e83`](https://github.com/sidonsoft/muse-recall/commit/6640e83f3c999cd1349420ad5e95bc329fff7d36)
before the first run; see [RESULTS.md](docs/hackathon-evidence/phase17/RESULTS.md).

---

## Evidence and details

### At a glance

| | |
| --- | --- |
| **Demo video** (2:50, 1080p, recorded 29 October 2026) | One continuous live Muse Spark session (with insert cards for evidence and limits), a visible cursor and speed-ramped generation waits. Save a sunset constraint, generate and approve v1; request a change in a new session and reject it; correct the decision to ocean; request the same change again and reject it when Guard flags the reintroduced sunset palette; then ask for the project's current art direction from memory and approve v2. Guard is advisory throughout and never blocks approval. The video, captions, transcript and QA are in [`docs/demo/video/`](docs/demo/video/); the storyboard, live outcomes, limits and honest failure beat are in [the demo note](docs/demo/CORRECTABLE_MEMORY_DEMO.md). |
| **Earlier cut** (2:46) | Ocean Pairs, a children's memory game built with Muse Spark. It shows the stored rule and its provenance, the retrieval explainer, a request for a countdown and a penalty that comes back with no change, a change that fits being reviewed and approved as v2, a rollback to v1, and the Phase 16 two-model result. It has **no explicit correction beat** and is kept for the record; the 2:50 cut above is the submission video. |
| **Behavioural evidence** | Pre-registered Phase 17 (480 runs, six strata, two models): original-rule violations fell from **37/57 to 0/58** on Muse Spark and **49/60 to 1/60** on Muse Spark Open. Retyping the rule by hand gave **0/58** and **0/60**. After correction, the original-rule detector rose to 41/59 and 50/60, which suggests the superseded restriction was released; it does not test whether a replacement requirement is followed. Phase 17's correction was permissive; the sunset-to-ocean **replacement** is Phase 12A evidence, one run per condition. [Results](docs/hackathon-evidence/phase17/RESULTS.md) · [exact-p correction](docs/hackathon-evidence/phase17/STATS_CORRECTION.md) · [review disposition](docs/hackathon-evidence/phase17/REVIEW_DISPOSITION.md). |
| **Meta models** | Muse Spark (Muse Code CLI) builds and edits the apps. Muse Spark Open on Baseten replicated the research; the application does not call it. |
| **Engineering** | `pnpm verify` runs lint, typecheck and 811 passing tests (3 opt-in live tests skipped). A staged change loads in managed Chromium before it can be approved, and approval publishes exactly the bytes that were checked. Rollback follows recorded ancestry. Cross-origin requests cannot change state. |
| **Limits** | Single-user and loopback-only. Decision Guard is advisory. Phase 17 covers six fixed strata, two rules and two models, and measures source code rather than runtime safety. See [Known limitations](#known-limitations). |

### Why this fits “Push the Frontier”

The software theme rewards work that moves software building forward, not another chat
surface. Our bet is that the next step is not a larger context window but a project memory
you can correct and a change you can review before it becomes current. The contribution is
the integration — correctable memory, controlled promotion, and a pre-registered behavioural
test — rather than persistent memory by itself. This is our reading of the theme; it is not
an organizer endorsement, and we make no prediction about judging.

### What the evidence shows

Phase 17 is the current behavioural test: 480 pre-registered runs, four arms × six strata ×
two models. A violation is the original rule appearing in generated source, found by a
detector fixed before the runs. Counts are violations over usable runs.

| Arm | Muse Spark | Muse Spark Open |
| --- | ---: | ---: |
| No memory (`none`) | 37/57 | 49/60 |
| Retrieved project memory (`memory`) | **0/58** | **1/60** |
| Rule retyped by hand (`manual`) | 0/58 | 0/60 |
| Rule corrected before the edit (`corrected`) | 41/59 | 50/60 |

- **Without memory vs with memory:** exact two-sided p = 6.5 × 10⁻²⁰ (Muse Spark) and
  1.1 × 10⁻²⁴ (Muse Spark Open).
- **The pre-registered manual comparison:** memory is not worse than retyping the same rule;
  the upper 90% bounds are +4.5 pp and +7.1 pp, inside the +15 pp non-inferiority margin.
  The product point is that Recall assembles the context for the user.
- **After correction:** the `corrected` arm is scored with the **original-rule** detector.
  Its higher rate suggests the superseded restriction was released. It does not test whether a
  replacement requirement is followed; it only shows that the old rule stopped constraining
  output. Phase 17's correction was **permissive** — it released restrictions rather than
  substituting a replacement requirement. The sunset-to-ocean replacement in the focused
  cut is [Phase 12A](docs/PHASE12_MEMORY_VALIDATION.md) evidence, one run per condition.
- **Usable runs:** 8 of 240 Muse Spark runs hit the 30-minute cap and are unusable; Muse
  Spark Open had 0 of 240. Counts above use the remaining denominators. Counting unusable
  runs as violations does not change a verdict.
- **Reporting correction:** the p-values above are the exact recomputation adopted in the
  post-run correction after review. The original as-run values are preserved; no verdict
  changed. See [STATS_CORRECTION.md](docs/hackathon-evidence/phase17/STATS_CORRECTION.md).
- **Scope:** six fixed strata, source code only. This does not establish general application
  correctness, runtime safety, Decision Guard effectiveness or transfer to other tasks.

---

## What this is

Muse Recall is one workflow with five implemented capabilities:

1. **Persistent project decisions, with identity and provenance.** Each decision has a stable
   UUID, a type and scope, its source session or job, confidence, validation status, and an
   append-only history. A project can carry constraints, decisions and preferences across
   sessions, app restarts and separate Studio jobs. Retrieval is budgeted; every result
   carries its score components and an evidence sentence.
2. **Explicit correction and supersession.** A correction is one transaction: insert the
   replacement, record the supersession edge, mark the old decision `superseded`, and append
   history. The old record stays auditable but is excluded from active retrieval, so stale
   guidance stops constraining new work. Replaying the same correction is idempotent.
3. **Memory supplied to generation.** Before a generate or modify job, Recall retrieves the
   project's active decisions and renders them into the production prompt as bounded,
   escaped reference data — not instructions. The job records the decision ids it received
   and the SHA-256 of the exact prompt, so the context can be reconstructed.
4. **Reviewable changes, approval, history and rollback.** A generated change is staged, not
   applied. **Preview**, **Source** and **Changes** show the live document, the exact staged
   source and a line diff. Approval snapshot-checks the bytes, loads them in managed Chromium,
   and promotes exactly those bytes to an immutable version. Rejection leaves the current
   version untouched; rollback follows the recorded parent, including after a non-linear
   history.
5. **Advisory Decision Guard.** A deterministic, dependency-free source check compares the
   staged file with the job's own decisions. It supports seven rule families (countdown
   mechanics, flashing effects, mistake penalties, superseded palette, colour-only cues,
   autoplaying media, external assets),
   cites the decision and a bounded evidence excerpt, and reports what it cannot verify.
   It **never blocks approval** and is **not compliance certification**.

Persistent memory is not new: transcripts, retrieval stores and long-running agents all
provide versions of it. The contribution here is the **integration** — memory that can be
corrected without losing the audit trail, a generated change that is reviewable before it
becomes current, and measured evidence that the remembered decision changes generated code.

Also implemented: a sandboxed preview with an opaque origin; a load-time browser gate with
network blocked except the approved CDN; cross-origin mutation rejection; a controlled agent
harness that keeps retrieved text from widening its own authority; and a declarative UI
protocol for generated planning forms.

---

## Beyond games: FocusFlow

The demo videos show a game. To check that HTML Studio is not game-specific, Muse Spark also generated
and then modified **FocusFlow**, a single-file personal task planner. It is a genuine
application, not a game: no canvas, no game loop, no Phaser. The full provenance is in
[docs/demo/NON_GAME_HTML_VALIDATION.md](docs/demo/NON_GAME_HTML_VALIDATION.md).

**Generation.** Attempt 1 (`1621b9db…`) was a real Muse Spark generation that rendered but used a
native form submit; the preview sandbox blocks native submission, so it was **rejected**. The
artifact and failure record are preserved. Attempt 2 (`e358246a…`) added a human-written sandbox
instruction to the prompt, succeeded, passed **21/21** browser checks, and was approved as **v1**.
This was a **retake with an added sandbox instruction**, not an identical retry.

**Modification.** Muse Spark modified the approved v1 in place (`aeb6b175…`, base version 1). It
added task priorities and a high-priority remaining count, passed **25/25** browser checks, and was
approved as **v2**. Version history keeps v1 recoverable.

**Live memory-conflict refusal.** A later request asked for a countdown timer (`0ecc11a0…`). The
model returned the approved file unchanged and explained that the project's remembered no-countdown
rule forbade it. The job was **rejected** because there was nothing to promote. Decision Guard
returned `not_verified` with **0 findings**: it did not detect, block or certify anything here.

FocusFlow limitations, stated plainly:

- Model identity is the **configured** `muse-spark-1.3-contributor`; the job records do not persist
  an independently observed per-job model id.
- Retrieved memory is proven (four decisions were supplied to the modification); it does **not**
  independently establish causation for any visual choice.
- The v2 approval records `can_rollback: true`, but **rollback was not executed on FocusFlow**. The
  rollback capability is proven by the fixture workflow suite.
- The approval-time runtime checker is primarily **load-time** verification. Interaction checks are
  a separate Playwright validation.
- Exported HTML does **not** retain the Studio's sandbox protections; opening it from disk runs it
  unsandboxed.
- Some applications rely on approved CDN dependencies (for example a pinned Phaser build).

---

## Quickstart

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | **>= 24.0.0** | Uses the built-in `node:sqlite` module (no native build) |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Meta Muse Code CLI | 1.4.x | `muse` on `PATH`, logged in (`muse login`) |

Verified on Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13, SQLite 3.53.4.

### Run it

```bash
git clone https://github.com/sidonsoft/muse-recall.git muse-recall && cd muse-recall
pnpm install
cp .env.example .env          # defaults are already local-first

pnpm dev                      # API on :8787 and web on :5173
```

Open <http://127.0.0.1:5173>. HTML Studio is the landing surface. To load the
deterministic recorded demo (project `forge-demo`, three project decisions, v1 approved),
run `pnpm demo:seed` once before `pnpm dev`. Press **live check** on the System screen to
confirm real inference, then use **Memory** to inspect, correct, delete, and explain
retrieval.

### Verify, don't trust

```bash
pnpm verify                 # lint + typecheck + tests (811 passed, 3 skipped)
pnpm build                  # production web + server build
pnpm muse:probe             # real headless Muse call with latency and token usage
MML_LIVE_MUSE=1 pnpm test   # adds 3 live integration tests against Muse
pnpm verify:runtime         # load-time browser check used by HTML Studio approval
pnpm verify:security        # browser reproduction: foreign-origin rollback rejected, same-origin allowed
pnpm verify:research        # Phase 15B: 32 hashes, order, counts, Fisher p, recovered bundle
pnpm verify:research16      # Phase 16/16B: locked hashes, order, detector counts, Fisher p (python3)
pnpm verify:research17      # Phase 17: 480 runs, lock, inventory, exact p-values (python3)
pnpm verify:formsandbox     # native submission blocked; JS/Enter interactions work
pnpm verify:forge-workflow  # backend generate/stage/diff/approve/reject/rollback
pnpm verify:studio-workflow # managed Chromium (or FORGE_RUNTIME_BROWSER=firefox):
                            # generate, review, approve, modify, reject, rollback,
                            # restart recovery, interrupted generation, a11y asserts,
                            # visual baselines (3 regions per engine, CI-recorded);
                            # deterministic fake provider
pnpm verify:forge           # HTML Studio browser loop (FORGE_VERIFY_BASE, default :5173)
pnpm mcp:serve              # stdio MCP server (six tools, one shared contract) — see below
pnpm verify:browser         # broad product UI smoke (VERIFY_URL, default :5173)
pnpm demo:seed              # seed the recorded demo project and its decisions
pnpm bench:retrieval        # retrieval latency, selectivity, accuracy, stale rate
pnpm bench:muse-overhead    # repeated real Muse calls; token variance and memory cost
pnpm demo:sessions          # Demo A + B against real Muse, writes evidence JSON
pnpm bench:context          # Demo C: baseline history vs retrieved memory
pnpm eval:retrieval         # 22 retrieval questions, optional real Muse answers
pnpm demo:tools             # real Muse plans tools; writes approved through the API
pnpm demo:showcase          # Demos A, B, D, E end to end (fresh database recommended)
pnpm eval:comparison        # persistent memory vs inline facts (n=4 per configuration)
pnpm eval:guard             # advisory Decision Guard accuracy corpus
```

### MCP endpoint (Model Context Protocol)

`pnpm mcp:serve --project <project-id> --db <path>` (or `DATABASE_PATH`) exposes the same
six bounded tools the session runtime enforces — over stdio, from the **same tool
registry**, with input *and* output JSON Schemas and a `mcp-recall://contract` resource
that publishes the contract version, project scope, and write policy. Scope and the
writes policy are fixed at startup: a model sharing this endpoint cannot retarget the
project or self-confirm a write (`--allow-writes` is the operator's switch). Point any
MCP client at the command; the beta ships the server, not an in-product MCP client.

```bash
pnpm mcp:serve --project demo --db ./data/muse-recall.db            # reads only (default)
pnpm mcp:serve --project demo --db ./data/muse-recall.db --allow-writes
```

`verify:studio-workflow` needs a production build and the Playwright-managed Chromium
(`pnpm build && pnpm exec playwright-core install chromium`). CI runs the same 45 checks on a
second engine (managed Firefox) as a matrix leg. The script preflights the browser and
fails with an actionable message if it is missing; it does not fall back automatically.
It starts its own API, web preview, database, workspace and ports; it never touches the
development servers.

**Verification labels are not interchangeable.** `node --check`/HTML validation is
syntax and structure only. The approval gate loads the staged page once in a browser
(successful loading). `verify:studio-workflow` drives representative interactions.
None of that is human review: reading the diff, playing the preview, and judging the
design remain manual.

`pnpm bench:retrieval` on the reference machine:

```
130 memories · 300 retrievals · latency p50 0.20 ms
accuracy 100% (30/30) · correction 100% (12/12) · stale rate 0.000%
```

### Offline / CI mode

Set `MODEL_PROVIDER=echo` to run without Muse, credentials, or network. The
deterministic provider is **not a model**: it is labelled as such in the API, the UI,
and the provider capability notes, and it refuses to impersonate Muse. Tests use it by
default.

---

## Project status

> **Release state (2026-10-29).** `main` includes the local-beta hardening merge (PR #1), the
> Phase 17 results and citations (PRs #2 and #3), the live-run fixes (PRs #5–#8 and #10), the
> refreshed README, screenshots and user guide (PRs #11, #12 and #14), the committed 2:50 demo
> video (PR #15) and a one-click Codespaces environment (PR #17). The tags `submission-v14`,
> `submission-v15` and `phase17-preregistration` remain frozen. The application is local-only
> and not deployed; the [project website](https://sidonsoft.github.io/muse-recall/) is a static landing page. The repository
> is public (29 October 2026). The hackathon submission has not been sent: completing the form is
> the remaining owner action. See the [submission checklist](docs/SUBMISSION_CHECKLIST.md) and the
> [submission evidence map](docs/submission/EVIDENCE_MAP.md).

| Area | Phase | State |
| --- | --- | --- |
| Monorepo, TypeScript, lint, tests, CI | 1 | **Complete** |
| Fastify API + `/api/health` with a real write round-trip | 1 | **Complete** |
| SQLite schema, migration runner, FTS5 index | 1 | **Complete** |
| Shared Zod contracts | 1 | **Complete** |
| Meta Muse provider adapter (real calls, streaming, usage) | 1 | **Complete**, verified live |
| React/Vite/Tailwind shell + HTML Studio workspace | 1 | **Complete** |
| Memory CRUD, provenance, dedupe, supersession, deletion | 2 | **Complete** |
| Retrieval: ranking, budgets, evidence, context rendering | 2 | **Complete** |
| Memory Inspector UI: search, filters, correction, history | 2 | **Complete** |
| Retrieval + Muse token benchmarks | 2 | **Complete**, measured |
| Agent runtime, sessions, streaming, bounded context | 3 | **Complete** |
| Explicit memory capture + candidate confirmation | 3 | **Complete** |
| Cross-session retrieval evaluation (22 questions) | 3 | **Complete**, 20/22 |
| Declarative UI protocol, validation, renderer | 4 | **Complete** |
| Muse-generated planning forms + submission loop | 4 | **Complete**, verified live |
| Typed tool registry, permissions, audit log | 5 | **Complete** |
| Muse-planned tool calls with write approval | 5 | **Complete**, verified live |
| Evaluation comparison (n=4 per configuration) | 6 | **Complete**, measured |
| Integrated showcase (Demos A–E) | 6 | **8/8 checks**, real Muse |
| Product strategy and competitive validation | 7 | **Complete** |
| Muse Forge prototype, WebGL capture, runtime gate | 9–10 | **Complete**, recorded |
| Real-model reliability trials + release readiness | 11 | **Complete**, 5/5 real trials |
| Creative-memory A/B/C evaluation | 11–12 | **Complete**, directional (one run per condition) |
| Decision Guard engine + accuracy audit | 12 | **Complete**, advisory only; v1.2.0 audited |
| Release-candidate hardening | 12E | **Complete** |
| Hackathon submission package | 13 | **Complete** |
| Demo production + rollback-ancestry fix | 14A | **Complete**, verified |
| Independent submission/evidence audit | 14B | **Complete** on a separate branch; not merged |
| Final recording clearance | 14C | **Complete** |
| Product repositioning + UX audit/design system | polish | **Complete**, merged into the release candidate |
| HTML Studio: preview, source, diff, artifact integrity, disclosed export | polish | **Complete**, merged into the release candidate |
| General HTML application validation + runtime gate | polish | **Complete**, tested |
| Live FocusFlow generation, modification and memory-conflict refusal | live demo | **Complete**, evidence preserved |
| Phase 15B child-safety research trial | 15B | **Complete**, integrated with provenance and deviations |
| Cross-origin state-mutation guard + regression tests | security | **Complete** |
| Final release integration and verification | release | **Complete**; released to `main` by fast-forward (`328092c`) |
| Phase 16 three-arm trial (Muse Spark) and 16B replication (Muse Spark Open) | 16 / 16B | **Complete**; evidence and verifier published |
| Phase 17 four-arm trial across two games and one app, two models | 17 | **Complete**; evidence, exact-p correction and strict verifier published |
| Earlier demo cut (Ocean Pairs, 2:46, 1080p) | release | **Complete**, QA'd; predates the explicit-correction cut |
| Submission demo cut (correctable memory, 2:50, 1080p) | demo | **Recorded and QA'd** 2026-10-29; committed under `docs/demo/video/` |
| User guide (`docs/guide/`) and refreshed README captures | docs | **Merged to `main`** via PRs #11, #12 and #14 |
| One-click Codespaces environment for judges (offline provider) | docs | **Merged to `main` via PR #17**; generation still needs the Muse CLI |
| Project website (static landing page with the 2:50 video) | website | **Published** at [sidonsoft.github.io/muse-recall](https://sidonsoft.github.io/muse-recall/) |
| Make the repository public | — | **Done** 29 October 2026 |
| Submit the hackathon form | — | **Owner action pending**; not performed |
| Post-hackathon local-beta hardening | hardening | **Merged to `main` via PR #1** (branch tip `5bd287a`; merge `12918fd`) |
| Phase 17 results and review disposition | 17 | **Merged to `main` via PR #2** (`53389a7`) |
| Phase 17 documentation citations | 17 | **Merged to `main` via PR #3** (`36fe700`) |

The UI's **System** screen reads its module states (memory engine, agent runtime, Muse
integration and so on) from `GET /api/meta` rather than hard-coding them.

### Evidence classes

The submission documents label each claim so a reviewer can tell them apart:

1. **Authentic Muse output** — recorded real model generations and edits (for example
   `experiments/muse-forge/game/index.html`, `demo/forge-baseline/index.html`, and the
   Phase 11 trials).
2. **Synthetic test cases** — fixtures and generated corpora, including the Decision
   Guard accuracy corpus and the synthetic secrets used by redaction tests.
3. **Deterministic replay** — tests and the offline `echo` provider; deterministic, not a
   model.
4. **Independent verification** — the Phase 14B audit, produced on its own branch and
   deliberately not merged.
5. **Development documentation** — phase reports, plans and the development log.

See [docs/submission/EVIDENCE_MAP.md](docs/submission/EVIDENCE_MAP.md) for the
claim-by-claim mapping.

---

## Memory engine at a glance

```
create ─► dedupe (SHA-256 of type|scope|project|normalised content)
        └─► store ─► active

correct ─► one transaction: insert/reuse replacement + supersession edges
            + flip old rows to 'superseded' + append history

delete  ─► FTS row removed + status 'deleted' + hidden from every read endpoint

retrieve ─► SQL hard filters (status, scope, expiry, type)
            → score = 0.40 relevance + 0.20 scope + 0.15 confidence
                    + 0.10 validation + 0.10 recency + 0.05 type priority
            → 2 reserved slots for constraints/goals, rest by score
            → budget: 8 memories / 4,000 chars / 1,000 chars each
            → results + component scores + evidence + metadata
```

Budgets are configuration, not architecture: `MEMORY_MAX_MEMORIES`,
`MEMORY_MAX_CHARACTERS`, `MEMORY_MAX_MEMORY_CHARACTERS`.

![A conversation answering from active project memory](docs/assets/readme-2026-10-29/conversation.png)

![A declarative planning form in the current conversation interface](docs/assets/readme-2026-10-29/planning-form.png)

![A pending tool call awaiting explicit approval](docs/assets/readme-2026-10-29/tool-approval.png)

![Current memory detail showing provenance and correction history](docs/assets/readme-2026-10-29/memory-detail.png)

![Forge retrieval explanation showing active decisions, score components and rendered context cost](docs/assets/readme-2026-10-29/memory-retrieval.png)

Interface screenshots were refreshed on 29 October 2026 using the current application and
disposable demo data. The Studio capture replays recorded Muse-generated application bytes;
the supporting captures use deterministic offline fixtures. They show current UI behavior,
not new live-model results. Historical screenshots and trial evidence remain unchanged.

The retrieval screenshot uses the visible two-memory override to show a budget exclusion;
Forge defaults to six. [Capture provenance and reproduction](docs/assets/readme-2026-10-29/README.md).

See the [user guide](docs/guide/README.md) for setup, project memory, HTML Studio, architecture
and limitations.

---

## Declarative UI vs HTML Studio

The repository has two deliberately different execution models; do not conflate them:

| Surface | What the model produces | How it runs | What it can do |
| --- | --- | --- | --- |
| Generated interface (`packages/ui-protocol`) | Validated JSON blocks from a closed schema (heading, text, form, table, …) | Rendered by a fixed React registry | No model-authored JavaScript; values are validated against the stored surface |
| HTML Studio / Forge | One `index.html` with inline CSS and JavaScript, staged as a job | Only inside `<iframe sandbox="allow-scripts">` with a restrictive CSP and an opaque origin | Arbitrary client-side JavaScript inside the frame; no access to app storage, cookies, or the app origin |

The Studio preview is not imported into the application origin and is not evaluated by
the server. Downloaded HTML loses the sandbox and runs as an ordinary local file; the UI
says so. The server-side runtime check loads the staged document with network blocked
except the approved CDN, but that is a one-shot load check, not a sandbox for later
interaction.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live` | Liveness; touches nothing |
| `GET` | `/api/health` | DB write round-trip, schema version, provider state |
| `GET` | `/api/health?probe=live` | Same, plus a real (cached) model round-trip |
| `POST` | `/api/health/muse` | Force a live Muse check |
| `GET` | `/api/meta` | Provider capabilities, retrieval config, honest module status |
| `POST` | `/api/provider/generate` | Bounded raw model call (test bench, no memory) |
| `GET` | `/api/memories` | List/search/filter with paging |
| `POST` | `/api/memories` | Create (201) or deduplicated replay (200) |
| `GET` | `/api/memories/:id` | Detail: provenance, history, supersession chain |
| `PATCH` | `/api/memories/:id` | In-place edit with a history entry |
| `POST` | `/api/memories/:id/correct` | Transactional supersession |
| `DELETE` | `/api/memories/:id` | Soft delete with reason (final through the API) |
| `GET` | `/api/memories/:id/history` | Audit trail |
| `GET` | `/api/memories/stats` | Lifecycle counts |
| `GET` | `/api/projects` | Scope anchors |
| `POST` | `/api/forge/projects` | Create/open an HTML Studio project |
| `GET` | `/api/forge/projects/:id` | Project state, version history, jobs |
| `POST` | `/api/forge/projects/:id/generate` | Stage a new application (202 job) |
| `POST` | `/api/forge/projects/:id/modify` | Stage a change; screenshot optional (202 job) |
| `GET` | `/api/forge/jobs/:jobId` | Job status, usage, recorded decision ids |
| `POST` | `/api/forge/jobs/:jobId/cancel` | Request cancellation |
| `GET` | `/api/forge/jobs/:jobId/diff` | Staged source diff, validation, advisory guard |
| `POST` | `/api/forge/jobs/:jobId/approve` | Promote the verified bytes (human approval) |
| `POST` | `/api/forge/jobs/:jobId/reject` | Delete the staging copy; current version untouched |
| `POST` | `/api/forge/projects/:id/rollback` | Restore the recorded parent version |
| `GET` | `/api/forge/projects/:id/artifact` | Approved or staged HTML as data (source/export) |
| `GET` | `/api/forge/projects/:id/preview` | Sandboxed preview document (opaque origin) |
| `POST` | `/api/retrieval/preview` | Ranking + evidence + the exact prompt block |
| `POST` | `/api/sessions` | Create a conversation (optional project scope) |
| `GET` | `/api/sessions` | List conversations |
| `GET` | `/api/sessions/:id` | Transcript with per-turn retrieval evidence |
| `PATCH` | `/api/sessions/:id` | Rename or archive |
| `DELETE` | `/api/sessions/:id` | Delete a conversation |
| `POST` | `/api/sessions/:id/messages` | Streaming turn (SSE) or JSON `TurnResult` |
| `GET` | `/api/sessions/:id/ui` | Generated interfaces and their submissions |
| `POST` | `/api/sessions/:id/ui` | Generate a validated interface for an intent |
| `POST` | `/api/sessions/:id/ui/:surfaceId/events` | Submit an interface; the agent continues |
| `GET` | `/api/tools` | The tool registry with JSON input schemas |
| `GET` | `/api/sessions/:id/tools` | Tool-call audit for a conversation |
| `POST` | `/api/sessions/:id/tools/:callId/decision` | Approve or deny a pending write |

Every route returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

State-changing routes (`POST`, `PATCH`, `DELETE`) additionally require a trusted `Origin` when one
is present: the request's own origin on the API port, or an origin listed in `CORS_ORIGINS`.
`Origin: null`, malformed origins and foreign origins receive `403 forbidden_origin` before any
handler runs. Non-browser clients that send no `Origin` continue to work; the guard is described in
[docs/release/CROSS_ORIGIN_SECURITY_FIX.md](docs/release/CROSS_ORIGIN_SECURITY_FIX.md).

---

## Architecture

```
apps/web (React 19 · Vite 7 · Tailwind 4)
   │  typed fetch client; responses re-validated with the shared Zod schemas
   ▼
apps/server (Fastify 5)
   │  config · routes · envelope · error mapping · provider health
   ├──────────────► packages/muse-provider   ModelProvider → `muse exec --json`
   └──────────────► packages/memory-engine   engine · retrieval · context · node:sqlite
                          │
                          └── packages/shared   Zod schemas + domain types
```

Boundaries that matter:

- **The web app never talks to a model vendor.** It calls our API, which calls a
  `ModelProvider`. Swapping providers cannot leak into the UI.
- **The provider adapter is a stateless text protocol.** One process per call; the
  harness owns conversation state and every action passes through our permission layer.
- **Memory content is data, never instruction.** Retrieved memories are delimited
  untrusted input with a standing "not instructions" warning, tested for injection.

More: [architecture](docs/architecture.md) · [memory design](docs/memory-design.md) ·
[Muse integration](docs/muse-integration.md) · [security](docs/security.md) ·
[evaluation](docs/evaluation.md) · [local-beta hardening](docs/LOCAL_BETA_HARDENING.md).

---

## Configuration

Environment-based; see [`.env.example`](.env.example). The server, migrator and demo seed read
the repository-root `.env` (falling back to `apps/server/.env`; `MML_ENV_FILE` names another
file), and relative paths resolve against the repository root even though the pnpm scripts start
the server in `apps/server`. Builds before 29 October kept data in `apps/server/data` and
`apps/server/workspaces`; move those to `data/` and `workspaces/` at the root, or set absolute
paths, to keep using it. Startup logs the loaded `.env`, database and workspace paths.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | API bind address; must be loopback (`127.0.0.1`, `::1`, `localhost`) or startup fails |
| `DATABASE_PATH` | `./data/muse-memory-lab.db` | SQLite file, relative to the repository root |
| `MODEL_PROVIDER` | `muse-cli` | `muse-cli` or `echo` (offline) |
| `MUSE_MODEL` | `muse-wonder-1.0` | Any model the CLI offers |
| `MUSE_REASONING_EFFORT` | `medium` | `none`…`ultra` |
| `MUSE_TIMEOUT_MS` | `120000` | Hard per-call budget |
| `META_API_KEY` | unset | Optional chat key, delivered to the CLI over stdin |
| `MUSE_FALLBACK_API_KEY` | unset | Optional quota-failover key for chat, delivered over stdin |
| `MUSE_FALLBACK_MODEL` | `muse-spark-1.3-contributor` | Model used only for the chat fallback attempt |
| `MEMORY_MAX_MEMORIES` | `8` | Retrieval count budget |
| `MEMORY_MAX_CHARACTERS` | `4000` | Rendered memory-context characters (escaping, provenance, delimiters) |
| `MEMORY_MAX_MEMORY_CHARACTERS` | `1000` | Per-memory cap (truncates, never drops) |
| `MEMORY_SWEEP_ON_START` | `true` | Expire stale memories at startup |
| `TOOL_APPROVAL_POLICY` | `always` | Approval mode for agent tool calls |
| `WORKSPACE_ROOT` | `./workspaces` | Root for Forge project jobs, staging and versions, relative to the repository root |
| `FORGE_MUSE_BIN` | unset | Override the Muse CLI binary used only by Forge |
| `FORGE_MUSE_MODEL` | unset | Forge model id (for example `muse-spark-1.3-contributor`) |
| `FORGE_REASONING_EFFORT` | `low` | Forge reasoning tier |
| `FORGE_MAX_RUNTIME_MS` | `600000` | Hard wall-clock budget per Forge job |
| `FORGE_RUNTIME_BROWSER` | `managed` | Runtime verification browser: `managed` or explicit `chrome` |
| `MML_ENV_FILE` | unset | Read this `.env` file instead of the repository-root or `apps/server` one; it must exist |

The API key never reaches the browser: the server shells out to the Muse CLI, which
uses its own stored login (or a `META_API_KEY` delivered over stdin).

---

## Repository layout

```
.devcontainer/     Codespaces setup: Node 24, offline provider, seeded demo project
apps/
  server/          Fastify API, config, routes (health, provider, memories, retrieval)
  web/             React shell, typed client, memory inspector
packages/
  shared/          Zod schemas: memory, retrieval, evaluation, health, provider, meta, forge
  decision-guard/  pure advisory source-pattern engine
  memory-engine/   engine (writes), retrieval (scores), context (prompt rendering)
  muse-provider/   ModelProvider impls: Muse CLI adapter + offline echo
tests/
  unit/            schemas, engine, retrieval, context, provider parsing, config
  integration/     HTTP contract tests + opt-in live Muse tests
  evaluation/      baseline vs memory-enabled harness
docs/              architecture, memory design, evaluation, Muse findings, status
  guide/           user guide: setup, project memory, HTML Studio, architecture, limits
  demo/video/      the 2:50 submission video, captions, transcript and QA
  hackathon-evidence/  locked research records (checksummed; do not edit)
scripts/           benchmarks, Muse probe, browser verification
```

The repository is published as `sidonsoft/muse-recall`. Internal identifiers keep the working
name — `@mml/*` packages, the `muse-memory-lab` default database filename, and some historical
documents — and refer to the same codebase.

---

## Evaluation (measured)

`pnpm eval:comparison` — two tasks × two trials, single call per configuration:

| Metric | Facts inline | Memory | Delta |
| --- | --- | --- | --- |
| Input tokens (mean) | 16,849 | 16,916.5 | +67.5 |
| Correct answers | 4/4 | 4/4 | — |
| Retrieved memories (mean) | 0 | 2.5 | — |

Correction check: the superseded memory is absent from active retrieval. Project isolation:
0 leaked memories. Across a multi-turn task, memory removes a setup turn (2 turns / 33,671
tokens → 1 turn / 16,900). Sample size is small; no significance is claimed. Full report:
[docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md).

Later phases add real-model evidence: five Phase 11A modification trials (5/5 approved,
all rolled back), the Phase 12A/12C memory-influence A/B/C trial (one run per condition),
the Phase 14A rehearsal and rollback-ancestry records, the Phase 15B 32-run trial, and the
Phase 16 / 16B trials below.
Those artefacts are indexed in
[docs/submission/EVIDENCE_MAP.md](docs/submission/EVIDENCE_MAP.md) with their evidence
class and limitations.

### Phase 16 / 16B: remembered rule vs palette-only memory, two models

Phase 16 locked a detector built on Phase 15B's corrected definitions, added a palette-only arm
to separate "the rule helps" from "memory helps", and ran 48 fresh edits on Muse Spark through
the production HTML Studio path. Phase 16B repeated the same cells on Muse Spark Open (Baseten).
The table below reports usable-output counts for the original rule.

| Project memory | Muse Spark | Muse Spark Open | Combined |
| --- | ---: | ---: | ---: |
| None | 12/12 | 16/16 | **28/28** |
| Palette decisions only | 12/12 | 6/6 | **18/18** |
| Child-safety rule + palette | **0/13** | **0/14** | **0/27** |

> **Correction (2026-10-28).** The Muse Spark Open figures were first published as 6/16
> (palette only) and 0/16 (rule), because 12 truncated outputs had been scored as clean. The
> demo video shows the corrected figures. See
> [the correction](docs/hackathon-evidence/phase16b/CORRECTION_1.md).

- Pre-registered contrasts (Holm, α = .025): rule vs no memory and rule vs palette only, on each
  model. All four are significant (largest p = 2.6 × 10⁻⁵, rule vs palette only on Muse Spark
  Open, 0/14 vs 6/6).
- Phase 16B correction: 12 open-model outputs cut off at the token limit had been scored as clean;
  they are now unusable. This removed an apparent palette-only effect on the open model. See
  [CORRECTION_1.md](docs/hackathon-evidence/phase16b/CORRECTION_1.md).
- Unusable runs: 11/48 on Muse Spark (runtime, call or token budget) and 12/48 on Muse Spark Open
  (output token limit). Counting every unusable run as a violation still gives 3/16 vs 16/16
  (Muse Spark) and 2/16 vs 16/16 (Open) for rule vs no memory.
- Every Phase 16 job record lists the decisions retrieval supplied: 0, 1 and 2 across the arms.
- Phase 16B used a chat completion with the production prompt builder rather than the CLI tool
  loop, and its memory block was written in the production format rather than retrieved. Both
  deviations are declared in its protocol.
- The protocol lock times are local file times on the operator's machine, not an external
  registration.

Evidence card: [docs/hackathon-evidence/phase16/EVIDENCE_CARD.md](docs/hackathon-evidence/phase16/EVIDENCE_CARD.md).
`pnpm verify:research16` re-derives every count and p-value from the committed outputs with the
locked detector (requires `python3`).

### Phase 17: four arms across two games and a non-game app, two models

Phase 17 asked whether the effect survives a wider test. 480 runs: 4 arms × 6 strata × 2 models.
The strata are two games (Farmyard Memory Match, Orchard Catch) × two requests, and FocusFlow (a
task planner) × two requests; the rules are child safety on the games and calm motion on
FocusFlow. The arms are `none`, `memory` (rule retrieved from project memory), `manual` (the same
rule retyped into every request) and `corrected` (the rule is superseded through the production
correction path before the edit: the HTTP correction route on Muse Spark, `MemoryEngine.correct()`
on Open). The protocol, detectors, runners and analysis were locked in
`protocol.sha256` and pushed to GitHub before the first run.

- **H1** `memory` vs `none`: 37/57 (65%) → **0/58** on Muse Spark, exact p = 6.5 × 10⁻²⁰;
  49/60 (82%) → **1/60** on Muse Spark Open, exact p = 1.1 × 10⁻²⁴.
- **H2** `memory` is not worse than `manual` (the same rule retyped into every request): upper
  90% bound of the difference +4.5 pp (Muse Spark) and +7.1 pp (Open), both inside the
  pre-registered +15 pp margin. This is non-inferiority to retyping, not evidence that memory
  is better than a well-written prompt; the point is that Recall supplies the context.
- **H3** `corrected` vs `memory`: 41/59 vs 0/58 (p = 6.9 × 10⁻²¹) and 50/60 vs 1/60
  (p = 1.6 × 10⁻²⁴). H3's detector measures the *original* rule. The higher corrected-arm
  rate suggests the superseded restriction was released; it does **not** test whether a
  replacement requirement is followed. Phase 17's correction was permissive; it did not substitute
  a replacement requirement. The focused cut's sunset-to-ocean replacement is Phase 12A
  evidence, one run per condition.
- 8 of 240 Muse Spark runs hit the pre-registered 30-minute runtime cap and are unusable
  (counted, never retried); Muse Spark Open had 0 unusable runs. The worst-case table counts every
  unusable run as a violation and does not change a verdict.
- **Post-run correction (2026-10-29):** the first report's p-values came from a locked tail rule
  with an absolute 1e-15 floor, so nine of twelve were upper bounds. They are now reported exactly,
  recomputed from the same records; the as-run artefact is preserved and no verdict changed. See
  [STATS_CORRECTION.md](docs/hackathon-evidence/phase17/STATS_CORRECTION.md).

Results: [RESULTS.md](docs/hackathon-evidence/phase17/RESULTS.md). Review and audit:
[REVIEW_DISPOSITION.md](docs/hackathon-evidence/phase17/REVIEW_DISPOSITION.md).
`pnpm verify:research17` checks the lock, the 1205-file evidence inventory, the preserved as-run
values and the corrected analysis (requires `python3`). The PR #2 review disposition records an
independent read-only audit of all 480 records and the fixes for four reporting/verifier defects;
six further issues in locked files (five latent conditions that did not occur, plus one
cosmetic detector-description error) are documented rather than patched.

### Phase 15B child-safety memory trial (earlier, superseded by Phase 16)

> In a preregistered 32-run trial using one Muse Spark model, one game and one modification
> request, 15 of 16 edits without project memory added a countdown, full-screen flash or score
> deduction. With project memory, the original automated coding flagged 5 of 16. A post-hoc review
> identified those five flags as references to "no penalties"; corrected coding found 0 of 16 under
> its narrower operational definitions. The original scoring script was not preserved, but its
> per-run output is available.

- **Pre-registered comparison (original automated coder, v1):** 15/16 without memory vs 5/16 with,
  two-tailed Fisher exact **p = 0.000635**.
- **Post-hoc corrected coder (v2):** 15/16 vs 0/16, **p = 5.66 × 10⁻⁸**. The correction was made
  after unblinding and is **not** confirmatory.
- The protocol pre-registered the **rubric text**, not scoring code. The v1 implementation was never
  committed and was overwritten; only its per-run output survives.
- Scope: one model, one game, one remembered rule, one request, edit path only. The memory arm
  carried the full project decision set, so the contrast is project memory present vs absent.
- The corrected coder counts countdowns, full-screen flashes and score deductions. It does not count
  streak resets or shortened reveal times; some memory-arm outputs contain those under a broader
  reading of "penalty".

Evidence card: [docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md](docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md).
Provenance: [PROVENANCE_MANIFEST.md](docs/hackathon-evidence/phase15b/PROVENANCE_MANIFEST.md).
Deviations: [DEVIATIONS.md](docs/hackathon-evidence/phase15b/DEVIATIONS.md).
Phase 15A is published separately as a six-run **pilot**, not pooled with Phase 15B.

## Submission materials

- [Submission checklist](docs/SUBMISSION_CHECKLIST.md) — requirements status and owner actions
- [Judge entry-point audit](docs/release/JUDGE_ENTRY_POINT_AUDIT.md) — README, website and submission text checked against the 15 / 60 / 90-second goals
- [Project website](https://sidonsoft.github.io/muse-recall/) — the one-page overview with the 2:50 video
- [User guide](docs/guide/README.md) and [Codespaces notes](.devcontainer/README.md)
- [Submission copy](docs/submission/SUBMISSION_COPY.md) — current short and long descriptions
- [Submission demo cut](docs/demo/CORRECTABLE_MEMORY_DEMO.md) — the 2:50 recorded correction sequence, its beats, narration and honest failure note ([watch](docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true))
- [Phase 17 results](docs/hackathon-evidence/phase17/RESULTS.md), [exact-p correction](docs/hackathon-evidence/phase17/STATS_CORRECTION.md) and [review disposition](docs/hackathon-evidence/phase17/REVIEW_DISPOSITION.md)
- [Phase 16 / 16B evidence card](docs/hackathon-evidence/phase16/EVIDENCE_CARD.md) — the earlier two-model research shown in the 2:46 fallback video
- [Live FocusFlow validation](docs/demo/NON_GAME_HTML_VALIDATION.md) and [live configuration](docs/demo/LIVE_MUSE_CONFIGURATION.md)
- [Phase 15B evidence card](docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md), [provenance](docs/hackathon-evidence/phase15b/PROVENANCE_MANIFEST.md) and [deviations](docs/hackathon-evidence/phase15b/DEVIATIONS.md)
- [Cross-origin security fix](docs/release/CROSS_ORIGIN_SECURITY_FIX.md) and [final integration report](docs/release/FINAL_INTEGRATION_REPORT.md)
- [Product positioning](docs/PRODUCT_POSITIONING.md) — identity, claims register, honesty boundaries
- [HTML Studio assessment](docs/HTML_STUDIO_ASSESSMENT.md) — capability, security, export, scope
- [UX audit](docs/UX_AUDIT.md) and [design system](docs/DESIGN_SYSTEM.md)
- [Evidence map](docs/submission/EVIDENCE_MAP.md) and [project story](docs/submission/PROJECT_STORY.md)
- [Evaluation report](docs/EVALUATION_REPORT.md) and [architecture overview](docs/ARCHITECTURE_OVERVIEW.md)

## Known limitations

Full list in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). The ones that matter:

The [29 October live run](docs/hackathon-evidence/live-dsh-run-2026-10-29/FINDINGS.md)
found five issues now fixed on `main` in PRs #5–#8: missing Forge decisions, conflicting
storage instructions, preview storage errors, missed retired palettes, and hidden long timers
incorrectly passing the Guard. The [repeat run](docs/hackathon-evidence/live-dsh-run-2026-10-29/after/AFTER_FIXES.md)
is exploratory evidence, not a trial. Follow-up findings N1–N3 are now fixed on `main` in
[PR #10](https://github.com/sidonsoft/muse-recall/pull/10): Forge preview matches the injected
memory block and its cost, review preserves generation finish times, and corrections return
fresh superseded records. Corrections still require an explicit application-change request (F6).

- **Memory does not automatically save tokens.** Measured: the Muse CLI has a ~16,630
  token baseline, and a ~4k-character memory block adds ~877 tokens. Whether memory is
  a net saving depends on the history the baseline would otherwise carry.
- **Retrieval is keyword-only.** No embeddings yet. In a 22-question evaluation it answered
  20; the two misses are genuine vocabulary gaps, documented in
  [docs/evaluation.md](docs/evaluation.md).
- **Memory costs tokens on the answering call** (~37 in our measured task) but removes setup
  turns; the whole-task input roughly halved in Demo C.
- **Deletion is irreversible through the API.** That is the guarantee, not a bug.
- **Single-user, loopback-only.** No authentication or rate limiting; not production-ready for
  public multi-user hosting.
- **Runtime verification is load-time only.** HTML Studio approval loads the staged
  document in headless Chrome and rejects page/console errors, blocked network requests,
  or a blank render (Phaser documents must create a canvas). It does **not** exercise
  interactions, inspect pixels, or prove gameplay/application correctness.
- **General HTML support is deliberately narrow.** One self-contained `index.html`, no
  build step, inline CSS/JavaScript, and no network assets outside the approved CDN.
- **Export is not a self-contained bundle.** The download is the artifact as-is; a CDN
  reference still needs network access, and the interface says so.
- **The Decision Guard is advisory.** It checks source patterns against remembered
  decisions and cites evidence; it never blocks approval and is not compliance
  verification. It supports seven rule families over source text, not rendered behaviour,
  and its measured false positives, false negatives and abstentions are why enforcement is
  left to the human.
- **The A/B/C memory-influence trial is directional.** One run per condition, not a
  statistical result.
- **Phase 17 is bounded, and its correction result is easy to misread.** Six fixed strata
  (two games, one task planner), two rules, two requests per baseline and two models. It
  measures source-code patterns, not runtime behaviour. On Muse Spark 8 of 240 runs hit the
  30-minute cap and are unusable; Muse Spark Open had 0. The `corrected` arm's higher
  original-rule rate **suggests the superseded restriction was released**; it does not test
  whether a replacement requirement is followed. Phase 17's correction was permissive. Exact
  p-values are a post-run reporting correction, with the as-run analysis preserved. Nothing here
  establishes general application correctness, Decision Guard effectiveness, or transfer to
  untested tasks.
- **Phase 16 / 16B is bounded.** One baseline game, one request, one rule and two models. It
  measures code, not runtime behaviour. The rule arm also carries the palette. Phase 16B ran the
  task through a chat completion, not the CLI tool loop. A quarter of its runs were cut off at the
  output token limit and are unusable; excluding them is a disclosed post-hoc correction.
- **Phase 15B is bounded and partly post-hoc.** One model, one game, one remembered rule and one
  request; the corrected 0/16 coding was produced after unblinding and is not confirmatory. The
  original scoring code was not preserved and its loss is disclosed.
- **FocusFlow is a demonstration, not a causal experiment.** Retrieved memory is proven to have
  been supplied; it does not prove that memory caused a visual choice. Generation used a **retake**
  with an added sandbox instruction after attempt 1 was rejected. Rollback was recorded but not
  executed on FocusFlow.
- **Exported HTML runs unsandboxed.** The Studio preview is sandboxed; a downloaded file opened
  from disk is not, and it still needs network access for approved CDN dependencies.
- **The submission cut is one live run.** The 2:50 cut (recorded 29 October
  2026) shows the correction sequence, including the honest failure beat: the repeat request
  kept the old sunset palette and Guard flagged it, and only the explicit request for the
  current art direction produced the ocean version. It is committed under
  [`docs/demo/video/`](docs/demo/video/). The earlier 2:46 video remains the fallback; it does not show an explicit
  correction. See [the demo note](docs/demo/CORRECTABLE_MEMORY_DEMO.md).
- **Provider independence is an architectural direction, not a shipped capability.** The
  server has a `ModelProvider` boundary, but the shipped providers are the Muse Code CLI and
  the deterministic offline `echo` provider. Muse Spark Open was used for research on
  Baseten; the application does not call it, and arbitrary-provider support is not claimed.
- **Preview storage is temporary.** The sandboxed preview stores `localStorage` and
  `sessionStorage` in document memory, so it resets when the preview reloads; the exported file
  keeps data normally.
- **Out-of-box model defaults are not Muse Spark.** `.env.example` ships `muse-wonder-1.0`; the live
  demonstration explicitly configured `muse-spark-1.3` / `muse-spark-1.3-contributor` at
  `effort: high`. Check the model shown in the top bar before recording.
- **Cross-origin mutations are blocked, not authenticated.** A server-side Origin guard now rejects
  foreign and `null` origins on state-changing routes. It is proportionate for a single-user
  loopback tool; a multi-user deployment would still require authentication and CSRF tokens.
- **Forge jobs are durable on disk but single-process.** One JSON file per job, atomic
  replace, and startup recovery; there is no database transaction or multi-process lease.
  A queued/running job interrupted by a restart is marked `interrupted`, never resumed.
- **The Forge child is not OS-isolated.** `--workspace` roots the CLI's policy-gated tools
  and the child starts in the staging directory with a scrubbed environment, but it still
  runs with the server user's filesystem permissions. The CLI's own sandbox/approval flags
  are the remaining enforcement layer.
- **Browser coverage is representative, not exhaustive.** The managed workflow drives
  generation, review, approval, modification, rejection, rollback, restart recovery, an
  interrupted generation (server SIGKILLed mid-job), project drafts, explicit decision
  creation and approval verification — on managed Chromium in CI, plus the same script
  on managed Firefox as a second matrix leg. It asserts landmarks, live-status notices
  and dialog focus handoff, and compares three timestamp-free Studio regions against
  committed per-engine visual baselines; it is not a full visual-regression, pixel,
  gameplay, or accessibility audit.
- **Approval verification telemetry starts with this build.** Versions approved before
  this change have no recorded runtime hash/browser/timestamp; the UI says “not recorded”
  rather than implying the check passed.
- **Recovery notices are acknowledgeable, not erased.** Acknowledgement hides historical
  incidents for this workspace; it leaves job files and audit records in place. Active
  storage failures remain visible until a healthy storage check clears them.
- **Runtime browser selection is explicit.** The default is Playwright-managed Chromium;
  `FORGE_RUNTIME_BROWSER=firefox` selects managed Firefox (the CI second engine) and
  `=chrome` an explicit system-Chrome run. There is no automatic fallback after an
  arbitrary launch failure. On macOS 27, managed Firefox needs Playwright 1.65
  (upstream app-data fix); the other selections work today.
- **Studio identity is configured, not observed.** The Studio shows the configured Forge
  model; execution-time model telemetry is not independently recorded.

---

## Roadmap

1. **Hackathon submission.** The focused correction cut (2:50) is recorded, QA'd, committed
   under `docs/demo/video/`, linked from the opening section and shown on the
   [project website](https://sidonsoft.github.io/muse-recall/). Making the repository public and completing the submission form
   are owner actions; nothing is submitted automatically.
2. **Local beta hardening (merged).** Durable Forge jobs and restart recovery, bounded
   memory rendering, a scrubbed child environment, and managed browser coverage are on
   `main`. Remaining work is tracked in [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).
3. **Out of scope for this release.** Authentication, hosted collaboration, embeddings,
   multi-file generation, new model providers, additional Decision Guard rule families,
   interaction/pixel verification, and a verified self-contained export.

---

## License

MIT. See [LICENSE](LICENSE).
