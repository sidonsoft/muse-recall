# Evaluation comparison — persistent memory vs inline facts

Generated 2026-10-26T22:52:19.733Z · model `muse-wonder-1.0` · **n=4 per configuration** (2 tasks × 2 trials).

| Metric | Baseline (facts inline) | Memory-enabled |
| --- | --- | --- |
| Input tokens (mean) | 16849 | 16916.5 |
| Prompt characters (mean) | 1161.75 | 1433 |
| Application-added characters | 251 | 112 |
| Latency (mean ms) | 4999 | 5003 |
| Correct answers | 4/4 | 4/4 |
| Retrieved memories (mean) | 0 | 2.5 |

**Deltas (memory − baseline):** 67.5 input tokens · 271.25 prompt characters · 4 ms.

## Correction and stale-memory avoidance

- Answer contains the current platform: **yes**
- Superseded memory present in active retrieval: **no**
- Current memory present in active retrieval: **yes**

## Project isolation

- Memories leaked from another project: **0**

## Per-run detail

| Task | Trial | Inline tokens | Inline correct | Memory tokens | Memory correct | Memories |
| --- | --- | --- | --- | --- | --- | --- |
| game | 1 | 16884 | yes | 16904 | yes | 2 |
| game | 2 | 16829 | yes | 16904 | yes | 2 |
| api | 1 | 16823 | yes | 16929 | yes | 3 |
| api | 2 | 16860 | yes | 16929 | yes | 3 |

## Caveats

- Both configurations pay the Muse CLI baseline (~16.6k input tokens); it dominates raw token totals.
- Facts-inline and memory-block are both single-call configurations; the comparison isolates context source, not turn count.
- Sample size is small (n=4 per configuration); no statistical significance is claimed.
- Answers are scored by expected-term matching, which measures recall of facts, not prose quality.
