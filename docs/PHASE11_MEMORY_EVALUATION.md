# Phase 11B — Creative Memory Evaluation (Muse Forge)

**Status:** harness + deterministic evidence complete; real-model trials not yet run (no authorisation at implementation time).
**Branch:** `agent/strata-phase11-memory` · **Base commit:** `6fe663b` · **Worker:** Strata (local)

## 1. Experiment design

Central product claim under test: **"AI creative decisions survive between sessions and influence future changes."**

A single approved creative constraint is stored as a project-scoped
`constraint` memory, then one identical Forge modification request is
evaluated under three memory conditions:

| Condition | Memory state | Expected retrieval |
|---|---|---|
| **A — memory enabled** | Approved constraint active: *"Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours."* | Constraint retrieved and injected |
| **B — memory unavailable** | Same project, constraint not available | Nothing injected; identical request otherwise |
| **C — corrected memory** | Approved constraint superseded by *"Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43."* | Only the corrected constraint injected |

Modification request (identical in all conditions):
**"Add a Next Level button beneath the Restart button."**

The harness mirrors the **exact production path** in
`apps/server/src/forge/runner.ts` (retrieval at lines 145–159 with budget
`{max_memories: 6, max_characters: 3000}`; prompt injection at lines 605–633,
header *"Project design decisions from previous sessions (authoritative
unless contradicted)"*). The Forge runtime itself is **not modified**; the
mirrors are pinned by tests so a runtime drift breaks the build (see §7).

## 2. Test setup

- `tests/evaluation/forge-memory/harness.ts` — dependency-free harness
  (setup per condition, retrieval capture, prompt mirror, palette/structure
  evaluators, diff size, JSON report).
- `tests/evaluation/forge-memory/forge-memory.test.ts` — 12 deterministic
  vitest cases, no model calls.
- Each condition uses a **fresh temp-dir, file-backed SQLite database**
  (cross-session reopening is real, not mocked).

### Reproduce

```bash
# deterministic acceptance tests
pnpm vitest run tests/evaluation/forge-memory

# structured JSON evidence report (no model)
pnpm tsx tests/evaluation/forge-memory/harness.ts --base 6fe663b --json

# human-readable summary
pnpm tsx tests/evaluation/forge-memory/harness.ts --base 6fe663b
```

## 3. Deterministic results (all green at base `6fe663b`)

1. Approved memory retrievable — **pass** (constraint force-included for its project even when the query does not match keywords).
2. Memory IDs recorded — **pass** (distinct UUIDs captured per job payload, same shape as `ForgeJob.memory_ids`).
3. Content reaches the model prompt — **pass** (verbatim text + authoritative framing in the modify prompt).
4. Superseded memories excluded — **pass** (original `status='superseded'`, kept in history, absent from active retrieval).
5. Corrected memories replace outdated guidance — **pass** (prompt contains only the ocean palette; `#FF7E5F` absent).
6. Project isolation — **pass** (no leakage either direction between projects).
7. Cross-session stability — **pass** (close + reopen the file DB reproduces identical IDs and injected content).
8. Condition B — **pass** (zero memories; no palette text anywhere in the prompt; request byte-identical across conditions).
9. Evaluators — **pass** (palette compliance, neon detection, superseded-palette rejection, structural checks: Phaser CDN kept, Next Level added, Restart preserved; line-multiset diff size; JSON round-trip).

## 4. Procedure for real-Muse runs (authorisation required)

Per condition (A, B, C), **3 trials each = 9 runs total**:

1. `pnpm tsx tests/evaluation/forge-memory/harness.ts --base <sha> --json` → capture `memory_ids`, prompt inclusion per condition.
2. Seed the condition's memory store; start the real Forge flow from the same approved base game (`ModifyGame` path), request = the fixed sentence above.
3. Record the Forge job id (`ForgeJob.id`) into `job_id`.
4. After the job succeeds, take the produced `index.html` and:
   - `evaluatePalette(html, condition)` (source level),
   - `structurallyValidate(html)`,
   - `diffSize(approvedBaseHtml, producedHtml)`,
   - **rendered check**: screenshot the preview and verify the accent colour pixel-wise (source text alone is necessary but not sufficient — a model may define the hex in a `<style>` yet use another colour in Phaser calls; compare the dominant non-background colour against the approved accent).
5. Fill the `metrics_templates` record from the harness output (see §5), one per trial.
6. Run conditions interleaved (A1,B1,C1,A2,…) against the same base game to reduce ordering confounds.

**Do not run before authorisation** — each trial burns real Muse quota
(one job can call the model up to 3 times: primary, fallback, plus preview
fix loop).

## 5. Metrics (per trial)

`condition`, `model_identifier`, `job_id`, `memory_ids`, `prompt_inclusion` (which constraint strings/hex appeared in the prompt), `wall_clock_ms`, `model_calls`, `input_tokens`, `output_tokens`, `diff_added_lines`/`diff_removed_lines`, `palette_compliance_source`, `palette_compliance_rendered`, `structural_validation`, `runtime_verification`, `outcome` (success/failure). Template: `realRunMetricsTemplate()` in the harness.

**Key diagnostic distinction:** `prompt_inclusion` proves *retrieval*;
`palette_compliance` only in condition A (vs B) proves *influence*.
A run is "retrieval-only" when A passes inclusion but compliance matches B's
rate; it is "influence" when A/C compliance differs from B in the direction
of the injected (or corrected) palette.

## 6. Statistical limitations

- 3 trials per condition: **exploratory only**. No significance claims.
- Report: compliant count, noncompliant count, per-condition difference, confounders (prompt position, model non-determinism, fallback-model switches, preview-fix loops altering colour, base-game visual state), and the fact that a single palette vocabulary (two hex codes) can be imitated by chance.
- Memory **cause** may only be claimed if B's compliance rate differs from A's **and** C steers toward the corrected palette (C is the strongest causal probe: only memory distinguishes C's expected palette from A's).

## 7. Recommended demo scenario + instrumentation note

Demo: run A and C back-to-back on camera (same game, same request) — sunset accent in A, ocean accent in C, while the structural change (Next Level button) appears in both. This isolates memory influence from generic edit capability.

**Required runtime instrumentation (documented, NOT implemented here — cloud agent owns the Forge runtime):** export `buildPrompt` from `apps/server/src/forge/runner.ts` (or move it to a shared module) so the harness uses the production function instead of a pinned mirror. Until then, the mirror tests act as drift alarms only if a maintainer re-runs the harness after changing `buildPrompt`; consider adding a byte-equality test that imports both once exported.

## 8. Limitations of this evaluation

- Source-level hex checks cannot fully prove rendered palette compliance; rendered check in §4 step 4 is manual pending authorised runs.
- Deterministic layer validates the *pipeline*, not the model's behaviour.
- Budget `max_memories: 6` with other project memories present may evict low-ranked constraints in real sessions (constraints are force-included by current retrieval rules — verified in this base commit).
