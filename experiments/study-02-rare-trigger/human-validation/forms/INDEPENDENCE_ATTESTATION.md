# Independence, conflict and no-AI attestation — Study 02 human validation

**This attestation must be signed by a named human before receiving any coding packet. A named human
must sign it; an AI system, a service account or an unsigned template is not accepted. AI review is
not human validation.**

Study: *Study 02 — Rare-Trigger Reliability*, experiments/study-02-rare-trigger (branch
`study02/qual-prep`, base commit `dc104b9`; no confirmatory run, no preregistration freeze).
Package version: `study02-human-validation-package-1.0` (SHA-256 in `sampling-manifest.json`).
Coding guide: `CODING_GUIDE.md` (record its SHA-256 before you start).

---

## 1. Role and scope

| Field | Entry |
|---|---|
| Name (print) | |
| Initials (used in records) | |
| Role | ☐ Coder A ☐ Coder B ☐ Adjudicator C |
| Affiliation | |
| Email / contact for coordination only | |
| Date appointed | |

## 2. Independence

I declare that I am **not** any of the following (tick each that applies as *not me*; if any is me,
declare it below and do not code):

- ☐ the author of the corpus, label generator, trigger-zone instrument or prompt-path changes;
- ☐ the primary analyst, the independent second analyst, or the harness author for Study 02;
- ☐ a member of the Study 02 author team (required for **Coder B**; A and C may be staff but must not
  be any of the above);
- ☐ the Study 02 Lead / Director or a reviewer of the earlier checkpoint reports.

I further declare that I have not seen, and will not seek, the arm/condition assignment, the planted
panel truth (`panel-truth.json`), the case map (`reference/case-map.json`), the pilot arm tables or
the earlier AI reviews before both coding sheets are submitted and hashed.

Conflicts to declare (financial, personal, co-authorship within 3 years, product interest in the
Study 02 outcome and relevance):

> _____________________________________________________________________________

## 3. Blinding

I agree to:

- code from the provided packet only (no pilot outputs, no internet, no product UI);
- not attempt to infer the arm or condition and not record such guesses as coding values;
- not discuss cases or coding decisions with the other coder until both sheets are submitted;
- report immediately to the Lead if I accidentally learn a case's arm, truth or label.

## 4. Workload and data protection

- Expected effort: **Coder A/B ≈ 24–30 h over 3–4 weeks**; **Adjudicator ≈ 4–6 h**, after both sheets
  are submitted.
- I will work in blocks of ≤ 90 minutes and use the confidence field honestly.
- I will handle case files and sheets as confidential research materials: no uploads to public
  services, no AI/LLM tools, no third-party annotation platforms, no sharing beyond the Lead.
- Only initials are stored in the study records; my contact details are used for coordination only
  and are not committed to the repository.
- The coding sheets are immutable after submission; corrections are appended rows with reasons.
- Completed sheets, adjudication and the analysis transcript are retained permanently and hashed;
  no data is deleted.

## 5. No-AI-substitution clause (required)

I understand and attest that:

1. I am a human coder/adjudicator. **I will not use any generative or non-generative AI system** (LLM,
   coding assistant, browser assistant, translation/annotation tool, or automated classifier) to
   produce, suggest, rank, complete or correct any coding value, note or adjudication.
2. **AI-generated review, triage or analysis is not human validation** and may not be substituted for
   my judgement, cited as my judgement, or presented as human coding anywhere in the study record.
3. If I use such a tool by mistake, I will report it to the Lead, and the affected rows will be
   discarded and re-coded by me by hand; the incident will be recorded in the validation report.
4. I will not sign this attestation on behalf of anyone else, and no AI system may sign or generate
   it.

## 6. Attestation

I attest that the statements above are true and complete.

| | Signature | Printed name | Date (UTC) | Guide SHA-256 seen | Package version |
|---|---|---|---|---|---|
| Coder A | | | | | `study02-human-validation-package-1.0` |
| Coder B | | | | | `study02-human-validation-package-1.0` |
| Adjudicator C | | | | | `study02-human-validation-package-1.0` |

**Lead acceptance:** I confirm the named person signed this attestation before receiving the packet.

| | Signature | Printed name | Date (UTC) |
|---|---|---|---|
| Study 02 Lead | | | |

*Retention: one copy with the Lead, one hashed copy under `human-validation/forms/` (or the Lead's
archived records) and listed in the freeze manifest. A signature block without a printed name and a
human signature does not satisfy this requirement.*
