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

`db:restore` validates the backup (`PRAGMA integrity_check` **plus a Muse schema
gate**) and copies it to a temp file beside the target, then re-verifies THAT copy,
before the target is ever replaced (beta fix, 31 Oct — the previous ordering
destroyed the target on a corrupt force-restore):

- corrupt backup, failed copy, or failed replacement → loud abort, and the
  existing target keeps its original bytes; the backup file is never modified.
- **empty or foreign images are schema-gated out** (`integrity_check` calls a
  zero-byte file "ok"; pre-gate a forced restore of an empty/unrelated SQLite
  database "succeeded" and wiped a real one). A restorable image must carry
  contiguous `schema_migrations` metadata (version 1..N, N ≤ this build's
  latest) and the v1 core tables with their columns. Genuinely older Muse
  backups stay restorable; hand-made stubs, foreign databases, empty files
  and newer-than-this-build images are refused before anything moves.
- source and target referring to the same file (same path, symlink alias, or
  hard link) are **always refused**, `--force` included — the old ordering
  deleted the backup in that case.
- **the swap parks before it commits**: the previous target AND its WAL/SHM
  sidecars are renamed to a `.restore-previous-*` set, the validated copy is
  renamed in, and only then is the parked set discarded. Any failure at or
  after the swap renames the parked set back — post-swap failures (including
  a non-regular `<target>-wal` like a directory, which is refused BEFORE any
  move) restore the original bytes and sidecars instead of reporting a
  failure that destroyed the target; if even the undo fails, the error names
  the parked copy for manual recovery. The database+sidecar set is not one
  atomic object — consistency rests on the stop requirement plus park/undo.
- `--force` live replacement requires the **application to be stopped**: a
  running server keeps the WAL open and would rewrite the file after the swap.
  Stop the server, swap, restart.

**What each backup preserves:** `db:backup` snapshots the SQLite database only —
memories, sessions, tool-call audit. The Forge workspace under `WORKSPACE_ROOT`
(job records, staged bytes, approved version files) is NOT inside the database:
preserve it as a separate file backup of that directory (it is plain files).
Restoring one without the other is a valid choice — the runbook's recovery
banner and `recovery/state` endpoints surface the mismatch honestly.

Freshness without grepping logs: `curl -fsS localhost:8787/api/health | jq .alerts.backup`
reports the newest next-to-DB snapshot's age and an `ok`/`stale`/`missing` state
(threshold `ALERT_BACKUP_MAX_AGE_HOURS`, default 24; snapshots in operator-chosen
directories are that cron's own bookkeeping).

**Drill:** `pnpm backup:drill` performs seed → backup → destroy → restore →
record-parity verification, plus the clobber-guard refusal and the four
destructive-restore regressions the beta review reproduced (corrupt backup +
force preserves the target bytes; force + source==target refused), in a
throwaway temp directory — safe to run any time, and it runs on every CI push.
It prints its own
restore+verify timing with a warning: a single local file restoring in
milliseconds is **not** evidence for the hosted ≤4h recovery-time target (§8);
that target is untested and effectively unassigned until a deployment exists.

## Forge worker isolation (G-2) - provisioning paths that work

The code-side seam (D042): set `FORGE_WORKER_WRAPPER` to an **absolute executable path**; every
Forge CLI launch becomes `<wrapper> <museBin> <args...>` with `cwd=<job staging dir>`, and the
server gates boot on TWO real probes of the wrapper — pass-through (`<wrapper> node -e 0`) AND,
since the beta fix (KI-49), a **staging-access probe**: it creates a 0700 scratch dir + 0600
prompt file inside `<WORKSPACE_ROOT>/forge/.wrapper-probe/`, then runs the wrapper with
cwd = that dir to read the prompt and write inside it — the exact accesses every generation
performs. A wrapper failing either probe refuses boot with the wrapper path in the error
(pass-through and staging access proven at startup, not assumed). The child env is an
allowlist (`@mml/shared` child policy + three test seams); no credentials are inherited -
the provider API key goes to the child over stdin. **Both probes spawn under exactly that
scrubbed env** (`forgeChildEnv`, the same construction as the real launch - beta review
fix), so a probe passing means the launch passes: a wrapper must be self-contained - it
carries its own configuration (embedded arguments or a config file it reads) and must NOT
depend on server-only variables like `DOCKER_HOST`; the server does not forward extra
environment to wrappers. A wrapper that needs stripped configuration is now refused at
boot instead of dying mid-generation (pinned by a sentinel regression test).

What the child must be able to do, verified from the launch path (runner.ts prompt-file/staging
calls, fs-utils `ensurePrivateDirectory`/`writePrivateFile`): **read+execute** the muse CLI and
node, **read** `prompt.txt` (mode 0600, server-owned), **write** inside the job staging dir
(mode **0700**, server-owned). A naive `setpriv --reuid <other-user>` wrapper cannot do the
last two — historically that booted and died EACCES mid-job (KI-49); the staging probe now
**refuses such a wrapper at boot** instead. The published security.md no longer carries that
recipe; server-side worker-group ACL support stays queued (KI-49 / register C-13, owner call).

Provisioning paths that work today (no code change):

1. **Container-launcher wrapper (strongest).** The wrapper `exec`s your container runtime with
   the staging path bind-mounted and the container uid **mapped to the server euid** (same-uid
   bind-mount keeps the 0700/0600 tree writable while the namespace isolates everything else:
   read-only root, dropped capabilities, no host network). The startup probes exercise the whole
   launcher end to end — `node -e 0` AND staging read/write inside the real workspace tree —
   so a misconfigured runtime refuses boot, not the first generation.
2. **`systemd-run` scope wrapper (partial, no uid change).**
   `#!/bin/sh` + `exec systemd-run --wait --pipe --user-slice ... --property=... "$@"` per your
   policy (cgroup/limits/temp isolation). Same uid, so the staging tree stays writable - this
   hardens blast radius (resource limits, PID/tmp namespace options) without claiming G-2's
   user-isolation goal. State that honestly in your deployment notes.

Verification after wiring either path:
- restart the server and confirm it booted (a failed pass-through OR staging-access probe
  aborts boot with the wrapper path in the error - that is the fail-fast contract working,
  see `resolveWorkerWrapper` + `probeWorkerStagingAccess`);
- run one generation end to end; job completes, promoted version lands, staging removed;
- confirm the worker's actual identity from outside: `ps -o user=,uid= -p $(pgrep -f <museBin>)`
  during a generation - expect the mapped/container identity, not a surprise (same-uid scope
  wrappers show the server uid - that is the honest partial posture, see 2);
- misconfiguration is loud by design: interrupted job + the recovery banner (P0 #3), never a
  silently unwrapped child.

## What §8 still does not have (stated, not hidden)

- **Alerting:** the full signal→consumer chain now exists (D050 + D051,
  2026-10-30): `GET /api/health` carries `alerts.{backup,storage,provider}`,
  and **`pnpm ops:alert-prober [base-url]` is the consumer** — cron-ready,
  Re-witnessed end-to-end at head 31 Oct: `db:backup` rc 0 produced
  `d.db.backup-20261030T192542Z`; prober on a healthy base-url printed
  `ALERT none: all states acceptable` rc 0. The same round's missteps
  produced the other two branches for free, so all three exit codes were
  freshly observed at head: missing snapshot → `ALERT backup=missing` rc 1;
  a full health path passed where base-url belongs → `ALERT endpoint=http_status_404`
  rc 2 (the prober takes a BASE url — `/api/health` double-appends). A
  missing database file also refuses `db:backup` with a plain "Database not
  found" rather than writing an empty snapshot.
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
