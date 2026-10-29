# Housekeeping audit — 29 October 2026

Scope: `sidonsoft/muse-recall` at `main` `49e7ed1` and `sidonsoft/muse-recall-website` at `main`
`42a7759`. Audit performed before any change; fixes are listed in
[CLEANUP_CHANGELOG.md](CLEANUP_CHANGELOG.md), validation in
[FINAL_VERIFICATION.md](FINAL_VERIFICATION.md).

Severity: **High** = would mislead a judge or break a journey; **Medium** = visible defect or
documented inaccuracy; **Low** = hygiene; **Info** = checked, nothing to do.

## Summary

The codebase is in good shape. Lint, typecheck, 728 tests, production build, the 32-check
Studio browser workflow, the origin-guard check and all three research verifiers pass on a clean
checkout. All 1,500+ evidence checksums verify. No secrets, no TODO/FIXME, no debug logging in
application code, no vulnerable production dependencies. The real findings are a responsive
layout defect in the Studio below 1280 px, stale "repository is private / one Pages toggle"
wording now that both are resolved, and branch clutter.

## High

None open. (H-1 below was High at audit time and is fixed.)

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| H-1 | Docs | README opening line still said the website "goes live with one Pages toggle"; release state and status table said making the repo public was pending. Both are done (site live, repo public 29 Oct). A judge reading the first line would see an out-of-date claim. | **Fixed** |

## Medium

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| M-1 | Web app | Studio three-column grid collapses to one column below `xl` (1280 px), but rows were sized with `min-h-0` inside a fixed-height scroller, so the Development, Project memory and Preview panels overlapped at tablet (820 px) and phone (390 px) widths. | **Fixed** (`auto-rows-max` below `xl`; desktop unchanged) |
| M-2 | Web app | Top bar has a fixed 58 px height but wraps on narrow screens; the wrapped nav overlaid the page title and "System" was cut off at 390 px. | **Fixed** (min-height, horizontally scrollable nav) |
| M-3 | Docs | `docs/SUBMISSION_CHECKLIST.md` and `docs/submission/EVIDENCE_MAP.md` (gap 3) still described the repository as private. | **Fixed** (evidence-map note kept as written with a dated resolution line) |
| M-4 | Docs | README called the 2:46 cut "the fallback if the 2:50 cut is not published"; the 2:50 cut is committed and on the website. | **Fixed** |
| M-5 | Judge path | There is no hosted copy of the application. By design the API binds to loopback and has no authentication, so it cannot be safely exposed. Judges get the website + video (no setup), Codespaces (one click, offline provider) or a local clone. Codespaces has not yet been exercised in a real codespace. | **Open — owner action**: open the Codespaces badge once before submitting. See [RELEASE_READINESS.md](RELEASE_READINESS.md). |
| M-6 | Web app | When a project load returns HTTP 500, Studio shows the error banner but the panels read "No HTML application yet / no approved version", which looks like an empty project rather than a failed load. | **Deferred** (UX change, not a blocker) |
| M-7 | Testing hygiene | `pnpm verify:browser` writes its test memories ("Verification … use SQLite in WAL mode") into the same database as the seeded demo, and one appears in the `forge-demo` project's memory panel. Anyone recording or demoing after running it sees test data. | **Open — documented**; re-run `pnpm demo:seed` on a fresh `data/` before recording. Codespaces never runs it. |

## Low

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| L-1 | Code | `ConversationsView` took a `meta` prop used only in `meta?.phase ? 16_000 : 16_000` (both branches identical). | **Fixed** (prop removed) |
| L-2 | Repo | Research verifiers write `__pycache__/` into `docs/hackathon-evidence/phase16*/phase17`; not ignored. | **Fixed** (`.gitignore`) |
| L-3 | Docs | `scripts/verify-forge.ts` documented `FORGE_MUSE_BIN=tests/fixtures/fake-muse.mjs`; the server runs from `apps/server`, so the relative path silently never stages a job and the check times out. | **Fixed** (documents `$PWD/...`) |
| L-4 | Branding | `.env.example` header said "Muse Memory Lab". | **Fixed** |
| L-5 | Branding | Internal identifiers still use the old name: root package `muse-memory-lab`, `SERVICE_NAME`, the `/api/health` and `/api/meta` `service` literal, the default DB file `muse-memory-lab.db`, package scope `@mml/*`. Not visible in the UI. Renaming changes an API contract and existing users' DB path. | **Deferred** |
| L-6 | Branches | 38 remote branches. 11 are fully merged and referenced by no document; 7 are unmerged research/experiment branches; the rest are merged but cited in docs. | **Proposal only** — see [Proposed cleanup](#proposed-cleanup-needs-approval) |
| L-7 | Bundle | Web app ships one 495 KB (141 KB gzip) JS chunk with a 2.1 MB source map. Fine for a local app. | **Deferred** |
| L-8 | Code | `knip` lists 17 unused exports (constants exported for tests/diagnostics) and 7 scripts not wired to `package.json` (`capture-readme-*`, `phase12c-*`, `phase15a-*`). The scripts are how published evidence was produced. | **Keep** — reproducibility |
| L-9 | Website | `npm audit`: esbuild ≤ 0.24.2 via vite 5 (dev-server only advisory GHSA-67mh-4wv8-2f99). The deployed site is static and unaffected. Fix needs vite 6+ (breaking). | **Deferred** (website is being moved into this repo) |
| L-10 | Website | `pages.yml` comment says the deploy "fails harmlessly" until Pages is enabled; Pages is enabled. | **Resolved** — PR #19 replaced it with `.github/workflows/website.yml` |
| L-11 | Evidence | `phase16/protocol.sha256` and `phase16b/protocol-open.sha256` mix paths relative to their folder with one absolute `/Users/burnz/...` path. Every file verifies when checked from the right base; the files are protected and were not edited. | **Documented** |
| L-12 | Video | The website's `muse-recall-demo.mp4` and the project-files copy are byte-different from the repo copy, but stream hashes are identical (container remux only). The repo copy matches `V21_QA.md` (SHA-256 `4020c0c6…`). | **Info** |
| L-13 | Tests | 4 `forge-recovery` tests fail when the suite runs as root (they rely on `chmod` denying access). All 728 pass as a normal user, which is what CI and Codespaces use. | **Info** |

## Info: checked and clean

- **Secrets:** pattern scan of the tree and full history found only the redaction-test fixture
  `sk-abcdefghijklmnop1234`. `.env` is ignored; keys travel over stdin.
- **Dependencies:** `pnpm audit` (all and `--prod`): no known vulnerabilities.
- **TODO / FIXME / HACK / debugger:** none in `apps`, `packages`, `scripts`, `tests`.
- **Debug logging:** `console.log` only in the CLI scripts (`db-backup`, `migrate`, `purge`), where it is the output.
- **CI:** one workflow (`ci.yml`, verify + managed browser job), green on the last 8 runs; no duplication. Website: `site-qa.yml` + `pages.yml`, green.
- **Large files:** the only binary over 1 MB is the committed 12.7 MB demo video (intended). `.git` is 64 MB.
- **Evidence integrity:** every `SHA256SUMS` / `*.sha256` verifies; `verify:research`, `verify:research16`, `verify:research17` all PASS.
- **Links:** no broken relative links in README, `docs/README.md`, `docs/guide`, `docs/submission`, `docs/demo`, `.devcontainer/README.md`; all README anchors resolve. Repo and raw video URL return 200/206 now the repo is public.
- **Wiki:** `/wiki` did not return a page through this environment's proxy; confirm it is disabled in Settings → General → Features (owner action, per the in-repo docs decision).

## Proposed cleanup (needs approval)

Russell approved deleting the 11 branches below on 29 October 2026. This environment can only push to its own branch, so the deletion is done from GitHub's Branches page or a local clone. Branch deletion is reversible only if someone still has the ref.

**Delete (merged into `main`, referenced by no document):**
`claude/muse-recall-production-readiness-1a4837`, `claude/project-thread-58amcc`,
`claude/project-thread-5wp06b`, `claude/project-thread-8vszid`, `claude/project-thread-h82gzw`,
`claude/project-thread-id13r2`, `claude/submission-docs-v21-ac1165`,
`docs/refresh-readme-screenshots`, `fix/live-run-followups`, `harden/review-fixes`, `link-website`.

**Keep:** every `agent/*`, `experiment/*`, `release/*`, `harden/local-beta`, `fix/forge-*`,
`fix/guard-*`, `fix/preview-*` branch (cited in docs as provenance), the unmerged research
branches (`agent/phase11-release`, `agent/strata-phase11-memory`, `agent/strata-phase12d-guard-audit`,
`agent/strata-phase13-submission`, `agent/strata-phase14b-submission-audit`,
`claude/admiring-kilby-7f7211` — holds the Phase 17 pre-registration lock commit `6640e83`,
`experiment/muse-forge`, `experiment/product-validation`), and all tags.

**Website repo:** `deploy-ready`, `claude/project-thread-3j73cl`, `claude/project-thread-8vszid`
are merged/superseded; leave them until the website move into this repo is done.
