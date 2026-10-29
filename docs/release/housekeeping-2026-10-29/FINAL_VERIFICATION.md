# Final verification — 29 October 2026

## Commits

| What | Repository | Commit |
| --- | --- | --- |
| Baseline (approved release candidate) | `sidonsoft/muse-recall` `main` | `49e7ed1` |
| Code and docs cleanup | branch `claude/project-thread-kbe9t7` | `5fb12df` |
| These reports | same branch | the commit that adds this folder |
| Website baseline (no changes made) | `sidonsoft/muse-recall-website` `main` | `42a7759` |

## Environment

Linux container, Node **v24.22.2** (official tarball, SHA-256 checked), pnpm **10.32.1** via
corepack, Playwright-core 1.64.1 driving Chromium 153.0.8010.12 headless. Outbound access to
`cdn.jsdelivr.net` and `*.github.io` is blocked by the sandbox proxy.

## Main repository

Run from the repository root after `pnpm install --frozen-lockfile`.

| Command | Baseline `49e7ed1` | After `5fb12df` |
| --- | --- | --- |
| `pnpm run lint` | exit 0, 232 files | exit 0, 232 files, 0 warnings |
| `pnpm run typecheck` | exit 0 | exit 0 |
| `npx vitest run` (as a non-root user) | 45 files, **728 passed, 3 skipped** | 45 files, **728 passed, 3 skipped** |
| `pnpm test` (as root, for reference) | 724 passed, 4 failed (`forge-recovery` chmod tests, root bypasses permissions) | not re-run as root |
| `DATABASE_PATH=./data/ci.db MODEL_PROVIDER=echo LOG_LEVEL=silent pnpm run build` | exit 0 | exit 0 |
| `MODEL_PROVIDER=echo LOG_LEVEL=warn pnpm verify:studio-workflow` | 32 checks passed | 32 checks passed |
| `pnpm verify:forge-workflow` | — | exit 0 |
| `MODEL_PROVIDER=echo pnpm verify:security` | PASS / PASS | PASS / PASS |
| `pnpm verify:formsandbox` | 7 checks passed | 7 checks passed |
| `pnpm verify:research` | PASS (32/32 raw hashes, 72/72 recovered) | PASS |
| `pnpm verify:research16` | PASS | PASS |
| `pnpm verify:research17` | PASS (17/17 locked paths, tag `phase17-preregistration`) | PASS |
| `pnpm verify:browser` (dev server, `MODEL_PROVIDER=echo`) | functional checks passed; 2 ✗ CDN console errors | 27 ✓, 2 ✗ — both `cdn.jsdelivr.net` blocked (Phaser) |
| `pnpm verify:forge` (dev server, `FORGE_MUSE_BIN=$PWD/tests/fixtures/fake-muse.mjs FAKE_MUSE_MODE=app`) | 14 ✓, 1 ✗ CDN | 14 ✓, 1 ✗ CDN |
| `pnpm verify:runtime` | fails: Phaser CDN unreachable from sandbox | not re-run (environmental) |
| `pnpm audit` and `pnpm audit --prod` | No known vulnerabilities | — |

Playwright note: the lockfile's Playwright wants Chromium build 1248; the container ships 1243,
so `PLAYWRIGHT_BROWSERS_PATH` pointed at a symlinked copy. CI installs its own matching build.

CDN check: the seeded Studio was loaded with requests to `cdn.jsdelivr.net` served from the
`phaser@3.80.1` npm tarball. The game rendered and the page logged **zero** console errors.

### Evidence checksums

```bash
for f in $(git ls-files | grep -E '(SHA256SUMS|\.sha256)$'); do
  (cd "$(dirname "$f")" && sha256sum -c --quiet "$(basename "$f")")
done
sha256sum -c docs/hackathon-evidence/phase17/protocol.sha256          # from repo root
```

All pass: `readme-2026-10-29` (6), `live-dsh-run-2026-10-29` (53), `phase15b/recovered` (72),
`phase16` (64), `phase16b` (69), `phase17` (1,205), `phase17/CORRECTIONS` (3),
`phase17/protocol` (17, repo-root relative). `phase16/protocol.sha256` and
`phase16b/protocol-open.sha256` verify from their own folder plus one entry recorded as an absolute
`/Users/burnz/projects/muse-recall-rc/demo/forge-baseline/index.html`, which matches
`demo/forge-baseline/index.html`.

Demo video: `docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4` SHA-256
`4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308`, 12,721,832 bytes, 170.474 s,
matching `V21_QA.md`. Not modified.

### Secrets

```bash
git grep -nIE '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_|xox[bap]-|BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{35})'
git log -p --all -G'(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY)'
```

Only hits: the redaction regex and its test fixture.

### Browser checks (manual scripts, Playwright)

- Viewports 1440×900, 820×1180, 390×844 on Studio, Memory, Conversations, System: no horizontal
  overflow; panel overlap at 820/390 present at baseline, gone after `5fb12df`; desktop unchanged.
- `/api/**` aborted: "Muse Recall cannot reach its local API" card with command and retry.
- `/api/forge/**` returning 500: error banner shown; panels read as an empty project (deferred).

## Website

```bash
npm ci
npm run site
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run qa
npm audit
```

Build OK (JS 194 KB / 61 KB gzip, CSS 31 KB, 40,888 chars prerendered). QA **26/26**, LCP 488 ms,
CLS 0. `npm audit`: 2 advisories in vite 5 / esbuild dev server only.

## GitHub

- `muse-recall` CI: last 8 runs on `main` and PRs succeeded (latest run 70 on `49e7ed1`).
- `muse-recall-website`: Site QA and Pages succeeded on `42a7759`.
- `https://github.com/sidonsoft/muse-recall` → 200; raw video → 206 (repo is public).
- `sidonsoft.github.io` is not reachable from this sandbox; the live site was not fetched here.
