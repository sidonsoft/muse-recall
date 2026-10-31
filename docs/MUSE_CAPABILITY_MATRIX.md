# Muse capability matrix (verified 2026-10-27)

Environment: Muse Code **1.4.13**, model `muse-wonder-1.0`, Node 26.8.1, macOS.

> **Environment refresh (31 Oct 2026):** the local Muse Code CLI has since
> moved to **1.4.14** (`muse --version` read at head). The opt-in live trio
> (real inference round-trip, structured-output schema, incremental streaming
> deltas) was re-run GREEN against 1.4.14 on 31 Oct - so the headless-execution,
> structured-output and streaming-backed rows hold under the newer CLI. Rows
> requiring heavier setup (image generation, video/audio, Glimmer) were NOT
> re-tested; the table below stays as written on 27 Oct.

| Capability | Status | Evidence |
| --- | --- | --- |
| Headless prompt execution | **Verified** | `muse exec --json "…"` returns JSONL + `run.terminal.completed` |
| Structured output | **Verified** | Used in Phases 4–5 (`--output-schema`) |
| Image input | **Verified** | `muse exec --image docs/assets/phase6-ui.png "…"` described the screenshot and named visible UI text ("Muse Memory Lab", "CONTEXT INSPECTOR") — genuine image understanding, not a description |
| Workspace file creation/editing | **Verified** | `muse exec --workspace /tmp/mf-ws "Create hello.txt"` wrote the file (15 bytes, 3 calls) |
| Workspace scoping | **Verified flag** | `--workspace <PATH>` = "policy-gated workspace tools at PATH"; `--permission-profile <ID>` |
| Image generation | **Documented, not tested** | Muse Image listed at $0.01/image; requires Meta Model API key (not configured here) |
| Muse Spark / Wonder / Image access | **Documented** | dev.meta.ai pricing: muse-wonder-1.0, muse-spark-1.3/1.2, muse-image; Muse Code plans $5–$200/mo |
| Multi-agent orchestration | **Verified (CLI behaviour)** | Game task used 7 model calls; edit used 14; usage reports `calls` |
| Browser testing inside Muse | **Not verified** | Muse explicitly said it "did not play-test in a live browser"; we tested externally with Playwright |
| API access | **Documented** | Meta Model API, OpenAI-compatible, API key via login |
| Video/audio input | **Documented only** | Plan mentions "image and video uploads"; not tested |
| Muse Glimmer (open model) | **Documented** | docs listed; not used |

## What this means

- The two capabilities that matter for Muse Forge — **screenshot interpretation** and
  **workspace file editing** — are real and work headlessly today.
- Image *generation* (for assets) is documented but **not available in our current
  environment**; the Forge experiments use CSS/emoji/Phaser graphics, no generated art.
- Muse does not verify gameplay in a browser; any product must own preview and testing.
- Remaining uncertainty: permission profiles for unattended writes, and API-key access to
  Muse Image.

## Commands used

```bash
muse exec --json --workspace /tmp/mf-ws "Create hello.txt …"
muse exec --json --image docs/assets/phase6-ui.png "What is shown?"
muse exec --json --workspace experiments/muse-forge/game --prompt-file /tmp/game-prompt.txt
muse exec --json --image docs/assets/muse-forge-before.png \
  --workspace experiments/muse-forge/game --prompt-file /tmp/modify-prompt.txt
```
