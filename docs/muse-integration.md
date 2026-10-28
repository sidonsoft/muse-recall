# Meta Muse integration — verified findings

This document records **what was verified on the reference machine**, how, and what
remains unknown. It exists so that no future change claims a Muse capability that
was never observed. Everything below was produced by running the installed binary,
not by reading blog posts.

Reference environment: **Muse Code 1.4.13 (1.4.13-R6996.1)**, macOS, Node 26.8.1,
authenticated via the CLI's stored Meta login.

---

## 1. How this was investigated

| Step | Command |
| --- | --- |
| Version and command surface | `muse --version`, `muse --help`, `muse exec --help` |
| Model catalog | `muse model-profile`, MCP `muse_models` listing |
| Wire protocol (authoritative) | `muse schema generate-json-schema --out DIR` |
| Real inference | `muse exec --json --preset empty "…"` |
| Structured output | `muse exec --json --output-schema schema.json "…"` |
| Usage accounting | `muse usage`, and `run.usage` frames in `--json` output |
| Failure behaviour | bogus `--model`, `--base-url`, hung process, missing binary |

`muse schema generate-json-schema` emits the protocol bundled inside the binary
(`msp.schema.json`, ~424 KB) — this is the authoritative source for event vocabulary,
used to confirm the terminal enum rather than guessing it.

## 2. Verified capabilities

### Models

| Model | Context | Notes |
| --- | --- | --- |
| `muse-wonder-1.0` | 1,007,997 tokens | Default |
| `muse-spark-1.3` | 1,007,997 tokens | Selectable |
| `muse-spark-1.2` | 1,007,997 tokens | Selectable |

An **unknown model id does not error**: the CLI accepts `--model does-not-exist` and
falls back to its default. The adapter therefore reports the model the CLI says it
used (`run.model.configured`), not the one we asked for.

### Headless invocation (`muse exec`)

Verified flags used by the adapter:

| Flag | Effect observed |
| --- | --- |
| `--json` | Emits JSONL frames on stdout; stderr carries human notices |
| `--prompt-file <path>` | Prompt read from a file — avoids OS argument length limits |
| `--preset empty` | Bare model: no built-in tools in play |
| `--model <id>` | Model selection |
| `--reasoning-effort <tier>` | `none`…`ultra` |
| `--output-schema <file>` | Constrains the final answer to a JSON Schema (verified) |
| `--no-session-log` | CLI does not persist a second session history |
| `--no-foreign-personal-context` | Does not load the developer's personal rules/skills |
| `--disable-web-tools` | No network tools for the child |
| `--disable-reminders` | No background reminder sub-agents |
| `--disable-request-user-input` | Model cannot block on a human |
| `--max-model-steps <n>`, `--timeout` (n/a) | Step cap exists; **no built-in wall-clock timeout**, so the adapter enforces its own |

Streaming is real: `run.output.delta` frames arrive incrementally (time to first
event ≈ 488 ms in one observation), and the full answer arrives again in the
terminal frame.

### JSONL frame protocol (the subset we consume)

Each line is `{ schema_version, id, stream, sequence, payload_type, payload, … }`.

| `payload_type` | Payload fields used | Meaning |
| --- | --- | --- |
| `run.model.configured` | `model_id` | Model actually resolved |
| `run.output.delta` | `text` | Incremental output |
| `run.usage` | `models[]` with `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens` | Token accounting; may be empty |
| `run.terminal.completed` / `.failed` / `.cancelled` | `terminal`, `text`, `reason` | Authoritative outcome |

The MSP schema defines the terminal vocabulary as exactly
`completed | failed | cancelled`. A run with **no** terminal frame is treated by our
adapter as a protocol failure (`provider_crashed`) rather than a success with partial
text.

### Usage and allowance

- `muse usage` on the reference machine returned
  `usage refresh failed (credential_rejected)`, yet **inference still worked**. The
  subscription-allowance endpoint and the model endpoint are separate; a failed
  allowance refresh is not an authentication failure for inference.
- `run.usage` therefore sometimes reports `models: []`. The adapter treats usage as
  optional and never fails a call because accounting was unavailable.
- When present, per-run `allowance` shows window/week percentages, e.g.
  `window.used_percent: 1–2`.

### Measured overhead — important

A one-word answer costs about **16.6k input tokens**, and that is a *stable* floor, not
an estimate. Re-measured in Phase 2 with `pnpm bench:muse-overhead` (8 real calls,
`muse-wonder-1.0`, effort `low`):

| Measurement | Result |
| --- | --- |
| 5 identical short calls | 16,630 input tokens each — std dev 0, CV 0% |
| 2 calls with a 3,989-char memory block | 17,507 input tokens each |
| Marginal cost of the memory block | +877 tokens |

Earlier observations:

| Prompt | Input tokens | Output | Latency |
| --- | --- | --- | --- |
| `"Reply with exactly the word: PONG"` | 28,441 | 16 | — |
| `"Reply with exactly the word: READY"` (hermetic flags) | 16,630 | 17 | 5,538 ms |
| Health probe via our API | — | 17 | 3,637 ms |

The residual ~16.6k is the CLI's own agent system prompt, which persists despite
`--preset empty` and `--no-foreign-personal-context`. Consequences:

1. Context-efficiency comparisons between baseline and memory-enabled runs must
   subtract a large constant to be meaningful.
2. Our own memory-retrieval budget should be stated in *additional* tokens per turn,
   not as a fraction of the window.
3. A future direct-API adapter would remove this overhead; the CLI is the verified
   path today.

## 3. Integration approach chosen

**`muse exec --json` as a stateless text provider**, with the harness owning
conversation state, tools, and permissions.

```
harness ──builds prompt──► MuseCliProvider ──spawn──► muse exec --json --prompt-file …
   ▲                                                        │
   └──────────── parsed ModelEvent stream ◄─────────────────┘
```

Rationale:

- **Authorization stays ours.** `--preset empty` gives a bare model; no tool the
  model can invoke exists in the child. Every future action passes through the
  harness's permission layer, satisfying the security requirement that model output
  is untrusted.
- **Deterministic context.** The harness decides exactly what text the model sees,
  which is what makes memory retrieval measurable.
- **Testable.** Replacing the binary with a scripted executable tests the real parser
  offline.

### Alternatives considered and rejected for now

| Alternative | Why not (yet) |
| --- | --- |
| **MSP over stdio** (`muse serve`, plus `muse schema` for the wire contract) | The richest interface: session host, approvals, tool events. But it hands the agent loop *and* tool execution to the CLI, which conflicts with owning memory injection and our own approval model. Revisit in Phase 3+ if native tool-calling fidelity is needed. |
| **MCP server registered in `settings.json`** | Inspected: `muse mcp login` requires a streamable-HTTP entry under `mcpServers`, and the CLI's own `--workspace`/sandbox flags gate tools. Wiring our memory engine as an MCP server would let Muse call our tools natively, but it moves the retrieval decision inside the model's loop and makes the authorization boundary harder to test. Documented here as a future option. |
| **Direct HTTP model API** | No public REST endpoint is documented or discoverable. The only stable strings in the binary are `https://api.meta.ai/muse-code/channels/$channel` and the launcher URL; the model endpoint is not a static, documented surface. `--base-url` exists but pointing it at an invalid host still produced a normal answer, so its semantics are **unknown**. We did not invent an endpoint. |

## 4. Authentication methods verified

| Method | Status |
| --- | --- |
| CLI account login (`muse login`, browser code approval) | Verified working — this is what the reference machine uses |
| `META_API_KEY` environment variable | Documented by the CLI as taking priority over login. Our adapters read it at the server boundary and deliver it over stdin; it is not inherited by the child environment. |
| `muse auth set --provider meta --api-key-stdin` | Documented; provider enum is `meta` only |

The API key never reaches the browser: the server spawns the CLI, and the CLI uses
its own credential store.

## 4b. Forge child invocation (post-hackathon hardening)

Forge needs file-write tools, so it cannot use `--preset empty`. It passes the hermetic
flags that remain compatible with writing the staged file:

```
muse exec --json --no-session-log --no-foreign-personal-context \
  --disable-web-tools --disable-reminders --disable-request-user-input \
  --workspace <staging> --prompt-file <staging>/prompt.txt \
  --reasoning-effort <tier> [--provider meta --api-key-stdin] [--model <id>]
```

The child starts in `<staging>` and receives the shared environment allow-list
(home/login, `PATH`/`Path` and platform lookup, locale/terminal, temp/XDG, proxy, and
standard certificate configuration). It never inherits `DATABASE_PATH`,
`WORKSPACE_ROOT`, provider keys, `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, or
`PYTHONPATH`. Provider keys are written to stdin only; the chat provider uses the same
policy and delivers a configured `META_API_KEY` over stdin.

This is **not** a claim that `--workspace` is an OS sandbox. It roots the CLI's
policy-gated tools; the process still runs as the server user with that user's
filesystem permissions. The CLI's own sandbox and approval system remain the enforcement
layer. See [security.md](security.md#forge-child-process).

## 5. Unknowns and risks

| Question | Current status |
| --- | --- |
| Rate limits / quota behaviour under bursts | Unknown; `usage` percentages are the only signal, and the endpoint currently rejects refreshes |
| `--base-url` semantics | Unknown — an invalid host still returned an answer, suggesting a fallback path |
| Whether `muse serve` can host *our* tools with our approval policy | Unverified; MSP schema inspected, not exercised |
| MCP stdio support (`command`-based servers) | Only streamable-HTTP is documented for `muse mcp`; stdio support unconfirmed |
| Streaming latency under long prompts | Not benchmarked |
| Behaviour when the binary is upgraded | The adapter is pinned to frames observed in 1.4.13; schema changes would surface as `provider_crashed` with a message, which the tests cover |

## 6. Re-verifying these claims

```bash
muse --version
muse schema generate-json-schema --out /tmp/msp && ls /tmp/msp
pnpm muse:probe                              # real call + latency + usage
MML_LIVE_MUSE=1 pnpm test                    # 3 live integration tests
curl -s -X POST localhost:8787/api/health/muse   # live check through the API
```

If any of these stop matching this document, **the document is wrong** — update it
before shipping the claim.
