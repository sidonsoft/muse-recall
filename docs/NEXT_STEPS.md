# Next steps

## Phase 6 — evaluation, demonstration, submission (current)

The product now demonstrates all three headline behaviours: memory across sessions, correctable
memory, and a generated interface that drives authorized work. Phase 6 is about proving it and
shipping it.

**Work items**
1. Run the baseline vs memory-enabled comparison through `tests/evaluation/harness.ts` with
   several tasks; report measured token/latency/correctness deltas.
2. Record the demo video following `docs/demo-script.md` (Demos A–E), on a fresh database.
3. Confirm repository visibility against the Official Rules and make the repo accessible to
   judges if required (currently private; commit permalinks 404 when logged out).
4. Final pass on `DEVELOPMENT_LOG.md`, `README.md`, screenshots, and known issues.
5. Feature freeze; tag the submission commit.

**Acceptance:** a reviewer can clone, run `pnpm install && pnpm dev`, and reproduce Demos A–E
from the script; the comparison report contains measured numbers, not claims.
