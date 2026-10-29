# Muse Recall — Pre-Submission Readiness Plan (revised after audit)

**Meta AI Developer Hackathon · submissions due Wednesday 4 November 2026, 9:00 PM ET**
(US daylight saving ends 1 November, so this is 9:00 PM EST = **02:00 UTC Thursday 5
November = 1:00 PM AEDT Thursday 5 November** in Sydney/Melbourne.)

**Status:** revised implementation plan. Section 3 records a completed read-only audit of
`main` at `442d100` (29 October 2026); nothing in the repository was changed by the audit.
**Guiding principle:** the product is already built and verified. The remaining risk is
*submission*, not features. Protect what is proven, finish the owner actions, and add only
small, reversible improvements to the judge path.

> **Release rule.** Work on a branch cut from `main`. Do not rewrite `main` or research
> history; do not move or delete the tags `submission-v14`, `submission-v15` or
> `phase17-preregistration`, or the branch `claude/admiring-kilby-7f7211`. Do not modify
> anything under `docs/hackathon-evidence/`. Merge only through a PR with green CI.

## What changed from the original plan, and why

| Original plan | Revised | Reason (evidence) |
| --- | --- | --- |
| P0: public HTTPS deployment of the app | **Do not deploy the live app.** Optional static, read-only preview only (§5) | The app is single-user and loopback-only by design: no authentication, no per-user isolation, no rate limiting; startup refuses a non-loopback `HOST` (`docs/security.md` T6, `apps/server/src/host-guard.ts`). Generation spawns the Muse Code CLI as the owner's logged-in account, with file-write tools and no OS-level sandbox (T8). A public instance would put the owner's Muse account and the host behind an unauthenticated form. Making that safe (auth, isolation, quotas, a container sandbox, abuse controls) is a new product, not a five-day task, and `docs/SUBMISSION_CHECKLIST.md` says the build “must not be exposed to a public network”. |
| P0: auth, server-side project authorisation, CSRF, rate limits | **Out of scope; disclose instead** | These only matter for a hosted multi-user service. The local build already has the Origin guard (cross-origin writes rejected) and host guard. The disclosures already exist and must stay accurate. |
| P0: project dashboard | **Defer** | No dashboard exists (the Overview component is the System screen), but HTML Studio already shows project, memory, activity, review and versions in one view. A new surface five days out adds risk without new evidence. |
| P0: Memory Explorer, approval centre, diff, verification, rollback, failure recovery | **Keep: they exist and are tested** | See §3. Do not rebuild. |
| Missing from the original plan | **New P0: owner submission actions** | Video upload, repository visibility, Official Rules, the form. These are the only items still open in `docs/SUBMISSION_CHECKLIST.md` and they decide whether anything else matters. |
| Missing from the original plan | **New P0: public-history secret scan** | The repository is **private** today. Making it public publishes the whole history (one historical test-fixture key was already found and revoked on 2026-10-27). |
| Judge journey: open link → try demo → approve → rollback | **Video first, then repo, then optional local run** | Judges see the video and README. Locally, `MODEL_PROVIDER=echo` lets them browse but not generate, so the approve/rollback loop needs Muse or the fake CLI (§6, P1). |
| Companion spec `Muse_Recall_Visual_Memory_Explorer_Spec.md` | **Removed** | The file does not exist, and the explorer is already built. |
| Light theme, command palette | **Defer** | Neither exists; both are cosmetic. |

## 1. Mission and success criteria

By the deadline, a judge who has only the submission form must be able to:

1. Watch a 2:50 video of a real Muse Spark session showing remembered decisions, a
   correction, review, an honest failure beat and approval.
2. Open the repository (if the rules require access) and find the claims, their limits
   and the evidence, with every number matching `main`.
3. Optionally clone and run the seeded demo with no Muse account, and understand
   immediately what is recorded and what is live.

The technical claims in the README, the submission copy and the video must match the
build that is tagged for submission.

## 2. Priority matrix (revised)

| Priority | Workstream | Deliverable | Acceptance evidence |
| --- | --- | --- | --- |
| P0 | Official Rules | Read the rules on the submission platform; record visibility, video, URL and disclosure requirements | Update `docs/SUBMISSION_CHECKLIST.md` (owner) |
| P0 | Video | Upload `Muse_Recall_Demo_V21_1080p.mp4` (2:50.47, SHA-256 `4020c0c6…b308`); paste the link into the README placeholder | Link resolves in a signed-out browser |
| P0 | Public-history secret scan | Scan all history and all branches that will be public before changing visibility | Clean scan report, or findings fixed |
| P0 | Repository visibility | Make `sidonsoft/muse-recall` public or grant judge access, as the rules require | Signed-out clone works |
| P0 | Fresh-clone rehearsal | Follow README “Try it” on a clean checkout, Node 24, no Muse | Steps and output recorded with commit hash |
| P0 | Release freeze | Tag the submission commit (`submission-v16`); docs state the exact commit | `pnpm verify`, `pnpm build`, CI green on that tag |
| P0 | Submission form | Submit the repo URL, video URL and `docs/submission/SUBMISSION_COPY.md` | Confirmation saved (owner) |
| P1 | Offline judge loop | Documented command that runs the full generate → review → approve → rollback loop with the existing fake Muse CLI, labelled as a fake provider throughout | Fresh-clone run without Muse completes the loop |
| P1 | In-app “What to try” | A short dismissible guide on the seeded `forge-demo` project | Visible on first load; no layout regressions in `verify:browser` |
| P1 | Activity panel | Show all jobs (not only the latest four) and link each job to its recorded `memory_ids` | Unit test; screenshot |
| P1 | Accessibility pass | Keyboard path through Studio and Memory; labels on icon buttons; contrast check | Notes plus fixes; existing tests green |
| P1, conditional | Static read-only preview | Only if the rules require a URL: a static page with the recorded demo (screenshots, the seeded decisions, the approved v1/v2 HTML sandboxed), no backend, no model calls, labelled “recorded” | Anonymous visit; no API calls in the network log |
| Deferred | Live hosted app, auth, multi-user, dashboard, light theme, command palette, billing, SSO, graphs, mobile, IDE | After the hackathon | Not in the release |

**Priority rule:** P0 is anything without which the submission is incomplete or
inaccurate. A P1 item ships only if it passes `pnpm verify`, `pnpm verify:studio-workflow`
and a manual check by **3 November**; otherwise it is dropped rather than shipped half-done.

## 3. Audit results (read-only, `main` at `442d100`, 29 October 2026)

Legend: **Exists / Partial / Missing / Out of scope**. Action: **Keep / Improve / Add / Defer**.

| Feature | State | Where | Evidence | Risk | Effort | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Memory store: CRUD, provenance, dedupe | Exists | `packages/memory-engine/src/engine.ts`, `routes/memories.ts` | Unit and API tests | Low | — | Keep |
| Statuses and supersession | Exists | `packages/shared/src/memory.ts` (`active`, `superseded`, `deleted`, `expired`); `POST /api/memories/:id/correct` | `memory-engine-phase2.test.ts`; demo seed leaves sunset superseded | Low | — | Keep |
| Memory history (create/update/supersede/delete/expire/purge) | Exists | `GET /api/memories/:id/history`; `MemoryDetailPanel.tsx` | Detail panel renders history | Low | — | Keep; this is the plan's “timeline” |
| Memory Explorer: search, filters, detail, correction | Exists | `MemoryInspector.tsx`, `MemoryDetailPanel.tsx` | `verify:browser` | Low | — | Keep |
| Retrieval explanation | Exists | `RetrievalExplainer.tsx`, `POST /api/retrieval/preview` | `forge-retrieval.test.ts` | Low | — | Keep |
| Retrieval linked to agent work | Exists in data, partly shown | `ForgeJob.memory_ids`, `prompt_sha256` (`packages/shared/src/forge.ts`) | Persisted per job | Low | S | Improve: surface per job (P1) |
| Agent activity | Partial | `StudioActivity.tsx` (latest 4 jobs: kind, status, version, time) | Real job records | Low | S | Improve (P1) |
| Job states | Exists | `queued`, `running`, `interrupted`, `succeeded`, `failed`, `cancelled`, `budget_exceeded`, `rejected` | `forge-job-store.test.ts`, `forge-recovery.test.ts` | Low | — | Keep; use these names, not the original plan's list |
| Approval and rejection | Exists | `ReviewPanel.tsx`; `POST /api/forge/jobs/:id/approve`, `/reject` | `forge-api.test.ts`, `forge-approval-durability.test.ts` | Low | — | Keep |
| Stale and duplicate approval | Exists | `version_conflict` when the approved version moved; approve requires `succeeded` and no version yet (`runner.ts`, `workspace.ts`) | Integration tests | Low | — | Keep |
| Exact-byte promotion | Exists | SHA-256 bound to the runtime-checked bytes (`workspace.ts`) | `docs/security.md` | Low | — | Keep |
| Diff viewer | Exists | `SourceAndDiff.tsx`, `GET /api/forge/jobs/:id/diff`; staged source rendered as text | `verify:forge-workflow` | Low | — | Keep |
| Verification | Exists | Load-time check in managed Chromium with network blocked except the approved CDN (`runtime-check.ts`); approval records the result | `verify:runtime`, `verify:studio-workflow` | Low | — | Keep; never call it interaction testing |
| Rollback | Exists | `POST /api/forge/projects/:id/rollback`; follows recorded ancestry, verifies the hash | Phase 14A fix; tests | Low | — | Keep |
| Failure recovery | Exists | Atomic job and version writes; restart marks jobs `interrupted`; recovery issues; orphaned versions moved aside, never deleted; graceful shutdown | `forge-recovery.test.ts`, `forge-completion-failure.test.ts` | Low | — | Keep |
| Provider outage handling | Exists | `provider-health.ts`; fallback key and model settings; `echo` provider for offline | `.env.example` | Low | — | Keep |
| Job cancellation | Exists | `POST /api/forge/jobs/:id/cancel` | Tests | Low | — | Keep |
| Limits | Exists | Two concurrent jobs per project; per-job runtime, call and token caps; 1 MiB request body | `runner.ts`, `.env.example`, `app.ts` | Low | — | Keep |
| Health endpoints | Exists | `/api/live`, `/api/health` (real write round-trip), `/api/health/muse` | API tests | Low | — | Keep |
| Secrets | Exists | Keys stay server/CLI-side and go over stdin; scrubbed child env; redaction | `redact.test.ts`, `forge-child-env.test.ts` | Medium at go-public | S | Add: whole-history scan before making the repo public (P0) |
| Cross-origin protection | Exists | `origin-guard.ts`, `host-guard.ts` | `verify:security`, `origin-guard.test.ts` | Low | — | Keep |
| Authentication, multi-user isolation, rate limiting | Out of scope by design | — | `docs/security.md` | High if deployed | L | Defer; keep the disclosure |
| Public hosting | Missing, deliberately | Loopback only | `SUBMISSION_CHECKLIST.md` “Deployment limitations” | High | L | Defer (static preview only if required) |
| Seeded demo | Exists | `pnpm demo:seed` (`scripts/lib/demo-seed.ts`): `forge-demo` v1 plus three decisions; resets the project's versions, staging and jobs | `demo-seed.test.ts` | Low | — | Keep |
| Demo without a Muse account | Partial | `MODEL_PROVIDER=echo` browses the seed; generation needs Muse | README “Try it” | Medium: judges cannot try approval | S | Improve: offline loop with `tests/fixtures/fake-muse.mjs` (P1) |
| In-app onboarding | Missing | No guide in `apps/web/src` | grep | Low | S | Add (P1) |
| Project dashboard | Missing | Overview is the System screen | `views.ts` | Low | M | Defer |
| Dark theme | Exists | `apps/web/src/index.css` | — | — | — | Keep |
| Light theme, command palette | Missing | — | — | — | M | Defer |
| Reduced motion | Exists | `prefers-reduced-motion` in `index.css` | — | Low | — | Keep |
| Accessibility | Partial | 86 `aria-*`/`role` attributes across components; no recorded audit | — | Low | S | Improve (P1) |
| Automated tests | Exists | Vitest unit and integration; README: 721 passing, 3 opt-in live skipped | `pnpm verify` | Low | — | Keep; re-measure the count at freeze |
| CI | Exists | `.github/workflows/ci.yml`: lint, typecheck, test, build; managed-browser workflow with the fake provider | GitHub Actions | Low | — | Keep; require green on the submission tag |
| Browser coverage | Partial | Chromium only (managed) | Scripts | Low | S | Optional manual Safari/Firefox check of the static preview, if built |
| Research evidence | Exists, frozen | `docs/hackathon-evidence/`; tag `phase17-preregistration`; `verify:research`, `verify:research16`, `verify:research17` | Verifiers | High if touched | — | Do not modify |
| Submission video | Recorded, outside git | 2:50 cut, QA'd; link placeholder in README | `SUBMISSION_CHECKLIST.md` | High: not uploaded | S | P0 owner action |
| Repository visibility | Private | `gh repo view`: `PRIVATE` | — | High if rules require public | S | P0 owner action |
| Official Rules | Unknown | `/rules`, `/official-rules`, `/terms` returned 404 at review | `docs/hackathon-evidence/requirements-review.md` | High | S | P0 owner action |

**Housekeeping found:** the main checkout's local `main` is behind `origin/main` (`df9a1fd`
vs `442d100`). Fast-forward it before cutting the release branch.

## 4. Operational foundation (scope: local build)

Already in place: startup environment validation (`config.ts`), loopback enforcement,
health endpoints, bounded retries/timeouts/caps, durable jobs, backup (`pnpm db:backup`) and
purge scripts, redacted diagnostics.

Remaining before freeze:

- Run `pnpm db:backup` against a seeded database and confirm a restore from the backup
  starts cleanly. Record the commands in `docs/release/` (new file, not in evidence).
- Record the release commit, tag, `pnpm verify` count and CI run URL in one place.

**Gate:** a fresh clone on a clean machine completes README “Try it” with no Muse account.

## 5. Public preview (conditional P1)

Build this **only** if the Official Rules require a working URL, or if every P0 is done by
1 November.

- Static files only (for example Cloudflare Pages via the `cf` CLI): no API, no database,
  no model calls, no forms that post anywhere.
- Content: the recorded `forge-demo` decisions and their history, the retrieval
  explanation, approved v1 and v2 HTML in `<iframe sandbox="allow-scripts">`, the diff
  between them, and the Phase 17 table. Every element labelled **recorded**.
- Links to the video and the repository.
- No new heavy libraries.

**Gate:** anonymous visit in Chrome, Safari and Firefox; the network log shows no calls to
any API; every number matches `main`.

## 6. Judge path improvements (P1)

### 6.1 Offline judge loop
Reuse `tests/fixtures/fake-muse.mjs` (already used by `verify:studio-workflow`) through
`FORGE_MUSE_BIN`, so a judge without Muse can run generate → review → approve → modify →
reject → rollback on the seeded project. Requirements:

- One documented command (for example `pnpm demo:offline`).
- The provider shows as `fake-muse` everywhere the UI names a model; the README says it
  is a deterministic stand-in, **not** Muse output, in the same words as the `echo` notice.
- No change to the real provider path, the evidence or the seed's recorded baseline.

### 6.2 “What to try” guide
Three to five steps on the seeded project: inspect the superseded sunset decision, open
the retrieval explanation, review a staged change and its diff, approve, roll back. It is
dismissible and shown only when the project is `forge-demo`.

### 6.3 Activity panel
List all jobs with their real status names and timestamps; show the memories each job
received from `memory_ids`, and “not recorded” where a historical job lacks them. Never
claim that a memory influenced output; the record shows only that it was supplied.

### 6.4 Accessibility
Keyboard-only pass through Studio and Memory; visible focus; accessible names on icon-only
buttons; status shown in text as well as colour (the activity dots are colour-only today).

## 7. Security and privacy checklist (release)

- [ ] Whole-history secret scan across every branch and tag that will become public
      (for example `gitleaks detect --log-opts="--all"`); review findings before changing
      visibility.
- [ ] No `.env`, database, workspace or video file tracked (`git ls-files`).
- [ ] Disclosures unchanged and accurate: loopback-only, single-user, no authentication,
      advisory Decision Guard, load-time check only, Forge child not OS-sandboxed.
- [ ] If the static preview ships: no backend calls, no secrets in the bundle, sandboxed
      iframes only.
- [ ] No claim of hosted security, compliance or penetration testing.

## 8. Testing and evidence at freeze

Run and record, with commit hash and timestamp:

```bash
pnpm verify
pnpm build
pnpm verify:security
pnpm verify:forge-workflow
pnpm verify:studio-workflow
pnpm verify:research17
```

Manual: the fresh-clone rehearsal, the offline judge loop if built, a keyboard pass, and a
narrow-viewport check. Keep evaluation results immutable; new evidence goes in a new
folder, never into an existing one.

## 9. Schedule

All dates 2026, owner's local time (AEDT). The submission deadline is **1:00 PM AEDT
Thursday 5 November**; aim to submit on **Wednesday 4 November AEDT**.

| Date | Focus | Gate |
| --- | --- | --- |
| Thu 29 Oct | Audit (done); owner reads the Official Rules | Requirements recorded |
| Fri 30 Oct | Secret scan; upload video; decide visibility; fast-forward local `main`; cut release branch | Scan clean; video link live |
| Sat 31 Oct | Offline judge loop (6.1) | Fresh-clone run passes |
| Sun 1 Nov | Guide (6.2), activity panel (6.3); static preview only if required | `pnpm verify` and browser checks green |
| Mon 2 Nov | Accessibility pass; independent rehearsal by someone who has not seen the app | Notes and fixes |
| Tue 3 Nov | Freeze: docs, counts, `submission-v16` tag, CI green | Evidence manifest |
| Wed 4 Nov | Final check of links signed-out; submit the form | Confirmation saved |
| Thu 5 Nov, before 1:00 PM | Buffer only | — |

Time guideline: 50% owner actions and release verification, 35% judge-path P1 items,
15% accessibility and polish.

## 10. Release governance

1. Branch from `origin/main` (`442d100`); small PRs; CI green before merge.
2. Never edit `docs/hackathon-evidence/`, the frozen tags or the Phase 17 lock branch.
3. Coding agents leave changes uncommitted for review; the owner commits.
4. No new runtime dependencies without a written reason; no native dependencies.
5. Freeze on 3 November: after the tag, only documentation corrections.
6. If a P1 item misses its gate, remove it cleanly; adjust no claim to fit it.
7. Record the submission commit, tag, video SHA-256 and form confirmation.

## 11. Definition of done

- The video is public and linked; the README, submission copy and video agree.
- The repository is reachable as the rules require, with a clean history scan.
- A fresh clone runs the seeded demo without Muse, as documented.
- `pnpm verify`, `pnpm build` and CI are green on the submission tag.
- Every limit in the disclosures is still true of the tagged build.
- The form was submitted before 9:00 PM ET on 4 November (1:00 PM AEDT, Thursday 5 November).

## 12. Explicitly excluded until after the hackathon

Live hosted app, authentication and multi-user isolation, rate limiting for public traffic,
project dashboard, light theme, command palette, team workspaces, billing, SSO, SDKs,
memory graphs, mobile apps, a full IDE and autonomous coding.

---

**Instruction for coding agents:** the audit in §3 is done; do not repeat it or rebuild
anything marked Keep. Work only on the P1 items in §6, one per change, on the release
branch. Leave changes uncommitted, run `pnpm verify` and report the result. Do not touch
`docs/hackathon-evidence/`, tags, `main`, provider code paths or the demo seed's recorded
baseline.
