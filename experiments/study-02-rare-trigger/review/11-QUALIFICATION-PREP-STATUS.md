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
| D-01 | Credential | **SATISFIED by confirmed environment.** Reuse the **existing hackathon key** stored in the Pi provider configuration (`providers.baseten-muse.apiKey`). No dedicated replacement key is available or required; the offline loader reads it in memory and records only the fingerprint `700791232a0c87b1`. No purchase/rotation step. |
| D-02 | Model identity and limits | **RESOLVED as configured identity.** Authorized model is the already-configured `baseten-muse` → **`meta-models/muse-spark-open-1026`** (context 1,048,576; output 32,768; costs 1.25/4.25/0.15; Pi 1.4.0). No public snapshot/revision guarantee exists; recorded as a **reproducibility limitation** (identity treated as endpoint metadata observed per request). No config change. Offline check: `review/13`, `design/provider-config-pin.json`. |
| D-03 | 32-request qualification, max $6 | **Approved conditionally; NOT EXECUTED.** Plan in `review/03`; cap now enforceable by `scripts/study02/cost_cap.mjs` (admission before dispatch; actual + reservation; hard stop). |
| D-04 | Qualification isolation | **Ready.** `qualification-baseten/` contains only its README; all qualification artefacts will be excluded from pilot/confirmatory data. |
| D-05 | Human validation | **REVISED to single reviewer.** Only the project author is available. The two-coder/κ plan is superseded by `review/12-SINGLE-REVIEWER-VALIDATION.md`: author-as-reviewer, prioritised checks (P1 opportunity labels/hooks + paraphrase intent; P2 exposure panel/census), randomised/blinded presentation where feasible, no independence/inter-rater claims. Materials generated under `human-validation/single-reviewer/` (254 priority items, ≈12 h). **No human coding has occurred.** |
| D-06 | Exposure validation gate | **Approved; protocol in place.** PASS/CONDITIONAL/FAIL gate and the AI-not-human labelling rule are in `review/04` and protocol §8.4. |
| D-07 | Statistical corrections | **Done.** T6 family-block H2 bootstrap and T8 unified margin fallback applied (`04b` corrected 2026-11-01; transcript SHA-256 `39b7ec54…`). |
| D-08 | Missingness and stopping | **Approved; written into protocol.** ≤2 attempts, no replacements, 20 % hard ceiling/15 % warning, co-primary worst-case/ITT, technical halt. |
| D-09 | Confirmatory endpoint | **Deferred.** Decision only after qualification against pre-registered feasibility/validity gates. |
| D-10 | Sampling and repeatability | **Documented limitation.** The provider does not guarantee deterministic output at seed/temperature 0; repeats are repeatability measurements only. Qualification logs requested/returned model identity and available metadata; no determinism assumption is made. |
| D-11 | Confirmatory expenditure | **NOT APPROVED.** Revisit after qualification with measured token/cost data. |
| D-12 | Corpus diversity | **Reviewed; decision recorded.** `review/08`: **ACCEPT** the current corpus for the primary claims, scoped, no expansion before freeze; conditions C1–C12 and expansion triggers X1–X5/E1–E3 recorded. |
| D-13 | Freeze mechanics | **Approved in principle; not executed.** Requires all gates first (credential/identity, qualification report, human validation). |
| D-14 | Exact prompt provenance | **DONE (offline, tested).** `scripts/study02/prompt_provenance.mjs` + runner integration + `test_prompt_provenance.mjs`; freeze-once prompts/meta/manifest, load-only execution, tamper/missing refusal; end-to-end dry-run test with 132 prompts (byte-identical reload, tamper refusal). |

## 1b. Confirmed hackathon environment (offline checks complete)

- **Exact configured endpoint:** Pi provider `baseten-muse`, base URL `https://inference.baseten.co/v1`,
  API `openai-completions`; **model `meta-models/muse-spark-open-1026`** ("Muse Spark Open 1026"),
  context **1,048,576**, max output **32,768**, configured costs **1.25 / 4.25 / 0.15** USD per 1M
  tokens. Pi version **1.4.0**. Pi's default provider (`strata`) is not used and was not changed.
- **Credential:** existing hackathon key in the Pi provider configuration; loaded in memory only;
  recorded by source and non-reversible fingerprint `700791232a0c87b1`; never printed or committed.
- **Credits:** supplied for hackathon use; no purchase/account-creation blocker.
- **Version limitation:** no snapshot/revision/system-fingerprint guarantee is available locally or
  publicly; recorded as a reproducibility limitation and treated as per-request endpoint metadata.
- **Offline verification:** [design/provider-config-pin.json](design/provider-config-pin.json);
  `provider_config.mjs`, `test_provider_config.mjs`, `pin_provider_config.mjs`; all tests pass, and
  the public snapshot provably excludes the credential. See
  [review/13-CONFIRMED-ENVIRONMENT-AND-QUALIFICATION-AMENDMENT.md](review/13-CONFIRMED-ENVIRONMENT-AND-QUALIFICATION-AMENDMENT.md).

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
| 3 | Prepare human-validation materials; identify reviewers | **REVISED AND READY.** Single-reviewer plan (`review/12`) and materials (`human-validation/single-reviewer/`, 254 priority items, ≈12 h) generated; no second coder required. Director reviews the plan and analysis changes before freeze. |
| 4 | Verify Baseten identity/billing/limits | **DONE OFFLINE** — configured identity/limits/costs verified from Pi; key present (fingerprint only); version limitation documented. Runtime measurements occur during qualification. |
| 5 | Execute 32-request qualification within $6 | **READY — awaiting final execution authorization.** No credential/billing blocker remains. |
| 6 | Qualification report → separate freeze authorization | **FUTURE** |

## 4. Blockers and what is needed from the Director

1. **Final qualification execution authorization (the only execution gate):** approve the bounded
   **32-request** run against the configured `baseten-muse` / `meta-models/muse-spark-open-1026`,
   using the existing hackathon key and supplied credits, within the usage ceiling (248,500 input /
   937,280 output tokens) and **$6.00 hard cap**. No purchase, new account, dedicated key or config
   change is required.
2. **Human validation:** the project author is the only reviewer; no second coder/adjudicator will be
   required. Approve the revised single-reviewer plan (`review/12`) and its proposed analysis
   changes, including the pre-declared exposure-analysis demotion/removal rule if validation is
   inadequate.
3. **Confirmatory / freeze:** not requested here; both remain separately gated after the
   qualification report, billing reconciliation and human check.

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
| Confirmed provider configuration (key-free pin) | `design/provider-config-pin.json` | Verified offline |
| Confirmed-environment amendment | `review/13-CONFIRMED-ENVIRONMENT-AND-QUALIFICATION-AMENDMENT.md` | Complete |
| Single-reviewer validation plan + materials | `review/12-SINGLE-REVIEWER-VALIDATION.md`, `human-validation/single-reviewer/` | Plan ready; no coding |
| Qualification outputs | `qualification-baseten/` | **Empty by design** |
| Confirmatory data | — | **Does not exist** |

No Phase 15B/17 locked artefact, frozen submission, pilot record or product integration branch was
modified. `dc104b9` remains the immutable review-gate snapshot; this preparation is committed on
`study02/qual-prep` with `MANIFEST-qualification-prep.sha256` (the prior `MANIFEST-freeze-prep.sha256`
and `MANIFEST-checkpoint2.sha256` remain historical records for their respective commits).
