# Current README interface captures — 29 October 2026

Captured from the merged application at `442d100` (`main` after PR #4), with disposable databases and workspaces,
using real API and React UI flows in managed Chromium. All six PNGs are 1600 × 1000.

| Capture | Content | Reproduce |
| --- | --- | --- |
| `studio-review.png` | Farmyard Memory Match v2 staged for review: preview, supplied project decisions, Decision Guard advisory, approve/reject. | `pnpm exec tsx scripts/capture-readme-studio.ts` |
| `conversation.png` | A response built from the actual retrieved project memory, with evidence expanded. | `pnpm exec tsx scripts/capture-readme-surfaces.ts` |
| `planning-form.png` | A schema-validated declarative planning form. | same |
| `tool-approval.png` | A real pending `task.create` call awaiting approval. | same |
| `memory-detail.png` | Superseded sunset decision, active ocean replacement, provenance and history. | same |
| `memory-retrieval.png` | Forge retrieval mode, pinned records, scores, exact rendered cost and exclusions. | same |

The Studio script transports the recorded Phase 12 C-v2 application bytes through the fake-Muse
fixture and captures the review state while v2 is staged, so the Decision Guard panel shows the
advisory recorded for that change. The current Guard reports `NOT VERIFIED` on the recorded
mixed palette (superseded warm and active cool colours both appear). After the capture the script
approves v2 through the UI, with the managed-Chromium runtime check, and confirms the published
bytes match the recorded source. The chat provider is the offline echo provider, so the header
does not credit a Muse model. The capture does not imply a new live model run or a clean Guard
pass.

The supporting script uses an offline scripted EchoProvider through the production server.
Its responses, declarative form and tool proposal are deterministic fixtures; memory retrieval,
correction, schema validation, tool-call persistence and the UI are real production paths.
The header identifies the provider as offline. No paid or live inference is performed.

The retrieval capture deliberately sets the visible **Max memories** control to **2** so the full
explanation and one exclusion fit. Forge's default remains **6 memories / 3,000 characters**.

Both scripts allocate free ports, start their servers with explicit settings and a minimal
environment (no local `.env` or exported Muse Recall settings), clean up their servers, browser and temporary
state, also on Ctrl-C, and fail on browser or API errors. Captures are written to the disposable
directory first and copied here only after every check passes; each successful run rewrites
`SHA256SUMS` from the published bytes. Earlier screenshots and historical evidence are preserved.
