# Muse input-token overhead — measured

Generated 2026-10-26T22:01:27.408Z · model `muse-wonder-1.0` · reasoning effort `low` ·
Node v26.8.1.

Every row is a **real Muse call**, not an estimate.

## Repeated identical short calls

Prompt: `Reply with exactly the single word: READY`

| Statistic | Input tokens |
| --- | --- |
| Mean | 16630 |
| Std dev | 0 |
| Min | 16630 |
| Max | 16630 |
| Coefficient of variation | 0.00% |

Samples: 16630, 16630, 16630, 16630, 16630

## Same call plus a memory-sized block

Appended a 3,989-character
`<retrieved_memories>` block (≈998 tokens at 4 chars/token).

| Statistic | Input tokens |
| --- | --- |
| Mean | 17507 |
| Std dev | 0 |
| Min | 17507 |
| Max | 17507 |

Samples: 17507, 17507

## Marginal cost

| Metric | Value |
| --- | --- |
| Measured input-token delta | 877 |
| Estimated tokens (4 chars/token) | 998 |
| Delta ÷ estimate | 0.879× |

## What this means

- The **baseline overhead is stable** across
  5 identical calls (CV 0.00%,
  range 16630–16630).
- A ~4k-character memory block costs **877
  measured input tokens**, i.e. 0.879× the naive
  4-chars-per-token estimate.
- Therefore: **memory does not automatically reduce total model tokens.** It reduces
  the tokens spent re-sending conversation history, while adding the tokens spent
  injecting retrieved memories. Whether the net is a saving depends on the baseline's
  history size and must be measured per configuration — which is exactly what the
  evaluation harness in `tests/evaluation/` is for.

This document reports only what was measured. No Phase 6 comparison is claimed here.
