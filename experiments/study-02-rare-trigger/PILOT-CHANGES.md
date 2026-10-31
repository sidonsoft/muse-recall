# Pilot changes — defects found and fixes required before the confirmatory freeze

**Status:** checkpoint-2 document, **not a freeze**. Everything here is allowed to change because
the preregistration has not been frozen. Each item records the defect, the evidence, the fix (or the
fix required at freeze) and whether it was already applied for the pilot dataset.

## Pilot outcome (final, 2026-11-01 03:33 AEST)

- **132/132 primary records**, **123 usable (93.2 %)**, **9 unusable** — every failure is a
  transport/stall timeout (4 with the old generic timeout message, 4 stream inactivity aborts, 1
  endpoint-shutdown connection failure), zero scoring failures. Usable by arm: none 31/33, memory
  30/33, manual 30/33, corrected 32/33.
- **Expected, pre-declared replacement pass run:** one replacement per unusable run (9), same
  scenario/arm/repetition, same prompt and seed policy; originals retained; **9/9 replacements
  succeeded**. Replacements live in `pilot/replacements/` and are reported separately; they never
  enter the confirmatory dataset.
- **Run-time:** 45,647 s total (12.7 h of model time; ~13.8 h wall clock including restarts); mean
  345.8 s, median 296.0 s, p95 624.1 s, max 736.7 s per run; ~25 % of runs needed a stall retry.
- **Manipulation checks:** 132/132 primary runs passed.
- **Scoring:** 0 consistency failures, 0 violations without a trigger-zone construct.
- **Repeats:** 0/8 same-seed repeats byte-identical to their primary (one changed the detector
  verdict); 0/4 new-seed repeats identical. No determinism claim is made.
- **Descriptive detector counts (primary 120, usable only, no inference):** `none` 9/28,
  `memory` 0/27, `manual` 0/26, `corrected` 10/30; high-opportunity subset `none` 6/16,
  `memory` 0/16, `manual` 0/15, `corrected` 5/18.
- The pilot ran 46 % slower than the qualification projection because of the server's intermittent
  mid-stream stalls; this is reported, not hidden, and strengthens the case against using the Dell
  single slot for the 4,800-run confirmatory pass.

The pilot exists to find exactly these defects. No pilot-derived effect size is used to choose a
design parameter; the only pre-declared exception is the H2-margin fallback rule in
`04b-ANALYSIS-PLAN-REV2.md` §4.8.

| ID | Defect | Evidence | Fix / required change | Applied? |
|---|---|---|---|---|
| **D-P1** | **The endpoint is not seed-deterministic at temperature 0.7.** Same prompt + same seed produced 5,861 vs 4,327 completion tokens; temperature 0 is byte-reproducible. The protocol's "same-seed determinism repeats" therefore cannot demonstrate determinism. | `07-ENDPOINT-QUALIFICATION.md` §2.2, micro-probes + full-file q01/q04 | Relabel the 12 repeats as **repeatability/variability probes**; do not use output hashes as determinism evidence. If a determinism check is wanted, it must be a separate temperature-0 probe, not part of the sampling design. | Relabel applied in the pilot analysis; **protocol rewrite required at freeze** |
| **D-P2** | **Node `fetch` 300 s body timeout killed valid generations.** First two pilot attempts aborted at 301.0 s / 306.0 s with `"fetch failed"`; the Dell engine sends no bytes until a full-file generation completes (~4–5 min). | `pilot/aborted-transport-defect/`, `_internal/PILOT-LOG.md` | Runner transport switched away from global `fetch`; per-request safety timeout 900 s. | **Fixed** (curl transport; verified with a real execution) |
| **D-P3** | **Post-restart LAN reachability quirk.** Raw TCP from Node/Python failed with `EHOSTUNREACH` while the system `curl` binary connected; caused preflight refusal after a harness restart. | `_internal/PILOT-LOG.md`, reproduced by direct socket vs curl probes | Use the system `curl` binary as the HTTP transport (with a `node:http` fallback); record the environment quirk in provenance. | **Fixed** (curl transport) |
| **D-P4** | **Client abort ≠ server abort.** Killing a client mid-generation leaves the engine generating the orphaned request; the next request queues behind it. A "hung" request was in fact queued for ~5 min. | `_internal/PILOT-LOG.md`; verbose curl then completed normally (5 m 28.4 s, 200) | Supervisor waits for `/slots` `is_processing == false` before launching; never kill a running client to "free" the endpoint. Confirmatory harness must adopt the same rule. | **Process fixed** (supervisor idle-wait) |
| **D-P5** | **Prompt is not byte-identical to Phase 17's Open path.** Production `buildForgePrompt` changed after Phase 17 (structured `memories`, `<project_constraints>`); the old `memoryBlock` argument no longer exists. | `07-ENDPOINT-QUALIFICATION.md` §2, runner provenance | Use current production (correct for a new study) but pin the production prompt version at freeze and state the comparability limit; do not claim prompt-level identity with Phase 17. | **Documented**; protocol rewrite required |
| **D-P6** | **Corpus rows lack an explicit `template_id`.** `corpus.json` has `variant_id`; the twin/template map is in `design-v2.json`. | `04b` cross-check note | Add `template_id` (and `twin_id`) to every corpus row before freeze, or freeze the join explicitly in the manifest. | **Pending** (pre-freeze) |
| **D-P7** | **Corpus raw-text diversity is limited.** Variants share a family engine/design system; token Jaccard ≈0.97 within family; ~1.3–2.0 % of lines differ. Structural (DOM/layout/HUD/feedback) diversity is real; app-level diversity is not. | `08-CORPUS-DIVERSITY.md` §4–5 | Report as a generalisation limit in the confirmatory report; if more diversity is wanted, expand template engines before freeze (corpus change ⇒ re-validate + re-freeze; no effect on the current pilot because the pilot is excluded). | **Documented**; decision for review |
| **D-P9** | **Non-streaming long generations can lose the connection.** One execution failed with `curl: (56) Recv failure: Operation timed out` after 780.3 s + 660.3 s: the server generated a very long full-file output and the idle connection was dropped before the single JSON response. | `pilot/aborted-transport-defect-2/`, `_internal/PILOT-LOG.md` | Use SSE streaming for generation (`stream: true`), which the endpoint keeps alive with `: keep-alive` every ~10 s; reconstruct content from deltas; keep the raw SSE per attempt. Timeout is a safety bound (1800 s). | **Fixed** (streaming transport verified end-to-end); protocol/harness note required |
| **D-P8** | **Pilot has no independent human validation.** Opportunity labels, hooks and paraphrase intent are author-generated/mechanical. | `08-CORPUS-DIVERSITY.md`, `09-SCORING.md` | Two blinded coders + κ on a stratified sample before the confirmatory freeze (user resource decision); until then no human-validation claim. | **Not possible in the agent team; blocker for freeze** |

## Out of scope / deliberately unchanged

- Endpoint throughput (Dell single-slot ≈318 h for 4,800 full-file runs) is an environment fact, not
  a defect; the confirmatory endpoint decision is deferred.
- The corpus variants are deterministic template-engine apps, not byte-derived Phase 17 baselines;
  this is documented as a comparability limit rather than changed mid-pilot.
- The pilot's use of pilot-only `p00` paraphrases keeps pilot prompts disjoint from the corpus;
  no pilot output enters the confirmatory dataset.

| — | **Endpoint shutdown mid-pilot (user action)** | One in-flight execution lost; its connection failures were recorded as an unusable run, counted, replaced under the pilot-only rule. All previously completed records survived; resume skipped nothing. | `_internal/PILOT-LOG.md`, pilot record list | **Handled** |
| — | **Replacement executions (user-approved)** | 9/9 replacements succeeded; originals retained; reported separately; never used in confirmatory data. | `pilot/replacements/`, `10-CHECKPOINT2-REPORT.md` §7.2 | **Done** |
