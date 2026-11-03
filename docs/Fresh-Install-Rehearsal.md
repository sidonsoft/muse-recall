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
| the documented first run | an app that never mounts, is not on the offline provider, is not a development build, fails to render any documented screen, logs a console error or an uncaught exception on any of them, or contacts a host outside the allowlist |
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
- **what a brand-new install actually contacts**: in the clone the walk contacted **no
  host at all**, while the same walk in the author's long-used checkout contacted
  `cdn.jsdelivr.net`. The difference is data, not configuration — the author's checkout
  holds a project whose artifact preview loads the engine, a fresh clone has no artifact
  yet. So KI-53's dependency bites once a generated game exists, not at bare first paint,
  and the gate accepts both because the rule is "nothing outside the allowlist";
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

## Re-run at `c9c18cf` (and earlier at `b698070`, after the first-run gate was hardened)

PASS, 17 checks — latest at `c9c18cfa5b4b` (`test-results/fresh-install/2026-11-02-1045/`, clone
bundles server `920c6036a536`, web `065ee809a766`), previously at `b698070ed151`
(`test-results/fresh-install/2026-11-02-0759/`): clone
on a clean tree, install with 0 downloads, `pnpm run verify` inside the clone, bundles built
by the clone naming its own commit (server `50edca5dea45`, web `065ee809a766`), the first
run, both restore drills, the production browser gate inside the clone, and a live smoke that
exits 2 instead of spending a call. No provider credential was exported. The environment
manifest records tool *presence*: on this machine `say` is not on the PATH that probe reads,
which would block the live audio fixture (`verify:batchd-live-smoke` without
`BATCHD_SMOKE_FIXTURE_ONLY=1`) and changes nothing about the rehearsal itself.

The second independent review found that the first-run gate asserted too little, so the gate
is stricter and the re-run proves the stricter version passes:

- **a screen must render, not just be clicked.** Clicking a nav control and waiting 800 ms
  counted HTML Studio, Memory, Conversations and System as visited even if the screen threw
  during its own effects. Each screen now has to show up: the active nav item carries
  `aria-current="page"`, and `<main>` must contain the screen's heading. HTML Studio is
  special-cased honestly — its heading is the *artifact* title, measured
  `["Farmyard Memory Match"]`, and there was no heading at all before the first click — so
  its marker is the named `Development` panel.
- **uncaught exceptions count.** `pageerror` is captured separately from `console.error`; a
  page can keep a populated `#root` and still be broken.
- **`/api/meta` must arrive in the envelope the server ships.** The reader used to fall back
  to an unwrapped body, so a failure envelope with a plausible `data`, or a proxy error page,
  would have read as success. It now requires `ok: true` plus an object `data`.
- **the environment is asserted.** A run reporting `production` is refused: that is not the
  first run the README describes, and it is exactly the build in which dev-only React
  warnings such as KI-52 are stripped.
- **timing is reported apart**: ~1.0 s to ready, walkthrough measured separately. A previous
  line folded an 800 ms-per-screen walk into "startup".

## Re-run at `9a5b610`: the rehearsal caught something real

The first run at this commit **failed** its in-clone `pnpm run verify`, on a test the author's
checkout had passed twice:

```
tests/unit/data-at-rest.test.ts > backs up a live WAL database with the same rows
online backup of …/source.db did not produce a usable copy after 15005ms (the online copy was
still running after 15000ms and was given up on); the partial copy was parked as
…/source.db.backup-….unfinished-f633f19d rather than left under the backup name
```

A clean clone reached a state the author's long-lived checkout did not: node:sqlite's online
backup promise does not settle inside a full-suite Vitest worker (KI-56). What made that
diagnosable was the product's new backup deadline — elapsed time, cause, and the parked partial
copy — where the older behaviour was a bare 30 s test timeout. The two remaining in-suite
call sites moved to the process shape the product uses (the WAL copy runs in a plain child
process; `health-alerts` uses a synchronous copy seam because what it judges is the health
signal), and the rehearsal then passed **17 checks** at this commit.

That is the argument for running the first run: not that the fresh clone is more correct, but
that it is a different environment, and this one was holding a defect.

## Re-run at `c456600`: the first run now asks for nothing

`test-results/fresh-install/2026-11-03-0032` — **PASS, 17 checks**, clone of `c4566008fba1`:

- install from the local store, no downloads, lockfile and tree untouched afterwards;
- `pnpm run verify` inside the clone: exit 0 in ~27 s;
- bundles built in the clone at the clone's own commit, clean tree: `treeClean: true`,
  `bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`,
  server `3c7c7f2e5ac4…`, web `34ee5eda1b6f…` — the **web bundle is byte-identical to the
  author checkout's** at the same release line, the server bundle differs from the author
  checkout's `fecff3f9b6cd…` only because the build manifest carries the commit it was built at;
- both restore drills green (database and media), the media backup drill in ~0.55 s;
- a live smoke refuses before any credential work: exit `2`,
  `live smoke: unconfigured (need FORGE_MUSE_API_KEY; no call made)`.

The first-run step now reads:

```
✓ the first run serves a mounted app on the echo provider, contacting nothing outside the
  allowlist (provider echo, environment development, outbound none)
```

**Do not read that line as proof that vendoring removed the dependency, and do not read the older
label as a claim that it was there.** A clone has no Forge artifacts, so the Studio has nothing to
preview and the walk makes no external request: earlier rehearsals report `outbound none` too, and
they prove only that a clone contacts nothing. What KI-53 / D059 actually changed is what happens
when there *is* an artifact to load, and that is measured by `verify:runtime` booting a game that
carries its engine with **no remote origin granted at all** (8 checks,
`test-results/runtime/20261103-0027/report.json`), not by this line.

What did change here is the label. It used to be fixed: "the only host the fresh app contacted is
the allowlisted Phaser CDN", with `no outbound requests at all` printed beside it when nothing was
contacted — a sentence describing a dependency the product no longer has for new artifacts. The
check now states the measurement: `the fresh app contacted no host outside localhost at all`, or,
when something was contacted, `every host the fresh app contacted is one the product allowlists`.

**The host still appears in a long-lived checkout, and for the honest reason.** The same gate run
in the author's own checkout (`test-results/first-run/2026-11-03-0035`, PASS 4) reports
`allowlisted: cdn.jsdelivr.net`. The reason is not new code: that workspace holds
`workspaces/forge/forge-demo/versions/1/index.html`, sha256 `79c9d67a…`, the Phase-12-era Spark
baseline artifact approved on 2026-10-31 — an artifact that predates the vendoring and keeps its
CDN reference, exactly as D059 decided shipped bytes are not rewritten. HTML Studio previews the
existing project, so the browser asks for the engine. A user with pre-existing games is therefore
in the documented case, not a leaked-dependency case: the preview CSP grants that one host for
that document, and the runtime report for it says `network_policy: cdn-allowlist`.
