# 10 — D-14 frozen-prompt provenance and qualification cost-cap implementation

**Status:** offline implementation + tests completed on `study02/qual-prep` (base `dc104b9`, preserved
immutable). No model calls, no network, no paid call, no credential read. This document records what
was implemented, how it was verified, and what the qualification/confirmatory harness must do with it.

## 1. D-14 prompt provenance (blocks the D2 defect found in the pilot)

**Defect being closed.** The Dell pilot's D2 erratum: prompt files were rebuilt on resume with fresh
random memory UUIDs, so 41/132 record `prompt_sha256` values did not match the committed prompt bytes
(content identical). The Director made exact prompt provenance **mandatory**: capture exact request
bytes, stable IDs and hashes.

**Design.** A prompt set is built **once**, frozen and hashed; execution loads those bytes and never
rebuilds:

- `scripts/study02/prompt_provenance.mjs` (new)
  - `freezeOnePrompt` / `freezePromptSet`: write `<run_id>.txt` and `<run_id>.meta.json` atomically;
    never overwrite different bytes; write `prompts.manifest.json` listing every
    `prompt_sha256`, byte length, meta hash and memory IDs.
  - `loadPromptSet`: **requires** the frozen manifest; loads the *bytes on disk*; verifies prompt hash
    vs meta and vs manifest, and refuses missing/mismatched/tampered entries. Frozen prompts are
    therefore byte-exact by construction.
  - `verifyPromptSet`: re-hashes the whole set (used by the runner before execution and available for
    the freeze manifest check).
  - Metadata captures the random memory UUIDs (`memory_ids`), seeded contents, correction, retrieval
    metadata, manipulation checks, baseline hash and request text, so the prompt is reproducible in
    audit even though UUIDs are random; the UUIDs are inside the hashed prompt bytes.
- `scripts/study02/runner.mjs` integration
  - New options `frozenPrompts` / `writeFrozenPrompts`. Default keeps the historical pilot behaviour.
  - Frozen/write modes build/load the frozen set before any model call, verify the manifest, and record
    `prompt_provenance` (mode, manifest path/SHA-256, count) in the run manifest.
  - Each run record now carries `prompt_sha256` (of the bytes sent), `prompt_sent_sha256`,
    `prompt_bytes`, `prompt_meta_file`, `prompt_meta_sha256`, `prompt_frozen`,
    `prompt_provenance_version`, plus the memory IDs.
- `scripts/study02/run_pilot.mjs` gains `--write-frozen-prompts` (build once) and `--frozen-prompts`
  (load-only); both are refused together.

**Verification (offline, no model calls).**

1. Unit tests: `pnpm exec tsx experiments/study-02-rare-trigger/scripts/study02/test_prompt_provenance.mjs`
   — freeze-once, no rebuild/overwrite on second freeze, stable manifest hash, load returns the same
   bytes, hash equals the loaded bytes, memory IDs preserved, tampered prompt/meta rejected, missing
   prompt rejected, partial pairs rejected. **All pass.**
2. End-to-end dry-run against the real 132-run pilot plan, in a temporary output root:
   `run_pilot.mjs --dry-run --write-frozen-prompts --out-root /tmp/s02-fp --plan …` →
   132 prompt files + 132 meta files + manifest (`sha256 3ed10c36…`), 0 model calls;
   a second run with `--frozen-prompts` left the prompt set **byte-identical** (same aggregate hash,
   same manifest hash); appending bytes to one prompt made the next frozen run refuse with
   `REFUSED: frozen prompt hash mismatch`, exit 2.
3. The archived pilot was never touched: all tests used a temporary output root.

**Mandatory use for qualification/confirmatory.** Build the prompt set once during preparation with
`--write-frozen-prompts`, freeze its manifest into the study manifest, and execute only with
`--frozen-prompts`. A record may never be written for a prompt that is not in the frozen manifest. If
the prompt set or meta changes after freeze, the run must refuse (deviation, not silent update).

## 2. $6 cost-cap enforcement with reservation (Director requirement #1)

**Requirement.** Enforce the cap using *actual usage plus a conservative reservation for outstanding
requests*, not post-hoc estimation.

**Design.** `scripts/study02/cost_cap.mjs` (new):

- Integer micro-USD accounting (`$X per 1M tokens = X micro-USD per token`), no floating-point
  balance drift.
- **Admission rule:** a request may be dispatched only if
  `spent + reserved + reservation_next ≤ cap`.
- **Reservation (worst case):** `inputUpper = ceil(promptChars/3)` (deliberately conservative token
  bound), `output = max_tokens`; `reservation = inputUpper × inputRate + output × outputRate`
  (cached rate used on settlement only, not assumed in the reservation).
- **Settlement:** actual `usage` from the response is charged; if usage is missing the reservation is
  charged (no refund); if actual exceeds the reservation the ledger flags an overrun and **hard-stops**
  further admissions (reservation model wrong ⇒ stop, do not silently continue).
- **Ledger:** persisted atomically; on restart, reservations that were outstanding are conservatively
  charged to spend and recorded for reconciliation.
- `assertPlanFits` gives the pre-run worst-case check.

**Verification (offline).** `pnpm exec tsx .../test_cost_cap.mjs` — arithmetic, admission with
in-flight reservations, release, actual-usage settlement, missing-usage conservatism, overrun hard
stop, persistence/recovery, and plan-fit refusal. **All pass.** Worked numbers at the public rates
($1.25 input / $0.15 cached / $4.25 output per 1M): a worst-case request at 24,000 prompt chars and
32,000 max output reserves **$0.146**. Two plan-level figures are relevant and both fit the cap:
the qualification plan's token ceilings (248,500 input / 937,280 output, `review/03`) give
**$4.294065** (`review/09` §4.9, headroom **$1.705935** ≈ 11 full-cap retries), while the uniform
per-request reservation model (32 × 24,000 chars/32,000 max) gives a more conservative
**$4.67** (`test_cost_cap.mjs` plan-fit assertion). Expected spend is ≈**$2.25**. Qualification
must configure the ledger with the **verified account rate card** and a **$6.00 cap** before
dispatch; `review/09` §4.9 is the execution-day reconciliation source.

## 3. What remains for the qualification harness (not executed here)

1. Wire `CostCap` into the qualification runner: admission before each send, `settle` with actual
   usage after each response, `release` only for requests never dispatched, and a hard stop that
   drains in-flight requests and writes the ledger into the qualification report.
2. Build the qualification prompt set once with frozen prompts (the 32-request plan's 24 core cells +
   probes are a subset/variant of the corpus plan; the qualification runner should freeze its own
   prompt set under `qualification-baseten/` and hash it).
3. Record requested/returned model identity, request IDs, usage, timing, finish reason and provider
   version metadata per attempt (see `review/09-BASETEN-VERIFICATION-AND-COST-CONTROL.md`).
4. Verify the ledger total against provider billing after the qualification; any discrepancy blocks
   the confirmatory decision until explained.
5. No qualification/confirmatory call may run until the credential, billing/rate-card and account
   limits are verified and the Director's $6 authorization is in force.
