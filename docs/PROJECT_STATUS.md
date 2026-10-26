# Project status

**Last updated:** 2026-10-27
**Milestone:** Phase 1 — Foundation
**State:** Complete and verified

## Implemented

### Repository and tooling
- pnpm monorepo: `apps/server`, `apps/web`, `packages/{shared,memory-engine,muse-provider}`.
- TypeScript 7 strict mode across all packages (verified: `pnpm typecheck`).
- Biome 2.6 for lint + format (verified: `pnpm run lint`, zero errors).
- Vitest 5 with workspace aliases to TypeScript sources — no build step needed to test.
- GitHub Actions CI: install, lint, typecheck, test, build on Node 24.
- `.env.example`, `.gitignore` (data, secrets, build output), LICENSE (MIT).

### Backend (`apps/server`)
- Fastify 5 app factory (`buildApp`) so tests exercise the production wiring.
- Config loader with Zod validation; invalid values fail startup naming the variable.
- Routes: `/api/live`, `/api/health`, `/api/health?probe=live`, `POST /api/health/muse`,
  `/api/meta`, `POST /api/provider/generate`.
- Uniform `{ ok, data } | { ok, error: { code, message } }` envelope, 404 handler,
  error handler that never leaks stack traces.
- Content-type parser that treats an empty JSON body as `{}` (fixes a real 400 that
  broke the live-check button).
- `ProviderHealthTracker`: observational provider state, 60 s cache, single-flight,
  concurrent-safe — a page refresh cannot burn quota.

### Persistence (`packages/memory-engine`)
- `node:sqlite` connection layer with WAL, foreign keys, busy timeout.
- Versioned migration runner (append-only, one transaction per migration, recorded in
  `schema_migrations`).
- Migration 1: `projects`, `memories` (typed, scoped, sourced, validated, with
  `content_hash` and `tags`), `memory_supersessions`, `memory_history`, and an FTS5
  index kept in sync by triggers.
- Database health probe that performs a real write/read inside a transaction and rolls
  it back, so "the file opened" is never mistaken for "the database works".

### Muse integration (`packages/muse-provider`)
- `ModelProvider` interface with `capabilities()`, `generate()`, and optional `stream()`,
  plus discriminated `ModelEvent` and coded `ProviderError`.
- `MuseCliProvider`: real `muse exec --json` invocation, JSONL frame parsing, streaming
  deltas, usage aggregation across models, prompt-file transport, hermetic flags, hard
  timeout with SIGTERM/SIGKILL escalation, spawn-failure detection, and protocol
  failure detection when no terminal frame arrives.
- `EchoProvider`: deterministic offline provider, explicitly labelled as not a model.
- Verified facts recorded in [muse-integration.md](muse-integration.md).

### Frontend (`apps/web`)
- React 19 + Vite 7 + Tailwind 4, dark single-theme design system with tokens.
- Three-pane layout: sidebar, workspace, context inspector.
- Typed API client that re-validates every response against the shared Zod schemas.
- System screen: API/database/provider cards, live Muse check button, provider bench
  for a real bounded model call, and a machine-sourced "what is actually working"
  list read from `/api/meta`.
- Inspector shows agent state, retrieved memories, tool activity, last call usage,
  provider identity, and safety posture — honestly reporting "none yet" where Phase 2+
  owns the feature.
- Unbuilt sections state their delivery phase instead of showing fake data.
- Connection-error screen with the exact command to start the API.

## Verified

Every claim below was produced by running the command on the reference machine
(Node 26.8.1, pnpm 10.32.1, Muse Code 1.4.13).

| Command | Result |
| --- | --- |
| `pnpm run lint` | 0 errors, 0 warnings |
| `pnpm run typecheck` | 5/5 projects clean |
| `pnpm test` | **70 passed**, 3 skipped (live suite opt-in) |
| `MML_LIVE_MUSE=1 pnpm test` | **72 passed** — includes real inference (5.6 s), structured output (4.1 s), streaming (4.3 s) |
| `pnpm muse:probe` | Real reply `"READY"`, 5,538 ms, 16,630 input / 17 output tokens |
| `POST /api/health/muse` | Live Muse check succeeded: 3,637 ms, model `muse-wonder-1.0` |
| `pnpm exec tsx scripts/verify-ui.ts` | UI rendered, DB round-trip verified in-browser, live Muse check via the button, bench reply received, **zero console errors, zero HTTP errors**. Screenshots: [overview](assets/phase1-ui.png), [real model reply](assets/phase1-ui-bench.png) |
| `pnpm build` | Web bundle 345.68 kB (105.22 kB gzip), CSS 23.75 kB (5.21 kB gzip); server bundle 45.2 kB |
| `node dist/index.js` (bundled) | Served `/api/health` and `/api/provider/generate` correctly |

Test breakdown: memory schemas 15, memory engine 15, Muse provider 15, config 8,
HTTP contract 16, live Muse 3.

## Failed / not attempted

- **Nothing in Phase 1's scope failed.**
- Phase 2–6 features are not started and are marked `not_implemented` /
  `schema_only` in `/api/meta` and in the UI.

## Blockers

None requiring user input. Two environment observations worth noting:

1. `muse usage` reports `credential_rejected` on this machine while inference works
   normally. Per-run usage is still available in `run.usage` when the allowance
   endpoint cooperates; the adapter treats usage as optional. Not blocking.
2. No public REST model endpoint is documented or discoverable, so the CLI is the
   integration path. This constrains latency (~3.5–5.5 s per call) but not capability.

## Next milestone

**Phase 2 — Memory engine.** Full plan in [NEXT_STEPS.md](NEXT_STEPS.md).
