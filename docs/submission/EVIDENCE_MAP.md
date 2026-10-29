# Muse Recall — evidence map

This is the cumulative claim map. It began as the Phase 14A submission audit; later sections
add FocusFlow, Phase 15B, Phase 16 / 16B, Phase 17 and the merged release state. Original evidence
files are never modified by documentation work.

Every claim we make in the submission story, demo script, and copy is mapped here to existing
evidence: the file, the branch/commit it lives at, what kind of evidence it is, whether the
artefact is **authentic model output** or a **deterministic fixture**, confidence, and limits.
Original evidence files are never modified by this submission work.

**How to read the branch column:** evidence is pinned by commit on the branch where it was
produced; several artefacts live only on those branches. Verify any artefact with:

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
| 12E release-candidate hardening | `agent/phase12e-release-hardening` | RC `156c65c9a55833e00f6764f4fee20d93eec17e49` |
| 13 submission documents | `agent/strata-phase13-submission` | docs-only `84e6a8c` (cherry-picked, never merged) |
| 14A demo production + release blockers | `agent/phase14a-demo-production` | branched from `156c65c`; evidence in `docs/hackathon-evidence/phase14a/` |
| 15A child-safety pilot (6 runs) | `agent/phase15a-pilot` | `e62b5bc` → `9d91865`; pilot only, not pooled |
| 15B child-safety trial (32 runs) | `agent/phase15b` | protocol `d84d8a1`, results `2857159`, correction `9f5eaa1`; integrated on the release candidate |
| 16 / 16B two-model trials | release candidate → `main` | `db70d9b` (align repo to the release video + Phase 16), `f6d6e98` (16B token-limit correction); evidence in `docs/hackathon-evidence/phase16/` and `phase16b/` |
| 17 four-arm trial (480 runs) | `phase17-results` → `main` (PR #2) | results `43abe92`, review fixes `9b45774`/`d3c7c6d`/`34b9b60`; merge `53389a7` |
| Live FocusFlow demo | `agent/muse-recall-live-demo` | `2ba4ba2`; evidence in `docs/demo/` |

## Current release state (2026-10-29)

| Item | State |
| --- | --- |
| `main` | merge `12918fd` (PR #1); includes Phase 17 evidence from PR #2 (`53389a7`) and PR #3 (`36fe700`) |
| PR #1 branch tip | `5bd287a`; merged code head `0fbc1ef`; local-beta hardening merged by PR #1 |
| Tests on the merged tree | `pnpm verify` — 644 passed, 3 skipped (647 total, 41 files) |
| Tags | `submission-v14`, `submission-v15`, `phase17-preregistration` remain frozen; none moved |
| Deployment / submission | not deployed, not submitted; local-only and loopback-only |
| Phase 17 review | PR #2 review disposition: R1–R4 fixed; R5–R10 remain documented in locked files (five latent conditions did not occur; R9 is a cosmetic detector-description error) |

The numbering below is historical. C20 and C21 are the current behavioural evidence; C10's test
count is updated to the merged tree, while its earlier per-phase counts remain as history.

## Claim-by-claim map

### C1 — Memory is persistent, project-scoped, and survives sessions

- **Evidence:** `docs/PHASE11_MEMORY_EVALUATION.md`; `tests/evaluation/forge-memory/forge-memory.test.ts`;
  `packages/memory-engine/src/migrations.ts` (memories, history, supersession tables),
  `engine.ts` (create/get/list/detail), and the Phase 14A demo seed
  (`scripts/lib/demo-seed.ts`, `tests/unit/demo-seed.test.ts`), which proves project scope and
  active/superseded state through the production engine.
- **Kind:** deterministic tests over a real file-backed SQLite database opened across sessions;
  cross-session reopening is real, not mocked.
- **Authentic vs fixture:** deterministic fixture; the *pipeline* is production code.
- **Confidence:** high (tests green; re-runnable via `pnpm vitest run tests/evaluation/forge-memory`).
- **Limitations:** the deterministic layer validates the pipeline, not model behaviour.

### C2 — Decisions are correctable; corrections supersede and stale guidance stops constraining

- **Evidence:** `docs/PHASE11_MEMORY_EVALUATION.md` §3 results 4–5; `docs/PHASE11_DECISION_AWARE_EVALUATION.md`
  §2 (scenario S3); `packages/memory-engine/src/engine.ts` `correct()` (one transaction: replacement,
  supersession edges, status flip, history) and `retrieval.ts` (`m.status = 'active'`); supersession
  unit tests in `tests/unit/memory-engine-phase2.test.ts`; the Phase 14A seed leaves sunset
  `superseded` and ocean `active`, and retrieval excludes sunset
  (`docs/hackathon-evidence/phase14a/demo-seed.json`). Phase 17's Spark `corrected` arm uses the
  production correction route; the Open arm calls the same `MemoryEngine.correct()` method.
- **Authentic vs fixture:** deterministic.
- **Confidence:** high (atomic supersession, idempotent replay, conflict detection, audit history).
- **Limitations:** none material for the claim itself.

### C3 — Real Muse models generate and modify the game (not scripted output)

- **Evidence:** `docs/hackathon-evidence/phase11/trials.json` + `README.md`
  (`agent/phase11-release`); authentic artefacts `experiments/muse-forge/game/index.html` and
  `demo/forge-baseline/index.html` (recorded real `muse-spark-1.3-contributor` generation, sha
  `79c9d67a…9ba9e41`).
- **Kind:** 5/5 real-model modification trials, each approved and rolled back; latency mean 55.7 s /
  median 48.1 s / range 34.1–104.2 s; 995,828 input / 8,180 output tokens across 34 calls.
- **Authentic vs fixture:** authentic model output.
- **Confidence:** high for “works” (5/5), medium for “typical cost/time” (n = 5, quota-failover
  conditions documented).
- **Limitations:** single developer environment; failover to the contributor key was exercised on
  all five trials. **No live Muse call was made during Phase 14A evidence production.**

### C4 — Modifications edit the existing approved source rather than regenerating wholesale

- **Evidence:** per-trial diff stats in `docs/hackathon-evidence/phase11/trials.json`: changed lines
  1.2–10.1% across all five trials; Phase 12A `{A,B,C}-v2.html` are small edits of the pinned
  baseline; Phase 14A rehearsal shows the staged diff against v1
  (`docs/hackathon-evidence/phase14a/rehearsal.json`).
- **Kind:** authentic output, measured by deterministic diff tooling.
- **Confidence:** high (the modify path structurally stages one `index.html` against the approved
  version; promotion is compare-and-swap guarded).
- **Limitations:** the percentages describe the five observed trials, not a guarantee.

### C5 — The staged game is loaded in headless Chrome before promotion (blocking, load-time only)

- **Evidence:** `apps/server/src/forge/runtime-check.ts` (`chromium.launch({channel:'chrome'})`,
  page-error/console-error collection, canvas requirement, CDN allowlist);
  `scripts/verify-runtime.ts` (valid scene passes, broken scene rejected, unapproved origin
  blocked); runtime verification recorded as passed in `trials.json` and Phase 12A `pilot.json`;
  Phase 14A `guard-advisory.json` records `runtime_verified: true` after approval.
- **Kind:** authentic integration (real browser, real generated file).
- **Confidence:** high — a runtime failure returns 422 and cannot be approved (integration-tested).
- **Limitations:** **load-time only.** It does not play the game interactively, verify rendered
  pixels, test every mechanic, produce a verification screenshot, or guarantee that later
  interactions cannot crash. The approved wording is: *“Before promoting a change, Muse Forge
  launches it in headless Chrome and rejects builds that throw on load or fail to create a
  canvas.”*

### C6 — A decision-aware advisory review cites the remembered decision and the offending source

- **Evidence:** `docs/PHASE12C_GUARD_INTEGRATION.md`; Phase 12E evidence
  (`docs/hackathon-evidence/phase12e/evaluation.json`); Phase 14A
  `screenshots/05-guard-advisory-mutation.png` + `06-review-mutation.png`; 38 new Phase 12C tests
  plus the Phase 14A integration suite.
- **Kind:** the flagged case (A) is a **deterministic labelled mutation** of the authentic baseline —
  the in-page banner states “PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT”; the compliant
  case uses authentic source. Integration is the real production path (staging → validation →
  runtime → guard → approval).
- **Authentic vs fixture:** fixture-driven demonstration on authentic source; no spontaneous model
  violation was captured end-to-end.
- **Confidence:** high that the panel works as described; medium that it fires on real model
  violations (probe evidence only).
- **Limitations:** advisory only, never blocks; see C7.

### C7 — Guard accuracy, limits, and abstentions are measured, not asserted

- **Evidence:** `docs/PHASE12D_GUARD_ACCURACY_AUDIT.md`; `docs/hackathon-evidence/phase12e/accuracy.json`
  (engine v1.2.0, 72 synthetic cases, 5 authentic observations, 14 security probes, pinned sets);
  `tests/evaluation/forge-decision/accuracy/`.
- **Kind:** deterministic adversarial corpus + read-only observations against one authentic
  generated file (sha-pinned).
- **Authentic vs fixture:** corpus is fixture; the authentic category is n = 1 file.
- **Confidence:** high *for the fixture corpus*; explicitly no statistical generalisation to model
  output in the wild. v1.2.0 per-rule precision/recall: countdown 1.00 / 0.667; flashing 0.667 /
  0.571; mistake-penalty 0.714 / 0.714; superseded-palette 0.833 / 0.714; colour-only 0.75 / 0.60,
  with abstention rates from 7% to 46%. Phase 12E moved D12 (`0x` source vs `#` record) from ABSTAIN
  to TP via hexadecimal notation equivalence, and A08 (inert countdown prose) from FP to ABSTAIN.
- **Limitations:** hand-built corpus oversamples edge cases; ground truth on ambiguous fixtures is
  auditor judgement. Remaining known gaps: 8-digit RGBA hexes, tween-based flashes, and
  string/prose or identifier-substring false positives.

### C8 — Memory changed real model output (influence, not just retrieval)

- **Evidence:** `docs/PHASE12_MEMORY_VALIDATION.md` (`687bbe0`/`90dfac9`);
  `docs/hackathon-evidence/phase12/pilot.json`, `{A,B,C}-v2.html`, `{A,B,C}-v2*.png`; Phase 14A
  presentation `docs/hackathon-evidence/phase14a/memory-influence.{md,html,png}` and
  `memory-influence.json`.
- **Kind:** one controlled A/B/C trial: same baseline (sha-identical), same byte-identical request,
  same forced model. A (sunset memory) → sunset accent drawn (`0xFF7E5F`, rendered coverage
  1.082%); B (no memory) → neither palette (0.005%); C (corrected ocean memory) → ocean accent
  (`0x4EA8DE`, 0.879%) with the superseded sunset hex **absent from the source**. Prompt inclusion
  independently proven by byte-exact `prompt_sha256` reconstruction per job.
- **Authentic vs fixture:** authentic model output.
- **Confidence:** medium-high — the strongest causal signal in the project, but n = 1 per
  condition, exploratory, single palette vocabulary.
- **Limitations:** the remembered **text colour** was not applied in A or C — reported as a partial
  palette result, never as full constraint adherence.

### C9 — Human approval is the gate; every change is versioned and rolls back to its recorded parent

- **Evidence:** approval + rollback rows in `trials.json` (all five approved and rolled back); Phase
  12A pilot (approved/rolled back in all three conditions); Phase 12C integration tests;
  `apps/server/src/forge/workspace.ts` (`promote()` binds `expectedSha256`; `rollbackTarget()`
  follows `base_version`), `runner.ts` `approve()` (runtime check before promotion), and Phase 14A
  `rollback-ancestry.json` (v1→v2→undo→v3 from v1→undo restores v1; repeated undo reports nothing
  to roll back) with `screenshots/09-approved-v2.png`, `10-rolled-back-v1.png`.
- **Kind:** authentic integration + deterministic regression evidence.
- **Confidence:** high.
- **Limitations:** approval authority is this single-user local app (no multi-user ACL).

### C10 — Test suite health

- **Evidence:** merged `main` at `12918fd` / PR #1 code head `0fbc1ef` (branch tip `5bd287a`): `pnpm verify` → **644 passed, 3
  skipped** (647 total, 41 files), lint and typecheck clean; CI `verify` and `browser` jobs passed
  on the merged heads. Historical: Phase 14A **484 passed / 3 skipped** on
  `agent/phase14a-demo-production` (30 test files); Phase 12E 457/3 at `156c65c`; Phase 12C
  391/3 at `260d9ce`.
- **Kind:** CI-runnable test counts, re-producible on the named commit.
- **Confidence:** high — state the commit when quoting the number.
- **Limitations:** the three skipped tests are the opt-in live-Muse suite, not failures. Test counts
  are engineering health, not evidence of application correctness or model behaviour.

### C11 — Security / credential hygiene and loopback integrity

- **Evidence:** `docs/PHASE11_RELEASE_READINESS.md` (key never in argv/logs/jobs/API responses; one
  historical fixture key removed and **rotated 2026-10-27**; `redactSecrets` coverage); Phase 14A
  host-header tests (`tests/unit/host-guard.test.ts`, `tests/integration/api.test.ts`), reject
  serialisation, checked-source integrity, runtime network allowlist, and preview message-origin
  check (`tests/integration/forge-api.test.ts`, `apps/server/src/host-guard.ts`,
  `apps/server/src/forge/runtime-check.ts`).
- **Kind:** test-proven + documented remediation.
- **Confidence:** high within the local-only scope; redaction and host checks are pattern/allowlist
  based, not a proof, and there is still no authentication.
- **Limitations:** the API remains a single-user loopback service with no authn/z; host validation
  raises the cost of DNS rebinding, it does not make the service safe to expose.

### C12 — The demo is reproducible from documented commands

- **Evidence:** `scripts/seed-forge-demo.ts`, `scripts/lib/demo-seed.ts`, `tests/unit/demo-seed.test.ts`,
  `docs/hackathon-evidence/phase14a/demo-seed.json`; `pnpm demo:seed` is idempotent (3 memory rows
  after repeated runs, byte-identical `state.json`, same memory ids), uses the production engine,
  and creates no credentials.
- **Kind:** deterministic integration through the production memory engine and workspace format.
- **Confidence:** high.
- **Limitations:** re-seeding resets the workspace to v1 (documented recovery path), so it is not a
  migration tool.

### C13 — Bounded integrity fixes landed without redesigning storage

- **Evidence:** `pnpm verify` suite plus Phase 14A `rehearsal.json`/`guard-advisory.json`:
  - approval runs the browser gate on one byte snapshot and binds promotion to that SHA-256
    (`staged_changed` on mismatch, tested by mutating staging after verification);
  - rejection and approval serialise under the same per-project lock (race test);
  - `capture_memory` requires a non-empty user decision (API validation + runner guard; the model
    summary is never stored);
  - preview messages are accepted only from the rendered iframe's `contentWindow`;
  - runtime requests are allowlisted to `https://cdn.jsdelivr.net` (other HTTP origins aborted,
    all WebSockets closed, both reported);
  - Host headers must name a loopback host on the API port or a configured local web origin.
- **Kind:** test-proven production changes.
- **Confidence:** high.
- **Limitations:** these are narrow hardening measures, not a security architecture review.

## Release addendum — FocusFlow and Phase 15B

This map was written for Phase 14A. The final release candidate adds the live FocusFlow
demonstration and the integrated Phase 15B research; those claims are mapped here.

### C14 — Muse Spark generated a working non-game HTML application

- **Evidence:** [`docs/demo/NON_GAME_HTML_VALIDATION.md`](../demo/NON_GAME_HTML_VALIDATION.md) §3–4;
  job `e358246a…`, artifact `v2-staged.html` (approved v1), 21/21 browser checks; rejected attempt 1
  (`1621b9db…`) preserved with its failure record.
- **Kind:** authentic model output, driven in the shipped preview; **retake** after a sandbox form
  failure, with an added sandbox instruction in attempt 2's prompt.
- **Confidence:** high for this application and run.
- **Limitations:** one application, one model, one prompt; not a general capability measurement.

### C15 — Muse Spark modified the approved application in place

- **Evidence:** `NON_GAME_HTML_VALIDATION.md` §5–6; job `aeb6b175…`, `base_version: 1`, approved v2,
  25/25 browser checks; four decisions supplied to the job.
- **Kind:** authentic model output.
- **Confidence:** high for this modification.
- **Limitations:** one modification; retrieved memory does not establish causation.

### C16 — A remembered rule can produce a live refusal

- **Evidence:** `NON_GAME_HTML_VALIDATION.md` §7; job `0ecc11a0…`, artifact byte-identical to approved
  v2, rejected as a no-op; model transcript preserved.
- **Kind:** authentic model output, one run, staged conflict.
- **Confidence:** medium: a single observation, not a general claim.
- **Limitations:** the opposite result occurred in the Phase 15B boundary probe; Decision Guard
  returned `not_verified` with 0 findings and played no part.

### C17 — Phase 15B: project memory reduced rule violations in generated game code

- **Evidence:** [`docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md`](../hackathon-evidence/phase15b/EVIDENCE_CARD.md),
  [`PROVENANCE_MANIFEST.md`](../hackathon-evidence/phase15b/PROVENANCE_MANIFEST.md),
  [`DEVIATIONS.md`](../hackathon-evidence/phase15b/DEVIATIONS.md); 32 outputs with matching hashes.
- **Kind:** authentic model output, 32 runs, one model/game/request; automated coding only.
- **Confidence:** high that the no-memory arm added countdowns/flashes/score deductions in 15/16
  runs; the memory-arm count is 5/16 (v1) or 0/16 (post-hoc v2).
- **Limitations:** the v1 coder source is lost; v2 is post-hoc with narrow definitions; the memory
  arm carried the full decision set; no per-run model or memory ids.

## Demo video addendum — Ocean Pairs and Phase 16 / 16B

The demo video's live footage is Ocean Pairs (project `safegame6`), and its closing card reports
Phase 16 / 16B. Those claims are mapped here.

### C18 — A remembered rule eliminated rule violations on two Meta models; palette-only memory did not

- **Evidence:** [`docs/hackathon-evidence/phase16/EVIDENCE_CARD.md`](../hackathon-evidence/phase16/EVIDENCE_CARD.md),
  both protocols with locked hashes, 96 run records, every usable output, `SHA256SUMS`; re-derived by
  `pnpm verify:research16`.
- **Kind:** authentic model output. Muse Spark through the production HTML Studio path (48 runs);
  Muse Spark Open on Baseten through a chat completion with the production prompt builder (48 runs).
- **Confidence:** high for the stated counts over usable outputs: 28/28 no memory, 18/18 palette
  only, 0/27 rule. These include Phase 16B correction 1
  ([`CORRECTION_1.md`](../hackathon-evidence/phase16b/CORRECTION_1.md)): 12 open-model outputs cut
  off at the token limit, first scored as clean, are unusable. The demo video shows the corrected
  figures.
- **Limitations:** one baseline game, one request, one rule; code mechanics only; the rule arm also
  carries the palette; 11/48 Muse Spark and 12/48 Muse Spark Open runs unusable (worst case still
  significant); the 16B exclusion is post-hoc; Phase 16B is a
  task replication, not a runtime replication; lock times are local file times.

### C19 — The live Ocean Pairs workflow: stored rule, refusal, approval, rollback

- **Evidence:** the screen recording in the demo video. It shows the
  decision with its source job, the retrieval explainer (1 candidate, 1 selected), a
  countdown-and-penalty request returning no change (0 lines added), a staged v2 approved after
  review, and v1 restored by rollback.
- **Kind:** authentic model output, recorded on screen.
- **Confidence:** medium: one live session.
- **Limitations:** the `safegame6` job records and database are not exported to this repository; the
  recording is the record. The refusal is one run and does not establish causation; Decision Guard
  reported the palette rule as not verified and played no part in it.

### C20 — Phase 17: a remembered rule reduced original-rule violations on two models

- **Evidence:** [`phase17/RESULTS.md`](../hackathon-evidence/phase17/RESULTS.md),
  [`PROTOCOL.md`](../hackathon-evidence/phase17/PROTOCOL.md),
  [`REVIEW_DISPOSITION.md`](../hackathon-evidence/phase17/REVIEW_DISPOSITION.md),
  [`STATS_CORRECTION.md`](../hackathon-evidence/phase17/STATS_CORRECTION.md), the 480 retained run
  records and `pnpm verify:research17` (lock, inventory, exact re-analysis).
- **Kind:** authentic model output. 2 models × 6 strata × 4 arms × 10 runs = 480. Muse Spark used
  the production Forge modify path; Muse Spark Open used the production prompt builder and
  retrieval; six runs used the pre-registered second attempt.
- **Counts (violations / usable runs):** Spark `none` 37/57, `memory` 0/58, `manual` 0/58,
  `corrected` 41/59; Open `none` 49/60, `memory` 1/60, `manual` 0/60, `corrected` 50/60. Eight
  Spark runs hit the 30-minute cap; Open had none. H1 exact p = 6.5 × 10⁻²⁰ (Spark) and
  1.1 × 10⁻²⁴ (Open). H2 upper 90% bounds +4.5 pp and +7.1 pp against the +15 pp margin.
- **Confidence:** high for these six strata, with an independent read-only audit in PR #2
  (480/480 records present; 472 succeeded with hash-matched output; 480/480 manipulation checks).
  R1–R4 were fixed; R5–R10 remain documented in locked files (five latent conditions did not
  occur; R9 is a confirmed cosmetic detector-description error). The exact p-values are a post-run reporting correction; the as-run analysis is preserved.
- **Limitations:** six fixed tasks, two rules, two requests per baseline, two models; source code,
  not runtime behaviour; `manual` and `memory` place the same sentence in different positions, so
  H2 is non-inferiority to retyping, not superiority; no general correctness, Guard effectiveness
  or transfer claim.

### C21 — After correction, the original-rule detector rate rose

- **Evidence:** `H3` in [`phase17/RESULTS.md`](../hackathon-evidence/phase17/RESULTS.md) §4, the
  manipulation checks in §8, and [`REVIEW_DISPOSITION.md`](../hackathon-evidence/phase17/REVIEW_DISPOSITION.md)
  §8. Raw counts: 41/59 vs 0/58 on Muse Spark; 50/60 vs 1/60 on Open.
- **Kind:** authentic model output, scored with the detector for the **original** rule.
- **Confidence:** high that the original-rule detector rate rises after the production correction
  route. This is consistent with the superseded restriction being released.
- **Limitations:** the detector does **not** test whether a replacement requirement is followed,
  and Phase 17's correction is **permissive** — it released restrictions rather than substituting
  a replacement requirement. Do not phrase these percentages as following a replacement
  requirement; the correct statement is that the old rule stopped constraining output. The
  sunset-to-ocean replacement in the focused cut is
  [Phase 12A](../PHASE12_MEMORY_VALIDATION.md) evidence, one run per condition, not Phase 17.
  No new-rule detector was run, and the result is source-code only.

### C22 — The focused correction demo is recorded and committed

- **Evidence:** the recorded cut `Muse_Recall_Demo_V21_1080p.mp4` (170.47 s, SHA-256
  `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308`) and its `V21_QA.md`,
  transcript and 36-cue SRT, all in [`docs/demo/video/`](../demo/video/); the beat-by-beat record in
  [`docs/demo/CORRECTABLE_MEMORY_DEMO.md`](../demo/CORRECTABLE_MEMORY_DEMO.md) §9; the Phase 12A
  authentic stills and sources
  ([`A-v2-visible.png`](../hackathon-evidence/phase12/A-v2-visible.png),
  [`C-v2-visible.png`](../hackathon-evidence/phase12/C-v2-visible.png),
  [`pilot.json`](../hackathon-evidence/phase12/pilot.json)) as evidence inserts for the
  replacement; and the deterministic seed (`scripts/lib/demo-seed.ts`).
- **Kind:** authentic live screen recording of one Muse Spark session with insert cards, not a
  fixture. The live run used `muse-spark-1.3-contributor` at high effort on 2026-10-29: save a
  sunset constraint → generate v1 → new session request (sunset source; Guard `NOT VERIFIED`) →
  reject → correct the decision to ocean → repeat the request (still sunset; Guard flags
  `superseded-palette`) → reject → ask for the current art direction from memory (ocean; Guard
  `NO VIOLATION DETECTED · SUPPORTED CHECKS`) → approve v2.
- **Confidence:** high that the recorded sequence and Guard observations happened; the screen
  recording is the record. The cut is committed under `docs/demo/video/` and linked from the
  README.
- **Limitations:** one live project, one application, one correction, one model configuration. The
  repeat feature request kept the old palette and the correction did not apply itself; only the
  explicit request for the current art direction produced the ocean version. That failure and
  recovery are kept in the cut. Guard is advisory and did not block approval. The sunset-to-ocean
  **replacement** is Phase 12A evidence (one run per condition), not Phase 17, and this cut is not
  a statistical result. The earlier 2:46 video has no explicit correction beat.

## Claims we explicitly do NOT make (unsupported)

| Tempting claim | Verdict | Why |
| --- | --- | --- |
| “Decision Guard enforces design compliance / blocks violations” | **Unsupported** | Advisory only by mandate; approval succeeds with findings present (tested). |
| “Decision Guard is comprehensive compliance verification” | **Unsupported** | Five pattern rule families, source-only; 12E documents FPs/FNs and up to 46% abstention on one rule. |
| “The runtime gate plays the game / verifies pixels / proves it cannot crash later” | **Unsupported** | The gate is load-time: page/console errors and canvas creation only. |
| “The app verifies the build before the user asks to approve” | **Unsupported** | Runtime verification runs during approval, on the staged source. |
| “There is a runtime-verification screenshot” | **Unsupported** | The UI exposes no such image; the browser preview capture is a different feature. |
| “All remembered constraints are applied to output” | **Unsupported** | Phase 12A: accent tracked in all conditions, text colour ignored; retrieval uses a budget. |
| “Guard catches every violation of remembered decisions” | **Unsupported** | 8-digit RGBA hexes and tween flashes are demonstrated gaps. |
| “Statistically significant improvement across development tasks” | **Unsupported** | Phase 17 supports a narrow, pre-registered contrast on six fixed strata and two models; Phase 16 / 16B one game, rule and request; Phase 15B one model; 12A is n = 1 per condition and 11A is n = 5. |
| “Memory in general reduces violations” | **Unsupported** | Palette-only memory left 18 of 18 usable edits in violation in Phase 16; only the rule arm reached zero. Phase 17 tests two specific rules, not memory in general. |
| “The correction percentages mean the model fully followed the updated decision” | **Unsupported** | H3 uses the detector for the **original** rule. It shows the old rule stopped constraining output; it does not test whether a replacement requirement is followed. |
| “Phase 17 proves general application correctness, Decision Guard effectiveness, or transfer to new tasks” | **Unsupported** | Six fixed strata, source-code detectors, one detector family per rule, two models. It is behavioural evidence for those tasks, not a general guarantee. |
| “Persistent project memory is unprecedented” | **Unsupported** | Retrieval stores, transcripts and long-running agents all provide memory. The contribution is the integration of correction, controlled promotion and measured evidence. |
| “The application supports arbitrary providers or production Muse Spark Open” | **Unsupported** | Provider independence is an architectural direction; only the Muse Code CLI and the deterministic `echo` provider are implemented. The open model was used for research. |
| “The 2:46 video shows the explicit correction” | **Unsupported** | It shows the stored rule, a refusal, a fitting change, approval and rollback. The correction is only in the 2:50 submission cut (C22). |
| “The 2:50 cut shows the model following a replacement requirement” | **Unsupported** | The repeat request kept the old palette; the ocean source came only from an explicit request for the current art direction. The replacement is Phase 12A evidence, one run per condition. |
| “The correction applied itself once the decision changed” | **Unsupported** | The cut keeps the failure: the next request still used sunset and Guard flagged it. The user rejected it and asked explicitly for the current art direction. |
| “A demo video exists” | *Superseded* | True: the 2:46 Ocean Pairs cut and the 2:50 submission cut (C22). Phase 14A itself produced no video. |
| Performance/memory-cost savings beyond those cited | **Unsupported** | No controlled benchmark of end-to-end savings. |

## Evidence gaps / open items for the director

1. No spontaneous model violation was flagged end-to-end: the Guard demo uses the labelled mutation.
2. Authentic Guard observations remain n = 1 artefact; a wider corpus of Forge-generated files is
   future work.
3. **The submission cut is committed, but the repository is private.** `Muse_Recall_Demo_V21_1080p.mp4`
   (2:50.47) and its QA are in `docs/demo/video/` and linked from the README. Judges can open it only
   once the repository is public or they are granted access; that remains an owner action.
4. **The 2:46 video predates the correction cut.** It is a valid fallback for the review loop and
   the Phase 16 result; it does not show the explicit correction beat, and should not be described
   as if it did (C22 covers the 2:50 cut).
5. Requirements from the official rules page remain unresolved (see
   [`requirements-review.md`](../hackathon-evidence/requirements-review.md)); anything the form
   demands beyond this package (e.g. a deployed URL) is not yet evidenced.
6. Phase 17's review disposition records six issues in locked files (R5–R10): five latent
   conditions did not occur in the 480 runs, and R9 is a cosmetic detector-description error.
   They are documented, not patched; do not describe the runner as defect-free.
7. The exact p-values are a post-run reporting correction. Quote the corrected values, and say so;
   do not present the original as-run values as the final analysis.
