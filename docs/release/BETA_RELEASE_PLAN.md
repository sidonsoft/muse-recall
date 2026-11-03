# Beta release plan

Status as of 3 November 2026. "Beta" has no GitHub release, milestone, tag or label in
this repository yet; the product describes itself as a **local beta** at version `0.1.0`.
This plan covers the two releases that word maps to, in order.

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

## Release 1: hackathon submission (4 November, owner only)

The submitted `main` tree, released as **v0.1.0 local beta**.

1. Decide KI-44 + KI-47 (two dead doc pointers on frozen `main`): ship as-is with both
   recorded, or promote the docs-only fix before tagging (changes the SHA judges see).
   Recommended: ship as-is.
2. Submit the form, then follow
   [SUBMISSION_PRESERVATION.md](SUBMISSION_PRESERVATION.md#steps-at-submission-time):
   tag `submission-2026-11-04` on `main`, create the Release using
   [notes/submission-2026-11-04.md](notes/submission-2026-11-04.md) as the body, build and
   attach the archive, record its SHA-256.
3. Fill in the _to record_ fields in a PR into `integration`.

## Release 2: v0.2.0-beta.1 (after judging closes)

The first promotion of `integration` into `main`. Draft notes:
[notes/v0.2.0-beta.1.md](notes/v0.2.0-beta.1.md).

1. Land the KI-43/45/48 lockstep catalogue fix on `integration` (register item B-4).
2. Bump versions to the agreed name (suggested `0.2.0-beta.1`): root and workspace
   `package.json` files, `apps/server/src/config.ts` `SERVICE_VERSION`, the MCP server
   default in `packages/mcp-server/src/index.ts`. Do not touch the checksummed evidence
   files that record `0.1.0`.
3. Run `pnpm verify` and the browser gate on `integration`.
4. Open the promotion PR `integration` → `main`, merged with a **merge commit**
   (CONTRIBUTING.md), then tag `v0.2.0-beta.1` and publish a pre-release with the notes.
