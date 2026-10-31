# Reviewer nomination request — Study 02 human validation

**To:** Director, muse-memory-lab · **From:** Study 02 Lead · **Date:** 2026-11-01
**Decision requested:** nominate/appoint **three named humans** (2 coders + 1 adjudicator) for offline,
unpaid human validation of the Study 02 exposure instrument and corpus labels.

## Why this is needed now

The Director's checkpoint-3 decision was **CONDITIONAL GO for Baseten qualification, NO-GO for
confirmatory execution / preregistration freeze**. One freeze blocker is unresolved and only humans can
clear it: **no human validation of the trigger-zone exposure instrument or the opportunity labels has
occurred** (pilot defect **D-P8**). Without it, the confirmatory report may not describe exposure as a
validated measurement, and the study cannot say whether the pilot's low/arm-sensitive exposure is an
instrument defect or a real pattern. AI review can triage and flag instrument behaviour; it is **not**
human validation and will never be labelled as such.

## What we need from you

| Role | Number | Qualification | Time | Independence |
|---|---|---|---|---|
| Coder A | 1 | reads single-file HTML/CSS/JS comfortably; no Study 02 knowledge needed (the coding guide trains them) | **≈ 24–30 h** over 3–4 weeks, flexible blocks | may be staff |
| Coder B | 1 | same | **≈ 24–30 h** | **must be external to the Study 02 author team** (at least one of the two coders) |
| Adjudicator C | 1 | same; judgement on disputed items only | **≈ 4–6 h**, after A and B submit | independent of A/B, the label generator, the analyst and the instrument author |

Total human effort ≈ **55–65 person-hours**; **no API spend**, no paid tools, no data-collection cost.

## What reviewers receive

A self-contained, arm-blind packet: `README.md`, `CODING_GUIDE.md`, three coding sheets
(`coder-A.csv` or `coder-B.csv`, `variant-labels.csv`, `paraphrase-intent.csv`), 200 synthetic
reduced-form diagnostic cases, a census of 111 renamed pilot runs (output + baseline), 60 corpus
variants and 18 request texts. They need only a browser-free text editor / spreadsheet.

## What they must NOT see

- The arm/condition/run id behind any case (the case map is held sealed by the Lead).
- **`panel-truth.json`** and **`reference/case-map.json`** (planted truth and case mapping).
- Any pilot report, arm table, exposure summary or the earlier AI reviews **before** both sheets are
  submitted and hashed.

## Timeline

Nomination **now** → attestations signed → briefing/calibration 30–45 min → coding 3–4 weeks
(part-time) → sheets submitted and hashed → adjudication 2–5 days → gate computed → Lead writes the
validation report → freeze decision. The freeze cannot precede this gate; if reviewers are not
nominated, the only compliant alternative is to freeze with the exposure instrument and every
exposure-conditioned analysis **removed/demoted**, which is a scope reduction the study would rather
avoid.

## What cannot be claimed without them

That the exposure instrument is valid (or invalid); that the opportunity labels or paraphrase intents
have been human-checked; that the pilot's exposure rate is a real pattern rather than an instrument
defect; and any exposure-based secondary analysis as a validated measurement. **No human coding has
occurred to date — all coding fields are empty.**

## Signature / decision line

**Director decision:** ☐ Nominate the three reviewers below ☐ Defer (freeze with exposure analyses removed)

| Role | Name | Affiliation | Independence confirmed | Signature | Date |
|---|---|---|---|---|---|
| Coder A | | | ☐ | | |
| Coder B (external) | | | ☐ | | |
| Adjudicator C | | | ☐ | | |

Each appointee must sign `forms/INDEPENDENCE_ATTESTATION.md` before receiving the packet.
