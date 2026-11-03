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

## Getting the app into a state worth judging

An app in its empty state cannot be judged at its main function, so a run may name
the interactions that bring it to a used state. The steps are app-specific on
purpose, and every step taken is written into the screenshot labels:

```
REVIEW_APP_STEPS='[{"fill":"Seed","value":"42"},{"clickText":"Generate"},{"clickText":"Export"}]'
```

If the visible text does not change after the steps, the labels say so: "after I
pressed Generate" is a claim about state, and a harness that cannot verify it says
so rather than implying it.

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

- The measured facts (text contrast against a flat background, native dialogs
  raised, named controls, status text) are measurements, not verdicts. A packet
  that could measure nothing says it measured nothing rather than showing a zero
  that reads like a pass.
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
- `issues: []` means the evidence is fit to judge from. It has never meant the app
  has no defects, and a person reading a packet should not have to remember that:
  the second round printed it over bytes with three defects in them (KI-87).

## Wording rules that changed after the first review round (D060)

The decisions seeded into `palette-bench-decisions.json` are the exact text that
was **paid for**; that file is kept as-is so the retained packet stays honest.
For the next brief, one rule changes wording, not intent:

> At most one accent colour is used per screen **in the interface chrome**.
> The colours an artifact is being asked to generate or display are content, not
> chrome, and are judged as content.

Without that clause, a palette, chart or theme tool fails a rule it cannot
satisfy while doing its job. The other three rules (inline status text instead of
modal dialogs, body text at 4.5:1 or better, every destructive action undoable
from the same screen) carry over unchanged.

## Rounds run against the same brief

Two paid runs exist for `palette-bench`, and they are comparable because the inputs are byte-identical
— `docs/review-apps/palette-bench-brief.md` hashes `37dac94d…` and the seeded decisions hash
`296832b2…`, the same values carried inside both packets' `brief.md` and
`decisions-requested.json`, with the same cap (12 internal calls), the same three driven steps
(`type 42` → `Generate` → `Export`) and the same CLI.

| packet | what it is | cost, read back from the report |
| --- | --- | --- |
| `test-results/human-review/palette-bench-2026-11-02-2148` | the first paid run (build `94867e5`), kept with its mis-measurements | 1 job, 3 internal calls, 0 media |
| `…-2026-11-03-082925` | the second paid run, against the current candidate (`0ff747b`) | 1 job, 5 internal calls, 0 media |

Both were billed to the logged-in CLI with `REVIEW_APP_ALLOW_STORED_CLI_AUTH=1`; neither had a
`FORGE_MUSE_API_KEY` in the environment, and neither made a provider media call.

Everything between them is free: `…-2250` (the packet the first human round read), `…-0811` (kept as
the measured evidence of KI-85's lost cost record), `…-081947` and `…-081952` (free re-measurements of
the original bytes, and the evidence that KI-86's directory collision is fixed). Retained packets are
never rewritten — a corrected measurement always gets a new directory (KI-86).

## The probe battery: what a capture cannot see

A review packet measures a state. Staleness, numeric wrap-around and lost history are properties of
*sequences*, and no set of assertions about one load finds them: the second round's capture printed
`issues: []` over an artifact with three defects a person found by clicking things.

`pnpm run verify:artifact-probes` runs the sequences. Two modes, deliberately different:

```bash
# CI. Two fixtures — one that keeps handing over output it no longer displays, one that refreshes it —
# and the battery must flag the first and leave the second alone. This gates the battery itself.
pnpm run verify:artifact-probes

# Against a retained packet. Reports findings; does not fail, because a defect in a generated app is a
# measurement of that app, not a product failure. The packet is never rewritten.
PROBE_PACKET=test-results/human-review/<packet> \
PROBE_INTERACTIONS='{"fill":{"label":"Seed","value":"77"},
  "regenerate":"Generate palette from current seed",
  "publish":"Export palette as CSS custom properties",
  "copy":"Copy exported CSS to clipboard",
  "destructive":"Clear palette"}' pnpm run verify:artifact-probes
```

The control names are accessible names, which for this artifact are `aria-label` text rather than the
visible words — the copy button says "Copy CSS" on screen and is named "Copy exported CSS to clipboard".
Passing the visible words gets a timeout, which is the honest failure: the probe could not find the
affordance a user would name.

Bytes are served over `http://127.0.0.1` rather than `file://` because a file document has an opaque
origin and the clipboard API refuses to run there — and the clipboard is exactly where KI-88's stale
palette was hiding.

What the battery cannot do: it proves those three sequences behave in a named way. It does not rank the
app, and a clean battery run says nothing about quality. A finding here enters the reviewer's evidence
as KI-88, KI-89 and KI-90 did — as something a person weighs against the decisions, not as a failed gate.
