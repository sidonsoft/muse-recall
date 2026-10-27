# Phase 12A — production memory validation

Branch `agent/phase12-memory-validation`, based on the accepted Phase 11A commit
`d35fa9d` plus the Phase 11B/11C evaluation work (`0ce6444`, `dece8c1`). No merge to
`main`, no submission, no product-scope expansion.

## 1. Integration

- Pushed the previously local evaluation branch `agent/strata-phase11-decision-eval`
  (`dece8c1`, containing `0ce6444`) after verifying it was not on the remote.
- Merged it into the Phase 12 branch as `b7e6314`; no conflicts.
- Memory evaluation (12 tests) and decision evaluation (20 tests) pass.

## 2. Production prompt parity

The Phase 11B harness mirrored `buildPrompt` and the retrieval query. Both now come from one
production module, `apps/server/src/forge/prompt.ts`:

- `buildForgePrompt()` — used by the runner and both evaluation harnesses; the mirror is deleted.
- `buildRetrievalQuery()` — project id + task; the runner previously duplicated the request as
  the query. This is the only intentional behaviour change; it aligns production with the
  evaluation and scopes retrieval to the project.
- The runner records `prompt_sha256` on every job.
- Byte-exact fixtures: `tests/fixtures/forge-prompt/{generate,modify-memory,modify-no-memory}.txt`
  with ordering assertions (`tests/unit/forge-prompt.test.ts`).
- **Reconstruction check:** retrieving the same project memories and rebuilding the prompt with
  the production functions reproduces the job's `prompt_sha256` for all three conditions
  (A, B, C), proving the exact prompt — including the memory block — is what Forge sent.

| Condition | Job prompt sha256 (prefix) | Reconstructed | Match |
| --- | --- | --- | --- |
| A | `63710663…` | `63710663…` | yes |
| B | `0d38ee75…` | `0d38ee75…` | yes |
| C | `cc3a3967…` | `cc3a3967…` | yes |

No-memory condition B reconstructs with an empty memory block and contains no project decision
text. Superseded sunset guidance is absent from C's active memory; C's block contains only the
ocean constraint.

## 3. A/B/C protocol

- Baseline: the recorded real Spark game (`demo/forge-baseline/index.html`), seeded as v1 in
  three projects. **Baseline sha256 `79c9d67a…9ba9e41` in every condition.**
- Model: `muse-spark-1.3-contributor`, forced via API key so all three conditions use the same
  model and no failover. Failover: **false** in all three.
- Request, byte-identical: `Add a Next Level button beneath the Restart button.`
  Request sha256 `8309c21b…24be0f`.
- Memories:
  - A: sunset constraint (`#FF7E5F` accent, `#2D1E2F` text, avoid neon).
  - B: none.
  - C: ocean constraint (`#4EA8DE`, `#102A43`) superseding the sunset constraint.
- One trial per condition. Exploratory, not statistically significant.

## 4. Results

| Metric | A (sunset) | B (none) | C (ocean) |
| --- | --- | --- | --- |
| Job id | `926bd9d0…` | `ccd567d5…` | `6a246238…` |
| Memory ids | 1 (sunset) | 0 | 1 (ocean) |
| Calls | 7 | 4 | 4 |
| Input / output tokens | 251,095 / 2,945 | 135,492 / 1,755 | 134,783 / 1,306 |
| Latency | 52.2 s | 34.1 s | 26.6 s |
| Changed lines | 9.3% | 3.49% | 3.49% |
| Structural validation | pass | pass | pass |
| Runtime verification | pass | pass | pass |
| Approved / rolled back | yes / yes | yes / yes | yes / yes |
| Source accent occurrences | `0xFF7E5F` ×1 | 0 | `0x4EA8DE` ×1 |
| Sunset hex in v2 source | 1 (the accent) | 0 | **0** |
| Rendered accent coverage | **1.082%** | 0.005% | **0.879%** |
| Dark text colour used | no (white label) | no | no |
| Neon colours | 0 | 0 | 0 |

Totals: 15 calls, **521,370 input / 6,006 output tokens**, ~**$0.053** at contributor pricing;
mean latency 37.6 s, median 34.1 s.

Screenshots (`A-v2-visible.png`, etc.) were captured with the start overlay dismissed; the
initial screenshot-based numbers in `pilot.json` were measured behind that overlay and are kept
in `rendered_palette` with `metrics_note` explaining the correction. No model output was changed.

## 5. Source comparison

- **A** draws the Next Level button with `0xFF7E5F`, the remembered sunset accent; the button is
  visible in the rendered screenshot.
- **B** chooses an independent green/neutral button; neither palette appears.
- **C** draws the same button with `0x4EA8DE`, the corrected ocean accent; `#FF7E5F` does not
  appear anywhere in the v2 source.

The accent decision tracks memory across all three conditions. The remembered **text colour was
not applied**: both A and C label the button white. That is a partial palette result, reported
as such.

## 6. Limitations

- One trial per condition; exploratory only. No significance claim.
- Only the accent colour and neon avoidance are demonstrably enforced; dark text colour is not.
- Rendered-pixel compliance is approximate (24/255 tolerance, 480×360 sampling) and depends on
  the screenshot including the button.
- The model is forced to Spark contributor for comparability; results may differ on Wonder.
- Prompt reconstruction proves the memory block was present, not that the model attended to
  every line.
- Retrieval still selects a subset of memories under budget.

## 7. Memory influence verdict

**PASS for memory influence. PARTIAL for full palette fidelity.**

Memory changed the produced artifact, not just the prompt: the same request produced a sunset
accent with A's memory, no remembered accent with B, and an ocean accent with C's corrected
memory, while the superseded sunset guidance was excluded from C. The text-colour instruction
was ignored, so the full palette contract is only partially met.

## 8. Decision Guard integration plan (no implementation yet)

A deterministic guard can sit between runtime verification and promotion, without weakening any
existing gate:

1. **Input:** validated staged HTML + the same retrieved memory block/ids recorded on the job.
2. **Run:** pure guard returns findings `{rule_id, severity: blocking|advisory, message, evidence}`.
3. **Merge:** append findings to `job.validation.issues`; set `validation.ok = false` if any
   blocking finding exists.
4. **Enforce:** approval returns 422 `guard_failed` before promotion; the job becomes failed, the
   staged file stays un-promoted, and the audit record keeps the findings.
5. **Surface:** the diff panel lists blocking findings next to structural/runtime results; the
   approve button is disabled. Preview and rollback are unchanged.
6. **Ordering:** structural → runtime → guard → CAS promotion. A guard can never skip runtime
   verification or the approval API.
7. **Open item:** whether guard findings should also block generation (not only modification),
   and who owns rule severity. Awaiting Strata's engine and director review.

## 9. Remaining risks

- n=1 per condition; button colour is a single visual signal.
- Text-colour memory not honoured; a stricter guard would be needed to enforce it.
- Forced-key mode differs from subscription-first operation (no failover exercised here).
- Evaluation harness now imports production code, so a production regression can break the
  evaluation — intentional, but it means tests and product fail together.
- Local-only security posture unchanged; key handling unchanged (no key in evidence).

## 10. Verification and commit

- Full suite: 334 passed, 3 skipped (337); memory eval 12, decision eval 20, prompt parity 4.
- `pnpm verify:forge` (fake CLI) 9/9; `pnpm verify:runtime` valid/invalid as expected.
- Evidence: `docs/hackathon-evidence/phase12/pilot.json`, `{A,B,C}-v2.html`, `{A,B,C}-v2*.png`.
- Commit: recorded below in the final report.
