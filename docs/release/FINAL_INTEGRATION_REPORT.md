# Final integration report — Muse Recall release candidate

**Prepared:** 2026-10-28 (Australia/Brisbane)
**Authority:** director-approved final integration brief, based on
`OPUS_FINAL_RELEASE_AUDIT.md` (2026-10-28).
**Status:** all five release gates pass. Ready for director approval.
**Not performed:** merge to `main`, video render/replacement, hackathon submission.

---

## 1. Release candidate

| | |
|---|---|
| Branch | `agent/muse-recall-release-candidate` |
| Base | `agent/muse-recall-final-p1-fixes` @ `62ff522ec7b802d87a4981b8fe8fa410fdea7324` |
| Working copy | `~/projects/muse-recall-rc` (dedicated worktree) |
| Integration head before this report | `2d79eec2a066ac7d3f4e976a3f973fa0dae6e5b2` (see commit table) |
| Remote | `origin` = `https://github.com/sidonsoft/muse-recall.git` |
| Report commit | this commit; the branch tip after the report is pushed |

### 1.1 Commit and merge history

| Commit | Parents | What it is |
|---|---|---|
| `43c1a8f` | `62ff522`, `9f5eaa1` | `--no-ff` merge of the original Phase 15B branch, unchanged |
| `304e819` | `43c1a8f`, `4f53361` | `--no-ff` merge of the Phase 15A pilot branch (pilot evidence only) |
| `0b80f40` | `304e819` | Recovered tooling, provenance, deviations, evidence card, research checker |
| `81baccc` | `0b80f40` | Cross-origin state-mutation fix, tests and browser reproduction |
| `5fb7191` | `81baccc` | `verify:research` and `verify:security` commands |
| `2d79eec` | `5fb7191` | README, submission copy and canonical storyboard consolidation |
| report commit | `2d79eec` | This document |

No rebase, squash, amend, force-push or history rewrite was performed on the Phase 15B chain.
The original chain remains `d84d8a1 → 2857159 → 9f5eaa1`.

### 1.2 Research branch publication

| Ref | Local | Remote | Status |
|---|---|---|---|
| `agent/phase15b` | `9f5eaa19698f6b969b53671cc7fca5fb0fafd415` | same SHA | **Published unchanged** |
| `agent/phase15a-pilot` | `4f5336135069c9dd4ea64cc0d62a359c36d20ab7` | same SHA | **Published unchanged** (pilot only) |

`agent/phase15b-evidence-integration` does not exist and was not created; the brief's target branch
name (`agent/muse-recall-release-candidate`) was used instead.

---

## 2. Gate-by-gate verdict

| Gate | Verdict | Supporting evidence | Remaining limitations |
|---|---|---|---|
| **G1** Research publication | **PASS** | Branch pushed unchanged; 32 raw outputs, 16/16 allocation, 0 unusable; recovered 72-file tooling bundle with SHA-256 manifests; v1 coder loss, empty diffs, missing human table and protocol deviations A–I disclosed | The v1 coder source does not exist and cannot be recovered; per-run model/memory ids and diffs were never captured |
| **G2** Research claims | **PASS** | Public wording uses the approved bounded statement; v1 and v2 distinguished; post-hoc correction, narrow definitions, one-model/game/rule/request scope stated; both p-values independently reproduced and labelled | The corrected 0/16 is post-hoc and unblinded; a broader "penalty" definition would raise the memory-arm count |
| **G3** Submission consistency | **PASS** | README, submission copy, evidence map, checklist and canonical V2 storyboard agree; old storyboards marked superseded; retake, replay and labelled-mutation disclosures present; evidence paths resolve on this branch | Video not rendered; production decisions remain with the director |
| **G4** Verification | **PASS** | `pnpm verify` 549 passed / 3 skipped; build, runtime, form sandbox 7/7, workflow 37/37, Studio 14/14, browser 27 lines (19 assertions, 2 skipped), UX evidence at 3 viewports, research and security checks all pass; hashes match | Browser smoke does not prove accessibility or cross-browser parity; no paid live inference was run |
| **G5** Cross-origin security | **PASS** | Foreign, `null`, malformed and deceptive origins receive `403 forbidden_origin`; state unchanged after all four mutating routes; legitimate same-origin approve/reject/rollback/cancel work; real-Chrome hostile-page reproduction blocked | Guard is not authentication; public-origin Chrome Local Network Access path untested |

---

## 3. G1 — Phase 15B recovery and publication

### 3.1 What was published

- Original branch `agent/phase15b` at `9f5eaa1`, pushed without modification and merged with
  `--no-ff`.
- The protocol (`d84d8a1`, 2026-10-27 20:07:59 +10:00), the 32-run results (`2857159`,
  21:53:44) and the correction (`9f5eaa1`, 21:55:22) retain their original commits and timestamps.
- Phase 15A published as `agent/phase15a-pilot` and merged as **pilot evidence only**; it is not
  pooled with Phase 15B.

### 3.2 Recovered tooling

Recovered on 2026-10-28 from `~/projects/muse-memory-lab/video/`, which was untracked and
excluded by a **local-only** `.git/info/exclude` entry (not by the repository's `.gitignore`).

| Group | Files | Key hashes |
|---|---:|---|
| `tools/` | 4 | `pilot-15b.mjs` `08a65de4…`; `analyze-15b.py` `c68cc34c…`; `gen-baseline.mjs` `5f75a43d…`; `model-check.mjs` `bd8100a8…` |
| `baseline/` | 17 | chosen `sky-pairs-high-cand2.html` `5385c558…`; candidate manifests `809cadad…` and `f8220575…` |
| `pilot-runs/` | 11 | three pilot run records and eight pilot outputs (excluded from the 32) |
| `recorded-diffs/` | 40 | all **0 bytes**, preserved as recorded |

All 72 recovered files are byte-for-byte copies with source mtimes recorded in
[`recovered/recovery-manifest.json`](../hackathon-evidence/phase15b/recovered/recovery-manifest.json)
and [`recovered/SHA256SUMS`](../hackathon-evidence/phase15b/recovered/SHA256SUMS). No script was
edited to make the historical results appear reproducible.

### 3.3 Missing evidence (disclosed, not manufactured)

- **Original v1 scoring implementation:** never committed; the only working copy was overwritten by
  v2 at 21:55:01. Only the v1 per-run output survives. It is byte-identical to the `rubric.json`
  committed in `2857159` (git blob `6af013e7…`). It cannot be re-executed.
- **Per-run model identifiers:** not captured; attribution is configuration only.
- **Per-run retrieved memory ids:** not captured.
- **Original diffs:** empty because the runner read `diff.data.diff` instead of
  `diff.data.files[0].diff`.
- **Per-run human coding table:** not preserved; only a narrative account of two coder defects.
- **Fallback activation logs:** not retained.

### 3.4 Provenance and deviations deliverables

- [`PROVENANCE_MANIFEST.md`](../hackathon-evidence/phase15b/PROVENANCE_MANIFEST.md) and machine-readable
  [`provenance-manifest.json`](../hackathon-evidence/phase15b/provenance-manifest.json).
- [`DEVIATIONS.md`](../hackathon-evidence/phase15b/DEVIATIONS.md): deviations A–I, each with planned
  procedure, actual procedure, available evidence, potential effect and verifiability.
- [`EVIDENCE_CARD.md`](../hackathon-evidence/phase15b/EVIDENCE_CARD.md).
- [`HUMAN_CODING.md`](../hackathon-evidence/phase15b/HUMAN_CODING.md).
- [`recovered/README.md`](../hackathon-evidence/phase15b/recovered/README.md) and
  [`recovered/RUN_CONFIGURATION.md`](../hackathon-evidence/phase15b/recovered/RUN_CONFIGURATION.md).

### 3.5 Deviation highlights

| ID | Deviation |
|---|---|
| A | Actual order hash is `sha256("22749222:<i>:<true|false>")`, not the protocol's `sha256(seed || index)`; order reproduces from the code |
| B | Same-key, same-model fallback configured despite "no failover"; activation unknown |
| C | Model id configured, not observed per run |
| D | Memory arm held the full demo decision set (child-safety rule plus two palette decisions); contrast is memory present vs absent |
| E | Retrieved memory ids not recorded per run |
| F | All recorded diffs empty (runner bug) |
| G | Original v1 coder source lost; v2 is post-hoc |
| H | Protocol text says "two rules", "8/8 vs 0/8", "draft — NOT YET RUN", and describes a broader penalty/timer definition than v2; RESULTS uses imprecise "pre-registered coding" shorthand |
| I | `rubric.json` carries 32 trial + 8 pilot rows; the analysis population is the 32 in `trial-results.json` |

---

## 4. G2 — Research claims

### 4.1 Verified results

| Coding | Without memory | With memory | Two-tailed Fisher p | Status |
|---|---:|---:|---:|---|
| Original automated coding (v1) | 15/16 | 5/16 | `6.351663 × 10⁻⁴` | Pre-registered test, original instrument |
| Corrected post-hoc coding (v2) | 15/16 | 0/16 | `5.656481 × 10⁻⁸` | Post-hoc, unblinded, **not confirmatory** |

Both p-values were recomputed with a separate implementation during integration. The v1 output was
confirmed byte-identical to the historical blob. All five v1 memory-arm flags are the substring
`penalt` in text promising no penalties or timer comments.

### 4.2 Public wording

The README, submission copy and evidence card use the approved bounded wording:

> In a preregistered 32-run trial using one Muse Spark model, one game and one modification
> request, 15 of 16 edits without project memory added a countdown, full-screen flash or score
> deduction. With project memory, the original automated coding flagged 5 of 16. A post-hoc review
> identified those five flags as references to "no penalties"; corrected coding found 0 of 16 under
> its narrower operational definitions. The original scoring script was not preserved, but its
> per-run output is available.

Removed from public copy: "preregistered coder", "preregistered scoring script", "memory
eliminated violations", "memory guarantees compliance", "memory caused the result", "general
improvement across development tasks". Every p-value is labelled with the analysis that produced it.

### 4.3 Measurement limitation

The v2 coder counts countdowns, full-screen flashes and score deductions. Some memory-arm
applications reset streaks or combos on a mismatch. Under a broader reading of "penalty", the
memory-arm count would rise. The public claim is therefore limited to the v2 operational
definitions, and the README says so.

---

## 5. G3 — Submission documentation

### 5.1 Canonical storyboard

`docs/submission/V2_DEMO_RECORDING_PLAN.md` is canonical.
The following are marked superseded without deleting them:

- `docs/submission/REVISED_DEMO_STORYBOARD.md`
- `docs/submission/DEMO_SCRIPT_3MIN.md`
- `docs/VIDEO_STORYBOARD.md`
- `docs/submission/RECUT_BRIEF_PHASE15A.md` (also explicitly *not adopted*)

### 5.2 Required disclosures

| Disclosure | Where | Exact / equivalent text |
|---|---|---|
| Phase 12A replay | V2 plan §5 and superseded script | `Replay of recorded Phase 12A Muse output.` |
| Packaged Guard mutation | V2 plan §5 | `Labelled mutation — packaged evidence, not model output.` |
| FocusFlow retake | V2 plan §6, README, submission copy | `Retake with an added sandbox instruction — attempt 1 was rejected after a sandbox form failure; attempt 2 selected.` |
| Phase 15B | V2 plan §8, README, evidence card | Bounded wording above; all paths point at the integrated branch |

Runtime remains 172 s (2:52), under the three-minute limit.

### 5.3 Consistency

README, submission copy (100/300 words, re-counted), evidence map, checklist, evidence index and
storyboard now tell the same story. No public document cites the unpublished `agent/phase15b`
branch as a source. The old "518 passed" and "27 checks" figures were replaced with the measured
results below.

---

## 6. G5 — Cross-origin state mutation

### 6.1 Fix

[`apps/server/src/origin-guard.ts`](../../apps/server/src/origin-guard.ts) is installed as an
`onRequest` hook before routing. On state-changing methods it:

- allows the request's own origin (from the validated `Host`) and configured `CORS_ORIGINS`;
- refuses `Origin: null`, malformed/ambiguous values, deceptive hosts or ports and scheme mismatch
  with `403 forbidden_origin`;
- treats a missing `Origin` as a non-browser client, not as proof of same-origin, and refuses
  `Sec-Fetch-Site: cross-site`/`same-site`;
- leaves safe methods and loopback development untouched.

Full design and CSRF evaluation:
[`CROSS_ORIGIN_SECURITY_FIX.md`](CROSS_ORIGIN_SECURITY_FIX.md).

### 6.2 Regression evidence

- 17 unit tests for parsing and policy.
- 14 integration tests covering all twelve required cases, including state-unchanged checks for
  approve, reject, cancel and rollback, plus missing-Origin behaviour.
- `pnpm verify:security` real-Chrome reproduction:
  - hostile loopback page `no-cors` rollback → **403**, approved version stays **v2**;
  - legitimate same-origin browser rollback → **200**, version becomes **v1**.

### 6.3 Residual risk

The guard is a browser-confusion control, not authentication. A public-origin Local Network Access
path was not tested. Preview self-navigation to another origin remains possible (no CSP navigation
directive) but no longer enables state mutation. Multi-user deployment still requires authentication
and CSRF tokens.

---

## 7. G4 — Verification results

All commands were run with Muse credentials unset and `MODEL_PROVIDER=echo`. Browser suites ran
against an isolated API on `127.0.0.1:8877` and an isolated Vite client on `127.0.0.1:5273`; the
live demonstration servers on 5173/8787/8799/5199 were not touched.

| Command | Result |
|---|---|
| `pnpm verify` | **549 passed, 3 skipped**, 33 files; lint and typecheck green |
| `pnpm build` | **Pass** — web 478.91 kB JS, server 310.5 kB |
| `pnpm verify:runtime` | **Pass** — valid, broken, HTTP-exfil and WS-exfil scenes |
| `pnpm verify:formsandbox` | **7/7** |
| `pnpm verify:forge-workflow` | **37/37** |
| `pnpm verify:forge` | **14/14**, no console/page errors |
| `pnpm verify:browser` | **27 lines: 19 assertions, 2 skipped, 6 screenshots** |
| `pnpm evidence:ux` | **Pass** at 1920×1080, 1440×900, 1280×720 |
| `pnpm verify:security` | **Pass** (2 browser assertions) |
| `pnpm verify:research` | **Pass** |

Note: `evidence:ux` regenerates tracked captures under `docs/ux-evidence/final/`. Those files were
restored after the run so historical captures are not overwritten; the command itself passed.

### 7.1 Research verification detail

- 32 records, 16 memory / 16 no-memory, all `succeeded`, 0 unusable.
- 32/32 output SHA-256 values match `trial-results.json`.
- Execution order reproduces from the actual seed formula.
- v2 `rubric.py` re-run on the preserved 40 files reproduces `rubric.json` **byte-identically**;
  `analyze-15b.py` reproduces `analysis.json` **byte-identically**.
- v1 and v2 counts and both Fisher p-values reproduce.
- 72/72 recovered hashes match; 40 recorded diffs are empty.
- Protocol/result chronology: protocol 20:07:59, first output 20:10:30, last output 21:52:40,
  results commit 21:53:44, correction 21:55:22.
- No file under `docs/hackathon-evidence/phase15b/` from the original merge was modified. The only
  existing evidence file changed anywhere is the top-level `docs/hackathon-evidence/README.md`
  index, updated with navigation to the new research (documentation, not evidence content).

### 7.2 Live FocusFlow evidence

- Failed attempt 1 (`1621b9db…`), successful retake (`e358246a…`, 21/21), v1 approval, modification
  (`aeb6b175…`, 25/25), v2 approval, and the live refusal (`0ecc11a0…`) are all preserved.
- The v2 artifact (`docs/demo/evidence/artifacts/v3-staged.html`) was exercised during release
  acceptance: add by click, add by Enter, high-priority summary, Active/Completed filters and
  completion all passed (4 tasks including the preserved seeded items).
- No artifact was represented as untouched model output when it was not: the retake prompt differs
  and is disclosed.

---

## 8. Submission alignment

| Document | State |
|---|---|
| `README.md` | Updated status, FocusFlow section, Phase 15B section, new verification commands, limitations |
| `docs/submission/SUBMISSION_COPY.md` | Rewritten; 100/300-word limits exactly 100/300 |
| `docs/submission/V2_DEMO_RECORDING_PLAN.md` | Canonical; 172 s; required overlays; retake disclosure |
| `docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md` | New; bounded research wording |
| `docs/demo/NON_GAME_HTML_VALIDATION.md` | Evidence unchanged; section 7 retitled with a naming note (Guard returned `not_verified`, 0 findings) |
| `docs/submission/EVIDENCE_MAP.md` | C14–C17 added; statistical claim scoped |
| `docs/SUBMISSION_CHECKLIST.md` | Updated to the release candidate and canonical storyboard |

No contradictory public claim was found by a phrase scan for the prohibited wording. All internal
links resolve on this branch.

---

## 9. Remaining risks and deferred items

1. **No video rendered or submitted** — intentional stop point. The protected MP4 is untouched.
2. **No authentication** — the origin guard blocks cross-site mutation but does not authenticate;
   loopback single-user only. Disclosed.
3. **Public-origin Local Network Access path untested** — the server-side check is independent, but
   that browser path was not exercised.
4. **Preview self-navigation remains possible** — data-exposure surface only; state mutation is
   blocked.
5. **Form-contract advisory (audit F-05) not implemented** — optional/deferred. A model that ignores
   `type="button"` can still pass load-time validation; demo operators must click through staged
   forms. Disclosed in the known limitations.
6. **Out-of-box model defaults remain `muse-wonder-1.0` (F-08)** — deferred; the demo configured
   `muse-spark-1.3` explicitly and the README warns the operator to check the top bar.
7. **Phase 15B evidence limits** — v1 source lost, no per-run model/memory ids, empty diffs, no
   human-coding table, narrow post-hoc coder. All disclosed.
8. **`evidence:ux` regenerates tracked files** — run it on a scratch copy for release evidence;
   historical captures were restored after this verification.
9. **Phase 15A is a pilot** — published separately, not pooled, not confirmatory.

---

## 10. Director decision

All five gates pass on `agent/muse-recall-release-candidate`. The application, research package and
submission narrative are consistent, and the confirmed cross-origin vulnerability is closed with
regression and browser evidence.

**Recommendation: READY FOR FINAL APPROVAL.**

Outstanding director actions, by design: approve the integrated candidate, authorise the V2
recording from the canonical storyboard, and decide whether to merge to `main` and submit. This
report does not merge, render the final video or submit the entry.
