# Phase 12E — Release-candidate evidence

Branch: `agent/phase12e-release-hardening`
Base: `260d9ce` (Phase 12C advisory integration)
Audited engine: `@mml/decision-guard` v1.2.0

This directory is new in Phase 12E. It does **not** overwrite the authentic Phase 12C or
Phase 12D evidence; those remain the historical record of their own runs.

## Provenance

- **No live Muse inference was run in this phase.** Every Forge case uses
  `tests/fixtures/fake-muse.mjs` in `copy` mode, which transports already-recorded bytes into
  staging. Structural validation, runtime verification, the advisory snapshot and approval are the
  real production code.
- The A-violation source is the labelled Phase 12C mutation of the recorded Spark baseline. The
  label (`PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT`) is preserved verbatim.
- The B/C/supplementary sources are copies of the authentic recorded artifacts used in Phase 12C
  (`demo/forge-baseline/index.html` and `docs/hackathon-evidence/phase12/A-v2.html`). Their
  sha256 values are recorded in `evaluation.json`.
- The synthetic secrets in the security probe are generated for this test and are not real
  credentials. They are never persisted: only a sha256 of the probe source is stored.

## File index

| File | What it proves |
| --- | --- |
| `evaluation.json` | Production-pipeline cases A/B/C + supplementary palette correction, engine v1.2.0 probes, and the projected-evidence redaction probe. |
| `accuracy.json` | Combined accuracy view: preserved v1.0.0 and v1.1.0 baselines, v1.2.0 results, the only two per-case behaviour changes (A08, D12), and authentic-artifact observations. |
| `accuracy-v1.0.0-baseline.json` | Preserved original Phase 12D pre-fix baseline. |
| `accuracy-v1.1.0-accepted.json` | Preserved accepted Phase 12D audit baseline. |
| `accuracy-v1.2.0-phase12e.json` | Current corpus rows and per-rule confusion metrics after Phase 12E changes. |
| `authentic-v1.2.0.json` | Five observations against the sha256-pinned authentic Muse artifact. |
| `verification.json` | Command-by-command release verification results and functional-check mapping. |
| `built-server-health.json` | `/api/health` response from the production build. |
| `sources/` | The exact HTML bytes used by the production-pipeline cases. |
| `screenshots/` | Browser evidence for A/B/C, the supplementary case, the review panel, and the approval. |

## Reproduce

```bash
pnpm vitest run tests/evaluation/forge-decision/accuracy
pnpm eval:guard
pnpm evidence:guard-ui
pnpm verify
pnpm verify:forge
pnpm verify:runtime
pnpm build
```

`verify:forge` and `evidence:guard-ui` require Google Chrome and start their own loopback
servers (the UI evidence script uses ports 8899/5199). No paid inference is required.

## Reading the evidence

- The review panel screenshot shows **VIOLATION DETECTED**, the advisory disclaimer, and the
  supported-checks scope note. It deliberately contains no `PASS` badge and no compliance claim.
- `evaluation.json.summary.projection_redaction_ok` is the P0-A gate: both synthetic credentials
  are absent from the projected advisory while the finding still identifies `timeLeft`.
- `accuracy.json.per_case_changes` contains exactly two behaviour changes. No fixture label was
  rewritten to improve a score.
- The supplementary palette case now BLOCKs because `0xFF7E5F` and `#FF7E5F` normalise to the same
  RGB token. This is a targeted notation equivalence, not semantic colour analysis.

## Known gaps (see the release report)

- Authentic corpus n = 1.
- `superseded-palette` still misses 8-digit RGBA hexes and inspects only the first superseded
  history record.
- Rule E can still produce narrow false PASSes from proximity words (`solid`, `shape`).
- String/prose and identifier-substring false positives remain for rules B/C/D/E.
- A decision can be partially linked to the supported rules (E13); the UI says "no violation
  detected by supported checks", never "verified".
