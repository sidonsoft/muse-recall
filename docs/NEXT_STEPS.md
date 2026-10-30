# Next steps

**Current milestone:** hackathon submission (owner actions in
[SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)), then local-beta hardening. The hardening
branch merged to `main` in PR #1. The application remains local, single-user, and loopback-only. This list is the
repository's working backlog; completed items stay for the audit trail.

## P0 — before calling the beta reliable

1. **Reconcile Phase 17 when it finishes.** — **Done (2026-10-29).** Phase 17 is merged
   (`53389a7`, `36fe700`): 480 runs, locked protocol, exact-p correction and review
   disposition published, `pnpm verify:research17` retained. No unfinished run was treated
   as a finding.
2. **Run both CI gates before integrating the hardening branch.** — **Done (2026-10-29).**
   The `verify` and `browser` gates ran before PR #1 merged (`12918fd`); submission
   snapshots, research evidence and tags are unchanged.
3. **Add a repair/restore path for `state_corrupt`.** — **Done (2026-10-30).**
   The server now refuses to present a malformed `state.json` as an empty project, which
   is correct but leaves the Studio unable to open that project until the file is fixed.
   Provide an explicit export/repair flow that preserves the damaged file and lets the
   user inspect job records. Shipped on `integration`: `GET .../recovery/state` inspects
   damage (failure mode, bounded raw bytes, surviving versions, job listing) and
   `POST .../recovery/repair` archives the damaged bytes before rebuilding state from
   surviving approved versions (PR #32); the Studio banner wires both, and the managed
   browser workflow corrupts `state.json` live and repairs through the UI as a standing
   gate (PR #33, 35 checks). Repair refuses on a valid state (`state_valid`, 409).
4. **Isolate the Forge worker from the server user.** — **Partial (2026-10-30).**
   The code-side seam landed: `FORGE_WORKER_WRAPPER` (absolute executable, pass-through
   probe at startup, boot refused on failure; decision D042) routes every Forge CLI
   launch through an operator wrapper — `setpriv` to a dedicated uid, systemd-run scope,
   or a container launcher, with a recipe in [security.md](security.md). Remaining: the
   operator-side provisioning itself (create the dedicated user, mount only the staging
   directory) is a deployment action outside this repository; the default local beta
   still runs the child as the server user.

## P1 — next hardening

5. **Make job persistence power-loss safe.** — **Done (2026-10-30).**
   Add `fsync` for the job/state file and containing directory if the beta needs stronger
   durability than atomic rename. Every Forge atomic write now fsyncs the temporary file
   before its rename and syncs the containing directory after: job records, `state.json`,
   promoted version bytes plus the versions directory entry, recovery acknowledgements,
   and the repair archive rename. File syncs are strict (a failure is a write failure);
   directory syncs are best-effort and documented, because platforms that refuse
   directory fsync must not break writes that are still atomic.
6. **Expand managed browser coverage.** — **Partial (2026-10-30).**
   Done: a second browser engine (managed Firefox as a CI matrix leg; Chromium keeps
   the required-check name), accessibility assertions (banner/navigation/main
   landmarks, role=status live notices, dialog focus handoff), and an
   interrupted-job scenario driven live end to end — SIGKILL mid-generation, restart,
   UI interrupted notice, job record kept, queue recovers. Live-model checks remain
   opt-in. Visual snapshot comparison landed the same day: three timestamp-free
   Studio regions (navigation, Development panel, Decision Guard advisory) are compared
   against CI-recorded per-engine baselines with a pixel budget; drift failures upload
   actual+diff PNGs; non-Linux local runs skip the stage honestly. The remaining piece
   landed the same day: observed Studio model identity is persisted end to end —
   `run.model.configured` frames are recorded per job (`model_observed`), surfaced in
   `/api/meta` (`forge.observed_model`) and the generation strip, and pinned by browser
   check #46 (D046). The protocol exposes it reliably: the verified CLI emits the frame
   whenever a model run actually starts.
7. **Remove the legacy raw `memoryBlock` input.** — **Done (2026-10-30).**
   Freeze a local prompt snapshot for the Phase 15A historical protocol, then delete the
   raw input path from production prompt construction. The historical wording is frozen
   in `scripts/lib/phase15a-prompt-snapshot.ts` (provenance recorded to `defe684`,
   byte-verified against the production builder at freeze time, and pinned by unit tests
   against the recorded fixtures); the production builder now renders structured
   retrieval records only, and the evaluation harnesses were switched to the structured
   path so measured prompts cannot drift from production again.
8. **Surface recovery issues in the System screen.** — **Done (2026-10-30).**
   The Studio banner reports them; add a read-only recovery summary to the System status
   page for operators who do not open a project. `GET /api/health` now carries a
   store-wide `forge` summary (storage state, open/acknowledged notice counts, current
   and startup interrupted-job counts, up to five issues), and the System screen renders
   it as a read-only panel. Acknowledgement and repair deliberately stay in the Studio
   project view.
9. **Adversarial boundary suite for the access-control layers (roadmap §5 release
   criterion).** — **Done (2026-10-30).** `tests/integration/adversarial-boundary.test.ts`
   (11 attacks, every CI push): Host+Origin consistent spoof refused by the host guard
   before routing; route-casing evasion never reaches routing with a mutation;
   `X-Forwarded-Host` laundering refused; `Sec-Fetch-Site: cross-site` with stripped
   Origin refused; health-exemption path-shape evasion (case, slash, POST) 401s while
   normalization to the same exempt route stays open-by-design; Authorization shape
   games (case, spacing, appended bytes, percent-lookalikes, wire-joined duplicates)
   all fail digest comparison; a valid token never overrides the host guard (wrong port
   400 authenticated) and is never CSRF clearance (cross-origin POST with a valid token
   403s); no response echoes the secret; the D045 posture (any Host name only with
   secret + exact port) is pinned so a regression is caught. Suite learned two honest
   lessons in review: `..` segments normalize to the same route before hooks see them,
   and inject cannot send real duplicate headers — the suite models what Node puts on
   the wire instead.
10. **Close the REST API remainders that block integration (roadmap §3): traversal and a
    machine-readable error catalogue.** — **Done (2026-10-30, D048).** `GET /api/memories`,
    `/api/memories/review` and `/api/sessions` all page with `limit`/`offset` and report a
    filter-wide `total` (the sessions `total` had been the page length — fixed to a real
    `COUNT(*)`, additive schema fields `limit`/`offset`). `GET /api/errors` publishes a
    versioned catalogue (now `catalog_version: 2`) across transport/session/memory/forge/
    provider groups, pointed to by `/api/meta.errors`; it mirrors the mappings the server
    actually performs, and boundary tests compare live responses against the published
    entries so drift fails CI. Both mappings the v1 catalogue had pinned as asymmetries
    were fixed when v2 shipped (storage failures → 500 `memory_storage_failed`; Forge
    schema failures → `validation_failed` with the standard detail shape) — see D054.
11. **Idempotency-Key replay for the retry-sensitive writes (last roadmap §3 remainder).** —
    **Done (2026-10-30, D049).** `Idempotency-Key` (single 8–128-char header) on
    `POST /api/memories` and `POST /api/forge/projects/:id/generate`: the first response is
    recorded in SQLite (schema v8, keyed by method + concrete path + key, 24h TTL purged
    lazily) and replays byte-identical with an `Idempotency-Replayed: 1` header — a retried
    generation spends model quota once. First-wins on diverged bodies (documented); an
    in-flight duplicate in this process gets 409 `idempotency_in_progress`; joined duplicate
    headers (comma) are refused as ambiguous; replay records are durable across restarts but
    deliberately absent from the export envelope. Sessions keep relying on the `session_busy`
    lock; proposals on content dedup — both documented in D049 rather than bolted on. The
    error catalogue gained both new codes, drift-gated as before.
12. **Alert signal groundwork for the §8 / G4 operational gap.** — **Done (2026-10-30,
    D050).** `GET /api/health` now carries `alerts.{backup,storage,provider}`:
    backup freshness vs `ALERT_BACKUP_MAX_AGE_HOURS` (default 24; judged by the
    `db:backup` name stamp next to the database — never mtime, malformed names
    ignored, `:memory:`/0 ⇒ `disabled`), storage ok + unacknowledged issue count,
    provider `ok/error/skipped`. Informational by design: alerts never flip the
    liveness `status`, and **notification delivery is still external** — G4's
    "working alerts" gate stays unmet until a prober pages someone. Unit +
    integration coverage (+7 tests) includes the stale-but-still-alive case.
13. **Alert consumer script closing the signal→finding gap (G4 groundwork).** —
    **Done (2026-10-30, D051).** `pnpm ops:alert-prober [base-url]`: cron-ready
    consumer of the health alerts block; exit 0 healthy / 1 findings (one
    `ALERT component=state: detail` line each) / 2 unreachable-or-outage;
    bearer header from `ACCESS_TOKEN` in token mode; version skew surfaces as
    `alerts=absent` (a stale deployment is a finding). Live smoke proven: fresh
    file DB → exit 1 `backup=missing`; after `pnpm db:backup` → exit 0
    `ALERT none`. G4 still needs the OPERATOR step (install the cron, wire cron
    mail to something that wakes a human) — now an install, not a build.
14. **Graph/timeline data surface for the G-9 remainder.** — **Done (2026-10-30,
    D052).** `GET /api/memories/graph`: excerpt nodes + timestamped supersession
    edges + bounded created/corrected events + honest `truncated`; project scoping
    parity with list(); deleted memories unreachable via graph walks. The Memory
    view now renders it fully: read-only event stream (`TimelinePanel`) plus an
    SVG relationship map with text fallback (`RelationshipMapPanel`); browser
    workflow 46→48 checks incl. cross-view navigation. **G-9 remainder closed.**

## P2 — explicitly out of scope for this milestone

- Authentication, hosted collaboration, multi-user namespaces, or network exposure.
- Embeddings/semantic retrieval, multi-file generation, or new model providers.
- Decision Guard rule-family breadth: **extended (2026-10-30, v1.5.0)** with autoplay-media and
  external-assets plus 22 corpus cases; it remains advisory.
- A verified self-contained HTML export (downloaded files currently lose the sandbox).

---

## Cadence — after the build-out, until judging locks the entry

The P0/P1 lists are executed (gap ledger: everything open is G-2, an operator
provisioning act, and G-6, deliberately post-submission). The working cadence
now is maintenance honesty, not new surface:

- Periodic doc re-audits: sweep every status claim in the living docs against
  code (the #60 pattern); counts (76 files / 922 tests / 3 skipped; 48 browser
  checks local, 49 with CI visual slots) re-stated only after a real run —
  the local gate itself was re-run at head on 31 Oct (after ~25 cadence
  merges): 48/48 checks green on darwin, no claim drift.
  Two reference audits ran at head on 31 Oct with clean results, recorded
  so they need not be guessed at: every `DNNN` cited in docs or code
  resolves to a defined decision (54/54, zero dangling — the D027 skip is
  now annotated in DECISIONS.md), and the pnpm-command audit — first run
  over the six living docs, then extended to ALL 127 markdown files in the
  repo — found zero phantom script references: every regex hit was a
  direct binary invocation (`pnpm vitest`, `pnpm tsx`), prose ("workspace",
  "scripts"), or a proposal stated as such ("for example `pnpm demo:offline`"
  in the readiness plan, which the shipped `demo:seed` + echo provider
  already satisfies). A judge typing any documented command hits no phantom
  step, in any file, not just the curated ones. The same full-repo sweep
  then checked every relative link in those 127 markdown files: zero
  broken. (Five apparent hits were `...mp4?raw=true` links — GitHub's
  raw-view query syntax; the mp4 blob exists on every branch, ffprobe'd
  in #116. Naive path checks flag these; future sweeps should strip the
  query first — noted so nobody chases five fake ghosts again.)
  - Re-witness rotation complete as of 31 Oct: every operator-facing claim
    has a witness AT post-cadence head — settings/tags census (2×, #91),
    judge demo seed path (2×, #93), local browser gate 48/48 (#94), MCP
    stdio seven tools + refusal path (2×, #95), alert chain all three
    prober exit codes (#96), live Muse opt-ins 3/3 → full 920-test suite
    green incl. opt-ins (#102), SSE composed with token mode (#103),
    idempotency wire incl. replayed-failure behavior (#104). Single-
    observation claims now reduce to the Codespaces path (GitHub-hosted,
    re-verifiable only there; its setup.sh portability fix landed in #76).
    Refinement from the 31 Oct structural audit of the judge one-click path:
    the FORWARDING MECHANISM itself is already exercised locally —
    codespaces-origin.test.ts replays the exact env triple (CODESPACES,
    CODESPACE_NAME, forwarding domain) and the rewritten Host/Origin pair
    through a real config load and real app — so what remains unobserved is
    only the platform's provisioning, not the repo's behavior on it.
    setup.sh's sequence also audited read-only: install -> .env from
    example (guarded, user .env respected) -> MODEL_PROVIDER=echo ->
    demo:seed; postAttach `pnpm dev`; image Node 24; both ports forwarded.
    A further script-reference audit over .devcontainer + workflows found
    zero drift (only prose false-positives), extending the documented-
    command guarantee to automation files.
  - Env-surface census (31 Oct, at head): `.env.example` vs `config.ts` —
    ZERO config variables missing from the example (ACCESS_TOKEN included),
    and the example's two extras are real usages elsewhere, not ghosts:
    `FORGE_RUNTIME_BROWSER` (forge runtime-check + verify scripts) and
    `MML_ENV_FILE` (config loader hint, read via process.env). The example
    file is a justified superset — an operator copying it hits no undefined
    variable and misses no defined one.
  - API route-table census (31 Oct, at head): all 52 registered routes vs
    the README API table — exactly one omission (`GET
    /api/sessions/:id/messages/:messageId`, added by this census); the
    other three apparent hits were regex artifacts of combined cells
    (`... repair · .../ack`, `accept / reject`, `export · import`) —
    lesson recorded: parse route tables verb-aware or check literal path
    containment.
  - Web→API call census (31 Oct, at head): every `/api/...` string
    referenced in apps/web (19 distinct) resolves to a registered route —
    the web client cannot call a dead path today. (The scanner's seven
    "unmatched" strings were all template-interpolation artifacts
    (`/api/memories/review$` etc.) — the third visit to this same false-
    positive family; the semantic answer is zero.) Reverse direction is
    NOT asserted: server routes unused by the web are fine — MCP, tests
    and operators consume them too.
  - Runtime-version promise census (31 Oct, at head): CI Node 24 =
    devcontainer image `javascript-node:24` = engines `>=24.0.0`;
    `packageManager: pnpm@10.32.1` is what pnpm/action-setup@v4 installs
    (no separate version field to drift), matching README's "10.x"
    requirement and its verified-10.32.1 line; the local witness Node
    26.8.1 satisfies `>=24`. The only Node 22 in the repo is
    `website.yml` — deliberate and self-documented: the landing page is
    a standalone npm project outside the pnpm workspace, so repo engines
    never apply to it. No version promise contradicts another.
  - Bench-artifact policy (31 Oct, after #117 caught real drift): retrieval
    `-latest` is regenerated at head (offline, deterministic); the real-Muse
    bench artifacts (`muse-overhead`, `context-efficiency`, `retrieval-eval`)
    stay at their self-dated 26 Oct runs because regeneration costs quota and
    model variance makes deltas non-comparable — their headers state the run
    date, and every doc quote was cross-checked against the artifact (16,630 /
    17,507 / +877 / 998 / 0.879≈"0.88×" all match; the Demo C "roughly halved"
    quote names its whole-task basis, and the SAME artifact records that the
    answering call costs +37 tokens — qualifier with claim, already). A doc
    quote may cite an artifact only as-of its header date; that is what keeps
    "latest" honest.
- Drift gates stay load-bearing: error-catalogue live probes, browser
  workflow on two engines, backup drill on every push. New asymmetries are
  either fixed in lockstep (v2 discipline, D054) or honestly catalogued.
- Lint floor raised: `biome check .` reports zero warnings repo-wide
  (since the last non-null assertions were removed in this PR); the
  historical 3-warning baseline is retired.
- No schema migrations, no contract bumps, no new surfaces before Nov 4
  unless a judge-visible defect demands it. Code flows only through
  integration PRs; `main` and the submission tags stay frozen until judging
  closes.
- At submission (owner, Nov 4): record the submitted SHA and tags in
  `docs/release/SUBMISSION_PRESERVATION.md`; after judging: G-6 identity,
  scoping, rotation, then G-2 provisioning follow-up.
- Post-judging owner decision — asymmetry pinned exactly (re-read from the API
  31 Oct): "Protect main" (ruleset 26184025) requires 2 checks — `Lint,
  typecheck, test, build` and `Managed browser workflow (fake provider)` —
  while "Protect integration" (26184026) requires those 2 PLUS
  `Managed browser workflow (fake provider · managed Firefox)`. So promotions
  to `main` gate on managed-Chromium but not managed-Firefox. Either align
  (add the third required context to 26184025 — one API call) or keep the
  asymmetry deliberately with a stated reason; both are owner calls, and as
  of this census both rulesets have
  `strict_required_status_checks_policy=false` (additional unknown statuses
  never block). Re-matched at head `4960c56` (31 Oct, after 20+ cadence
  merges): ci.yml emits EXACTLY the contexts each ruleset demands — the
  `verify` job's name plus the matrix `job_name` strings, Firefox leg
  integration-only — zero name drift; a required-check string silently
  missing would stall every merge, so this pair gets re-read whenever ci.yml
  or a ruleset changes (neither has, beyond adding 26245608).
- Post-judging contract completion — evaluated, not acted (pre-Nov-4 rule):
  five inline wire codes (`ui_generation_failed`, `surface_not_found`,
  `surface_already_submitted`, `tool_call_not_found`, `tool_call_not_pending`)
  are absent from the 45-code versioned catalogue; fix is one lockstep PR
  (catalogue entries + apiFailure refactor at the five sites + mirror-suite
  probes + ERROR_CATALOG_VERSION 2→3) — full detail in KNOWN_ISSUES KI-33.
- Post-judging cleanup candidate — evaluated, not acted (pre-Nov-4 rule): the
  history-action enum admits `'purged'` (CHECK in two migrations; shared
  `MEMORY_HISTORY_ACTIONS`) but NOTHING emits it: engine audit actions are
  created/updated/superseded/deleted/accepted/rejected/expired. And the value
  is structurally unsurfaced — history rows FK-cascade off the memory, so a
  'purged' audit row for a purged memory could never outlive the purge it
  would record. Post-judging options: (a) remove the value (migration +
  contract/census review; it also sits in the envelope schema, so import
  validation accepts it today), or (b) keep it and document the deadness in
  the schema comment. Owner call; either way code+catalogue+migration in
  lockstep per D042, no silent half-removal.

## Historical plan (Phase 6, kept for the development record)

> This section is superseded by the backlog above. It is retained so the earlier
> submission plan is not rewritten.

Feature freeze was in effect for the hackathon submission.

1. Read the Official Rules on the submission platform; confirm repository visibility, video
   length, disclosures, and deadline (currently documented as Nov 4, 9:00 PM ET).
2. Repository visibility: the repository is being made public so judges can open it without
   authentication. Nothing in the code depends on visibility.
3. Record the 3-minute video using `docs/VIDEO_STORYBOARD.md` and `docs/DEMO_SCRIPT.md` on a
   fresh database.
4. Complete the submission form with the repository URL, video URL, and the description in
   `docs/HACKATHON_SUBMISSION.md`.
5. Do not claim statistical significance: the comparison uses n=4 per configuration.

Deferred at that time: embeddings/semantic retrieval, additional model providers,
shell/filesystem/network tools, multi-agent orchestration, authentication, and hosted
multi-user deployment.
