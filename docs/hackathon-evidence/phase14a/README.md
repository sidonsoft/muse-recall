# Phase 14A — demo production evidence

Branch: `agent/phase14a-demo-production`
Base: `agent/phase12e-release-hardening` @ `156c65c9a55833e00f6764f4fee20d93eec17e49`
Docs: cherry-picked `84e6a8c` (docs-only; the Phase 13 branch was never merged)

This directory is new in Phase 14A. It does **not** overwrite the authentic Phase 12, 12C or 12E
evidence; those remain the historical record of their own runs.

## Provenance

- **No live Muse inference was run in this phase.** Every Forge case transports already-recorded
  bytes with `tests/fixtures/fake-muse.mjs` in `copy` mode. Structural validation, the headless
  browser gate, the advisory snapshot, approval and rollback are the real production code.
- The seeded v1 game is the recorded real `muse-spark-1.3-contributor` generation
  (`demo/forge-baseline/index.html`, sha256 `79c9d67a654e39a6ec78807a6bc7d1875e371643aa8dc7f3f8fbfc8de9ba9e41`).
- The guard case is the labelled Phase 12C mutation of that baseline; its
  `PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT` banner is preserved verbatim. The
  authentic approval case is the recorded Phase 12A condition-C output
  (`docs/hackathon-evidence/phase12/C-v2.html`).
- The A/B/C memory-influence presentation reuses authentic Phase 12A screenshots and measurements
  from `docs/hackathon-evidence/phase12/pilot.json`. It is one trial per condition and says so.

## File index

| File | What it proves |
| --- | --- |
| `verification.json` | Command-by-command Phase 14A verification results and functional-check mapping. |
| `rehearsal.json` | Complete deterministic demo rehearsal (seed, ancestry, mutation reject, authentic approve, rollback); zero live model calls. |
| `rollback-ancestry.json` | Director reproduction: approve v1 → v2 → undo → approve v3 from v1 → undo restores v1; repeated undo reports nothing. |
| `demo-seed.json` | Seeded memories (ids, statuses), retrieval exclusion of the superseded palette, and idempotence after a second seed. |
| `guard-advisory.json` | Mutation findings citing the child-safety decision; authentic C has zero findings; approval never blocked. |
| `memory-influence.json` | Machine-readable A/B/C summary (accent hexes, rendered coverage, prompt parity, limits). |
| `memory-influence.md` | Reviewer-facing summary table. |
| `memory-influence.html` | Source of the side-by-side figure (labels authenticity and limits). |
| `built-server-health.json` | Production build startup + `/api/health`, `/api/live`, and Host-header rejection. |
| `screenshots/` | UI evidence and rendered game previews (below). |

## Screenshots

| File | Shows |
| --- | --- |
| `01-forge-v1-preview.png` | Forge with the seeded v1 game playable, `approved: v1`. |
| `02-memories-list.png` | Three decisions: 2 active, 1 superseded. |
| `03-constraint-detail.png` | Child-safety constraint with provenance and scope. |
| `04-palette-supersession.png` | Sunset decision superseded by the ocean correction, with reason in history. |
| `05-guard-advisory-mutation.png` | Advisory panel on the labelled mutation: `VIOLATION DETECTED`, two findings citing the child decision, one unverified palette note, explicit non-blocking disclaimer. |
| `06-review-mutation.png` | Full review page for the mutation (diff + panel) before rejection. |
| `07-rejected-mutation.png` | The mutation rejected; approved game untouched. |
| `08-guard-compliant.png` | Authentic C review: `NO VIOLATION DETECTED · SUPPORTED CHECKS` (not a compliance claim). |
| `08-review-compliant.png` | Full review page for the authentic modification. |
| `09-approved-v2.png` | Authentic modification approved as v2. |
| `10-rolled-back-v1.png` | Undo restored v1 and the badge/history agree. |
| `11-memory-influence.png` | Authentic A/C/B side-by-side with memory texts, accent hexes and rendered coverage. |
| `render-v1-baseline.png` | Rendered seeded v1 game (browser preview, not a verification screenshot). |
| `render-v2-authentic-c.png` | Rendered approved v2 game from the recorded authentic C source. |

## Reproduce

```bash
pnpm evidence:phase14a       # production pipeline, fake-Muse transport, real Chrome gate
pnpm evidence:phase14a-ui    # real API + Vite + Chrome screenshots (ports 8901/5201)
```

Both scripts require Google Chrome and no model credentials. They write only into this directory.
`pnpm verify`, `pnpm verify:runtime`, `pnpm verify:forge`, `pnpm eval:guard` and `pnpm build` are
recorded in `verification.json`.

## Reading the evidence honestly

- Screenshots `01`–`10` show `MODEL_PROVIDER=echo` in the provider panel because this is a
  deterministic rehearsal of the UI, not a live model run. The game bytes are the recorded
  authentic artifacts; the transport fixture is labelled in the same breath.
- The mutation is a test fixture, not model output. It was rejected, never approved as part of the
  demonstration.
- `08-guard-compliant.png` deliberately says “no violation detected by supported checks”; it is not
  a compliance certificate.
- `render-v*.png` are browser previews of the game, not screenshots of a runtime-verification
  result. The product UI exposes no such image.
- The A/B/C figure is authentic model output, n = 1 per condition, and reports that the remembered
  dark text colour was not honoured.

## Known gaps

- Authentic guard observations remain n = 1 artifact; the guard corpus is synthetic.
- No live Muse run and no demo video were produced in Phase 14A.
- `superseded-palette` still misses 8-digit RGBA hexes; tween-based flashes remain a known gap.
