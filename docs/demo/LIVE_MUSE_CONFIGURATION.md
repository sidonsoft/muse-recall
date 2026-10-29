# Live Muse configuration — FocusFlow demonstration

**Recorded:** 2026-10-28 05:35–05:40 Australia/Brisbane (2026-10-27 19:35–19:40 UTC)
**Repository:** `sidonsoft/muse-recall`
**Worktree:** `~/projects/muse-recall-positioning`
**Branch:** `agent/muse-recall-live-demo` (created from `agent/muse-recall-product-positioning` at `41b1684`)
**Server:** `node apps/server/dist/index.js`, isolated demo database and workspace
**Status:** server started, configured provider initialised, live Muse Spark round-trip passed

---

## 1. Isolation

The demonstration did not reuse the Phase 15B experiment database, the primary workspace, or the
existing development server.

```text
$HOME/muse-demo-live/
├── demo.db                 # isolated SQLite database
├── demo.env                # mode 0600; secrets only, never committed
├── ws/                     # isolated Forge workspace
├── logs/                   # server and run logs
├── runs/                   # job JSON, prompts, diffs, artifacts, test records
├── screenshots/            # browser evidence
└── recordings/             # reserved for V2 assets
```

The pre-existing development server on port `8787` was left running and untouched. The demo server
was started on port `8799` to avoid interfering with it. The web client was served by Vite on port
`5199` with `VITE_PROXY_TARGET=http://127.0.0.1:8799`.

---

## 2. Effective non-secret configuration

Captured from the exact process environment used to launch the server
(`runs/effective-config.json`). Secret values are represented only by presence and length.

| Variable | Effective value | Notes |
|---|---|---|
| `HOST` | `127.0.0.1` | loopback only |
| `PORT` | `8799` | explicit override; `8787` was already in use |
| `NODE_ENV` | `production` | |
| `LOG_LEVEL` | `info` | |
| `CORS_ORIGINS` | `http://127.0.0.1:5199,http://localhost:5199` | demo client only |
| `DATABASE_PATH` | `~/muse-demo-live/demo.db` | isolated |
| `WORKSPACE_ROOT` | `~/muse-demo-live/ws` | isolated |
| `SQLITE_WAL` | `true` | |
| `MODEL_PROVIDER` | `muse-cli` | live provider, not `echo` |
| `MUSE_MODEL` | `muse-spark-1.3` | chat/agent path |
| `MUSE_REASONING_EFFORT` | `high` | |
| `MUSE_TIMEOUT_MS` | `900000` | maximum accepted |
| `MUSE_FALLBACK_API_KEY` | set (48 chars) | not disclosed |
| `MUSE_FALLBACK_MODEL` | `muse-spark-1.3-contributor` | |
| `FORGE_MUSE_API_KEY` | set (48 chars) | not disclosed |
| `FORGE_MUSE_MODEL` | `muse-spark-1.3-contributor` | Forge generation path |
| `FORGE_FALLBACK_API_KEY` | set (48 chars) | same credential as primary |
| `FORGE_FALLBACK_MODEL` | `muse-spark-1.3-contributor` | |
| `FORGE_REASONING_EFFORT` | `high` | |
| `FORGE_MAX_CALLS` | `100` | maximum accepted |
| `FORGE_MAX_INPUT_TOKENS` | `10000000` | maximum accepted; observational only |
| `FORGE_MAX_RUNTIME_MS` | `1800000` | maximum accepted |
| `TOOLS_ENABLED` | `true` | application agent tools |
| `TOOL_APPROVAL_POLICY` | `always` | application agent tools |

### 2.1 Limits are the schema maxima, not arbitrary values

`apps/server/src/config.ts` validates every value at startup:

| Variable | Schema bound | Line |
|---|---:|---|
| `MUSE_TIMEOUT_MS` | `min(1_000).max(900_000)` | [`config.ts:40`](../../apps/server/src/config.ts#L40) |
| `FORGE_MAX_RUNTIME_MS` | `min(10_000).max(1_800_000)` | [`config.ts:103`](../../apps/server/src/config.ts#L103) |
| `FORGE_MAX_CALLS` | `min(1).max(100)` | [`config.ts:104`](../../apps/server/src/config.ts#L104) |
| `FORGE_MAX_INPUT_TOKENS` | `min(10_000).max(10_000_000)` | [`config.ts:105`](../../apps/server/src/config.ts#L105) |
| `FORGE_REASONING_EFFORT` | `enum(['low','medium','high'])` | [`config.ts:111`](../../apps/server/src/config.ts#L111) |

The configured values equal those maxima. The server would refuse to start with larger values.

`FORGE_MAX_INPUT_TOKENS` is **observational**, not a hard in-process cap: the Forge runner can stop
on wall-clock time and observed model calls, but it cannot prevent the Muse CLI from consuming input
tokens. This limitation is stated in [`runner.ts`](../../apps/server/src/forge/runner.ts) and is not
papered over here.

---

## 3. Startup and live validation

### 3.1 Server startup

`node apps/server/dist/index.js` started successfully and logged:

```text
Muse Recall API ready
provider=muse-cli
model=muse-spark-1.3
database=~/muse-demo-live/demo.db
environment=production
```

The server created the isolated database, applied the schema, and served `/api/health`.

### 3.2 Live Muse round-trip

`GET /api/health?probe=live` returned HTTP 200:

| Field | Result |
|---|---|
| `provider.status` | `ok` |
| `provider.detail` | `live reply received (94 output tokens)` |
| `provider.latency_ms` | `6367` |
| `provider.provider_id` | `muse-cli` |
| `provider.model` | `muse-spark-1.3` |
| `verified_with_live_call` | `true` |

Raw response: `runs/health-live.json`.

### 3.3 Model identifiers

Both identifiers were checked against the installed Muse Code CLI (`1.4.14`) before the live run:

```text
muse model-profile show muse-spark-1.3 --effort high
  model: muse-spark-1.3
  default_reasoning_effort: high

muse model-profile show muse-spark-1.3-contributor --effort high
  model: muse-spark-1.3-contributor
  default_reasoning_effort: high
```

The chat catalog exposed by the provider is
`['muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2']`
([`muse-cli-provider.ts:23`](../../packages/muse-provider/src/muse-cli-provider.ts#L23)).
`muse-spark-1.3-contributor` is deliberately **not** advertised as a chat model; it is the
API-key/Forge model used by the contributor path. The Forge job is attributable to that configured
model because the launch config is validated (`FORGE_MUSE_MODEL`) and the CLI accepts the id, but
the Forge job record does **not** persist the CLI's `run.model.configured` event or the per-model
names in `run.usage`: [`runner.ts:568`](../../apps/server/src/forge/runner.ts#L568) sums tokens
only. There is no per-job observed-model field in the artifact. Do not claim more than the
validated configuration supports.

### 3.4 Forge limits active

The Forge manager received the four maximum values from the validated config
([`app.ts:107`](../../apps/server/src/app.ts#L107)); generation jobs are subject to:

- 100 model calls,
- 1,800,000 ms wall clock,
- 10,000,000 observed input tokens,
- `high` reasoning effort.

The first live job used **9 calls, 329,279 input tokens, 7,117 output tokens, and 65,111 ms**, well
inside the limits. This confirms the budgets are large enough for real work and that the job was not
silently truncated by a default of 25 calls / 600,000 ms.

---

## 4. Fallback behaviour (verified against code, not assumed)

### 4.1 What the code actually does

**Chat/agent path** ([`muse-cli-provider.ts:163`](../../packages/muse-provider/src/muse-cli-provider.ts#L163)):

- Streams the primary attempt.
- If an `error` event arrives **before any non-whitespace text** and the code/message matches
  `quota|429|rate.?limit|usage window`, it retries **once** with `MUSE_FALLBACK_API_KEY` and
  `MUSE_FALLBACK_MODEL`.
- Other errors (auth, timeout, crash) do **not** trigger fallback.

**Forge path** ([`runner.ts:485`](../../apps/server/src/forge/runner.ts#L485)):

- If the primary exits non-zero or reports a failed terminal **and** `quotaFailure(job)` matches, it
  resets the staging directory and retries **once** with the fallback key/model.
- It logs `Subscription quota exhausted; retrying with muse-spark-1.3-contributor.`
- Timeouts, validation failures, and non-quota errors do **not** trigger fallback.

### 4.2 Does fallback retry the same model?

Yes, in this configuration. `FORGE_MUSE_MODEL` and `FORGE_FALLBACK_MODEL` are both
`muse-spark-1.3-contributor`; `MUSE_FALLBACK_MODEL` is also the contributor model. The fallback is a
**credential switch for the same model family**, not a model substitution.

### 4.3 Does it share the same quota?

Yes. `FORGE_MUSE_API_KEY` and `FORGE_FALLBACK_API_KEY` were set to the **same** credential, so the
fallback does not add independent quota. It can only help if the credential's quota state changes
between attempts or if the primary failure is a transient quota report. This report does **not**
claim quota resilience.

### 4.4 Activation observed

No fallback activation occurred in the v1 generation or the retake: no job log contains
`retrying with`, and every job reached `run.terminal.completed` on the primary attempt. The first
job's usage reports 9 completed calls and 0 failed calls.

---

## 5. Secret handling

- The API key was read from the existing `~/.zshrc` (`FORGE_MUSE_API_KEY`, 48 chars) because it was
  not exported into the non-interactive shell. It was written to `$HOME/muse-demo-live/demo.env` with
  mode `0600`, and sourced by the launcher; it was never printed.
- The key does **not** appear in the server command line, logs, job JSON, artifacts, or screenshots.
  A byte scan of every file under `$HOME/muse-demo-live` except `demo.env` found **0** files
  containing the key.
- The server does not return the key from `/api/health`, `/api/meta`, or any Forge route.
- `runs/effective-config.json` stores only `<set:48 chars>` for secret variables.

---

## 6. Deviations from the proposed launch line

| Proposed | Actual | Reason |
|---|---|---|
| `cd ~/projects/muse-recall-positioning` | same | correct worktree |
| no `PORT` | `PORT=8799` | `8787` was already occupied by an unrelated dev server; no process was killed |
| `MUSE_FALLBACK_API_KEY="$FORGE_MUSE_API_KEY"` etc. | same values, sourced from a mode-0600 env file | avoid putting the key in shell history/argv |
| `FORGE_MUSE_MODEL=muse-spark-1.3-contributor` | same | verified valid |
| `MUSE_TIMEOUT_MS=900000` | same | maximum |
| `FORGE_MAX_CALLS=100` / `10000000` / `1800000` | same | maxima |
| `FORGE_REASONING_EFFORT=high` | same | |
| no `MUSE_REASONING_EFFORT` | `high` | explicit, so chat and Forge use the same tier |

No repository `.env` or production inference setting was modified. The demo process used explicit
environment overrides only.

---

## 7. Verification of the application surface

- API reachable on `http://127.0.0.1:8799/api/health` — HTTP 200.
- Web client reachable on `http://127.0.0.1:5199` — HTTP 200; `/api` proxied to `8799` — HTTP 200.
- Browser preview served by `GET /api/forge/projects/:id/preview` with CSP
  `sandbox allow-scripts` (no `allow-forms`), `default-src 'none'`, inline script/style allowed,
  jsDelivr only for scripts. This is the production preview contract.
- Generation limits shown active by the job usage above.

The sandbox's missing `allow-forms` is not a configuration defect: it is the shipped preview
policy. It caused the first FocusFlow attempt to fail, which is recorded in
[`NON_GAME_HTML_VALIDATION.md`](NON_GAME_HTML_VALIDATION.md).

---

## 8. Evidence index

| Artifact | Path |
|---|---|
| Effective config (redacted) | `$HOME/muse-demo-live/runs/effective-config.json` |
| Live health response | `$HOME/muse-demo-live/runs/health-live.json` |
| Service metadata | `$HOME/muse-demo-live/runs/meta.json` |
| Server log | `$HOME/muse-demo-live/logs/server.log` |
| Build log | `$HOME/muse-demo-live/logs/build-baseline.log` |
| Baseline verify log | `$HOME/muse-demo-live/logs/verify-baseline.log` |

---

## 9. Bottom line

The server is running on the real `muse-cli` provider, with `muse-spark-1.3` on the chat surface and
`muse-spark-1.3-contributor` on Forge, at every supported maximum for calls, runtime, and timeout.
A live round-trip passed. No secret was exposed. The fallback is a same-model, same-key retry for
quota errors only; it is not independent resilience and was not activated.
