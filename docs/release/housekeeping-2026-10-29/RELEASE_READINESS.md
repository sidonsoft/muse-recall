# Release readiness — 29 October 2026

**Verdict: ready to submit**, with one owner check (open the Codespaces badge once) and the
submission form still to send. Commands and raw results are in
[FINAL_VERIFICATION.md](FINAL_VERIFICATION.md).

## Validation results (on the cleanup commit)

| Check | Result |
| --- | --- |
| Lint and format (`pnpm run lint`, Biome) | Pass, 232 files, 0 warnings |
| Typecheck (`pnpm run typecheck`, all 9 workspaces) | Pass |
| Unit + integration + API contract tests (`vitest run`) | **728 passed, 3 skipped** (45 files) as a normal user |
| Production build (`pnpm run build`) | Pass (web 495 KB JS / 141 KB gzip; server 400 KB) |
| Backend Studio workflow (`verify:forge-workflow`) | Pass |
| Managed browser Studio workflow (`verify:studio-workflow`, same as CI) | **32/32** checks, no console errors |
| Browser smoke (`verify:browser`) | 27/27 functional checks; 2 console errors from the sandbox blocking `cdn.jsdelivr.net` (see note) |
| Studio browser workflow (`verify:forge`) | 14/14 functional checks; same CDN-only console errors |
| Cross-origin guard (`verify:security`) | Pass (foreign origin 403, same origin 200) |
| Form sandbox (`verify:formsandbox`) | 7/7 |
| Research verifiers (`verify:research`, `research16`, `research17`) | PASS, PASS, PASS |
| Evidence checksums (every `SHA256SUMS` / `*.sha256`) | All verify |
| Responsive layout (1440 / 820 / 390 px), all four views | No horizontal overflow; panel overlap fixed |
| API down / API 500 | Clear "cannot reach its local API" screen with retry; 500 shows a banner (see deferred M-6) |
| Website `npm run site` + `npm run qa` | Build OK, **26/26** QA checks (a11y, mobile, keyboard, LCP 488 ms, CLS 0, no-JS) |
| `pnpm audit` / website `npm audit` | 0 / 2 dev-only (vite/esbuild dev server; static site unaffected) |
| CI on `main` (GitHub Actions) | Green on the last 8 runs; website QA and Pages green |

**CDN note.** The seeded demo game loads Phaser from `cdn.jsdelivr.net`, which this audit
sandbox blocks. Serving the same Phaser 3.80.1 file locally, the Studio renders the game with
zero console errors (screenshot checked). On a normal network, in CI and in Codespaces the CDN
is reachable. It does mean the seeded game needs internet access to render.

## Critical journeys

| # | Journey | Verified by |
| --- | --- | --- |
| 1 | Create or open a project | `verify:studio-workflow` (keyboard open, project switch), `verify:forge` |
| 2 | Store project memory | Studio "Add decision" (`verify:studio-workflow`); Memory inspector create (`verify:browser`) |
| 3 | Retrieve relevant memory | Retrieval explanation and conversation retrieval across sessions (`verify:browser`); Forge retrieval tests |
| 4 | Review proposed changes | Staged preview, source, diff, Guard checks (`verify:studio-workflow`, `verify:forge`) |
| 5 | Approve or reject | Both, in both browser workflows |
| 6 | Persistence | API restart with the same DB/workspace; staged job restored and approved as v3 (`verify:studio-workflow`) |
| 7 | Correct / supersede memory | Correction links old ↔ new and keeps history (`verify:browser`) |
| 8 | Rollback | Rolled back to recorded parent v1 (both workflows) |
| 9 | Recover from API failure | Manual browser check: API unreachable and HTTP 500; integration tests for provider failures |

## Production infrastructure

| Area | State |
| --- | --- |
| Hosted demo | **None, by design.** The API refuses to bind to anything but loopback because it has no authentication. Judges use the website + video (zero setup), Codespaces (one click, offline provider, no key) or a local clone. No new cloud infrastructure was added. |
| Environment variables | One `.env` at the repo root, validated with Zod at startup; `.env.example` documents every key. |
| Secrets | No key needed for the offline demo. Muse keys are optional, passed to the CLI over stdin, redacted from logs, never in argv or child env. |
| Authentication | None; mitigated by loopback-only bind, a Host guard and an Origin guard on state-changing routes. Not deployable as a public service (documented in `docs/security.md`). |
| CORS | Allow-list (`CORS_ORIGINS`), default loopback only; Codespaces adds exactly its own forwarded origin. |
| Request validation / limits | Zod schemas on routes; 1 MiB body limit (separate cap for Forge modify). |
| Rate limiting | None (single local user). Generation is bounded per job instead. |
| Cost protection | `FORGE_MAX_CALLS=25`, `FORGE_MAX_INPUT_TOKENS=1.5M`, `FORGE_MAX_RUNTIME_MS=600000`, `MUSE_TIMEOUT_MS=120000`, `AGENT_MAX_OUTPUT_TOKENS`; quota fallback only when a fallback key is set. |
| Logging | Fastify/pino structured logs, `LOG_LEVEL`, redaction. |
| Health | `GET /api/health` (DB read check, provider status), `POST /api/health/muse` for a live call. |
| Build reproducibility | `pnpm install --frozen-lockfile`, `packageManager` pinned, Node ≥ 24 enforced. |
| Provider fallback | Explicit, labelled offline `echo` provider; never presented as Muse. No silent fallback. |

## Remaining risks

1. **Codespaces not exercised in a real codespace.** Medium. It relies on port forwarding with the
   origin allow-list. Mitigation: open the badge once before submitting; local clone and the video
   remain if it fails.
2. **Generation needs the Muse Code CLI.** Judges without it can browse the seeded project,
   memory, Guard and history but cannot generate. Clearly stated in README and guide.
3. **Seeded game depends on a public CDN** for Phaser. Low on any normal network.
4. **Running `verify:browser` against the demo DB adds test memories to the demo project.**
   Re-seed on a fresh `data/` before recording.
5. **Website moving into this repo** (separate thread). Its Pages URL must keep working or the
   README link must change with it.
6. **Official Rules** not yet confirmed against visibility, video length and disclosures (owner).

## Comparison with the approved release candidate

Baseline: `main` at `49e7ed1`. The cleanup changes two Tailwind class strings for narrow
layouts, removes one dead prop, and edits documentation. Server, memory engine, Decision Guard,
API contracts, schema, seeds, evidence and the demo video are unchanged. The same test counts,
the same 32-check browser workflow and the same verifier outputs pass before and after, and the
desktop Studio screenshot is visually identical.
