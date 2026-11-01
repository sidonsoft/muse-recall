# Study 02 — human-validation materials package

**Status: MATERIALS ONLY. No human coding has occurred. Nothing in this package is a result.**
This package exists so the Director can identify and appoint two independent human coders plus a
third adjudicator. Until those people have coded the materials and the gate has been computed,
**no human-validation claim exists**, and no exposure-instrument or opportunity-label claim may be
described as validated.

> AI generation, AI review and AI-assisted analysis are **not human validation**. This package was
> built by an AI agent under human direction; every coding field is empty, every result field is
> absent, and no AI system may fill them. See `forms/INDEPENDENCE_ATTESTATION.md` §5
> (no-AI-substitution clause).

## 0a. Single-reviewer amendment (2026-11-01)

The confirmed environment provides only the **project author** as a human reviewer. The two-coder
package below is retained as reference but is **superseded for execution** by
`single-reviewer/` (see `review/12-SINGLE-REVIEWER-VALIDATION.md`): 254 priority items (60 variant
labels/hooks, 18 paraphrase texts, 140 panel cases, 36 census runs), randomised/blinded presentation,
prior-exposure disclosure, author disagreement log, no second coder, no adjudicator, no κ and **no
independence or human-validation claim**. If the single-reviewer check fails, exposure-conditioned
analyses are demoted/removed; the primary remains detector/opportunity-label based.

---

## 1. What this package is for

`review/04-HUMAN-VALIDATION-PROTOCOL.md` (the pre-declared protocol, cited below as **04**) requires
blinded human coding to decide whether two instruments may be used as measurements in the Study 02
confirmatory report:

| Target | What is validated | Where it is coded |
|---|---|---|
| **V1/V6 exposure** | Does the static trigger-zone exposure instrument measure "the edit entered the forbidden subsystem", and is the low / arm-sensitive pilot exposure rate an instrument defect or a real pattern? | `sheets/coder-A.csv`, `sheets/coder-B.csv` (panel cases `hv-p-*` + census runs `hv-r-*`) |
| **V4 opportunity labels** | Are the frozen `opportunity_class` labels and declared affordance hooks a valid pre-treatment construct? | `sheets/variant-labels.csv` (60 neutral variants) |
| **V5 paraphrase intent** | Do the frozen request paraphrases preserve the intended request? | `sheets/paraphrase-intent.csv` (18 texts) |

The instrument-gated claim set is exactly the **secondary descriptive layer**: exposure rates,
exposure stability, measured-exposure CVR, "opportunity uptake" interpretation, and any exposure arm
contrast. **No primary hypothesis (H1/H2/H3) depends on the exposure instrument** — the primary CVR
denominator is the pre-treatment `opportunity_class` label (`02-PROTOCOL-DRAFT.md` §7.2;
`04b-ANALYSIS-PLAN-REV2.md` §1.2). The label validation (V4) is the load-bearing check for the
primary denominator; the instrument validation (V1/V6) is the load-bearing check for the descriptive
layer.

**Number of reviewers required: 3.** Two independent coders (A and B) each complete all three
coding sheets; one independent adjudicator (C) resolves disagreements. A single coder cannot
validate an instrument: the protocol needs two independent judgements and a recorded resolution of
every disagreement.

---

## 2. Package contents

| Path | Role | Visible to coders? |
|---|---|---|
| `README.md` (this file) | workflow, roles, gate status | yes |
| `CODING_GUIDE.md` | construct definitions, edge rules, per-field instructions | yes |
| `sheets/coder-A.csv`, `sheets/coder-B.csv` | 311 rows each: 200 panel cases + 111 census runs | yes |
| `sheets/variant-labels.csv` (+ `variant-labels-coder-B.csv`) | 60 rows: baseline variants, blind to label/class; Coder A uses the canonical name, Coder B the `-coder-B` copy (identical rows) | yes |
| `sheets/paraphrase-intent.csv` (+ `paraphrase-intent-coder-B.csv`) + `sheets/paraphrase-texts.md` | 18 paraphrase texts in 4 neutral groups; per-coder copies as above | yes |
| `sheets/adjudication.csv` | empty template for the adjudicator | adjudicator only |
| `cases/panel/` | **200** seeded known-truth cases (`hv-p-001…200`), reduced-form excerpts (baseline + output in one file) | yes |
| `cases/real/` | **census of all 111 usable primary pilot runs** (`hv-r-001…111`), byte-identical copies under neutral ids | yes |
| `cases/real/INDEX.csv` | case → baseline case id, rule set, arm-invariant request text | yes |
| `cases/baselines/` | 15 pilot baseline variants under neutral ids | yes |
| `cases/variants/` | 60 corpus variants, neutral ids, declared-hook **marker comments stripped** | yes |
| `panel-truth.json` | **hidden planted truth** for the 200 panel cases | **NO** |
| `reference/case-map.json` | **hidden** case-id → run-id/arm/scenario/label map | **NO** |
| `sampling-manifest.json` | counts, generator + analysis-script hashes, every artifact hash, evidence status | Lead/analyst only — it contains the census frame with **arms** and the pilot record paths, so it must never be sent to a coder |
| `forms/INDEPENDENCE_ATTESTATION.md` | signed independence/conflict/no-AI declaration | yes |
| `forms/REVIEWER_PACK.md` | roles, criteria, blinding, workload, data protection | yes |
| `REVIEWER_NOMINATION_REQUEST.md` | one-page Director request | Director |

`panel-truth.json` and `reference/case-map.json` are kept at the package root precisely so they are
easy to withhold: **do not copy them into any coder packet, shared drive, chat or email.** The
analysis script is the only reader of both.

---

## 3. Counts and design (all generated offline, no model calls)

| Item | Count | Notes |
|---|---:|---|
| Census of usable primary pilot runs | **111** | all Dell pilot primary usable runs (`pilot/records`, `usable=true`, `seed_mode=primary`); the 12 repeat probes are excluded from coding and reported separately in the pilot record |
| Panel cases | **200** | 100 planted positives (70 complete/partial + **30 same-class replacement probes**, the cases the baseline-diff instrument structurally misses) + 100 near-miss negatives (90 true negatives + **10 documented false-positive probes**) |
| Corpus variants | **60** | 30 H twins / 30 L twins; hook-marker comments stripped from the coder copies; frozen label/hook/class relationship withheld |
| Paraphrase texts | **18** | 14 corpus texts + 4 pilot-only `p00` texts |
| Coder sheet rows each | **311** | 200 panel + 111 census |

**Paraphrase-count correction (2026-11-01).** Earlier documentation (`02-PROTOCOL-DRAFT.md` §8.4,
`review/04` §3.1, `08-CORPUS-DIVERSITY.md`, `10-CHECKPOINT2-REPORT.md`, and the `gen_corpus.py`
docstring) stated "26 corpus + 4 pilot-only paraphrase texts". The as-built data
(`corpus/paraphrases.json`, snapshot `corpus_total: 14`, `pilot_only_total: 4`) contain **14 corpus
+ 4 pilot-only = 18 texts** (arcade 3, challenge 3, reward 4, lively 4). The documents were corrected
on 2026-11-01; this package codes all **18 actual texts** and no text is missing. The manifest records
the correction under `known_documentation_discrepancy`.

**Determinism and integrity.** Every file here except the five authored documents is generated by
`scripts/study02/build_human_validation_package.py` (stdlib only, fixed seed label, no network, no
model calls) and is byte-reproducible: run the generator with `--check` to regenerate every
artifact in memory and require byte identity. `sampling-manifest.json` lists the SHA-256 of every
generated artifact, every source input, the generator and analysis scripts, and the five authored
documents; all manifest paths are relative to the repository root.

---

## 4. Workflow

1. **Appoint (Director).** Identify two coders (A, B) and one adjudicator (C) against
   `REVIEWER_NOMINATION_REQUEST.md` and `forms/REVIEWER_PACK.md`. At least one coder must be
   independent of the Study 02 authors. Each signs `forms/INDEPENDENCE_ATTESTATION.md`.
2. **Brief (Lead).** Send each coder a packet containing only: `README.md`, `CODING_GUIDE.md`,
   the three coder-facing sheets, `cases/`, `forms/`. Withhold `panel-truth.json`,
   `reference/case-map.json`, all pilot reports, all arm/summary tables, and this package's
   `sampling-manifest.json` if there is any risk of case-level inference. The Lead keeps the
   case-id map sealed until both sheets are returned.
3. **Calibrate (30–45 min).** Walk through the guide's illustrative examples (not panel cases) and
   the file layout. **No panel case is used for calibration**, so the full 200 remain untouched.
   Record attendance and the guide version hash.
4. **Code independently.** Each coder completes the three sheets alone, in a randomised mixed order
   (the sheets are already shuffled deterministically). No discussion between coders, no AI tools,
   no internet lookups, no pilot outputs other than the provided cases. Work in 60–90 minute blocks
   to limit fatigue; the `confidence_1_5` and `notes` fields are mandatory for any low-confidence call.
5. **Submit and freeze.** Coders send the completed CSVs to the Lead. The Lead computes SHA-256 of
   both sheets and records them **before** any comparison or analysis. Sheets are immutable after
   submission (a correction is an appended row with a reason, retained).
6. **Compare and adjudicate.** Run the analysis with `--emit-disputes <csv>`; it writes the list of
   every item where A and B disagree (or where either left "cannot tell"). The adjudicator codes only
   those items, blind to the other coders' values and to the arm, and fills `sheets/adjudication.csv`
   (`item_id, item_type, ...`). All disagreements and the adjudicator's values are retained and
   published in the validation report.
7. **Analyse and gate.** Run
   `python3 scripts/study02/analyze_human_validation.py` (see §6). It refuses to run on an unfilled
   package or a missing/duplicated/malformed sheet, computes A1–A11 with cluster-bootstrap/Wilson
   intervals and emits the pre-declared PASS / CONDITIONAL / FAIL verdict. The verdict is reported per
   target and overall. An unfilled package is refused outright: **panel sensitivity/specificity are
   instrument-vs-planted-truth diagnostics, never human validation**, so they are only reported inside
   a completed analysis.
8. **Report.** The Lead writes the validation report; a CONDITIONAL or FAIL verdict requires the
   pre-freeze protocol amendments listed in `04` §8.4 (and `review/05` §7) **before** the freeze
   manifest is hashed. No threshold, metric or guide may change after results are seen.

---

## 5. Roles, effort and elapsed time

| Role | Qualification | Effort | Independence |
|---|---|---|---|
| Coder A | static HTML/JS/CSS reading; no need for the study's rules | ~24–30 h | independent of the label generator/analyst/instrument author; may be a colleague |
| Coder B | same | ~24–30 h | **at least one coder external to the Study 02 author team** |
| Adjudicator C | same; third judgement on disagreements only | ~4–6 h | independent of A, B, label generator, analyst, instrument author |

Effort basis: census 111 runs × 7–10 min ≈ 13–18.5 h; panel 200 cases × ~2 min ≈ 6–7 h; variant
sheet 60 × ~4 min ≈ 4 h; paraphrase sheet 18 × ~2 min ≈ 0.6 h; plus short breaks/administration.
Total ≈ **24–30 h per coder**, best spread over 3–4 calendar weeks (part-time). No coding time is
billed against the qualification budget; this is human labour, not API spend.

---

## 6. The pre-declared gate (summary; thresholds verbatim in `04` §7.2)

The analysis script implements A1–A11 exactly as written in `04` §7.2, with four pre-declared
operationalisations (also recorded in `sampling-manifest.json` → `gate`):

| # | Metric | PASS | CONDITIONAL | FAIL |
|---|---|---|---|---|
| A1 | instrument-vs-human Cohen κ, census | ≥ 0.60 **and** cluster-bootstrap LB ≥ 0.40 | 0.40–0.60, or LB < 0.40 | < 0.40 or LB < 0.20 |
| A2 | instrument-vs-human raw agreement, census | ≥ 0.85 **and** LB ≥ 0.70 | 0.75–0.85 | < 0.75 |
| A3 | panel sensitivity (**70 core positives**) | ≥ 0.90 **and** Wilson LB ≥ 0.80 | 0.80–0.90 | < 0.80 or LB < 0.65 |
| A4 | panel specificity (**100 negatives**) | ≥ 0.85 **and** LB ≥ 0.70 | 0.70–0.85 | < 0.70 or LB < 0.55 |
| A5 | inter-coder κ on the census semantic judgement | ≥ 0.50 **and** LB ≥ 0.30 | 0.30–0.50 | < 0.30 |
| A6 | max pairwise arm-differential instrument error | ≤ 15 pp **and** largest-pair bound ≤ 25 pp | 15–25 pp | > 25 pp |
| A7 | interpretation floor (governance, always applies) | — | — | exposure arm contrasts < 20 pp are never interpreted as substantive |
| A8 | unresolved / cannot-tell rate | ≤ 10 % | 10–20 % | > 20 % |
| A9 | label `opportunity_class`: inter-coder κ **and** consensus-vs-label agreement | κ ≥ 0.80, LB ≥ 0.60, agreement ≥ 0.90 | κ 0.60–0.80 or agreement 0.75–0.90 | κ < 0.60 or agreement < 0.75 |
| A10 | hook plausibility (consensus vs planted hook presence) | raw agreement ≥ 0.90 | 0.75–0.90 | < 0.75 |
| A11 | paraphrase intent | no unresolved contested text | ≤ 2 contested texts, adjudicated | ≥ 3 contested texts |

**Overall verdict (`04` §7.3):** PASS = A1–A6, A8, A9, A10, A11 all PASS;
FAIL = any of A1, A3, A4, A6, A9 FAIL or A8 FAIL; otherwise CONDITIONAL. Per-target verdicts
(V1/V6, V4, V5) are reported as well, because the allowed claims differ.

**Operationalisation notes (pre-declared before coding; not adjustable after results):**

1. **A3** is computed on the **70** complete/partial planted positives. The **30 same-class
   replacement probes** are a pre-declared blind-spot set reported separately with the expected
   instrument sensitivity near zero; including them in A3 would make the gate structurally
   unpassable and would not test the instrument's construct coverage. The blind-spot result is a
   required part of the report even when A3 passes.
2. **A5** uses the census semantic judgement (`present_0_1`, V6-style) that both coders make on
   every run. Per-family κ is reported from the panel (40 cases per family).
3. **A6** uses the 95 % scenario-cluster bootstrap upper bound of the largest pairwise arm
   difference; the literal "CI excludes 0" diagnostic is also reported.
4. **A9** also requires consensus-vs-label agreement because two coders can agree with each other
   and both disagree with the frozen label; A10 is computed on the H/L planted hook presence.

**What the verdict buys** (`04` §7.4): PASS → exposure may be described as a human-validated
descriptive measure (with the A7 floor stated); CONDITIONAL → exposure counts only, every table
labelled "limited validation", no interpreted arm comparisons; FAIL → no exposure rates as
measurements, exposure-conditioned analyses removed from the pre-freeze protocol.

**What cannot be claimed without these reviewers:** that the exposure instrument is valid or
invalid; that exposure rates mean what their name says; that the opportunity labels were
human-checked; that paraphrase intent is equivalent; and therefore any sentence attributing the
pilot's low or arm-sensitive exposure to a real pattern rather than an instrument defect (or vice
versa). None of it can be claimed today — **no human coding has occurred.**

---

## 7. Data handling, blinding and publication rules

- **Arm-blind:** coder-facing files carry neutral ids only. Filenames, sheets and case contents do
  not contain the arm, run id, scenario id, variant id, class label or truth. The census copies are
  byte-identical to the pilot outputs precisely so the instrument reading can be recomputed; the
  only information withheld is the **mapping** (`reference/case-map.json`), which the Lead holds
  sealed until both sheets are submitted.
- **Residual blinding risk (declared):** model outputs can differ stylistically by arm. The protocol
  records an optional arm guess only if the Lead chooses to add it (the mandated sheets do not
  include one); if a coder reports that arm identity was inferable, record it in the validation
  report as a blinding limitation. Do not discard cases.
- **Independence:** no discussion between coders before both sheets are submitted; the adjudicator
  sees only disputed items, not the other coders' values or the arm; the instrument's author and the
  primary analyst do not code or adjudicate.
- **No AI substitution:** no LLM, coding assistant, web search or external tool may be used to
  produce any coding or adjudication value. A coder who uses one must have the affected rows
  re-coded by hand and the incident reported. AI-generated review (including the instrument
  triage in `review/04` §2) is **not** human validation.
- **Personal data:** only initials/role are stored; no contact details, no signed scans with
  personal data are required beyond the attestation text and signature block; the attestation is
  retained in `forms/` (or the Lead's records) and hashed.
- **Retention:** returned sheets, the case map, the adjudication log and the analysis transcript are
  retained permanently in the repository (`human-validation/`) and hashed into the freeze manifest;
  no sheet is deleted or overwritten; corrections are appended.
- **Publication:** the validation report publishes every disagreement at item level, every
  unresolved item, the guide version, the sheet hashes and the analysis transcript. Nothing is
  summarised away.

---

## 8. Reproducing and verifying the package

```bash
cd experiments/study-02-rare-trigger
python3 scripts/study02/build_human_validation_package.py            # build (writes generated files)
python3 scripts/study02/build_human_validation_package.py --check    # require byte identity
python3 scripts/study02/build_human_validation_package.py --print-counts
python3 scripts/study02/analyze_human_validation.py --self-test      # synthetic-only gate mechanics test
python3 scripts/study02/analyze_human_validation.py                  # after real sheets are returned
```

`--check` regenerates every artifact in memory, requires byte identity with disk, verifies the
manifest bytes and reports any unexpected extra file. The analysis script refuses to run unless both
coder sheets, the variant sheet and the paraphrase sheet are complete; `--self-test` generates
clearly labelled **`SYNTHETIC-TEST-ONLY`** dummy codes in memory (never written to `sheets/`) and
checks the gate arithmetic.

---

## 9. Current evidence status (verbatim, for any report that cites this package)

> The human-validation materials package exists and is frozen by hash. **No human coding has
> occurred.** All coding and adjudication fields are empty. The package was generated offline by a
> deterministic, stdlib-only script and reviewed by an AI agent; AI review is not human validation
> and must never be presented as such. Until two independent coders and an adjudicator complete the
> sheets and the pre-declared A1–A11 gate is run, no exposure-instrument or opportunity-label claim
> is validated, and the confirmatory report may not describe exposure as a validated measurement.
