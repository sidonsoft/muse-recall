# Reviewer pack — roles, criteria, blinding, workload, data protection

Study: *Study 02 — Rare-Trigger Reliability* · Package `study02-human-validation-package-1.0`
This pack is given to each nominated reviewer **after** they sign
`forms/INDEPENDENCE_ATTESTATION.md` and **before** they receive any case.

---

## 1. Roles

| Role | What they do | What they must not do |
|---|---|---|
| **Coder A** | Codes all three sheets independently: 311 case rows, 60 variant rows, 18 paraphrase rows | Discuss cases with Coder B before submission; inspect pilot results or truth files |
| **Coder B** | Same, independently (must be external to the Study 02 author team) | Same |
| **Adjudicator C** | Codes only the disputed/cannot-tell items after both sheets are hashed; fills `sheets/adjudication.csv` | See the other coders' values or the truth; code the main sheets |

The instrument author, label generator, primary analyst and independent second analyst may not serve
in any of the three roles.

## 2. Independence criteria

A reviewer is independent if they are **not** an author of: the corpus, the label generator, the
trigger-zone instrument, the harness/prompt path, the analysis plan or code, the pilot report, or the
earlier AI reviews; and have no financial or personal interest in the Study 02 outcome. At least one
coder must additionally be **external to the Study 02 author team**. All three sign the attestation.

## 3. Blinding rules

- Case ids are neutral; arm, run id, scenario id, variant id, class label and planted truth are
  withheld. The case map is held sealed by the Lead.
- Do not try to infer the arm; do not record arm guesses as coding values.
- `panel-truth.json` and `reference/case-map.json` are never part of a coder packet.
- No pilot reports, arm tables, exposure summaries or AI reviews before both sheets are submitted.
- Report accidental unblinding immediately; the Lead records it as a blinding limitation (cases are
  never discarded).

## 4. Workload and timeline

| Task | Rows | Estimate |
|---|---:|---:|
| Panel cases (`hv-p-*`) | 200 | ~6–7 h |
| Census runs (`hv-r-*`) | 111 | ~13–18.5 h |
| Variant labels (`hv-v-*`) | 60 | ~4 h |
| Paraphrase intent | 18 | ~0.6 h |
| **Total per coder** | **389 coded rows** | **≈ 24–30 h**, best over 3–4 weeks |
| Adjudication | disputed items only | **≈ 4–6 h**, after both sheets |

Suggested sequence: read `README.md` and `CODING_GUIDE.md` (45 min) → calibration discussion with the
Lead on the guide's illustrative examples (30–45 min; **no panel case is used for calibration**) →
code in 60–90 minute blocks → submit both sheets together.

## 5. What you receive / what you must not see

**Receive:** `README.md`, `CODING_GUIDE.md`, your sheet (`sheets/coder-A.csv` or `sheets/coder-B.csv`),
`sheets/variant-labels.csv`, `sheets/paraphrase-intent.csv`, `sheets/paraphrase-texts.md`,
`cases/panel/`, `cases/real/` (+ `INDEX.csv`), `cases/baselines/`, `cases/variants/`, `forms/`.

**Never receive:** `panel-truth.json`, `reference/case-map.json`, pilot records/reports, arm tables,
exposure summaries, earlier AI reviews, any other coder's sheet, the adjudication sheet (unless you are
the adjudicator).

## 6. Data protection and confidentiality

- Treat all files as confidential research data. No uploads to public or AI services; no third-party
  annotation platforms; no sharing outside the Lead.
- Store locally with access restricted to you. Return sheets to the Lead as files; the Lead hashes
  them on receipt.
- Only initials appear in study records; contact details are coordination-only and are not committed.
- Sheets are immutable after submission; corrections are appended rows with a reason.
- Completed sheets, adjudication, guide version and analysis transcript are retained permanently and
  hashed into the freeze manifest; no deletion.

## 7. No-AI-substitution clause

No generative or non-generative AI tool may produce, suggest, complete, rank or correct any coding or
adjudication value. AI-generated review (including the instrument triage in the earlier AI review) is
**not human validation** and must never be labelled or used as such. A breach is reported, and the
affected rows are re-coded by hand.

## 8. Conflict declaration

Declare before appointment (and update if anything changes): financial interests, personal
relationships, co-authorship with Study 02 authors within 3 years, employment/consulting for a
competing product, or any interest in the Study 02 outcome.

> _____________________________________________________________________________

## 9. What cannot be claimed without this work

Without completed human coding and the pre-declared gate: that the exposure instrument is valid or
invalid; that the opportunity labels and paraphrase intents have been human-checked; that the pilot's
low/arm-sensitive exposure is a real pattern rather than an instrument defect (or the reverse); and
any exposure-based secondary analysis as a validated measurement. **No human coding has occurred to
date** — every coding field is empty.
