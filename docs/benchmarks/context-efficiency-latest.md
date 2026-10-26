# Context efficiency — measured with real Muse

Generated 2026-10-26T22:25:48.358Z · model `muse-wonder-1.0` · 3 trials per configuration.

Task: "What game are we building, which engine are we using, and what is the target platform?"

| Metric | Baseline (history) | Memory-enabled |
| --- | --- | --- |
| Turns required | 2 | 1 |
| Answering-call input tokens (mean) | 16863 | 16900 |
| Whole-task input tokens (mean) | 33670 | 16900 |
| Application-added characters | 349.67 (history) | 504 (memory) |
| Retrieved memory characters | 0 | 86 |
| Answer latency (mean ms) | 4860.67 | 4670 |
| Correct answers | 100% | 100% |

## Result

- Answering-call delta (memory − baseline): **37 input tokens**
- Whole-task delta: **-16770 input tokens**
- Turns per task: baseline **2** · memory **1** (one turn saved per task)

Memory used **more** tokens on the answering call in this configuration — it is not a token-saving mechanism at this task size.

## Caveats

- Both configurations pay the Muse CLI baseline (~16.6k input tokens); it dominates these numbers.
- The baseline re-sends the fact statement as conversation history on the answering call.
- Memory adds retrieved-memory characters but removes the history re-send.
- A single model, a single machine, and a small synthetic task set: these are measurements, not a general benchmark.

## Answers

Baseline: "- **Game:** Children memory game - **Engine:** Phaser - **Target platform:** Mobile web" · "A children memory game, built with Phaser, targeting mobile web." · "We’re building a children’s memory game using Phaser, targeting mobile web."

Memory: "We're building a children's memory game using Phaser, targeting mobile web." · "A children's memory game, using Phaser, targeting mobile web." · "We're building a children memory game using Phaser, targeting mobile web."
