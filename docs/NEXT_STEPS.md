# Next steps

**Current milestone:** hackathon submission (owner actions in
[SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)), then local-beta hardening. The hardening
branch merged to `main` in PR #1. The application remains local, single-user, and loopback-only. This list is the
repository's working backlog; completed items stay, one line each - the full record lives in
DEVELOPMENT_LOG.md and the decision records.

## P0 — before calling the beta reliable

1. **Reconcile Phase 17 when it finishes.** — **Done (2026-10-29).** Phase 17 merged
   (`53389a7`, `36fe700`): 480 runs, locked protocol, exact-p correction and review
   disposition published, `pnpm verify:research17` retained.
2. **Run both CI gates before integrating the hardening branch.** — **Done (2026-10-29).**
   Verify and browser gates ran before PR #1 merged (`12918fd`).
3. **Add a repair/restore path for `state_corrupt`.** — **Done (2026-10-30).**
   `GET .../recovery/state` inspects damage; `POST .../recovery/repair` archives the
   damaged bytes and rebuilds from surviving approved versions (PR #32). Studio banner
   wired; the managed browser workflow corrupts and repairs through the UI as a standing
   gate (PR #33). Repair refuses on a valid state (`state_valid`, 409).
4. **Isolate the Forge worker from the server user.** — **Partial (2026-10-30).**
   Code seam landed: `FORGE_WORKER_WRAPPER` routes every Forge CLI launch through an
   operator wrapper (boot refused on probe failure, D042; `setpriv` recipe in
   [security.md](security.md)). Remaining: the operator-side provisioning itself
   (dedicated uid, minimal mounts) - a deployment action, not a code change.

## P1 — next hardening

5. **Make job persistence power-loss safe.** — **Done (2026-10-30).**
   Every Forge atomic write fsyncs the temp file before rename and syncs the containing
   directory after (best-effort where platforms refuse directory fsync; documented).
6. **Expand managed browser coverage.** — **Closed (2026-10-30).**
   Second engine (managed Firefox CI leg), accessibility assertions, interrupted-job
   SIGKILL scenario, visual snapshot comparison against per-engine baselines, observed
   model identity pinned (check #46, D046).
7. **Remove the legacy raw `memoryBlock` input.** — **Done (2026-10-30).**
   Phase 15A wording frozen in `scripts/lib/phase15a-prompt-snapshot.ts` (byte-verified,
   pinned by unit tests); production renders structured retrieval records only.
8. **Surface recovery issues in the System screen.** — **Done (2026-10-30).**
   `GET /api/health` carries a store-wide `forge` summary; the System screen renders it
   read-only. Ack/repair stay in the project view.
9. **Adversarial boundary suite for the access-control layers (roadmap §5 criterion).**
   — **Done (2026-10-30).** `tests/integration/adversarial-boundary.test.ts` (11 attacks,
   every CI push): host/origin spoofs, route-casing evasion, header laundering and
   shape games, D045 posture pinned.
10. **Close the REST API remainders (roadmap §3).** — **Done (2026-10-30, D048).**
    Pagination with real `total` on memories/review/sessions; `GET /api/errors`
    publishes a versioned catalogue (`catalog_version: 2`, 5 groups, 46 entries) mirrored
    by drift-gated boundary tests; v1's pinned asymmetries fixed in v2 (D054).
11. **Idempotency-Key replay for retry-sensitive writes.** — **Done (2026-10-30, D049).**
    `Idempotency-Key` on `POST /api/memories` and Forge generate: first response recorded
    (schema v8, 24h TTL), replayed byte-identical with the `idempotent-replayed: 1`
    header; in-flight duplicates 409; durable across restarts; see D049.
12. **Alert signal groundwork (§8 / G4).** — **Done (2026-10-30, D050).**
    `GET /api/health` carries `alerts.{backup,storage,provider}` (name-stamp freshness,
    never mtime; informational - liveness `status` never flips).
13. **Alert consumer script (G4 groundwork).** — **Done (2026-10-30, D051).**
    `pnpm ops:alert-prober [base-url]`: cron-ready; exit 0/1/2; `ACCESS_TOKEN` bearer;
    `alerts=absent` flags stale deployments. G4 still needs the operator to install the
    cron and wire notification delivery - an install, not a build.
14. **Graph/timeline data surface (G-9).** — **Done (2026-10-30, D052).**
    `GET /api/memories/graph` + TimelinePanel + RelationshipMapPanel; browser workflow
    46→48 checks. **G-9 remainder closed.**

## P2 — explicitly out of scope for this milestone

- Authentication, hosted collaboration, multi-user namespaces, or network exposure.
- Embeddings/semantic retrieval, multi-file generation, or new model providers.
- Decision Guard rule-family breadth: **extended (2026-10-30, v1.5.0)** with autoplay-media and
  external-assets plus 22 corpus cases; it remains advisory.
- A verified self-contained HTML export (downloaded files currently lose the sandbox).

---

## Working journal — archived

The P0/P1/P2 lists above are executed: the open gaps are G-2 (operator provisioning)
and G-6 (deliberately post-submission). The running register of audits and
self-corrections kept until judging was archived whole on 31 Oct to
[`archive/2026-10-31-cadence-journal.md`](archive/2026-10-31-cadence-journal.md) -
preserved unedited, no longer appended to. What survives as working documents: the
wire-probe ledger below and the post-judging action register below it.

## Wire-probe ledger

What has been probed LIVE at head (all 31 Oct unless noted); dated witness entries are
in the archived journal. Each row: probe -> observed -> owner of the follow-up.

| Probed | Observed at head | Owner |
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

Characterization pins for the two queued fixes exist: `tests/integration/error-envelope-pins.test.ts`.

## Post-judging action register

An INDEX, not a source of truth: each action's authoritative wording lives in its
home (cited). Nothing here authorizes acting before judging closes. Conflicts resolve
toward the home doc.

**A. Owner actions at submission (Nov 4, owner-only):**
1. Cut tag `submission-2026-11-04` from the shipped tree (ruleset 26184029); Release +
   archive per SUBMISSION_PRESERVATION.md owner-act list.
2. KI-44 + KI-47 decision (same shape, decide together): promote the docs-only fix
   lines pre-tag (changes the SHA judges see) or ship as-is with both dead pointers
   recorded.
3. Record submitted SHA, tag derefs, and form fields in SUBMISSION_PRESERVATION.md.

**B. Immediately after judging closes (mechanical):**
4. KI-43 + KI-45 + KI-48 lockstep PR: five inline codes into the catalogue, 400 parse
   failures -> `bad_request`, Fastify 413 -> `payload_too_large` entry - ONE
   catalogue bump 2→3, and flip the two pins in error-envelope-pins.test.ts in the same
   bump. The wire-probe ledger above is the baseline table.
5. PR #28: fetch `refs/pull/28/head` (f1a16f791e49...), recreate branch, merge or close
   with reason (SUBMISSION_PRESERVATION.md recovery block).
6. Finish SHA-pinning: the 8 `website.yml` steps once unfrozen; periodic re-check of
   pinned SHAs vs security patches. (ci.yml: all 9 pinned 31 Oct to alias-resolved
   commits; pnpm/action-setup's `v4` alias sits at v4.3.0, behind v4.4.0 - pins follow
   real resolution. Same tier: website/ vite 8.x + esbuild bump, KI-46.)
7. Test typechecking in CI (trade documented in #161). Config staged at
   `tsconfig.tests.json`, deliberately unwired; measured run is down to 186 errors
   (three editable files fixed: evaluation-comparison, session-cascade,
   stored-json-integrity). Plan (validated by a scratch-branch probe 31 Oct, reverted):
   PR1 = widen engine.create/correct params to the z.input types already exported by
   shared (MemoryCreateRequest, MemoryCorrectionRequestInput) - measured -74 errors,
   the four fixture files 50->4, `pnpm -r typecheck` exit 0 under it; PR2 = the residual long tail - measured 94 errors across ~20 files
   AFTER PR1+PR3 combined (largest: harness 10, forge-api 7, error-catalog 6,
   reading-nook fixtures 6, then 4s and 3s; mixed TS2345/2322/undefined classes,
   no single design lever); PR3 = carve `closeRelative` out of the
   protocol-locked verify-phase17-strict (its bytes are asserted by the Phase 17
   protocol - never edit them) and exclude the script (-17); then wire
   `typecheck:tests` into the verify leg.
8. Protocol-locked scripts (`verify-phase16/17/-strict/-sums`) assert their own bytes
   against recorded protocol hashes - permanently un-editable; CI now re-runs the whole
   research chain every push (job "Research evidence re-verification"), so tampering
   fails the PR that does it.

**C. Owner calls after judging (judgment required):**
9. Ruleset 26184025 Firefox asymmetry: add the third required context to Protect-main
   or record why not.
10. `'purged'` enum: remove (migration + contract lockstep, D042-style) or document
    deadness (schema comment at packages/shared/src/memory.ts already notes it).
11. Historical remote heads (post-mass-prune state, 31 Oct): 9 remote heads = main +
    integration + 7 divergent. The 4 review candidates: `agent/phase11-release`
    (a806145b), `agent/strata-phase12d-guard-audit` (4680ad34),
    `agent/strata-phase13-submission` (84e6a8ce), `agent/strata-phase14b-submission-audit`
    (e8fe9df7) - all fork at `d35fa9d8` (27 Oct), no merged-PR record. Verified 31 Oct:
    the quartet is CONTENT-TWIN - branch-only files are byte-identical on every branch
    carrying them (union 9; the phase14b head adds PHASE14B_INDEPENDENT_AUDIT) - so
    this collapses to ONE review decision, not four: keep/archive the 9-file set once,
    then all four heads are free to prune.
    Files existing only on them (union, 9): ContextInspector,
    Sidebar, ForgeView (superseded web components); MUSE_FORGE_VIDEO_CONCEPT,
    VIDEO_CONCEPTS, VIDEO_STORYBOARD; DEMO_RUNBOOK, DEMO_SCRIPT_3MIN,
    PHASE14B_INDEPENDENT_AUDIT (exists nowhere else). Owner decides keep/archive/let-go
    per file. Foreign trio (2 claude/*, study02/checkpoint-1 @ 7a6cacf5) is not ours to
    touch. All other former heads were ancestors of main; zero content lost in the
    prune (SUBMISSION_PRESERVATION.md census).
12. Optional live rejection-probe of ruleset 26245608 (read-only verification done).

13. G-2 worker-group ACL support (KI-49): create staging 0750 + prompt 0640 for a dedicated
    group named by a new env, enabling setpriv-style uid isolation; contract-visible (new env +
    permission model), so this is an owner call first, then a small PR - the runbook already
    documents two wrapper paths that work without it.

**D. Roadmap horizons (POST_HACKATHON_ROADMAP.md owns these; index-only):**
14. G-6 identity/scoping/rotation; 15. G-2 provisioning follow-up;
16. ConfidenceSchema relabel (roadmap G1); 17. G-1/G-3+ per roadmap sequence.

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
