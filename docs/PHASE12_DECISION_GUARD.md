# Phase 12B — Deterministic Decision Guard Engine

**Status:** engine + tests complete on `agent/strata-phase12-decision-guard`; production integration NOT started (cloud-owned).
**Base:** `dece8c1` (Phase 11C) · **Worker:** Strata (local) · **Package:** `@mml/decision-guard` (`packages/decision-guard/`)

## 1. Architecture

Pure in-process module — no server, database, browser, filesystem, network, shell, or dynamic
evaluation. Zero external dependencies beyond a **type-only** import of `@mml/shared` (`Memory`
subset). Callers resolve active decisions from the memory engine (already happens per Forge job:
`runner.ts` stores `job.memory_ids` + retrieval results); the guard receives plain data and returns
plain data.

```
memory engine ──(active decisions, already retrieved)──┐
forge staging (staged index.html) ─────────────────────┴─▶ evaluateDecisions() ─▶ GuardResult
                                                                │
                                                    toValidationIssues() adapter
                                                                │
                                              existing job.validation.issues (cloud-owned)
```

## 2. Public function contract

```ts
evaluateDecisions(
  decisions: readonly GuardDecision[],      // Pick<Memory,'id'|'content'|'status'|'supersedes'>
  generatedSource: string,                  // untrusted generated code
  options?: { supersededDecisions?: readonly GuardDecision[] },
): GuardResult
```

- **Finding structure** (stable schema, `engine_version: '1.0.0'`): `decision_id`,
  `decision_excerpt`, `rule` (stable ids: `countdown-mechanics`, `flashing-effects`,
  `mistake-penalty`, `superseded-palette`, `colour-only-cue`, `none-applicable`),
  `severity` (`high`), `evidence` (≤160 chars source snippet), `explanation`,
  `blocks_approval`.
- **Verdicts per (decision, rule):** `PASS` | `BLOCK` | `UNVERIFIED`. Decision verdict =
  BLOCK > UNVERIFIED > PASS aggregation; result verdict aggregates over evaluations.
- **Never compliant by absence:** a decision matching no supported rule yields
  `rule: 'none-applicable', verdict: 'UNVERIFIED'`. Empty/fully-excluded decision lists → `UNVERIFIED`.
- **Determinism:** decisions evaluated in `decision_id` order; rules in fixed `RULE_ORDER`;
  no time/random/input-order effects; identical JSON output across runs.
- **Immutability:** inputs never mutated (sorts operate on copies); no input object is retained.

## 3. Supported rules

| Rule | Blocks on | Explicitly does NOT block |
|---|---|---|
| A `countdown-mechanics` | `countdown` identifier/text, `timeLeft/secondsLeft/timeRemaining`, `time/timer/clock` with `--`/`-=` | elapsed counters (`elapsed += 1`), the bare word "timer" |
| B `flashing-effects` | blink/flash `@keyframes` or animation names; `setInterval` toggling visibility/opacity/display/alpha | one-shot transitions, `bounce`-style keyframes, all other animation |
| C `mistake-penalty` | `score -=`, `score = score -`, `score--`, penalize/deduct/subtract/reduce + score, `lives -=` | `score +=`, `score = score + x` |
| D `superseded-palette` | superseded decision's **hex codes** present in active styling | family words in prose/comments (→ UNVERIFIED), unrelated styling |
| E `colour-only-cue` | red+green gameplay colours with **no** shape/icon/label/pattern cue anywhere | cue adjacent to the colour reference → PASS (narrow); cue present but unlinkable → UNVERIFIED |

Rule D requires `options.supersededDecisions` (the replaced decision texts). Without them an
enforceable correction is `UNVERIFIED`, never PASS.

## 4. Unsupported cases (by design)

- Semantic understanding beyond the five patterns ("exciting but calm" judgement) — model's job.
- Tween-based pulses (`yoyo`, `repeat: -1`), rAF sine-alpha (flashing false negatives).
- Multi-colour accessibility beyond red/green pairs; ARIA/contrast; rendered pixels.
- Palette corrections without hex codes in either decision.
- Decisions phrased without explicit prohibition wording (e.g. "prefer…") → `none-applicable`
  → UNVERIFIED.
- Timing/pacing analysis, audio, gameplay feel.

## 5. False-positive / false-negative risks

- **FP:** source *strings/comments* containing `countdown`, `blink`, `score -=` in inert code;
  mitigation: evidence snippet is shown in the approval UI; findings are advisory-visible, the
  director can approve through them (see §8: only BLOCK sets `validation.ok=false` if the cloud
  agent chooses; recommended: deny auto-approval but allow explicit override).
- **FN:** tween/rAF flashing; palettes applied via config files/variables far from hex literals;
  CSS custom properties referencing renamed vars; penalty via function call (`adjustScore(-5)` —
  `adjustScore` does not match `adjust\w* score`… known gap, documented).
- **E honesty:** PASS is granted only in the narrow adjacency form; broad accessibility compliance
  is never claimed from regex.

## 6. Security boundaries

- Bounds: `MAX_SOURCE_CHARS=400_000`, `MAX_DECISIONS=32`, `MAX_FINDINGS=64`; excerpts ≤120 chars,
  evidence ≤160. Oversized/malformed input → `UNVERIFIED` + `input_warnings`
  (`source_oversized`, `malformed_input:*`, `decision_limit_exceeded`, `finding_limit_exceeded`),
  never PASS.
- All regexes are single-pass with bounded quantifiers (`[^.]{0,80}`, `[\s\S]{0,160}?`); no
  backtracking blowup on adversarial input (verified by oversized-case test plus linear patterns).
- No `eval`, no shell, no fs, no network inside the engine; decision text and source are treated
  strictly as data; no secrets are emitted (only excerpts of the caller-supplied inputs).

## 7. Test results

`pnpm vitest run tests/evaluation` → **51/51 pass**: `decision-guard.test.ts` 19 tests
(the 18 acceptance cases incl. determinism, no-mutation, malformed, oversized + adapter contract),
`forge-memory.test.ts` 12, `decision-eval.test.ts` 11, legacy `harness.test.ts` 9. Full-repo
`pnpm run verify` at commit time: lint + typecheck + all suites green (see commit message).
No production Forge file was modified to make tests pass.

## 8. Production integration instructions (cloud agent)

1. **Where to call:** inside `runner.ts` **after** `runtimeCheck` succeeds and after
   `validateStaged` (i.e. the existing validation chain in `executeStaged`), before the job is
   marked approvable:
   ```ts
   import { evaluateDecisions, toValidationIssues } from '@mml/decision-guard';
   const guard = evaluateDecisions(activeMemories, stagedHtml, { supersededDecisions });
   const { issues, unverified_notes, blocking } = toValidationIssues(guard);
   ```
2. **Active decisions:** reuse the retrieval the job already performs (`job.memory_ids` + their
   memory rows). Only `status === 'active'` may act as constraints; the guard re-filters by
   `status` defensively, but the caller should pass only rows fetched for **this project**
   (project isolation is enforced at the caller boundary by memory scoping — pass no cross-project
   rows).
3. **Superseded resolution:** for each active decision with non-empty `supersedes`, fetch those
   ids via `engine.get(id, { includeDeleted: false })` and pass them as
   `options.supersededDecisions`. Do NOT pass superseded memories as active decisions — that's how
   stale constraints stop constraining (rule D then still knows what is forbidden).
4. **Approval semantics:** append `issues` to the existing `job.validation.issues` strings and set
   `validation.ok = validation.ok && !blocking`. A change with zero blocking findings remains fully
   approvable, unchanged. `unverified_notes` should be surfaced in job logs/summary (advisory,
   never blocking) so the director sees *what could not be verified*.
5. **No auto-retry** on blocking findings (quota policy); the human either re-prompts or approves
   knowingly (findings stay visible as an audit trail; each cites its `decision_id`).
6. **Dependency:** add `"@mml/decision-guard": "workspace:*"` to `apps/server` deps; no runtime
   state, no DI, no config needed. `engine_version` in every result for traceability.

## 9. Suggested demonstration

Same child-friendly decision, same request ("make it more exciting"), two staged outputs:
one with `@keyframes blinkBanner` + `timeLeft -= 1` → approval screen shows 2 blocking
decision-guard issues quoting the decision excerpt and evidence; one calm-but-varied version →
zero blocking issues, approvable, with the UNVERIFIED note visible for anything the engine
could not check. The difference on screen *is* the differentiator: memory not only recalled but
enforced, with honest limits printed.

## 10. Commit SHA

Engine + tests commit: **`3b4c74c`** (`feat(decision-guard): deterministic decision-compliance
engine (@mml/decision-guard)`) on `agent/strata-phase12-decision-guard` (pushed to origin).
