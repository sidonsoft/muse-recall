# Muse Recall

### Build with Muse Spark. Remember what matters.

**Muse Recall** (monorepo `muse-memory-lab`) is a local-first **AI development workspace**
powered by Meta's Muse Spark. In **HTML Studio**, describe a browser application in
natural language; Muse Spark writes a complete `index.html`, you preview and inspect it,
refine it through further requests, and review every staged change before it becomes
current.

The differentiator is **persistent project decision memory**: a constraint, palette, or
technical choice survives across sessions, is retrieved into later prompts with
provenance, and can be corrected without erasing its history. An independent advisory
**Decision Guard** cites those decisions against a staged change, and **human approval,
rejection and rollback** leave the developer in control.

Games remain an excellent demonstration — the seeded project is a Muse-built memory game —
but the artifact contract is a general browser application, not a game. HTML Studio reuses
the existing Muse Spark pipeline; it is not a second generator.

> **Status: final release candidate on `agent/muse-recall-release-candidate`,
> based on `agent/muse-recall-final-p1-fixes` @ `62ff522`. `main` remains the approved
> Phase 14C release candidate. Submission not performed; the V2 video has not been
> rendered.** The candidate integrates the original Phase 15B research branch, publishes
> its recovered tooling and provenance disclosures, adds the live FocusFlow non-game
> demonstration, and closes the cross-origin state-mutation gap with a server-side guard.
> See [Project status](#project-status), the
> [submission evidence map](docs/submission/EVIDENCE_MAP.md), and the
> [final integration report](docs/release/FINAL_INTEGRATION_REPORT.md).

---

## What this is

A conventional assistant forgets everything between sessions, or compensates by
replaying an ever-growing transcript into the context window. Muse Recall takes the
other path:

- **HTML Studio** — the generated browser application is the hero. A sandboxed,
  interactive preview fills the workspace; **Preview**, **Source** and **Changes** expose
  the current version, the staged source, and a line diff. Generated HTML is served as
  data for inspection and download, never injected into the application origin.
- **Muse Spark development loop** — generation and modification are jobs over an approved
  `index.html`. Each job records the prompt it sent, that prompt's SHA-256, the decisions
  it retrieved, and its usage; a change is staged, reviewed, and only then promoted.
- **Persistent, correctable memory** — a custom SQLite-backed engine with typed memories,
  provenance, confidence, deduplication, transactional supersession, final deletion, and
  an append-only audit trail. Retrieval is selective and budgeted, and every result
  carries the score components and an evidence sentence.
- **Advisory Decision Guard** — compares source patterns against the same project
  decisions and cites them with evidence. It is advisory only: it never blocks approval
  and is not compliance verification.
- **Versioned rollback** — every approval promotes an immutable version, and rollback
  follows the recorded parent, so a non-linear history restores the right ancestor.
- **A controlled agent harness** — model provider, memory, tools, and permissions stay
  separate boundaries, so retrieved text can never widen its own authority.
- **Generative interface** — Muse returns a validated declarative UI spec rendered by a
  fixed component registry. No model-authored JavaScript ever runs.

---

## FocusFlow — the live non-game demonstration

The recorded demonstration is **FocusFlow**, a single-file personal task planner generated and
then modified by Muse Spark in HTML Studio. It is a genuine application, not a game: no canvas,
no game loop, no Phaser. The full provenance is in
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
pnpm verify                 # lint + typecheck + tests (549 passed, 3 skipped)
pnpm build                  # production web + server build
pnpm muse:probe             # real headless Muse call with latency and token usage
MML_LIVE_MUSE=1 pnpm test   # adds 3 live integration tests against Muse
pnpm verify:runtime         # load-time browser check used by HTML Studio approval
pnpm verify:security        # browser reproduction: foreign-origin rollback rejected, same-origin allowed
pnpm verify:research        # Phase 15B: 32 hashes, order, counts, Fisher p, recovered bundle
pnpm verify:formsandbox     # native submission blocked; JS/Enter interactions work
pnpm verify:forge-workflow  # backend generate/stage/diff/approve/reject/rollback
pnpm verify:forge           # HTML Studio browser loop (FORGE_VERIFY_BASE, default :5173)
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
| Final release integration and verification | release | **Complete**, awaiting director approval |
| Record/upload video and submit the form | — | **Owner action pending** |

The UI's **System** screen reads these states from `GET /api/meta`, so the app cannot
silently overstate itself.

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

![A new conversation answering from project memory](docs/assets/phase3-ui-conversations.png)

![A Muse-generated planning form](docs/assets/phase4-ui-generative-ui.png)

![A pending tool call awaiting approval](docs/assets/phase5-ui-tools.png)

![Memory detail with correction history](docs/assets/phase2-ui-memory-detail.png)

![Retrieval explanation with score components](docs/assets/phase2-ui-memory-retrieval.png)

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
[evaluation](docs/evaluation.md).

---

## Configuration

Environment-based; see [`.env.example`](.env.example). Relative paths resolve against
the process working directory (`apps/server` when run via the pnpm scripts).

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | API bind address |
| `DATABASE_PATH` | `./data/muse-memory-lab.db` | SQLite file |
| `MODEL_PROVIDER` | `muse-cli` | `muse-cli` or `echo` (offline) |
| `MUSE_MODEL` | `muse-wonder-1.0` | Any model the CLI offers |
| `MUSE_REASONING_EFFORT` | `medium` | `none`…`ultra` |
| `MUSE_TIMEOUT_MS` | `120000` | Hard per-call budget |
| `MEMORY_MAX_MEMORIES` | `8` | Retrieval count budget |
| `MEMORY_MAX_CHARACTERS` | `4000` | Combined injected characters |
| `MEMORY_MAX_MEMORY_CHARACTERS` | `1000` | Per-memory cap (truncates, never drops) |
| `MEMORY_SWEEP_ON_START` | `true` | Expire stale memories at startup |
| `TOOL_APPROVAL_POLICY` | `always` | Approval mode for future tool calls |

The API key never reaches the browser: the server shells out to the Muse CLI, which
uses its own stored login (or `META_API_KEY` in the server environment).

---

## Repository layout

```
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
scripts/           benchmarks, Muse probe, browser verification
```

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
the Phase 14A rehearsal and rollback-ancestry records, and the Phase 15B 32-run trial below.
Those artefacts are indexed in
[docs/submission/EVIDENCE_MAP.md](docs/submission/EVIDENCE_MAP.md) with their evidence
class and limitations.

### Phase 15B child-safety memory trial

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
- [Submission copy](docs/submission/SUBMISSION_COPY.md) — current short and long descriptions
- [Canonical V2 storyboard](docs/submission/V2_DEMO_RECORDING_PLAN.md) — the only current storyboard
- [Live FocusFlow validation](docs/demo/NON_GAME_HTML_VALIDATION.md) and [live configuration](docs/demo/LIVE_MUSE_CONFIGURATION.md)
- [Phase 15B evidence card](docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md), [provenance](docs/hackathon-evidence/phase15b/PROVENANCE_MANIFEST.md) and [deviations](docs/hackathon-evidence/phase15b/DEVIATIONS.md)
- [Cross-origin security fix](docs/release/CROSS_ORIGIN_SECURITY_FIX.md) and [final integration report](docs/release/FINAL_INTEGRATION_REPORT.md)
- [Product positioning](docs/PRODUCT_POSITIONING.md) — identity, claims register, honesty boundaries
- [HTML Studio assessment](docs/HTML_STUDIO_ASSESSMENT.md) — capability, security, export, scope
- [UX audit](docs/UX_AUDIT.md) and [design system](docs/DESIGN_SYSTEM.md)
- Superseded storyboards (historical, do not use for the V2 recording): [REVISED_DEMO_STORYBOARD.md](docs/submission/REVISED_DEMO_STORYBOARD.md), [DEMO_SCRIPT_3MIN.md](docs/submission/DEMO_SCRIPT_3MIN.md), [VIDEO_STORYBOARD.md](docs/VIDEO_STORYBOARD.md), [RECUT_BRIEF_PHASE15A.md](docs/submission/RECUT_BRIEF_PHASE15A.md)
- [Phase 14C recording clearance](docs/PHASE14C_RECORDING_CLEARANCE.md) and [demo runbook](docs/submission/DEMO_RUNBOOK.md)
- [Evidence map](docs/submission/EVIDENCE_MAP.md) and [project story](docs/submission/PROJECT_STORY.md)
- [Evaluation report](docs/EVALUATION_REPORT.md) and [architecture overview](docs/ARCHITECTURE_OVERVIEW.md)

## Known limitations

Full list in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). The ones that matter:

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
  verification.
- **The A/B/C memory-influence trial is directional.** One run per condition, not a
  statistical result.
- **Phase 15B is bounded and partly post-hoc.** One model, one game, one remembered rule and one
  request; the corrected 0/16 coding was produced after unblinding and is not confirmatory. The
  original scoring code was not preserved and its loss is disclosed.
- **FocusFlow is a demonstration, not a causal experiment.** Retrieved memory is proven to have
  been supplied; it does not prove that memory caused a visual choice. Generation used a **retake**
  with an added sandbox instruction after attempt 1 was rejected. Rollback was recorded but not
  executed on FocusFlow.
- **Exported HTML runs unsandboxed.** The Studio preview is sandboxed; a downloaded file opened
  from disk is not, and it still needs network access for approved CDN dependencies.
- **Out-of-box model defaults are not Muse Spark.** `.env.example` ships `muse-wonder-1.0`; the live
  demonstration explicitly configured `muse-spark-1.3` / `muse-spark-1.3-contributor` at
  `effort: high`. Check the model shown in the top bar before recording.
- **Cross-origin mutations are blocked, not authenticated.** A server-side Origin guard now rejects
  foreign and `null` origins on state-changing routes. It is proportionate for a single-user
  loopback tool; a multi-user deployment would still require authentication and CSRF tokens.

---

## Roadmap

1. **Hackathon submission.** Record and upload the three-minute video, confirm the
   repository is public for judging, and complete the submission form (owner actions;
   nothing is submitted automatically).
2. **Post-event hardening.** Additional Decision Guard rule families, interaction and
   pixel verification, verified self-contained export, and multi-user authentication
   remain out of scope for this release.

---

## License

MIT. See [LICENSE](LICENSE).
