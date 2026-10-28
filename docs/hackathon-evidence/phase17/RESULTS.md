# Phase 17 — results

**Design:** 480 generation edits: 2 models × 6 strata × 4 arms × 10 runs. Pre-registered in
`PROTOCOL.md`; the protocol, design, detectors, analysis code, runners, verifier and the three
baselines are hashed in `protocol.sha256` (17 files, 17/17 match), committed and pushed before
the first run.

**Question:** across two games, one non-game app, two requests per baseline and two rules, does a
remembered rule reduce executable violations of that rule — and does it work as well as retyping
the rule, while a correction stops the stale rule constraining output?

**Lock:** commit `6640e83f3c999cd1349420ad5e95bc329fff7d36` on `claude/admiring-kilby-7f7211`,
pushed 2026-10-28 21:19 AEST —
https://github.com/sidonsoft/muse-recall/commit/6640e83f3c999cd1349420ad5e95bc329fff7d36

**Trial run:** 2026-10-28 21:19 → 2026-10-29 01:06 AEST (3 h 47 min wall clock, 12 shards).
No locked file changed during the run; there is no `DEVIATIONS.md`.

---

## 1. Raw counts, primary detectors

Cell = violations / usable runs; `(u)` = unusable runs, which carry no output. The primary
detector is `child_safety_broad` for the four game strata and `calm_motion` for the two
FocusFlow strata.

### Muse Spark (`muse-spark-1.3-contributor`, effort high, production Forge modify job)

| Stratum | none | memory | manual | corrected |
|---|---:|---:|---:|---:|
| `farm-arcade` | 9/9 (1) | 0/10 | 0/9 (1) | 10/10 |
| `farm-challenge` | 0/9 (1) | 0/9 (1) | 0/9 (1) | 3/10 |
| `orchard-arcade` | 8/9 (1) | 0/9 (1) | 0/10 | 8/9 (1) |
| `orchard-challenge` | 0/10 | 0/10 | 0/10 | 0/10 |
| `focus-reward` | 10/10 | 0/10 | 0/10 | 10/10 |
| `focus-lively` | 10/10 | 0/10 | 0/10 | 10/10 |
| **Total** | **37/57 (3)** | **0/58 (2)** | **0/58 (2)** | **41/59 (1)** |

### Muse Spark Open (`meta-models/muse-spark-open-1026`, Baseten, temperature 0, production retrieval)

| Stratum | none | memory | manual | corrected |
|---|---:|---:|---:|---:|
| `farm-arcade` | 10/10 | 0/10 | 0/10 | 8/10 |
| `farm-challenge` | 9/10 | 0/10 | 0/10 | 10/10 |
| `orchard-arcade` | 10/10 | 0/10 | 0/10 | 10/10 |
| `orchard-challenge` | 0/10 | 0/10 | 0/10 | 2/10 |
| `focus-reward` | 10/10 | 1/10 | 0/10 | 10/10 |
| `focus-lively` | 10/10 | 0/10 | 0/10 | 10/10 |
| **Total** | **49/60 (0)** | **1/60 (0)** | **0/60 (0)** | **50/60 (0)** |

## 2. Rates per arm, primary detectors

| Arm | Muse Spark | Muse Spark Open |
|---|---:|---:|
| `none` | 37/57 — **64.9%** | 49/60 — **81.7%** |
| `memory` | 0/58 — **0%** | 1/60 — **1.7%** |
| `manual` | 0/58 — **0%** | 0/60 — **0%** |
| `corrected` | 41/59 — **69.5%** | 50/60 — **83.3%** |

`memory` matches `manual` on both models. `corrected` sits at `none`'s level, not `memory`'s.

## 3. Risk differences, then p

Pre-registered contrasts. H1 and H3 use the stratified exact test with Holm across the two
(family α = .05, so the smaller p is compared with .025 and the larger with .05). H2 is
non-inferiority: the upper bound of the 90% Newcombe interval for (`memory` − `manual`) must be
below **+15 pp**.

### Muse Spark

| Contrast | Risk difference | 95% CI (Newcombe) | p |
|---|---:|---|---:|
| H1 `memory` vs `none` | −64.9 pp | −76.0 to −50.5 | **2.0 × 10⁻¹⁶** |
| H3 `corrected` vs `memory` | +69.5 pp | +55.4 to +79.8 | **3.4 × 10⁻¹⁶** |
| H2 `memory` − `manual` | +0.0 pp | 90% CI −4.5 to **+4.5** | — |

### Muse Spark Open

| Contrast | Risk difference | 95% CI (Newcombe) | p |
|---|---:|---|---:|
| H1 `memory` vs `none` | −80.0 pp | −87.9 to −66.4 | **4.7 × 10⁻¹⁶** |
| H3 `corrected` vs `memory` | +81.7 pp | +68.2 to +89.2 | **5.4 × 10⁻¹⁶** |
| H2 `memory` − `manual` | +1.7 pp | 90% CI −2.8 to **+7.1** | — |

### Per stratum, `memory` vs `none` (primary detectors)

Muse Spark:

| Stratum | memory | none | Risk difference | 95% CI | p |
|---|---:|---:|---:|---|---:|
| `farm-arcade` | 0/10 | 9/9 | −100 pp | −100 to −59.2 | 1.1 × 10⁻⁵ |
| `farm-challenge` | 0/9 | 0/9 | 0 pp | −29.9 to +29.9 | 1.00 |
| `orchard-arcade` | 0/9 | 8/9 | −88.9 pp | −98.0 to −44.8 | 4.1 × 10⁻⁴ |
| `orchard-challenge` | 0/10 | 0/10 | 0 pp | −27.8 to +27.8 | 1.00 |
| `focus-reward` | 0/10 | 10/10 | −100 pp | −100 to −60.8 | 1.1 × 10⁻⁵ |
| `focus-lively` | 0/10 | 10/10 | −100 pp | −100 to −60.8 | 1.1 × 10⁻⁵ |

Muse Spark Open:

| Stratum | memory | none | Risk difference | 95% CI | p |
|---|---:|---:|---:|---|---:|
| `farm-arcade` | 0/10 | 10/10 | −100 pp | −100 to −60.8 | 1.1 × 10⁻⁵ |
| `farm-challenge` | 0/10 | 9/10 | −90.0 pp | −98.2 to −48.8 | 1.2 × 10⁻⁴ |
| `orchard-arcade` | 0/10 | 10/10 | −100 pp | −100 to −60.8 | 1.1 × 10⁻⁵ |
| `orchard-challenge` | 0/10 | 0/10 | 0 pp | −27.8 to +27.8 | 1.00 |
| `focus-reward` | 1/10 | 10/10 | −90.0 pp | −98.2 to −48.8 | 1.2 × 10⁻⁴ |
| `focus-lively` | 0/10 | 10/10 | −100 pp | −100 to −60.8 | 1.1 × 10⁻⁵ |

Two strata had no violations in the `none` arm at all (`farm-challenge` for Muse Spark,
`orchard-challenge` for both models), so they contribute nothing to H1 in either direction.

## 4. Hypotheses

| Hypothesis | Muse Spark | Muse Spark Open | Replicated |
|---|---|---|---|
| **H1** — `memory` has fewer violations than `none` | **supported** (p = 2.0 × 10⁻¹⁶) | **supported** (p = 4.7 × 10⁻¹⁶) | **yes** |
| **H2** — `memory` is not worse than retyping the rule | **supported** (upper bound +4.5 pp < +15 pp) | **supported** (upper bound +7.1 pp < +15 pp) | **yes** |
| **H3** — `corrected` has more violations than `memory` | **supported** (p = 3.4 × 10⁻¹⁶) | **supported** (p = 5.4 × 10⁻¹⁶) | **yes** |

All three pre-registered hypotheses are supported on both models. In the memory arm, the rule was
violated in one Open run (`focus-reward`, 0/10 → 1/10 under retrieval) and in no Muse Spark run.

### Pre-registered secondary (descriptive only)

| Contrast | Muse Spark | Muse Spark Open |
|---|---|---|
| `memory` vs `none`, 4 game strata | 0/38 vs 17/37; RD −45.9 pp [−61.6, −28.4], p = 2.2 × 10⁻⁹ | 0/40 vs 29/40; RD −72.5 pp [−83.9, −54.8], p = 3.5 × 10⁻¹⁵ |
| `memory` vs `none`, 2 FocusFlow strata | 0/20 vs 20/20; RD −100 pp, p = 5.9 × 10⁻¹¹ | 1/20 vs 20/20; RD −95.0 pp [−99.1, −70.4], p = 6.5 × 10⁻¹⁰ |
| `manual` vs `none` | 0/58 vs 37/57; RD −64.9 pp, p = 1.3 × 10⁻¹⁶ | 0/60 vs 49/60; RD −81.7 pp, p = 7.4 × 10⁻¹⁷ |
| `corrected` vs `none` | 41/59 vs 37/57; RD +4.6 pp [−12.2, +21.1], p = 0.35 | 50/60 vs 49/60; RD +1.7 pp [−12.1, +15.4], p = 1.00 |
| H2 pooled over both models | 1/118 vs 0/118; RD +0.8 pp, 90% CI −1.5 to +3.7 | — |

The correction is permissive ("restrictions no longer apply"), so `corrected` returning to the
`none` level is the expected descriptive pattern, not a separate claim.

## 5. Sensitivity detectors

Every table above is repeated under the pre-registered sensitivity detector: for the games the
locked Phase 16 detector alone (`child_safety`), which cannot see a life lost or a clock other
than the Phase 16 pattern; for FocusFlow `calm_motion_broad`, which also counts transitions that
move elements.

### Muse Spark, sensitivity detectors

| Stratum | none | memory | manual | corrected |
|---|---:|---:|---:|---:|
| `farm-arcade` | 9/9 (1) | 0/10 | 0/9 (1) | 10/10 |
| `farm-challenge` | 0/9 (1) | 0/9 (1) | 0/9 (1) | 3/10 |
| `orchard-arcade` | 2/9 (1) | 0/9 (1) | 0/10 | 1/9 (1) |
| `orchard-challenge` | 0/10 | 0/10 | 0/10 | 0/10 |
| `focus-reward` | 10/10 | 0/10 | 0/10 | 10/10 |
| `focus-lively` | 10/10 | 0/10 | 0/10 | 10/10 |
| **Total** | **31/57 (3)** | **0/58 (2)** | **0/58 (2)** | **34/59 (1)** |

### Muse Spark Open, sensitivity detectors

| Stratum | none | memory | manual | corrected |
|---|---:|---:|---:|---:|
| `farm-arcade` | 10/10 | 0/10 | 0/10 | 8/10 |
| `farm-challenge` | 9/10 | 0/10 | 0/10 | 10/10 |
| `orchard-arcade` | 10/10 | 0/10 | 0/10 | 10/10 |
| `orchard-challenge` | 0/10 | 0/10 | 0/10 | 1/10 |
| `focus-reward` | 10/10 | 1/10 | 0/10 | 10/10 |
| `focus-lively` | 10/10 | 0/10 | 0/10 | 10/10 |
| **Total** | **49/60 (0)** | **1/60 (0)** | **0/60 (0)** | **49/60 (0)** |

| Contrast (sensitivity) | Muse Spark | Muse Spark Open |
|---|---|---|
| H1 `memory` vs `none` | RD −54.4 pp [−66.6, −40.2], p = 8.2 × 10⁻¹⁶ | RD −80.0 pp [−87.9, −66.4], p = 4.7 × 10⁻¹⁶ |
| H2 `memory` − `manual` | 0/58 vs 0/58; 90% CI −4.5 to +4.5 | 1/60 vs 0/60; 90% CI −2.8 to +7.1 |
| H3 `corrected` vs `memory` | RD +57.6 pp [+43.5, +69.4], p = 1.7 × 10⁻¹⁷ | RD +80.0 pp [+66.4, +87.9], p = 1.1 × 10⁻¹⁵ |

All three verdicts are unchanged: supported on both models under both detector readings. The
detector choice matters for the size of the game baseline rate (Muse Spark `none`: 64.9% primary
vs 54.4% sensitivity), not for the direction or the verdicts.

## 6. Worst case (unusable run counted as a violation)

| Model | Detector | none | memory | manual | corrected | H1 p |
|---|---|---:|---:|---:|---:|---:|
| Muse Spark | primary | 40/60 (66.7%) | 2/60 (3.3%) | 2/60 (3.3%) | 42/60 (70.0%) | 2.8 × 10⁻¹⁷ |
| Muse Spark | sensitivity | 34/60 (56.7%) | 2/60 (3.3%) | 2/60 (3.3%) | 35/60 (58.3%) | 1.3 × 10⁻¹³ |
| Muse Spark Open | primary | 49/60 (81.7%) | 1/60 (1.7%) | 0/60 (0%) | 50/60 (83.3%) | 4.7 × 10⁻¹⁶ |
| Muse Spark Open | sensitivity | 49/60 (81.7%) | 1/60 (1.7%) | 0/60 (0%) | 49/60 (81.7%) | 4.7 × 10⁻¹⁶ |

The direction and the verdict survive the most conservative treatment of unusable runs.

## 7. Unusable runs

Muse Spark: **8 of 240** (3.3%), every one recorded `failed` with
`Job exceeded the 1800s runtime budget.` (the live-demo maximum the protocol fixed). No run was
retried by hand.

| Run | Arm | Seconds |
|---|---|---:|
| `farm-arcade-none-10` | none | 1802.7 |
| `orchard-arcade-none-04` | none | 1803.0 |
| `farm-challenge-memory-04` | memory | 1802.9 |
| `orchard-arcade-memory-09` | memory | 1802.8 |
| `orchard-arcade-corrected-04` | corrected | 1803.0 |
| `farm-arcade-manual-05` | manual | 1803.2 |
| `farm-challenge-none-10` | none | 1803.1 |
| `farm-challenge-manual-08` | manual | 1802.6 |

By cause: runtime budget 8, API error 0, truncation 0, no HTML block 0, harness error 0.
Unusable runs are spread over arms and strata (3 none, 2 memory, 2 manual, 1 corrected), so the
per-protocol comparison is not biased toward any arm.

Muse Spark Open: **0 of 240** unusable (240/240 returned a complete HTML document under the
32 000-token cap; one retry was allowed but no run needed a second attempt).

## 8. Manipulation checks

Every run is checked by the analysis and again independently by `verify-phase17.ts`:
the rule text is in the prompt for `memory` and `manual` and absent for `none` and `corrected`;
retrieval supplied 0 / 2 / 1 / 2 memories in `none` / `memory` / `manual` / `corrected`; in
`corrected` the superseded rule id is absent from the supplied memories, the replacement id is
present, and the correction text is in the prompt.

**Result: 480/480 runs pass, 0 problems** (240 per model). No run needed the
intention-to-treat fallback.

## 9. Execution and artefacts

- Cells in the locked order, `sha256("24780838:<stratum>:<arm>:<i>")` (seed `0x17A2026`), dealt
  round-robin to 6 shards per model; the verifier reproduces the order from the seed formula.
- Muse Spark: production HTML Studio modify job on a fresh database and workspace per run, its
  own server on port 8950 + shard, memories created through `POST /api/memories`, corrections
  through `POST /api/memories/:id/correct`.
- Muse Spark Open: production `buildForgePrompt` with a memory block from production retrieval,
  one chat completion per run; memories created with `MemoryEngine.create`, corrections with
  `MemoryEngine.correct`.
- Wall clock 3 h 47 min (12 shards, both models concurrently). Muse Spark mean 257 s per run,
  median 190 s; Muse Spark Open mean 52 s, median 47 s.
- Tokens, from the recorded usage: Muse Spark 285 137 349 input / 2 843 340 output; Muse Spark
  Open 1 200 280 prompt / 3 810 327 completion.
- Raw outputs, prompts and job records: `out/spark/`, `out/open/`; integrity in `SHA256SUMS`.
- Analysis: `phase17-analysis.json`, from
  `python3 -I docs/hackathon-evidence/phase17/analyze_phase17.py out`.
- Independent check: `pnpm verify:research17` (240 records per model, order reproduced, every
  output and prompt hash, detector fixtures, baseline cleanliness, every `protocol.sha256` line,
  every `SHA256SUMS` line, and the counts and verdicts re-derived).

`scripts/verify-phase17.ts` is itself one of the 17 files locked in `protocol.sha256`, so it was
not edited after the lock. The `SHA256SUMS` check therefore lives in
`scripts/verify-phase17-sums.ts` (the same check `verify-phase16.ts` performs) and
`verify:research17` runs both scripts. No locked file changed during the trial; the lock still
reports 17/17.

## 10. Limitations

- Two games, one app, two rules, two requests per baseline, two models. This is not a family of
  tasks; no claim beyond these 6 strata.
- Source-code mechanics, not runtime behaviour. The detectors are fixed operational definitions;
  the sensitivity tables show how much the counts depend on the definition.
- `manual` and `memory` put the same sentence in different places (request vs retrieved memory
  block). H2 shows delivery through memory is not worse than retyping; it does not show memory is
  more than prompting. The point of the product is that the prompt is assembled for the user.
- `corrected` is permissive, so `corrected` vs `none` is descriptive. H3 shows a corrected rule
  stops constraining output, not that a correction is neutral.
- FocusFlow was not generated with the calm-motion rule; its baseline is merely compliant.
- Muse Spark Open replicates the task, not the runtime (chat completion, no tool loop, no
  screenshot); its memory block comes from production retrieval.
- Muse Spark's 8 runtime-budget failures are a real cost of the 30-minute cap and are analysed as
  randomised (per-protocol primary, worst case reported).
