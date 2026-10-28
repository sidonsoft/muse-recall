# Phase 17 — post-run reporting correction: exact p-values

**Status:** post-run reporting correction, written 2026-10-29. It changes reported p-values only.
The pre-registered tests, strata, arms, detectors, exclusions, sample size and verdict rules are
unchanged, and no trial was rerun.

**Original artefacts are preserved unchanged:**

| Artefact | SHA-256 |
|---|---|
| `stats17.py` (locked implementation, unchanged) | `99e2481b58be0470d44184db2ccf75f84cfa67b5ae1d37130da111465fadd80e` |
| `phase17-analysis.json` (as-run analysis, unchanged) | `f384fca782cc7b0f8c8675f4218b98ef1ebbfbc9e0eedd4b0f1687e598fd9d64` |
| `protocol.sha256` (lock manifest, unchanged) | `2f1f76668d31ebfa171ff042e2509493e329f72d20a18bce1f57a3c866d58767` |

**Corrected reporting artefacts:**

| Artefact | Purpose |
|---|---|
| `exact_stats.py` | independent exact re-analysis (rational arithmetic) |
| `phase17-analysis-corrected.json` | the corrected values, machine-readable |
| `CORRECTIONS.sha256` | checksums for the three correction files |

## 1. What was wrong

`stats17.stratified_exact` selected the two-sided tail with

```python
return min(1.0, sum(p for p in dist.values() if p <= p_obs * (1 + 1e-9) + 1e-15))
```

The `+ 1e-15` is an **absolute floor**. When the observed tail probability is far below 1e-15,
the rule also counts every outcome with probability at most 1e-15, so the reported value becomes
an upper bound of roughly 1e-16…1e-15 instead of the exact p. The same `+ 1e-15` appears in the
independent re-implementation inside `scripts/verify-phase17.ts`, and its comparison

```ts
Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-9, 1e-15)
```

has the same absolute floor, so the verifier accepted the inflated values (and would accept
`p = 0` for any expected p below 1e-15).

The defect affects only the p-value, and only when the exact tail is below ~1e-15. The risk
differences, counts, intervals, stratification, Holm procedure and verdict rules are unaffected.

## 2. Published vs exact

Exact two-sided stratified p (Fisher's rule: sum every outcome no more probable than the observed
one, ties included), computed with `fractions.Fraction` over the same tables:

| Model | Detector | Test | Published `phase17-analysis.json` | Exact `phase17-analysis-corrected.json` |
|---|---|---|---:|---:|
| Muse Spark | primary | H1 `memory` vs `none` | 2.0233 × 10⁻¹⁶ | **6.5226 × 10⁻²⁰** |
| Muse Spark | primary | H3 `corrected` vs `memory` | 3.3516 × 10⁻¹⁶ | **6.8659 × 10⁻²¹** |
| Muse Spark | primary | worst-case H1 | 2.8211 × 10⁻¹⁷ | 2.8211 × 10⁻¹⁷ |
| Muse Spark | sensitivity | H1 | 8.2080 × 10⁻¹⁶ | **7.4618 × 10⁻¹⁷** |
| Muse Spark | sensitivity | H3 | 1.6691 × 10⁻¹⁷ | 1.6691 × 10⁻¹⁷ |
| Muse Spark | sensitivity | worst-case H1 | 1.2628 × 10⁻¹³ | 1.2628 × 10⁻¹³ |
| Muse Spark Open | primary | H1 | 4.7243 × 10⁻¹⁶ | **1.1241 × 10⁻²⁴** |
| Muse Spark Open | primary | H3 | 5.4341 × 10⁻¹⁶ | **1.5975 × 10⁻²⁴** |
| Muse Spark Open | primary | worst-case H1 | 4.7243 × 10⁻¹⁶ | **1.1241 × 10⁻²⁴** |
| Muse Spark Open | sensitivity | H1 | 4.7243 × 10⁻¹⁶ | **1.1241 × 10⁻²⁴** |
| Muse Spark Open | sensitivity | H3 | 1.1243 × 10⁻¹⁵ | **3.3724 × 10⁻²⁴** |
| Muse Spark Open | sensitivity | worst-case H1 | 4.7243 × 10⁻¹⁶ | **1.1241 × 10⁻²⁴** |

Nine of the twelve reported p-values were inflated; three were already exact. Every corrected
value is smaller, so every published p-value was a conservative upper bound. This also means the
reviewer's alternative p-values can be checked directly against the table above: any figure near
10⁻¹⁶…10⁻¹⁵ is reproducing the locked implementation's floor, not the exact test.

## 3. Effect on verdicts

None. With family α = .05 and Holm across H1/H3 (thresholds .025 and .05), all eight
pre-registered tests were already far below threshold and remain so. H2 does not use a p-value:
the upper 90% Newcombe bound is +4.5 pp (Muse Spark) and +7.1 pp (Muse Spark Open), both below
the pre-registered +15 pp margin, unchanged. The corrected file re-derives every verdict as
supported on both models.

Risk differences and 95% intervals are unchanged because they depend on the counts, not on the
p-value. Example: H1 Muse Spark −64.9 pp [−76.0, −50.5]; H1 Muse Spark Open −80.0 pp
[−87.9, −66.4].

## 4. Method and reproducibility

- `exact_stats.py` rebuilds every contingency table from the committed records in `out/`, scores
  the HTML with the **locked** detectors (`detectors.py`, `../phase16/detector.py`), and computes
  the stratified exact test with `fractions.Fraction` — no floating point in the tail sum, no
  tolerance. Newcombe intervals use the same z constants as the locked `stats17.py`.
- `python3 -I docs/hackathon-evidence/phase17/exact_stats.py --check` regenerates the corrected
  file from the raw records and exits nonzero unless it matches exactly.
- Python 3.9.6 (macOS system Python, the version used for the trial); standard library only.
- The independent check used for review was a second implementation written directly against
  `Fraction` and `math.comb`, reproducing the same values to all printed digits.

## 5. How this is labelled

`RESULTS.md` now reports the exact p-values and marks them as a **post-run reporting correction**.
The original published values remain visible above and in `phase17-analysis.json`; the corrected
values live in `phase17-analysis-corrected.json`, whose checksums are in `CORRECTIONS.sha256`.
`scripts/verify-phase17-strict.ts` distinguishes the two: it pins the original analysis by hash
and value, and it re-derives the corrected file from the records on every verification run.
