# Known issues

Honest list of defects and limitations in the current build. Severity reflects impact
on the hackathon demonstration.

---

## KI-1 — Relative paths resolve against the package directory, not the repo root

**Severity:** Low (documentation/UX)
**Detail:** `DATABASE_PATH=./data/…` is resolved against the process working directory.
`pnpm dev` starts the server with `apps/server` as its cwd, so the database lands in
`apps/server/data/muse-memory-lab.db`, not `<repo>/data/…`. It is gitignored either
way.
**Why it exists:** Resolving against a discovered repo root would be magic that breaks
when the app is packaged elsewhere.
**Fix:** Use an absolute `DATABASE_PATH` in `.env` when the location matters. The
README states the behaviour.

---

## KI-2 — Per-run token usage can be empty

**Severity:** Medium (affects the evaluation story, not functionality)
**Detail:** `run.usage` sometimes reports `models: []` because the CLI's subscription
allowance endpoint returns `credential_rejected` on this machine, even though
inference succeeds. When that happens our token counts are zero rather than wrong.
**Fix (future):** Fall back to locally computed estimates and label them as estimates.
Never present an estimate as a billed number.

---

## KI-3 — ~16.6k token floor per Muse CLI call

**Severity:** Medium (cost and evaluation)
**Detail:** A one-word answer consumes ~16,630 input tokens because the CLI injects
its own agent system prompt, even with `--preset empty --no-foreign-personal-context`.
**Impact:** Context-efficiency comparisons must treat this as a constant baseline.
**Fix (future):** A direct API adapter, or a long-lived `muse serve` session, would
remove it. Neither is verified yet, so neither is claimed.

---

## KI-4 — No authentication or rate limiting on the API

**Severity:** Low locally, blocking for any deployment
**Detail:** The API binds `127.0.0.1` and has no auth, no per-user isolation, and no
rate limiting. Anything that can reach the loopback port can call it, including the
provider bench (which spends quota).
**Mitigation:** Loopback binding only. Documented in [security.md](security.md) as a
hard prerequisite for any non-local deployment.

---

## KI-5 — UI verification is a script, not a test suite

**Severity:** Low
**Detail:** `scripts/verify-ui.ts` drives the real UI with Playwright-core and fails on
console/HTTP errors, but it is not part of `pnpm test` and requires a running server
plus Vite.
**Fix (Phase 6):** Promote it to a proper Playwright test project wired into CI with a
managed web server.

---

## KI-6 — Unknown model ids silently fall back

**Severity:** Low (confusing behaviour, not data loss)
**Detail:** `muse exec --model does-not-exist` does not error; the CLI uses its default
and reports the requested id in `run.model.configured`. Our adapter reports what the
CLI says it resolved, which can therefore disagree with what was asked for.
**Mitigation:** The health check and probe display the model actually used.
**Fix (future):** Validate requested model ids against the advertised catalog and
reject unknown ones with a clear message.

---

## KI-7 — The provider bench is non-streaming

**Severity:** Low (cosmetic)
**Detail:** `POST /api/provider/generate` awaits the full response. Streaming exists in
the adapter and is covered by tests (including a live test), but the HTTP layer does
not expose it yet.
**Fix (Phase 3):** SSE endpoint plus a streaming chat view; the event model is already
designed for it.

---

## KI-8 — Single-writer assumption

**Severity:** Low for the intended use
**Detail:** SQLite runs in WAL mode, but the design assumes one local user and one
server process. Concurrent writers from multiple processes will contend on the busy
timeout.
**Fix:** Out of scope; multi-user hosting is explicitly excluded.

---

## KI-9 — Dark theme only

**Severity:** Cosmetic
**Detail:** The design system defines a single dark palette. `color-scheme` is pinned to
`dark` so form controls stay legible.
**Fix:** A light theme is a token-level change if needed later.

---

## KI-10 — `muse usage` fails on the reference machine

**Severity:** Informational
**Detail:** `muse usage` returns `usage refresh failed (credential_rejected)` while
`muse exec` works. This appears to be an allowance-endpoint issue specific to the
account/session, not an integration defect. Recorded so nobody debugs a phantom bug
during the demo.
