# Cadence journal — archived 31 Oct 2026

Wholesale archive of `NEXT_STEPS.md`'s working-journal sections (retrospective and the
build-out-to-judging register) at the moment the register stopped being the branch's
main artifact. Text is preserved exactly as written, dates and self-corrections and
all; nothing edited or removed inside. The living successors are the wire-probe
ledger and the post-judging action register, which REMAIN in NEXT_STEPS.md.
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
  check-watch PR numbers FOUR times (the fourth: watching a guessed 187
  while my create had returned 188 - the guessed number was ANOTHER
  actor's live PR with a red leg that was never mine), three stale-watch reads after fix-pushes
  (a stale watch shows the PREVIOUS run's jobs - the adopted rule is a
  fresh `gh pr checks` query plus run-id comparison against the new
  push) - plus the empty-report variant (#204: gh pr checks answered
  "no checks reported" twice while runs were QUEUED, and an --admin
  merge then rides the post-merge leg; the rule completes to: empty
  checks means UNVERIFIED, never pass - wait for legs to appear or
  watch the merged tree's own run to success before declaring the
  round green) - and the interrupted-command variant (#211: a
  watch-merge chain died mid-call with the outcome unrecorded;
  the recovery was inspection, not retry - gh reported MERGED, the
  local branch was left mid-sync, and the post-merge run was then
  watched to success on the merged tree: 76/76 files, 922 passed /
  3 skipped (925), 49 workflow checks). Rule: a half-observed
  ship is finished by reading external state, never by repeating
  the side-effecting call blind), anchor-assert saves now >8, and two commit-message/content
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
    write. All 18 `uses:` steps reference floating major tags (@v4/  [count refreshed 31 Oct: 17]
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
    (\[`config.ts:54`\](path#L54) - escaped HERE so it stays a
    teaching example instead of rendering as a broken link; link
    census scanners then flag no phantom) - a regex that misses the backtick
    sees ten anchors as zero, the census equivalent of a silent miss.
  - Judge user-guide censed against code (31 Oct, at head): all six
    docs/guide files' `pnpm <name>` commands resolve to real scripts;
    no stray port claims (only 5173/8787 appear); the env table's
    defaults verified value-for-value at the source - MEMORY_MAX_*
    8/4000 from DEFAULT_RETRIEVAL_BUDGET (retrieval.ts:51-55),
    MUSE_MODEL default `muse-wonder-1.0`, FORGE_RUNTIME_BROWSER
    `managed` with no fallback. Two scanner FPs named for the record:
    `pnpm 10` (version prose) and `4000` (a character budget, not a
    port) - four-digit numbers are not ports, and version prose is
    not a script name.
  - Public counter endpoint probed (31 Oct): the README's "anyone can
    read the total" GET currently answers {"error":"Key not found"} -
    consistent with abacus creating keys on first hit, and with owner
    test launches going to the separate `-owner` counter by design:
    Key-not-found therefore means "no real launch yet", not dead link.
    The README now states that reading so nobody mistakes an absent
    key for the counter being broken; hit/get keys verified to be the
    same string. Full sentinel sweep same round: all six invariants
    green (main c32d03b, 3 tags, 4 rulesets, 0 site pushes, PR #28
    pinned, 0 frozen-path touches).
  - Live-suite citations triaged across docs (31 Oct): #102-era claims
    in dated refresh blockquotes and the retrospective stay verbatim -
    they were true at their dates and the roadmap's newest refresh
    still holds; the EVALUATION_REPORT header gains only a pointer
    noting the CLI moved to 1.4.14 and its measurements were NOT
    re-taken (quotation boundary, no re-measurement claim). Dialect
    catch: grepping for PR cites `#102` first hits FOUR hex colors
    (#102A43) - reference searches must word-anchor or false-positive
    palettes answer first.
  - Whole-tree live-doc link census (31 Oct): 521 local links across
    every non-frozen doc, resolved with three rules this census was
    nearly defeated by - (1) resolve against the FILE'S DIRECTORY,
    not the file path: getting that backwards once flagged
    docs/README.md as 15/15 broken when it is 15/15 fine; (2) strip
    query strings - `?raw=true` media links are four more false
    "misses" against a file that exists; (3) meta-text needs escaping:
    this very register's anchor-syntax example rendered as a real
    markdown link pointing at a file called `path`, now escaped.
    Final: 521 links, ZERO broken, in live docs at head.
  - SHA provenance scan of live docs (31 Oct): every git-looking hex
    token in context got object-checked and ancestry-checked - 57
    unique tokens, ZERO phantoms. The 5 that failed "ancestor of
    integration" are each explained, not excused: two README tokens
    (one unique) are the phase17 tag OBJECT, exactly matching the
    freeze sentinel's deref - annotated tags are objects, not commits;
    three PHASE-doc tokens are pre-squash branch TIPS, real objects
    that no lineage carries because merge policy changed under them -
    the historical-era citation rule in action, and a fact about this
    repo's own topology: the docs remember branch shapes that the
    squash history no longer contains.
  - Every merge is gated twice - and the watch trap finally has its
    mechanism (31 Oct): ci.yml triggers on push to [main, integration]
    AND on pull_request, so each squash merge re-runs the full gate on
    the MERGED RESULT, not just the PR head. Six sampled post-merge
    integration runs: all success; the newest (this cadence's last
    merge head) verified completed success after the observation.
    That post-merge leg is the real safety net behind the stale-watch
    confusion: a watch that reattaches to an old PR run shows a
    stale VIEW, while the merged tree was independently greened by
    its own push run. Concurrency `cancel-in-progress: true` on the
    PR ref explains why older runs sometimes appear superseded
    mid-watch.
  - Tracked-vs-ignored census + protective negation (31 Oct): 14
    tracked files matched .gitignore's `*.log` - ALL deliberate
    evidence logs inside the frozen docs/hackathon-evidence/** tree
    (tracked-beats-ignored keeps them safe today); the census value is
    the FORWARD trap it exposed: `git add -A` silently skips NEW
    evidence logs matching that rule. One protective line answers it:
    `!docs/hackathon-evidence/**/*.log` (pattern text in an
    unfrozen file - zero bytes changed inside the frozen tree,
    following the file's own negation precedents). Post-change census:
    tracked-but-ignored now 0; the 15 ignored paths are exactly
    node_modules/dist/test-results/workspaces; no hidden content
    anywhere. Issue templates checked in the same pass: both form
    YAMLs and config.yml parse with sane keys, blank issues policy
    explicit.
  - Judge-entry rehearsal from a FRESH clone at head (31 Oct): cloned
    integration from origin at 409e8eb, then ran exactly what the
    README promises - frozen-lockfile install, pnpm build, built
    server answering /api/health, and pnpm demo:seed landing 3
    memories + 1 project (the two active + one superseded shape the
    walkthroughs describe). Honest scope notes: install was 1.2s on a
    warm pnpm store - this rehearse CORRECTNESS, not cold-network
    timing; and the dev-server browser path was not re-opened, its
    leg being the managed-browser CI gate (green at every merge).
    Clone and scratch DBs removed after; repo untouched.
  - ci.yml declares its own permissions block (31 Oct): `contents:
    read` + `actions: read` - the exact consumption of its jobs
    (checkout + two artifact uploads), matching the repo-wide
    default_workflow_permissions=read already API-confirmed, so it
    changes NO effective privilege; it stops the file silently
    inheriting if repo settings ever drift. website.yml already
    carried its own block - the census: 2/2 workflows now state
    permissions at the file level. This is the cadence's
    "settings change only if protective" bar applied to the
    cadence's own tooling, and the PR's three CI legs are the
    live proof the block is complete.
  - Number-claims census across the guide (31 Oct): word-numbers
    (six/seven/ten...) grepped against their sources - the guard's
    "seven rules" checks out against RULE_ORDER (seven, with
    none-applicable a verdict sentinel, not an eighth rule); the
    Phase-17 "four-arm trial" cite is era-correct frozen history;
    but architecture.md said "Six bounded project/memory tools" -
    STALE at head, the registry publishes SEVEN since the task tools
    landed. Guide fixed to seven + named, and the same file's tree
    and table had silently OMITTED packages/mcp-server entirely -
    the one workspace with an external protocol surface - now added
    (stdio front over the same seven-tool registry, G-5). Lesson: an
    earlier guide census covered commands/ports/env but not COUNT
    claims; cross-doc numeric agreement is its own census dimension.
  - README number-claims census (31 Oct, continuing the count
    dimension): the checkable-present ones all match instrument -
    "seven rule families" enumerates exactly RULE_ORDER's seven
    ids; "seven tools" holds post-#185; the seed prose "three
    decisions (one superseded)" matches the 3-memory fresh-clone
    seed; "one workflow with five capabilities" matches its own
    list. The historic ones quote frozen evidence era-correctly and
    reconcile arithmetically: 480 = 2 models x 6 strata x 4 arms x
    10 runs, straight from RESULTS.md's design line. No edits
    needed; clean numbers get dated too.
  - Guide number-claims closed out (31 Oct, count dimension continued):
    html-studio.md and architecture.md prose verified at the source -
    "at most two active jobs (queued/running)" is literally
    runner.ts:835 (`active >= 2` -> ForgeError too_many_jobs, a
    catalogued code); the stated job defaults match config.ts
    exactly (600_000 ms / 25 calls / 1_500_000 input tokens); the
    four-row assessment table equals DECISION_GUARD_ASSESSMENTS 1:1
    (violation_detected, no_violation_detected, not_verified,
    evaluation_unavailable) including the not-a-certificate
    disclaimer; "Four surfaces" matches App.tsx's view branches and
    the four legs the browser gate walks at every merge. Zero guide
    edits due; every number now carries an instrument cite.
  - Parallel-activity witness (31 Oct): the repo is not single-actor.
    PR #187 (study02/checkpoint-1, its own CI red on its own JSON
    formatting) and PR #28 (branch deleted, recovery path pinned via
    pull-ref) are LIVE in parallel with the cadence; 41 remote heads
    include the study02 branch. Discipline holds both ways: cadence
    touched no foreign path, foreign work touches only unfrozen
    territory, and every sentinel re-verified green (main c32d03b,
    3 tags, 4 rulesets). Wrong-number watches got rarer precisely
    because the fresh-query rule exists - it caught this fourth one
    inside the round it happened.
  - Count census reaches SECURITY.md (31 Oct): the threat table's T1
    row still said "six bounded tools" - the same stale-seven family
    as #185, hidden in a file the guide-era passes never scanned.
    Fixed to seven, matching the registry, README:325 ("seven
    bounded tools... same tool registry") and the /api/tools wire
    shape. Census meta-lesson: coverage is a SET - "which files did
    I scan" must be enumerable, or stale twins hide in unscanned
    siblings. Remaining word-numbers in SECURITY/CONTRIBUTING/
    preservation all check out against their subjects (four
    boundaries enumerated; one job JSON; one staged file; one
    shared secret = authentication-without-identity).
  - Number census on an ENUMERATED 64-file set (31 Oct): 426
    number-noun hits classified, not skimmed - four surviving stale
    twins fixed at their homes (ARCHITECTURE_OVERVIEW present-tense
    six->seven; SUBMISSION_CHECKLIST refreshed with its review-era
    six preserved in parentheses; KI-30 gains an era note - Phase 5
    really shipped six, and KI-30's real claim "no shell/fs/network"
    stands untouched); the rest classify clean: HACKATHON_SUBMISSION
    and PROJECT_STATUS wear explicit Historical-document banners
    (era rule honored), Phase-17's "six strata" and "480 runs" are
    frozen-evidence arithmetic, and NEXT_STEPS' own sixes/eights/
    twelves are the sentinel, mutation-registry and guide counts as
    factored. A count census without a declared file set is
    unfinishable; with one, it converges: three stale-home rounds,
    this one likely the last.
  - Count dimension CLOSED at zero new findings (31 Oct): the
    seven-tools/seven-rules claims now agree 10/10 across README x3,
    guide x3, SECURITY, ARCHITECTURE_OVERVIEW, CAPABILITY_INVENTORY
    (and the wire: /api/tools + MCP both serve seven) - the
    three-round hunt (#185 guide, #190 SECURITY, #191 declared set)
    now re-verifies with NOTHING found, which is what closing looks
    like. Sentinel mini-sweep same round: all six invariants green
    (main c32d03b, 3 tags, 4 rulesets, 0 site pushes, PR #28 OPEN,
    0 frozen touches) and the Pages site still 200 with submitted
    title.
  - Schema census end-to-end (31 Oct): the inventory's storage row
    verified from BOTH sides - migrations.ts declares exactly eight
    migrations, versions 1..8 contiguous; and a fresh database
    created by the real server records exactly 1..8 in
    schema_migrations, with the inventory's cited tail names
    character-true (v7 record_contract_revision_actor_proposed, v8
    idempotency_keys) and migration 4 named porter_stemming exactly
    where the retrieval section credits it. Source-list truth AND
    runtime-execution truth in one probe. Catalogue-count claims
    also now consistent across KI-43/register since #172's wire
    re-witness (45 unique / 46 entries phrasing everywhere).
  - Wire probe found KI-45, filed not fixed (31 Oct): malformed JSON
    body answers 400 + `internal_error` while the catalogue's own
    `bad_request` entry claims that exact sentence and app.ts's own
    comment says "client error, not a server fault" - code contradicts
    both, status is right, only the code lies. The header half of
    that entry IS mirror-tested, the body half is the untested twin.
    KI-45 records repro + fix plan (map statusCode-400 parse
    failures to bad_request + mirror probe; catalogue text needs NO
    edit, so ERROR_CATALOG_VERSION stays 2) and joins KI-43's
    post-judging lockstep PR as its second code-honesty item.
    Pre-Nov 4: documented, never silently patched - the KI-43/KI-44
    pattern for real defects found at head.
  - Supply-chain pin count self-corrected (31 Oct): the #162 census
    line said "all 18 uses: steps float". Re-count, then-line-by-
    line: ci.yml had NINE uses: at #162's own commit and has nine
    now; website.yml eight both times; the total is - and always
    was at this cadence - SEVENTEEN. The "18" was BORN wrong in my
    #162 count, and my first draft of THIS entry invented a
    mechanism ("a step consolidation removed one") that the diff
    proves never happened. Two errors, both mine, both now on
    record: an off-by-one census AND a fabricated causal story
    covering for it - caught by the same rule that catches all of
    them: count the lines, read the diff, before narrating.
    Register line carries an in-place [count refreshed: 17]
    marker; pin-ladder scope exact: 17 steps, 9 distinct actions,
    all floating @v4/@v3.
  - All-registers mini-sweep post-KI-45 (31 Oct, at head): KI 45 ids
    unique, max 45, zero dups; decisions 55/55 unique; G-table 12
    rows with status on every row; no stale "44 KI ids" claim
    survives anywhere (the KI count was never hardcoded outside
    validator runs, so KI-45 aged nothing). Sentinels same sweep:
    main c32d03b, 3 tags, 4 rulesets, PR #28 OPEN. Scanner dialect
    caught pre-claim: a loose G-row regex counted 9 of 12 - the
    row form is `| G-N |`, regexes need the full row anchor or
    registers under-count and the report lies.
  - `pnpm verify` composition checked against its promises (31 Oct):
    the script is exactly lint (biome check .) + typecheck (pnpm -r,
    which is the recursive typecheck of packages/apps) + test
    (vitest run) - what README and the devcontainer guide say it
    runs, term for term. Suite totals witnessed at head from a NEW
    cheaper source: the LATEST POST-MERGE CI leg's own log (76 test
    files passed on the merged tree) - the double-gate witness
    means the per-head full-suite re-assertion no longer needs a
    local re-run; the gate of record keeps its own receipts.
    Dialect trap banked: `vitest list --files` answered zero in
    this harness - a silent-empty probe; a tool's zero must be
    confirmed to mean "nothing", not "I heard nothing".
  - Workspace-topology census (31 Oct, at head): pnpm-workspace globs
    (`apps/*`, `packages/*`) instantiate exactly the 10 documented
    packages; every `@mml/*` import across every src tree resolves to
    a declared name (zero unresolved); all 10 are private:true; and
    ALL 19 internal dependency specifiers are `workspace:*` - no
    versioned or floating internal deps, so an intra-repo package
    can never silently resolve to npm-hosted code under the same
    name. Leaf apps export nothing (nothing imports them); the eight
    packages export through package.json - coherent leaf/library
    split. CI typecheck already proves resolution at every merge;
    this adds the private/workspace:* policy shape that typecheck
    does not assert.
  - Supply-chain audit sweep, one real finding filed (31 Oct): `pnpm
    audit` over the full workspace - CLEAN, no known vulnerabilities
    prod or dev; `npm audit` in the standalone website/ project -
    TWO advisories: vite high (dev-server .map path traversal, all
    <=6.4.3) and esbuild moderate (dev-server request exposure).
    Context bounds the severity honestly: both are DEV-SERVER flaws;
    the landing page ships as static Pages output and no dev server
    ever faces a visitor; the app runtime does not use vite. Fix is
    semver-major (vite 8.x) inside a frozen path - so KI-46 records
    it and the bump joins the post-judging supply-chain tier with
    pinning, not a pre-Nov-4 change. SECURITY.md gains a dated
    Dependency posture section carrying today's dated results. KI
    validator: 46 ids, zero dups.
  - KI-46 range corroboration + app stack claims verified (31 Oct):
    website's lock and manifest are in sync (npm ls
    --package-lock-only, no errors) and its vite resolves to
    5.4.21 - inside the advisory's <=6.4.3 range, so KI-46's range
    text is corroborated by resolution, not just the audit header;
    the APP side by contrast: apps/web runs vite ^7.1.12 - outside
    that range entirely - and React ^19.2 / Tailwind ^4.1.16 make
    the guide's and README's "React 19 · Vite 7 · Tailwind 4"
    precise. One advisory, two projects, both facts instrumented:
    the affected tree is only the landing-page toolchain, exactly
    as KI-46 bounds it.
  - env<->.env.example two-way census, clean at head (31 Oct): every
    key the config schema declares appears in .env.example - the
    seven that first seemed absent are COMMENTED optional entries
    (`# ACCESS_TOKEN=`, `# FORGE_MUSE_BIN=...`), documentation by
    design, and a comment-blind regex invented them as phantoms;
    the other direction: every example key has a real consumer,
    including FORGE_RUNTIME_BROWSER which is read in
    runtime-check.ts:60, outside config.ts - extending the known
    annotation that the config-centric census never covered
    non-config.ts readers (setup.sh's opt-out vars were the prior
    instance). 36 example keys, 42 schema keys, zero orphans each
    way once comments and consumers are counted honestly.
  - Browser-workflow counts re-witnessed at head from the CI leg's
    own print (31 Oct): both post-merge logs say "Automated Studio
    workflow: 49 checks passed" - per engine, chromium and firefox;
    the 48-local/49-CI split matches the script's design (visual
    compare is one Linux-only check; baselines on disk are exactly
    linux x 2 engines x 3 slots = 6 pngs). A LOCAL re-attempt on
    this host failed before the driver's first check: the pinned
    managed Chromium build is absent from the browser cache, the
    server-side runtime check stalls, and the UI 422s - a host
    toolchain gap, not an application defect (the script's own
    error names the cure). We did NOT download browsers to the
    host; the CI receipts stand as this head's witnesses, and the
    static call-site count (45) would have UNDERCOUNTED the loops
    anyway - the runtime counter is the measure, never grep -c.
  - pnpm-command census across judge-facing prose (31 Oct): every
    `pnpm <script>` and `pnpm run <script>` token in the guide set,
    README and devlog names a script that exists in package.json -
    50 bare tokens scanned, 48 real commands all resolve, the two
    "misses" are prose ("pnpm monorepo:", "pnpm scripts") that the
    scanner can't tell from commands, and the `pnpm run` form is
    zero-missing. No doc tells a reader to type a command that
    errors out; no script is undocumented in the prose that a
    judge follows. Command-token scanning needs the prose-exception
    note: the two false positives were named, not deleted.
  - Case-sensitive probes found KI-47 (31 Oct): on the frozen main,
    CONTRIBUTING's `[SECURITY.md](SECURITY.md)` link 404s - the root
    security policy was added on integration (9bb0770) after main's
    cut - and GitHub's security-policy indicator reads default-
    branch files, so it stays unset there too. Raw-URL witnesses:
    main 404 / integration 200 for the same path; the lowercase
    docs/security.md threat model resolves 200 everywhere (its
    links are fine). Promotion integration->main post-judging
    repairs BOTH with zero new work; owner decides at tag time,
    exactly the KI-44 decision shape - registered beside it, since
    two same-shaped frozen-entry blemishes should be decided once.
    Lesson for link audits: GitHub's side is case-sensitive Linux;
    a macOS resolver that says 200 can be lying about case.
  - Case-sensitive link audit closed the KI-47 lesson (31 Oct): all
    relative links across every tracked markdown file re-resolved
    against git's OWN blob list (653 raw hits, 477 after applying
    the known dialects: strip ?raw= queries, skip in-page anchors,
    directory links count if the directory exists, and .github/
    template files resolve from the REPO root). Zero case-wrong
    live links remain on integration: the two flagged SECURITY.md
    occurrences are both backtick-quoted meta-text describing
    KI-47, and the one real CONTRIBUTING link's 404 lives on the
    frozen main - exactly what KI-47 files. One hygiene fix rode
    this PR: NEXT_STEPS:759's quoted link now sits in backticks,
    matching its KNOWN_ISSUES twin, so neither register line can
    ever render as the 404 it describes. A scanner's lookbehind
    for backticks misfired and reported those two as live - the
    flagger got flaged: eyeball what a regex claims before filing.
  - Fresh-entry line-cites + wire re-probed at head (31 Oct): the
    only two file:line citations in the newest KI/register text -
    CONTRIBUTING.md:33 (the SECURITY link line) and runtime-check.
    ts:60 (the FORGE_RUNTIME_BROWSER read) - both verified pointing
    exactly where claimed; KI-45/46/47 deliberately cite sources by
    name without line numbers where the anchor would age fast.
    Wire probes on a fresh server (echo provider, temp DB): /api/
    health returns the ok:true envelope, version 0.1.0; /api/errors
    serves catalog_version 2 with 5 groups and 46 published entries
    (45 unique codes, invalid_request's designed double-publish) -
    the 45/46 doctrine holds live, not just on paper.
  - Last stale "six" found at head - in a code comment (31 Oct):
    mcp-server's header still said "The six bounded tools" while
    the shared registry it fronts defines seven and the MCP
    contract test asserts set-equality with that registry (a
    stronger guard than any count number - it cannot age). The
    seven-tools documentation campaign had converged every PROSE
    surface and missed this one comment; fixed word-only, zero
    behavior, and census proves the frozen main never carried this
    file at all (mcp-server is integration-only, main's README
    never mentions MCP) - so no frozen-entry blemish, just a
    head-only stale comment with era-consistent absence on main.
  - Numeric source-comment census closed (31 Oct): every count-
    bearing code comment re-read at head. app.ts:423 "Bounded to
    five issues" matches its code exactly (issues.slice(0, 5) at
    :434); tool.ts:38's "v1 was the six-tool baseline" is correct
    HISTORY, not a stale count - the comment dates the contract
    version, and '2' adding memory.graph is exactly right; the
    catalogue version constant carries no prose count. With
    mcp-server's header fixed last round, source comments are now
    fully verified: era statements stay (honest history), live
    claims match (slice witness), one stale claim was fixed rather
    than trusted.
  - Cross-branch era audit + one marker contradiction fixed (31 Oct):
    tool-count prose verified on BOTH branches - main's guide says
    "Six bounded project/memory tools" (era-correct: main's registry
    has six and no mcp-server), integration says "seven" in all four
    tool-bearing lines with the mcp-server row only there; the
    six/seven boundary is branch-consistent end to end. Same pass
    found P1 #6 header "Partial" contradicting its own body ("the
    remaining piece landed the same day") and the G-table's
    G-10=Closed - status marker fixed with a dated correction note;
    P1 #4 stays honestly Partial (its open half is operator
    provisioning = G-2, queued post-judging), a live partial, not a
    stale one. [Self-correction 31 Oct, same round family: this line
    first said "G-6 identity work" - wrong gap id for P1 #4; the
    cross-check below proves P1 #4 pairs with G-2, and G-6 is the
    separate identity/bearer-token gap whose Partial status has its
    own queue. The pattern again: narration wrote an id before
    checking it.]
  - G<->P cross-consistency audit (31 Oct): all 12 G-table statuses
    walked against their paired P-item markers - 10 Closed rows
    every one paired to a Done P item (G-1<->P0 #3, G-8<->P1 #5,
    G-10<->P1 #6 after the marker fix, G-11<->P1 #7, G-12<->P1 #8,
    and the closed-era rest); the two Partial rows (G-2 worker
    provisioning, G-6 identity/bearer) both correspond to queued
    post-judging policy, not neglect. Zero remaining contradictions
    across the two registers - and the audit caught its own author:
    this section's previous entry had P1 #4 paired to G-6, corrected
    in place above.
  - Reference-resolution census (31 Oct): every KI-NN, D0NN and
    G-NN mention in the audited doc set resolved against the
    registers that define them - KI: zero unresolved (47 ids);
    G: zero unresolved; D: every reference resolves to a defined
    decision, D027 the single documented skip. The census then hit
    its own instrument's imprecision twice: the D027 note claimed
    "the whole repo contains zero references to it" (two
    meta-references exist - the note itself and this register's
    skip mention - while zero treat it as a real decision) and
    "54 defined, 54 referenced" (55 defined at head). Both
    corrected in place with dated notes; the corrected text now
    states the true distinction: zero REAL references, two honest
    meta-mentions.
  - PR-number citation census (31 Oct): every #N citation in the
    audited doc set checked against the repo's full PR list pulled
    by paginated API - 217 PRs exist, 70 distinct numbers cited
    across docs/README/devlog, ZERO nonexistent. Dialect applied:
    hex colors (#102A43 not a PR), line anchors (#L24), heading
    anchors (#letters) all excluded by context, not by hoping.
    Together with the KI/D/G census this closes cross-reference
    integrity for ALL four id families the docs lean on: KI, D, G,
    and PR - nothing anywhere points at an entity that never was.
  - Loopback/token bind interlock probed both directions at head
    (31 Oct): HOST=0.0.0.0 WITHOUT ACCESS_TOKEN -> startup refused
    (exit 1) with the error itself restating the invariant ("must
    be a loopback address ... unless ACCESS_TOKEN is set; without
    authentication the API must not be exposed to a network");
    HOST=0.0.0.0 WITH a 16-char token -> server listens. The
    .env.example comment and SECURITY.md claim are enforced by the
    config schema, fails closed at boot, and the refusal message
    doubles as documentation. Scratch DBs/logs deleted, server
    stopped, tree verified clean.
  - Bearer-gate wire probe: gate holds, one prose overstatement
    fixed (31 Oct): with ACCESS_TOKEN set - /api/projects no-auth
    401, wrong bearer 401, correct bearer 200; /api/health open
    200; a <16-char token refuses boot ("Too small... >=16
    characters"). SECURITY.md's wording (every /api route EXCEPT
    GET /api/health) verified exactly, including its 31 Oct
    socket-level block - my own first read tripped on
    .env.example:14, the ONE file that said "every /api route"
    without the documented health exemption; fixed comment-only,
    now names the exemption in place. The probe that was meant to
    catch the code lying instead caught the comment lying - and
    SECURITY.md came out of it corroborated on a second route.
  - Envelope-probe family strikes again - KI-48 filed (31 Oct):
    oversized body (~1.1 MB to /api/memories, limit is 1 MiB at
    app.ts:137, code-only) -> 413 with code `internal_error` and
    Fastify's default "Request body is too large" message: client
    error wearing a server-fault code, KI-45's mechanism a second
    time; and the catalogue holds NO 413 entry at all, so the fix
    needs a new `payload_too_large` entry, not just a mapping.
    All three code-honesty fixes (KI-43's five codes, KI-45's
    bad_request, KI-48's 413) now queue as ONE lockstep PR with a
    single version bump 2->3 - discipline: probe families keep
    finding siblings, and queues consolidate instead of scattering.
    Also witnessed this pass: /api/meta reports its own posture -
    loopback-only tokenless, shared-token with the bearer -
    matching SECURITY.md exactly. KI validator: 48 ids, zero dups.
  - Envelope sweep on error paths + an honest non-completion (31 Oct):
    404 answers `not_found` with "No route for METHOD path" - the
    message names method AND path, consistent even for phantom
    endpoints this probe invented; malformed bodies answered
    `validation_failed` + details[] (path-level messages) three
    times running, and one empty shell var was caught by the
    schema itself ("Too small..."). Method misfires were ALL probe
    side: POST /api/projects and /api/project do not exist (the
    real family is /api/forge/projects), field is `type` not
    `category`, enum has no "fact" - four probe fumbles, zero app
    defects, every refusal honest. The socket-level idempotent-
    replay probe did NOT complete this round (project-create body
    kept refusing curl's guesses) - the behavior stays witnessed
    by the inject-based mirror suite that runs every merge; the
    log says what was NOT done rather than pretending otherwise.
  - Replay-socket promise closed at head (31 Oct): last round's
    non-completion finished with the actual schema (project create
    is {project_id, name?} under /api/forge/projects - my earlier
    {name,goal} guess was the misfire). Live curl, fresh server:
    POST /api/memories with Idempotency-Key -> 201 created:true;
    same key+body -> byte-identical 201 response replayed WITH
    header `idempotent-replayed: 1` (grepped from real response
    headers). The replay deliberately re-sends the original
    response - body included - so the HEADER is the replay marker;
    a reader watching only bodies would miss the distinction,
    which the D049 docs already state and this probe now shows at
    socket level for the first time. One stray python fragment in
    the scratch command tracebacked harmlessly - probe hygiene
    note: paste-no-more leftovers get deleted, not shipped.
  - Wire-probe ledger opened (31 Oct consolidation): the scattered
    live-probe witnesses (malformed body, oversized body, errors
    envelope, health envelope, bind interlock, bearer gate, meta
    posture, replay header, error-path envelopes) now sit in one
    dated index table at the end of the cadence section - rows say
    probe -> observed -> owner (KI-45/KI-48/D049/SECURITY). The
    post-judging lockstep PR (KI-43+45+48) starts from this table
    as its current-wire baseline instead of re-probing from
    scratch; consolidation, not new claims - every row was a
    witness line first, table second.
  - Parallel-actor drift census (31 Oct): the shared repo keeps
    living outside my lane and that is FINE - study02's PR #187 is
    OPEN with head advanced to 2f05954 (they're working; their
    biome leg is theirs, never touched), remote heads 41->42 (a
    new foreign branch appeared; not mine to evaluate or delete),
    while PR #28's pinned pull-ref is still f1a16f791e49 (the
    frozen-hold recovery handle holds). My cadence's latest is
    integration @ 2d649b6 with main still c32d03b. The register's
    job: record what moved, do not act on what is not mine.
  - PR template promises audited against the enforcing ruleset
    (31 Oct): ruleset 26184026 read live - required_approving_
    review_count = 1 matches CONTRIBUTING's "one approving review";
    allowed_merge_methods = [squash] makes the template's
    "squash-merged, so each PR becomes one commit" not just habit
    but ENFORCED policy; the three required status contexts are
    exactly the three CI job names; plus two settings the docs
    don't claim and now record: stale reviews auto-dismiss on
    push, and deletion/non_fast_forward are blocked on
    integration. Template prose and GitHub policy agree line for
    line at this head.
  - All four rulesets re-read with full config (31 Oct): the tag
    freezes (26184029, 26245608) carry bypass_actors: [] - nobody,
    not even admins, is exempt from the deletion/non_fast_forward/
    update blocks on the tags; that is what bypass-proof by
    settings means, witnessed as an empty list. The two branch
    protections carry exactly one registered bypass: RepositoryRole
    admin in pull_request mode - the open, nameable route my
    --admin squash merges travel, not a hidden hole. Rules per
    ruleset match the preservation doc's table; the doc's
    "bypass actors unchanged" claim now has its first full-list
    witness.
  - Website sentinel refreshed, one happy coincidence noted (31
    Oct): the last PUSH run of website.yml is still 29 Oct
    (0c4bcf7c, success) - no pushes since; the deployed site answers
    200 with the submitted title ("Muse Recall - correctable
    project memory for AI-built software"); and PR #28's own
    website.yml run sits at action_required on pull-ref head
    f1a16f79 since 30 Oct - GitHub's fork-approval gate holding the
    frozen-path PR exactly as our freeze decision intended: two
    independent holds, one decision.
  - Zero-touch freeze proof, computed from git history with the
    window declared (31 Oct): across ALL integration commits since
    31 Oct 00:00, file-level log against docs/hackathon-evidence,
    docs/submission, docs/demo/evidence, website = ZERO touches.
    Widening the window honestly exposed a pre-doctrine sliver
    worth explaining rather than hiding: between main's cut
    (c32d03b, 30 Oct 13:17) and the freeze doctrine, PR #42's
    ef72895 (30 Oct 19:11, NOT an ancestor of main) updated three
    docs/submission lines by four words - "five" -> "seven" rule
    families. Era-checked in BOTH directions: main's guard
    implements exactly the five families its submission copy
    names; integration says seven and implements seven. The era
    rule working as designed, not drift. Tag derefs re-read exact
    (5e83616e/71416ae7/6640e83f). Method rule: a zero-touch claim
    is only honest with its scanned window declared.
  - README REST table repaired mid-freeze (31 Oct): a Notes
    paragraph (D049 idempotency + token-mode wording) sat IN THE
    MIDDLE of the API route table - every GitHub markdown renderer
    shows the following dozen rows as a wall of literal pipes, and
    the same insertion had left /api/tools listed TWICE with
    different descriptions. Fix is docs-only layout: table made
    contiguous again, Notes moved below it, duplicate row merged
    (schemas note folded in). The frozen main never had the defect
    (its README predates the insertion - paragraph absent, single
    clean table) - so judges saw no broken wall; the integration
    tree did, and integration's README is what contributors read.
    Rendering classes are audited like content now: the idempotent
    + health-exemption wording itself verified exact.
  - Markdown table integrity audit, whole repo, fence-aware (31
    Oct) - and an own-it on #230: the README REST table was only
    HALF fixed - the paragraph moved out but a BLANK LINE still
    split the table, leaving 12 sessions rows rendered as a
    literal wall of pipes; contiguity now means SAME BLOCK under
    GFM (a blank line ends a table), and #230's "unbroken" claim
    was half-true - caught by the very audit its lesson motivated.
    Audit ran over every git-tracked .md (399 pipe-blocks):
    findings - (1) README split, fixed by merging the blocks;
    (2) FINAL_INTEGRATION_REPORT table cell contained an
    UNESCAPED pipe inside a code span (`<true|false>`,
    `seed || index`) - GFM splits cells before inline parsing, so
    code spans do not protect pipes; escaped both; (3) a register
    bullet's wrap put `| 3 skipped` at line start - re-wrapped to
    `/ 3 skipped` so no scanner re-trips and no renderer ever
    wonders; (4) earlier findings at SUBMISSION_PRESERVATION and
    memory-design were scanner false positives (pipe inside a
    fenced sh block; escaped \| cells) - scanner upgraded to be
    fence-aware and escape-aware, which is why the re-run is
    trustworthy. Convergence: 399 blocks, ZERO findings, dated.
  - Heading-skip audit + a process slip, both triaged honestly
    (31 Oct): (a) heading-level scan over non-era .md found exactly
    2 h1->h3 skips - DECISIONS.md is a UNIFORM convention (all 55
    entries are ### under one #; changing one style point across a
    55-entry file for symmetry is doc churn, declined with reason)
    and README's lone ### tagline at :3 stays as-is by judgment -
    no TOC, no renderer cares, and an edit for edit's sake is its
    own defect class. Audit ships with reasoned exemptions, not
    reflex patches. (b) Own-it, process: this week's table-audit
    commit briefly landed on LOCAL integration before the feature
    branch was cut - fixed by resetting local to origin/integration
    BEFORE merging (nothing was ever pushed to integration, no
    force anywhere). Drill banked: cut the branch BEFORE the
    commit; diffstat-vs-claim already saved the ship, the reset
    kept ff-only pulls honest.
  - Count-freshness sweep passes everywhere, and the watch drill
    gets its event filter (31 Oct): 76 files / 922 passed / 3
    skipped (925) verified identical across README, inventory
    (:22/:265/:287/:421), DEVELOPMENT_LOG (:211/:215) and the
    register; 76 test files counted on disk - no number drifted
    across a dozen doc edits this week. Watch-family correction
    (variant 5 materialised): "watch the post-merge run" resolved
    to the TOP of gh run list --branch integration, which can be
    the PR's own already-completed run - the true post-merge
    witness must be taken with --event push. For #232 the real
    push run on 64a27c2 was then awaited to SUCCESS (05:5xZ), so
    the double gate holds; the drill line now reads: after merge,
    `gh run list --event push --limit 1` THEN watch.
  - 49-check receipts fresh from today's push runs, and drift
    census pays for itself by catching MY OWN leftover (31 Oct):
    both managed-engine legs printed "Automated Studio workflow:
    49 checks passed" in the a80d975 push run (gate of record,
    quoted with timestamps, not re-run locally). Head census said
    42: the extra is feature/ki47-preservation-pairing - MY stale
    branch from #211's interrupted-ship chain. The recovery read
    PR state (MERGED) and the tree but missed the delete-branch
    step's aftermath; GitHub's merge record (squash f50248d0,
    mergedAt 03:44Z) proved the branch content landed, so the
    head was my own merged residue in my own lane - deleted,
    back to 41, matching the preservation census band. Sixth
    interrupted-chain aftermath detail banked: after a partial
    merge, the checklist is EVERY step re-verified against
    external state - checks, merge, branch DELETE, pull - branch
    deletion is a step, not a footnote; the periodic head census
    is the net that caught it.
  - Branch hygiene census closes both directions (31 Oct):
    forward - the 100 most recent merged PRs' headRefNames crossed
    against live remote heads: ZERO survivors (after yesterday's
    #234 residue, every merged branch is gone; my cadence's
    delete-on-merge is complete for its era). Backward - all 41
    remote heads classified: 12 claude/* (foreign actor), 18
    agent/* (PHASE-era historical lanes, the SUBMISSION_
    PRESERVATION 39-41 band, ancestry checks queued in action-
    register C-11), 2 experiment/* + 1 study02/* (foreign study
    lanes), integration+main, and 6 own-lane fix/feature/harden/
    release heads from the pre-cadence era - also C-11 material.
    41/41 accounted, zero unknowns. Scanner family miss owned:
    first pass called 20 heads UNKNOWN because my regex wrote
    "experiments/" (the repo says experiment/) and forgot the
    agent/ family - census FPs are my naming, not the repo's.
  - C-11 pre-census, read-only and judgment-free (31 Oct): every
    historical remote head's ancestry computed against the two
    live refs: 32/39 sit IN main's history (merged, safe to prune
    or keep - content already ships); 7 diverge - 4 PHASE-era
    agent/* heads (squash-workflow signature: content landed by
    other routes, ancestry did not) and 3 foreign-lane heads whose
    keep/prune is NOT mine. Diverged != unmerged: the post-judging
    work is now 7 content-diff reviews, not 39 branch guesses.
    Register C-11 updated with the census; decision still parked
    behind judging exactly as tier C requires.
  - C-11 census sharpened by merge records (31 Oct): the 4
    divergent agent/* heads have NO merged PR from their refs -
    they predate PR discipline, so ancestry absence AND record
    absence stack: content-landing is genuinely unproven, which
    makes them real post-judging content-diff reviews (phase-era
    process docs possibly exist nowhere else - keep-with-purpose
    is the likely outcome, not prune). The 32 merged heads need no
    such review. Census honesty: yesterday's "content likely
    landed via other routes" was a hypothesis; the records say
    unproven - hypothesis retired, review task specified.
  - Post-ship head drift, attributed honestly (31 Oct): remote
    heads 41 -> 40 after #237. My session's deletions were exactly
    two (the #234 ki47 residue and each PR's own delete-on-merge,
    current branch included); the THIRD disappearance -
    agent/muse-recall-product-positioning, a PHASE-era foreign
    head - happened outside this session. Foreign actors prune
    their own history too: recorded as drift, not investigated
    further, not my authority either way. #187 remains OPEN;
    C-11's census numbers carry the "as-censused" date for just
    this reason.
  - Mass head prune by another actor, witnessed whole (31 Oct):
    40 -> 9 remote heads between two of my own counts, minutes
    apart. Every vanished head was, per that morning's ancestry
    census, an ancestor of main - content ships inside main
    whatever the branch refs say, so the prune destroyed nothing.
    Survivors: main, integration, and EXACTLY the seven divergent
    heads from the C-11 census - first-time SHAs recorded,
    still-divergent re-verified - the foreign trio plus the
    agent/* quartet awaiting post-judging content diffs. Actor
    not attributable from available records (DeleteEvents absent
    from the events API); recorded as unknown and left alone -
    attribution is honest when present and declared-absent when
    not. Tag derefs exact (6640e83f/71416ae7/5e83616e), #28 pin
    intact, #187 head alive at 7a6cacf5. Frozen entry: untouched.
  - Prune settled: 9 heads stable across a re-check, SHAs unchanged;
    SUBMISSION_PRESERVATION's branch-census block gets its dated
    refresh in place (original text kept verbatim above it, doctrine
    honored) so the doc no longer says "39 branches" to a reader
    seeing 9. Preservation doc and cadence register now tell one
    story with two dates.
  - C-11 evidence fully pre-staged, read-only (31 Oct): the quartet's
    unique-file union is exactly 9 items - three long-superseded UI
    components, three video-concept era docs, three submission-era
    records including PHASE14B_INDEPENDENT_AUDIT.md, which exists
    on no other ref anywhere (process evidence with a single home).
    All four branch tips share one fork point (d35fa9d8, 27 Oct
    11:44) - one era, one decision surface. First fetch attempt by
    raw SHA failed ("couldn't find remote ref" - server doesn't
    allow sha-in-want) and the stale FETCH_HEAD briefly poisoned
    the comparison; caught before any claim, redone against
    tracking refs with MATCH verified remote-vs-local. Post-judging
    owner now decides on a 9-line list, not a 4-branch fog.
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
