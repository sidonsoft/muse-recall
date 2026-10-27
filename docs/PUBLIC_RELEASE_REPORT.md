# Public release report — Muse Recall

**Date:** 2026-10-27
**Agent role:** Cloud Release Agent
**Hackathon:** Meta Global AI Developer Hackathon (development window 2026-10-26 → 2026-11-04)
**Status:** **GO — repository published.** Submission itself was **not** performed.

This report records the security audit, history-preservation checks and release actions for
making `sidonsoft/muse-recall` public. It contains no credential values.

---

## 1. Repository

| Item | Value |
| --- | --- |
| Repository URL | <https://github.com/sidonsoft/muse-recall> |
| Visibility | **Public** (GitHub API reports `private: false`, `visibility: public`) |
| Default branch | `main` |
| Default branch SHA at publication | `2a50cc7d5644be9d7979770a26ea40870c67c200` |
| Approved recording candidate | `agent/phase14c-recording-clearance` @ `bbe51d8bb98eac003b4add564c4b3bd06b2b2cb4` |
| Description | Muse Recall — persistent, correctable memory for Meta Muse, with Muse Forge, an AI game-studio workspace (Meta Global AI Developer Hackathon) |

`main` was fast-forwarded from `8da738a0d27b1b58153a0120e8319ba0fdd24120` to the release
commit `2a50cc7`, which is the approved candidate `bbe51d8` plus documentation corrections
(§7). This report is a subsequent documentation-only commit on `main`; the approved
candidate SHA is unchanged on its own branch.

Anonymous checks (no GitHub session) returned HTTP 200 for the repository homepage, the
default branch tree, the candidate commit page, the Phase 14C document and the raw README.

---

## 2. Verification before changes

| Check | Result |
| --- | --- |
| `git fetch --all --tags --force` | succeeded; no tags exist |
| Required Phase 14C SHA | `bbe51d8bb98eac003b4add564c4b3bd06b2b2cb4` — **exact match** |
| Worktree clean | yes (`git status --porcelain` empty) |
| Current default branch | `main` (remote `HEAD` → `refs/heads/main`) |
| Branch structure | 16 branches, all preserved; no tags |
| Relevant milestones on remote | Phase 11, 11B/11C, 12A–12E, 13, 14A, 14B and 14C all present |

`main` was a strict ancestor of the candidate: 40 commits ahead, 0 behind, merge base
`8da738a`. A fast-forward was therefore possible with no unrelated commits at risk.

---

## 3. Full historical security audit

**Scope.** Every commit reachable from every branch (53 commits, 619 unique blobs), plus
commit messages, git notes, `.github` workflows and all tracked images. The scan covered all
branches and tags (tags: none), not just the working tree.

**Method.** Custom full-object scanner for provider key formats (Muse/Baseten `LLM_*`,
OpenAI/Anthropic, GitHub, AWS, Google, Slack, Stripe), private-key blocks, JWTs, Bearer and
`Authorization` headers, generic `key=value` assignments, internal IPs/hostnames and
sensitive filenames. Independently: commit-message scan, `.env`/key-file enumeration,
email/home-path/PII sweep, and OCR of all 79 tracked screenshots (no credentials found).

### 3.1 Credential findings

| # | Secret type | Location | Status |
| --- | --- | --- | --- |
| 1 | Muse/Baseten-format API key (`LLM_…`) | `tests/unit/redact.test.ts`; introduced in `c097767`, present through `33a1cdc`, `4cb0f35`, `5dc99b3`; removed in `d35fa9d` | **Revoked/rotated** — owner record dated 2026-10-27 in `a806145` (`agent/phase11-release`); the value remains in earlier history but is recorded as invalid |
| 2–20 | Synthetic test fixtures (`sk-…`, Bearer samples, `supersecretvalue`) | redaction tests, Decision Guard accuracy corpus, `fake-muse.mjs`, evaluation scripts | Not credentials — generated placeholders, confirmed by context |

The genuine key is the only real credential found. It is **not present in the current
tree**; it exists only in historical commits, which were deliberately not rewritten.

No `.env` file was ever committed (only `.env.example` with placeholders). No private keys,
cloud-provider keys, internal network addresses or credentials in screenshots were found.
`GITHUB_TOKEN`/CI secrets are not referenced in workflows; CI runs on the offline `echo`
provider.

### 3.2 Historical credential status

- **Status: revoked/rotated**, per the repository owner's dated record at `a806145`
  ("rotated on 2026-10-27 … the revoked value remains in history but is invalid; the
  replacement is not stored in the repository").
- Corroboration: the value is absent from current configuration and was not found in local
  Muse configuration. The project's evidence map (`docs/submission/EVIDENCE_MAP.md`, C11)
  independently records the same rotation.
- **Limitation:** revocation could not be independently re-confirmed against the provider,
  because the task forbids authenticating with the exposed credential. This is recorded as
  residual risk R1.
- **Remediation:** complete for release. Removing the value from history is impossible
  without a rewrite, which is prohibited. The correct remediation is revocation, which is
  recorded.

No attempt was made to authenticate with any exposed credential.

### 3.3 Other personal / private information

| Item | Location | Assessment |
| --- | --- | --- |
| Author/committer email | commit metadata (all commits) | Visible by design; cannot be removed without rewriting history. The owner is the public repository owner. |
| Local home path `/Users/<user>/…` | `DEVELOPMENT_LOG.md`, `docs/hackathon-evidence/phase12e/verification.json`, and three historical files | Low-severity local username disclosure. Evidence files were **not** altered (evidence integrity); recorded as residual risk R2. |
| Private development notes | none found | No confidential/embargo/do-not-publish markers. |

---

## 4. Git history preservation

| Property | Result |
| --- | --- |
| Original commits retained | **Yes** — the original 53-commit universe is still reachable (audited before release); the release adds two documentation-only commits and keeps every original commit and SHA. First commit `349d86c` intact |
| Commit timestamps / ancestry | Unchanged |
| Force-push | **None** — `main` advanced `8da738a..2a50cc7` by fast-forward |
| Rebase / squash / amend of published history | None |
| Tags | None existed; none created or deleted |
| Branches deleted | **None** |
| Strata audit branch merged | **No** — `agent/strata-phase14b-submission-audit` remains separate |
| Evidence artefacts modified | Only documentation/security wording; evidence JSON/PNG/HTML untouched |

The hackathon evidence remains accessible on the public repository, including original
development commits, phase reports, authentic Muse experiment records, the memory A/B/C
evidence, Decision Guard evaluation, runtime verification, rollback-ancestry tests, the
independent Phase 14B audit, Phase 14A verification and Phase 14C recording documentation.

---

## 5. Branch preservation

All 15 pre-existing remote branches are preserved at their original SHAs, plus the new
`release/public-release` documentation branch. Public branch count: **16**.

| Branch | SHA (short) |
| --- | --- |
| `main` | `2a50cc7` |
| `release/public-release` | `2a50cc7` |
| `agent/phase11-release` | `a806145` |
| `agent/phase12-memory-validation` | `90dfac9` |
| `agent/phase12c-guard-advisory` | `260d9ce` |
| `agent/phase12e-release-hardening` | `156c65c` |
| `agent/phase14a-demo-production` | `4d668bb` |
| `agent/phase14c-recording-clearance` | `bbe51d8` |
| `agent/strata-phase11-decision-eval` | `dece8c1` |
| `agent/strata-phase11-memory` | `0ce6444` |
| `agent/strata-phase12-decision-guard` | `398418a` |
| `agent/strata-phase12d-guard-audit` | `4680ad3` |
| `agent/strata-phase13-submission` | `84e6a8c` |
| `agent/strata-phase14b-submission-audit` | `e8fe9df` |
| `experiment/muse-forge` | `6fe663b` |
| `experiment/product-validation` | `79ac5a2` |

A local-only branch `agent/strata` (`ab7fd07`, a single FTS tokenizer test) was never on the
remote and remains preserved locally; it was not published because it is outside the
approved release. Three unreachable commits exist in the local object store; they are not
reachable from any published ref and are therefore not part of the public repository.

---

## 6. Default branch update

- Compared `main` against the candidate: `main` was an ancestor (0 commits unique to
  `main`), so a fast-forward was safe.
- Fast-forwarded `main` to the release commit `2a50cc7` (candidate + documentation
  corrections). No merge commit, no force-push, no conflict resolution.
- `agent/phase14c-recording-clearance` remains at the required `bbe51d8`.
- No branch was deleted; no history was rewritten.

---

## 7. Documentation changes

Documentation-only commit `2a50cc7` on `main`:

- **`README.md`** — corrected the product name to **Muse Recall**, replaced the stale
  "Phase 2 complete / not built yet" banner with the Phase 14C state, documented Muse Forge,
  the advisory Decision Guard, rollback ancestry and the load-time scope of runtime
  verification, updated the test count, clone URL, submission links, status table, evidence
  classes and limitations.
- **`docs/PHASE11_RELEASE_READINESS.md`** — recorded the 2026-10-27 rotation/revocation
  (`a806145`) and removed the stale "must be rotated" wording.
- **`docs/hackathon-evidence/README.md`** — replaced the false "no credentials in history"
  claim with the accurate single-credential finding and revocation record.
- **`DEVELOPMENT_LOG.md`**, **`docs/PROJECT_STATUS.md`**, **`docs/SUBMISSION_CHECKLIST.md`** —
  corrected the same "no secrets in history" claim.
- **`docs/KNOWN_ISSUES.md`**, **`docs/NEXT_STEPS.md`** — marked repository visibility as
  resolved by the public release.

No production code, tests, fixtures, package manifests, evidence artefacts or screenshots
were changed. No product features were added.

The repository description was updated to mention Muse Recall, Muse Forge and the hackathon.

---

## 8. Test results (on the public default branch)

| Check | Result |
| --- | --- |
| `pnpm verify` (lint + typecheck + tests) | **PASS** — 30 files, **484 passed**, 3 skipped (487 total) |
| `pnpm build` (web + server) | **PASS** — Vite production build and server esbuild bundle |
| Production code regressions | None — documentation-only diff after the candidate |
| History intact | Yes — 53 commits, 16 public branches, no force-push |
| Public visibility confirmed | Yes — anonymous HTTP 200 on repo, tree, commit, evidence and README |

The 3 skipped tests are the opt-in live-Muse integration tests (`MML_LIVE_MUSE=1`), which
were intentionally not run: no paid Muse inference was permitted.

---

## 9. Remaining risks

| # | Risk | Severity | Mitigation / status |
| --- | --- | --- | --- |
| R1 | The revoked key remains in historical commits; revocation is owner-recorded but was not independently re-confirmed with the provider | Low–medium | Value is recorded invalid; never printed in docs; if the director cannot confirm provider-side revocation, rotate again and treat the history value as compromised |
| R2 | Author email and a local `/Users/…` path are visible in commit metadata/content | Low | Inherent to preserved history; evidence intentionally not altered. Accept for judging, or rewrite with explicit authorisation |
| R3 | Historical branches retain older, unreconciled documents (for example the pre-rotation row on `agent/phase11-release`) | Low | Default branch is corrected; branches are preserved as historical evidence and are not the release narrative |
| R4 | Synthetic secret-shaped fixtures remain in history and tests | Very low | Clearly labelled synthetic; no live value |
| R5 | The repository exposes the full development history, including intermediate branches | Accepted | Required by the task: history is hackathon evidence |
| R6 | The hackathon submission form and video were not completed | Administrative | Explicitly out of scope; no submission was performed |

---

## 10. Verdict

**GO — public release complete.**

- The repository is public and anonymously accessible.
- The default branch contains the approved Phase 14C candidate and its complete preserved
  history.
- No force-push, history rewrite, branch deletion or evidence removal occurred.
- The only genuine historical credential is recorded as revoked/rotated; it remains in
  history by design and is not in the current tree.
- `pnpm verify` and `pnpm build` pass.

**Director follow-up:** confirm provider-side revocation of the historical key (R1), and
complete the video and submission form. No further repository action is required for the
public release.

---

## Appendix — commands used

```bash
git fetch --all --tags --force
git rev-list --all --count                     # 53
git merge-base --is-ancestor main <candidate>  # true
git merge --ff-only release/public-release
git push origin main                           # 8da738a..2a50cc7 (no force)
gh repo edit sidonsoft/muse-recall --visibility public \
  --accept-visibility-change-consequences
pnpm verify && pnpm build
```

Full-history scanning was performed locally over every reachable object; no secret values
are reproduced in this report.
