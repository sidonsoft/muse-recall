# Final P1 review handoff

**Purpose:** independent review gate for the two release P1 fixes. This file
prepares the review; it does not impersonate or replace it.
**Date:** 2026-10-28
**Repository:** `sidonsoft/muse-recall`

---

## 1. Exact branch and commits

| Item | Value |
|---|---|
| Working branch | `agent/muse-recall-final-p1-fixes` |
| Base commit | `2ba4ba2` — `docs(demo): label usage.calls as model calls, not tool calls` on `agent/muse-recall-live-demo` |
| Implementation/test commit | `f39d7d5c7d6ce855b76b633346f7f73af9103220` |
| Documentation commit | `3863148143d0e688be6a854781318bf71f12b3ba` |
| Verification cleanup | `b240108` (textContent in Studio assertions) |
| Branch tip | the commit containing this handoff; check `git rev-parse HEAD` |
| Remote | `origin` → `https://github.com/sidonsoft/muse-recall.git` |
| Merge status | **not merged**; `main` is still `e6e2f86` |
| Push status | branch pushed; no force-push |

The branch is based on `agent/muse-recall-live-demo`, which is a strict
descendant of `agent/muse-recall-product-positioning` (`41b1684`) and therefore
contains the approved UX candidate plus the authentic FocusFlow evidence.

---

## 2. Changes introduced by this task

### P1 — form/sandbox compatibility

- `apps/server/src/forge/prompt.ts`: generation and modification instructions
  now state the real interaction contract: JavaScript actions, `type="button"`,
  no submit controls, no navigation, explicit Enter handling, accessible
  labels, no browser storage/external services. The prompt is explicit that
  `event.preventDefault()` cannot rescue a sandboxed submission because Chrome
  blocks it before the submit event.
- `tests/unit/forge-prompt.test.ts`: contract assertions and updated byte
  fixtures.
- `tests/unit/forge-sandbox-policy.test.ts`: static guard that the iframe
  sandbox, preview CSP and runtime network/WebSocket allowlist cannot be
  relaxed silently.
- `tests/integration/forge-api.test.ts`: the contract is written into the actual
  staged `prompt.txt`; a semantic-form app validates/previews/approves; preview
  headers keep `sandbox allow-scripts` and `form-action 'none'`.
- `scripts/verify-form-sandbox.ts` + `pnpm verify:formsandbox`: real-Chrome
  proof that JS-driven interactions work and native/`preventDefault()` forms
  are still blocked.
- `tests/fixtures/general-app-form.html`,
  `tests/fixtures/general-app-submit-prevented.html`,
  `tests/fixtures/general-app-native-submit.html`: positive and negative
  fixtures.

### P1 — verification alignment

- `scripts/verify-forge.ts`: rewritten for the current HTML Studio, with a
  wrong-application preflight and 14 workflow checks; screenshots remain under
  `test-results/verify-forge/`.
- `package.json`: adds `verify:forge-workflow` (backend integration suite) and
  `verify:formsandbox`.
- `scripts/verify-ui.ts`: scope documented; it is a broad smoke test, not the
  Studio workflow.
- `tests/fixtures/fake-muse.mjs`: new deterministic `app` mode (non-game,
  network-free) for the Studio browser verification.
- `README.md`: verification block names the four commands and scopes.

**Not changed:** application UI, sandbox permissions, CSP, Muse provider/model,
inference limits, Decision Guard rules, Phase 15B, historical evidence, the
demonstration video.

---

## 3. Branch map relevant to review

| Branch | Tip at handoff | Role |
|---|---|---|
| `main` | `e6e2f86` | approved public baseline |
| `agent/muse-recall-product-positioning` | `41b1684` | approved UX/product implementation |
| `agent/muse-recall-live-demo` | `2ba4ba2` | live FocusFlow evidence; **base of this branch** |
| `agent/muse-recall-final-p1-fixes` | `b240108` plus this metadata commit | this review |
| `agent/phase15b` | `9f5eaa1` | Phase 15B experiment; **local only, not pushed** |
| `agent/phase15b-evidence-integration` | **not found** locally or on `origin` at inspection | research evidence integration is owned by the separate evidence agent |

`agent/muse-recall-live-demo` is a strict descendant of
`agent/muse-recall-product-positioning`, so this branch already includes the UX
candidate; no merge of those two is required before review.

---

## 4. Security-sensitive files

Review these first:

| File | Why |
|---|---|
| `apps/server/src/routes/forge.ts` | preview CSP, sandbox, artifact endpoint (must be unchanged in this branch) |
| `apps/web/src/components/studio/StudioView.tsx` | iframe `sandbox="allow-scripts"` (unchanged) |
| `apps/server/src/forge/prompt.ts` | only production prompt change |
| `apps/server/src/forge/runtime-check.ts` | network/WebSocket allowlist (unchanged) |
| `apps/server/src/forge/workspace.ts` | validation/promotion (unchanged) |
| `scripts/verify-forge.ts` | browser workflow and preflight |
| `tests/unit/forge-sandbox-policy.test.ts` | policy regression guard |

Confirm with:

```bash
git diff --stat 2ba4ba2..HEAD
git diff 2ba4ba2..HEAD -- apps/server/src/routes/forge.ts \
  apps/web/src/components/studio/StudioView.tsx \
  apps/server/src/forge/runtime-check.ts
```

The last command should print nothing.

---

## 5. Evidence status

| Asset | Status |
|---|---|
| FocusFlow attempt 1 (failed, job `1621b9db…`) | preserved, untouched |
| FocusFlow attempt 2 / approved v1 (job `e358246a…`) | preserved, untouched |
| FocusFlow modification / approved v2 (job `aeb6b175…`) | preserved, untouched |
| Guard probe (rejected no-op, job `0ecc11a0…`) | preserved, untouched |
| `docs/demo/evidence/` | 38 tracked files, clean working tree |
| Decision Guard | advisory only; `not_verified` remains correct for FocusFlow; packaged labelled mutation still must carry **“Labelled mutation — packaged evidence, not model output.”** |
| Phase 15B | original 15/16 vs 5/16, p = 0.000635 remains the conservative headline; corrected 15/16 vs 0/16 is post-hoc; no protocol/raw/scoring/result files changed |
| Phase 15C | not started |
| Protected video | `video/cut/Muse_Recall_CutA_1080p.mp4` (outside the tracked tree) SHA-256 `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0`, 11,333,490 bytes, mtime 2026-10-27 19:03 — unchanged |

---

## 6. Test commands

Run from the branch worktree. No paid inference is required.

```bash
pnpm install --frozen-lockfile
pnpm verify                  # lint + typecheck + 518 tests (3 skipped)
pnpm build
pnpm verify:runtime          # approval runtime + HTTP/WS exfiltration
pnpm verify:formsandbox      # real Chrome form/sandbox contract
pnpm verify:forge-workflow   # backend generate/stage/diff/approve/reject/rollback
```

For the browser Studio workflow, start isolated servers:

```bash
FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" \
FAKE_MUSE_MODE=app \
FAKE_MUSE_APP="$PWD/tests/fixtures/general-app-form.html" \
MODEL_PROVIDER=echo PORT=8899 DATABASE_PATH=/tmp/mrl-review.db \
WORKSPACE_ROOT=/tmp/mrl-review-ws \
CORS_ORIGINS=http://127.0.0.1:5299 \
pnpm --filter @mml/server exec tsx src/index.ts

VITE_PROXY_TARGET=http://127.0.0.1:8899 \
pnpm --filter @mml/web exec vite --port 5299 --strictPort

FORGE_VERIFY_BASE=http://127.0.0.1:5299 pnpm verify:forge
VERIFY_URL=http://127.0.0.1:5299 pnpm verify:browser
```

To confirm the wrong-application guard, point the same command at the legacy
server on `:5173`; it must exit 1 with the “legacy Muse Memory Lab UI” message.

Optional visual capture (designated output; do not commit routine refreshes):

```bash
pnpm evidence:ux
```

---

## 7. Known limitations / review focus

1. **Prompt guidance is not enforcement.** A model can still emit a submit
   control; the approval gate is human/browser review plus load-time runtime
   verification. This is the same residual as before, now mitigated at the
   prompt.
2. **`preventDefault()` is not a workaround** in this sandbox. This is
   empirically verified, not inferred. If a reviewer believes Chrome should
   dispatch `submit` first, reproduce with
   `tests/fixtures/general-app-submit-prevented.html`.
3. **Runtime verification is load-time only.** It does not click the generated
   app. `verify:forge` clicks the deterministic fixture, not arbitrary output.
4. **`verify:forge` needs running servers**; it does not spawn them.
5. **`verify:browser` skips live-Muse/generative-UI segments** on the echo
   provider by design.
6. **No new sandbox permission was added.** If review concludes the opposite,
   the change is defective and should be rejected.
7. **`agent/phase15b-evidence-integration` is absent.** Confirm with the
   evidence agent before integration; this branch does not claim to contain it.

---

## 8. Outstanding release decisions (not taken here)

1. Merge order: `agent/muse-recall-product-positioning` → `agent/muse-recall-live-demo`
   → this branch, or fast-forward this branch's base into `main` in the order
   approved by the director. **No merge was performed.**
2. V2 video recording. **Not recorded; protected CutA remains.**
3. Live Decision Guard violation probe. The packaged labelled mutation remains
   the on-screen evidence; no finding was manufactured.
4. Phase 15C authorisation. **Not started.**
5. Hackathon submission. **Not submitted.**

---

## 9. Reviewer acceptance checklist

- [ ] `git diff 2ba4ba2..HEAD` contains no sandbox/CSP/provider/limit changes.
- [ ] `pnpm verify` is green (518 passed, 3 skipped).
- [ ] `pnpm build` is green.
- [ ] `pnpm verify:runtime` is green (HTTP and WebSocket blocked).
- [ ] `pnpm verify:formsandbox` is 7/7.
- [ ] `pnpm verify:forge-workflow` is 37/37.
- [ ] `pnpm verify:forge` is 14/14 plus no console errors on the current Studio.
- [ ] The same command fails clearly on the legacy UI.
- [ ] FocusFlow evidence and Phase 15B files are byte-identical to base.
- [ ] The report's security claims match the diff.

If all boxes hold, the two P1 issues are closed and the branch is a stable
candidate for the director's integration decision.
