# Phase 16B — correction 1: truncated outputs were scored as clean

**Found:** 2026-10-28, while piloting Phase 17. **Status:** post-hoc correction, disclosed. The
as-run files in this folder ([`RESULTS_OPEN.md`](RESULTS_OPEN.md), `phase16b-analysis.json`, the
runner and the outputs) are unchanged and still match `SHA256SUMS`; this note supersedes their
counts.

## What went wrong

The runner accepted any response that contained an `<html` tag. It did not check whether the
model had finished. 12 of the 48 responses stopped at the 20,000-token output limit
(`finish_reason: "length"`); the saved files end partway through the page and have no closing
`</html>`.

The detector only reads complete `<script>…</script>` blocks, so code in an unterminated script
is never examined. All 12 truncated files were therefore scored as **clean** by construction, not
because they were free of violations.

| Arm | Truncated | Of which scored clean |
| --- | ---: | ---: |
| No memory | 0 | — |
| Palette only | **10** | 10 |
| Rule + palette | 2 | 2 |

Phase 16 (Muse Spark) is not affected: all 37 usable outputs are complete documents.

## Corrected result

Truncated files are counted as **unusable**, the same treatment Phase 16 gives runs that hit a
budget. The detector, the cells and the pre-registered contrasts are unchanged.

| Arm | Published | Corrected | Unusable |
| --- | ---: | ---: | ---: |
| No memory | 16/16 | **16/16** | 0 |
| Palette only | 6/16 | **6/6** | 10 |
| Rule + palette | 0/16 | **0/14** | 2 |

| Contrast (two-tailed Fisher, Holm α = .025) | Published | Corrected |
| --- | ---: | ---: |
| Rule vs no memory | p = 3.3 × 10⁻⁹ | **p = 6.9 × 10⁻⁹** |
| Rule vs palette only | p = .018 | **p = 2.6 × 10⁻⁵** |

**Worst case** (every unusable run counted as a violation): rule 2/16 vs no memory 16/16 and vs
palette only 16/16, p = 5.1 × 10⁻⁷ each.

Combined with Phase 16: no memory **28/28**, palette only **18/18**, rule **0/27** (usable runs).

## What changes in the interpretation

- **Withdrawn:** "palette-only memory is not inert on the open model" and the descriptive
  palette-vs-no-memory reduction (16/16 → 6/16, p = .00025). Every complete palette-only output
  violated the rule; the apparent reduction came from files that were cut off.
- **Unchanged:** only the rule arm reached zero violations, on both models, and both
  pre-registered contrasts remain significant.
- **Now cleaner:** on both models, palette-only memory behaved like no memory. The effect belongs
  to the remembered rule, not to memory in general.
- **Caveat:** 12 of 48 open-model runs are now unusable, and they are concentrated in the
  palette-only arm. Why that arm produced longer outputs was not investigated.

## How to check

`pnpm verify:research16` reproduces both the as-published scoring (from the preserved analysis)
and this correction, from each run's recorded `finish_reason` and the saved files. The Phase 17
draft protocol treats `finish_reason = length` as unusable from the start and raises the output
limit to 32,000 tokens.
