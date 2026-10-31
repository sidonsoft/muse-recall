# 11 — Qualification-preparation status (post-Director decision)

**Status:** offline preparation for the conditionally authorized Baseten qualification. **No
qualification request was sent, no paid call was made, no confirmatory run was started, no
preregistration was frozen and no freeze tag exists.** The Director's review-gate commit `dc104b9`
and the Dell pilot are preserved immutable; this work is on branch `study02/qual-prep`.

**Director decision:** CONDITIONAL GO for Baseten qualification (≤ **$6 USD**, conditional on
verified credential/billing/limits); **NO-GO** for confirmatory execution / preregistration freeze /
freeze tag. Endpoint qualification is the next milestone; effect estimates are not.

---

## 1. Decision register — current compliance

| ID | Decision | Status after this preparation round |
|---|---|---|
| D-01 | Dedicated Baseten credential | **Approved; NOT YET ISSUED.** `$S02_BASETEN_API_KEY` and `$BASETEN_API_KEY` are unset. Provisioning checklist in `review/09` §1 (inference-only team key, named owner/revoker, env-only, redaction, revocation). |
| D-02 | Model identity and limits | **Procedure ready, not executed.** `review/09` §2 gives the exact read-only verification steps (slug, context/output limits, account rate/quota, billing); the dated `-1026` slug remains **not public**, and no version metadata is documented. Blocked on credential + provider confirmation. |
| D-03 | 32-request qualification, max $6 | **Approved conditionally; NOT EXECUTED.** Plan in `review/03`; cap now enforceable by `scripts/study02/cost_cap.mjs` (admission before dispatch; actual + reservation; hard stop). |
| D-04 | Qualification isolation | **Ready.** `qualification-baseten/` contains only its README; all qualification artefacts will be excluded from pilot/confirmatory data. |
| D-05 | Human validation | **REQUIRED — materials complete, staffing open.** `human-validation/` now contains the full package (111-run census, 200-case seeded panel incl. 30 same-class blind-spot probes, 60 variants, 18 paraphrase texts, blind sheets, coding guide, adjudication forms, independence attestation, deterministic generator + κ/gate analysis with self-test). **Two independent coders + adjudicator have NOT been identified; no human coding has occurred.** |
| D-06 | Exposure validation gate | **Approved; protocol in place.** PASS/CONDITIONAL/FAIL gate and the AI-not-human labelling rule are in `review/04` and protocol §8.4. |
| D-07 | Statistical corrections | **Done.** T6 family-block H2 bootstrap and T8 unified margin fallback applied (`04b` corrected 2026-11-01; transcript SHA-256 `39b7ec54…`). |
| D-08 | Missingness and stopping | **Approved; written into protocol.** ≤2 attempts, no replacements, 20 % hard ceiling/15 % warning, co-primary worst-case/ITT, technical halt. |
| D-09 | Confirmatory endpoint | **Deferred.** Decision only after qualification against pre-registered feasibility/validity gates. |
| D-10 | Sampling and repeatability | **Conditional, unresolved until D-02.** Provider does not guarantee determinism at seed/temperature; actual supported controls and repeat meaning must be documented after contract verification. |
| D-11 | Confirmatory expenditure | **NOT APPROVED.** Revisit after qualification with measured token/cost data. |
| D-12 | Corpus diversity | **Reviewed; decision recorded.** `review/08`: **ACCEPT** the current corpus for the primary claims, scoped, no expansion before freeze; conditions C1–C12 and expansion triggers X1–X5/E1–E3 recorded. |
| D-13 | Freeze mechanics | **Approved in principle; not executed.** Requires all gates first (credential/identity, qualification report, human validation). |
| D-14 | Exact prompt provenance | **DONE (offline, tested).** `scripts/study02/prompt_provenance.mjs` + runner integration + `test_prompt_provenance.mjs`; freeze-once prompts/meta/manifest, load-only execution, tamper/missing refusal; end-to-end dry-run test with 132 prompts (byte-identical reload, tamper refusal). |

## 2. Director's three additional requirements

1. **Cost-accounting/cap enforcement — done as tooling.** The $6 cap is enforced **before dispatch**
   by `spent_actual + reserved_outstanding + reservation ≤ 6,000,000 µUSD`; reservations use
   conservative prompt-token upper bounds and `max_tokens`; actual usage settles each request; missing
   usage charges the reservation; actual > reservation triggers a hard stop; the ledger is persisted
   and recovered conservatively. Worst-case plan arithmetic: **$4.294065** at the plan token
   ceilings (headroom $1.705935, ≈11 full-cap retries); a more conservative uniform reservation gives
   $4.672 (headroom $1.328, ≈9 retries). Expected spend ≈$2.25. Tests: `test_cost_cap.mjs` all pass.
   Execution-day reconciliation against provider billing is specified in `review/09` §4.7 (PENDING on
   billing lag; discrepancy blocks the confirmatory decision).
2. **Endpoint identity as a scientific variable — adopted.** Qualification gates are
   feasibility/validity-only (contract verified, slug/version/limits pinned, completeness, scoring
   compatibility, truncation, reliability, rate-limit/cost feasibility); **no effect-based endpoint
   selection**. Per-request logging of requested/returned model, request ID, usage, timing,
   finish_reason and any version metadata is required; a provider model/version change mid-run halts
   and reports rather than substituting silently (`review/09` §3).
3. **Human-validation independence — enforced in design, staffing open.** The protocol requires two
   independent human coders + adjudicator, blinding, κ/agreement with CIs, adjudication and an
   independence attestation; **AI review may triage but is never a coder/adjudicator and is never
   labelled human validation**. If qualified humans cannot be secured, the only compliant path is to
   remove/demote every exposure-conditioned analysis and claim before freeze.

## 3. Immediate execution order — status

| # | Director item | Status |
|---|---|---|
| 1 | Implement/test D-14 prompt provenance offline | **DONE** — `review/10`, module/tests, end-to-end dry-run verification |
| 2 | Complete corpus-diversity review; record accept/expand | **DONE** — `review/08`: ACCEPT, no expansion before freeze, conditions C1–C12 |
| 3 | Prepare human-validation materials; identify reviewers | **MATERIALS DONE; reviewers NOT identified.** `human-validation/` package is complete and reproducible (`--check` 399/399; gate analysis `--self-test` passes). Director must nominate 2 coders + adjudicator (`human-validation/REVIEWER_NOMINATION_REQUEST.md`), or approve removal/demotion of exposure analyses. |
| 4 | Verify Baseten identity/billing/limits | **PROCEDURE READY, NOT EXECUTED** — `review/09`; blocked on D-01 credential and billing access |
| 5 | Execute 32-request qualification within $6 | **BLOCKED** — no credential, no billing/limits verification, no spend-authorisation reference |
| 6 | Qualification report → separate freeze authorization | **FUTURE** |

## 4. Blockers and what is needed from the Director

1. **Issue the credential (D-01):** a dedicated inference-only **team** key ("Call Model APIs") for
   Study 02, named owner and revoker; provided only via `S02_BASETEN_API_KEY` in the environment
   (never committed/logged; do not reuse the historical `~/.zshrc` key).
2. **Authorize billing/limits reads** (`GET /v1/model_apis`, `GET /v1/billing/model_apis`) and provide
   the **account rate card** (or confirm public pricing applies); confirm payment/credits sufficient
   for ≤$6 so D-02 can be completed and the ledger uses verified rates.
3. **Confirm model identity (D-02):** written confirmation that the approved slug resolves to a
   **fixed dated snapshot** (or approve the public alias with a written stability statement); confirm
   context/output limits.
4. **Confirm account limits:** the 4-in-flight repeat block requires **TOKEN/MINUTE ≥ 200,000** and
   **CONCURRENT_REQUEST ≥ 4** (`review/09` §2). 100k–200k TPM ⇒ 2-in-flight only with approval;
   <100k ⇒ NO-GO.
5. **Spend-authorisation reference for the $6 hard cap** (cost centre/decision ID), and decide whether
   to enable provider-side **Enforce budget** (workspace-wide month-to-date + $6; conservative) or rely
   on the local ledger plus notification.
6. **Human-validation staffing (D-05):** nominate two independent coders + adjudicator; otherwise
   approve removal/demotion of exposure analyses before freeze.
7. **No confirmatory authorization yet:** D-11/D-13 remain blocked until the qualification report is
   reviewed, billing reconciliation passes, and the human-validation gate passes. If the account rate
   card makes the 32-request worst case exceed $6, qualification is **NO-GO** unless the plan is
   reduced or the cap changed by the Director.

## 4b. Documentation corrections applied this round

- **Paraphrase-count arithmetic corrected.** Earlier documents said "26 corpus + 4 pilot-only"
  paraphrases; the as-built `corpus/paraphrases.json` has **14 corpus (arcade 3, challenge 3, reward 4,
  lively 4) + 4 pilot-only = 18**. Corrected in `02-PROTOCOL-DRAFT.md` §8.4, `review/04` §3.1/§5,
  `review/05` §3, `review/00`, `review/08`, `08-CORPUS-DIVERSITY.md`, `10-CHECKPOINT2-REPORT.md`, and
  the `gen_corpus.py` / human-validation generator notes. The human-validation package codes all 18
  actual texts; the package records the correction.
- **Corpus regenerated after the generator docstring correction.** Variant HTML files remained
  **byte-identical** (60/60, sorted-set SHA-256 `caccfcc6…` unchanged); `gen_corpus.py --check` now
  reproduces all 68 files; `design/design-v2.json` `corpus_construction.generator_sha256` updated to
  `4b10e09f…`. This is a documentation/self-hash change only, not a corpus-content change.
- **Human-validation package regenerated** to hash the corrected text and regenerated corpus inputs;
  `--check` reports 399/399 artifacts byte-identical; analysis self-test passes.
- No pilot record, pilot analysis, checkpoint-2 manifest, locked Phase 15B/17 artefact, or product
  integration branch was modified.

- **Blinding/sealing.** The package contains a hidden-truth file (`panel-truth.json`), a sealed
  case mapping (`reference/case-map.json`) and the sampling manifest (which carries arms/records).
  Do **not** distribute the repository or the whole package to coders. Give coders only the
  coder-facing subset (`CODING_GUIDE.md`, `sheets/coder-A.csv` or `coder-B.csv`, the neutral case files
  they are assigned, `paraphrase-texts.md` where applicable); the Lead/analyst keeps truth, mapping and
  sheets sealed until both coders have submitted. No AI may fill any coding field.

## 5. Evidence index

| Artefact | Path | Status |
|---|---|---|
| Freeze-readiness report (review gate) | `review/00-FREEZE-READINESS-REPORT.md` | Complete; `dc104b9` preserved |
| Pilot accounting / inclusion table / errata | `review/01`, `review/pilot-inclusion-table.json`, `review/07` | Complete |
| Baseten contract | `review/02-BASETEN-CONTRACT.md` | Complete (model deployment partly unverified) |
| Qualification plan | `review/03-QUALIFICATION-PLAN.md` | Complete; not executed |
| Human-validation protocol + materials | `review/04`, `human-validation/` | Protocol complete; materials in progress; **no human coding has occurred** |
| Design/statistical review | `review/05`, `04b` corrected | Complete |
| Offline fixes + prompt pin | `review/06`, `design/prompt-builder-pin.json` | Complete |
| Corpus coverage review | `review/08-CORPUS-COVERAGE-REVIEW.md` | Complete: ACCEPT (scoped) |
| Baseten verification + cost control | `review/09` | Complete (procedure/cap design) |
| Prompt provenance + cost-cap implementation | `review/10`, `scripts/study02/prompt_provenance.mjs`, `scripts/study02/cost_cap.mjs`, tests | Complete and tested offline |
| Human-validation materials | `human-validation/` (404 files), `scripts/study02/build_human_validation_package.py`, `scripts/study02/analyze_human_validation.py` | Materials complete/reproducible; **no human coding**; reviewers to be nominated |
| Qualification-prep manifest | `MANIFEST-qualification-prep.sha256` | Generated with this work (see below) |
| Qualification outputs | `qualification-baseten/` | **Empty by design** |
| Confirmatory data | — | **Does not exist** |

No Phase 15B/17 locked artefact, frozen submission, pilot record or product integration branch was
modified. `dc104b9` remains the immutable review-gate snapshot; this preparation is committed on
`study02/qual-prep` with `MANIFEST-qualification-prep.sha256` (the prior `MANIFEST-freeze-prep.sha256`
and `MANIFEST-checkpoint2.sha256` remain historical records for their respective commits).
