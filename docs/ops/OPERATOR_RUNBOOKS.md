# Operator runbooks (roadmap §8)

Upgrade, rollback, incident and disaster-recovery procedures for a local/single-host
beta. Every command named here exists in this repository and was run at least once
during development; where a §8 requirement is **not** met, that is stated instead of
papered over. Accountable operator for this repo's deployments: the project maintainer
(`sidonsoft`) until a hosted deployment assigns one explicitly.

Related: [security.md](../security.md) (threat model, remote-access groundwork),
[../roadmap/POST_HACKATHON_ROADMAP.md](../roadmap/POST_HACKATHON_ROADMAP.md) §8,
[security.md → Remote-access groundwork](../security.md).

## Ground rules

- The database schema is **forward-only** (append-only `MIGRATIONS`, schema v8).
  There is no downgrade path. Never point `DATABASE_PATH` at an older backup to
  "undo" an upgrade — you would silently discard user data written since that
  backup, and the running app would then migrate it forward again.
- Take a backup before anything that touches the database:
  `pnpm db:backup` (timestamped copy next to the DB; owner-only file).
- Token mode (`ACCESS_TOKEN`) only changes authentication: `GET /api/health` is
  the open liveness probe; everything else under `/api` needs the bearer header,
  including `/api/live`.

## Upgrade

1. `pnpm db:backup` — refuse to proceed if it fails.
2. Check out the new release (git tag or commit) in the app checkout.
3. `pnpm install --frozen-lockfile && pnpm build && pnpm verify`
   (lint, typecheck, tests; keep the gates, do not skip on the deploy host).
4. Restart the server. `openDatabase` applies any pending migrations at startup
   and startup logs the schema version.
5. Confirm posture: `curl -fsS localhost:8787/api/health` (200 + `forge` summary),
   `curl -fsS localhost:8787/api/meta` (`safety.authentication`, provider,
   `errors.catalog_version`).

**Migration rehearsal (recommended before production upgrades):** copy the live DB
file to scratch and let the new build migrate the copy:

```bash
cp "$LIVE_DB" /tmp/rehearsal.db
DATABASE_PATH=/tmp/rehearsal.db pnpm db:migrate   # prints applied versions
```

Forward repair, not backward restore: if a migration is wrong, fix forward with a
new migration (never edit a shipped migration) or restore from the step-1 backup
accepting the write loss (see DR).

## Rollback (application code)

1. Check out the previous release; `pnpm install --frozen-lockfile && pnpm build`.
2. Restart against the **current** database — older app versions must tolerate the
   newer schema. If they do not, do not roll the app back; fix forward, or restore
   the database (DR) to the moment you upgraded, accepting any writes after it.
3. Verify as in Upgrade step 5.

## Incident triage

Read-only first, from the server itself (all JSON):

| Question | Endpoint / source |
| --- | --- |
| Is it alive, and what does storage think? | `GET /api/health` — liveness plus the store-wide `forge` summary (storage state, open/acknowledged notices, interrupted jobs, up to five issues). Open without a token even in token mode. |
| Which trust model is active, which provider, which error codes exist? | `GET /api/meta` — `safety.authentication` (`loopback-only`/`shared-token`), provider + `forge.observed_model`, `errors` pointer. |
| What can integrators expect on failure? | `GET /api/errors` — versioned catalogue that mirrors the real mappings (drift-gated by tests). |
| A Forge project shows a recovery banner / `state_corrupt`? | `GET /api/forge/projects/<id>/recovery/state` (bounded raw bytes, surviving versions) → `POST .../recovery/repair` (archives damaged bytes first) → `POST .../recovery/ack`. |
| What did the agent actually do? | Tool audit (`tool_calls` table, surfaced per session in the Studio) and memory revision history — records are append-only; nothing is silently rewritten. |
| Provider failing? | 503s carry specific codes (`provider_unavailable`, `provider_auth_failed`, …) listed in `/api/errors`; provider status is echoed in `/api/meta.provider`. Logs warn with redacted detail. |
| Server logs | Structured JSON on stdout (`LOG_LEVEL`, default `info`). Secrets are redacted in logged provider details. |

Escalate to DR only when storage reports unrecoverable damage AND the guided
repair path (`recovery/repair`) refuses or cannot restore acceptable versions.

## Disaster recovery (database)

Backups: `pnpm db:backup [directory-or-file]` — an online SQLite snapshot safe to
take while the server writes; destination is created owner-only (`0600`).

Suggested schedule for a persistent deployment (roadmap RPO ≤24h):

```cron
17 3 * * * cd /path/to/muse-recall && pnpm db:backup /backups/muse-recall >> /var/log/muse-recall-backup.log 2>&1
```

Restore (isolated first — this is deliberate, decision D047-era policy):

```bash
pnpm db:restore /backups/muse-recall/muse-memory-lab.db.backup-<stamp> --into /tmp/verify.db
# check the printed counts and schema version, then decide:
pnpm db:restore /backups/.../backup-<stamp> --into "$LIVE_DB" --force   # live replacement
```

`db:restore` runs `PRAGMA integrity_check` before reporting anything; a corrupt
backup aborts loudly. The live replacement needs the explicit `--force` precisely
so an operator never clobbers a live DB by typo.

Freshness without grepping logs: `curl -fsS localhost:8787/api/health | jq .alerts.backup`
reports the newest next-to-DB snapshot's age and an `ok`/`stale`/`missing` state
(threshold `ALERT_BACKUP_MAX_AGE_HOURS`, default 24; snapshots in operator-chosen
directories are that cron's own bookkeeping).

**Drill:** `pnpm backup:drill` performs seed → backup → destroy → restore →
record-parity verification plus the clobber-guard refusal, in a throwaway temp
directory — safe to run any time, and it runs on every CI push. It prints its own
restore+verify timing with a warning: a single local file restoring in
milliseconds is **not** evidence for the hosted ≤4h recovery-time target (§8);
that target is untested and effectively unassigned until a deployment exists.

## What §8 still does not have (stated, not hidden)

- **Alerting:** the full signal→consumer chain now exists (D050 + D051,
  2026-10-30): `GET /api/health` carries `alerts.{backup,storage,provider}`,
  and **`pnpm ops:alert-prober [base-url]` is the consumer** — cron-ready,
  exit 0 healthy, 1 findings (one `ALERT component=state: detail` line each
  on stdout), 2 unreachable/outage. Token mode: set `ACCESS_TOKEN` and it
  sends the bearer. Version skew is handled honestly (`alerts=absent` when a
  server predates the block). Live-proven: on a fresh file database the
  prober exits 1 with `backup=missing`; after one `pnpm db:backup` it exits
  0 with `ALERT none`. Re-proven 2026-10-31 from a **clean clone** of
  `integration` (install → build → `demo:seed` → server → prober): same
  verdicts, zero quickstart deviations; the operator chain also matches the
  README (a judge following it hits no missing steps).
  ```cron
  */30 * * * * cd /path/to/muse-recall && pnpm ops:alert-prober >> "$ALERT_LOG" 2>&1
  ```
  Wrapper note: through the pnpm workspace runner, an exit-1 finding also
  surfaces as pnpm's own `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` bookkeeping.
  The exit code and the `ALERT` lines are the contract; if you want stdout
  to carry nothing but contract, invoke the script directly
  (`node --import tsx apps/server/src/scripts/alert-prober.ts <url>`).
  What STILL keeps G4 unmet until an operator does it: installing that cron,
  and wiring cron mail/a forwarder to something that wakes a human. The
  prober prints findings; it never pages anyone by design. `alerts` never flips the
  top-level `status`: liveness stays the server-alive verdict.
- **RPO/RTO numbers for a hosted deployment:** unmeasured; the drill demonstrates
  the procedure, not the target.
- **Multi-host or identity-aware operations:** out of scope (see security.md §
  Remote-access groundwork).
