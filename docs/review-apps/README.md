# Review apps: real Muse-built apps for human judgement

The beta's remaining open questions are not capability questions. They are
judgement questions: is a generated app any good, did it follow the decisions the
project carries, would you hand it to a colleague. No gate can answer those, and a
script that pretended to would be the worst kind of evidence. So this directory
holds the material for **human** review, and `pnpm run review:app` produces the
packet a person judges from.

## What one run does, and what it costs

```
FORGE_MUSE_BIN="$(command -v muse)" REVIEW_APP_ALLOW_STORED_CLI_AUTH=1 pnpm run review:app
```

- Seeds the app's decisions as real project decisions, at the revisions it then
  pins them to (the brief itself never mentions them, so the app has to infer
  them from the project).
- Submits **exactly one** `generate` job under an Idempotency-Key, so a lost
  response cannot spend a second job. Cap: `REVIEW_APP_MAX_CALLS` internal calls
  (default 12).
- Approves the staged version, verifies the artifact hash against the bytes the
  API returned, and saves them.
- Loads those bytes as a document in Chromium, takes desktop and phone
  screenshots, and reads the media ledger before calling the run cheap: zero
  provider media calls, or the run fails its own accounting.
- Writes `review-packet.md`: the evidence, the decisions quoted at their pinned
  revisions, and a judgement sheet left **blank**.

Cost basis is stated in the packet, because the product has two ways to pay: a
`FORGE_MUSE_API_KEY` delivered to the CLI over stdin, or the logged-in CLI (set
`REVIEW_APP_ALLOW_STORED_CLI_AUTH=1` to accept that, and the packet says the
spend lands on whatever account that CLI is authenticated to). With neither, the
run refuses with exit 2 rather than quietly substituting the deterministic fixture
CLI. If a fixture CLI *is* used, the packet names it, so a plumbing run can never
be mistaken for a model-quality run.

## Reading a packet

`report.json` next to it holds the machine facts: job id, internal calls, media
dispatch paths, artifact sha, page measurements, and an `evidence_issues` list.
That list is the only thing the harness contributes to the judgement, and it runs
in both directions: an artifact with no interactive controls, or a build over an
uncommitted tree, gets flagged so the packet cannot be read as a tick when the
capture cannot support one.

If a harness defect mis-measures a packet, fix the harness and re-measure for
free — no second paid job:

```
REVIEW_APP_REMEASURE_DIR=test-results/human-review/<packet> pnpm run review:app
```

That mode refuses if the retained bytes no longer match the hash the original
report recorded, writes a **new** evidence directory, and keeps the original
packet so the replaced number stays readable. See KI-71 for why that matters.

## Adding another app

1. Write `docs/review-apps/<slug>-brief.md`: what the app must do, and the
   constraints it must respect. Say the constraints the project's decisions will
   enforce **only** in the decisions file, not in the brief — that gap is the
   test.
2. Write `docs/review-apps/<slug>-decisions.json` with the decisions to seed.
3. Run it:

```
REVIEW_APP_SLUG=<slug> REVIEW_APP_BRIEF_FILE=docs/review-apps/<slug>-brief.md \
REVIEW_APP_DECISIONS_FILE=docs/review-apps/<slug>-decisions.json \
FORGE_MUSE_BIN="$(command -v muse)" REVIEW_APP_ALLOW_STORED_CLI_AUTH=1 pnpm run review:app
```

Each run is one coding job. Nothing in this flow makes a media call.

## What a packet cannot claim

- It cannot score the app. The sheet is for a person, and the packet refuses to
  contain a score of ours.
- A screenshot is of the artifact bytes as a document, not of the product's
  Studio preview. The artifact endpoint answers with the JSON envelope the Studio
  consumes, so the two are different observations and the packet names which one
  it is showing.
- A re-measured packet proves the bytes again; it does not prove the model's
  behaviour was reproducible.
- Decisions are checked by a human against pinned wording. Nothing here verifies
  that the app "followed" a decision.
