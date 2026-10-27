# Final P1 fix report

**Task:** close the two P1 release issues, verify the HTML Studio workflow, prepare a
reviewable release candidate.
**Date:** 2026-10-28
**Repository:** `sidonsoft/muse-recall`

---

## 1. Branch and commits

| Item | Value |
|---|---|
| Working branch | `agent/muse-recall-final-p1-fixes` |
| Base commit | `2ba4ba2` (`agent/muse-recall-live-demo`) |
| Implementation/test commit | `f39d7d5c7d6ce855b76b633346f7f73af9103220` |
| Documentation commit | `3863148143d0e688be6a854781318bf71f12b3ba` |
| Verification cleanup | `b240108` |
| Branch tip | the commit containing this report; check `git rev-parse HEAD` |
| Merge into `main` | **not performed** |
| Branch deletion / force-push / rebase | **none** |

`agent/muse-recall-live-demo` is a strict descendant of
`agent/muse-recall-product-positioning` (`41b1684`), so the base contains both
the approved UX candidate and the live FocusFlow evidence.

---

## 2. Files changed

Implementation commit `f39d7d5` (17 files, +851 / −124):

| File | Change |
|---|---|
| `apps/server/src/forge/prompt.ts` | generation + modification interaction contract |
| `scripts/verify-forge.ts` | rewritten for current HTML Studio; wrong-app preflight; 14 checks |
| `scripts/verify-form-sandbox.ts` | new real-Chrome form/sandbox contract check |
| `scripts/verify-ui.ts` | documented broad-smoke scope |
| `package.json` | `verify:forge-workflow`, `verify:formsandbox` |
| `tests/unit/forge-prompt.test.ts` | contract assertions |
| `tests/unit/forge-sandbox-policy.test.ts` | new sandbox/CSP/network policy guard |
| `tests/integration/forge-api.test.ts` | prompt reaches the job; semantic form app; headers |
| `tests/fixtures/forge-prompt/*.txt` | byte fixtures updated for the new prompt |
| `tests/fixtures/fake-muse.mjs` | new deterministic `app` mode |
| `tests/fixtures/general-app-form.html` | compatible positive fixture |
| `tests/fixtures/general-app-submit-prevented.html` | negative control (`preventDefault` cannot rescue) |
| `tests/fixtures/general-app-native-submit.html` | negative control (native submission blocked) |
| `README.md` | verification commands and scopes |

Documentation commit adds:

- `docs/release/FORM_SANDBOX_COMPATIBILITY.md`
- `docs/release/FORGE_VERIFICATION_ALIGNMENT.md`
- `docs/reviews/FINAL_P1_REVIEW_HANDOFF.md`
- `docs/release/FINAL_P1_FIX_REPORT.md` (this file)

No application view, sandbox attribute, CSP directive, provider, model id,
inference limit, Decision Guard rule, Phase 15B file, historical evidence or
video was changed.

---

## 3. P1 fix one — native form compatibility

### 3.1 Finding

FocusFlow attempt 1 used a `<form>` with `<button type="submit">` **and** a
submit handler calling `event.preventDefault()`. It still failed. Real Chrome
blocks a sandboxed submission **before** dispatching `submit`, so the handler
never runs. `preventDefault()` is not a workaround for this sandbox.

This was confirmed deterministically with the exact iframe sandbox and CSP:
`type="submit"` and `requestSubmit()` both log the sandbox block with zero
submit-listener calls. Only a synthetic `dispatchEvent` reaches the handler,
which is not a supported pattern.

### 3.2 Fix

The production prompt now states the real contract before the user request:

- client-side JavaScript with explicit `click`/`keydown` listeners;
- `type="button"` for actions, never `<button type="submit">`;
- no native submission or page navigation;
- semantic `<form>` allowed for grouping/labels only;
- explicit Enter handling;
- accessible labels, keyboard operation;
- no browser storage, external services or unrestricted capabilities.

Modification jobs receive the same contract. No sandbox permission was added;
no CSP directive was removed. The full assessment is in
[`FORM_SANDBOX_COMPATIBILITY.md`](FORM_SANDBOX_COMPATIBILITY.md).

---

## 4. P1 fix two — verification alignment

### 4.1 Finding

`verify:forge` defaulted to `:5173`, the legacy “Muse Memory Lab” UI. It clicked
**Forge**, **Generate game**, **Game preview** and similar selectors that no
longer exist in HTML Studio, so its 9/9 pass did not describe the shipped
product.

### 4.2 Fix

- `verify:forge` now drives the current Studio: landing, project open, generate,
  staged preview + JS interaction, Source with SHA, Changes with added lines,
  approve v1, approved-vs-staged source, export, staged/approved toggle,
  Decision Guard advisory, project-memory caveat, reject, approve v2, rollback
  to v1, and no console/page errors.
- A preflight asserts the **HTML Studio** surface (`aria-current="page"`) and
  the **Preview** tab. On the legacy page it exits 1 with an explicit message.
- Backend workflow semantics are separated into
  `pnpm verify:forge-workflow` (37 integration tests, no UI).
- `pnpm verify:browser` keeps its broad-smoke role and is documented as such.
- `FORGE_VERIFY_BASE`, `VERIFY_URL`, `FORGE_VERIFY_SHOTS` make targets and
  output configurable. Routine screenshots stay in gitignored
  `test-results/`.

Details and the responsibility matrix are in
[`FORGE_VERIFICATION_ALIGNMENT.md`](FORGE_VERIFICATION_ALIGNMENT.md).

---

## 5. Tests added or modified

| Test | Count / result |
|---|---|
| `tests/unit/forge-prompt.test.ts` | 18 tests — contract, byte fixtures, ordering |
| `tests/unit/forge-sandbox-policy.test.ts` | 14 tests — sandbox/CSP/network allowlist |
| `tests/integration/forge-api.test.ts` | 37 tests (new prompt/headers/form-app test) |
| `scripts/verify-form-sandbox.ts` | 7/7 browser checks |
| `scripts/verify-forge.ts` | 14/14 Studio checks + no console/page errors |
| `tests/fixtures/*` | positive, submit-prevented and native-submit controls |

All deterministic; no live Muse inference.

---

## 6. Verification results

Run on the release worktree with an isolated API (`:8899`) and web client
(`:5299`), `MODEL_PROVIDER=echo`, `FAKE_MUSE_MODE=app`.

| Command | Result |
|---|---|
| `pnpm verify` | **PASS** — lint + typecheck + 31 files, **518 passed, 3 skipped** (521 total) |
| `pnpm build` | **PASS** — web 478.91 kB JS / 43.12 kB CSS; server 308.0 kB |
| `pnpm verify:runtime` | **PASS** — valid scene; broken scene rejected; HTTP and WebSocket exfiltration blocked |
| `pnpm verify:formsandbox` | **PASS** — 7/7 checks |
| `pnpm verify:forge-workflow` | **PASS** — 37/37 tests |
| `pnpm verify:forge` (current Studio) | **PASS** — 14/14 checks, no console/page errors |
| `pnpm verify:forge` (legacy `:5173`) | **FAILS AS DESIGNED** — clear wrong-application message, exit 1 |
| `pnpm verify:browser` | **PASS** — 27 checks, no console/HTTP errors |
| `pnpm evidence:ux` | **PASS** — 24 frames; visually inspected at 1920×1080, 1440×900, 1280×720; approved evidence restored afterwards |

Functional checks covered: Studio load, preview, source, changes/diff, staging,
approval, rejection, rollback to recorded parent, memory retrieval visibility,
Decision Guard advisory visibility, export, memory correction/deletion,
retrieval explanation, conversations, and the offline error state via
`evidence:ux`. Offline recovery UI is exercised by `evidence:ux`; the broad
smoke test skips the live-Muse segment on the echo provider by design.

Visual inspection: 1920×1080, 1440×900, 1280×720 frames show no clipping,
Approve/Reject visible at 720, and the staged/approved toggle and Review rail
intact. No visual regression was introduced by this task.

---

## 7. Security checks

| Check | Result |
|---|---|
| Preview iframe attributes | unchanged: `sandbox="allow-scripts"` |
| `allow-forms` / `allow-top-navigation` / `allow-same-origin` | absent; guarded by test |
| Preview CSP | unchanged; `form-action 'none'`, `default-src 'none'`, CDN-only script/connect |
| HTTP exfiltration | blocked (`exfiltration.example`) |
| WebSocket exfiltration | blocked (closed with 1008) |
| Host privileges from generated HTML | opaque origin; storage access throws (verified) |
| Artifact access scope | unchanged read-only JSON; project/job scoping untouched |
| Secrets in evidence | no config/secrets changed or emitted; `docs/demo` untouched |
| Test screenshots | `test-results/` only; tracked evidence untouched |
| Runtime verification | still runs before approval |

---

## 8. Evidence preservation

- **FocusFlow attempt 1** (failed; native form blocked) is preserved and is not
  presented as a success.
- **Attempt 2 / v1** and **modification / v2** jobs, artifacts, prompts,
  screenshots and browser-validation records are untouched.
- **Guard probe** (rejected no-op) is untouched; Decision Guard remains
  `not_verified` for unsupported rules; no finding was manufactured; the
  packaged labelled mutation retains its disclosure.
- **Phase 15B:** no protocol, raw output, scoring script, result file or
  metadata was read-modified-written. Original headline 15/16 vs 5/16,
  p = 0.000635 remains public; corrected 15/16 vs 0/16 remains disclosed as
  post-hoc. Phase 15C was not started.
- **`agent/phase15b-evidence-integration`** was not present locally or on
  `origin` at inspection; this branch does not include or alter research
  integration.
- **Video:** `video/cut/Muse_Recall_CutA_1080p.mp4` is outside the tracked tree;
  SHA-256 still `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0`,
  11,333,490 bytes, mtime 2026-10-27 19:03. No replacement was recorded.

---

## 9. Known limitations

1. The prompt is guidance; a model can still emit a submit control. Human
   review plus load-time runtime verification remain the backstop. Runtime
   verification does not click the app.
2. `verify:forge` needs running API/web servers and uses a deterministic
   fixture, not a live model.
3. `verify:browser` skips live-Muse and generative-UI segments when the echo
   provider is configured.
4. Approval runtime verification is load-time only; interaction coverage is
   provided by `verify:forge`/`verify:formsandbox` for the verification
   fixtures, not arbitrary generated apps.
5. Capture remains canvas-only; non-canvas apps can preview/source/diff/export
   but “Capture” may report no canvas. Unrelated to the P1s.
6. No static lint rejects `type="submit"` in generated output; that would be a
   product decision, not part of this hardening.

---

## 10. Recommended integration order

1. Review and accept this branch's P1 fixes (independent Opus gate).
2. Confirm `agent/muse-recall-product-positioning` (`41b1684`) and
   `agent/muse-recall-live-demo` (`2ba4ba2`) are the approved UX/evidence
   baseline — this branch is already based on them.
3. Resolve the separate evidence-integration branch (not present here) and
   Phase 15B preservation with the research agent.
4. Fast-forward or merge this branch into the release line **after** the
   director approves; do not squash the historical commits.
5. Record V2 video only after merge and release approval, in `video/v2-live/`;
   keep CutA intact.
6. Submit the hackathon entry only after the video and independent review
   gates close.

---

## 11. Merge readiness assessment

**Ready for independent review.** Both P1 issues are closed without relaxing
the sandbox, the full deterministic suite passes, the current Studio is
covered end to end, and the legacy-targeting failure is now explicit. The
branch has not been merged, force-pushed, rebased or submitted.

Open release decisions remain outside this task: merge approval, V2 video,
live Guard probe, Phase 15C, and submission. The reviewer handoff is
[`../reviews/FINAL_P1_REVIEW_HANDOFF.md`](../reviews/FINAL_P1_REVIEW_HANDOFF.md).
