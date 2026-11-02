# Fresh-install rehearsal

Release gate §5 item 7 asks for a fresh-install demonstration. `pnpm verify:fresh-install`
rehearses it end to end and writes a record. This document states what the rehearsal
covers, what it found, and what it does **not** prove.

## What the rehearsal does

`pnpm verify:fresh-install` → `scripts/verify-fresh-install.ts`

| Step | What it refuses |
| --- | --- |
| clone this repository locally at the tested commit | a clone that is not the commit under test |
| `pnpm install --frozen-lockfile` | an install that changes the lockfile or the tree |
| install summary from real output | a dependency count that drifted from the lockfile |
| lint, product typecheck, test typecheck and the suite **inside the clone** | a clean clone that cannot check itself |
| `pnpm build` and `scripts/build-production-bundles.ts` | a clone that cannot build |
| build manifests in the clone | a bundle that names another commit, or a dirty tree |
| the documented first run | an app that never mounts, is not on the offline provider, logs a console error on any documented screen, or contacts a host outside the allowlist |
| the first run stopping | a listener left behind on `8787`/`5173` |
| media and database restore drills | a backup that cannot be restored |
| the newest production browser gate inside the clone | bundles that fail when nobody's `node_modules` was already warm |
| a live smoke without a credential | a harness that spends a provider call it was never authorized to make |

Each step keeps its exit code and a bounded, secret-redacted tail. The evidence
directory gets a `report.json` (checks, build identity, first-run observation) and
`environment.json` (platform, Node/pnpm versions, browser identity, whether provider
credentials are set — **presence, never values**).

`pnpm verify:first-run` is the same first-run check on its own: it starts
`MODEL_PROVIDER=echo pnpm dev`, opens `http://127.0.0.1:5173`, walks HTML Studio,
Memory, Conversations and System, and asserts the server reports the `echo`
provider, a `development` environment and no build identity (dev mode is not a
provenance-bearing artifact). Both browser legs of CI run it.

## Result on 2026-11-02, at `1d32761`

PASS, 17 checks (`test-results/fresh-install/2026-11-02-0613/`):

- clone at `1d32761da2a0`, clean tree;
- install reused 253 packages from the local store, **0 downloads**, lockfile and
  tree unchanged afterwards;
- `pnpm run verify` inside the clone: exit 0 in 39.6 s;
- production bundles built **by the clone**, naming the clone's own commit with a
  clean tree: server `26f285ab601a`, web `065ee809a766`;
- both documented ports answered in 5 981 ms, app mounted on the `echo` provider,
  environment `development`, no console errors on any screen, nothing contacted
  outside the allowlist;
- first run shut down with no listener left behind;
- media and database restore drills passed;
- the production browser gate passed inside the clone;
- a live smoke in the clone exited 2 rather than spending a call.

Standalone first-run check: PASS, 4 checks
(`test-results/first-run/2026-11-02-0612/`), 6 186 ms to ready.

Environment for those runs: `darwin arm64`, Node `26.8.1`, pnpm `10.32.1`, Playwright
Chromium `156.0.8078.4` (managed), `ffmpeg`/`ffprobe` present, no provider credential
exported into the rehearsal (checked, and the rehearsal refuses if one is).

## What it found

**KI-52 (fixed here).** Three sibling Studio panels each used `key={projectId}`, so dev
React logged "Encountered two children with the same key" on every mount. Production
React strips that warning, so four production-bundle gates and CI's browser legs were
silent about a defect a newcomer sees on the first screen. Keys are now prefixed per
panel; `verify:first-run` exists so the class cannot regress.

**KI-53 (recorded here, measured and partly fixed since).** The fresh app requests Phaser from
`cdn.jsdelivr.net` — the host the product allowlists in its prompt, its preview CSP and
its runtime network check. So the Studio preview of a game depends on the network even
though everything else about the beta is loopback. The gate now names the outbound hosts
it saw instead of reporting a clean "no network" line. What happens when the CDN is
unreachable was not measured at rehearsal time; it has since been measured, and the approval
refusal was found to blame the artifact instead of the network — see KI-53 for what the two surfaces
actually do and what `verify:runtime` now proves.

## What the rehearsal does not prove

- It clones over the local filesystem and installs from a warm pnpm store: "0 downloads"
  describes this machine, not a cold cache or a proxy-restricted network. A truly cold
  install is exercised by CI, which installs `--frozen-lockfile` from the registry.
- One machine, one platform. It does not prove Windows or Linux install behaviour, and
  the repository ships no installer or package, so "fresh install" here means "clean
  clone plus `pnpm install`", which is what the README documents.
- It does not exercise upgrades: no existing database, no migration path, no stale
  `node_modules`, no leftover `dist/`. A returning user's environment is a different
  rehearsal.
- The browser used is the Playwright-managed Chromium. A newcomer's own browser is not
  tested beyond what the other gates say.
- It proves the app **starts and the documented screens are reachable** with the offline
  provider. It is not a first-run *tutorial* check: the guided create-generate-approve
  walk is `verify:studio-workflow`'s job, and the live provider's first-run experience is
  a separate, authorized concern.
