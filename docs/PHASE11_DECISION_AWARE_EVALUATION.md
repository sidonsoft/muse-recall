# Phase 11C — Decision-Aware Memory Evaluation

**Status:** evaluation complete; deterministic layer green; NO production code changed.
**Branch:** `agent/strata-phase11-decision-eval` · **Base:** `0ce6444` (Phase 11B) · **Worker:** Strata (local)
**Code:** `tests/evaluation/forge-decision/` (harness + 11 deterministic tests) — reproduce with
`pnpm vitest run tests/evaluation/forge-decision` and `pnpm tsx tests/evaluation/forge-decision/decision-harness.ts --json`.

## 1. Existing capability inventory (verified on this base, not aspirational)

| # | Capability | Verdict | Evidence / mechanism |
|---|---|---|---|
| 1 | Project-scoped design decisions | **Exists** | `technical_decision`/`constraint` types; `scope: project` enforced (`project_id` required); cross-project isolation test-proven (11B test 6) |
| 2 | Explicit constraints & prohibitions | **Exists (representation)** | `constraint` memory type; prohibitions live in content text ("Avoid …"). No structured prohibition vocabulary — enforcement would be pattern-based |
| 3 | Decision rationale & provenance | **Partial** | Provenance first-class: `source.session_id/reference` always present, `confidence`, `validation_status`, append-only history (`action`, `actor`, `reason`). Correction `reason` first-class (`MemoryCorrectionFieldsSchema.reason`, stored on the superseded record — test-proven §3/S3). **Decision rationale has no dedicated field**: it rides inside `content` (or tags). Convention "decision sentence + Why: …" works today, unmodified |
| 4 | Corrections & supersession | **Exists** | `correct()` atomic multi-target supersession, replay idempotency, conflict on mixed states, audit history with reason (all previously tested in `memory-engine-phase2.test.ts` + new S3 tests) |
| 5 | Retrieval of relevant decisions during modifications | **Exists** | Every Forge job retrieves (runner.ts L145–159, budget `{6, 3000}`); `PINNED_TYPES=['constraint','goal']` force-include constraints ahead of keyword relevance (retrieval.ts L97–106) — proven in S1 where request and decision share almost no words |
| 6 | Request-vs-decision conflict detection | **Absent (deterministic)** | `MemoryConflictError` covers memory-vs-memory only (duplicate/correction conflicts). Nothing detects "this *request* contradicts a remembered decision". Model sees the constraint in the prompt (soft guidance); heuristic hints exist only as proposal (§4) |
| 7 | Verification that changes respect decisions | **Absent (decision-aware)** | Forge validates structure (`validateStaged`: symlink/size/syntax guards) and runs the game headless (`checkGameRuntime`: page errors + canvas) and stores `job.validation` + unified diff at approval. None of it consults memories. A generated game that violates the sunset palette or adds a countdown passes today's gates |

**Bottom line:** storage, retrieval, pinning, provenance, and supersession are real and test-proven. The
*decision-aware* half — conflict surfacing and enforceable compliance — is **guidance-only today**:
the prompt says decisions are authoritative, but nothing checks the result.

## 2. Three evaluation scenarios (implemented + deterministic-green)

Each scenario: store decision (with "Why:" rationale appended), one fixed modification request,
compliant and violating HTML fixtures, a guard whose issues **cite the decision memory id**.

| Scenario | Decision (+rationale) | Request | Deterministic result |
|---|---|---|---|
| **S1 child-friendly** | "…children aged 5-8. Avoid flashing effects, countdown timers, penalties for mistakes." Why: children distressed by pressure | "Make the game more exciting and challenging." | Decision retrieved despite ~no word overlap; decision+rationale in prompt; guard flags **3/3** prohibited mechanics on the violating fixture citing the decision id; compliant fixture 0 issues; conflict hint fires on risky wording |
| **S2 accessibility** | "All essential game actions must remain usable without colour discrimination." Why: CVD prevalence | "Make the red and green collectibles behave differently." | Decision retrieved; guard flags colour-only distinction (1 issue, cites decision); shape/icon/label-differentiated fixture passes; colour-framed hint fires |
| **S3 corrected decision** | "warm sunset palette" → corrected "cool ocean palette instead" (reason: "Director replaced the sunset mood with an ocean mood") | "Add a new level-selection screen." | Only the corrected decision is active (original excluded, zero leakage into prompt); correction reason auditable via `history()`; palette guard catches sunset reintroduction citing the **corrected** id |

11 tests, `pnpm vitest run tests/evaluation/forge-decision` → **11/11 pass**; full repo verify at commit time (see report message): lint + typecheck clean, all suites green (3 skipped = live-Muse gate).

## 3. Deterministic vs real-model vs browser boundaries

| Layer | Proves | Status |
|---|---|---|
| **Deterministic (done)** | retrieval+pinning, prompt inclusion of decision+rationale, supersession exclusion + audit, fixture-level guard detection with decision citation, conflict hints | 11 tests green, zero quota |
| **Real Muse required** | that the *model* actually avoids prohibited mechanics in real generated code; that it proposes safe alternatives on conflict; semantic conflict judgement beyond word heuristics | not runnable here (no authorisation; quota) |
| **Browser/runtime required** | rendered flashing/pacing (source regex is proxy), actual palette pixels in canvas (style hexes can be overridden by Phaser calls), interactive colour-blind simulation | `checkGameRuntime` exists in Forge; decision-specific probes would be new |
| **Fixture honesty** | guards are *fixture-level proxies*; they prove the guard plumbing and citation format, not real-game semantics | labelled in harness `BOUNDARIES` |

**Key distinction this evaluation makes explicit:** prompt guidance ≠ enforceable verification.
Today only guidance exists; the plumbing for enforcement (staging, validation field, browser
runtime check, approval flow) also exists — the missing piece is the check pack itself.

## 4. Minimal innovation proposal — "Decision Guard"

Claim to demonstrate: **"Muse remembers why a creative decision was made and helps prevent later
changes from violating it."**

Smallest feature that demonstrates it, reusing existing infrastructure end-to-end:

1. **Representation (no schema change):** decisions stored as `constraint` memories with content
   `"<decision sentence> Why: <rationale>"` and kebab-case `design-decision` tags (tags already exist,
   validated). Rationale rides in content → automatically pinned into every modify prompt by existing
   retrieval. Zero migration.
2. **Enforcement (~150–250 lines, one hook):** after `runtimeCheck` succeeds in
   `runner.ts#executeStaged` (the existing validation chain), run a small **check registry** over the
   staged HTML for the *already-retrieved* constraint memories (job keeps `memory_ids` today):
   palette hexes, banned-pattern regexes (flashing/timer/penalty), colour-only-cue heuristic. On a hit,
   append `{decision_id, excerpt, evidence}` to the existing `job.validation.issues` — the approval UI
   already renders validation issues, so the user sees *"violates remembered decision (id): …Why…"*.
3. **Conflict hints (~30 lines, prompt-only):** one sentence in `buildPrompt`: *"If the request
   conflicts with these decisions, honor the decisions and state the conflict in your summary."*
   Plus the heuristic hint surfaced at job creation (harness-proven). Cloud agent owns this one-line
   prompt change.
4. **No auto-retry on violation** (quota-safe, keeps human approval authoritative). Violation marks
   the job's validation; the director approves knowingly or re-prompts.

Explicitly **not** proposed: decision graphs, new DB schema, semantic NLU conflict detection —
none needed before Nov 4; evidence above shows existing retrieval + pinning + validation hooks suffice.

## 5. Risks and effort

| Risk | Mitigation |
|---|---|
| Regex guards false-positive/negative on real generated code | frame as *warnings in the approval UI*, not hard blocks; palette check is the most reliable, flashing check the least |
| Prompt drift: harness mirrors unexported `buildPrompt` | unchanged 11B instrumentation request: export `buildPrompt` (one-line change, cloud-owned) |
| Constraint budget (`max_memories: 6`) with many constraints | pinning already prioritises constraints; cap design decisions per project at ~4 for the demo |
| Model ignores guidance despite injection | S1/S3 A-vs-B comparison design (11B) already isolates influence from retrieval |
| Scope creep | hard scope: 2 checks (palette + banned-pattern) + citation format only |

**Effort estimate:** guard registry + runner hook ≈ 150–250 lines; tests ported from this harness
(already written); prompt sentence ≈ 1 line. **≈ 1–2 focused engineer-days**, no schema work, no
new deps, no Forge behaviour change when no constraint memories exist (registry empty → no-op).

## 6. Recommended hackathon demonstration

Same approved game, same request, three acts, ≤5 minutes:
1. **S3 live:** modify → model output uses ocean palette; open memory inspector showing the
   correction with *reason* ("Director replaced the sunset mood…"); request a sunset tweak → guard
   banner cites the corrected decision.
2. **S1 split-screen:** request "make it more exciting" → without decision memory the model adds a
   countdown+penalty; with it (same prompt) output keeps calm mechanics; guard confirms 0 violations.
3. Close on the approval screen diff + validation issues as **evidence trail**.

## 7. GO / NO-GO for November 4

**CONDITIONAL GO** — scope strictly to: (a) rationale-in-content convention (free today),
(b) check-registry hook with palette + banned-pattern checks citing decision ids into
`job.validation.issues`, (c) one prompt sentence. That trio demonstrates the differentiator with
existing retrieval, staging, validation, and approval infrastructure and an estimated 1–2 engineer-days.
**NO-GO** for: decision graphs, new schemas, semantic conflict NLU, automated a11y simulation —
demo these as *roadmap* using this evaluation's proven plumbing instead.
Deterministic tests here are the acceptance net for whichever slice is built.
