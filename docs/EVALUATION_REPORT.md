# Evaluation report

Measured on 2026-10-27 · model `muse-wonder-1.0` (Muse Code 1.4.13) · Node 26.8.1.

> **Environment note (31 Oct 2026):** the local Muse Code CLI has since moved to
> 1.4.14, and the opt-in live trio re-ran green against it (see the capability
> matrix's dated addendum). The measurements below remain **as measured in the
> 27 Oct environment** - not re-measured under 1.4.14 - and are quoted with that
> as-of boundary.

## 1. Persistent memory vs inline facts

`pnpm eval:comparison` (source: `scripts/evaluation-comparison.ts`).

Both configurations answer with **one** Muse call, so the comparison isolates one variable:
whether the facts arrive inside the user message or as a validated retrieved-memory block.
Two tasks (game project, API project) × 2 trials = **n = 4 per configuration**.

| Metric | Baseline (facts inline) | Memory-enabled | Delta |
| --- | --- | --- | --- |
| Input tokens (mean) | 16,849 | 16,916.5 | **+67.5** |
| Prompt characters (mean) | 1,161.75 | 1,433 | +271.25 |
| Application-added characters (mean) | 251 | 112 | −139 |
| Latency (mean) | 4,999 ms | 5,003 ms | +4 ms |
| Correct answers | 4 / 4 | 4 / 4 | — |
| Memories retrieved (mean) | 0 | 2.5 | — |

**Command correction / stale avoidance** (separate one-call check): the corrected answer
contains the current platform; the superseded memory is **absent** from active retrieval while
the current one is present.

**Project isolation:** a retrieval in an unrelated project returned **0** memories from the
other project.

**Interpretation.** With the facts supplied inline, the baseline prompt is slightly *smaller*
than the retrieved-memory block (which adds block headers and metadata). Memory's measured
advantage is not per-call size; it is structural — the user does not have to restate the facts,
and a new session can answer without them (see Demo A). The ~16.6k Muse CLI baseline dominates
total tokens, so per-call differences are a few percent.

**Limits of this result.** n=4 is small; no statistical significance is claimed. Scoring is
expected-term matching, not prose quality. Prompt characters include the fixed system prompt,
which is why both are ~1.1–1.4k.

## 2. Retrieval evaluation (22 realistic questions)

`pnpm eval:retrieval` — three seeded projects including corrected, deleted, contradictory and
missing cases.

- Retrieval passes: **20 / 22 (91%)**
- Real Muse answers sampled: **7 / 7 correct and memory-grounded** (grounded = correct *and*
  supporting retrieval evidence in that turn)

Documented failures, both vocabulary gaps rather than ranking bugs:

1. *"What is missing from the API?"* — the memory says "Rate limiting … not implemented yet";
   no shared content words.
2. *"Is mobile still the priority?"* — the corrected memory says "desktop browsers", so
   "mobile" survives only in the superseded record.

Recommendation: optional embedding retrieval with keyword fallback. The evaluation demonstrates
the need; embeddings are deliberately out of scope for this phase.

## 3. Context efficiency across a task (Demo C, Phase 3)

Baseline re-sends facts as history and needs a setup turn; memory retrieves them in one turn.

| Metric | Baseline | Memory |
| --- | --- | --- |
| Turns per task | 2 | 1 |
| Answering-call input tokens | 16,863 | 16,900 |
| Whole-task input tokens | 33,671 | 16,900 |
| Correctness | 100% | 100% |

Memory costs ~37 more tokens on the answering call and removes an entire setup turn, roughly
halving the task's tokens.

## 4. Tool execution correctness

`pnpm demo:tools` (real Muse): two `task.create` calls planned and **held pending**; both
approved and executed; `task.list` executed in the same session and again in a brand-new
session. Security cases (unknown tool, malformed arguments, cross-session approval, injection,
duplicate call, cancellation, denial) are covered by 13 integration tests in
`tests/integration/tools-api.test.ts`.

## 5. Integrated showcase

`pnpm demo:showcase` on a fresh database: **8 / 8 checks passed**, including cross-session
recall with zero history, supersession, generated form (8 fields), structured submission,
approval-gated tasks, and a new session summarising project, platform and tasks.
Evidence: `docs/benchmarks/showcase.json`.

## Reproduce

```bash
rm -f apps/server/data/eval.db*
DATABASE_PATH=./data/eval.db MODEL_PROVIDER=muse-cli pnpm dev:server
# second terminal
pnpm eval:comparison
pnpm eval:retrieval --muse-answers 7
pnpm demo:tools
```

Machine-readable output: `docs/benchmarks/evaluation-comparison.json`,
`retrieval-eval-latest.json`, `tools-demo.json`, `showcase.json`.
