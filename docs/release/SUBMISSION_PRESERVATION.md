# Submission preservation manifest

This file records which commit was submitted to the Cerebral Valley Meta AI Developer
Hackathon and how to check that it hasn't changed. It is gate G0 in the
[post-hackathon roadmap](../roadmap/POST_HACKATHON_ROADMAP.md).

**Status:** waiting for submission (deadline 4 November 2026, 9:00 PM ET). The fields marked
_to record_ are filled in once, after the form is submitted, in a PR into `integration`.

## References

| Item | Value |
| --- | --- |
| Repository | https://github.com/sidonsoft/muse-recall |
| Submission candidate on 30 Oct 2026 | `main` = `c32d03b4b6bbbce4249de6d3eb0333028d5960bd` (merge of PR #29); `integration` points at the same commit |
| Submitted commit (`main` when the form was sent) | _to record_ |
| Tag | `submission-2026-11-04` (annotated) → _to record_ |
| Release | _to record_ (URL) |
| Source archive | `muse-recall-submission-2026-11-04.tar.gz`, attached to the Release |
| Archive SHA-256 | _to record_ |
| Submitted at | _to record_ (date and time, ET) |
| Judge entry points | README on `main`; https://sidonsoft.github.io/muse-recall/ (built from `main`); Codespaces button (default branch) |

### Existing frozen tags — census verified 31 Oct 2026

| Tag | Points at (peeled) | Lineage |
| --- | --- | --- |
| `submission-v15` | `5e83616e60c4397d1acb75ae94f6dbf9f735455c` | ancestor of `main` |
| `submission-v14` | `71416ae753c18ecdac19a43f0f5571cb7f8c492e` | ancestor of `main` |
| `phase17-preregistration` | `6640e83f3c999cd1349420ad5e95bc329fff7d36` | **not** an ancestor of `main` — intentional: it pins the Phase 17 pre-registration commit (locked research hashes) on the side chain; the plan doc says never modify it |

`main` at verification time: `c32d03b`. Peels were re-read from the remote with
`git ls-remote` + local `git rev-list`; none moved.

Note on reading these values with plain `git ls-remote`: all three tags are
**annotated**, so the bare ref line shows the TAG OBJECT sha (e.g.
`c2ad110a…` for `submission-v15`), and only the `^{}`-deref'd line shows the
commit sha recorded above. A first-time `ls-remote` reader — including this
cadence's own auditor — can momentarily "see" different SHAs and suspect the
freeze broke; the deref lines (`5e83616e…`, `71416ae7…`, `6640e83f…`) match
the table exactly, as re-confirmed 31 Oct.


If anything is promoted to `main` before submitting, the candidate SHA above is out of date.
Use whatever `main` points at when you press Submit.

## Steps at submission time

1. Submit the form. Then note the exact `main` SHA:
   `git fetch origin main && git rev-parse origin/main`.
2. Create the tag and Release: on
   https://github.com/sidonsoft/muse-recall/releases/new type `submission-2026-11-04` in
   **Choose a tag**, target `main`, title it "Hackathon submission", and publish. Check that
   the tag points at the SHA from step 1.
3. Build the archive from the tag and record its checksum:

   ```sh
   git fetch origin --tags
   git archive --format=tar.gz --prefix=muse-recall-submission-2026-11-04/ \
     -o muse-recall-submission-2026-11-04.tar.gz submission-2026-11-04
   sha256sum muse-recall-submission-2026-11-04.tar.gz
   ```

   Attach the archive to the Release. Keep a copy outside GitHub as well.
4. Make sure the "Freeze submission tags" ruleset is active, so the tag can't be moved or
   deleted.
   Verified against the live ruleset on 31 Oct (third census): its scope is
   `refs/tags/submission-*`, so `submission-2026-11-04` is covered the moment
   it is created, and its rules are exactly deletion + update +
   non_fast_forward — tag CREATION stays allowed, which is what makes the
   submission act itself possible under the freeze.
   Fourth census, same day (sentinel re-run at `d4bb953`): that scope leaves
   `refs/tags/phase17-preregistration` OUTSIDE any ruleset — the tag was
   frozen by convention and this document's own warning, not by settings.
   Fixed the same day, settings-only and protective: ruleset `26245608`
   ("Freeze phase17 pre-registration tag") targets that exact ref with the
   identical rule set (deletion + non_fast_forward + update), no bypass
   actors. All three frozen tags are now ruleset-enforced; the tag CONTENTS
   were not touched by the change, only the guard around them widened to
   match the documented promise.
5. Fill in the _to record_ fields above in a PR into `integration`.

The archive holds tracked files only. No secrets are in the repository (`.env` is ignored);
the offline `echo` provider needs no key.

## Checking the frozen reference

Run this before every release and after any change to repository settings or rulesets:

```sh
git fetch origin --tags --force
test "$(git rev-parse 'submission-2026-11-04^{commit}')" = "<submitted commit>" && echo "tag OK"
git archive --format=tar.gz --prefix=muse-recall-submission-2026-11-04/ submission-2026-11-04 \
  | sha256sum
```

> Portability note (31 Oct 2026, verified by running both on this macOS host): modern
> macOS ships `/sbin/sha256sum` ("sha256sum (Darwin) 1.0") — same digests and same
> `digest  filename` format as GNU coreutils. Older or minimal systems may lack it; the
> BSD fallback is `shasum -a 256` (works standalone and in-pipe, byte-identical digests,
> verified side by side). Pick one tool and use it on both sides of any comparison.

`git archive` output is stable for the same commit and Git version. If the checksum differs
but the tag SHA matches, compare against the archive attached to the Release before treating
it as tampering.

### Repository settings — ruleset census verified 31 Oct 2026

| Ruleset | Target | Enforces |
| --- | --- | --- |
| `Freeze submission tags` | tags | no deletion, no non-fast-forward, no update; **cannot be bypassed** (`current_user_can_bypass: never`) |
| `Protect integration` | `integration` | PRs required; required checks: "Lint, typecheck, test, build", "Managed browser workflow (fake provider)", "Managed browser workflow (fake provider · managed Firefox)" |
| `Protect main` | `main` | PRs required; required checks: the lint job and **one** browser leg (Chromium) |
| `Freeze phase17 pre-registration tag` (`26245608`, added 31 Oct via PR #126) | exact ref `refs/tags/phase17-preregistration` | same three tag rules; closes a real gap — that tag never matched the `submission-*` glob, so the original freeze table silently missed it |

The `main` asymmetry (Firefox leg not required there) is recorded as-found;
whether promotions to `main` should gate on both engines is an owner call
for the post-judging period, not a silent fix. The tag freeze is bypass-proof
by settings, which is the strongest guarantee the register rests on.

**Refresh 31 Oct, later the same day (read-back verified via API):** ruleset
26184026 ("Protect integration") gained a FOURTH required context,
"Research evidence re-verification" (the locked Phase 16/17 verify chain,
shipped via PR #251) - the table above is the three-context state from
earlier that day. `Protect main` and both tag freezes unchanged at this
writing; a Nov 4 census should expect FOUR contexts on integration.

**Re-verified 31 Oct (second pass, cadence re-audit):** ruleset ids
26184029/26184026/26184025 unchanged with the same targets, bypass actors
and required contexts; the three frozen tags still point at
`5e83616e…`, `71416ae7…` and `6640e83f…`; `main` remains `c32d03b…`. No
drift anywhere in the register's foundation between the first and second
census — the guarantee has now been confirmed twice, on separate calls.

**Judge-demo path re-smoked at head (31 Oct, after 18 further merges):** fresh
`DATABASE_PATH` → `pnpm demo:seed` → built server → health 200; graph: 3 nodes,
one edge stamped exactly `2026-10-27T00:00:00.000Z`, 4 events; two scoped
memories listed; retrieval preview for "countdown timers" hits the constraint.
The D055 determinism survived the merge storm unchanged — re-observed, not
assumed. A docs/tests-only stretch still gets one end-to-end witness per
audit round rather than trust in CI alone.

**About-panel metadata, one settings change + census (31 Oct):** the repo's
`homepage` field was `null` while README, the site docs, and the release all
promise the live Pages site — the one surface where the promise looked
broken was the GitHub sidebar every judge sees first. Owner settings action
(reversible, zero content impact): `homepage` now points at
`https://sidonsoft.github.io/muse-recall/`, the exact URL already
witnessed LIVE (200 + submitted title). Same census recorded the rest
as-found: description names the hackathon and the two product faces;
`topics` is empty (discovery nicety, deliberately not touched during
judging window); wiki/projects flags as-found; `default_branch: main`.
Repo settings are not part of the tag/archive surface, so this changes no
submitted bytes — it only stops the entry's own framing from contradicting
the entry.

### Rehearsal — the commands above run as written (31 Oct 2026)

Simulated the judge path on the DEFAULT branch (`main` = `c32d03b4b6bb…`):
fresh clone → `pnpm install --frozen-lockfile` → build → `cp .env.example .env`
→ `demo:seed` → server → `/api/health` 200. The quickstart carries no
missing steps on the entry itself.

The preservation commands were executed verbatim against today's candidate:
`git fetch origin --tags --force` (all frozen tags fetched, none moved)
and `git archive … main | sha256sum` produced
`3ed8b42492eea923…` for `c32d03b` — labeled as a REHEARSAL value; the
authoritative archive checksum is produced from the actual submitted
commit on 4 Nov, per the manifest above.

   Full value for cross-checking: `3ed8b42492eea923b109221c050544490010752e9c577f00fd5e33495d364d43`.
   Re-derived later the same day from `origin/main` on the dev checkout —
   ~40 merges deep into the cadence, different working tree, different day:
   **byte-identical**. The archive of `c32d03b` is stable across invocations,
   so a Nov 4 checksum can be compared against this rehearsal value only if
   the submitted commit IS `c32d03b`; otherwise it is simply the same
   deterministic procedure on a different tree.

The same quickstart was repeated later on 31 Oct as a **clean clone of
`integration` at head** (clone → `pnpm install --frozen-lockfile` → build →
`cp .env.example .env` → `demo:seed` → built server → health 200): the scoped
list shows the two seeded memories and the graph shows 3 nodes with the one
edge stamped exactly `2026-10-27T00:00:00.000Z` — identical to the `main`
rehearsal, confirming the working branch keeps the judge path green as it
diverges upward from the frozen entry. Server killed, port verified empty,
clone removed.

**Dev-mode face of the quickstart witnessed 31 Oct too** — every prior
rehearsal exercised the BUILD path (`pnpm run build` + seeded server), but
the README's headline first-run is `MODEL_PROVIDER=echo pnpm dev` → open
http://127.0.0.1:5173. At head: API health 200 on :8787, web 200 on :5173
serving `<title>Muse Recall — Build with Muse Spark</title>`, and the
vite-side `/api` proxy answers 200 on :5173 — the full browser experience,
not just two independent ports. Servers killed, both ports verified empty,
scratch db removed. No browser automation needed: two curls witness the
documented dev entry point.


Freeze separation confirmed by the same smoke: the judges' entry does NOT
carry integration-only surfaces — `GET /api/memories/graph` (added to
`integration` after the entry) answers `validation_failed` on `main`,
absorbed by the `:id` route's id-pattern guard. Nothing leaked into the
entry, and the guard failed it closed, not open.

### Owner-act addendum (found 31 Oct): the "2:46 fallback video" lines on `main`

`docs/README.md:11` and `SUBMISSION_CHECKLIST.md:3` on `main` reference a "2:46
cut / fallback video" that exists in NO tree ever (only video files anywhere:
the 2:50 V21 demo + website copy). Integration fixed both lines 31 Oct
(KI-44). Before cutting the 4 Nov submission tag, the owner chooses:
promote the two docs-only lines to `main` first (SHA changes; no code moves)
or submit as-is with one dead index pointer. Decision belongs to the
submission acts; the freeze keeps `main` untouched until then.

**Same shape, same decision line (added 31 Oct, KI-47):** on `main`,
`CONTRIBUTING.md:33` links `[SECURITY.md](SECURITY.md)` — the root security
policy exists only on `integration` (added after `main`'s cut), so the link
404s there and GitHub's security-policy indicator reads unset on the default
branch (raw probes: `main/SECURITY.md` 404 vs `integration/SECURITY.md` 200).
The post-judging promotion repairs both with zero new work; if the owner
already promotes docs-only lines for KI-44, these lines can ride the same
promotion. One decision, two blemishes — recorded together in the action
register (NEXT_STEPS, line 2 of tier A).

**Turnkey promote set (measured 31 Oct, read-only):** the WHOLE judge-facing delta
of this decision is three pieces, no more:
(i) `docs/README.md`: ONE line - the EVIDENCE_CARD row's "2:46 fallback video"
wording replaced with "shown at the END of the committed 2:50 demo video"
(integration@017d4c5; `git diff main integration -- docs/README.md` is exactly
this one hunk);
(ii) `docs/SUBMISSION_CHECKLIST.md`: the 2:46 wording lines (same commit;
measured 9 insertions / 5 deletions);
(iii) root `SECURITY.md`: whole 37-line file, as landed integration@9bb0770,
byte-current on integration (also repairs CONTRIBUTING.md:33 and sets the
GitHub policy indicator on the default branch).
Cherry-picks are docs-only and touch no shared lines with code, so order does
not matter; if promoted, the candidate SHA at the top of this file is stale by
design and must be re-recorded from the promoted tree BEFORE cutting the tag.
DRY-RUN PROVEN 31 Oct (scratch branch off `main`, discarded; `main` never
touched): the exact act is ONE command -
`git checkout origin/integration -- docs/README.md docs/SUBMISSION_CHECKLIST.md SECURITY.md`
- which applied CLEAN onto main's tree yielding exactly 47 insertions / 6
deletions across the three files, no conflicts. Note: `main`'s biome config
processes no markdown, so the promoted files are not subject to any md-format
gate on that branch - promotion cannot break main's CI gates.

## While judging is open

- Nothing is promoted to `main`, so the README, website and Codespaces stay as submitted.
- Contributor PRs keep landing in `integration` — on integration-only paths.
- **Held by the freeze:** PR #28 (`codex/website-clarity-review`) changes only
  `website/**` (file census: 12/12), so it waits until judging closes and merges
  alongside the post-judging queue. The hold is recorded on the PR itself.
  `main` and the tags are untouched either way, and `website.yml` deploys only
  on push to `main`.
  - **Correction (31 Oct, branch census):** this paragraph previously said "the
    branch stays live so nothing is lost" — the remote branch
    `codex/website-clarity-review` has since been DELETED (by its owning agent
    session's cleanup, not by anything in this cadence). Nothing IS lost, via
    a mechanism worth recording: GitHub keeps open-PR heads at
    `refs/pull/28/head` (still exactly `f1a16f791e…`), the commit is fetchable
    and verified present, and it is NOT an ancestor of `integration` (so the
    website work is genuinely unmerged, not silently landed). Post-judging
    procedure: `git fetch origin refs/pull/28/head`, recreate the branch at
    that SHA, push, then review and merge normally.
  - Same census, for completeness: the remote holds 39 branches (`agent/*`,
    `strata-*`, `claude/project-thread-*`, etc.) — historical side chains from
    earlier phases. None was touched during this cadence; deleting any of them
    awaits per-branch ancestry checks post-judging, since some may back phase
    history cited in docs.
  - Refresh (31 Oct, same day as that census): the remote now holds **9**
    branches — an actor outside this session pruned 31 heads minutes after the
    ancestry census (witnessed in NEXT_STEPS' cadence register). The census did
    the safety math: every vanished head was an ancestor of `main` `c32d03b`, so
    their commits ship inside main's history regardless of the refs; nothing was
    lost. Survivors are `main`, `integration`, and exactly the seven
    still-divergent heads — `agent/phase11-release` (a806145b),
    `agent/strata-phase12d-guard-audit` (4680ad34), `agent/strata-phase13-submission`
    (84e6a8ce), `agent/strata-phase14b-submission-audit` (e8fe9df7),
    `claude/admiring-kilby-7f7211` (6640e83f), `claude/project-thread-9uvtci`
    (50ec1fca), `study02/checkpoint-1` (7a6cacf5). The foreign three stay
    foreign; the agent/* quartet awaits post-judging content-diff review
    (no merged-PR record exists for them, so landing is unproven, not absent).
- The evidence under `docs/hackathon-evidence/` and `docs/demo/evidence/` is never edited.

### Freeze sentinel — six invariants, re-checked together 31 Oct 2026

1. `refs/heads/main` = `c32d03b…` — unchanged;
2. all three frozen tags deref to their recorded commits (`5e83616e`,
   `71416ae7`, `6640e83f`) — annotated tag objects notwithstanding;
3. rulesets `26184029`/`26184026`/`26184025` present and active — plus
   `26245608` (phase17 tag, added 31 Oct, see the fourth census above);
4. no `website.yml` PUSH run since 29 Oct (the only recent runs are PR checks —
   the 30 Oct one is PR #28's own CI): the live site cannot change mid-judging.
   And it is LIVE: the URL the README leads with responded 200 on 31 Oct with
   `<title>Muse Recall — correctable project memory for AI-built software</title>`
   — the judge's click from the repo front page lands where promised;
5. PR #28 still open, its content pinned at `refs/pull/28/head` (see the
   correction above);
6. zero cadence activity touched `main`, tags, evidence, submission, or demo
   docs, or `website/` — every one of the 40+ cadence PRs targets
   `integration` and its diff was inspected for frozen paths.

### Demo media census (read-only, 31 Oct)

The README's demo claims were probed, not trusted. On `main` (frozen):
mp4 blob = 12,721,832 bytes ("12.7 MB" ✓ decimal); `ffprobe` duration =
170.474 s, so the advertised **"2:50" is exact to the second** — a claim
that had only ever been human recall. SRT captions end at 2:32.3, i.e.
the last ~18 s outro runs caption-free (honest reading of the SRT, not
a discrepancy to fix — captions follow speech). Poster, contact sheet,
transcript, limits page and QA notes all present at `docs/demo/video/`.
The website hosts its own copy (`./video/muse-recall-demo.mp4`, HTTP
200, `video/mp4`, 12,721,852 B) — 20 bytes above the repo blob, a
container-level difference from the site's own build pipeline; the
repository blob stays the authoritative archive asset, and neither copy
is byte-differenced in any checksum promise today.

Once results are announced, promotion from `integration` to `main` resumes (owner decision,
30 October 2026; §2 of the roadmap). The tag, Release and archive stay unchanged.
