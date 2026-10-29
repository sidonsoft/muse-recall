# Live demo readiness report — FocusFlow / Muse Spark

**Status:** ready for director review. **No merge, no submission, no video render, no history
rewrite.**
**Date:** 2026-10-28 (AEST) / 2026-10-27 (UTC)
**Repository:** `sidonsoft/muse-recall`
**Worktree:** `~/projects/muse-recall-positioning`
**Branch:** `agent/muse-recall-live-demo` (created from `agent/muse-recall-product-positioning`
at `41b1684`)
**Evidence commit:** `26e0aba` — `docs(demo): live Muse Spark FocusFlow evidence and V2 recording
plan`
**Release-hardening commit:** `7a4ca50` — `fix(verify): keep forge verification screenshots out
of historical evidence`

---

## 1. Executive summary

The live demonstration is credible and attributable.

- The isolated server ran the real `muse-cli` provider with `muse-spark-1.3` on chat and
  `muse-spark-1.3-contributor` on Forge, at `high` effort, with every supported maximum for
  calls, runtime, and timeout.
- A live Muse Spark round-trip passed (`6.4 s`, 94 output tokens).
- A genuine non-game application (**FocusFlow**, a single-file task planner) was generated,
  rejected once after a real sandbox failure, regenerated, browser-validated 21/21, and approved
  as v1.
- A genuine modification added priorities and a high-priority remaining count, passed 25/25
  browser checks, and was approved as v2 with base v1.
- Project memory was retrieved and recorded on every job: 3 decisions for the first generation,
  4 for the modification, 6 for the guard probe. Two more decisions were captured by the human at
  approval time.
- A live guard probe asked for a countdown that a remembered constraint prohibited. Muse Spark
  refused and left the file byte-identical. The probe was rejected. This is a real
  memory-respecting result, not a manufactured guard finding.
- Every attempt is preserved, including the rejected first generation and the rejected no-op.
- The protected MP4 was not touched. Its SHA-256 is
  `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0` (172 s, 1920×1080,
  11,333,490 bytes, mtime 2026-10-27 19:03).
- Phase 15B remains untouched on `agent/phase15b` at `9f5eaa1`; no Phase 15C confirmatory run was
  started.

**The main remaining product issue is not the model.** The shipped preview sandbox omits
`allow-forms`, so any generated application that relies on native `<form>` submission is broken.
The first FocusFlow attempt hit exactly this. The retake used a prompt-level mitigation, but the
production Forge prompt should encode the constraint or the sandbox policy should be revisited.

---

## 2. Repository state and isolation

### 2.1 Branch and worktrees

| Worktree | Branch / HEAD | Role |
|---|---|---|
| `~/projects/muse-recall-positioning` | `agent/muse-recall-live-demo` (`26e0aba` + report commit) | this work |
| `~/projects/muse-memory-lab` | `agent/phase15b` (`9f5eaa1`) | Phase 15B; untouched, clean |
| `~/projects/muse-recall-review` | detached `e6e2f86` | independent review; untouched |
| `~/projects/muse-memory-lab-local` | `agent/strata-phase14b-submission-audit` (`e8fe9df`) | untouched |
| `.claude/worktrees/muse-recall-demo-review-…` | `claude/muse-recall-demo-review-ec4fbf` (`4f53361`) | untouched |

No branch was merged, deleted, force-pushed, or history-rewritten. The new branch was pushed
normally:

```text
agent/muse-recall-live-demo -> origin/agent/muse-recall-live-demo
```

### 2.2 Isolation

- Database: `~/muse-demo-live/demo.db` (not Phase 15B's database).
- Workspace: `~/muse-demo-live/ws`.
- Logs, runs, screenshots, recordings: `~/muse-demo-live/`.
- The pre-existing dev server on `8787` and web server on `5173` were left running. The demo used
  ports `8799` (API) and `5199` (web) to avoid interference.

### 2.3 Phase 15B preservation

| Item | Value |
|---|---|
| Branch | `agent/phase15b` |
| HEAD | `9f5eaa1` |
| Working tree | clean |
| `rubric.json` SHA-256 | `5bcb16d33ef354886595282ee5ed62bab4d749c39fa865a268727be7ef68ebdd` |
| `rubric-v1-flawed.json` SHA-256 | `c54ef3f62831b83daaa15805e223b2acbd4057a82e208f1dd61f2fbf04db273b` |
| `analysis.json` SHA-256 | `95dc7e5bbceaba6c2cda8107a5921c5b411022bc2ea26dadc23f06a525b4ae18` |

No Phase 15B file, protocol, dataset, or scoring output was read-modify-written.

---

## 3. Configuration and live model validation

Full report: [`docs/demo/LIVE_MUSE_CONFIGURATION.md`](demo/LIVE_MUSE_CONFIGURATION.md).

| Setting | Effective value |
|---|---|
| Provider | `muse-cli` |
| Chat model | `muse-spark-1.3` |
| Forge model | `muse-spark-1.3-contributor` |
| Reasoning effort | `high` (chat and Forge) |
| `FORGE_MAX_CALLS` | `100` (schema maximum) |
| `FORGE_MAX_INPUT_TOKENS` | `10000000` (schema maximum; observational) |
| `FORGE_MAX_RUNTIME_MS` | `1800000` (schema maximum) |
| `MUSE_TIMEOUT_MS` | `900000` (schema maximum) |
| Server | `127.0.0.1:8799`, production build, isolated DB/workspace |
| Web | `127.0.0.1:5199`, proxied to 8799 |

Live validation:

- `GET /api/health?probe=live` → HTTP 200, provider `ok`, model `muse-spark-1.3`,
  `6367 ms`, 94 output tokens.
- The first Forge job used 9 calls / 329,279 input / 7,117 output / 65,111 ms — above the old
  25-call default, proving the raised limits were active.
- No secret appears in responses, logs, job records, artifacts, or screenshots. A byte scan of
  all changed files and of the demo directory outside `demo.env` found **0** files containing the
  API key.

Fallback:

- Fallback is implemented for quota-matched errors only, before any text (chat) or after a
  quota-classified failure (Forge), with one retry.
- The fallback model is the same contributor model, and the fallback key is the **same
  credential** as the primary. It is **not** independent quota resilience.
- No fallback activation was observed in any live run.

---

## 4. Non-game generation outcome

Full report: [`docs/demo/NON_GAME_HTML_VALIDATION.md`](demo/NON_GAME_HTML_VALIDATION.md).

| Attempt | Job id | Result | Calls / tokens / runtime | Browser checks |
|---|---|---|---:|---|
| 1 — generate | `1621b9db-76ac-4c94-9a3a-48ee1290fd42` | **rejected** — native form blocked by preview sandbox | 9 / 329,279 in / 7,117 out / 65,111 ms | failed: add produced no task; console error `allow-forms` |
| 2 — generate retake | `e358246a-6741-499c-8057-6b2447e31718` | **approved v1** | 6 / 208,950 / 6,077 / 49,151 ms | **21/21 pass** |
| 3 — modify | `aeb6b175-01a6-4c9b-93a1-757cddf475e1` | **approved v2** (base v1) | 17 / 681,229 / 5,183 / 116,334 ms | **25/25 pass** |
| 4 — guard probe | `0ecc11a0-6eac-4e30-a1c4-cf2eaed49daf` | **rejected no-op** — model honoured remembered countdown rule | 3 / 100,193 / 1,718 / 41,662 ms | no source change |

**Retake count: 1** (attempt 2 retook attempt 1). The rejected attempt is preserved and is not
presented as the first successful generation.

Generated application:

- Add, complete, delete, All/Active/Completed filters, progress label/percent/`aria-valuenow`,
  clear completed, Enter and click add.
- Priorities: Normal/High selector, per-task priority toggle, `High` badge, persistent
  high-priority remaining count that excludes completed tasks.
- No `localStorage`, `sessionStorage`, `indexedDB`, external service, or network request.
- Responsive at 390×844 with no horizontal overflow.
- Amber `#e7c17c` identity preserved; background shifted from `#191712` to `#141311` (both
  charcoal; recorded as a deviation).
- Approved artifacts: v1 `53d1e474…`, v2 `1d0ea67f…` (SHA-256).

---

## 5. Modification outcome

- The modification started from approved v1 (`base_version: 1`), not from a fresh generation.
- It recorded four active decisions (M1–M4), including the decision captured at v1 approval.
- The staged diff was read; the source was inspected; the review panel showed `Validation passed`.
- Approval ran the server-side headless-Chrome load check on the exact staged bytes and promoted
  v2 only after it passed (`runtime_verified: true`).
- The human captured a second decision at v2 approval (M5).
- Final state: `current_version: 2`, versions 1 and 2 retained with hashes, `can_rollback: true`.

Decision Guard:

- Every live FocusFlow advisory is `NOT VERIFIED` / `not_verified`, because the FocusFlow decisions
  are outside the supported rule set (`unsupported_decision`). No violation finding was produced.
- The live guard probe (attempt 4) asked for a countdown prohibited by a remembered rule. The
  model refused and left the file unchanged. Guard had no findings to report; the countdown rule
  was evaluated and did not appear in the `unverified` list.
- The V2 plan therefore uses the existing **packaged Phase 12C/12E labelled-mutation finding** for
  the on-screen "Guard warns" moment, with the mandatory
  `Labelled mutation — packaged evidence, not model output.` overlay. No synthetic finding is
  presented as live model output.

---

## 6. Provenance records

Machine-readable manifest:
[`docs/demo/evidence/records/provenance.json`](demo/evidence/records/provenance.json).

Every attempt retains:

- job id, kind, created/finished timestamps;
- provider/model/reasoning effort;
- prompt and prompt SHA-256 (exact prompts also stored for v2/v3/v4);
- retrieved memory ids;
- tool/model calls, input/output tokens, runtime;
- validation result and Decision Guard advisory;
- artifact bytes and SHA-256;
- approval/rejection and version;
- errors and model response (for the no-op probe);
- screenshots and browser-validation records.

The evidence pack is committed under `docs/demo/evidence/`:

```text
docs/demo/evidence/
├── artifacts/   v1–v4 staged HTML
├── records/     jobs, retrieval, browser checks, approvals, config, provenance
└── screenshots/ Studio, app, failure, mobile
```

No secret is in the pack.

---

## 7. Test and build results

| Command | Result | Notes |
|---|---|---|
| `pnpm verify` (baseline) | **pass** | 30 files, 491 tests passed, 3 skipped |
| `pnpm verify` (post-change) | **pass** | 30 files, 491 passed, 3 skipped |
| `pnpm build` | **pass** | web 478.91 kB JS / 43.12 kB CSS; server 306.6 kB |
| `pnpm verify:runtime` | **pass** | valid scene ok; broken, network-blocked and websocket-blocked scenes correctly rejected |
| `pnpm verify:forge` | **pass 9/9** | but see the legacy-UI caveat below |
| `pnpm verify:browser` | **pass 28/28** | against the repositioned Studio on `5199`; includes live Muse, memory, conversations, generative UI, HTML Studio tabs |

Notes:

- The first post-change `pnpm verify` failed because Biome tried to reformat the verbatim evidence
  JSON. `docs/demo/evidence` was added to the Biome excludes, and the suite passed on re-run.
- `pnpm verify:forge` defaults to `http://127.0.0.1:5173`, which is a **legacy “Muse Memory Lab”**
  dev server, not the repositioned Studio. Its 9 checks exercise the Forge workflow on that legacy
  UI. The repositioned Studio is covered by `verify:browser` and by the live FocusFlow runs.
- `pnpm verify:forge` previously wrote screenshots into tracked `docs/assets/phase9-forge-*.png`.
  Those files were restored to HEAD after the first run. Commit `7a4ca50` moves the output to
  `test-results/verify-forge/`. The re-run passed and left `docs/assets` clean.
- No unauthorized external resource loading was observed in FocusFlow browser checks. The preview
  made only same-origin requests.

---

## 8. Video readiness

Plan: `docs/submission/V2_DEMO_RECORDING_PLAN.md`.

- 172 s (2:52) target, within the three-minute limit and matching the approved storyboard length.
- Live FocusFlow footage proposed for the development/review segments; authentic Phase 12A figure
  retained for causal influence; packaged labelled mutation for the Guard finding; Phase 15B
  conservative numbers for the research beat.
- Mandatory overlays are specified with exact text and windows, including live job ids,
  generation-time condensation, retake disclosure, authentic Phase 12A provenance, labelled
  mutation, and Phase 15B original-vs-corrected labels.
- Retake disclosure is explicit: attempt 1 was rejected; attempt 2 was selected.
- No video was rendered. The protected MP4 is unchanged:
  - path: `video/cut/Muse_Recall_CutA_1080p.mp4` (primary workspace)
  - SHA-256: `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0`
  - 1920×1080, h264/aac, 172.000 s, 11,333,490 bytes
  - mtime: 2026-10-27 19:03 (before this session)
- V2 outputs must use distinct filenames under `video/v2-live/`; the cut directory has no V2
  files.

---

## 9. Phase 15B and Phase 15C

**Phase 15B:** preserved unchanged. Public headline remains the **original preregistered coder**:
15/16 violations without memory vs 5/16 with memory, Fisher two-tailed p = 0.000635. The corrected
post-hoc coder is 15/16 vs 0/16, p = 5.66e-08, and must be labelled post-hoc. Neither number is
merged into the FocusFlow evidence.

**Phase 15C (`PHASE15C_SHIPPED_PROMPT_REPLICATION`): not started.**

- No protocol was authored or pushed; no confirmatory runs were executed.
- The original Phase 15B protocol and data were not reused or modified.
- Reason: the mission made the live non-game application and V2 preparation submission-critical
  and the replication secondary. A 32-run design requires a defensible primary scoring method
  (the Phase 15B coder has known measurement errors), a committed preregistration, a fixed
  randomisation seed, and an independent workspace/database. Starting it without those would
  violate the preregistration rule.
- Recommended next action: author the protocol (including a primary scoring method that is not
  blindly the flawed v1 coder), commit and push it before the first run, then execute 16 + 16
  with no optional stopping. Do not call it Phase 15B.

---

## 10. Remaining blockers and recommended actions

| Priority | Issue | Evidence | Recommendation |
|---|---|---|---|
| **P1** | Preview CSP omits `allow-forms`; generated apps using native form submission cannot add tasks | attempt 1, job `1621b9db…`; console error; 0 tasks added | Encode “no native form submission” in the production Forge prompt, or add `allow-forms` after a security review. The retake prompt is a mitigation, not a product fix. |
| **P1** | `verify:forge` targets the legacy UI and default `5173`; it does not cover the repositioned Studio | 9/9 pass on a “Muse Memory Lab” page; new UI covered only by `verify:browser`/live runs | Update selectors and default base for HTML Studio; keep `verify:browser` as the new-UI gate. |
| **P2** | Decision Guard live advisory is `not_verified` for all FocusFlow decisions; no live violation finding | jobs v2–v4, guard `findings: []`, `unsupported_decision` | Use the packaged labelled mutation in V2, or run a new preserved supported-rule probe. Never manufacture a finding. |
| **P2** | No V2 video rendered; plan awaits director approval | §8; protected MP4 hash unchanged | Approve the plan and record under `video/v2-live/`; keep CutA fallback. |
| **P2** | Fallback shares the same key/model; not independent quota resilience | `muse-cli-provider.ts`, `runner.ts`; no activation observed | Do not claim quota resilience. Provide a separate credential if resilience is required. |
| **P3** | `FORGE_MAX_INPUT_TOKENS` is observational, not a hard in-process cap | `runner.ts` comment; config schema | Keep the label; do not describe it as a hard stop. |
| **P3** | Forge does not persist the CLI's observed model id; attribution rests on the validated config | `runner.ts:568`; `LIVE_MUSE_CONFIGURATION.md` §3.3 | Do not claim a per-job observed-model field; add one if stronger attribution is required. |
| **P3** | `usage.calls` is observed model calls, not a separate tool-call count | `provenance.json` note; `runner.ts` `run.usage` parsing | Label it as model calls; the CLI does not expose tool calls to Forge. |
| **P3** | Demo servers still running for review (`8799`, `5199`) | server/web PIDs in `$HOME/muse-demo-live/` | Stop them after director review; they are loopback-only. |
| **P3** | Evidence screenshots add ~2.7 MB to the repo | `docs/demo/evidence` | Acceptable for the review pack; move to release assets if size matters. |

No production inference settings, Phase 15B outputs, scoring files, or protected video were
changed.

---

## 11. Director review requested

Please review and decide:

1. **Approve the live FocusFlow evidence** as the V2 demonstration basis (generation attempt 2,
   modification, rejected attempts preserved).
2. **Approve the 172 s V2 plan** and the mandatory overlays, including the retake disclosure and
   the packaged labelled-mutation Guard insert.
3. **Decide the P1 form-sandbox fix**: production prompt constraint vs `allow-forms` policy change.
4. **Decide whether a new live Guard probe** is required for a live violation finding; if yes,
   authorise a preserved run. Otherwise the packaged labelled mutation is the on-screen finding.
5. **Confirm Phase 15C remains deferred** until its own preregistration is written and pushed.
6. **Confirm no merge, no submission, and no video replacement** until this review is complete.

---

## Appendix A — key hashes

| Item | SHA-256 |
|---|---|
| Protected MP4 | `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0` |
| FocusFlow v1 artifact | `53d1e47498c735746c0fd0b5f4b70d83872f26bbb1bb34f05d6d12030fc8e995` |
| FocusFlow v2 artifact | `1d0ea67f383bd4ec2f172d93fc97e82d53a889c3376491b33d0c22f4fbbb881d` |
| Rejected attempt 1 artifact | `95aa8d1dfa289d288010891fa6035410ead89d316c2a30fca1ce500891a566eb` |
| Phase 15B `rubric.json` | `5bcb16d33ef354886595282ee5ed62bab4d749c39fa865a268727be7ef68ebdd` |

## Appendix B — evidence index

| Document | Purpose |
|---|---|
| [`docs/demo/LIVE_MUSE_CONFIGURATION.md`](demo/LIVE_MUSE_CONFIGURATION.md) | limits, models, fallback, secrets, live check |
| [`docs/demo/NON_GAME_HTML_VALIDATION.md`](demo/NON_GAME_HTML_VALIDATION.md) | prompts, jobs, failures, browser tests, guard probe |
| [`docs/demo/evidence/records/provenance.json`](demo/evidence/records/provenance.json) | machine-readable attempt manifest |
| `docs/submission/V2_DEMO_RECORDING_PLAN.md` | 172 s storyboard, overlays, retake disclosure |
| `docs/demo/evidence/artifacts/` | exact v1–v4 HTML bytes |
| `docs/demo/evidence/screenshots/` | Studio, app, mobile, failure evidence |
| `docs/demo/evidence/records/` | jobs, retrievals, browser checks, approvals, config |
