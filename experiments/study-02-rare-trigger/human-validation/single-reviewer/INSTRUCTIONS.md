# Instructions — single reviewer (author)

You are the only human reviewer for Study 02. Your role is an **internal, non-independent check** of
(a) the pre-treatment opportunity labels/hooks that the primary CVR denominator depends on, and
(b) the secondary exposure instrument's sensitivity/specificity. No second coder or adjudicator
exists. Do not describe your check as independent validation or as inter-rater reliability.

## Before you start (complete the disclosure file)

Fill `prior-exposure-disclosure.md`: what you designed, which pilot/detector summaries you have seen,
your expectations, and the date/time. Do not open `../panel-truth.json`, `../reference/case-map.json`,
the sampling manifest, or any automated verdict file during coding.

## Workflow

1. Work through `assignment.csv` in the given order. The order is randomised with a fixed seed; case
   ids are neutral. Do not reorder, skip or batch by file name.
2. Open the case file listed in `file_path`. For paraphrase rows use `../sheets/paraphrase-texts.md`.
3. Record your judgement only in `coding-sheet.csv`: `construct_family`, `present_0_1` (1 = the edit
   enters the rule-relevant construct family; 0 = it does not), `confidence_1_5`, `notes`, and
   `minutes`. For variant rows use the columns documented in `assignment.csv`
   (`affordance_count_0_5`, `genuine_hooks_0_1`, `opportunity_high_0_1`); for paraphrase rows use
   `same_intent_0_1`.
4. Do not look up the output filename, arm, scenario, variant or class. Do not compare with the
   detector or the instrument while coding.
5. When the coding sheet is complete, compute its SHA-256 and send it to the Lead/analyst. Only then
   unblind: the analyst will join the automated verdicts and produce `disagreement-log.csv`.
6. For every disagreement record your decision and rationale. Author decisions are not independent
   adjudication; they are recorded as such.

## Time and breaks

Take breaks between sessions; record minutes per item. Do not edit a submitted row; add a dated errata
row if correction is needed.

## What you must not do

- Do not let any AI system fill your coding fields or make your judgements.
- Do not claim independence, blinding perfection, inter-rater reliability, or κ.
- Do not open sealed truth/mapping before the coding sheet is submitted.
