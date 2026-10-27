# Phase 14A — demo production and release-blocker remediation

**Status:** complete — submitted for director review (no merge, no submission, no guard enforcement)
**Branch:** `agent/phase14a-demo-production`
**Work commit:** `4a455f8264602a96fd228542c81773761052fbea` (implementation, submission docs, evidence).
The concurrent-approval regression and the final 484-test count landed in the branch-tip commit.
**Base:** `agent/phase12e-release-hardening` @ `156c65c9a55833e00f6764f4fee20d93eec17e49`
**Submission docs:** cherry-picked `84e6a8ce028b9d5e3e8bd5c04abbf7f3824ccc1a` (docs only, never merged)
**Live Muse inference in this phase:** none (0 calls)

## 1. Baseline and ancestry

Both required baselines were verified before any edit:

| Baseline | Required | Observed | Result |
| --- | --- | --- | --- |
| Release candidate | `156c65c9a55833e00f6764f4fee20d93eec17e49` | same | exact |
| Submission docs | `84e6a8c` | `84e6a8ce028b9d5e3e8bd5c04abbf7f3824ccc1a` | exact |

```
921b4f7  docs(submission): Phase 13 hackathon submission package   (cherry-pick of 84e6a8c)
156c65c  docs(phase12e): release-candidate hardening report         (release candidate)
   ↑
agent/phase14a-demo-production
```

The Phase 13 branch is **not** a descendant of the release candidate and was **not merged**. Only
commit `84e6a8c` was cherry-picked. The resulting commit adds exactly five files and deletes
nothing:

```
docs/submission/DEMO_RUNBOOK.md      | 152 +++
docs/submission/DEMO_SCRIPT_3MIN.md  | 135 +++
docs/submission/EVIDENCE_MAP.md      | 188 +++
docs/submission/PROJECT_STORY.md     | 136 +++
docs/submission/SUBMISSION_COPY.md   | 133 +++
5 files changed, 744 insertions(+)
```

That diff was checked for production deletions before any further work; none were present. All
later Phase 14A changes sit on top of the release candidate, so no Phase 12E product code, evidence
or test was lost.

## 2. Opus findings disposition

### P0 — rollback ancestry

| Item | Disposition |
| --- | --- |
| Undo after a non-linear history restored the array neighbour instead of the recorded parent | **Fixed.** `rollbackTarget()` follows the current version's `base_version` when it names a strictly older, existing version. Legacy records without a usable pointer keep a bounded fallback (immediately preceding, strictly older entry). `can_rollback` is derived from the same resolver. |
| Regression coverage | Added: linear history; undo after approval; undo → new approval → undo; missing/invalid parent; self-parent at a root; repeated undo; `can_rollback` from ancestry; CAS retained; concurrent approval retained. |
| API | No external API change; the same `/approve` and `/rollback` endpoints return the same shapes. |

Director reproduction, now passing through the real HTTP surface and recorded in
`docs/hackathon-evidence/phase14a/rollback-ancestry.json`:

```
approve v1 → approve v2 → undo (v1) → approve v3 from v1 → undo v3
result: current_version = 1   (before the fix: 2)
repeat undo: nothing_to_rollback
```

### P0 — submission documentation integration

| Item | Disposition |
| --- | --- |
| Docs pointed at `agent/phase12c-guard-advisory` | **Fixed.** All five documents reference the Phase 14A branch and the release-candidate SHA. |
| Stale Phase 12C demo references and test counts | **Fixed.** Counts are now Phase 14A: `pnpm verify` → 484 passed / 3 skipped. |
| Runtime verification overstated | **Fixed.** Every description now uses the approved wording (see §4). |
| Decision Guard described as enforcement / complete compliance | **Fixed.** Advisory-only and source-pattern limits are stated in the story, script, copy and evidence map. |
| Stale Phase 12E verification figures | Refreshed from `docs/hackathon-evidence/phase14a/verification.json`. |
| Hex notation claim | Updated: Phase 12E normalises CSS `#FF7E5F` and Phaser `0xFF7E5F` to the same RGB token; 8-digit RGBA remains a gap. |
| Authentic vs synthetic labels | Preserved and strengthened: the mutation is labelled, the A/C figure is labelled authentic, rehearsal screenshots are labelled deterministic. |

### P0 — runtime-verification claims

Corrected everywhere. The verifier:

- runs **during approval**, on the staged source;
- loads the HTML in headless Chrome, waits ~1.2 s, requires a canvas;
- rejects page errors, console errors, and (new) requests outside the allowlist.

It does **not** play the game, verify pixels, test every mechanic, produce a verification
screenshot, or guarantee later interactions cannot crash. No screenshot of a verification result
was fabricated; the browser preview capture is described as a separate feature.

Approved wording, used verbatim in the submission documents:

> “Before promoting a change, Muse Forge launches it in headless Chrome and rejects builds that
> throw on load or fail to create a canvas.”

### P1 — bounded security and integrity hardening

All six items were implemented; none was deferred. Details and tests in §5.

### P2 — bounded risks

The audit's bounded P2 risks were reviewed. Items closed in Phase 14A: stale documentation claims,
unclear authentic/synthetic labelling, missing demo reproducibility, and missing rollback ancestry
evidence. Items deliberately **deferred** (documented in §10): guard engine gaps (8-digit RGBA,
tween flashes), no authentication/multi-user story, in-memory job registry across restarts, the
runtime check's fixed 1.2 s observation window, and the jsDelivr dependency of the Phaser preview.
None of these was force-fixed inside a frozen feature set.

## 3. Files changed

### Production code

| File | Change |
| --- | --- |
| `apps/server/src/forge/workspace.ts` | `rollbackTarget()` ancestry resolver; one-shot `stagedSnapshot()` (html + sha256); `promote()` refuses `expectedSha256` mismatches (`staged_changed`); byte-based reads for hashing. |
| `apps/server/src/forge/runner.ts` | Runtime check consumes the same snapshot that promotion is bound to; `capture_memory` requires a trimmed user decision (`decision_required`); rejection now runs under the per-project lock. |
| `apps/server/src/forge/runtime-check.ts` | HTTPS request allowlist (`cdn.jsdelivr.net` only), WebSocket closure, blocked-request reporting; no credential/query echo. |
| `apps/server/src/host-guard.ts` | **New.** Loopback Host-header parsing/validation (API port or configured local web origin; ephemeral-port hostname-only mode). |
| `apps/server/src/app.ts` | `onRequest` Host guard; `invalid_host` 400 envelope. |
| `apps/server/src/routes/forge.ts` | Maps `decision_required` to 400; default 409 for `staged_changed`. |
| `apps/web/src/components/forge/ForgeView.tsx` | Preview messages accepted only from the rendered iframe's `contentWindow`; Approve disabled until a required decision is typed. |
| `packages/shared/src/forge.ts` | `ForgeApproveSchema` requires a non-empty decision when `capture_memory` is true. |
| `packages/shared/src/api.ts` | `invalid_host` error code. |

### Demo, scripts, tests, config

| File | Change |
| --- | --- |
| `scripts/lib/demo-seed.ts` | **New.** Production-engine memory seed + deterministic workspace seed; idempotent. |
| `scripts/seed-forge-demo.ts` | Rewritten to call the seed, resolve paths like the server, and print ids/statuses. |
| `scripts/phase14a-rehearsal.ts` | **New.** Full deterministic rehearsal + evidence writer. |
| `scripts/phase14a-demo-ui-evidence.ts` | **New.** Real API + Vite + Chrome screenshot capture. |
| `scripts/verify-runtime.ts` | Adds HTTPS-exfiltration and WebSocket-blocking cases. |
| `tests/unit/forge-workspace.test.ts` | +9 ancestry/integrity tests. |
| `tests/integration/forge-api.test.ts` | +5 tests: ancestry reproduction, decision validation, staged-change rejection, concurrent approvals, reject/approve race. |
| `tests/integration/api.test.ts` | +4 Host-header tests. |
| `tests/unit/host-guard.test.ts` | **New.** 7 parser/validator tests. |
| `tests/unit/demo-seed.test.ts` | **New.** 2 seed/idempotence tests. |
| `biome.json` | Generated Phase 14A evidence excluded from formatting (mirrors the existing Phase 12C exception). |
| `package.json` | `evidence:phase14a`, `evidence:phase14a-ui`. |
| `docs/submission/*` | Five documents corrected and refreshed. |
| `docs/hackathon-evidence/phase14a/*` | **New.** Report, verification, rehearsal, seed, ancestry, guard, influence and screenshots. |

Binary assets overwritten by verification scripts were restored to their committed Phase 9 versions
after the runs; the only new binaries are the Phase 14A screenshots.

## 4. Runtime verification — accurate statement

The gate is a **load-time** check run when approval is requested. It launches Chrome with the
staged HTML, waits for load plus ~1.2 s, and fails on:

- page errors (`pageerror`),
- console errors (favicon/404 noise excepted),
- a missing canvas,
- a request outside `https://cdn.jsdelivr.net` (HTTP or WebSocket).

It does not exercise gameplay, pixels, mechanics, or later interaction, and it records no image.
Evidence: `apps/server/src/forge/runtime-check.ts`, `pnpm verify:runtime` (four cases:
valid passes; broken rejected; HTTPS exfiltration blocked; WebSocket blocked).

## 5. Security and integrity fixes (A–F)

| Item | Implementation | Tests |
| --- | --- | --- |
| **A. Host-header validation** | `isAllowedHostHeader()` accepts loopback names on the configured API port or on a configured local web origin (the Vite proxy forwards the browser Host); rejects everything else with `400 invalid_host`. Ephemeral port `0` validates hostname only. | `tests/unit/host-guard.test.ts` (7), `tests/integration/api.test.ts` (4), built-server probe (`evil.example` → 400). |
| **B. Reject under lock** | `reject()` now acquires the same per-project lock as `approve()`, re-reads job state inside it, then deletes staging. | Integration test holds approval inside the runtime check and issues a rejection concurrently: approval becomes v2, rejection returns 409 `invalid_job_state`; preview still readable. |
| **C. Explicit memory capture** | Schema requires `decision` (trimmed, non-empty) when `capture_memory` is true; runner refuses otherwise and stores exactly the user text, never `summary`. UI disables Approve and labels the field “Your decision (required)”. | API tests: missing decision → 400, whitespace → 400 (no version, no memory), valid decision stored verbatim with `verified` status. |
| **D. Checked-source integrity** | `stagedSnapshot()` reads bytes once; the runtime check receives that HTML and promotion receives its sha256. `promote()` re-reads and refuses on mismatch (`409 staged_changed`), then the existing post-copy hash check binds the immutable version. | Unit + integration: mutate staging between verification and promotion → 409, no version created, job unapplied. Positive control: exact bytes promote. |
| **E. Preview message origin** | The host listener ignores any message whose `event.source` is not the rendered iframe's `contentWindow`. The sandboxed iframe has an opaque origin, so identity (not `origin`) is the reliable check. | `pnpm verify:forge` capture check (renderer snapshot, non-blank) still passes 9/9. |
| **F. Runtime network exposure** | `page.route` allowlists `https://cdn.jsdelivr.net` and local schemes; `page.routeWebSocket` closes all sockets. Blocked requests are reported by origin (no query echo) and fail the check. | `pnpm verify:runtime`: valid scene has zero blocked requests; `https://exfiltration.example` and `wss://exfiltration.example` are blocked and reported. |

No storage redesign; no new product feature; guard enforcement unchanged.

## 6. Reproducible demo seed

`pnpm demo:seed` now seeds both halves from one command, using the production memory engine
(`create` + transactional `correct`) and the existing workspace format:

| Decision | Type | State | Provenance |
| --- | --- | --- | --- |
| “This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.” | `constraint`, project-scoped | `active`, verified | `seed:phase14a-demo` |
| Sunset palette (`#FF7E5F`, `#2D1E2F`) | `constraint` | `superseded` | history reason: “Creative direction changed from a warm sunset mood to a cool ocean mood.” |
| Ocean palette (`#4EA8DE`, `#102A43`) | `constraint` | `active`, verified | supersedes sunset |

Verification (`docs/hackathon-evidence/phase14a/demo-seed.json`, `tests/unit/demo-seed.test.ts`):

- correct project scope (`forge-demo`) and statuses (2 active, 1 superseded);
- retrieval returns ocean + child-safety and **excludes** sunset;
- repeated seeding adds nothing: 3 rows, same ids, byte-identical `state.json`;
- no credentials and no manual database editing;
- workspace v1 sha256 pinned to the recorded baseline.

The decision texts are the Phase 12A trial texts verbatim, so the demo uses the same remembered
palette pair whose effect was measured.

## 7. Memory-influence presentation (authentic A/C)

Files: `memory-influence.html` (source), `memory-influence.png` (side-by-side figure),
`memory-influence.md` / `.json` (claims + limits), screenshots `render-v1-baseline.png` and
`render-v2-authentic-c.png`.

| Condition | Remembered decision | Accent in output | Rendered coverage |
| --- | --- | --- | --- |
| A | sunset active (`de20b28e…`) | `0xFF7E5F` | 1.082% |
| B | none | neither palette | 0.005% |
| C | ocean active, sunset superseded (`aceff9cf…` ← `8de86811…`) | `0x4EA8DE` | 0.879% |

The figure labels the evidence as authentic Phase 12A model output, states “one trial per
condition”, and records the partial result (dark text colour not applied). Prompt reconstruction
matches every job hash in `pilot.json`. The recorded memory rows were re-read from
`apps/server/data/phase12.db` to confirm content and supersession.

## 8. Decision Guard demonstration (advisory only)

- Source: `docs/hackathon-evidence/phase12e/sources/A-violation-mutation.html` — a deterministic
  mutation of the authentic baseline, with its `PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE
  OUTPUT` banner intact.
- Result: `VIOLATION DETECTED`, two high-severity findings (`countdown-mechanics`,
  `mistake-penalty`) citing the seeded child-safety decision, plus one unverified palette note.
- The mutation was **rejected**, not approved. The demonstration then returns to the authentic
  Phase 12A C modification, which is clean (`NO VIOLATION DETECTED · SUPPORTED CHECKS`), and
  approves it.
- The panel states “Findings do not block approval in this version” and “Supported checks only …
  not a compliance certification”; it never shows a green PASS badge.
- Segment length in the script: 15 seconds. The central story remains memory and controlled
  iteration, not regex detection.

Evidence: `05-guard-advisory-mutation.png`, `06-review-mutation.png`, `07-rejected-mutation.png`,
`08-guard-compliant.png`, `guard-advisory.json`.

## 9. Demo preparation and rehearsal

### Sequence

The demo follows §6 of `DEMO_RUNBOOK.md`: playable v1 immediately → problem → memory and correction
history → authentic A/C influence → authentic modification (recorded) → staged diff → accurate
runtime gate → advisory guard on the labelled mutation → approve the authentic change → roll back to
v1.

### UI constraint discovered during rehearsal

The Forge view holds one job review at a time and offers no historical review picker. The demo
therefore pre-stages the authentic review in **window A** and uses **window B** for the opening and
memory segments, switching to A at the modification segment. The guard segment uses the packaged
labelled-mutation panel, which is a real production-pipeline capture. Adding a historical review browser would be a product feature, which Phase 14A is not
permitted to add; the runbook documents the operator path and the label to state on screen.

### What was produced

- 12 screenshots (UI states plus the authentic A/C figure) and 2 rendered game previews in
  `docs/hackathon-evidence/phase14a/screenshots/`.
- A recording-ready operator runbook and a timed 3:00 script.
- A complete deterministic rehearsal record (`rehearsal.json`).
- **No video file was created.** No footage is claimed to exist. The runbook is the recording plan;
  recording is a demo-day action.

### Rehearsal results (complete run, `pnpm evidence:phase14a` + `pnpm evidence:phase14a-ui`)

| Check | Result |
| --- | --- |
| Seed, twice | 3 memories, same ids, byte-identical state — pass |
| Retrieval | ocean + child-safety present; sunset excluded — pass |
| Rollback ancestry | v3 undo → v1; repeated undo → `nothing_to_rollback` — pass |
| Labelled mutation | job succeeded; 2 findings citing the child decision; rejected; v1 unchanged — pass |
| Authentic C | 0 findings; runtime verified; approved as v2; rolled back to v1 — pass |
| UI | mutation panel and rejection, compliant review, approval, undo all captured; no page errors — pass |
| Live Muse calls | 0 |

## 10. Verification summary

| Command | Result |
| --- | --- |
| `pnpm verify` | exit 0 — lint + typecheck + **484 passed, 3 skipped** (live-Muse gate) |
| `pnpm verify:forge` | exit 0 — **9/9** browser checks |
| `pnpm verify:runtime` | exit 0 — valid passes; broken rejected; HTTPS and WebSocket exfiltration blocked |
| `pnpm eval:guard` | exit 0 — A BLOCK, B PASS, C UNVERIFIED, supplementary BLOCK; all approvals succeeded |
| `pnpm build` | exit 0 — web 444.72 kB JS / 34.61 kB CSS; server 302.5 kB |
| Built-server health | `/api/health` 200 (`status: ok`, read/write verified, schema 6); `/api/live` 200; bad Host 400 |
| `pnpm evidence:phase14a` | exit 0 |
| `pnpm evidence:phase14a-ui` | exit 0 |

`eval:guard` and `verify:forge` write into prior evidence/asset paths; those files were restored
byte-for-byte afterwards. No original evidence was modified.

## 11. Remaining risks

| Risk | Severity | Mitigation / status |
| --- | --- | --- |
| No live Muse inference was run in Phase 14A; the demo depends on a pre-recorded authentic run or director-authorised live inference | Medium | Recording checklist; runbook fallbacks; provenance labels. |
| No demo video exists yet | Medium | Operator-ready runbook + screenshots; record on demo day. |
| Guard false positives/negatives and high abstention on colour-only cues (up to 46%) | Medium | Advisory-only; published accuracy; human approval. 8-digit RGBA and tween flashes remain gaps. |
| Runtime gate observes only ~1.2 s after load; delayed failures may escape | Low–Medium | Documented as load-time only; diff review and human approval remain. |
| Preview and runtime check depend on jsDelivr for Phaser | Low | Documented; network allowlist keeps it to the approved CDN. If offline, demo uses the recorded fallback. |
| In-memory job registry is lost on server restart | Low | Workspace/state persist; jobs are a review surface, not approved state. Restart between demo phases only, as scripted. |
| No authentication; loopback-only. Host validation raises DNS-rebinding cost but is not auth | Low (scope) | Documented; not exposed beyond loopback. Binding `HOST` to a non-loopback address is not a supported configuration: the Host guard accepts loopback names on the configured port or a configured local web origin. |
| Redaction is pattern-based | Low | Existing tests; no keys stored in repo. |
| Guard engine fixes were frozen | Low | Roadmap; enforcement intentionally not enabled. |

No remaining release blocker was identified. The P1 hardening items are implemented and tested;
the deferred items are scope/roadmap, not regressions introduced here.

## 12. Release decision

**GO — for director review only.**

Conditions carried into the demo:

1. Decision Guard remains advisory; enforcement stays off (verified: approvals succeeded with
   findings present).
2. The runtime gate is described exactly as implemented — load-time only.
3. The modification segment uses recorded authentic inference unless the director authorises paid
   live Muse calls.
4. The guard segment uses the labelled mutation and does not approve it.
5. No demo footage is claimed unless a file is actually created.

Explicitly **not** done: no merge into `main`, no submission, no guard enforcement, no new product
feature. The worktree is left clean after the Phase 14A commit.
