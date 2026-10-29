# Muse Recall in Codespaces

This codespace is ready to use. Setup has already installed dependencies, written a
local `.env` and seeded the recorded demo project, and `pnpm dev` starts automatically in
the terminal.

1. Wait for the terminal to show the web server on port 5173. The app opens in a new
   browser tab; if it does not, open the **Ports** tab and click the globe icon next to
   **Muse Recall (web)**.
2. HTML Studio is the landing screen. Open project **forge-demo** to see the seeded game,
   its three decisions (one superseded by a correction), the retrieval explanation,
   Decision Guard and version history.

## What works without a Muse account

The codespace runs on the deterministic offline provider (`MODEL_PROVIDER=echo`). It is
**not a model** and is labelled as such in the UI. Browsing the project, its memory,
provenance, corrections and history all work. Generating or changing an app needs the
Meta Muse Code CLI, which is not installed here; see the main
[Quickstart](../README.md#quickstart) to run it locally with Muse.

The 2:50 [demo video](../docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true) shows the
live generate, correct and approve loop.

## Checks you can run

```bash
pnpm verify    # lint + typecheck + the full test suite
pnpm build     # production web + server build
```

## Notes

- No secrets are needed or stored. `.env` is created from `.env.example` and is ignored
  by git.
- The API still binds to loopback only. The one change for Codespaces is that this
  codespace's forwarded web address is added to `CORS_ORIGINS`, so the API's
  cross-origin guard accepts the app's own requests and still rejects any other site.
- To start over, stop `pnpm dev`, delete `data/` and `workspaces/`, then run
  `pnpm demo:seed` and `pnpm dev` again.
