# Current README interface captures — 29 October 2026

Captured from the merged application at `4b56851`, with disposable databases and workspaces,
using real API and React UI flows in managed Chromium. All six PNGs are 1600 × 1000.

| Capture | Content | Reproduce |
| --- | --- | --- |
| `studio-approved.png` | Farmyard Memory Match v2, current project decisions and version history. | `pnpm exec tsx scripts/capture-readme-studio.ts` |
| `conversation.png` | A response built from the actual retrieved project memory, with evidence expanded. | `pnpm exec tsx scripts/capture-readme-surfaces.ts` |
| `planning-form.png` | A schema-validated declarative planning form. | same |
| `tool-approval.png` | A real pending `task.create` call awaiting approval. | same |
| `memory-detail.png` | Superseded sunset decision, active ocean replacement, provenance and history. | same |
| `memory-retrieval.png` | Forge retrieval mode, pinned records, scores, exact rendered cost and exclusions. | same |

The Studio script transports the recorded Phase 12 C-v2 application bytes through the fake-Muse
fixture, then uses the production validation, runtime check and approval paths. The current Guard
abstains on that recorded mixed palette; the approved-state panel reports `NOT EVALUATED`.
The capture does not imply a new live model run or a clean Guard pass.

The supporting script uses an offline scripted EchoProvider through the production server.
Its responses, declarative form and tool proposal are deterministic fixtures; memory retrieval,
correction, schema validation, tool-call persistence and the UI are real production paths.
The header identifies the provider as offline. No paid or live inference is performed.

The retrieval capture deliberately sets the visible **Max memories** control to **2** so the full
explanation and one exclusion fit. Forge's default remains **6 memories / 3,000 characters**.

Both scripts allocate free ports, clean up their own servers/browser and temporary state, and
fail on browser or API errors. Earlier screenshots and historical evidence are preserved.
`SHA256SUMS` records the final captured bytes.
