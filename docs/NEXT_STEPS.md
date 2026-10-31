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
6. **Expand managed browser coverage.** — **Closed (2026-10-30; marker
   corrected 31 Oct - the body itself records "the remaining piece landed the
   same day", and G-10 in the inventory is Closed 2026-10-30. A register that
   says Closed while its twin says Partial is a contradiction even when the
   prose underneath is complete; correction marker keeps the era visible).**
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
    lazily) and replays byte-identical with an `Idempotent-Replayed: 1` header (wire form as
    emitted: `idempotent-replayed`) — a retried
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

## Working journal — archived, not maintained here

The P0/P1/P2 lists above are executed: the open gaps are G-2 (an operator
provisioning act) and G-6 (deliberately post-submission). The period from the
build-out to judging kept a running register of audits, witnesses and
self-corrections; on 31 Oct that journal was archived whole to
[`archive/2026-10-31-cadence-journal.md`](archive/2026-10-31-cadence-journal.md)
- preserved unedited, including every "I was wrong" line, but no longer appended
to. What survives as working documents: the wire-probe ledger below, the
post-judging action register below it, and this file's P0/P1/P2.

## Wire-probe ledger (consolidated 31 Oct)

What has been probed LIVE at head; the dated witness entries live in the archived
cadence journal above (preserved unedited).
Index only: each row says probe -> observed -> KI/section that owns the follow-up. Fresh servers,
echo provider, temp DBs, deleted after.

| Probed (all 31 Oct unless noted) | Observed at head | Owner |
| --- | --- | --- |
| malformed JSON body | 400 `internal_error` vs catalogue `bad_request` | KI-45 (fix queued) |
| oversized body (~1.1 MB > 1 MiB limit) | 413 `internal_error`, no 413 catalogue entry | KI-48 (fix queued) |
| `/api/errors` envelope | catalog_version 2, 5 groups, 46 entries / 45 codes | inventory §4 |
| `/api/health` | ok:true envelope, version 0.1.0 | security.md |
| HOST=0.0.0.0 without token | boot REFUSED, error restates invariant | SECURITY posture |
| HOST=0.0.0.0 + token | listens (auth required) | SECURITY posture |
| bearer gate (/api/projects, /api/live era) | 401/401/200; /api/health exempt; <16-char token boot-refused | SECURITY remote-access |
| `/api/meta` posture self-report | loopback-only / shared-token per mode | SECURITY groundwork |
| idempotent replay (socket level) | 201 replay byte-identical + `idempotent-replayed: 1` header | D049 |
| error envelopes (404/validation_failed) | not_found names METHOD+path; details[] path-level | inventory §4 |

## Post-judging action register (consolidated 31 Oct)

An INDEX, not a source of truth: each action's authoritative wording lives in its
home (cited). Nothing here authorizes acting before judging closes; ordering is
by trigger, newest obligation first. Conflicts resolve toward the home doc.

**A. Owner actions at submission (Nov 4, owner-only - never agent-side):**
1. Cut tag `submission-2026-11-04` from the shipped tree (auto-covered by ruleset
   26184029); Release + archive per SUBMISSION_PRESERVATION.md owner-act list.
2. KI-44 + KI-47 decision (same shape, decide together): promote the docs-only
   fix lines (2:46 pointer; root SECURITY.md landing that repairs CONTRIBUTING's
   404 on main) pre-tag - changes the SHA judges see - or ship as-is with both
   dead pointers recorded in KI-44/KI-47.
3. Record submitted SHA, tag derefs, and form fields in SUBMISSION_PRESERVATION.md.

**B. Immediately after judging closes (mechanical, no owner judgment needed):**
4. KI-43 + KI-45 + KI-48 lockstep PR: five inline codes into the catalogue,
   statusCode-400 parse failures -> `bad_request`, Fastify 413 -> new
   `payload_too_large` entry, + mirror probes - ONE version bump 2→3 carrying
   all three code-honesty fixes (32 entries -> 33+).
5. PR #28: fetch `refs/pull/28/head` (f1a16f791e49...), recreate branch, merge or
   close with reason (SUBMISSION_PRESERVATION.md recovery block).
6. SHA-pin the 17 floating `uses:` steps (9 actions) + per-file `permissions:`
   completion; website.yml pinning included once unfrozen (#162/#195 scope).
   Same tier: bump website/ vite to 8.x + esbuild (KI-46, semver-major,
   build-tooling only; re-audit clean after).
7. Test-typecheck tsconfig in CI (documented trade, #161). MEASURED 31 Oct: config
   staged as tsconfig.tests.json (unwired, gates unaffected); first honest run 270
   errors, 261 after module mappings (agent-core, ui-protocol, fastify via
   apps/server), 254 with allowImportingTsExtensions (the config is noEmit-only;
   tests and web sources use .ts specifiers as their vite/tsx convention). Zero
   plumbing noise left; all 254 are real fix work: TS2739 x87 partial fixtures,
   TS2345 x53, undefined-access x43 (TS18048/2532). The 87 fixture-vs-interface cases
   are a design decision (Partial<> types vs explicit fields), not mechanical;
   B-7 is now a scoped plan with a number, not a vague trade.
8. ~~Archive this cadence register into a dated log file~~ DONE 31 Oct: journal
   moved whole to archive/2026-10-31-cadence-journal.md; freeze-era watch bullets
   retired with it (no longer appended).

**C. Owner calls after judging (judgment required, evaluated already):**
9. Ruleset 26184025 Firefox asymmetry: add third required context to Protect-main
   or record the reason (NEXT_STEPS queue, API-re-read 31 Oct).
10. `'purged'` enum: remove (migration+contract lockstep, D042) or document
    deadness in the schema comment (NEXT_STEPS contract-completion bullet).
11. Historical remote heads - POST-PRUNE STATE (31 Oct, minutes apart):
    remote heads went 40 -> 9 in an actor-not-this-session event. ALL 32 vanished
    heads were ancestors of main per the same-day census (zero content lost -
    their commits ship inside main's history); survivors are exactly integration +
    main + the SEVEN divergent heads (4 agent/* + 2 claude/* + study02/
    checkpoint-1), SHAs on record (a806145b/4680ad34/84e6a8ce/e8fe9df7/
    6640e83f/50ec1fca/7a6cacf5), all re-verified still-divergent. Actor not
    attributable from available records (no DeleteEvents in the events API).
    Tags and refs/pull/28 re-verified intact. The review set IS now exactly the
    4 real content-diff reviews (agent/* quartet); the foreign trio stays foreign.
    PRE-STAGED 31 Oct (read-only): all four quartet heads fork from the SAME era
    point d35fa9d8 (27 Oct 11:44). Their union of files existing ONLY on the
    branches is 9 items: 3 superseded web components (ContextInspector, Sidebar,
    ForgeView - main's UI evolved past them) + 3 video-concept docs
    (MUSE_FORGE_VIDEO_CONCEPT, VIDEO_CONCEPTS, VIDEO_STORYBOARD) + 3
    submission-era records (DEMO_RUNBOOK, DEMO_SCRIPT_3MIN, PHASE14B_
    INDEPENDENT_AUDIT - the last exists NOWHERE else in the repo). Owner's
    post-judging call is keep/archive/let-go per file; evidence staged, no
    branch touched.
    32/39 are ancestors of main c32d03b (history fully merged); 7 DIVERGED -
    agent/phase11-release, agent/strata-phase12d-guard-audit, agent/
    strata-phase13-submission, agent/strata-phase14b-submission-audit (PHASE-era,
    content likely landed via later squash merges - diff-review to confirm), and
    3 foreign-lane heads (2 claude/*, study02/checkpoint-1) that are NOT mine to
    prune. Merge-record check (31 Oct): the 4 agent/* divergent heads have NO
    merged-PR record from their refs - pre-PR-discipline era branches; their
    content-landing is NOT proven by GitHub's records, so their review is a real
    content diff vs main (process/phase docs may exist only there - expect
    keep-with-purpose). Post-judging scope: 4 real content-diff reviews +
    3 foreign heads left alone + 32 merged heads are free calls
    (SUBMISSION_PRESERVATION.md).
12. Optional live rejection-probe of ruleset 26245608 shape (read-only API
    verification was sufficient so far; live probe needs post-judging freedom).

**D. Roadmap horizons (POST_HACKATHON_ROADMAP.md owns these; index-only):**
13. G-6 identity/scoping/rotation; 14. G-2 provisioning follow-up;
15. ConfidenceSchema relabel (roadmap G1); 16. G-1/G-3+ per roadmap sequence.

Dedup note: every entry existed in a home doc first; this register adds ORDER and
a single view, and was checked against KI-43/KI-45/preservation/roadmap texts,
not memory. No new actions invented here.

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
