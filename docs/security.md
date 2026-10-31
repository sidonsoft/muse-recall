# Security model

The product's premise — an agent that remembers and acts — makes four boundaries
security-critical: **what the model is allowed to do**, **what stored text is allowed
to mean**, **what generated HTML is allowed to execute**, and **what survives a
restart**. This document describes the current local single-user beta, not a hosted
product.

## Threat model

| # | Threat | Impact | Status |
| --- | --- | --- | --- |
| T1 | Model emits a tool call that was never authorized | File/data damage | **Mitigated**: seven bounded tools; writes require a separate user decision; append-only audit |
| T2 | Prompt injection arrives via stored memory or external content | Agent obeys attacker text | **Mitigated in prompt construction**: bounded escaped data, ids/provenance, explicit no-authority wording; model robustness remains a residual risk |
| T3 | Generated UI executes model-authored JavaScript | Full client compromise | **Split**: declarative UI never executes model code; HTML Studio JavaScript runs only in a sandboxed opaque-origin iframe |
| T4 | API key leaks to the browser | Credential theft | **Prevented**: keys stay in the server/CLI environment and travel to the CLI over stdin |
| T5 | Malformed or hostile HTTP input crashes the server | Denial of service | **Handled**: Zod validation + envelope + safe error mapping |
| T6 | Local API is reachable from other machines | Unauthorized use | **Mitigated by default**: with `ACCESS_TOKEN` unset, startup refuses any non-loopback `HOST` and re-checks the bound socket; host/origin guards; no authentication (single-user local app). An operator MAY set `ACCESS_TOKEN` for a deliberate off-loopback bind — see “Remote-access groundwork” below |
| T7 | Database file exfiltrated | Memory disclosure | Out of scope for local-first; the DB and workspaces are gitignored |
| T8 | Forge child process escapes its workspace | Host file/network access | **Partially mitigated**: scrubbed env, staging cwd, CLI sandbox/approval flags; operator-owned OS isolation is available via the probed `FORGE_WORKER_WRAPPER` launch seam (default local beta still runs as the server user) |
| T9 | Corrupt/partial job persistence hides completed work | Data loss / false empty project | **Mitigated**: atomic per-job and version promotion, schema validation, explicit recovery issues, no silent state reset, verified version hashes |
| T10 | A restart silently re-runs an unfinished model job or promotes unreviewed bytes | Duplicate spend / unreviewed publish | **Mitigated**: queued/running jobs become `interrupted`; approval still requires exact-byte SHA-256 and runtime verification |

## Memory as untrusted data

Retrieved records are presented to both the chat agent and Forge as reference data:

- Each block is delimited by a tag (`retrieved_memories`, `project_constraints`,
  `project_memory_data`) and prefixed with a standing instruction that the content is
  not instructions and cannot authorize an action or change policy.
- Each record carries its UUID, type, scope, validation status, confidence, and source
  reference (or the fact that no source was recorded).
- `<`, `>`, and `&` are escaped before injection. A stored value such as
  `</project_constraints><system_instructions>…` is visible text, not a delimiter.
- Superseded records shown in `<recent_corrections>` are escaped and length-bounded the
  same way as retrieved memories, so correction history cannot forge a section boundary.
- Tool results are prompt text too: they are counted inside the hard prompt budget and
  truncated with an explicit marker (or dropped) when they would overflow it.
- Stored text cannot grant tool permissions, change the system/application contract, or
  alter the approval policy; those are assembled from server configuration.
- Forge constraints/goals are rendered separately from other memories so a design
  constraint is not confused with a general note.

Tests assert the delimiter escape, record identity/provenance, and the no-authority
wording. They do **not** prove that every model will ignore a cleverly phrased injection;
that residual risk belongs to the model and is why writes still require approval.

## Forge child process

Forge spawns the Muse CLI to write one staged file. Before this milestone it inherited
the full server environment. It now receives:

- a shared explicit environment allow-list: home/login, `PATH`/`Path` and platform
  executable settings, locale/terminal, temp/XDG, proxy, and standard certificate
  configuration (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `CURL_CA_BUNDLE`, …);
- no `DATABASE_PATH`, `WORKSPACE_ROOT`, provider keys, `NODE_OPTIONS`, `LD_PRELOAD`,
  `DYLD_INSERT_LIBRARIES`, `PYTHONPATH`, or similar executable-injection variables;
- the API key over stdin only, never in argv or the environment;
- a working directory inside the job's staging directory, with `--workspace` pointing at
  the same path;
- `--no-session-log`, `--no-foreign-personal-context`, `--disable-web-tools`,
  `--disable-reminders`, and `--disable-request-user-input`. Forge cannot use
  `--preset empty` because it needs file-write tools.

**What this does not establish.** `--workspace` roots the CLI's policy-gated tools; it is
not a container, VM, or OS user boundary. The child runs as the same local user as the
server and could read files that user can read if the CLI's own sandbox/approval layer were
bypassed. The app does not claim to sandbox that process. A stronger boundary — running
Forge in a dedicated OS user/container with only the workspace mounted — is an operator
deployment step, and the server now provides the code-side seam for it: when
`FORGE_WORKER_WRAPPER` names an absolute executable, every Forge CLI launch goes through
that pass-through wrapper (`wrapper <cli> <args...>`). The wrapper is verified at startup
by actually running it (`<wrapper> node -e 0`); a wrapper that fails validation or the
probe refuses boot rather than silently reverting to direct execution. Linux example:

```sh
# /usr/local/bin/forge-setpriv: run the worker as user `forge`, only the
# workspace readable; argv passthrough keeps the CLI contract unchanged.
#!/bin/sh
exec setpriv --reuid forge --regid forge --clear-groups "$@"
```

Set `FORGE_WORKER_WRAPPER=/usr/local/bin/forge-setpriv` for the server process. The
wrapper concept also composes with systemd-run scopes or container launchers. The default
single-user local beta still runs the child directly.

## Durable jobs and restart recovery

- Jobs are written as one JSON file per job, using a same-directory temp file and atomic
  rename, serialised per job. A failed durable write is recorded and surfaced; a job that
  cannot be persisted is **not started**, so a paid run cannot disappear.
- At startup every readable job is reloaded. `queued`/`running` records become
  `interrupted` with an explicit error; they are never resumed automatically.
- A malformed job record produces a recovery issue and is left in place. Other jobs in
  the project still load. A malformed `state.json` raises `state_corrupt`; it is not
  replaced with an empty project. A missing `state.json` is only initialised when no
  numeric version directory exists: approved version data blocks initialisation, while
  job records alone stay on disk and are recovered normally after state is initialised.
- Project reads are side-effect free. `GET` never creates directories or initialises
  `state.json`; only project creation and generation paths do.
- The approved file is verified against its recorded SHA-256 whenever it is read for
  serving, preview, diff, modification, rollback, or promotion. A mismatch raises
  `version_corrupt` instead of serving or building on the changed bytes.
- Completed-but-unapplied jobs keep their staged bytes, so review can continue after a
  restart. Approval re-snapshots the bytes, runs the runtime check, and promotes only the
  matching SHA-256.
- Promotion stages the immutable copy in a temporary version directory, verifies it, and
  renames it into place. An interrupted promotion can leave an unreferenced version
  directory; the next retry moves it aside to a non-numeric `.orphaned-*` name instead of
  deleting it, so a crash does not block approval and no version bytes are lost.
- A crash between promotion and the job-record write is reconciled from the version's
  recorded `job_id`.
- Graceful shutdown stops new starts, marks active jobs cancelled, signals owned children
  with SIGTERM, escalates to SIGKILL after a grace period, waits for terminal persistence,
  and then flushes. It never signals unrelated processes.
- Approval records the checked artifact hash, runtime result, browser identity when
  available, and timestamp with the immutable version. Persisted diagnostics are bounded
  and redacted; missing historical telemetry is labelled “not recorded,” not passed.
- Rollback continues to follow recorded ancestry and verifies the stored version hash.

## Declarative UI vs HTML Studio

- **Declarative generated UI** (`packages/ui-protocol`) is a closed JSON schema rendered
  by a fixed React registry. No model-authored markup, script, or URL is evaluated. Form
  submissions are validated against the stored surface.
- **HTML Studio** accepts one model-authored `index.html`. It is served with a
  `Content-Security-Policy` containing `sandbox allow-scripts` and is embedded in
  `<iframe sandbox="allow-scripts">`, giving it an opaque origin. It cannot read app
  storage, cookies, or privileged APIs.
- The server never evaluates Studio HTML. The JSON artifact endpoint returns source for
  inspection/export only.
- Approval loads the staged document once in headless Chromium with all network blocked
  except the approved CDN. This is a load-time check, not a persistent sandbox for later
  interaction.
- A downloaded HTML file is an ordinary local file and is **not** sandboxed; the UI says
  so.

## Other implemented controls

**Input validation.** Every route validates its body/query with a Zod schema from
`@mml/shared` (shared with the client). Oversized input is rejected before it can cost
tokens: test-bench prompts ≤ 4,000 chars, screenshot data URLs size-checked and
PNG-validated, page sizes bounded. The test bench accepts at most 1,024 requested output
tokens (384 by default) and chat uses `AGENT_MAX_OUTPUT_TOKENS` (default 1,200). The Muse
CLI exposes no output-token flag, so `MuseCliProvider` enforces the requested budget on
the stream at ~4 chars/token: it stops reading and terminates the child when the budget
is exceeded, then reports `stop_reason: "max_tokens"` with text cut at the budget.
Truncation is explicit rather than silently delivered.

**Forge budgets are mixed, and the labels matter.** `FORGE_MAX_RUNTIME_MS` is a hard
wall-clock kill. `FORGE_MAX_CALLS` is passed to `muse exec --max-model-steps`, so the CLI
stops before starting another model step; the reported call count is still re-checked
when the run completes. `FORGE_MAX_INPUT_TOKENS` has no CLI flag that can stop a run
mid-flight, so it is checked only after the child exits: it is an **observational**
budget that marks the job `budget_exceeded`, not an in-process token stop.

**Secrets never reach the browser.** The API key lives in the server environment or the
Muse CLI's credential store. The client has no code path to a provider endpoint;
`VITE_*` variables are limited to the API base URL.

**Hermetic model invocation.** Conversational Muse calls disable web tools, reminder
sub-agents, interactive prompts, foreign personal context, and session logs. Forge passes
the same hermetic flags it can while retaining file-write tools. Both use the shared child
environment policy; a configured chat `META_API_KEY` and Forge’s API key are delivered
over stdin, not inherited through the environment.

**Explicit verification browser.** Runtime verification and active verification scripts
default to Playwright-managed Chromium. `FORGE_RUNTIME_BROWSER=chrome` explicitly selects
system Chrome. A launch failure is recorded with a bounded, redacted diagnostic and rejects
approval; it does not silently fall back to another browser. Active scripts report the
selected browser/version. Frozen phase/research scripts retain their historical Chrome
launches and are documented as exceptions.

**Bounded execution.** Each provider call and Forge job has a hard wall-clock timeout.
Forge also caps observed calls and input tokens; token counts inside the CLI are
observational.

**Safe error surfaces.** The error handler returns stable codes and generic messages for
5xx; stack traces are logged server-side only. Recovery messages expose relative workspace
paths, not absolute host paths.

**Envelope discipline.** Clients get exactly one response shape, so a failure is never
silently treated as an empty success.

**Loopback bind (default).** `HOST` must be `127.0.0.1`, `::1`, or `localhost`; any other value
(including `0.0.0.0`) stops startup. After `listen`, every bound socket is checked again so a
`localhost` that resolves off-loopback is also refused. This is the network boundary: the
Host-header check below is not, because a client that reaches a non-loopback socket can send
any `Host` it likes. The one exception is a deliberate `ACCESS_TOKEN` configuration (below),
where the re-check logs a warning instead of refusing.

**Host/origin guards.** In the default (tokenless) mode requests must name a loopback host.
State-changing requests with a foreign or `null` Origin are rejected; CORS only allows
configured local origins. With `ACCESS_TOKEN` set, the Host *name* check relaxes (the port must
still match): DNS rebinding can deliver a request but cannot attach the bearer secret, which the
timing-safe check enforces first — 401 precedes any origin verdict.

## Remote-access groundwork (2026-10-30, decision D045)

`ACCESS_TOKEN` (≥16 chars) switches the trust model: every `/api` route except
`GET /api/health` requires `Authorization: Bearer <token>` (compared over SHA-256 digests,
timing-safe); a non-loopback `HOST` becomes permissible and the startup re-check logs a
warning naming the exposed addresses. Browser clients pick the secret up from
`localStorage['mml.access_token']`; curl/MCP-style clients set the header directly.
`GET /api/meta` reports `safety.authentication` as `loopback-only` or `shared-token` —
the server states its own posture instead of letting operators infer it.

Wire-verified 31 Oct 2026 (built server, fresh port, real curl): no token → `401
{code: unauthorized}`; correct bearer → `200`; wrong bearer → `401`; `GET /api/health`
open (`200`) while `GET /api/live` requires the token — the exemption boundary the README
documents, confirmed at socket level rather than only in inject tests.

This is deliberately **authentication without identity**: one shared secret, no users, no
per-project authorization, no rotation UI, no expiry. The token in `localStorage` is
readable by any script on the served page, so pair token mode with the origin guard you
already get — and remember the secret travels over plain HTTP unless you terminate TLS
yourself. Multi-user deployment still needs the roadmap §5 controls (identity, scoped
credentials, quotas); setting this token does not provide them.

**Standing adversarial suite** (2026-10-30, roadmap §5 release criterion):
[tests/integration/adversarial-boundary.test.ts](../tests/integration/adversarial-boundary.test.ts)
attacks the composed surface, not the guards in isolation, and runs on every CI
push. It pins the hook order (**host guard → authentication → origin guard**), so a
valid token never overrides the host check (wrong port is refused even authenticated)
and never acts as CSRF clearance (cross-origin mutations still 403); the health
exemption never widens under path-shape tricks (case, trailing slash, `POST`);
Authorization shape games (case, spacing, appended bytes, percent-lookalikes,
wire-joined duplicates) all fail the digest comparison; and no response body ever
echoes the secret. The D045 posture itself is pinned — arbitrary Host names pass in
token mode only WITH the secret AND the exact configured port, so a regression that
drops the port check would fail CI.

## Deployment

Operator procedures (upgrade, rollback, incident, disaster recovery) live in
[ops/OPERATOR_RUNBOOKS.md](ops/OPERATOR_RUNBOOKS.md). Alert SIGNALS
(`GET /api/health alerts.*`) and a cron-ready prober (`pnpm ops:alert-prober`, D050/D051)
exist; no process pages a human by itself — that wiring remains an operator step, and the
runbook says so. Beyond the optional shared token: per-user namespaces, CSRF tokens,
and rate limiting are **not** implemented. The loopback bind, host/origin guards, optional bearer token, and
absence of a public URL are the only controls keeping the API private. Do not expose this
build to a network without setting `ACCESS_TOKEN` — and treat that as groundwork, not a
multi-user security boundary.

## Repository hygiene

- `.env`, `data/`, `*.db`, `workspaces/`, and `test-results/` are gitignored.
- No credentials are committed; `.env.example` contains placeholders only.
- CI runs lint, typecheck, tests, build, and a managed fake-provider browser workflow. It
  needs no Meta credentials and consumes no model quota. Live-model suites stay opt-in via
  `MML_LIVE_MUSE=1`.
