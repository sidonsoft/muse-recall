# Muse Recall — Post-Hackathon Integration & Production Roadmap

**Version:** 1.1 (1.0 checked against the repository on 30 October 2026)
**Prepared:** 30 October 2026
**Planning horizon:** November 2026–April 2027
**Status:** Proposed delivery plan · Hackathon submission due 4 November 2026, to be frozen
as tag `submission-2026-11-04` · External PRs target `integration`

> **Evidence boundary:** The project owner has confirmed the branch policy below. Apart from
> the "Repository check" section, which links each claim to the repository, all
> capabilities, controls, targets, and milestones are proposed work until verified and
> recorded with supporting evidence. Dates are planning targets; release gates determine
> readiness.

## Repository check (30 October 2026)

Version 1.0 was written without the repository in view. These are the places where it
differed from what the repository contains, and how this version handles each one.

| Roadmap 1.0 said | Repository shows | Change in this version |
|---|---|---|
| The submission is already frozen on `main` | Not submitted yet; the deadline is 4 Nov 2026 9:00 PM ET. `main` and `integration` both point at `c32d03b` (PR #29). No tags exist. | Preservation happens at submission time; see [SUBMISSION_PRESERVATION.md](../release/SUBMISSION_PRESERVATION.md). The 14-day plan moves preservation from 1–2 Nov to 4–5 Nov. |
| `main` gets no merges for the whole plan | [CONTRIBUTING.md](../../CONTRIBUTING.md) promotes tested batches from `integration` to `main` with a merge commit. The website deploy ([website.yml](../../.github/workflows/website.yml)), the Codespaces button and the repository front page all follow `main`. | `main` is frozen only while judging is open, then promotions resume (owner decision, 30 Oct 2026; §2). The protected tag and Release are the permanent frozen record. |
| Release tags must not advance `main` | Same promotion flow | Release tags are cut from approved `integration` or `release/*` commits, which are then promoted to `main`. |
| Product is a memory layer for AI coding agents, with MCP, Claude Code and Codex targets | The shipped product is a local-first HTML Studio for Meta Muse Spark with correctable project memory. There is no MCP server; [muse-integration.md](../muse-integration.md) lists MCP as a future option. [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md) names "memory layer for existing agents" as one candidate direction, not the chosen one. | Kept as the proposed direction, labelled as a change of product focus that needs an owner decision before P0 work starts (§3). |
| Inventory the implementation from scratch | Much already exists and is documented: typed memories with scope, provenance, confidence, validation status and lifecycle (`active`, `superseded`, `deleted`, `expired`) in [memory.ts](../../packages/shared/src/memory.ts); append-only correction history and supersession edges; SQLite/FTS5 retrieval with scored, budgeted results; tool calls that need explicit approval; an append-only audit; a written threat model ([security.md](../security.md)); about 740 tests behind `pnpm verify`; a working backlog in [NEXT_STEPS.md](../NEXT_STEPS.md). | The 3–4 Nov inventory starts from these documents and confirms them rather than rediscovering them. |
| A hosted service, authentication and remote access are assumed | The app is single-user and loopback-only: the server refuses a non-loopback `HOST` and has no authentication by design (security.md, T6). | Authentication and remote access are new work, gated behind G4 (§8). |
| Treat confidence as metadata, not a probability, unless calibrated | `ConfidenceSchema` is documented in code as "a probability", but it has never been calibrated. | Kept the roadmap's rule. Relabelling the code comment is a G1 item. |
| Confirm the license | MIT ([LICENSE](../../LICENSE)). No CLA or DCO. | Recorded. No contribution terms are added by this roadmap. |
| Publish CONTRIBUTING, a PR template, issue templates and a security route | CONTRIBUTING.md and the PR template exist (PR #29). | This change adds [SECURITY.md](../../SECURITY.md) and issue templates. |
| Protect `integration` with review and required checks | **Applied.** Verified 31 Oct 2026 from the API: ruleset "Protect integration" (active) requires PRs, and its required-status-checks parameter names exactly "Lint, typecheck, test, build" plus both managed-browser legs (strict=false). Companion rulesets "Protect main" and "Freeze submission tags" are active too. | Closed as owner action; census lives in [SUBMISSION_PRESERVATION.md](../release/SUBMISSION_PRESERVATION.md). CI also runs on pushes to `integration`. |
| A judging deployment to preserve | Judges use the public repository, the GitHub Pages site and Codespaces (offline provider, seeded demo). There is no hosted app. | Preservation covers the tag, Release, archive checksum, and the site and Codespaces entry points (§2). |

## 1. Executive summary

Muse Recall's next phase should establish a dependable project memory layer for AI coding
workflows: knowledge that survives sessions, preserves its sources, supports correction, and
remains useful across agents and development environments. Today's product applies that
memory to one workflow, Muse Spark HTML Studio, and the memory engine already carries
provenance, correction history and supersession. The roadmap generalises that engine
rather than replacing it.

The first priority is to preserve the hackathon submission while creating a disciplined path
for external contributions. The second is to validate one complete workflow: connect an
agent, select a project, retrieve relevant memories with provenance, propose a change,
review it, and persist the approved result. Broader integrations and hosted deployment
should build on that proven foundation.

The recommended sequence is **preservation and baseline → memory contract and MCP → Claude
Code and Codex pilots → visual explorer and operational hardening → production release
candidate → gated release**.

By April 2027, the intended outcome is a small, supportable release with reliable project
isolation, controlled writes, a documented compatibility matrix, usable recovery procedures,
and measured retrieval quality. The schedule does not justify relaxing these requirements.
If readiness is incomplete, continue a limited beta and publish the remaining work.

### Delivery principles

1. Preserve the submitted artifacts throughout this roadmap: the `submission-2026-11-04`
   tag, its Release and the checksummed archive never change.
2. Accept external contributions through reviewed PRs into `integration`.
3. Keep memory behavior in a shared core; expose it through thin adapters.
4. Treat retrieved content as untrusted data, regardless of its author or storage location.
5. Enforce authorization in the service; agent instructions are supplementary controls.
6. Favor a narrow, verifiable workflow over an expanding integration list.
7. Make provenance, correction, export, and recovery first-class capabilities.
8. Label experimental behavior and keep it out of the default production path.

## 2. Branch governance and submission preservation

### Branch responsibilities

| Branch or reference | Purpose | Proposed policy |
|---|---|---|
| `submission-2026-11-04` tag + Release | Frozen hackathon submission | Created once on the submitted commit; protected against update and deletion; never moved |
| `main` | Default branch; what the README, website and Codespaces show | No direct pushes, force pushes or resets. Frozen from submission until judging results are announced. Afterwards, tested batches are promoted from `integration` with merge commits |
| `integration` | Post-hackathon collaboration | Default target for external PRs; squash-merge only after required review and checks |
| `feature/*`, `fix/*`, `docs/*` | Scoped contribution work | Branch from `integration`; PR back into `integration` |
| `research/*` | Optional experiments | Explicitly experimental; require separate review before entering a release |
| `release/*` | Stabilization snapshots | Cut from an approved `integration` commit; fixes return to `integration` through PRs |
| Release tags (`v*`) | Versioned distributions | Tag approved release commits; record source SHA and artifact digests |

Branch patterns and tag names are conventions to adopt, not statements about existing
references. Do not recreate or move an existing submission reference.

**Decided (owner, 30 October 2026): `main` is frozen only through judging.** Once results
are announced, promotion from `integration` to `main` with merge commits resumes. The tag and
Release stay the permanent record of what was judged, and the website, Codespaces and
repository front page keep showing current work. The alternative, a permanently frozen
`main` with the default branch moved elsewhere, was considered and not chosen.

### Preservation checklist

- Record the exact submitted commit SHA when the form is submitted; do not assume the
  current branch tip is sufficient. The manifest is
  [SUBMISSION_PRESERVATION.md](../release/SUBMISSION_PRESERVATION.md).
- Record the current `main` SHA and resolve any discrepancy with the submitted SHA before
  creating preservation references.
- Preserve the submitted source, lockfiles, build instructions, demo assets, evaluation
  inputs, and relevant configuration metadata. Store secrets separately from the archive.
- Protect the submission tag and `main` against modification or deletion with rulesets. An
  annotated Git tag alone is mutable; retain an independent archive with checksums attached
  to the Release.
- Preserve the judging entry points: the public repository, the GitHub Pages site and the
  Codespaces configuration. Post-hackathon builds that need a hosted environment get a
  separate one with separate credentials and data.
- Display the submission SHA and post-hackathon development status prominently in project
  documentation (after judging, so the judge-facing README stays as submitted).
- Check that the frozen reference still matches its recorded SHA before every release and
  after repository administration changes.

Security fixes and feature work continue on `integration`; a vulnerability in the frozen
artifact should trigger disclosure and access decisions without silently rewriting
submission history.

### Review and release authority

Assign a maintainer accountable for each release and reviewers for memory persistence,
integrations, security, and operations. Roles may be held by the same people in a small
team, but security-sensitive changes should receive an independent reviewer. If that review
is unavailable, defer the sensitive merge or release.

Protect `integration` with PR review and required checks (prepared ruleset: "Protect
integration"; required checks "Lint, typecheck, test, build" and "Managed browser workflow
(fake provider)"). The PR template and CONTRIBUTING.md already state `integration`
explicitly. A merge into `integration` must not automatically deploy to production; today
nothing deploys from `integration`. Releases use a reviewed snapshot and a documented
approval record.

## 3. Target architecture and scope

> **Product focus.** Moving from "memory for Muse Spark HTML Studio" to "memory layer for AI
> coding agents" is a change of product direction. Confirm it before P0 work starts. If the
> focus stays on HTML Studio, §4 shrinks to the Muse CLI integration and the rest of the
> roadmap still applies.

| Component | Intended responsibility | Exists today |
|---|---|---|
| Memory core | Validation, durable records, retrieval, provenance, revisions, conflict handling, export and deletion | Largely: `packages/memory-engine`, `packages/shared` (no export/import yet) |
| Integration layer | Versioned tool/API contracts, MCP transport, client configuration and compatibility checks | Partly: Fastify API, `packages/tool-runtime`, Muse CLI provider. No MCP. |
| Trust boundary | Identity, project authorization, write policy, approval verification, quotas and audit records | Partly: tool approval, append-only audit, loopback/host/origin guards. No identity or authorization. |
| Application layer | Project selection, search, visual explorer, memory review and correction | Partly: React web app with memory inspector and correction history |
| Operations layer | Packaging, deployment, migration, monitoring, backup, recovery and release management | Partly: migrations, `db:backup`, `db:purge`, health endpoint, CI |

All clients should use the same authorization and mutation semantics. The visual explorer
must not bypass protections enforced for agents. The current stack (Node 24, TypeScript,
Fastify, SQLite/FTS5, React) is the starting point; change storage, indexing or hosting only
when the inventory and small benchmarks show a need.

**Initial release scope:** project-scoped memory, source-linked retrieval, reviewed
mutations, MCP access, verified Claude Code and Codex setup paths, a useful explorer, a
supported self-hosted installation, and operational recovery.

**Deferred unless evidence changes priorities:** autonomous execution, broad agent
orchestration, a large adapter marketplace, complex billing, and unrestricted multi-tenant
hosting. Existing experimental features (`experiments/muse-forge`, research scripts) should
be inventoried and assigned an explicit support status.

## 4. Integration priorities

The sequence below prioritizes shared contracts and observable user workflows. Client names
identify intended compatibility targets; support is claimed only after testing the named
versions and environments. None of these integrations exists yet.

| Priority | Target | Deliverable | Exit evidence |
|---|---|---|---|
| P0 | Shared contract and MCP | Small versioned tool surface; explicit project context; bounded results; structured errors; configuration examples | Contract tests, authorization tests, supported transport decision and one reference-client walkthrough |
| P1 | Claude Code | Verified installation/configuration guide and retrieval-to-approved-write workflow using the shared surface | Clean setup on documented versions; scope, reconnect, denied-write and malformed-result tests |
| P1 | Codex | Equivalent verified workflow and setup guide | Same conformance suite and clean setup evidence on documented versions |
| P2 | Other agents and IDE clients (including Muse CLI via `muse mcp`) | Compatibility checklist, reusable examples and demand-led pilots | Two independent successful workflows per supported client; named maintainer and version matrix |
| P3 | Specialized adapters | Thin adapters only for a demonstrated gap in the shared interface | Recorded need, maintenance owner and no duplicated memory policy |

### Contract requirements

- Begin with a narrow set of operations: search, fetch, propose memory, review proposal, and
  commit an authorized revision. These are conceptual operations; finalize names and schemas
  after the inventory. The existing six bounded tools and the API in the README are the
  starting point.
- Keep reads and mutations distinguishable. Proposals must not become accepted memory merely
  because a tool call succeeded.
- Derive allowed project access from authenticated identity. A supplied project ID selects a
  resource; it does not grant permission.
- Return record IDs, source references, revision/status, timestamps, and concise excerpts.
  Bound result count and payload size (current defaults: 8 memories, 4,000 characters).
- Define pagination, timeouts, cancellation where supported, retry behavior and idempotency
  for mutations.
- Publish a compatibility policy and machine-readable error codes. Test partial failures,
  duplicate requests and interrupted connections.
- Document supported client versions, operating systems, transports, authentication modes,
  setup dates and known limitations.

Verify current protocol and client documentation when implementing each integration. The
Muse CLI only documents streamable-HTTP MCP servers (muse-integration.md), so a stdio-only
server would not cover it. Do not promise a transport, hook, permission prompt, or approval
feature until it has been confirmed in the supported client. Approval must remain
enforceable by Muse Recall even when a client lacks a native review interface.

## 5. Security and prompt-injection hardening

The current threat model for the local beta is [docs/security.md](../security.md) (T1–T10).
This section extends it for remote, multi-client use.

### Threat model

Assume attackers can influence imported files, repository text, tool results, memory bodies,
source links, and agent-generated proposals. A memory may contain instructions to ignore
safeguards, leak secrets, write false history, execute commands, or read another project. A
legitimate contributor can also make an accidental or misleading write.

Assets to protect include private project knowledge, credentials, record integrity, project
boundaries, approval decisions and the submission archive. Map the trust boundaries among
clients, the service, storage, indexes, importers, the explorer and external resources
before enabling remote access.

### Required controls

| Risk | Proposed control | Required verification |
|---|---|---|
| Retrieved text treated as authority | Structured data envelopes, clear untrusted-content labeling and client guidance; no privilege from memory text (exists for prompt construction today) | Injection fixtures embedded in bodies, titles, links and imported documents |
| Unauthorized reads or cross-project results | Server-side authorization for reads, writes, search, caches, exports and explorer requests | Negative tests across identities and projects, including filtered search and index rebuilds |
| Poisoned or accidental writes | Proposal/review/commit lifecycle; actor and source attribution; scoped write policy | Denied-write, forged approval, replay and revision-conflict tests |
| Approval reused after content changes | Bind approval to the exact payload, project, action, revision and expiry; recheck authority at commit (Forge already binds approval to an exact-byte SHA-256) | Changed-payload and stale-approval rejection |
| Exfiltration or unintended execution | No automatic execution of memory content; explicit controls for outbound fetches; least-privilege credentials | Malicious URL, command-like content and secret-exposure tests |
| Compromised imports | Validate formats and sizes; restrict file paths and remote fetch destinations; quarantine suspicious proposals | Traversal, malformed input, resource exhaustion and internal-network fetch tests |
| Sensitive data leakage | Secret detection before persistence where feasible, redaction, configurable retention and safe logs | Seeded-secret checks in storage, exports, traces and UI |
| Abuse of remote services | Authentication, short-lived/scoped credentials where feasible, rate limits and revocation | Expired/revoked credentials, quota exhaustion and resource-limit tests |

Sanitization and prompt wording reduce exposure but cannot establish a security boundary or
guarantee that an agent ignores malicious text. Keep service permissions narrow enough that
unsafe model behavior cannot grant new access. Escape rendered content in the explorer and
validate links separately from instruction handling.

Maintain a versioned adversarial suite covering indirect injection, forged provenance, fake
approvals, repeated poisoning, superseded records and mixed trusted/untrusted content.
Require zero successful unauthorized operations in this defined suite; publish its scope and
residual risks. This is a release criterion, not proof of universal injection immunity.

A private vulnerability-reporting path is published in [SECURITY.md](../../SECURITY.md).
Publish a triage owner, severity policy, credential-revocation steps and incident playbook
before inviting external production users.

## 6. Memory engine roadmap

### Establish the record contract

The current record (`MemorySchema` in `packages/shared/src/memory.ts`) already has stable
identity, type, scope, project, content, source, confidence, validation status, lifecycle
status and timestamps. Gaps against this roadmap: an explicit revision number, an actor
field, and a `proposed` state. Treat confidence as qualified metadata, not a probability
unless calibrated. Preserve provenance through edits, imports, retrieval and export.

Use explicit states such as proposed, accepted, superseded, disputed and deleted. Today
`active`/`superseded`/`deleted`/`expired` is the lifecycle and `disputed` is a validation
status; decide whether `proposed` joins the lifecycle or lives in a separate proposal table.
Keep agent proposals separate from established project decisions.

### Make changes safe

- Preserve revision history and explicit supersession links instead of silently replacing
  prior conclusions (exists: correction is one transaction with supersession edges and
  history).
- Detect concurrent edits with revision checks and return actionable conflicts.
- Use idempotency to prevent duplicate writes after retries (content-hash dedupe exists for
  creation).
- Explain contradictory records and let users resolve them; avoid silently inventing a
  single authoritative answer.
- Specify deletion across primary storage, indexes and caches. Define backup expiry and how
  deleted records remain suppressed after recovery.
- Support portable export/import with schema versions and round-trip checks, including
  provenance and relationships.

### Improve retrieval with evidence

Start from the measured baseline: `pnpm eval:retrieval`, `pnpm bench:retrieval` and the
Phase 11–17 evaluation reports. Compare available retrieval approaches against a small,
curated project-question set before adding complexity. Filter access before returning
candidates, including through caches and secondary indexes.

Evaluate architectural decisions, constraints, corrections, historical questions, exact
references and queries with no supported answer. Distinguish current guidance from
historical evidence. Measure relevance, stale results, source coverage and latency together;
faster retrieval is not useful if it repeatedly resurfaces superseded decisions.

Keep embedding/index generation versioned if introduced (embeddings are not used today). Plan
rebuilds and failure recovery without losing authoritative records. Do not assume that
semantic similarity establishes factual correctness.

## 7. UX and visual memory explorer

Build the explorer around practical questions: **What does this project remember? Why is
this result relevant? Is it still current? Who changed it? Can I correct it safely?** The
existing memory inspector (detail, provenance, correction history, retrieval explanation) is
the starting point.

### First usable explorer

- Clear project and permission context on every screen.
- Searchable list with filters for type, source, status and date.
- Detail view with provenance, revision history and supersession links.
- Review queue with readable diffs, approve/reject actions and visible consequences.
- Corrections, disputes and deletion flows with authorization and audit records.
- Empty, loading, denied-access and recoverable-error states; keyboard navigation and
  accessible labels.

### Visual exploration

Add a relationship graph and timeline after the list/detail workflow is usable. Distinguish
sourced relationships from inferred suggestions. Show why edges exist, support filtering and
bounded expansion, and link every node to its record. Avoid displaying similarity as a
confirmed causal relationship.

For dense projects, use clustering or progressive expansion instead of an unreadable full
graph. Provide an accessible table/list alternative and verify that graph queries cannot
reveal unauthorized record names or counts.

**UX acceptance:** At least four of five representative pilot users should complete search,
provenance inspection and correction review without facilitator intervention. Record task
time, failures and misunderstandings; this small sample guides improvements rather than
establishing broad usability claims.

## 8. Deployment and release operations

Deliver a supported local/self-hosted path first; the current local app and the Codespaces
configuration are the base. Select a reference deployment based on the verified stack,
expected pilot usage and maintenance capacity. Offer a reproducible package, validated
configuration, first-run checks and a short smoke test.

Keep development, staging, production and judging environments separate. Use dedicated
credentials and datasets. Default staging and preview environments to synthetic or
explicitly approved data. Do not expose an unauthenticated remote service as a convenience
default; the loopback-only startup check stays until authentication exists.

Before production:

- Pin and record build dependencies, source revision and release artifact digests; document
  supported versions.
- Supply health/readiness checks, resource limits and failure behavior for unavailable
  storage or indexing.
- Rehearse migrations on a representative backup and document compatibility between old/new
  application and schema versions.
- Use backward-compatible migration steps where feasible. An application rollback must not
  assume a destructive database migration can be reversed; preserve backups and define a
  forward-repair path.
- Encrypt backups where supported, restrict access and restore into an isolated environment
  on a documented schedule.
- Define upgrade, rollback, incident and disaster-recovery runbooks with an accountable
  operator.

Treat managed hosting as a separate decision gate. Identity lifecycle, tenant isolation,
regional/data-retention requirements, support capacity and cost controls must be
demonstrated before a multi-tenant offering is advertised.

## 9. Observability and operational targets

Measure request rate, error rate and latency by operation; retrieval empty-result rate;
accepted/rejected proposals; conflict and retry counts; storage/index health; backup age;
and integration failures by supported client version.

Use request/correlation IDs across tool calls, service operations and audit events. Audit
mutations and permission changes with actor, project, action, revision, outcome and time.
Restrict access to audit data and define retention. Avoid recording raw prompts, memory
bodies, credentials or source content in routine logs. Make diagnostic capture explicit,
bounded and redacted.

Proposed initial production objectives, to validate during the pilot:

| Objective | Initial target | Measurement boundary |
|---|---|---|
| Service availability | 99.5% monthly | Valid authenticated requests to the supported service; report dependency-related failures as well as their causes |
| Search latency | p95 ≤1 second | Server-side search over a documented 10,000-record reference project at 5 requests/second; report hardware and index state |
| Write correctness | No lost acknowledged writes in fault tests | Acknowledgment only after the documented durable commit point |
| Recovery point | ≤24 hours | Maximum recoverable data gap under the supported backup schedule |
| Recovery time | ≤4 hours | Isolated restore drill from incident declaration through verification of service and records |

These are targets, not existing guarantees. Record client-perceived latency separately from
server timing. Establish alerts for sustained errors/latency, failed backups, authorization
anomalies and storage limits; assign an owner and a response action to every alert.

## 10. Tests and release evidence

| Test layer | Required coverage |
|---|---|
| Core behavior | Validation, revisions, supersession, conflicts, lifecycle transitions and idempotency |
| Persistence | Interrupted writes, restart recovery, migration correctness, export/import and index rebuilds |
| Security | Project isolation, approval binding, credential revocation, injection fixtures, safe rendering and importer boundaries |
| Contract/conformance | Schemas, errors, pagination, limits and identical policy behavior across supported clients |
| End-to-end | Fresh installation → connect → retrieve → propose → review → persist → retrieve revision |
| Retrieval evaluation | Versioned questions and relevance judgments; historical/current distinctions and no-answer cases |
| Operations | Backup/restore, upgrade/rollback, dependency outage, load and resource-limit behavior |
| UX/accessibility | Core task walkthroughs, keyboard navigation, accessible states and representative dense projects |

Today `pnpm verify` (lint, typecheck, unit and integration tests) and the managed browser
workflow run on every PR. Require relevant automated checks on PRs. Run the broader
adversarial, migration, compatibility and recovery suites for release candidates. Use
synthetic or consented, redacted fixtures; keep judging artifacts (`docs/hackathon-evidence/`,
`docs/demo/evidence/`) separate from evolving development evaluations. Hold back a portion of
retrieval questions to reduce tuning to the benchmark.

Publish a release evidence bundle: source SHA, artifact digests, supported matrix,
test/evaluation results, threat-model changes, restore result, migration/rollback notes,
known issues and sign-off. A green test badge alone is insufficient release evidence.

## 11. Contributor PR policies

External contributors target `integration`. CONTRIBUTING.md and the PR template are
published; issue templates and SECURITY.md are added alongside this roadmap. The license is
MIT; no CLA or DCO is in use, and none is introduced implicitly.

### PR requirements

1. State the problem, intended behavior and relevant issue or design decision.
2. Keep changes reviewable and focused. Discuss architectural or breaking changes before
   extensive implementation.
3. Include appropriate verification; behavioral fixes should include a regression test where
   practical. Documentation-only changes need link/example review rather than artificial test
   additions.
4. Document API, configuration, permissions, storage or user-visible changes.
5. Include migration and recovery implications for persistence changes, and threat-model
   implications for sensitive changes.
6. Remove secrets, private memory dumps, proprietary datasets and unrelated generated files.
7. Disclose material AI-assisted changes and verify their behavior and licensing according
   to the adopted contribution policy (policy not yet adopted; owner decision).
8. Respond to review and pass required checks before maintainer merge.

Require an appropriate owner's review for authentication, authorization, approval logic,
execution, storage migrations and imports (a CODEOWNERS file once more than one reviewer
exists). First-time and outside contributors need maintainer approval before Actions run, and
`GITHUB_TOKEN` is read-only; keep it that way and keep deployment secrets out of fork checks.
Define dependency-update review and secret-scanning procedures after verifying available
tooling.

Aim to acknowledge new PRs within three business days and provide an initial substantive
review within seven. These are capacity-dependent service targets. Publish maintainer
availability and label blocked or deferred work clearly. PRs into `integration` are
squash-merged with the contributor as commit author, which preserves attribution.

## 12. Phased milestones: November 2026–April 2027

Each phase depends on the previous gate. Assign named owners during the first two weeks;
roles below describe accountability until assignments are made.

| Period | Focus and deliverables | Accountable roles | Exit gate |
|---|---|---|---|
| **November 2026** | Submit and preserve; inventory implementation; adopt contributor rules; extend threat model; define memory/tool contracts; establish retrieval baseline; demonstrate local vertical slice | Release maintainer, core and security owners | G0 preservation and G1 foundation |
| **December 2026** | Stabilize MCP workflow; verify Claude Code and Codex configurations; exercise denied operations and retries; recruit 3–5 consented pilot projects; measure onboarding | Integration and security owners | G2 integration alpha |
| **January 2027** | Deliver memory revisions/conflict handling and explorer list/detail/review; run retrieval evaluation; improve onboarding from pilot evidence | Core and UX owners | G3 trustworthy memory beta |
| **February 2027** | Add bounded graph/timeline; harden packaging, migrations, alerts and backup/restore; run load and adversarial tests; make hosting decision | Operations, UX and security owners | G4 operational beta |
| **March 2027** | Freeze release scope; cut candidate from approved integration commit; resolve blockers; rehearse upgrade/rollback and incident response; finalize compatibility and support docs | Release maintainer and all owners | G5 production candidate |
| **April 2027** | Release only after gates pass; staged adoption; monitor objectives; publish known limits and next priorities; recheck the submission tag | Release maintainer and operator | G6 release and stabilization |

If staffing or evidence is insufficient, reduce optional explorer features and additional
adapters before reducing core correctness or security work. Reforecast dates monthly and
record changes to scope and rationale.

## 13. Acceptance gates

| Gate | Required evidence | Blocks progression when… |
|---|---|---|
| **G0 — Submission preserved** | Verified submitted SHA, protected tag and branches, Release with checked archive, environment separation | Submission identity or reproducibility remains uncertain |
| **G1 — Foundation** | Inventory with evidence links; assigned owners; versioned schemas; threat model; repeatable tests; local retrieval/review/write workflow | Core behavior or permission boundary is undefined |
| **G2 — Integration alpha** | MCP contract suite; clean Claude Code and Codex setup on named versions; retries and denied writes tested; pilot onboarding guide | Any advertised client path is unverified or policy differs across clients |
| **G3 — Memory beta** | Revision/conflict and provenance tests; export/import round trip; retrieval targets met on held-out questions; explorer task assessment | Writes lose history, retrieval masks supersession, or core user tasks fail |
| **G4 — Operational beta** | Restore drill, migration rehearsal, resource-limit/load results, working alerts and runbooks | Recovery targets cannot be demonstrated or operations lack an owner |
| **G5 — Production candidate** | No unresolved critical/high vulnerabilities in supported scope; zero unauthorized operations in the defined adversarial suite; complete release evidence; independent sensitive-area review | Any security, data-loss, recovery or compatibility blocker remains |
| **G6 — Release/stabilization** | Approved immutable release artifact; staged rollout and rollback trigger; 14-day observation report against objectives; submission tag rechecked | Rollout reveals loss, access violations or sustained objective failures |

Separate release approval from post-release stabilization: production distribution may
begin after G5 and the rollout approval, but the release is not declared stable until the G6
observation period passes. If release timing extends beyond April, retain that observation
period.

Critical/high security findings, unauthorized access, data loss and failed recovery are
non-waivable production blockers. Lower-severity limitations require a documented owner,
mitigation and review date. A local-only or limited pilot may continue under explicitly
bounded scope without being labeled production-ready.

## 14. Success metrics

Establish definitions, datasets and dashboards in November. Confirm targets after baseline
measurement by 30 November; any revision must record its reason and retain the original
comparison. Do not present aspirational targets as measured results.

| Dimension | Proposed target by release | How to measure |
|---|---|---|
| Submission integrity | Recorded frozen SHA unchanged | Reference checks and archive checksum verification |
| Onboarding | Median ≤15 minutes to first useful retrieval; ≥80% successful clean setups | At least 10 observed attempts across documented supported environments; report failures and sample size |
| Retrieval relevance | ≥80% of answerable held-out questions return an adjudicated relevant record in top five | At least 50 versioned questions across representative pilot projects; report per-project results |
| Current guidance | ≤5% of current-state queries rank superseded guidance ahead of its accepted replacement | Dedicated labeled correction/supersession subset |
| Provenance | 100% of accepted records have required source/actor fields and explicit source status | Schema checks; audit missing, unavailable or user-declared sources separately |
| Authorization | Zero unauthorized successes in the defined release suite | Repeatable negative/adversarial tests across clients, service and explorer |
| Reliability/recovery | Meet the operational targets in Section 9 | Monitored observation period and timed restore drill |
| Workflow value | ≥70% of surveyed pilot users report useful recall on real tasks | At least 10 respondents; disclose response count and selection limits |
| Contribution health | ≥80% of PRs receive initial substantive review within seven business days | PR timestamps, excluding explicitly paused periods |

Track weekly active pilot projects, repeat usage, accepted/rejected memories, integration
failures and per-project operating cost as diagnostic measures. Do not optimize memory count
or tool-call volume as proxies for user value. Collect only necessary telemetry, with clear
user-facing controls and retention.

## 15. Risks and responses

| Risk | Early signal | Response and owner |
|---|---|---|
| Frozen submission accidentally changed | SHA mismatch, moving tag, or a promotion to `main` during judging | Stop the affected release; investigate against independent evidence; release maintainer owns recovery |
| Client/protocol drift | Configuration examples fail on newer clients | Pin supported versions, run compatibility checks and narrow support until verified; integration owner |
| Injection or memory poisoning | Suspicious proposals, forged sources or forbidden action attempts | Quarantine affected records, revoke access if needed, investigate and extend regression fixtures; security owner |
| Misleading or stale recall | Corrections repeatedly ignored; rising stale-result rate | Improve status filtering and provenance; suspend unreliable ranking changes; core owner |
| Migration or deletion failure | Mismatched counts/checksums or deleted records reappear | Block rollout, recover from verified state and reconcile indexes/backups; core and operations owners |
| Unrecoverable deployment | Restore drill fails or backup age exceeds target | Stop promotion, repair backups and repeat recovery exercise; operations owner |
| Scope exceeds capacity | Review queue grows; core gates slip | Defer optional adapters, graph polish and hosting; release maintainer |
| Data exposure through diagnostics | Sensitive content appears in traces or exports | Restrict capture, redact and follow incident procedures; security and operations owners |
| Weak demand or onboarding | Pilots abandon setup or rarely return | Observe real tasks, simplify the core workflow and revise scope before adding features; product/UX owner |
| Hosting costs outpace value | Rising storage/index or per-project request cost | Apply quotas, measure workload, set budgets and postpone hosted scale; operations owner |

## 16. Immediate 14-day plan: 1–14 November 2026

This plan starts with evidence and a narrow working slice. Nothing is promoted to `main`
during it.

> **Running ahead of schedule (31 Oct 2026).** The 1–3 Nov row is already complete:
> the three rulesets are applied and their required-check contexts verified from the API
> (census in [SUBMISSION_PRESERVATION.md](../release/SUBMISSION_PRESERVATION.md)), private
> vulnerability reporting is enabled (`/private-vulnerability-reporting → {"enabled": true}`),
> and the evidence-classified inventory exists ([CAPABILITY_INVENTORY.md](CAPABILITY_INVENTORY.md)).
> The 4–5 Nov row stays genuinely future work — submission is the owner's act on 4 Nov.
> The rest of the plan below is kept as written.

| Dates | Actions | Reviewable output |
|---|---|---|
| **1–3 Nov** | Apply the prepared rulesets; enable private vulnerability reporting; inventory actual code, interfaces, storage, tests and deployments starting from the repository check above; classify implemented/partial/absent/unknown with evidence | Governance gaps closed or listed; capability inventory and prioritized gap list |
| **4–5 Nov** | Submit (deadline 4 Nov 9:00 PM ET); record the submitted SHA; create the protected `submission-2026-11-04` tag, Release and checksummed archive; nominate owners | Completed [preservation manifest](../release/SUBMISSION_PRESERVATION.md) and owner list |
| **6–7 Nov** | Confirm product focus (§3); draft memory lifecycle and tool schemas; map project authorization, imports, approvals and threat boundaries; choose a minimal integration path | Contract proposal, threat-model extension and short decision records in [DECISIONS.md](../DECISIONS.md) |
| **8 Nov** | Prepare synthetic fixtures; document baseline `pnpm verify`, retrieval eval and browser workflow results | Documented baseline test results |
| **9–10 Nov** | Implement or adapt one local slice: scoped search → fetch → proposal → explicit review → durable revision; test denied cross-project access and retries | Demonstrable workflow plus regression evidence |
| **11–12 Nov** | Validate one MCP reference workflow; investigate Claude Code and Codex setup against current official documentation; record actual compatibility | Tested configuration examples or precise blockers; initial compatibility matrix |
| **13–14 Nov** | Run retrieval/injection baseline; sketch explorer review flow; estimate work from inventory; assess G0/G1 and reforecast November | Baseline report, explorer mockup, prioritized issues and gate review |

### Definition of done for day 14

- Submission identity and preservation evidence are recorded, with any unresolved
  discrepancy explicitly blocking G0.
- External PR instructions clearly target `integration` (done); required repository-control
  gaps have owners.
- The inventory separates observed implementation from planned work and links claims to
  evidence.
- Core contract and threat-model decisions are reviewable.
- The minimal local workflow is demonstrated, or concrete blockers and a revised completion
  date are published without claiming G1 passed.
- Initial evaluation results and integration compatibility findings are recorded, including
  failures.
- Each remaining November commitment has an accountable owner, dependency and acceptance
  condition.

## 17. Roadmap maintenance

Review progress weekly against evidence and blockers. Publish a monthly update covering
completed gates, measured outcomes, material risks and scope/date changes. Keep decisions on
contract, storage, authorization and deployment in [DECISIONS.md](../DECISIONS.md), and keep
the working backlog in [NEXT_STEPS.md](../NEXT_STEPS.md).

Maintain a clear distinction among **planned**, **implemented**, **verified** and
**released**. Attach evidence when advancing status. Preserve the hackathon submission
throughout; production readiness is earned through the acceptance gates, not inferred from
a date or a branch name.
