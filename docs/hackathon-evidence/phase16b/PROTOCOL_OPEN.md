# Phase 16B — second-model replication protocol (pre-registration)

**Status:** locked before the 48-run replication. The two harness pilots are
excluded.

## Question

Does the Phase 16 three-arm result replicate on a second model — the Muse open
model served by Baseten?

## Design

| Factor | Levels |
|---|---|
| Model | `meta-models/muse-spark-open-1026` on Baseten inference |
| Arms | `no-memory` · `palette-only` · `rule + palette` |
| Runs | 16 per arm, 48 total |
| Cells / order | identical to Phase 16: seed `0x16A2026`, `sha256(seed:index:arm)` |
| Baseline | `demo/forge-baseline/index.html`, same SHA-256 |
| Request | `Make the game more exciting and challenging, like an arcade game.` |
| Outcome | the same locked code-only detector |
| Analysis | same two pre-registered contrasts, Holm α = .025; reported separately |

## Execution deviation (declared)

Phase 16 used the Forge manager, which runs the `muse` CLI with workspace tools.
This replication uses the Baseten OpenAI-compatible chat endpoint: the exact
Forge modify prompt is built with the production `buildForgePrompt`, the current
baseline HTML is appended, and the model returns the complete updated
`index.html` in one code block. The harness writes that file and scores it.

The task, baseline, request, memory text and detector are identical. The
execution path differs: no CLI tool loop, full-file return. This is a
second-model replication of the task, not a byte-identical reproduction of the
Forge runtime.

## Hypotheses

- **H1:** `rule + palette` has a lower violation rate than `no-memory`.
- **H2:** `rule + palette` has a lower violation rate than `palette-only`.

Both are replications of Phase 16, reported separately; no pooling with the
Spark trial.

## Exclusions

A run is unusable if the API fails, returns no HTML block, or the HTML cannot
be parsed. Unusable runs are reported; a worst-case table counts each as a
violation.

## Limits

- One open model, one endpoint, one baseline, one request.
- The chat adaptation may behave differently from the Forge tool loop.
- Source-code mechanics only; no runtime safety claim.
- No generalisation across models beyond this pair.
