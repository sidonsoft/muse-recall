# Qualification-preparation brief (post-Director decision) — internal

**Decision context:** Director's freeze-readiness decision = **CONDITIONAL GO for Baseten
qualification, NO-GO for confirmatory execution / preregistration freeze / freeze tag.** Baseten
qualification is authorized up to **$6 USD**, conditional on verified credentials, billing and
account limits. Preserve `dc104b9` and the Dell pilot as immutable evidence; stay off the product
integration branch.

**Immediate order (Director):**
1. Implement and test **D-14 prompt-provenance capture** entirely offline.
2. Complete the **corpus-diversity review** and record the accept/expand decision.
3. Prepare **human-validation materials** and identify reviewers.
4. Verify **Baseten model identity, billing and account limits** (offline procedure; no credential
   present, so no API call).
5. Execute the **32-request qualification** only once credentials and spending authorization are
   available (not now).
6. Qualification report; then return for separate freeze authorization.

**Additional requirements:** enforce the $6 cap with **actual usage + reservation for outstanding
requests** (not post-hoc estimation); treat endpoint identity as a scientific variable (feasibility
only, never effect-based selection); human validation must be genuinely human — AI review must not
be labelled/substituted as human coding.

**Evidence separation stays:** exploratory Dell (`pilot/`) ⇄ qualification (`qualification-baseten/`)
⇄ confirmatory (does not exist). Nothing is pooled.

## Work split (this round)

| Owner | Deliverables |
|---|---|
| Lead | D-14 frozen-prompt provenance implementation + offline tests (`scripts/study02/prompt_provenance.mjs`, integration in `runner.mjs`/`run_pilot.mjs`, `review/10-PROMPT-PROVENANCE.md`); $6 cost-cap enforcement module + tests; Director-decision compliance/status report; commit/push on `study02/qual-prep` |
| design-reviewer | Human-validation materials package under `human-validation/`: sampling manifest (111 census + 200 seeded panel + 60 variants + 30 paraphrases), coding guide, coding sheets, adjudication log, independence attestation, reviewer-nomination pack, deterministic package generator + agreement/gate analysis script; `human-validation/README.md` |
| protocol-architect | `review/08-CORPUS-COVERAGE-REVIEW.md`: coverage assessment + explicit **ACCEPT vs EXPAND** decision and conditions, with template/paraphrase/feature/matching analysis |
| baseten-reviewer | `review/09-BASETEN-VERIFICATION-AND-COST-CONTROL.md`: D-02 verification procedure (slug/version/limits/account/billing checks; exact commands; dry-run first), qualification cost-control design (reservation ledger, hard stop, reconciliation), credential provisioning checklist |

## Constraints

- No paid call, no qualification execution, no confirmatory run, no freeze/tag.
- Never print/read/commit credentials. Historical credential path may be recorded (path/mode only),
  never reused.
- Do not modify `pilot/`, `MANIFEST-checkpoint2.sha256`, `dc104b9`, locked Phase 15B/17 artefacts, or
  the frozen submission.
- All new work in new commits on `study02/qual-prep`; recompute a qualification-prep manifest at the
  end (dc104b9 remains the review-gate snapshot).
