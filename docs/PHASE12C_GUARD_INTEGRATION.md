# Phase 12C — Decision Guard Advisory Integration

**Branch:** `agent/phase12c-guard-advisory`
**Base:** `90dfac9` (accepted Phase 12A / `agent/phase12-memory-validation`)
**Engine merge:** `740292f` (contains Strata's `3b4c74c`, `398418a`)
**Implementation:** `8f2d509`
**Mode:** advisory only — server-side Decision Guard blocking is **not** enabled.
No merge to `main` or `experiment/muse-forge`; no submission.

---

## 1. Integration architecture

```
memory engine ──job.memory_ids──▶ resolveDecisionContext() ──active+s historia──┐
                                                                               ▼
staged index.html ──▶ validateStaged() ──▶ runtimeCheck() ──▶ evaluateDecisions() ──▶ advisory
      │                    │                     │                    │
      │              structural gate        blocking gate       pure engine
      │                                                         (@mml/decision-guard)
      └─────────────────────────── never modified by the guard ──────────────┘
                                                                               │
                                                          DecisionGuardAdvisory (bounded)
                                                                               │
                                     job.decision_guard ──┬── GET /jobs/:id
                                                          └── GET /jobs/:id/diff ──▶ review UI
```

### Modules

| File | Responsibility |
| --- | --- |
| `packages/decision-guard/` | Strata's pure engine (merged unchanged). No server, DB, browser, fs, network, or `eval`. |
| `apps/server/src/forge/decision-guard.ts` | Provenance resolution, engine invocation, bounded/validated advisory projection, fail-closed degradation. |
| `apps/server/src/forge/runner.ts` | Two advisory snapshots (review and post-runtime) and job/diff attachment. Never reads the advisory for control flow. |
| `packages/shared/src/forge.ts` | `DecisionGuardAdvisorySchema` and additions to `ForgeJobSchema` / `ForgeDiffSchema`. |
| `apps/web/src/components/forge/DecisionGuardAdvisory.tsx` | Presentational review panel. No approval control, no HTML injection. |
| `apps/web/src/components/forge/ForgeView.tsx` | Renders the panel inside **Review change**, outside the validation block. |

### Execution order

1. Muse writes the staged source.
2. `validateStaged` runs structural/syntax validation (unchanged).
3. The budget gate runs (unchanged). Jobs that cannot be approved get no advisory.
4. **Review snapshot:** the guard evaluates the staged bytes and the job records
   `decision_guard` with `runtime_verified: false`. This is what the human sees before approving.
5. `approve()` re-reads the staged bytes and runs the blocking `runtimeCheck` (unchanged, still `422 runtime_failed`).
6. **Authoritative snapshot:** only after the runtime check passes, the guard is re-evaluated on the
   same bytes with `runtime_verified: true` and persisted **before** promotion.
7. `promote()` keeps its CAS/staleness checks; approval and rollback are unchanged.

**Why two snapshots.** The engine is a pure function of (source, decision set), so the two snapshots are
identical except for `runtime_verified` and `evaluated_at`. Evaluating only at approval would hide findings
until after the decision to approve — the opposite of a review aid. Evaluating only at review time would
mean the authoritative record predates runtime verification. The explicit `runtime_verified` flag makes the
provenance of *which* snapshot a reviewer is looking at unambiguous, and the approval-time snapshot is
always taken **after** the blocking runtime gate. The runtime browser is launched once per job, not twice.

### Non-goals preserved

- `validation.ok` is never written by the guard. Findings are a sibling field, not validation issues.
- The guard cannot authorise, deny, promote, roll back, retry, fail over, or alter budgets.
- Strata's `toValidationIssues()` helper is deliberately **not** used: it produces blocking-shaped
  issue strings. Phase 12C maps the raw `GuardResult` into the advisory contract instead.
- No database migration: `decision_guard` is additive JSON on the job, and job files are already JSON.

---

## 2. Branch and commit ancestry

```
90dfac9  chore: track Phase 12 artifacts            ← accepted Phase 12A base
   │
   ├── 3b4c74c  feat(decision-guard): deterministic engine + tests   (Strata)
   ├── 398418a  docs(phase12): record engine commit SHA              (Strata)
   │
740292f  merge: integrate Phase 12B Decision Guard engine
   │
8f2d509  feat(forge): advisory Decision Guard integration (Phase 12C)
```

Verification performed before starting:

```console
$ git merge-base 90dfac9 agent/strata-phase12-decision-guard
dece8c1…                      # already contained in 90dfac9 via b7e6314
$ git merge-base --is-ancestor dece8c1 90dfac9   # yes
$ git merge-base --is-ancestor 90dfac9 HEAD      # yes
$ git log --oneline 90dfac9..740292f
398418a docs(phase12): record engine commit SHA 3b4c74c in guard integration doc
3b4c74c feat(decision-guard): deterministic decision-compliance engine (@mml/decision-guard)
```

Only those two commits arrived through the merge. The Phase 11A/11B/11C work (`d35fa9d`,
`0ce6444`, `dece8c1`, `b7e6314`, `1b16417`, `687bbe0`, `90dfac9`) was not duplicated: the
merge was conflict-free and `pnpm-lock.yaml` gained only the new workspace importer/link.
The accepted Phase 12A prompt parity work is untouched (`buildForgePrompt`, `buildRetrievalQuery`,
`prompt_sha256`, byte-exact fixtures all still pass).

---

## 3. Advisory data contract

`DecisionGuardAdvisorySchema` (Zod, shared by server and client):

```ts
{
  mode: 'advisory',
  engine_version: string,                 // e.g. '1.0.0'
  engine_verdict: 'PASS' | 'BLOCK' | 'UNVERIFIED',  // advisory aggregate ONLY
  findings: Finding[],                    // detected violations, max 32
  unverified: Unverified[],               // limitations, max 32
  evaluated_memory_ids: string[],         // active decisions actually passed to the engine
  superseded_memory_ids: string[],        // history resolved for correction rules
  source_sha256: string | null,           // sha256 of the exact evaluated staged bytes
  runtime_verified: boolean,              // snapshot taken after the blocking runtime check?
  evaluated_at: string                    // ISO-8601, injected clock
}

Finding = {
  kind: 'violation',
  decision_id: string,                    // UUID of the project memory
  decision_ref: string,                   // bounded readable excerpt (≤160)
  rule: string,                           // engine rule id (≤64, kebab-case)
  severity: 'high' | 'medium',
  evidence: string,                       // bounded source excerpt (≤240), untrusted
  explanation: string                     // ≤400
}

Unverified = {
  kind: 'unverified',
  decision_id: string | null,             // null when the limitation is about the set
  decision_ref: string,                   // ≤160
  rule: string,                           // rule that could not be verified
  severity: null,
  code: UnverifiedCode,
  reason: string                          // ≤400
}
```

**Representation:** `job.decision_guard` and `diff.decision_guard`, both
`DecisionGuardAdvisory | null` (default `null`). The field is additive; old job files parse.
`GET /api/forge/jobs/:id` and `GET /api/forge/jobs/:id/diff` return it through the existing
envelope. There is **no** new endpoint and no database migration.

**Why `engine_verdict` is safe to ship:** it is named for its source and documented as advisory.
`validation.ok` remains the only authorisation signal; the UI renders the two in separate blocks with
different wording (`validation passed` vs `ADVISORY FINDING`). The advisory schema has no
`blocks_approval` field — the engine's `GuardFinding.blocks_approval` is dropped at the boundary so no
client can accidentally treat it as authorisation.

### Unverified codes

| Code | Meaning |
| --- | --- |
| `memory_unresolved` | A recorded id no longer resolves (missing/deleted/unavailable) — constraint not evaluated. |
| `cross_project` | The resolved memory belongs to another project; excluded for isolation. |
| `global_scope` | Global-scope memory; outside the project-scoped decision set in this phase. |
| `decision_not_active` | Recorded decision is no longer active (changed mid-flight). |
| `superseded_unresolved` | A correction's replaced text could not be resolved; the correction rule stays unverified. |
| `rule_unverified` | Supported rule could not establish compliance (engine `UNVERIFIED`). |
| `unsupported_decision` | No supported rule matches; never reported as PASS. |
| `input_warning` | Engine bound/malformed-input warning (e.g. oversized source). |
| `no_decisions` | The job recorded no project memories; nothing was verified. |
| `decision_limit_exceeded` | More than 32 active decisions; extras were not evaluated. |
| `truncated` | Reporting or serialised-size bound reached; entries were omitted (never silent). |
| `internal_error` | Fail-closed degradation (contract violation or engine throw); no compliance claimed. |

**Bounds:** findings ≤32, unverified ≤32, `evaluated_memory_ids` ≤32, `superseded_memory_ids` ≤32,
finding strings ≤400, evidence ≤240, serialised advisory ≤48 KiB (enforced by trimming with a surviving
`truncated` note). The engine's own limits (400 000 source chars, 32 decisions, 64 findings) still apply.

**Deviation from `docs/PHASE12_DECISION_GUARD.md` §8.4.** Strata suggested
`validation.ok = validation.ok && !blocking`. Phase 12C's mandate is stricter: advisory must not affect
`validation.ok` at all, so that instruction is intentionally not followed. Everything else in §8
(where to call, provenance, no auto-retry) is honoured.

---

## 4. Provenance handling

One function owns eligibility: `resolveDecisionContext()` in
`apps/server/src/forge/decision-guard.ts`. Inputs are the job's **recorded** `memory_ids` and a
memory lookup; it never re-runs retrieval and never adopts memories created after the job.

| Resolved record | Used as active constraint? | Recorded as |
| --- | --- | --- |
| active, `scope: 'project'`, `project_id === job.project_id` | yes | `evaluated_memory_ids` |
| same project, status `superseded`, referenced by an active decision's `supersedes` | no — used **only** as correction history | `superseded_memory_ids` |
| same project, status `superseded`/`expired`/`deleted` and not used as history | no | `decision_not_active` / `memory_unresolved` |
| `scope: 'global'` | no | `global_scope` |
| `project_id !== job.project_id` | no | `cross_project` |
| id does not resolve (deleted, purged, corrupt) | no | `memory_unresolved` |
| id listed in `supersedes` but unresolvable | no | `superseded_unresolved` |

Additional guarantees:

- **Superseded history is resolved separately** via the same lookup, still enforcing same-project
  ownership, so rule D can know *what* a correction replaced without ever treating the old text as a
  current constraint.
- **Mid-flight corrections:** if a recorded decision is superseded after the job started, the
  approval-time snapshot drops it (`decision_not_active`) and does **not** adopt the new replacement
  (it was never in the job context). The limitation is explicit.
- **Auditability:** the snapshot contains the exact active ids, the exact history ids, the source hash,
  the engine version, and the clock value. A reviewer can reconstruct which memories were in force
  without reading logs.
- **Fail-closed:** lookup errors, engine throws, or contract-validation failures return an advisory with
  `engine_verdict: 'UNVERIFIED'` and an `internal_error` limitation. There is no path that turns an
  unusable decision set into PASS.

---

## 5. Test results

### New tests (38)

| Suite | Tests | Covers |
| --- | --- | --- |
| `tests/unit/decision-guard-advisory.test.ts` | 20 | provenance eligibility, superseded history, cross-project/global/missing/deleted, no-new-memories, immutability, determinism, findings, unsupported, bounds, hashes, fail-closed |
| `tests/integration/forge-decision-guard.test.ts` | 12 | end-to-end job → review snapshot → runtime → approval snapshot → API/diff |
| `tests/unit/decision-guard-ui.test.ts` | 6 | rendered panel text, escaping, verdict honesty, null state |

Mapping to the phase's required cases:

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Guard executes after runtime verification | `snapshots after structural validation, then re-snapshots after runtime verification` (asserts `evaluated_at` > runtime timestamp and `runtime_verified: true`) |
| 2 | Active decision evaluated | same test + `records an advisory violation…` |
| 3 | Superseded decision excluded | `excludes a decision superseded after the job started and says so` |
| 4 | Corrected decision evaluated | `evaluates the active correction with superseded history resolved separately` |
| 5 | Same-project isolation | `keeps project isolation when a recorded id belongs to another project` |
| 6 | Missing memory → explicit limitation | `records an explicit limitation when a recorded memory can no longer be resolved` |
| 7 | Known violation → finding | `records an advisory violation without changing validation…`; real-game A |
| 8 | Compliant source → no blocking finding | `reports no finding for authentic compliant generated source`; real-game B |
| 9 | Unsupported decision → UNVERIFIED | `marks an unsupported decision UNVERIFIED and never reports PASS` |
| 10 | Advisory does not alter `validation.ok` | `records an advisory violation…` (BLOCK + `validation.ok === true`) and the API serialisation test |
| 11 | Advisory does not block approval | same test (approve → `200`, version 1) |
| 12 | Runtime failure still blocks | `keeps runtime failure blocking and leaves the advisory snapshotted as unverified` (422 `runtime_failed`) |
| 13 | Stale-base CAS intact | `keeps stale-base CAS protection while advisories are recorded` (409 `version_conflict`) |
| 14 | Rollback functional | `keeps rollback functional after an advisory-blocked-but-approved change` |
| 15 | API safely serialises findings | `serialises the advisory safely beside — not inside — validation` |
| 16 | Review UI escapes evidence | `escapes evidence and decision references instead of injecting markup` |
| 17 | Failover unchanged | Existing `tests/integration/forge-api.test.ts` failover/quota suite (6 tests) still passes unchanged |

### Full verification

| Command | Result |
| --- | --- |
| `pnpm test` / `pnpm verify` | **391 passed, 3 skipped (394)**, 27 files |
| Decision Guard engine (Strata) | 19/19 |
| Memory evaluation | 12/12 |
| Decision-aware evaluation | 11/11 |
| Forge integration (pre-existing) | 28/28 |
| `pnpm lint` (biome) | 162 files, 0 errors, 0 warnings |
| `pnpm typecheck` | all 10 workspace projects pass |
| `pnpm build` | web + server production bundles succeed |
| `node apps/server/dist/index.js` | starts; `GET /api/health` → 200 with a temp DB |
| `pnpm verify:runtime` | valid scene passes, broken scene rejected → PASS |
| `pnpm verify:forge` | 9/9 browser checks, no console/page errors (project `forge-verify-7l46l`) |
| `pnpm eval:guard` | 4/4 recorded cases + 3 engine probes |
| `pnpm evidence:guard-ui` | real API + Vite UI capture; approved version 1 |

### Failures encountered and their resolution

1. **Shared schema TDZ** (`DecisionGuardAdvisorySchema` used before declaration): the contract block was
   placed after `ForgeJobSchema`; moved above it. Typecheck caught it before runtime.
2. **Three new integration tests failed on first run** — all were test-harness mistakes, not product
   defects: CSS was injected inside a `<script>` (syntax check correctly rejected it), a project id was
   passed where a job UUID was required, and a fixture path was written as file content instead of being
   read. Fixed in the tests; the production code was not changed to accommodate them.
3. **Production build could not start (pre-existing).** The esbuild command left `@mml/agent-core`,
   `@mml/tool-runtime` and `@mml/ui-protocol` external, so `dist/index.js` imported TypeScript sources
   that Node's resolver could not link. The build now aliases all workspace packages, including
   `@mml/decision-guard`, and the built server was started and health-checked. Without this, the guard
   would have shipped in a bundle that could not resolve it.
4. **Lint/format:** control characters are stripped with code-point logic instead of a regex flagged by
   `noControlCharactersInRegex`; generated `evaluation.json` is excluded from Biome formatting.
5. **Mutation banner evidence.** The first evaluation run's banner contained the literal word
   “countdown”, and rule A correctly (but unhelpfully) cited the banner as evidence. The banner was
   reworded and both evidence runs regenerated. The underlying false-positive vector is preserved and
   documented as a dedicated engine probe (§6).

No failed test case was deleted, skipped, or weakened.

---

## 6. Real-game evaluation

**Honesty boundary.** No model call was made in this phase. The evaluation uses the **recorded real
Spark baseline** (`demo/forge-baseline/index.html`, sha256 `79c9d67a…9ba9e41`) and authentic Phase 12A
output (`docs/hackathon-evidence/phase12/A-v2.html`, sha256 `e22586b2…b878`). `tests/fixtures/fake-muse.mjs`
gained a `copy` mode that only transports chosen bytes into staging; structural validation, the real
Chrome runtime check, the guard, approval and promotion are the production code paths.

Command: `pnpm eval:guard` → `docs/hackathon-evidence/phase12c/evaluation.json`.

| Case | Source (sha256) | Decision(s) | Runtime | Guard | Approval |
| --- | --- | --- | --- | --- | --- |
| **A** known violation (labelled mutation) | `c5dfd00a…650e` (12 090 B) | child-safety `e8819fe8…` | pass (canvas) | **BLOCK** — `countdown-mechanics` + `mistake-penalty` | approved v1 |
| **B** compliant (authentic baseline) | `79c9d67a…9ba9e41` (11 529 B) | child-safety `8da74463…` | pass | **PASS** — 0 findings, 0 unverified | approved v1 |
| **C** ambiguous (authentic baseline) | `79c9d67a…9ba9e41` | colour-discrimination `43f2d91e…` | pass | **UNVERIFIED** — `rule_unverified` (no evaluable red/green pair) | approved v1 |
| **S** supplementary correction | `e22586b2…b878` (authentic A-v2) | ocean correction `36772ef3…`, history `ada84b22…` | pass | **UNVERIFIED** — rule D cannot see `0xFF7E5F` | approved v1 |

### A — known violation

A deterministic mutation of the authentic baseline adds `timeLeft = 30` with a 1 s `setInterval`
decrement and `score -= 1` on a mismatched pair. The file carries an in-page banner:
“PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT”. The mechanic is valid JavaScript, so runtime
verification passes; the guard reports two high-severity findings citing the child-safety decision,
with evidence `ar moves = 0, matches = 0, score = 100, timeLeft = 30; …` and
`… score -= 1; hudMsg.setText(…)`. Approval still succeeds — the Phase 12C mandate.

### B — known compliant

The authentic baseline contains no countdown, no repeated visibility toggle and no score deduction.
Guard returns PASS with no findings and no unverified entries; approval succeeds.

### C — ambiguous

The authentic baseline has no red/green differentiated gameplay elements, so the accessibility rule
cannot be established either way. The guard returns `UNVERIFIED` with the reason
“no evaluable red/green pair found; broad accessibility cannot be claimed”. It does **not** claim PASS.
The UI never shows a green PASS while an unverified entry exists.

### Supplementary — discovered false negative

Authentic Phase 12A condition-A output encodes the sunset accent as `0xFF7E5F`; the ocean decision uses
`#FF7E5F`. Rule D compares hex literals without normalising `0x`/`#`, so it finds neither the corrected
nor the superseded palette and returns `UNVERIFIED`. This is a **false negative** (a real reintroduced
accent is not reported), documented for Strata review and deliberately **not patched** here. It is also
a useful demonstration that the advisory is honest: it reports “could not verify”, not “compliant”.

### False positives / false negatives observed

| Probe | Expected by design | Observed | Assessment |
| --- | --- | --- | --- |
| `probe-comment-countdown` — prose “no countdown and no timer” | not a violation | **BLOCK** (evidence is the comment) | False positive: comments/prose are matched. Evidence excerpt makes it reviewable. |
| `probe-tween-pulse` — `alpha: 0, yoyo: true, repeat: -1` | not detected (documented gap) | **PASS** | False negative: tween/rAF pulses. |
| `probe-phaser-hex-encoding` — `0xFF7E5F` vs `#FF7E5F` | not detected (encoding gap) | **UNVERIFIED** | False negative: real Phaser palette corrections. |
| `probe` (implicit) — inert `score -= 1` / `timeLeft` identifiers | BLOCK (documented FP risk) | BLOCK | Inert code can trigger rule C/A; evidence excerpt is shown. |

### Screenshots

- `docs/hackathon-evidence/phase12c/screenshots/ui-decision-guard-advisory.png` — the review panel with
  two findings (Decision Guard — Advisory + non-blocking disclaimer).
- `ui-review-page.png` — full review page; validation and advisory are visibly separate.
- `ui-approved-with-findings.png` — “Change approved” with `approved: v1` while findings were present.
- `A-violation.png`, `B-compliant.png`, `C-ambiguous.png`, `supplementary-palette-correction.png` — the
  runtime-rendered games from each case.

The UI capture (`pnpm evidence:guard-ui`) is a separate run with its own seeded decision
(`9f58e063…`); it demonstrates the same production path through the real API and Vite client.

---

## 7. Security review

| Area | Control | Evidence |
| --- | --- | --- |
| Generated source is untrusted | Treated as data only; never evaluated, never written back, never included whole in a response. | Adapter tests, API test asserts a tail marker is absent. |
| Memory content is untrusted | Bounded excerpts; findings never embed a full memory. | `decision_ref` ≤160, reason ≤400. |
| XSS / HTML injection | Server strips control characters and bounds strings; UI renders evidence, references and reasons as React text children. No `dangerouslySetInnerHTML` in the panel. | `decision-guard-ui.test.ts` renders `<img onerror>` and `<script>` payloads and asserts escaped output; Playwright UI run has no page errors. |
| Size bounds | 32 findings, 32 unverified, 48 KiB serialised ceiling, engine's 400 k source bound. | `bounds findings, unverified entries and the serialised payload`; API response < 64 KiB. |
| Credentials | No credentials enter the advisory; the existing `redactSecrets` path still covers logs/errors. | Existing redaction test passes; advisory contains only ids/excerpts. |
| Filesystem paths | The advisory carries no paths; `source_sha256` is a hash, not a location. | API test asserts the temp workspace root and `/Users/` are absent. |
| Raw source in errors | Runtime/validation errors are unchanged and never include generated source; the guard has no error channel into HTTP errors. | Existing 422 test; advisory failure degrades inside the job, not the error response. |
| Project isolation | Eligibility requires `scope: 'project'` and matching `project_id`; engine input contains only resolved rows. | Cross-project test (including a forged job record) and unit tests. |
| Approval authorisation | Advisory is not read by `approve`, `promote`, or `validateStaged`; `validation.ok` is untouched; no `blocks_approval` field in the API. | Integration tests 10–11, 13–14; `engine_verdict: BLOCK` + approval 200. |
| Loopback-only posture | No new listener, route, or network call. The engine is in-process and pure. | `git diff` shows no server/app changes; `verify:forge` still runs on loopback with the existing CSP/sandbox. |
| Failover | Unchanged; the guard runs after the final attempt and does not retry. | Existing quota/failover suite passes. |

**Residual risk:** the review UI shows a pre-runtime advisory snapshot before approval. It is labelled
`pre-runtime review snapshot`, it cannot approve anything, and the authoritative snapshot is post-runtime.
A reviewer could still act on a finding whose source later failed runtime verification; in that case the
runtime gate blocks approval regardless.

---

## 8. Known limitations

1. **Advisory only.** Nothing blocks. A reviewer can approve a change with a high-severity finding, by design.
2. **Global-scope decisions are not enforced.** The phase requires “same project only”; global memories
   are recorded as `global_scope` limitations. A global “never flash” rule will therefore never block and
   always appears as unverified.
3. **Mid-flight corrections are not adopted.** If a decision is corrected after a job starts, the new
   replacement is not in the job context; the old constraint is excluded with a limitation. The user must
   regenerate to evaluate against the new decision.
4. **Rule D encoding gap (`0x` vs `#`).** Real Phaser source uses `0xRRGGBB`; decisions often use
   `#RRGGBB`. Supplied output from Phase 12A demonstrates the false negative.
5. **Comment/prose false positives.** The literal words `countdown`, `flash`, `blink`, or `score -=` in
   comments or inert strings can trigger findings. Evidence is shown, and the finding is advisory.
6. **Flashing false negatives.** Tween-based pulses (`yoyo`, `repeat: -1`) and rAF sine-alpha are not
   detected.
7. **Colour-only cue rule is narrow.** Only red/green pairs; PASS is granted only for a non-colour cue
   within 160 characters. Broad accessibility, ARIA, contrast and rendered pixels are out of scope.
8. **Unsupported decisions are UNVERIFIED.** Phrasing without explicit prohibition wording (“prefer…”)
   never matches a rule; the UI never claims compliance for it.
9. **Source-level, not pixel-level.** The engine sees the exact staged `index.html` text, not the rendered
   frame. A mechanic generated at runtime from remote data would be invisible.
10. **Two snapshots.** The review snapshot is pre-runtime by construction; the label and
    `runtime_verified` make this explicit, but it is an extra concept to understand.
11. **No historical UI.** Older jobs or jobs created before this phase have `decision_guard: null`; the
    panel says “NOT EVALUATED” rather than guessing.

---

## 9. Enforcement-readiness assessment

**Verdict: NOT READY for server-side blocking. Advisory-only is the correct posture for this phase.**

| Criterion for enforcement | Status | Evidence |
| --- | --- | --- |
| Deterministic, pure engine | Met | Strata's 19 acceptance tests; determinism/no-mutation tests |
| Findings cite the decision and source evidence | Met | Integration + real-game A |
| Provenance is auditable and project-isolated | Met | Provenance matrix, cross-project/forged-record test |
| Fail-closed on unresolved constraints | Met | `memory_unresolved`, `internal_error`, no silent PASS |
| False-positive rate acceptable for blocking | **Not met** | Comment/prose FP probe; inert-code risk |
| Recall acceptable for blocking | **Not met** | Tween pulse FN; `0x`/`#` palette FN demonstrated on authentic output |
| Global decisions covered | **Not met** | Deliberately excluded in this phase |
| Mid-flight corrections covered | Partially | Limitation recorded, replacement not evaluated |
| Reviewer override + audit trail | Not designed | No enforcement/override semantics yet |
| Director sign-off on blocking policy | Not requested | This phase explicitly forbids blocking |

If blocking were enabled today, authentic Phase 12A output would pass a palette correction it violates
(§6), and a comment saying “no countdown” would block a compliant build. Both must be fixed and
re-evaluated before enforcement. **Server-side Decision Guard blocking remains disabled.**

---

## 10. Recommended next steps

1. **Strata review of three engine issues** (no cloud-side patch):
   normalise `0xRRGGBB`/`#RRGGBB` in rule D; reduce comment/prose false positives (e.g. ignore
   comments/strings or require code-context); add tween/`repeat: -1` alpha detection to rule B.
2. **Strata adds FPs/FNs to the pure-engine regression suite** using the probes in
   `evaluation.json`, so a fix cannot regress.
3. **Director decision: global-scope constraints.** Either allow `scope: 'global'` in the guard’s
   decision set (documented policy) or keep the explicit limitation.
4. **Enforcement design (future phase, not this one):** denial only when the engine is confident
   (e.g. BLOCK with no FPs), mandatory human override with an audit reason, and `engine_version` +
   `source_sha256` pinned into the promotion record.
5. **Provenance hardening:** record the decision-set hash (ids + content hashes) on the job at start
   so the approval snapshot can prove it saw the same decision text, not just the same ids.
6. **Rendered-pixel follow-up:** if palette compliance must be enforced, evaluate the approved
   screenshot as well (the runtime check already produces one path).
7. **Keep the two-snapshot model**, but surface the approval-time snapshot in the job history so the
   audit trail shows both the review and post-runtime evaluations.
8. **Do not merge to `main`** until the director accepts this phase and the enforcement policy above.

---

## Appendix A — Reproduce

```bash
pnpm install
pnpm verify                 # lint + typecheck + 394 tests
pnpm verify:runtime         # real Chrome: valid passes, broken rejected
pnpm eval:guard             # real-game A/B/C + engine probes → evaluation.json
pnpm evidence:guard-ui      # real API + Vite review-panel screenshots
pnpm build                  # web + server production bundles
```

`pnpm verify:forge` needs the API and web client running. It accepts
`FORGE_VERIFY_BASE` when the default ports are occupied:

```bash
FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" FAKE_MUSE_MODE=auto \
  PORT=8899 DATABASE_PATH=/tmp/forge.db WORKSPACE_ROOT=/tmp/forge-ws \
  pnpm dev:server

VITE_PROXY_TARGET=http://127.0.0.1:8899 pnpm --filter @mml/web exec vite --port 5199

FORGE_VERIFY_BASE=http://127.0.0.1:5199 pnpm verify:forge
```

## Appendix B — Evidence index

See [docs/hackathon-evidence/phase12c/README.md](hackathon-evidence/phase12c/README.md) for the
file-by-file index, hashes, and what each artefact proves.
