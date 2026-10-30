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

`git archive` output is stable for the same commit and Git version. If the checksum differs
but the tag SHA matches, compare against the archive attached to the Release before treating
it as tampering.

### Repository settings — ruleset census verified 31 Oct 2026

| Ruleset | Target | Enforces |
| --- | --- | --- |
| `Freeze submission tags` | tags | no deletion, no non-fast-forward, no update; **cannot be bypassed** (`current_user_can_bypass: never`) |
| `Protect integration` | `integration` | PRs required; required checks: "Lint, typecheck, test, build", "Managed browser workflow (fake provider)", "Managed browser workflow (fake provider · managed Firefox)" |
| `Protect main` | `main` | PRs required; required checks: the lint job and **one** browser leg (Chromium) |

The `main` asymmetry (Firefox leg not required there) is recorded as-found;
whether promotions to `main` should gate on both engines is an owner call
for the post-judging period, not a silent fix. The tag freeze is bypass-proof
by settings, which is the strongest guarantee the register rests on.

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

Freeze separation confirmed by the same smoke: the judges' entry does NOT
carry integration-only surfaces — `GET /api/memories/graph` (added to
`integration` after the entry) answers `validation_failed` on `main`,
absorbed by the `:id` route's id-pattern guard. Nothing leaked into the
entry, and the guard failed it closed, not open.

## While judging is open

- Nothing is promoted to `main`, so the README, website and Codespaces stay as submitted.
- Contributor PRs keep landing in `integration` — on integration-only paths.
- **Held by the freeze:** PR #28 (`codex/website-clarity-review`) changes only
  `website/**` (file census: 12/12), so it waits until judging closes and merges
  alongside the post-judging queue. The hold is recorded on the PR itself; the
  branch stays live so nothing is lost. `main` and the tags are untouched either
  way, and `website.yml` deploys only on push to `main`.
- The evidence under `docs/hackathon-evidence/` and `docs/demo/evidence/` is never edited.

Once results are announced, promotion from `integration` to `main` resumes (owner decision,
30 October 2026; §2 of the roadmap). The tag, Release and archive stay unchanged.
