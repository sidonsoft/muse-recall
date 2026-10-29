# Muse Recall in Codespaces

## Before you start

- You need a GitHub account. The codespace runs in your account and uses your Codespaces
  allowance while it is running, so stop or delete it when you are done
  ([your codespaces](https://github.com/codespaces)).
- The first start takes about three minutes. The editor can look empty while the container
  builds.
- VS Code asks whether you trust the authors of this workspace. Choose to trust it, or
  setup cannot continue.
- Setup installs dependencies, writes a local `.env` for the offline provider, seeds the
  demo project and runs `pnpm dev` in the terminal. The app opens in a new browser tab. If
  it does not, open the **Ports** tab and click the globe icon next to
  **Muse Recall (web)**.

## A five-minute walkthrough (offline)

Each step says what you should see.

1. **HTML Studio opens on the demo project.** The header reads **Muse Recall demo**
   (project `forge-demo`) with a **v1 approved** badge, and the preview shows the approved
   game.
   **Project memory** on the left lists two **ACTIVE** decisions (an ocean palette and a
   child-safety rule) and one **SUPERSEDED** decision (a warm sunset palette).
2. **Open the superseded decision.** Choose **Open Memory**, then click the sunset palette
   card. The detail panel shows **SUPERSEDED BY** with the active ocean palette, and its
   **History** shows *created* and then *superseded*, with the reason "Creative direction
   changed from a warm sunset mood to a cool ocean mood."
3. **Follow the replacement.** Click the ocean palette card. It shows **REPLACED 1
   EARLIER RECORD** (the sunset palette) and a history entry *created by correction*. The
   old decision is kept for audit; it is not deleted.
4. **Explain what the next generation would receive.** Open the **Retrieval explanation**
   tab, keep project **forge-demo** and mode **Forge (Studio)**, type
   `Change the colours of the game` and choose **Explain**. You should see **2 selected**:
   the child-safety rule and the ocean palette, each with its score breakdown, and the
   prompt block size. The superseded sunset palette is not among them. That is the point of
   a correction.
5. **Check the version history.** Back in HTML Studio, the **Review** column shows
   **No staged change** and, under **Version history**, **v1 Demo baseline (recorded real
   Spark generation)** marked *current*.
6. **Read the Decision Guard panel for what it is.** It says **NOT EVALUATED** here. The
   Guard checks a *staged* change against active decisions, and the seeded project has no
   staged change. In the demo video (at 1:20) it flags a change that brings back the sunset
   palette; it is advisory and never blocks approval.
7. **Optional: make a correction yourself.** In Memory, open a decision and use
   **Correct memory**. The correction becomes the active record and the old one moves to
   superseded, exactly as in step 2. Run step 4 again to see retrieval follow it.

## What needs the Muse CLI

The codespace runs on the deterministic offline provider (`MODEL_PROVIDER=echo`). It is
**not a model**, and the UI labels it as one. Generating a new app or a change (**Generate
change**, **New app**) needs the Meta Muse Code CLI, which is not installed here. Those
buttons are disabled, and a note next to them explains why. For the complete generate,
review, approve and roll back loop, watch the 2:50
[demo video](../docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true), recorded from a
live Muse Spark session. To run it with Muse yourself, see the main
[Quickstart](../README.md#quickstart).

## Checks you can run

```bash
pnpm verify    # lint + typecheck + the full test suite
pnpm build     # production web + server build
```

## Notes

- No secrets are needed or stored. `.env` is created from `.env.example` and is ignored
  by git.
- The API still binds to loopback only. Codespaces delivers the app's requests with
  `Origin: https://localhost:5173`. Only when it runs inside a codespace, the server also
  trusts that origin and the codespace's own forwarded address
  (`apps/server/src/codespaces.ts`). Other sites, ports and codespaces are still rejected.
- To start over, stop `pnpm dev`, delete `data/` and `workspaces/`, then run
  `pnpm demo:seed` and `pnpm dev` again.
