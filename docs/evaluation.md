# Evaluation

Two different things live here, and they must not be confused:

1. **Retrieval benchmark** — deterministic, runs today, measures the memory
   engine itself.
2. **Muse comparison harness** — the instrument for Phase 6, implemented and
   tested, but **no Muse comparison has been run and none is claimed**.

---

## 1. Retrieval benchmark (measured)

```bash
pnpm bench:retrieval            # 30 queries × 10 repeats by default
pnpm bench:retrieval --queries 100 --repeats 25
```

It builds a deterministic synthetic corpus (seeded PRNG, so the same numbers
reproduce), then measures the real retrieval path. Output is written to
[`docs/benchmarks/retrieval-latest.json`](benchmarks/retrieval-latest.json) and
[`retrieval-latest.md`](benchmarks/retrieval-latest.md).

Latest run (Node v26.8.1, SQLite 3.53.4, FTS5):

| Metric | Value |
| --- | --- |
| Corpus | 130 memories across 3 projects + 10 global |
| Retrievals measured | 300 (30 queries × 10) |
| Latency mean / p50 / p95 | 0.25 ms / 0.20 ms / 0.43 ms |
| Mean candidates | 16.3 |
| Mean selected | 8.0 |
| Mean characters injected | 507 |
| Retrieval accuracy (hit@8) | 100% (30/30) |
| Correction accuracy | 100% (12/12) |
| Stale-memory retrieval rate | 0.000% |
| Superseded returned after correction | 0 |
| Deleted still retrievable | 0 |

### What it does not show

- No model is called. This is retrieval recall and engine accounting only.
- Accuracy means "the memory containing the query's unique token appears in the
  top-8". It is not semantic-search quality, and it is not an answer-quality
  score.
- The corpus is synthetic. It demonstrates that scope, budgets, supersession and
  deletion behave correctly at scale; it does not represent a real user's memory.

---

## 2. Muse input-token overhead (measured, real calls)

```bash
pnpm bench:muse-overhead
```

The Phase 1 note "~16.6k tokens per call" was an observation, not a constant.
This script repeats an identical call and reports the spread, then measures the
marginal cost of injecting a memory-sized block.

Latest run (model `muse-wonder-1.0`, reasoning effort `low`, **8 real calls**):

| Measurement | Result |
| --- | --- |
| Short prompt, 5 identical calls | 16,630 input tokens each (std dev 0, CV 0%) |
| Same prompt + 3,989-char memory block, 2 calls | 17,507 input tokens each |
| Marginal cost of the memory block | **+877 tokens** |
| Naive 4-chars/token estimate | 998 tokens |
| Delta ÷ estimate | 0.88× |
| Latency across all calls | mean 4.64 s (range 3.31–5.67 s) |

Full output: [`benchmarks/muse-overhead-latest.md`](benchmarks/muse-overhead-latest.md).

### The honest conclusion

**Memory does not automatically reduce total model tokens.** It removes the
need to re-send conversation history, and it adds the tokens of retrieved
memories. In this configuration a full memory block costs ~877 input tokens
against a fixed ~16,630-token CLI baseline. Whether the net effect is a saving
depends on how much history the baseline would otherwise carry, and that must be
measured per configuration.

The baseline was perfectly stable across five identical calls here. That does
not guarantee stability across models, context lengths, or CLI versions — which
is exactly why the harness measures it instead of assuming it.

---

## 3. Muse comparison harness (interface ready, results pending)

`tests/evaluation/harness.ts` runs any task list under two configurations and
records the facts needed for a fair comparison.

```ts
import { runEvaluation } from './tests/evaluation/harness.ts';

const outcome = await runEvaluation({
  provider,                    // a ModelProvider — MuseCliProvider in Phase 6
  tasks,                       // prompt + seeded memories + expected/forbidden facts
  retrievalBudget: { max_memories: 8 },
});

outcome.runs;         // one record per task × configuration
outcome.comparisons;  // baseline vs memory-enabled deltas
outcome.prompts;      // the exact prompt sent, for auditability
```

Fairness rules enforced by the harness:

- A fresh in-memory database per run, so no state leaks between cells.
- Both configurations receive the identical task prompt.
- The only difference is whether the `<retrieved_memories>` block is prepended.
- Token deltas are only reported when **both** runs reported provider usage;
  otherwise `token_comparison_valid` is false and `summariseComparison` returns
  `null` rather than inventing a number.

It is tested in `tests/evaluation/harness.test.ts` against the deterministic
provider, which proves the instrument works. It does not produce a Muse result.
