# Retrieval benchmark — latest run

Generated 2026-10-30T21:16:41.815Z on Node v26.8.1 ·
SQLite 3.53.4 (FTS5).

Corpus: **130 memories** across 3 projects plus 10
global memories, seeded in 33 ms.

| Metric | Value |
| --- | --- |
| Retrievals measured | 300 (30 queries × 10) |
| Latency mean | 0.3513 ms |
| Latency p50 | 0.3 ms |
| Latency p95 | 0.5 ms |
| Mean candidates | 16.27 |
| Mean selected | 8 |
| Mean characters injected | 1891.8 |
| Retrieval accuracy (hit@8) | 100.0% (30/30) |
| Correction accuracy | 100.0% (12/12) |
| Stale-memory retrieval rate | 0.000% |
| Superseded returned after correction | 0 |
| Deleted still retrievable | 0 |

## What this does and does not show

- It measures the **retrieval path**, not model quality: no Muse call is made.
- Accuracy is defined as "the memory containing the query's unique token appears in
  the top-8 result for that token". It is a retrieval-recall measurement, not an
  answer-quality measurement.
- Stale-memory rate counts returned memories whose lifecycle status is not ACTIVE.
  The expected value is exactly 0.
