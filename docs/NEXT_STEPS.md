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

## Cadence retrospective — 87 PRs in one day (consolidated 31 Oct)

The register below lists findings newest-first; this block is the
index a post-judging maintainer can read instead. Scope: PRs #68–#154,
all merged into `integration` (zero closed-unmerged), from the 30 Oct
evening through 31 Oct.

- **Guards:** 17 invariant rows, each with an adversarial test written
  to the promise - behavior was never changed to pass a test; when a
  guard's expectation was wrong, the guard was fixed openly.
- **Witnesses:** every operator-facing claim re-run at head with dated
  evidence: judge quickstarts (both faces), seeded demo ×3, dev mode,
  live Pages site, MCP stdio, SSE + bearer token, alert chain
  green/amber/red, Codespaces origin replay, media census, bench +
  eval cores (20/22 retrieval re-observed offline; live-Muse artifacts
  protected from offline overwrite - see the mutation registry).
- **Found and fixed:** phase17 tag's missing ruleset (gap the
  `submission-*` glob silently missed) → ruleset 26245608; freeze
  table missing its fourth row; appendix staleness (test count 54→76,
  a loose glob counting snapshots as tests, a route grep mislabeled as
  a counting instrument); README eval precondition; repo About
  homepage null while the site was LIVE (owner settings fix,
  disclosed).
- **Found and queued (not acted pre-Nov-4):** KI-43 - five inline wire
  codes outside the versioned catalogue; fix planned as one lockstep
  contract PR after judging.
- **Method findings:** scanner traps named as reusable knowledge
  (`?raw=true` links, zod-schema env names vs process.env regex,
  heading-depth-limited register ids, snapshot artifacts in glob
  counts); offline reruns can destroy richer live evidence.
- **Self-corrections shipped as visible PRs, never quiet amends:**
  #77, #100, #113, #91→#92, #136→#137 (KI id collision), plus wrong
  check-watch PR numbers twice, three stale-watch reads after fix-pushes
  (a stale watch shows the PREVIOUS run's jobs - the adopted rule is a
  fresh `gh pr checks` query plus run-id comparison against the new
  push), anchor-assert saves now >8, and two commit-message/content
  mismatches caught by merge diffstats (#169->#170, #172 mid-branch).
  Failure modes in MY process get the same register treatment as the
  repo's.
- **Untouched, by design:** zero product-surface changes, zero schema/
  contract moves, zero frozen-path touches; `main` `c32d03b`, three
  tags, four rulesets, PR #28 held open - sentinel green throughout.

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
  - Suite-boundary + secrets sweep (31 Oct, at head): 76 test files on
    disk = 76 collected by vitest's `tests/**/*.test.ts` include — zero
    orphan test files pretending to matter, zero silently-excluded ones;
    and the "no secrets in the repository" claim was re-scanned: a
    pattern sweep (assignment-shaped key/secret/token/password literals,
    ≥24 chars) over all tracked files hit nothing outside placeholder
    contexts, only `.env.example` is tracked (no `.env`), and every
    value there is a labelled placeholder. Honest width: it is a
    pattern scan, not an entropy-based full-history scan — the archive
    ships tracked files only, which is the surface the claim covers.
  - Branch-discipline audit (31 Oct, at head): the last 100 commits on
    `integration` are 100% PR-associated — zero direct pushes in that
    window (message-shape scan, spot-checked against the commits→pulls
    API: #139/#138/#137 all report merged=true at their squashed SHAs).
    The migration ledger also reads clean: versions 1..8, contiguous,
    no duplicates, tracked per-application in `schema_migrations`.
    Governance claims (PR-only workflow, schema versioning) re-verified
    as mechanisms, not manners.
  - Dependency hygiene (31 Oct, at head): `pnpm audit` (level=low) reports
    ZERO known vulnerabilities across the workspace; lockfile v9 freshness
    is structural, not hoped-for — every documented environment installs
    `--frozen-lockfile` (both CI jobs, devcontainer setup), so a stale
    lockfile fails the gate rather than silently resolving differently.
  - Disclosure channel witnessed live (31 Oct, at head): SECURITY.md's
    "Security → Report a vulnerability" path was probed, not trusted —
    `security/advisories/new` answers 200 unauthenticated, i.e. GitHub
    private vulnerability reporting is actually enabled on the repo; a
    repo without it 404s that URL, so the promised channel exists rather
    than being aspirational prose; the dedicated
    `/private-vulnerability-reporting` endpoint then confirmed
    `{"enabled": true}` as the authoritative check - a command our own
    inventory appendix already listed (re-reading your own docs pays
    rent). (The three-business-day acknowledgement
    is a stated intention, not a witnessed mechanism — unchanged wording.)
  - Eval re-run at head, with a trap caught (31 Oct): 20/22 retrieval core
    re-observed against a throwaway-DB echo server (the 2 FAILs remain the
    documented KI-18 vocabulary misses). The trap: eval rewrites the tracked
    retrieval-eval-latest artifacts, and the echo-mode run zeroes the 7/7
    correct + 7/7 grounded live-Muse answer section that the committed
    artifact carries — richer evidence destroyed by an offline rerun. The
    regenerated files were DISCARDED (git checkout), the committed 26 Oct
    live-Muse artifact stands, and the appendix now warns in-line so the
    next runner doesn't commit the downgrade.
  - Mutation registry for the exposed verify/demo/bench scripts (31 Oct):
    mapped all eight package scripts that rewrite the twelve tracked
    docs/benchmarks artifacts; four carry "measured with real Muse" in
    their titles (retrieval-eval, evaluation-comparison, context-efficiency,
    muse-overhead) - rerunning THOSE under the echo provider overwrites
    live evidence and leaves a titled lie. bench:retrieval and the three
    demo generators are provider-neutral and safe. The map turns the #149
    near-miss into a standing guardrail any runner can consult BEFORE
    dirtying the tree.
  - Command two-way census README<->package.json (31 Oct, at head): every
    `pnpm <name>` in the README resolves to a real package.json script
    (the four apparent misses are prose/CLI subcommands: pnpm 10.32.1,
    exec, install, scripts); every script is documented SOMEWHERE in
    docs - db tools in runbooks, evidence generators in their phase
    docs, dev variants in dev notes - except `test:watch`,
    `test:coverage`, `lint:fix`, deliberately left as universal
    developer conventions rather than padding the README's table.
    No phantom commands; no undiscoverable scripts.
  - Ops pair consistency + drill containment (31 Oct, at head): the
    README's "see runbooks" pointer resolves to
    docs/ops/OPERATOR_RUNBOOKS.md, which covers the db trio, the cron
    backup recipe, and the alert prober's three-code contract - the
    same contract the live alert-chain witness exercised. And
    `backup:drill`, which CI runs every push, was verified temp-dir-
    only INSIDE the tree's mutation registry (mkdtemp under os.tmpdir,
    including its "must not clobber" guard test) - an exposed command
    that can never dirty tracked files, now recorded as such.
  - Phantom-settings check (31 Oct, at head): every `ENV_NAME` token in
    README + OPERATOR_RUNBOOKS is genuinely read by the code - 16/16
    resolve to config schema keys or direct process.env reads; zero
    settings a reader could dutifully set and accomplish nothing with.
    Scanner gotcha named for the next sweep: env names live as ZOD
    SCHEMA KEYS (`MODEL_PROVIDER: z.enum(...)`), not only as
    `process.env.X` - a process.env-only regex reports ten false
    phantoms; same false-positive family the docs-link audits learned
    from `?raw=true`.
  - Video-promise census (31 Oct, at head): every video claim in live docs
    now maps to a committed file (ffprobe: the 2:50 demo 170.474s; website
    copy same content). Found-and-fixed on integration: docs/README "2:46
    fallback video" (research is actually at the END of the committed 2:50
    cut) and the checklist's "retained" claim - the 2:46 cut was NEVER
    committed to any tree, ever (no deleted-mp4 history). Found-and-
    FLAGGED on frozen main (same two stale lines inside the submission
    surface): KI-44 + a preservation-doc owner-act entry for the 4 Nov
    tag-cut decision. A dead pointer inside a frozen entry is documented,
    not silently fixed.
  - Backticked-path census across 83 live-surface docs (31 Oct, at head):
    every `path/to/file.ext` reference checked against the tree - 7
    reference files that no longer exist, and ALL SEVEN sit inside
    explicitly historical documents or "kept for the record" blocks
    (video-planning files added 83fbae3 and deleted f296dc1 on 28 Oct;
    ForgeView.tsx added with 3af6e0b, later removed). Zero live docs
    point at dead paths. Method note: path rot in HISTORICAL docs is
    expected and correct - history cites the tree as it was; only
    live-surface pointers must resolve, so path scans must classify
    each citing doc by era before flagging anything as drift.
  - Tracked-JSON validity sweep (31 Oct, at head): all 403 tracked .json
    files parse - benchmark artifacts, manifests, configs, fixtures.
    The single strict-parser failure was the scanner's, not the repo's:
    devcontainer.json is JSONC by spec (comments allowed), parses clean
    once comments are stripped; the other 402 are strict-valid. Method
    family extended: file formats have DIALECTS (JSONC here, `?raw=true`
    links, zod-key env names) - a census that ignores the dialect
    manufactures its own findings.
  - CI token + action-pinning census (31 Oct, at head): the repo's
    default workflow-token permission is READ (API-confirmed, PR
    approvals by token disabled) - so ci.yml, which declares no
    `permissions:` block, still runs under a read-only ceiling: least
    privilege is structurally enforced at the repo layer, not per-file.
    website.yml scopes permissions explicitly where Pages deploy needs
    write. All 18 `uses:` steps reference floating major tags (@v4/
    @v3), no SHA pins - standard for the project's scale; SHA pinning
    queued post-judging (it would touch website.yml, inside the freeze,
    and the required-check surface).
  - Post-judging CI hardening - evaluated, not acted (pre-Nov-4 rule):
    pin every `uses:` to a full commit SHA with a Dependabot-style
    refresh note; also consider per-file `permissions:` blocks in
    ci.yml to make the read-only ceiling locally visible, not just
    repo-default. Both need the freeze lifted for website.yml.
  - Guard-for-the-guards pass (31 Oct, at head): every file reference in
    the §7 invariant ledger resolves - 17 rows, zero dangling test,
    source, or workflow pointers; the tests those rows cite are the
    same suite that runs green every CI leg (922/3). Dialect note kept
    because the FIRST check produced ~30 false positives: §7 cites
    paths RELATIVE to docs/roadmap (`../../tests/...`) and sometimes by
    bare filename - resolution must respect both notations before any
    "broken guard row" claim is credible.
  - P0/P1/P2 status registers re-audited (31 Oct, at head): every item
    label still matches the tree - P0: three Done-with-evidence, one
    honestly Partial (operator provisioning = G-2, queued); P1 sample-
    verified down to check number 46 and the opt-in live-model caveat;
    P2's "out of scope" items are genuinely untouched (no auth work, no
    embeddings) and the Decision Guard row's v1.5.0 extension is still
    the newest substantive src change (ef72895, 30 Oct - git log proves
    the register neither lags nor leads reality).
  - Decision ledger re-validated (31 Oct, at head): 55 entries, ZERO
    duplicate ids (the KI-43 collision lesson applied to this register
    preemptively), the single gap D027 is the documented skip
    (DECISIONS.md numbering note), and every D-number cited in every
    other doc resolves to a defined decision - zero true dangling
    references across 55 ids x the whole docs tree.
  - Front-of-house sweep (31 Oct, at head): README front has NO badge
    surface to rot (pure prose - nothing to break); license topology
    correct for a non-publishing monorepo - one root LICENSE (MIT),
    root package declares private, all 10 workspace packages private,
    no license-field sprawl or contradiction; and the live Pages site
    re-witnessed this round: 200 + the exact submitted title. Clean
    surfaces, dated.
  - Launch-count disclosure verified against the code (31 Oct): the
    .devcontainer README's privacy promises match setup.sh line by line -
    codespace-gated, one GET, 3s cap, non-fatal (`|| true`), same URL.
    Width found: setup opts out on EITHER variable being set to ANY
    non-empty value, a shade wider than the README's `=1` spelling - the
    README now says so, and notes the owner-counter separation visible in
    the code. These two codespace-scoped vars (DO_NOT_TRACK,
    MUSE_RECALL_NO_COUNT) live in setup.sh, not config.ts, which is why
    the config-centric env census never listed them; the census scope is
    now annotated rather than silently widened.
  - Duplication sweep across the hot docs (31 Oct, at head, after the
    #169->#170 dedupe): repeated-content scan over NEXT_STEPS (26
    register bullets, zero duplicate heads, zero repeated long lines),
    KNOWN_ISSUES, CAPABILITY_INVENTORY, SUBMISSION_PRESERVATION,
    DECISIONS and README. Every surviving duplicate proved legitimate
    by context: three KNOWN_ISSUES hits are severity-label boilerplate
    across distinct entries; README's two identical `git clone` lines
    sit in two different run-paths sections, consistently worded. The
    session's ~100 doc patches introduced exactly ONE unintended
    duplication (#169), and the sweep proves nothing else is hiding.
  - Error-catalogue wire re-witness (31 Oct, at head, fresh throwaway-DB
    server): GET /api/errors publishes version 2 with 46 group entries
    over exactly 45 UNIQUE codes - `invalid_request` intentionally
    appears twice (session/400 runtime rejection; provider/503 bench
    request-bug), a deliberate D048-mirror shape, not drift: codes are
    the taxonomy, entries are code+status+context triples. Docs saying
    "45 codes" count uniques and stay true; an entry count would read
    46, so the distinction is now on record. /api/meta's errors
    pointer agrees (catalog_version 2 + endpoint).
  - All live #L line-anchors re-verified at head (31 Oct): the ten in
    LIVE_MUSE_CONFIGURATION (the #127 refresh holds - config schema
    lines, quota regex, token accounting, quotaFailure, app wiring all
    still land on exactly their claimed lines) plus the two inventory
    anchors from #173; zero out-of-range, zero text-vs-fragment drift.
    Scanner dialect noted: these anchors wrap their text in backticks
    ([`config.ts:54`](path#L54)) - a regex that misses the backtick
    sees ten anchors as zero, the census equivalent of a silent miss.
  - Registers re-validated (31 Oct, at head): the KNOWN_ISSUES register —
    43 KI ids, zero duplicates, every entry carrying Severity and Detail
    (mechanically checked; the #137 renumber left it clean) — and the
    inventory gap table: G-1..G-12 reads 10 Closed, 2 Partial, and BOTH
    Partial rows (G-2 provisioning, G-6 identity) correspond exactly to
    post-judging owner-queue entries; no gap is Closed on paper while
    Open in practice, and none is left unqualified.
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
  probes + ERROR_CATALOG_VERSION 2→3) — full detail in KNOWN_ISSUES KI-43.
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
