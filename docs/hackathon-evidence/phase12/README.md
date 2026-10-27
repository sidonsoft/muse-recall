# Phase 12 evidence

- `pilot.json` — A/B/C memory pilot: job ids, memory ids, request/prompt hashes, usage,
  validation, runtime approval, rollback, palette metrics, and the reconstruction check.
- `A-v2.html`, `B-v2.html`, `C-v2.html` — approved sources after the identical request.
- `A-v2.png`, `B-v2.png`, `C-v2.png` — screenshots taken immediately after approval (start
  overlay visible).
- `A-v2-visible.png`, `B-v2-visible.png`, `C-v2-visible.png` — screenshots with the overlay
  dismissed, used for rendered-pixel measurements.

Findings: A uses `0xFF7E5F` (sunset), C uses `0x4EA8DE` (ocean), B uses neither. Prompt hashes
reconstructed from production code match every job. Dark text colour was not applied in A or C.
No credentials are present in these files.
