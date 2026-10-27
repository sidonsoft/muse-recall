# Phase 12D — Decision Guard accuracy evaluation assets

Reproducible adversarial evaluation for `@mml/decision-guard` (base 398418a, engine
v1.0.0/v1.1.0). Full analysis: `docs/PHASE12D_GUARD_ACCURACY_AUDIT.md`.

Run everything:

```bash
pnpm vitest run tests/evaluation/forge-decision/accuracy
```

- `corpus.ts` — 72 synthetic cases (ground truth adjudicated from fixtures, notes included).
- `decisions.ts` — synthetic decision fixtures (`12d-` ids; never real memories).
- `authentic.ts` — 5 observations against the sha256-pinned authentic Muse artifact
  `experiments/muse-forge/game/index.html` (read-only; the test fails if the artifact changes).
- `harness.ts` — runner, classifier (TP/FP/TN/FN/ABSTAIN), per-rule metrics with explicit
  zero-denominator handling.
- `accuracy.test.ts` + `__snapshots__/` — golden rows/metrics, pinned FP/FN id sets,
  security probes S01–S13, determinism/non-mutation checks.

Fixtures are string data only — the game sources are never imported or executed.
No model calls, no network. Snapshots record actual engine behaviour per version.
