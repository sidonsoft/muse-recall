# Phase 12E — Decision Guard Hardening and Release Candidate

**Branch:** `agent/phase12e-release-hardening`
**Base:** `260d9ce` (accepted Phase 12C advisory integration)
**Release-candidate code/tests/evidence commit:** `9054081`
**Release-document tip:** the commit containing this file (see `git log -1`)
**Engine:** `@mml/decision-guard` v1.2.0
**Mode:** advisory only — no server-side enforcement, no merge to `main`, no submission.

**Recommended decision: GO for director review as a release candidate. NO-GO for enforcement or
merging into `main` without explicit director approval.**

---

## 1. Executive summary

Phase 12E completes the two P0 hardening items found by the Phase 12D audit and the two P1
detection fixes requested by the director, without changing the product's approved positioning:

> Muse Recall — An AI creative studio that remembers your decisions, checks its work, and keeps
> you in control.

What changed:

1. **Evidence is no longer the engine's raw source slice.** Findings now carry exact match spans.
   The server builds a ±16-character excerpt around the matched construct, applies the existing
   `redactSecrets` utility before persistence, and never trusts the engine's pre-rendered evidence.
2. **The aggregate PASS claim is gone from the reviewer surface.** Every advisory now carries an
   explicit `assessment`: `violation_detected`, `no_violation_detected`, `not_verified`, or
   `evaluation_unavailable`. The UI says "no violation detected by supported checks", never
   "PASS" or "compliant".
3. **Approval safety is unchanged.** `validation.ok`, runtime blocking, CAS, rollback, project
   isolation and Muse quota failover behave exactly as before. The guard is still advisory-only and
   is not read by `approve`, `promote`, or `validateStaged`.
4. **Two narrowly demonstrated detection gaps are fixed:** `#RRGGBB`/`0xRRGGBB` palette
   equivalence (D12) and executable-vs-prose countdown evidence (A08/S07). No new rule category
   was added.

Accuracy improved where targeted, with one deliberate trade-off: D12 moved abstain → TP;
A08 moved false positive → abstain. No fixture label was rewritten.

---

## 2. Ancestry and commits

The audited Strata branch forked from `398418a` (Phase 12B engine), **before** the Phase 12C
advisory integration. A merge would have deleted the 12C integration, so the audit was integrated
by cherry-picking its two commits onto the accepted cloud tip.

```
398418a  Phase 12B engine merge (common ancestor)
├── 260d9ce  Phase 12C accepted tip (base of this branch)
│   └── agent/phase12e-release-hardening
│       ├── a92de2f  cherry-pick of 0ea7c76 (Phase 12D corpus, pre-fix baseline)
│       ├── e4a6786  cherry-pick of 4680ad3 (v1.1.0 comment masking + audit doc)
│       └── 9054081  Phase 12E code, tests and evidence
│       └── <doc tip> this release report
└── 4680ad3  agent/strata-phase12d-guard-audit tip
    ├── 0ea7c76  adversarial accuracy corpus + security probes
    └── 4680ad3  v1.1.0 comment masking + Phase 12D audit
```

- Original audit commits: `0ea7c76`, `4680ad3`.
- Cherry-picked equivalents: `a92de2f`, `e4a6786`.
- Phase 12C advisory integration `8f2d509` and report `260d9ce` remain in the ancestry and in the
  working tree. No 12C file was deleted.
- `main` was not modified. Nothing was merged to `main` or submitted.

---

## 3. Files changed

Engine and contract:

| File | Change |
| --- | --- |
| `packages/decision-guard/src/index.ts` | v1.2.0; `match_spans` on findings; `#`/`0x` RGB canonicalisation; rule-A executable view (HTML text, style, attributes, JS strings); comment masking retained. |
| `packages/shared/src/forge.ts` | Additive `assessment` and `assessment_reason` fields with safe defaults. |
| `apps/server/src/forge/decision-guard.ts` | Match-span evidence projection, redaction before truncation, explicit assessment, final redaction pass. |
| `apps/server/src/forge/runner.ts` | Pass configured credentials to the advisory projection. |
| `apps/web/src/components/forge/DecisionGuardAdvisory.tsx` | Assessment-first panel; supported-checks scope; no PASS/green compliance claim. |

Tests and tooling:

| File | Change |
| --- | --- |
| `tests/evaluation/forge-decision/accuracy/accuracy.test.ts` | Updated pinned FP/FN sets for A08/D12; documented targeted changes; S07/S09 probes reflect the new boundary. |
| `tests/evaluation/forge-decision/accuracy/__snapshots__/accuracy.test.ts.snap` | Regenerated for v1.2.0 behaviour only (A08, D12). |
| `tests/evaluation/forge-decision/decision-guard.test.ts` | 9 new targeted palette/countdown tests; adapter fixture uses executable countdown. |
| `tests/integration/forge-decision-guard.test.ts` | Assessment coverage; credential redaction across job/API/persisted metadata/logs/diff advisory. |
| `tests/unit/decision-guard-advisory.test.ts` | Assessment, context minimisation and redaction tests. |
| `tests/unit/decision-guard-ui.test.ts` | Assessment labels, no-compliance-claim tests. |
| `scripts/phase12e-guard-evaluation.ts` | Phase 12E production evaluation and evidence writer. |
| `scripts/phase12e-guard-ui-evidence.ts` | Phase 12E review-ui capture. |
| `package.json` | `eval:guard` / `evidence:guard-ui` point at the Phase 12E scripts; Phase 12C evidence is not overwritten. |

Docs and evidence:

- `docs/PHASE12E_RELEASE_HARDENING.md` (this file)
- `docs/hackathon-evidence/phase12e/` (19 files: evaluation, accuracy baselines/current, authentic,
  verification, health, sources, screenshots, README)
- `docs/PHASE12C_GUARD_INTEGRATION.md` — credential claim corrected with a Phase 12E addendum;
  historical 12C content otherwise preserved.

---

## 4. P0-A — Safe evidence handling

### Findings before

The pure engine emits `evidence` as a ±40-character slice around a match. Phase 12D probe S09
demonstrated that a credential adjacent to the match appeared verbatim in `finding.evidence`.
Production persisted that string into the job record, returned it from the API and diff, and
rendered it in the review panel. The Phase 12C doc's claim that "no credentials enter the
advisory" was false.

### Controls now

- **Exact construct:** the engine emits `match_spans` (absolute `[start, end)` offsets from the
  original source). The production adapter builds its own evidence from the source, not from the
  engine's text.
- **Minimised context:** ±16 characters around each span (max 2 spans), versus the engine's ±40.
- **Redaction before truncation:** a wider ±160-character window is passed through
  `redactSecrets` (configured API keys plus key/token/header patterns) before the excerpt is
  narrowed. This prevents cutting a secret and leaving an unmatched fragment.
- **Bounded:** evidence is flattened to one control-free line and capped at 240 characters; the
  whole advisory still has its 32/32/48 KiB bounds.
- **Escaped:** the panel renders evidence, references and reasons as React text children; there is
  no `dangerouslySetInnerHTML`.
- **Provenance:** `decision_id`, bounded `decision_ref`, rule, severity, `engine_version`,
  `source_sha256`, `evaluated_memory_ids` and `superseded_memory_ids` are preserved.
- **No raw memory dump:** `decision_ref` remains a bounded excerpt, not a full record, and is
  redacted.
- **Logs:** guard evidence is never logged. Existing job log/error/summary sanitisation is
  unchanged; integration tests assert synthetic secrets do not appear in logs or persisted job
  metadata.

### Verified with synthetic secrets

`tests/integration/forge-decision-guard.test.ts` seeds a source with `sk-live-EVIDENCESECRET42`
adjacent to a countdown match and a decision containing `sk-live-MEMORYSECRET42`. It asserts both
secrets are absent from:

- the returned findings and advisory JSON,
- `GET /api/forge/jobs/:id`,
- the persisted job record,
- job logs,
- the diff's `decision_guard`.

The generated source file itself still contains the synthetic secret: it is the artifact under
review and is deliberately not rewritten. Only projected metadata is redacted.

The production evaluation records this independently in
`docs/hackathon-evidence/phase12e/evaluation.json` (`projection_probe`, `projection_redaction_ok:
true`), with a projected excerpt that still identifies `timeLeft` and shows a complete
`[REDACTED:api-key]` marker.

---

## 5. P0-B — Correct compliance presentation

### Problem

The engine's aggregate PASS could be reached after a supported rule passed while another axis of
the same decision was never linked (corpus E13). The Phase 12C panel rendered `PASS (advisory)`
with a green tone when no unverified entries existed, which could read as complete compliance.

### Distinctions now exposed

| `assessment` | Meaning | UI label |
| --- | --- | --- |
| `violation_detected` | At least one supported check reported a finding. | `VIOLATION DETECTED` |
| `no_violation_detected` | Every recorded decision matched a supported check, all passed, and no limitation was recorded. | `NO VIOLATION DETECTED · SUPPORTED CHECKS` |
| `not_verified` | A constraint or decision could not be checked (unsupported, unresolved, inactive, capped, truncated, no decisions). | `NOT VERIFIED` |
| `evaluation_unavailable` | The engine did not complete (internal error, oversized/malformed source). | `EVALUATION UNAVAILABLE` |

The panel always shows:

- **Decision Guard — Advisory**,
- **Findings do not block approval in this version.**,
- **Supported checks only: countdown mechanics, flashing effects, mistake penalties, superseded
  palette, colour-only cues. A passing supported check is not a compliance certification, and
  constraints outside these checks are not verified.**,
- the assessment reason, including "not a certification that every remembered decision was
  verified" for a clean pass.

There is no `PASS` badge, no green compliance claim, and no new scoring system. `engine_verdict`
is retained only as engine provenance.

### Residual aggregate limitation (E13)

The engine still cannot know that a decision like "never use flashing effects or red/green-only
pairs" has an unlinked colour axis if its keyword matcher only links the flashing rule. Phase 12E
does not add semantic colour matching (out of P1 scope). The presentation therefore never claims
verification beyond the supported checks, and the standing scope note names the limitation. This
remains a documented coverage gap, not a presentation overclaim.

---

## 6. P0-C — Preserved approval safety

Decision Guard remains advisory. The following are unchanged and covered by the existing plus new
tests:

| Invariant | Evidence |
| --- | --- |
| `validation.ok` is not changed by findings. | Integration test with `engine_verdict: BLOCK`, `validation.ok: true`, approval 200. |
| Runtime failure still blocks approval. | `GET`/approve test returns 422 `runtime_failed`; version stays null. |
| CAS stale-base protection is intact. | Two staged mods; second approval returns 409 `version_conflict`. |
| Rollback remains functional. | Approve v1, approve v2 with advisory findings, rollback returns v1. |
| Findings neither authorise nor deny promotion. | Advisory is not read by `approve`, `promote`, `validateStaged`; no `blocks_approval` field in the API. |
| Failover is unchanged. | 6/6 quota/failover tests pass. |
| Project memory isolation is preserved. | Cross-project decision excluded with `cross_project`; only same-project active memories evaluated. |
| No server-side enforcement. | No guard result is read on any authorisation path. |

The engine's `blocks_approval` flag remains internal to the pure engine and is deliberately not part
of the API contract.

---

## 7. P1 — Targeted detection improvements

### 7.1 Palette equivalence (v1.2.0)

`#RRGGBB` and `0xRRGGBB` now canonicalise to the same six-digit RGB token before comparison.
Case is already normalised. This fixes the strongly demonstrated D12 mismatch (`0x` source vs `#`
record) and the supplementary authentic Phase 12A case (`0xFF7E5F` vs `#FF7E5F`).

Deliberately **not** widened:

- 8-digit RGBA hex (D07) remains a false negative.
- 3-digit shorthand is not added.
- Family-word matching and semantic colour analysis are unchanged.
- Supersession is still required: without `supersededDecisions`, the rule abstains.
- Multiple superseded records still inspect only the first found (D14 remains an FN).

### 7.2 Countdown executable-vs-prose evidence (v1.2.0)

Rule A now builds a length-preserving executable view of the source:

- HTML text nodes, `<style>` content, inert attribute values, and JavaScript string/template
  literals are blanked;
- script code, inline event-handler attributes, and HTML comments are handled as before
  (comments already masked by v1.1.0);
- if a countdown token appears in the executable view → **BLOCK** with a code match;
- if it appears only in the non-executable view → **UNVERIFIED** (prose is neither a finding nor
  compliance);
- if it appears only in comments → **PASS** (comments are inert).

This fixes A08 (`helpText = '… no countdown …'`) and the S07 inert-attribute over-block, without
adding a general JavaScript parser. Inline event handlers remain conservative: executable
`onclick="timeLeft -= 1"` still blocks. Template `${…}` expressions are conservatively treated as
inert text; a token there produces UNVERIFIED, not PASS or BLOCK.

No new rule category was added.

---

## 8. Accuracy gates

The accepted 72-case Phase 12D corpus and its ground-truth labels are unchanged. Baselines were
re-run from the preserved commits (`a92de2f` for v1.0.0, `e4a6786` for v1.1.0). Full rows and
metrics are stored in `docs/hackathon-evidence/phase12e/accuracy*.json`.

### 8.1 v1.2.0 per-rule results (synthetic corpus)

| Rule | n | TP | FP | TN | FN | Precision | Recall | FPR | FNR | Abstain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| countdown-mechanics | 15 | 4 | 0 | 7 | 2 | 1.000 | 0.667 | 0.000 | 0.333 | 2 |
| flashing-effects | 14 | 4 | 2 | 5 | 3 | 0.667 | 0.571 | 0.286 | 0.429 | 0 |
| mistake-penalty | 14 | 5 | 2 | 4 | 2 | 0.714 | 0.714 | 0.333 | 0.286 | 1 |
| superseded-palette | 16 | 5 | 1 | 3 | 2 | 0.833 | 0.714 | 0.250 | 0.286 | 5 |
| colour-only-cue | 13 | 3 | 1 | 1 | 2 | 0.750 | 0.600 | 0.500 | 0.400 | 6 |

### 8.2 Before/after comparison

| Rule | Version | TP | FP | TN | FN | Precision | Recall | FPR | FNR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| countdown | v1.0.0 | 4 | 3 | 4 | 2 | 0.571 | 0.667 | 0.429 | 0.333 |
| countdown | v1.1.0 | 4 | 1 | 7 | 2 | 0.800 | 0.667 | 0.125 | 0.333 |
| countdown | **v1.2.0** | **4** | **0** | **7** | **2** | **1.000** | **0.667** | **0.000** | **0.333** |
| flashing | v1.0.0 | 4 | 3 | 4 | 3 | 0.571 | 0.571 | 0.429 | 0.429 |
| flashing | v1.1.0 | 4 | 2 | 5 | 3 | 0.667 | 0.571 | 0.286 | 0.429 |
| flashing | **v1.2.0** | **4** | **2** | **5** | **3** | **0.667** | **0.571** | **0.286** | **0.429** |
| penalty | v1.0.0 | 5 | 3 | 3 | 2 | 0.625 | 0.714 | 0.500 | 0.286 |
| penalty | v1.1.0 | 5 | 2 | 4 | 2 | 0.714 | 0.714 | 0.333 | 0.286 |
| penalty | **v1.2.0** | **5** | **2** | **4** | **2** | **0.714** | **0.714** | **0.333** | **0.286** |
| palette | v1.0.0 | 4 | 2 | 2 | 2 | 0.667 | 0.667 | 0.500 | 0.333 |
| palette | v1.1.0 | 4 | 1 | 3 | 2 | 0.800 | 0.667 | 0.250 | 0.333 |
| palette | **v1.2.0** | **5** | **1** | **3** | **2** | **0.833** | **0.714** | **0.250** | **0.286** |
| colour | v1.0.0 | 3 | 2 | 1 | 2 | 0.600 | 0.600 | 0.667 | 0.400 |
| colour | v1.1.0 | 3 | 1 | 1 | 2 | 0.750 | 0.600 | 0.500 | 0.400 |
| colour | **v1.2.0** | **3** | **1** | **1** | **2** | **0.750** | **0.600** | **0.500** | **0.400** |

### 8.3 The only per-case changes (v1.1.0 → v1.2.0)

| Case | Rule | Ground truth | Before | After | Effect |
| --- | --- | --- | --- | --- | --- |
| A08 | countdown | compliant | BLOCK (FP) | UNVERIFIED (ABSTAIN) | Removes an unjustified block; adds one abstention. |
| D12 | palette | violation | UNVERIFIED (ABSTAIN) | BLOCK (TP) | Fixes the demonstrated notation mismatch. |

No fixture label, ground truth or ideal verdict was changed. A08's ideal remains PASS; abstaining
is the safe outcome when only prose exists. D12's ideal remains BLOCK; it is now met.

### 8.4 Authentic artifact (n = 1, separate category)

| Case | Rule | Observation |
| --- | --- | --- |
| M01 | countdown | PASS — no timer; comment is inert. |
| M02 | flashing | PASS — one-shot tweens; the known tween-pulse gap remains. |
| M03 | penalty | PASS — score only increases. |
| M04 | palette | BLOCK — genuine superseded hex in live styling. |
| M05 | colour | UNVERIFIED — honest abstain. |

Authentic observations are unchanged from Phase 12D. The artifact sha256 guard still passes.

### 8.5 Remaining false positives (BLOCK on compliant fixtures)

| Case | Rule | Why |
| --- | --- | --- |
| B13 | flashing | `setInterval` sets constant alpha; the regex sees the interval + alpha within its window. |
| B14 | flashing | Decision-side negation scope leaks past `;` ("do not … flash" in a sentence that permits brief flashing). |
| C06 | penalty | UI string "the score is never reduced". |
| C09 | penalty | `reduceScoreboardPadding()` — identifier substring. |
| D04 | palette | Changelog string quoting the old swatch hex. |
| E05 | colour | Narrative sentence "the red dragon and the green knight". |

### 8.6 Remaining false negatives (PASS claimed on violations)

| Case | Rule | Why |
| --- | --- | --- |
| A09 | countdown | `secsLeft` renamed identifier has no supported token. |
| A10 | countdown | `remaining = Math.max(0, remaining - 1)` alternative construction. |
| B05 | flashing | Tween `yoyo`/`repeat: -1` pulse. |
| B08 | flashing | rAF sine `globalAlpha`. |
| B09 | flashing | `Phaser.Actions.ToggleVisibility`. |
| C07 | penalty | `points = points - 5` renamed counter. |
| C08 | penalty | Strikes → endRound without a `score` token. |
| D07 | palette | 8-digit RGBA hex (outside the targeted equivalence). |
| D14 | palette | Two superseded records; only the first is inspected. |
| E10/E11 | colour | Proximity words (`shape`, `solid`) produce a spurious narrow PASS. |

These are documented limitations, not regressions. The P1 fixes did not introduce a new FP or FN
on the accepted corpus.

---

## 9. Release verification

All commands were run on the final code. No live Muse inference was performed and none is claimed.

| Check | Result |
| --- | --- |
| `pnpm verify` | **exit 0** — lint + typecheck + **457 passed, 3 skipped** (opt-in live-Muse suite). |
| `pnpm lint` | **exit 0** — repository-wide check; 1 pre-existing informational suggestion (S13 style). |
| `pnpm typecheck` | **exit 0** — all 9 workspace packages. |
| `pnpm verify:runtime` | **PASS** — valid Phaser scene renders; broken scene `g.fillStar` rejected. |
| `pnpm verify:forge` | **9/9 checks** — generate, preview, approve, capture, modify, reject, approve v2, rollback, no console/page errors. |
| `pnpm eval:guard` | **4/4 cases** — A BLOCK/approved, B PASS/approved, C UNVERIFIED/approved, supplementary palette BLOCK/approved. |
| `pnpm evidence:guard-ui` | **PASS** — real API + Vite panel captured; VIOLATION DETECTED, advisory disclaimer and scope note present; approval v1. |
| `pnpm build` | **exit 0** — web 444.43 kB JS / 34.61 kB CSS; server 297.4 kB. |
| Built-server health | **ok** — production build, database read/write verified, schema 6. |
| Quota failover | **6/6** — retry-once, baseline restore, usage sum, validation preserved, API-key retry, no-fallback failure. |
| Project memory isolation | **PASS** — cross-project decision excluded; guard resolves only same-project active memories. |

Functional coverage mapping:

1. Generate — `verify:forge`, `eval:guard` B.
2. Modify existing approved game — `verify:forge`.
3. Runtime verification — `verify:runtime`, integration tests.
4. Decision Guard advisory review — `eval:guard`, `evidence:guard-ui`, integration tests.
5. Approval with findings present — `eval:guard` A, `verify:forge`.
6. Rollback — `verify:forge`, rollback integration test.
7. Existing Muse quota failover — forge-api failover suite.
8. Correct project memory isolation — decision-guard integration/unit tests.

Evidence: `docs/hackathon-evidence/phase12e/verification.json`,
`evaluation.json`, `accuracy.json`, `built-server-health.json`, `screenshots/`.

---

## 10. Remaining limitations

1. **Partial decision linkage (E13).** A decision can mention a constraint axis that no supported
   rule links; the aggregate can reach PASS on the linked axis. Presentation now says "no violation
   detected by supported checks", never "verified", but the engine cannot detect the unlinked axis
   without semantic analysis.
2. **String/prose and identifier false positives** remain for flashing, penalty, palette and colour
   (B13/B14/C06/C09/D04/E05). Fixing them requires semantic or identifier-aware analysis.
3. **Coverage false negatives** remain for renamed counters, tween pulses, rAF alpha, toggle
   visibility, 8-digit hex, and multiple superseded histories.
4. **Rule E narrow PASSes** from proximity words remain; the assessment labels them as supported
   passes only, not compliance.
5. **Authentic corpus n = 1.** Metrics quantify a hand-built adversarial fixture set, not
   production model output.
6. **Evidence redaction is defence-in-depth, not proof.** It applies known credential values plus
   the existing pattern set. An unknown credential format or a fragment outside the ±160-character
   window could still survive. Evidence is bounded and never includes the whole source.
7. **The generated source diff still contains the source as-is**, including anything the model
   wrote. That is the reviewed artifact; findings and metadata are redacted, the artifact is not.
8. **Direct engine callers** (audit scripts) still receive the engine's raw ±40-character evidence.
   Only the production adapter redacts. This is intentional for auditability.
9. **No enforcement.** Advisory-only is the Phase 12C decision and remains unchanged. Phase 12D's
   NO-GO for blanket automatic blocking still stands.

---

## 11. Release risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A reviewer reads "no violation detected by supported checks" as full compliance. | Medium | Explicit scope note, assessment reason, no green PASS, advisory banner. |
| A finding is a false positive (1 in 4–6 blocks on the adversarial corpus). | Medium | Advisory-only; no block; reviewer can approve with findings present. |
| A synthetic/known secret format evades redaction. | Medium | Known values + patterns + ±160 window + bounded evidence; no whole-source evidence. |
| Partial linkage (E13) hides an unlinked constraint axis. | Medium | UI never claims verification; documented limitation. |
| Old advisory snapshots lack the new fields. | Low | Zod defaults set `assessment: not_verified` and a neutral reason. |
| Engine v1.2.0 changes persisted `engine_version`. | Low | Version is recorded per job; old jobs are not re-labelled. |
| No live-Muse run in this phase. | Low | Deterministic recorded evidence; explicitly not claimed as live. |
| Branch is not merged. | Intentional | Director review required; no merge/submission in this phase. |

---

## 12. Demo readiness

**Ready for the recorded demo path.** The Phase 12E evidence shows:

- a real Fastify API + Vite review panel,
- a generated game with a detected advisory violation,
- the advisory-only banner and supported-checks scope,
- approval succeeding with findings present,
- rollback and failover unchanged,
- an authentic-artifact palette block.

Recommended demo framing: show the finding as **advisory**, show the explicit **assessment**, then
approve and roll back. Do not describe the guard as enforcement or as a compliance certificate.

Screenshots:

- `docs/hackathon-evidence/phase12e/screenshots/ui-decision-guard-advisory.png`
- `docs/hackathon-evidence/phase12e/screenshots/ui-review-page.png`
- `docs/hackathon-evidence/phase12e/screenshots/ui-approved-with-findings.png`
- `docs/hackathon-evidence/phase12e/screenshots/A-violation.png`
- `docs/hackathon-evidence/phase12e/screenshots/supplementary-palette-correction.png`

---

## 13. Recommended release decision

**GO — release candidate for director review.** The P0 security and presentation defects are
resolved, approval safety is unchanged, the targeted P1 fixes are verified, and the full release
suite passes. The remaining limitations are documented and do not justify another feature phase.

**NO-GO — enforcement or merge to `main`.** Decision Guard remains advisory; the Phase 12D audit's
NO-GO for blanket automatic blocking still applies. Merge and submission require explicit director
approval and were not performed.

---

## 14. Evidence index

See `docs/hackathon-evidence/phase12e/README.md` for the file-by-file index and provenance notes.
Historical evidence remains untouched under `docs/hackathon-evidence/phase12c/` and
`docs/hackathon-evidence/phase12/`.
