# Contributing

Thanks for helping improve Muse Recall. Pull requests are welcome.

## Which branch to target

Open your pull request against **`integration`**, not `main`.

| Branch | What it is |
| --- | --- |
| `main` | The stable version the hackathon judges see (README, website and Codespaces all point here). |
| `integration` | Where contributor changes are tested together before they're promoted to `main`. |

When you open a PR, set **base: `integration`**. If you target `main` by
mistake, the maintainer will retarget it for you.

The exact version submitted to the hackathon is also frozen as the
`submission-*` tag and its GitHub Release, so later changes never alter what
was judged.

## Before you open a PR

- Run `pnpm verify` (lint, typecheck and tests) on Node 24.
- Keep each PR to one change and describe what it does and how you checked it.
- Don't edit the checksummed evidence under `docs/hackathon-evidence/` or
  `docs/demo/evidence/`.
- For anything bigger than a small fix, open an issue first so we can agree on the
  approach. The [roadmap](docs/roadmap/POST_HACKATHON_ROADMAP.md) shows where the project
  is heading.

## Reporting security problems

Please don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md) for how
to report it privately.

## What happens next

- CI runs on your PR after the maintainer approves it (required for first-time
  and outside contributors).
- A PR needs one approving review and green CI before it can merge.
- PRs into `integration` are squash-merged, so each PR becomes one commit.
  Give your PR a clear title; it becomes the commit message.
- Tested batches are promoted from `integration` to `main` in one reviewed PR.
- Nothing is merged automatically.
