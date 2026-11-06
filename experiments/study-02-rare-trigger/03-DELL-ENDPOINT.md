# Study 02 — Dell / PolyStrata endpoint discovery

**Date/time:** 2026-10-31 11:49–11:57 AEST (+10, `Australia/Brisbane`) = 01:49–01:57Z. Probe target's local clock is **UTC+11** (see §6.4).
**Scout:** `dell-scout`
**Status:** **READY WITH CAVEATS** — endpoint is live, local/free, OpenAI-compatible, and answers a minimal chat probe in ~0.13–0.37 s when the prompt prefix is cached (cold first request 1.0–1.7 s); but it runs in a **single request slot** at **~25 tok/s decode / ~300 tok/s prefill**, is **not installed as a service**, and **defaults to thinking-on** unless every request explicitly disables it.

Provenance labels are used on every factual line: **[OBSERVED]** = seen directly in command output / HTTP response during this session; **[INFERRED]** = deduced from source/binary/config/docs read on the machine, not runtime-verified; **[UNKNOWN]** = not determined.

---

## 0. Metadata

```json
{
  "host": "192.168.86.39",
  "hostname": "DELL",
  "ssh_alias": "dell",
  "ssh_user": "burnz",
  "ssh_remote_shell": "cmd.exe (Windows OpenSSH default shell)",
  "os": "Microsoft Windows 11 Pro, version 10.0.26200, build 26200",
  "endpoint_base_url": "http://192.168.86.39:8080/v1",
  "chat_completions_url": "http://192.168.86.39:8080/v1/chat/completions",
  "api_style": "OpenAI-compatible chat completions (+ OpenAI Responses and Anthropic Messages dialects); llama.cpp-style /props, /slots, /health, /metrics",
  "model_id": "qwen3.6-35b-a3b-ud-q3_k_m",
  "model_file": "D:\\Projects\\PolyStrata-data\\models\\qwen36-UD-Q3_K_M\\Qwen3.6-35B-A3B-UD-Q3_K_M.gguf",
  "model_file_bytes": 17104402720,
  "model_file_gib": 15.93,
  "model_family": "Qwen3.6-35B-A3B (MoE, 35B total / 3B active, MTP enabled)",
  "quantisation": "UD-Q3_K_M (Unsloth Dynamic Q3_K_M)",
  "context_length": 131072,
  "max_output_tokens": 32768,
  "kv_cache": "q8_0",
  "temperature_default": "0.7 non-thinking / 1.0 thinking (model card); server default is THINKING-ON -> 1.0 unless request sets reasoning_effort",
  "top_p_default": "0.8 non-thinking / 0.95 thinking",
  "top_k_default": 20,
  "min_p_default": "0 (off)",
  "presence_penalty_default": 1.5,
  "repetition_penalty_default": "1.0 (off)",
  "runtime_name": "PolyStrata (Python `serve.server` front end + `strata-poly` HIP engine)",
  "runtime_version": "0.1.45",
  "runtime_build": "local-hip / backend hip / windows-x64 / arch gfx1010 / ROCm 10.2.0a20260930 / source 68812f8 (git main, 2026-10-22)",
  "gpu": "AMD Radeon RX 5700 XT (gfx1010) — 1 GPU; Intel UHD Graphics 630 iGPU present; a stale/not-present NVIDIA RTX 3090 registry entry exists and MUST NOT be counted",
  "vram_gb": 8.0,
  "vram_total_mib": 8176,
  "vram_budget_mib": 7383,
  "vram_free_mib_at_load": 1523,
  "gpu_offload": "expert-cache only: 698 of 10496 routed experts resident in VRAM (0.9 GiB); weights + KV in system RAM",
  "ram_gb": 31.7,
  "ram_free_gb_at_probe": 5.4,
  "cpu": "Intel Core i7-10700 @ 2.90 GHz, 8 cores / 16 threads",
  "threads_used": 8,
  "disk": "C: 237.4 GB (21.2 GB free); D: 931.5 GB (136.2 GB free); model on D:",
  "concurrency": 1,
  "concurrency_notes": "total_slots=1, batch_slots=0; requests are FIFO-serialised; a `parallel: N` config key exists upstream but is NOT set here",
  "auth_required": false,
  "api_key_configured": false,
  "rate_limits": "none detected",
  "reachable_from_mac": true,
  "latency_from_mac_ms": "1.7–2.4 (TCP connect); 3–8 ms HTTP control endpoints",
  "throughput_measured": "decode ~23.6–28.6 tok/s (mean ~25); prefill 303 tok/s at 910-token prompt; ~1 s fixed overhead per small prompt",
  "service_persistent": false,
  "engine_uptime_s_at_probe": 3313,
  "requests_served_at_probe": 21,
  "probed_at": "2026-10-31T11:49:00+10:00",
  "probed_until": "2026-10-31T11:57:00+10:00"
}
```

---

## 1. Reachability and access

**The earlier symptom is explained: `ssh dell` lands in a Windows `cmd.exe`, not a POSIX shell.**

| Probe | Result |
|---|---|
| `ssh -o BatchMode=yes dell true` | **[OBSERVED]** Failed: `'true' is not recognized as an internal or external command, operable program or batch file.` → remote shell is Windows `cmd.exe`; key auth succeeded (`PermissionsDenied` never appeared; connection fully established in 0.1 s). |
| `ssh dell 'echo %OS%'` / `ver` / `hostname` / `whoami` | **[OBSERVED]** `Windows_NT`; `Microsoft Windows [Version 10.0.26200.9711]`; hostname `DELL`; user `dell\burnz`. |
| `ssh dell 'echo DELL_OK; uname -a; whoami'` (earlier by Lead) | **[OBSERVED/EXPLAINED]** `cmd.exe` `echo` prints the *entire* rest of the line verbatim, so the "echoed command" was expected behaviour, not a broken SSH channel. Semicolons are not command separators in `cmd`. |
| `ssh dell 'wsl -l -v'` | **[OBSERVED]** WSL present: `Ubuntu` (Stopped), `SidonsoftCI` (Running). PolyStrata does **not** run in WSL (see §2). |
| `ping -c 2 192.168.86.39` | **[OBSERVED]** 100% packet loss (ICMP blocked by Windows firewall default) — **the host is nonetheless reachable over TCP**; do not use ping as a health check. |
| TCP connect from Mac, port 22 and 8080 | **[OBSERVED]** Both OPEN; all of 80,443,8000,5000,3000,7860,11434,11435,8188,8888,9000,5001–5004 closed. |
| OS uptime | **[OBSERVED]** `Win32_OperatingSystem.LastBootUpTime = 27/10/2026 03:59:32` (local +11). |
| Port bind | **[OBSERVED]** Listener on `192.168.86.39:8080` owned by `python.exe` PID 7112 — bound to the **LAN IP**, not loopback, so it is reachable from the Mac and from any LAN host. |
| ssh config | **[OBSERVED]** `Host dell` → `HostName 192.168.86.39`, `User burnz`, `IdentityFile ~/.ssh/dell_openclaw_ed25519`, `IdentitiesOnly yes`, `StrictHostKeyChecking yes`. No ProxyJump/ProxyCommand, so no forced-command wrapper. |

**Working invocation pattern for structured discovery:** avoid nested quoting through `cmd.exe`; pipe a PowerShell script over stdin:

```bash
ssh -o BatchMode=yes dell 'powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command -' < script.ps1
```

---

## 2. The PolyStrata installation

### 2.1 Processes

**[OBSERVED]** (Windows `Get-CimInstance Win32_Process`; `Get-Process`):

```
PID 4848  strata-poly.exe   D:\Projects\PolyStrata\engine-poly\strata-poly.exe
          started 31/10/2026 11:57:27, parent PID 7112, working set 17.4 GiB
          cmdline: --serve --model D:\Projects\PolyStrata-data\models\qwen36-UD-Q3_K_M\Qwen3.6-35B-A3B-UD-Q3_K_M.gguf
                   --max-context 131072 --expert-profile ...\packs\qwen36-ud-q3_k_m\expert-profile.txt
                   --conversation-cache-mib 0 --vram-reserve-mib 1536 --tail-skip 0 --kv-whole
                   --threads 8 --prompt-batch 1024 --kv q8_0

PID 7112  python.exe  (owns the :8080 listener)   same cmdline as 2184
PID 2184  python.exe  (parent of 7112)            same cmdline as 7112
          cmdline: "D:\Projects\PolyStrata\.venv\Scripts\python.exe" -u -m serve.server --engine strata
                   --config D:\Projects\PolyStrata\strata-qwen36-ud-q3_k_m.json --host 192.168.86.39 --port 8080
          parent: PID 13532 powershell.exe
          grandparent: ... -File "C:\Users\burnz\Documents\Codex\2026-10-23\set-up-and-benchmark-polystrata-on\outputs\Start-PolyStrata.ps1"
```

**[OBSERVED]** Launch chain: Codex-generated PowerShell launcher → python `serve.server` (supervisor + replica) → `strata-poly.exe` engine. All three run in **console session 1** (`query session`: `console burnz 1 Active`; `rdp-tcp` only Listening).

### 2.2 Install layout

**[OBSERVED]** `D:\Projects\PolyStrata` (git repo, branch `main`, HEAD `68812f8`, 2026-10-22; 59 MB README, 480 kB `serve/server.py`, plus `docs/` with 60+ design docs):

| Path | What |
|---|---|
| `D:\Projects\PolyStrata\engine-poly\strata-poly.exe` | HIP/C++ engine binary, 34.5 MB; `BUILD.json`: version `0.1.45`, backend `hip`, platform `windows-x64`, arch `gfx1010`, ROCm `10.2.0a20260930`, source `8bf7b17404621559`. Ships `amdhip64_7.dll`, `amd_comgr.dll`, `rocm_kpack.dll` (AMD ROCm on Windows). |
| `D:\Projects\PolyStrata\serve\` | Python 3.13.12 HTTP front end: `server.py` (routing + queue), `frontend.py` (web UI/HTML), `models.py`, `runconfig.py`, `prometheus.py`, `mcp.py`, `keepawake.py`, many `test_*` files. |
| `D:\Projects\PolyStrata\strata-qwen36-ud-q3_k_m.json` | **Active run config** (exe, args, tokenizer, model_name, display_name, log, lib_dirs, port 8080, host 192.168.86.39, `fit_max_tokens: true`, `reasoning_effort: "none"`). |
| `D:\Projects\PolyStrata\strata-qwen36-ud-q3_k_m.shared-settings.json` | UI-shared generation settings: `reasoning_effort: "high"`, `reasoning_budget_tokens: 8192`, `max_tokens: 32768`. |
| `D:\Projects\PolyStrata\strata-qwen36-ud-q3_k_m.log` | Server/engine lifecycle log (engine start lines, VRAM budget, expert residency). |
| `D:\Projects\PolyStrata\.tmp\engine-context-128k-q8.log` | Current engine log: `q8_0 KV cache: 544 bytes a row`; `Windows budgets 7383 of this card's 8176 MiB`; `loaded in 3.2 s; 698 of 10496 routed experts in VRAM (0.9 GiB), 8 CPU threads`. |
| `D:\Projects\PolyStrata-data\models\qwen36-UD-Q3_K_M\` | GGUF (17,104,402,720 B) + `.done` stamp. |
| `D:\Projects\PolyStrata-data\packs\qwen36-ud-q3_k_m\` | `tokenizer/`, `expert-profile.txt` (147 kB). |

**[OBSERVED]** Web UI served at `GET /` (`<title>PolyStrata</title>`, assets `web/app.css`, `web/app.js`), links to `https://github.com/VecSzn/PolyStrata` — this is a **bespoke fork/derivative server**, not stock llama.cpp/Ollama/LM Studio/vLLM. (LM Studio is separately *installed* on the box and set to auto-start via `--run-as-service`, but **not listening** and not used.)

**[OBSERVED]** No Windows service, no scheduled task, no Run-key entry for strata/poly (`Get-CimInstance Win32_Service`, `Get-ScheduledTask`, `Win32_StartupCommand` all empty for it). It is a manually launched console process.

---

## 3. Model identity

| Property | Value | Evidence |
|---|---|---|
| Endpoint model id | `qwen3.6-35b-a3b-ud-q3_k_m` | **[OBSERVED]** `GET /v1/models`, `/props.model_alias`, `/api/models/current` |
| Display name | `Qwen3.6-35B-A3B UD-Q3_K_M` | **[OBSERVED]** `/api/models` |
| Architecture tag | `qwen35moe` (engine backend `qwen35moe`), MoE, **MTP enabled** (`"mtp": true`) | **[OBSERVED]** `/api/models` |
| Parameters | 35B total, 3B active | **[OBSERVED]** `/api/models` (`params_total: "35B"`, `params_active: "3B"`) |
| Quantisation | `UD-Q3_K_M` (Unsloth Dynamic Q3_K_M) | **[OBSERVED]** `/api/models.quantization` |
| Model file | `Qwen3.6-35B-A3B-UD-Q3_K_M.gguf`, 17,104,402,720 bytes = 15.93 GiB | **[OBSERVED]** dir listing |
| Context length | `131072` tokens (`--max-context 131072`; `n_ctx`; `max_positions`) | **[OBSERVED]** `/props`, `/health`, `/v1/status` |
| KV cache | `q8_0`, 544 bytes/row | **[OBSERVED]** engine log |
| Max output | `n_predict = 32768`; `max_tokens` from shared settings 32768; `fit_max_tokens: true` | **[OBSERVED]** `/props.default_generation_settings`, config |
| Sampling defaults (non-thinking) | temp 0.7, top_p 0.8, top_k 20, presence_penalty 1.5; min_p 0 (off), repetition_penalty 1.0 (off) | **[OBSERVED]** `MODEL_CARD_SAMPLING["qwen35moe"]["instruct"]` in `serve/server.py:7529`; runconfig help text confirms "0.7 not [thinking]" |
| Sampling defaults (thinking) | temp 1.0, top_p 0.95, top_k 20, presence_penalty 1.5 | **[OBSERVED]** same table |
| Effective default thinking state | **ON**, effort resolves from `shared-settings.json` (`"high"`) → overrides config's `"none"` (`serve/server.py:4062`, `4076`) | **[OBSERVED]** code + baseline probe emitted `reasoning_content` with no effort param |
| Reasoning budget | 8192 tokens (`reasoning_budget_tokens`) | **[OBSERVED]** shared-settings |
| Speculative decoding | enabled, draft tokens observed (`draft_n`, `draft_n_accepted` in `timings`; 325/345 accepted across 21 requests) | **[OBSERVED]** `/metrics.totals` |
| Runtime / build | PolyStrata 0.1.45; engine 0.1.45; local HIP build; ROCm 10.2.0a20260930; git `68812f8` | **[OBSERVED]** `/props.build_info`, `/health.service="strata"`, `BUILD.json`, git |

---

## 4. Hardware

| Item | Value | Evidence |
|---|---|---|
| CPU | Intel Core i7-10700 @ 2.90 GHz, 8C/16T; engine uses 8 threads | **[OBSERVED]** `Win32_Processor`, `--threads 8`, `/metrics.hardware_static.cpu_name` |
| RAM | 31.7 GB total (33,258,768 KiB); 26.1 GB used, **5.4 GB free** at probe | **[OBSERVED]** `Win32_ComputerSystem`, `/v1/status.machine.ram`, `free` |
| GPU | **AMD Radeon RX 5700 XT** (PCI `VEN_1002&DEV_731F`), the only active discrete GPU; Intel UHD 630 iGPU also present | **[OBSERVED]** `Get-PnpDevice -Class Display` (status OK), `/metrics.hardware_static.gpu_name`, `gpu_count: 1` |
| VRAM | 8176 MiB (8 GB); Windows process budget 7383 MiB; 1523 MiB free at load | **[OBSERVED]** `/metrics.hardware_static.gpu_vram_total_mib`, engine log |
| Offload | Only the **expert cache** is in VRAM (698/10496 routed experts, 0.9 GiB); weights/KV reside in system RAM → CPU-MoE inference | **[OBSERVED]** engine log + `/metrics.engine.expert_slots=698`, `expert_cache_mib=920` |
| ROCm / driver | ROCm `10.2.0a20260930`; Windows AMD driver `32.0.21030.2001` | **[OBSERVED]** `BUILD.json`, `Win32_VideoController` |
| GPU telemetry | None available: "no GPU load or VRAM readings for AMD cards on Windows yet" | **[OBSERVED]** `/metrics.hardware_static.gpu_note`; `nvidia-smi` not found |
| Disk | C: 237.4 GB (21.2 GB free); D: 931.5 GB (136.2 GB free) | **[OBSERVED]** `Win32_LogicalDisk` |
| Power | Plan **Balanced**; AC standby timeout **0 = never sleep**; DC standby 600 s; display off after 300 s AC | **[OBSERVED]** `powercfg /query` |
| Sleep-keepalive | Opt-in `keepawake.py` holds the system awake **only while a request is running/queued**; not explicitly enabled/disabled by this config, so off unless set | **[OBSERVED]** source docstring |
| Zombie device | Registry retains `NVIDIA GeForce RTX 3090 : 24.0 GB` under the display class, but `Get-PnpDevice` reports status `Unknown` and `/metrics` reports 1 GPU | **[OBSERVED]** → treat as a stale record, not available hardware **[INFERRED]** |

---

## 5. API contract

### 5.1 Endpoint table

**[OBSERVED]** Route strings exist in `serve/server.py`; those marked ✔ were probed live. `GET` unless noted.

| Path | Method | Result |
|---|---|---|
| `/` | GET | ✔ 200, PolyStrata web UI (17,402 B HTML) |
| `/health` | GET | ✔ 200, `{"status":"ok","max_context":131072,"model":"qwen3.6-35b-a3b-ud-q3_k_m","api_key":false,"loaded":true,"service":"strata"}` |
| `/props` | GET | ✔ 200, llama.cpp-style props incl. `chat_template`, `total_slots: 1`, `model_path`, `build_info` |
| `/slots` | GET | ✔ 200, `[{"id":0,"n_ctx":131072,"is_processing":false,"n_prompt_tokens":15}]` |
| `/metrics` | GET | ✔ 200, engine/live/queue/VRAM/latency JSON (`/metrics/prometheus` also mapped) |
| `/v1/models` | GET | ✔ 200, one model, `meta.n_ctx: 131072`, `status.loaded` |
| `/v1/status` | GET | ✔ 200, service state, dialects, concurrency, VRAM, machine RAM/GPU, last timings |
| `/v1/chat/completions` | POST | ✔ 200 (the route the harness should use) |
| `/v1/messages` | POST | ✔ 200 — Anthropic Messages dialect (`msg_…`, `content[].type`, `stop_reason`, `usage.input_tokens`) |
| `/v1/responses` | POST | ✔ 200 — OpenAI Responses dialect (`resp_…`, `output[]`, `incomplete_details`) |
| `/v1/load`, `/v1/unload`, `/v1/vram`, `/v1/images/generations`, `/v1/images/files/*` | — | mapped in source; not exercised (control/optional features) |
| `/api/health`, `/api/models`, `/api/models/current`, `/api/models/load`, `/api/models/unload`, `/api/requests`, `/api-monitor` | GET/POST | `/api/models` and `/api/models/current` ✔ 200; `/api/requests` ✔ 404 |
| `/v1/completions`, `/v1/embeddings`, `/tokenize`, `/detokenize`, `/props/completion`, `/system-info` | — | ✔ **404 `{"error":{"message":"not found"}}`** — not supported. Chat/completions is the only text-generation path. |

**[OBSERVED]** `/v1/status` facts: `dialects: ["/v1/chat/completions","/v1/messages","/v1/responses"]`; `concurrency: {"serving":1,"requested":1}`; `structured_output: {formats:["json_object","json_schema"], method:"prompt_and_validate", constrained_decoding:false}`; `cache_max_tokens: 131072`; `auto_load: true`; `vram.elastic: true`; `machine.ram.used_gib: 26.1/31.7`; `last_timings.predicted_per_second: 28.6`.

**[OBSERVED]** `/props.chat_template_caps`: `supports_system_role: true`, `supports_tools: true`, `supports_tool_calls: true`, `supports_parallel_tool_calls: true`, `supports_preserve_reasoning: false`. `modalities.vision: false`.

### 5.2 Canonical request / response (real, minimal)

Request (curl-equivalent; `reasoning_effort` + `chat_template_kwargs` are **required** to get deterministic short outputs):

```http
POST http://192.168.86.39:8080/v1/chat/completions
Content-Type: application/json

{"model":"qwen3.6-35b-a3b-ud-q3_k_m",
 "messages":[{"role":"system","content":"You are terse."},
             {"role":"user","content":"Reply with exactly: OK"}],
 "max_tokens":8,
 "temperature":0,
 "reasoning_effort":"none",
 "chat_template_kwargs":{"enable_thinking":false}}
```

Response **200** (verbatim, requested 2026-10-31T01:53:20Z; this capture was a **cold** prompt — 982 ms of prompt processing — a same-prefix repeat later measured 0.37 s wall):

```json
{
  "id": "chatcmpl-8cd606ae8e2d41c9801fc176",
  "object": "chat.completion",
  "created": 1793411600,
  "model": "qwen3.6-35b-a3b-ud-q3_k_m",
  "choices": [{"index": 0,
    "message": {"role": "assistant", "content": "OK"},
    "finish_reason": "stop"}],
  "usage": {"prompt_tokens": 26, "completion_tokens": 2, "total_tokens": 28,
            "prompt_tokens_details": {"cached_tokens": 0}},
  "timings": {"cache_n": 0, "prompt_n": 26, "prompt_ms": 982.2,
              "prompt_per_token_ms": 37.777, "prompt_per_second": 26.5,
              "predicted_n": 2, "predicted_ms": 71.7,
              "predicted_per_token_ms": 35.85, "predicted_per_second": 27.9,
              "draft_n": 1, "draft_n_accepted": 0}
}
```

**With thinking left on** (no `reasoning_effort`), the same request returns `content: null`, `reasoning_content: "Thinking Process:\n1.  **"`, `finish_reason: "length"` at `max_tokens=16` — i.e. the answer is consumed by chain-of-thought. **[OBSERVED]** Set `reasoning_effort:"none"` (or `chat_template_kwargs.enable_thinking=false`) on **every** request.

Two independent disable forms both worked: `{"reasoning_effort":"none"}` alone and `{"chat_template_kwargs":{"enable_thinking":false}}` alone → `content:"OK"`, `finish_reason:"stop"`. **[OBSERVED]**

### 5.3 Streaming

`"stream": true` → `Content-Type: text/event-stream`. Verbatim event sequence for `max_tokens:4, stream_options.include_usage:true` **[OBSERVED]**:

```
data: {"id":"chatcmpl-210eb1300398439f87782ff3","object":"chat.completion.chunk","created":1793411564,"model":"qwen3.6-35b-a3b-ud-q3_k_m","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
: keep-alive
: keep-alive
data: {"id":"chatcmpl-210eb1300398439f87782ff3","object":"chat.completion.chunk","created":1793411564,"model":"qwen3.6-35b-a3b-ud-q3_k_m","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}
data: {"id":"chatcmpl-210eb1300398439f87782ff3","object":"chat.completion.chunk",...,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":...}}
data: [DONE]
```

Important for a Node client: `: keep-alive` **comment lines** are emitted every 10 s while a request is queued/held (`QUEUE_BEAT_S = 10.0`), and `data: [DONE]` is the terminator. An SSE parser must ignore comment lines.

### 5.4 Error shapes **[OBSERVED]**

| Condition | HTTP | Body |
|---|---|---|
| Missing `messages` | 400 | `{"error":{"type":"invalid_request_error","message":"No messages provided."}}` |
| Malformed JSON | 400 | `{"error":{"type":"invalid_request_error","message":"Expecting value: line 1 column 1 (char 0)"}}` |
| `messages` not a list | 400 | `{"error":{"type":"invalid_request_error","message":"messages must be a list of objects (a string was sent that is not JSON)"}}` |
| Unknown path (`/v1/completions`, `/api/requests`, …) | 404 | `{"error":{"message":"not found"}}` |
| **Unknown model id** | **200** | Served by the loaded model anyway; response `model` field is the real id — the `model` field is **not validated** |
| `max_tokens: 200000` (prompt 24 tok) | **200** | Accepted and clamped (`fit_max_tokens: true`), not rejected. **[OBSERVED]** |
| Prompt exceeding context | 400 | Error text in source: `request exceeds the context window: … requests are never truncated` (`serve/server.py:4508–4517`, `CTX_SLACK = 8`). **Not runtime-tested** (would need a >131k-token prompt ≈ 7+ min of prefill) → **[INFERRED]** |
| Auth | n/a | `api_key: false`, bogus `Authorization: Bearer not-a-real-key` still returned **200** → no auth **[OBSERVED]** |

---

## 6. Operational state

1. **[OBSERVED]** Service is **running now**: engine up since 2026-10-31 11:57:27 local (+11), `uptime_s: 3313` (~55 min), `loaded: true`, `in_flight: 0`, `activity.requests: 21`, 582 output tokens total.
2. **[OBSERVED]** **Not persistent**: no service / scheduled task / startup entry. Started manually from `...\Codex\2026-10-23\set-up-and-benchmark-polystrata-on\outputs\Start-PolyStrata.ps1` in console session 1. A logoff, reboot, or closing that PowerShell window ends it; nothing restarts it. `models_autoload: true` only means it reloads the model on request after an in-process unload.
3. **[OBSERVED]** No auth, no API key, no rate limit; listens on LAN IP `192.168.86.39:8080` (not loopback-only) → any LAN host can submit requests and perturb load.
4. **[OBSERVED]** **Timezone**: Dell local is **UTC+11** (`Get-Date` → `2026-10-31T12:50:30+11:00`); the Mac is UTC+10. Epoch/UTC clocks agree to within ~1 min, so only *displayed* local timestamps differ by 1 h. Log lines (`strata-qwen36-ud-q3_k_m.log`, engine log) are in Dell local time; API `created`/`started` are Unix epochs.
5. **[OBSERVED]** **Concurrency = 1.** `total_slots: 1`, `batch_slots: 0`, `/v1/status.concurrency {"serving":1,"requested":1}`. Two simultaneous 16-token requests completed at 0.84 s and 1.65 s (strictly serialised: the second waited for the first). A `"parallel": N` config key exists upstream (`server.py:2721`, max 8) but is **not** set here and must not be set without approval.
6. **[OBSERVED]** Timeouts/keep-alives: engine silence tolerated `engine_silence_s` default **300 s** ("0 = wait"); queued requests emit `: keep-alive` every 10 s; rate window 2 s. A long generation therefore produces no error but a dead engine request fails after 300 s.
7. **[OBSERVED]** Prompt cache: `/metrics.conversation_cache.requests_reused: 7` of 21, `reused_tokens: 6218 / 21258`; per-response `usage.prompt_tokens_details.cached_tokens` and `timings.cache_n` report reuse. Repeating a prompt prefix is cheap.
8. **[OBSERVED]** `GET /health` is the cheap liveness check (3–8 ms from the Mac); `/v1/models` is the cheap readiness/model check.

### 6.1 Measured performance **[OBSERVED]**

| Workload | Result |
|---|---|
| Tiny request, warm (`max_tokens:2`, prompt 14 tok, prompt cached) | 0.128–0.142 s wall (5 sequential trials, all HTTP 200) |
| Tiny request, **cold** prompt (26–36 tok, `max_tokens:8`, thinking off) | 0.98–1.66 s wall (cold expert-cache/page-fault overhead: `prompt_ms` 889–1329 for the first tokens) |
| Tiny request, **same prefix repeated** (prompt cached) | 0.128–0.370 s wall (`cached_tokens` 14–34, `prompt_ms` 57–68) |
| **Prefill, 910-token prompt** | **2999.4 ms → 303.4 tok/s** (`prompt_n: 910`, `cache_n: 0`) |
| **Decode, 111 tokens** | **4710.0 ms → 23.6 tok/s** (mean of samples 23.6–28.6; 5-token samples 35–43 ms/token) |
| Concurrency 2 | Serialised: 0.84 s then 1.65 s, wall 1.65 s |
| Streaming first byte | first `data:` chunk immediately, then 2 `: keep-alive` before first token on a cold tiny prompt; whole 5-event stream in 0.60 s |

**[INFERRED]** Fixed per-request overhead is ~0.1–1.0 s (tokeniser/queue/scheduling); steady-state is ~300 tok/s prefill and ~25 tok/s decode.

### 6.2 From the Mac to the harness

- **Base URL**: `http://192.168.86.39:8080/v1` — `POST /v1/chat/completions` is the recommended call. **[OBSERVED]**
- **Latency**: TCP connect 1.7–2.4 ms; `/health` 2.7–3.5 ms. HTTP/1.1 via Python `ThreadingHTTPServer` (each request is a thread; engine slot still serialises). Standard Node `fetch`/undici works; no TLS, no redirects, no auth headers needed. **[OBSERVED]** transport, **[INFERRED]** Node compatibility (standard SSE + JSON, nothing exotic).
- **Keep-alive/timeouts**: safe client timeout ≥ 300–360 s per request (engine silence default 300 s; queue beats every 10 s). Node's undici `headersTimeout`/`bodyTimeout` defaults (300 s) are borderline for a queued request behind a long generation — set explicit longer timeouts or use `node:http` directly. Send requests **sequentially**; parallel requests just queue.

---

## 7. Suitability for the Study 02 pilot

### 7.1 Exact harness configuration recommended

```jsonc
// endpoint
{
  "base_url": "http://192.168.86.39:8080/v1",
  "path": "/v1/chat/completions",
  "method": "POST",
  "headers": {"Content-Type": "application/json"},   // no Authorization needed
  "model": "qwen3.6-35b-a3b-ud-q3_k_m",
  "request_defaults": {
    "reasoning_effort": "none",                       // MANDATORY: otherwise thinking-on (effort high, 8192-token budget)
    "chat_template_kwargs": {"enable_thinking": false}, // belt-and-braces; either one alone worked
    "temperature": 0.7,                               // non-thinking card default (protocol wants non-zero sampling)
    "top_p": 0.8,
    "top_k": 20,
    "presence_penalty": 1.5,
    "min_p": 0.0,
    "max_tokens": 256,                                // cap tightly for cost; raise only per preregistered need
    "stream": false                                   // or true; both work (SSE has ": keep-alive" comments)
  },
  "client": {
    "concurrency": 1,                                 // one in-flight request, sequential queue
    "timeout_ms": 360000,                             // >= engine_silence_s (300 s) + slack
    "retries": "none/limited; record failures rather than silently retrying",
    "assert": "response.model == 'qwen3.6-35b-a3b-ud-q3_k_m' (model id is NOT validated server-side)"
  },
  "preflight": ["GET /health", "GET /v1/models", "GET /v1/status (uptime_s, concurrency)"],
  "per_run_log": ["id", "created", "usage", "timings", "finish_reason", "system_fingerprint absent"]
}
```

**Reproducibility note:** the engine supports a `seed` sampling key (`server.py:1226`) and exposes per-response `timings`. Set an explicit `seed` per (scenario, arm, rep) if the analysis plan wants exact replay; whether a seed reproduces across server restarts is **[UNKNOWN]**.

### 7.2 Cost/time estimate for the 4,800-run confirmatory pass **[INFERRED, from 6.1]**

Serial, single-slot. `t ≈ 0.3 s overhead + prompt_tokens/303 + output_tokens/25`:

| Assumed per run | Seconds/run | 4,800 runs |
|---|---|---|
| 500-token prompt, 100-token output | ~5.6 s | **~7.5 h** |
| 1,000-token prompt, 150-token output | ~9.7 s | **~13 h** |
| 2,000-token prompt, 300-token output | ~19 s | **~25 h** |
| above **with** 60 % prefix-cache reuse on prompts | −~2–5 s each | **~8–20 h** |

Pilot (30 scenarios × 4 arms × 1 rep = ~120 runs) ≈ 12–40 minutes. **This is the dominant scheduling risk; budget 1–2 days of wall clock, not hours.**

### 7.3 Risks

1. **Throughput (HIGH).** One slot, ~25 tok/s decode / ~300 tok/s prefill. A naive 4,800-run confirmatory pass with 1–2k-token prompts and long outputs is a **10–25 hour** serial job; 4,800 runs must be planned (short prompts, tight `max_tokens`, prefix-cache-friendly ordering, sequential client). No parallelism is configured.
2. **Not a managed service (HIGH).** Manually started console process, no service/scheduled task, no auto-restart. Closing the launching PowerShell window, logging off, rebooting, or an engine crash ends the endpoint. Recovering means running the user's `Start-PolyStrata.ps1` — **do not do this without Lead/user approval**; it was not touched during this scouting.
3. **Thinking default is ON (HIGH if missed).** `shared-settings.json` (`reasoning_effort: "high"`, budget 8192) overrides the run config's `"none"`, and requests without an effort get it injected. Forgetting `reasoning_effort:"none"` on a run yields `content:null` + reasoning text, `finish_reason:"length"`, and ~5–30× token cost. The web UI can also change these shared defaults — **send all sampling fields explicitly, never rely on server defaults**.
4. **Unauthenticated LAN exposure (MEDIUM).** Binding is `192.168.86.39:8080`, no API key; any LAN host (and the PolyStrata web UI used by a human) can inject requests and change load. Protocol should require exclusive-use coordination and note any observed interference; do not expose further.
5. **Determinism / quantisation (MEDIUM).** UD-Q3_K_M (≈3-bit) quant of a 35B-A3B MoE, CPU-heavy inference, temperature 0.7 with `presence_penalty 1.5` (the card default) — this is a *low-precision, high-entropy* rater. Report model identity + quantisation + sampling as fixed protocol facts; do not treat it as equivalent to a hosted model.
6. **Output caps (MEDIUM).** `max_tokens` is silently clamped (large values accepted, `fit_max_tokens: true`), and prompt+max over 131072-8 should 400 rather than truncate — the harness must **record `finish_reason`** and treat `"length"` runs as censored, not as behavioural outcomes.
7. **`model` field unvalidated (LOW, silent-failure risk).** Any string is accepted and served by the loaded model; a typo or a model swap would go unnoticed. Assert `response.model` on every run and log it.
8. **No `/v1/completions` or embeddings/tokenize (LOW).** The harness must use chat-completions; token counts come from `usage` (`prompt_tokens` — note this includes template overhead, 26 tokens for a 2-message prompt) and `timings`.
9. **Full context not usable in practice (LOW).** 131072 is the hard cap, but a 131k prompt costs ~7 min of prefill at measured speed; effective usable prompt for this study is ~1–8k tokens.
10. **Machine contention (LOW/MEDIUM).** 5.4 GB RAM free of 31.7 GB, 26.1 GB used by the endpoint itself; Steam, ChatGPT desktop, LM Studio, Codex and WSL `SidonsoftCI` are also present on the box. Extra load could slow prefill/decode and worsen `engine_silence_s` risk.
11. **Clock/timezone display mismatch (LOW).** Dell is UTC+11 vs the Mac's UTC+10; log/text timestamps differ by 1 h while epochs agree. Normalise to UTC in analysis.
12. **Stale GPU record (LOW).** A registry entry advertises an RTX 3090; it is not present/enabled (`Get-PnpDevice` status `Unknown`, `/metrics` `gpu_count: 1`). Do not describe the endpoint as 3090-backed.

### 7.4 Unknowns

- Exact 400 body and boundary for prompt-over-context (`CTX_SLACK = 8` inferred from source; runtime test would cost ~7 min of prefill and was not run).
- Precise clamp rule for `max_tokens` (`fit_max_tokens`) per prompt length — only "huge value accepted and clamped" observed.
- Long-run stability over hours/4,800 requests (no soak test). The server does have recovery/restart logic and a 300 s engine-silence guard, but engine restart behaviour under this config was not exercised.
- Whether a fixed `seed` reproduces outputs across requests and across engine restarts.
- Whether any other LAN host or the web UI is currently using the endpoint (only 21 total requests observed, all attributable to this scouting session).
- Whether `SidonsoftCI` WSL distro or other background tasks consume CPU/GPU during a run (not investigated; out of scope).
- Power/thermal behaviour under sustained load on the RX 5700 XT (no AMD telemetry on Windows).

### 7.5 Constraints honoured

- Read-only discovery only: no repository file, no PolyStrata file, no model, no config was modified; nothing was started, stopped, or restarted; no model downloaded. Only `GET`/tiny `POST /v1/chat/completions` probes (~30 requests, 600–900 output tokens total, all free/local).
- No access to `strata-pc` / 192.168.86.23 (Natasia) at any point.
- Scratch evidence kept under `/tmp/study02-dell/` (`index.html`, `models.json`, `props.json`, `health.json`, `metrics.json`, `canon_resp.json`, `app.js`, probe scripts).

---

## 8. Discovery log (commands → observed result)

| # | Command (from Mac unless noted) | Observed |
|---|---|---|
| 1 | `ssh -o BatchMode=yes -vv dell true` | Connected, key auth OK, `'true' is not recognized …` → **cmd.exe** remote shell |
| 2 | `ssh dell 'echo %OS%'`; `ver`; `hostname`; `whoami` | `Windows_NT`; Windows 11 `10.0.26200.9711`; `DELL`; `dell\burnz` |
| 3 | `ssh dell 'wsl -l -v'` | `Ubuntu` Stopped, `SidonsoftCI` Running |
| 4 | `ping -c 2 192.168.86.39` | 100 % loss (ICMP blocked), host still TCP-reachable |
| 5 | `/dev/tcp` scan of 22,80,443,3000,5000,5001–5004,7860,8000,8080,8188,8888,9000,11434,11435 | only **22** and **8080** open |
| 6 | `ssh dell powershell -Command - < sys.ps1` | process `strata-poly.exe` PID 4848, cmdline with `--serve --max-context 131072 --kv q8_0 --threads 8 …`; parent python `-m serve.server --engine strata --config … --host 192.168.86.39 --port 8080`; OS/RAM/CPU/GPU/disks; no services/scheduled tasks/startup entries for strata; `nvidia-smi` absent |
| 7 | `curl /` , `/v1/models`, `/props`, `/health`, `/api/tags`, `/completion` | PolyStrata UI; one model `qwen3.6-35b-a3b-ud-q3_k_m`, `n_ctx 131072`; llama.cpp-style props + `build_info "PolyStrata 0.1.45"`, `model_path`, `total_slots 1`; `/health` `service:"strata"`, `api_key:false`; Ollama/llama.cpp routes 404 |
| 8 | `POST /v1/chat/completions` max_tokens 16, temp 0 | 200 in 1.17 s; `content:null`, `reasoning_content:"Thinking Process…"`, `finish_reason:"length"` → thinking-on default; `timings.predicted_per_second 24.6` |
| 9 | same + `reasoning_effort:"none"` (and `enable_thinking:false`) | 200 in 0.14–0.24 s; `content:"OK"`, `finish_reason:"stop"`; prompt-cache hits (`cached_tokens 14–16`) |
| 10 | `POST` bad model `bogus-model` | **200**, served anyway, `model` field = real id → id not validated |
| 11 | 910-token prompt, max_tokens 32 | 3.1 s; `prompt_ms 2999.4` → **303 tok/s prefill** |
| 12 | 128-token decode | 5.64 s; `predicted_n 111` in 4710 ms → **23.6 tok/s**; 58/59 draft tokens accepted |
| 13 | two parallel 16-token requests | 0.84 s and 1.65 s → **serialised** (single slot) |
| 14 | `stream:true` + `include_usage` | SSE: role chunk → `: keep-alive` ×2 → content chunk → finish+usage → `data: [DONE]` |
| 15 | `/v1/messages` (Anthropic) tiny | 200, `msg_…`, `content[].type:"thinking"`, `stop_reason:"max_tokens"` |
| 16 | `/v1/responses` tiny | 200, `resp_…`, `output[].type:"reasoning"`, `status:"incomplete"` |
| 17 | `max_tokens: 200000` | 200 (clamped, no 400) |
| 18 | missing `messages`; malformed JSON; `messages` string | 400 `invalid_request_error` with exact messages (see §5.4) |
| 19 | `/v1/completions`, `/api/requests`, `/v1/vram` | 404 `{"error":{"message":"not found"}}` |
| 20 | `/v1/status`, `/metrics`, `/api/models`, `/api/models/current` | full state: dialects, concurrency 1, uptime, timings, VRAM numbers, hardware static (RX 5700 XT 8176 MiB, i7-10700 8C/16T) |
| 21 | `ssh dell` → `Get-CimInstance Win32_Process`, `Get-Content server.py`, `Select-String` | `MODEL_CARD_SAMPLING` table, `reasoning_effort` resolution order, `QUEUE_BEAT_S/KEEPALIVE_S=10`, `CTX_SLACK=8`, "requests are never truncated", `api_key=""` |
| 22 | `powercfg /query`, `query session`, `Get-PnpDevice -Class Display` | AC standby 0 (never), console session 1 active, RX 5700 XT OK + RTX 3090 `Unknown` (stale), `started` epoch vs `Get-Date` → UTC+11 |
| 23 | 5× tiny sequential requests | 0.128–0.142 s each, HTTP 200; `/health` 2.7–3.5 ms from Mac |
| 24 | `Authorization: Bearer not-a-real-key` | 200 → no auth |
