# Beta release plan

Status as of 3 November 2026. "Beta" has no GitHub release, milestone, tag or label in
this repository yet; the product describes itself as a **local beta** at version `0.1.0`.
This plan covers the release that word maps to.

## Where things stand

| Item | State |
| --- | --- |
| GitHub releases | None (no drafts either) |
| Milestones | None |
| Tags | `submission-v14`, `submission-v15`, `phase17-preregistration`, `archive/*`; `submission-2026-11-04` not created yet |
| `main` | `c32d03b` (merge of #29), frozen through judging |
| `integration` | `a11af5c`, 239 commits ahead of `main` (161 files, +15769/-387); last change 31 Oct |
| Open PRs | #187 (draft, `study02/checkpoint-1` into `integration`), #28 (draft, external website rewrite, held until after judging) |
| Open issues | None |
| Versions | `0.1.0` everywhere (`package.json` files, `SERVICE_VERSION`, MCP server default) |

Neither open PR blocks either release.

## Plan (revised 3 Nov): `integration` becomes the submission, as v0.1.0

Decided by the owner: the first beta is **0.1.0**. Versions already read `0.1.0`
everywhere, so there is **no version bump**. `integration` is promoted to `main` and
submitted in place of the frozen `c32d03b`.

1. Put the final demo video at the same paths (`docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4`
   and `website/public/video/muse-recall-demo.mp4`) so the form link is unchanged, plus its
   captions, transcript and the "2:50 / 12.7 MB / recorded 29 Oct" lines in the README,
   submission copy and `V21_QA.md`.
2. Refresh test and evidence counts in the submission copy and README.
3. Freeze `integration`; run `pnpm verify` and the browser gate on the final commit.
4. Owner OK, then promote `integration` to `main` with a **merge commit** (Pages redeploys).
5. Check the live site plays the final video.
6. Owner OK, then tag `submission-2026-11-04` (and `v0.1.0`) on the promoted `main`; create
   the Release from [notes/submission-2026-11-04.md](notes/submission-2026-11-04.md); attach the
   archive; record the SHA and checksum in a PR into `integration`.

Release notes: [notes/v0.1.0-beta.md](notes/v0.1.0-beta.md) (changes in the beta) and
[notes/submission-2026-11-04.md](notes/submission-2026-11-04.md) (Release body).

## After judging

KI-43/45/48 lockstep catalogue fix (NEXT_STEPS B-4) and the rest of the post-judging register.
