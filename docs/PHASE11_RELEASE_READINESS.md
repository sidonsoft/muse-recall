# Phase 11A — release readiness

Branch `agent/phase11-release` from `6fe663b`. Feature freeze. No merge, no submission.

## 1. Security verdict — **PASS for the documented local-only scope**

| Check | Result | Evidence |
| --- | --- | --- |
| Key never in argv | PASS | CLI receives `--api-key-stdin`; the value is written to stdin. Audit + argv test |
| Key never in application logs | PASS | Runner/provider sanitise log entries; no key is logged by the server |
| Key never in persisted jobs | PASS | `ForgeJob` schema has no key field; JSON job files sanitised |
| Key never in API responses | PASS | Integration test serialises the whole job response and asserts absence |
| Key never in browser-visible errors | PASS | Errors are sanitised server-side before storage/return |
| Key not in current git tree | PASS (finding fixed) | A redaction test fixture contained the literal key; it was replaced with a synthetic value in this branch. The value remains in earlier history and **must be rotated** |
| Env not exposed | PASS | Configuration is read server-side; meta/health expose provider kind/model only |
| Credential transport | PASS | Only the intended stdin mechanism; `--provider meta` |

**Sanitisation (A2).** `redactSecrets()` removes exact configured values, `LLM_`/`sk-`/`ghp_`/
`github_pat_`/`AKIA` keys, Bearer headers and `key=value` patterns, caps diagnostics at 4,000
characters and preserves quota/429 diagnostics. Applied to Forge logs, job errors and summaries,
and to provider errors derived from CLI stderr. It reduces exposure; it cannot prove every
possible secret format is removed.

**Failover correctness (A3).**

| Property | Result |
| --- | --- |
| Retry only on quota/429/rate-limit | PASS (auth and network failures do not retry) |
| At most one retry | PASS (second quota failure ends the job) |
| Staging reset before retry | PASS (primary corrupts, fallback still sees the baseline) |
| No contamination from partial primary output | PASS (reset + tested) |
| Usage attributed and summed | PASS (3 + 2 calls = 5) |
| Chat does not retry after text | PASS by design (retry only when no text was emitted) |
| Cancellation prevents further attempts | PASS (existing cancellation tests) |
| Budgets not reset | PASS (runtime/call checks unchanged) |
| Fallback cannot bypass validation/approval | PASS (invalid fallback → failed job → 409 approval) |

Residual risk: redaction is pattern-based; a novel credential format could survive. An old key was
committed in a test fixture (`c097767`) before review; it was removed from the tree and **rotated on
2026-10-27**. The revoked value remains in history but is no longer valid. The replacement key is
not stored in the repository. Local-only, single-user scope is unchanged.

## 2. Real-model reliability — **5/5**

Fresh v1 baseline for every trial (rollback loop to the baseline, not one step). All trials used
the configured subscription first and fell back to `muse-spark-1.3-contributor` after 429.

| # | Request | Latency | Calls | Input | Output | Lines changed | Approved | Runtime check | Rollback |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | Golden glow on matched cards | 104.2 s | 9 | 284,522 | 1,721 | 5.0% | yes | yes | yes |
| 2 | Restart hover feedback | 48.1 s | 7 | 200,819 | 1,286 | 10.1% | yes | yes | yes |
| 3 | Score pop animation | 34.1 s | 7 | 207,635 | 1,336 | 1.2% | yes | yes | yes |
| 4 | HUD text contrast | 44.1 s | 6 | 171,706 | 1,167 | 3.1% | yes | yes | yes |
| 5 | Completion banner animation | 48.1 s | 7 | 206,968 | 1,455 | 5.0% | yes | yes | yes |

- **Average 55.7 s · median 48.1 s · min 34.1 s · max 104.2 s** (target <180 s: pass).
- All changes ≤10.1% of original lines (target ≤30%: pass).
- Screenshots: 162,866-character PNGs, non-blank (luminance range ~220, 2,696 colourful pixels).
- Tokens: **995,828 input / 8,180 output / 34 calls**; estimated contributor cost **$0.10**.
- Failover occurred on all five; no trial failed. Evidence: `docs/hackathon-evidence/phase11/trials.json`.

Harness note: the first campaign passed 5/5 but trials 2–5 started from modified versions because
the reset used a single rollback step. The campaign was rerun with a loop back to v1; the table
above is the corrected run. The product's one-step rollback is intentional; the harness was wrong.

## 3. Regression results

| Check | Result |
| --- | --- |
| `pnpm test` | **307 passed**, 3 skipped (310) |
| `pnpm run lint` | clean (144 files) |
| `pnpm run typecheck` | 6/6 projects |
| `pnpm run build` | web + server |
| `pnpm verify:forge` | **9/9**, no console errors |
| `pnpm verify:runtime` | valid passes; `Graphics.fillStar` rejected |
| Symlink preview/diff | blocked (409) |
| Stale approval | 409 `version_conflict` |
| Tampered rollback | 409 `version_corrupt` |
| Blank capture | rejected by client analysis + unit tests |
| Concurrent jobs | capped at 2 per project |
| Failover validation bypass | blocked (422/409) |
| Secret exposure | redaction tests + serialised job response |

## 4. Known limitations

- One project, one `index.html`; no asset pipeline, audio, or multi-scene tooling.
- Runtime verification proves the game loads without errors and renders a canvas; it does not
  prove rules, win conditions, or visual intent.
- Approval launches headless Chrome (~2–3 s); the server needs Chrome installed.
- Preview is sandboxed but served from the application origin.
- Loopback-only, no authentication; not safe for public multi-user hosting.
- Failover covers quota exhaustion only; auth/network failures fail closed by design.
- The API key used during testing must be rotated; it appeared in chat.

## 5. Demo readiness

`pnpm demo:seed` installs a recorded real Spark-generated baseline into `forge-demo` (v1, 11,529
chars, hash recorded). The demo then uses real inference for one narrow change:

1. Open Forge → project `forge-demo`.
2. Capture the preview (renderer snapshot, non-blank).
3. Request: "Improve the Restart button hover feedback."
4. Review the diff and validation (typically 34–105 s).
5. Approve → server runtime check → preview updates.
6. Undo last change → v1 restored.

The baseline is genuine model output, not hand-written; no fake CLI is used in the demo. Do not
claim gameplay correctness beyond load/render verification.

## 6. Remaining blockers (administrative)

- Record and upload the three-minute video.
- Decide repository visibility for judging.
- Complete the submission form; do not submit automatically.
- ~~Rotate the exposed API key~~ — done 2026-10-27; the replacement is not stored in the repo.

## 7. Recommendation — **CONDITIONAL GO**

The Forge loop is now reliable enough to demo: 5/5 real modifications, all approvals and
rollbacks verified, secrets handled defensibly for a local tool. Conditions are non-technical
(video, visibility, submission) plus the product-level differentiation risk documented in
`docs/PRODUCT_STRATEGY.md`. If the team wants the strongest real-world story rather than the
strongest visual demo, Project Handover remains the alternative.
