# Muse Recall — evidence map

Every claim we make in the submission story, demo script, and copy is mapped here to existing
evidence: the file, the branch/commit it lives at, what kind of evidence it is, whether the
artefact is **authentic model output** or a **deterministic fixture**, confidence, and limits.
Original evidence files are never modified by this submission work.

**How to read the branch column:** evidence is pinned by commit on the branch where it was
produced; several artefacts live only on those branches, not on this documentation branch.
Verify any artefact with:

```bash
git fetch origin
git ls-tree -r --name-only <branch> | grep <path>     # does it exist there?
git show <commit>:<path>                              # read it without checking out
```

## Branch / commit reference

| Phase | Branch | Key commits |
| --- | --- | --- |
| 11A release readiness + real-model trials | `agent/phase11-release` | `d35fa9d` (fixture key removal), tip `a806145` |
| 11B creative-memory evaluation | `agent/strata-phase11-memory` | tip `0ce6444` |
| 11C decision-aware evaluation | `agent/strata-phase11-decision-eval` | tip `dece8c1` |
| 12A production memory validation (A/B/C real trial) | `agent/phase12-memory-validation` | prompt parity `1b16417`, report `687bbe0`, tip `90dfac9` |
| 12B Decision Guard engine | `agent/strata-phase12-decision-guard` | engine `3b4c74c`, doc `398418a` |
| 12C Decision Guard advisory integration | `agent/phase12c-guard-advisory` | engine merge `740292f`, impl `8f2d509`, report `260d9ce` (tip) |
| 12D Decision Guard accuracy audit | `agent/strata-phase12d-guard-audit` | corpus `0ea7c76`, fix+audit `4680ad3` |

## Claim-by-claim map

### C1 — Memory is persistent, project-scoped, and survives sessions

- **Evidence:** `docs/PHASE11_MEMORY_EVALUATION.md` (this branch); tests in
  `tests/evaluation/forge-memory/forge-memory.test.ts` (`0ce6444`).
- **Kind:** deterministic tests over a real file-backed SQLite database opened across sessions
  (cross-session reopening is real, not mocked); project-isolation test proven.
- **Authentic vs fixture:** deterministic fixture; the *pipeline* is production code paths.
- **Confidence:** high (12/12 tests green; re-runnable via
  `pnpm vitest run tests/evaluation/forge-memory`).
- **Limitations:** deterministic layer validates the pipeline, not model behaviour.

### C2 — Decisions are correctable; corrections supersede and stale guidance stops constraining

- **Evidence:** `docs/PHASE11_MEMORY_EVALUATION.md` §3 results 4–5 and
  `docs/PHASE11_DECISION_AWARE_EVALUATION.md` §2 (scenario S3), this branch; supersession
  unit tests in `tests/unit/memory-engine-phase2.test.ts`.
- **Authentic vs fixture:** deterministic.
- **Confidence:** high (atomic supersession, idempotent replay, conflict detection, audit history
  all test-proven).
- **Limitations:** none material for the claim itself.

### C3 — Real Muse models generate and modify the game (not scripted output)

- **Evidence:** `docs/hackathon-evidence/phase11/trials.json` + `README.md`
  (`agent/phase11-release`); `docs/MUSE_FORGE_FEASIBILITY.md` (this branch, records the original
  generation by `muse-wonder-1.0`); authentic artefacts `experiments/muse-forge/game/index.html`
  (this branch, sha-pinned) and `demo/forge-baseline/index.html` (cloud branches; recorded real
  `muse-spark-1.3-contributor` generation, sha `79c9d67a…9ba9e41`).
- **Kind:** 5/5 real-model modification trials, each approved and rolled back; latency mean
  55.7 s / median 48.1 s / range 34.1–104.2 s; 995,828 input / 8,180 output tokens across 34 calls.
- **Authentic vs fixture:** authentic model output.
- **Confidence:** high for "works" (5/5), medium for "typical cost/time" (n=5, quota-failover
  conditions documented).
- **Limitations:** single developer environment; failover to contributor key exercised on all
  five trials.

### C4 — Modifications edit the existing approved source rather than regenerating wholesale

- **Evidence:** per-trial `diff` stats in `docs/hackathon-evidence/phase11/trials.json`
  (`agent/phase11-release`): changed lines 1.2–10.1% of the original file across all five trials;
  Phase 12A `{A,B,C}-v2.html` (`agent/phase12-memory-validation`) are small edits of the pinned
  baseline.
- **Kind:** authentic output, measured by deterministic diff tooling.
- **Confidence:** high (the modify path structurally stages a single `index.html` against the
  approved version; CAS promotion blocks stale-base overwrites).
- **Limitations:** the percentages describe the five observed trials, not a guarantee.

### C5 — The modified game is executed before approval (runtime verification, blocking)

- **Evidence:** `apps/server/src/forge/runtime-check.ts` (headless Chrome via
  `chromium.launch({channel:'chrome'})`); runtime verification recorded as passed in
  `trials.json` and in Phase 12A `pilot.json`; `pnpm verify:runtime` script (valid scene passes,
  broken scene rejected) on all recent branches.
- **Kind:** authentic integration (real browser, real generated file).
- **Confidence:** high — a runtime failure returns 422 and cannot be approved (tested on 12C).
- **Limitations:** checks page errors + canvas presence, not gameplay semantics.

### C6 — A decision-aware advisory review cites the remembered decision and the offending source

- **Evidence:** `docs/PHASE12C_GUARD_INTEGRATION.md` (branch `agent/phase12c-guard-advisory`,
  `260d9ce`); `docs/hackathon-evidence/phase12c/evaluation.json` +
  `screenshots/ui-decision-guard-advisory.png`, `ui-review-page.png`,
  `ui-approved-with-findings.png`; 38 new tests (unit + integration + UI).
- **Kind:** the flagged case (A) is a **deterministic labelled mutation** of the authentic
  baseline — the in-page banner states "PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT";
  the compliant case (B) uses the authentic baseline itself. Integration is a real production
  path (staging → validation → runtime → guard → approval).
- **Authentic vs fixture:** fixture-driven demonstration on authentic source; no spontaneous
  model violation was captured end-to-end.
- **Confidence:** high that the panel works as described; medium that it fires on real model
  violations (probe evidence only — comment/prose false positive observed on a probe).
- **Limitations:** advisory only, never blocks; see C7.

### C7 — Guard accuracy, limits, and abstentions are measured, not asserted

- **Evidence:** `docs/PHASE12D_GUARD_ACCURACY_AUDIT.md` (this branch, `4680ad3`);
  `tests/evaluation/forge-decision/accuracy/` (72 synthetic cases + 5 authentic-source
  observations + 14 security probes, committed snapshots).
- **Kind:** deterministic adversarial corpus + read-only observations against one authentic
  generated file (sha-pinned).
- **Authentic vs fixture:** corpus is fixture; the authentic category is n=1 file.
- **Confidence:** high *for the fixture corpus*; explicitly no statistical generalisation to
  model output in the wild. Headline numbers we may use: under v1.0.0 roughly 2 in 5 blocks
  would have been wrong; after the v1.1.0 fix, still 1 in 4–6 on this adversarial corpus;
  hex-palette findings are the most reliable signal; tween-flash and `0x`/`#` hex notation are
  known blind spots.
- **Limitations:** hand-built corpus oversamples edge cases; ground truth on ambiguous fixtures
  is auditor judgement.

### C8 — Memory changed real model output (influence, not just retrieval)

- **Evidence:** `docs/PHASE12_MEMORY_VALIDATION.md` (`agent/phase12-memory-validation`,
  `687bbe0`/`90dfac9`); `docs/hackathon-evidence/phase12/pilot.json`, `{A,B,C}-v2.html`,
  `{A,B,C}-v2*.png`.
- **Kind:** one controlled A/B/C trial: same baseline (sha-identical), same byte-identical
  request, same forced model. A (sunset memory) → sunset accent drawn (`0xFF7E5F`, rendered
  coverage 1.082%); B (no memory) → neither palette (0.005%); C (corrected ocean memory) →
  ocean accent (`0x4EA8DE`, 0.879%) with the superseded sunset hex **absent from the source**.
  Prompt inclusion independently proven by byte-exact `prompt_sha256` reconstruction per job.
- **Authentic vs fixture:** authentic model output.
- **Confidence:** medium-high — the strongest causal signal in the project, but n=1 per
  condition, exploratory, single palette vocabulary.
- **Limitations:** the remembered **text colour** was not applied in A or C — reported as a
  partial palette result, never as full constraint adherence.

### C9 — Human approval is the gate; every change is versioned and rollable

- **Evidence:** approval + rollback rows in `trials.json` (all five: approved and rolled back);
  Phase 12A pilot (approved/rolled back in all three conditions); Phase 12C integration tests
  ("advisory findings present → approval still succeeds", "rollback functional after
  advisory-blocked-but-approved change"); screenshots
  `ui-approved-with-findings.png` (Phase 12C evidence).
- **Kind:** authentic integration.
- **Confidence:** high.
- **Limitations:** approval authority is this single-user local app (no multi-user ACL).

### C10 — Test suite health

- **Evidence:** `docs/PHASE12C_GUARD_INTEGRATION.md` §5: `pnpm verify` → **391 passed,
  3 skipped** at `260d9ce` (demo branch). `docs/PHASE12D_GUARD_ACCURACY_AUDIT.md` §11: **388
  passed / 3 skipped** at `4680ad3` (audit branch).
- **Kind:** CI-runnable test counts, re-producible on the named commit.
- **Confidence:** high — state the branch when quoting the number.
- **Limitations:** skipped tests are the live-Muse gate, not failures.

### C11 — Security/credential hygiene

- **Evidence:** `docs/PHASE11_RELEASE_READINESS.md` (`agent/phase11-release`): key never in
  argv/logs/jobs/API responses; one historical fixture key found, removed from tree and
  **rotated 2026-10-27**; `redactSecrets` coverage; loopback-only posture
  (`docs/security.md`, this branch).
- **Kind:** test-proven + documented remediation.
- **Confidence:** high within the local-only scope; redaction is pattern-based, not a proof.

## Claims we explicitly do NOT make (unsupported)

| Tempting claim | Verdict | Why |
| --- | --- | --- |
| "Decision Guard enforces design compliance / blocks violations" | **Unsupported** | 12C integration is advisory-only by mandate; 12D audit says NO-GO for blanket blocking; enforcement is roadmap. |
| "Decision Guard is comprehensive compliance verification" | **Unsupported** | Five pattern rule families, source-level only; 12D documents FPs/FNs and abstentions. |
| "All remembered constraints are applied to output" | **Unsupported** | Phase 12A: accent tracked in all conditions, text colour ignored; retrieval uses a budget (≤6 memories). |
| "Guard catches every violation of remembered decisions" | **Unsupported** | Tween-flash and `0x`/`#` palette false negatives are demonstrated, not hypothesised. |
| "Statistically significant improvement" | **Unsupported** | n=1 per condition (12A), n=5 trials (11A); all reported as exploratory. |
| Performance/memory-cost savings numbers beyond those cited | **Unsupported** | No controlled benchmark of end-to-end savings; earlier overhead reports measure the Muse CLI baseline, not the Forge flow. |

## Evidence gaps / open items for the director

1. No spontaneous model violation flagged end-to-end: the guard-findings demo uses the labelled
   mutation. A live recorded run that naturally triggers a finding would strengthen C6.
2. Authentic guard observations are n=1 artefact; a wider corpus of Forge-generated files is
   future work (12D §12).
3. No dedicated Phase 13 screenshot pass exists yet on the seeded `forge-demo` project — the
   recording checklist in [DEMO_SCRIPT_3MIN.md](DEMO_SCRIPT_3MIN.md) covers this; until recorded,
   the 12A/12C screenshots above are the visual evidence.
4. Requirements from the official rules page are unresolved (see
   [`requirements-review.md`](../hackathon-evidence/requirements-review.md)); anything the form
   demands beyond this package (e.g. a deployed URL) is not yet evidenced.
