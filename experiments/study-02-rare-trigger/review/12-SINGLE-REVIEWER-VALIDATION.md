# 12 — Single-reviewer validation plan (author reviewer; no independence claims)

**Status: revised human-validation plan for Director review — not executed, not a freeze, no human coding
has occurred.** This supersedes the two-independent-coder requirement in `review/04` and the
corresponding protocol text for execution purposes. The previously generated two-coder materials are
**preserved as reference** but will not be used to support claims. Branch `study02/qual-prep`.

## 1. Confirmed constraint

The project author is the only available human reviewer. Therefore:

- There will be **one reviewer, not two**, and **no third adjudicator**.
- The reviewer is **not independent**: the author designed the study/corpus/protocol and has seen pilot
  summaries and automated detector counts. This is recorded as a disclosed limitation, not hidden.
- **No claim of independent validation and no inter-rater reliability statistic** may be produced
  (κ requires two coders). The result is labelled **single-reviewer, non-independent internal
  validation**.
- AI review/triage is never a substitute for the human review and is never counted as coding.

## 2. Priorities (what the single reviewer checks first)

Priority is driven by what the primary confirmatory claims depend on. The primary CVR denominator is
the **pre-treatment opportunity class** (`high`/`low`) and its hooks, not the measured-exposure
instrument. The exposure instrument only supports secondary, descriptive analyses.

| Priority | Task | Sample | Why | Est. time |
|---|---|---|---:|---:|
| **P1** | **Opportunity labels/hooks** for the 60 neutral variants: H/L class, declared hook plausibility, rule-relevant affordance presence | **all 60 variants** | Primary CVR denominator; if these labels are wrong the primary contrast is not interpretable | 60 × 3 min ≈ **3.0 h** |
| **P1** | **Paraphrase intent** fidelity/target (arcade/challenge/reward/lively; H-vs-L matching) | **all 18 texts** (14 corpus + 4 pilot-only) | Scenario identity and arm-invariance of the request | 18 × 4 min ≈ **1.2 h** |
| **P2** | **Exposure instrument panel** — known-truth diagnostic: all 70 core positives, all 30 same-class blind-spot probes, 40 seeded near-miss negatives | **140 cases** | Sensitivity/specificity of the secondary exposure instrument; identifies structural blind spots | 140 × 1.5 min ≈ **3.5 h** |
| **P2** | **Census sample** of real pilot runs for instrument-vs-reviewer agreement (neutral copies): 6 runs per stratum, balanced across arms/opportunity classes where possible | **36 runs** | Real-output agreement, disagreement log; supports whether exposure analyses can be reported descriptively | 36 × 3 min ≈ **1.8 h** |
| — | Orientation, blinding setup, logging, disagreement review | — | — | ≈ **2.5 h** |
| **Total P1+P2** | | **254 coding items** | Practical single-reviewer workload | **≈ 12–13 h** (2–3 sessions) |
| P3 (optional, not required) | Remaining 60 panel negatives and remaining 75 census runs | **135 items** | Improves precision only; not needed for the gate decision | ≈ 5 h |

The prior two-coder package expected ~24–30 h **per coder** (≈55–65 person-hours). The single-reviewer
procedure cuts the scope to **≈254 priority items / ≈12–13 h**, concentrating on the claims that
matter.

## 3. Blinding, randomisation and prior exposure

1. **Neutral presentation.** Case ids are neutral (`hv-*`), the coding sheet contains no arm, run,
   scenario, variant, class, truth or detector columns. Pilot outputs are byte-identical neutral
   copies; panel cases contain only BASELINE/OUTPUT HTML.
2. **Randomised order** with a fixed seed, so the reviewer cannot infer conditions from sequence.
3. **Conceal treatment labels and automated verdicts.** The reviewer codes without seeing arm labels,
   opportunity class, frozen labels, panel truth, detector verdicts, or instrument outputs. The
   instrument verdict/disagreement table is joined **only after** the coding sheet is complete and its
   hash recorded.
4. **Prior-exposure disclosure.** Before coding, the reviewer records: date/time, what they designed,
   which pilot/detector summaries they have seen, any expectations, and confirms they have not opened
   the hidden truth/mapping during coding. Expectations are not edited after the fact.
5. **No post-hoc editing** of a completed sheet; any later change is a dated errata row.
6. **Sealing.** The Lead/analyst keeps `panel-truth.json`, `reference/case-map.json`, the sampling
   manifest (contains arms/records) and the instrument verdict join sealed until submission; only the
   coder-facing single-reviewer files are given to the author.

## 4. Coding record and disagreements

- Coding sheet fields: `case_id, task, construct_family, present_0_1, confidence_1_5, notes, minutes`.
  One row per assigned case; no truth/arm/verdict fields.
- **Disagreement log** (completed in the analysis phase, not during blind coding): case id, reviewer
  verdict, automated instrument verdict, whether they agree, reviewer's decision
  (accept instrument / prefer own coding / cannot decide), rationale, date. Recorded even when the
  author changes their mind after unblinding.
- **Adjudication** is by the author alone and is labelled "author adjudication", not independent
  adjudication. Every disagreement is retained; no silent deletion.

## 5. Analysis changes (proposed, for review before freeze)

Replaces the two-coder κ/agreement analysis:

| Analysis | Single-reviewer version |
|---|---|
| Inter-coder agreement (A1, A5) | **Not computed — requires two coders.** Removed. |
| Instrument vs reviewer agreement | Percent agreement overall and per construct family, with scenario-cluster bootstrap CIs; explicitly labelled single-reviewer, non-independent |
| Panel validity | Sensitivity on the 70 core positives (+ separately on the 30 same-class blind-spot probes) and specificity on the 100 negatives; Wilson CIs; document that the panel is AI-constructed known-truth, not human ground truth |
| Variant labels/hooks (P1) | Agreement between reviewer's independent coding and the frozen labels/hooks; disagreement table; no κ claim |
| Paraphrase intent (P1) | Reviewer-confirmed intent/target preservation; list conflicts |
| Disagreement handling | All records retained; author decisions reported descriptively |
| Blinding integrity | Recorded prior exposure, sheet hash/timestamp, order seed; note that perfect blinding is impossible for the author |

**Pre-declared single-reviewer gate (proposed):**

- **P1 opportunity labels:** ≥ **80 %** agreement on `opportunity_class` and no systematic mislabeling
  of H/L twins; hook plausibility ≥80 %. If below: revise labels with a documented mapping **before
  freeze**, or restrict the primary analysis to the subset of scenarios whose labels are concurred
  (pre-declared rule), and report the restriction.
- **P2 exposure instrument:** panel sensitivity ≥ **0.80** and specificity ≥ **0.80**, with real-run
  agreement reported. If below: exposure-conditioned analyses become **exploratory or removed**;
  no "validated instrument" language is used.
- Because the reviewer is the author, even a PASS is labelled **"single-reviewer internal check
  (non-independent)"**, never "independent validation".

## 6. Claims implications

- **Primary H1/H2/H3** depend on the frozen detectors plus the **opportunity labels/hooks**, not on the
  measured-exposure instrument. P1 therefore gates the primary interpretation; P2 does not.
- If **P1 fails**: do not freeze the primary as designed. Options (pre-declared): revise labels with a
  recorded mapping and re-run the label check; or restrict primary to concurred scenarios and report
  the restriction; or demote opportunity-class-specific claims. No outcome-dependent choice.
- If **P2 fails** (the likely risk given the pilot's 15–53 % detection and arm sensitivity), the
  following become exploratory or are removed: exposure rate per arm × stratum; exposure stability
  across repetitions; measured-exposure CVR; any arm contrast in exposure; the matched H-vs-L
  **exposure** contrast; and any sentence claiming high-opportunity scenarios were "actually engaged".
- If **P2 passes**, those analyses may be reported only as **single-reviewer-checked descriptive**
  quantities, with the non-independence limitation; they never become confirmatory claims.
- **Unchanged primary claims**: H1/H2/H3 (detector-based CVR in the pre-treatment high-opportunity
  class), H2 margin/inference, exclusions/stopping. The primary does **not** become "validated by the
  author"; it keeps its detector/label basis and its pre-registered analysis.

## 7. Workload and outputs

| Session | Content | Time |
|---|---|---:|
| 1 | Orientation, disclosure, P1 variants (first 30) + 9 paraphrases | ≈3.5 h |
| 2 | P1 variants (remaining 30) + paraphrases (remaining 9) + begin P2 panel | ≈3.5 h |
| 3 | P2 panel (remaining) + 36 census runs | ≈3.5 h |
| 4 | Unblinding, disagreement log, author adjudication, record completion | ≈2.0 h |
| **Total** | | **≈12.5 h** (plus ~5 h optional P3) |

Deliverables generated by this revision (offline, no coding performed by AI):
`human-validation/single-reviewer/` — instructions, randomised assignment, empty single sheet,
disagreement-log template, workload manifest. Existing two-coder materials remain in place as
reference and are marked superseded for execution.

**Freeze condition:** this revised single-reviewer plan and its proposed analysis changes must be
approved before freeze; the human check must be completed (or the exposure analyses demoted/removed)
before the preregistration is frozen. No independence, inter-rater reliability, or "human validated"
claim will be made.
