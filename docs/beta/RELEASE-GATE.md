> **Published beta:** [v0.1.0](https://github.com/sidonsoft/muse-recall/releases/tag/v0.1.0) is fixed at `707921db83a374d155d3929ef9b99092bcd4e8f1`. The owner authorized publication on 4 November 2026. Its [commit-specific report](https://github.com/sidonsoft/muse-recall/releases/download/v0.1.0/release-gate-report.json) records ten passing gates, a clean build and zero provider calls. Report and evidence archives, source and checksums are attached to the release. The measurements and verdict below are historical. The separate generated-application quality sheet remains unscored; publication does not fill it.

# The final release gate

One command:

```bash
pnpm run verify:release-gate
```

It builds the two production bundles, then runs ten offline gates in sequence and reports each gate's own
outcome. It makes no provider call and refuses to run if a provider credential is in the environment.

Evidence for the run quoted below: `test-results/release-gate/2026-11-03-111530` — `report.json` (machine)
and `RELEASE-GATE.md` (written by the gate itself, so the numbers in the evidence directory and the numbers
here come from the same measurement).

These documents are not the newest pass and cannot be: the act of committing them moves the commit. The
newest pass is always the last directory under `test-results/release-gate/`, and every one of them records
the commit it built and measured, so a reader comparing a cut against these numbers should read that
directory rather than this table. What this table fixes is the *shape* of a passing run — ten gates, three
exit codes, one identity block — not a snapshot of the moment.

## Results, as measured at `6abc769`

| gate | outcome | seconds | what it is relied on to prove | evidence |
| --- | --- | --- | --- | --- |
| `verify:security` | pass | 2 | the origin guard refuses cross-origin writes | — (prints its measurements, keeps no directory) |
| `verify:runtime` | pass · 14 checks | 19 | an approved artifact runs in a real browser under the network policy | `test-results/runtime/20261103-1046` |
| `verify:formsandbox` | pass | 3 | a form inside an artifact cannot escape the preview sandbox | — |
| `verify:batchc-ui` | pass | 6 | a suggested object becomes an inserted image the user approves | `test-results/batchc-ui` |
| `verify:batche-review-ui` | pass · 20 checks | 6 | a screenshot review stays advisory and revision-pinned | `test-results/batche-review-ui` |
| `verify:batchd-playback-auth` | pass · 15 checks | 11 | secured byte playback and download; the identity block below | `test-results/batchd-playback-auth/2026-11-03-1116` |
| `verify:media-journey-offline` | pass · 6 checks | 9 | asset → artifact → restart → rollback on uploaded bytes, no provider | `test-results/media-journey/2026-11-03-11161987` |
| `verify:studio-workflow` | pass · 59 checks measured, none reported in the machine summary | 38 | the Studio UI drives generate → review → approve → restart | `test-results/studio-after` |
| `verify:artifact-probes` | pass · 10 checks | 14 | the probe battery tells a stale published output from a fresh one | `test-results/artifact-probes/2026-11-03-111707` |
| `verify:beta-journey` | pass · 18 checks | 9 | the beta user journey on production bundles, both handover controls | `test-results/beta-journey/2026-11-03-111721` |

Status: **pass**, 10 of 10. Total wall time a little under two minutes of gate work.

## Release identity, as the gate emitted it

```json
{
  "commit": "6abc769140e0b500c29ba4df7e36ec64527501f0",
  "treeCleanAtMeasure": true,
  "serverBuildHash": "ca837aacf39935a3a46fcc09229579cec3c62f8d9dd04158f9d5ee1ae5b34fb1",
  "webBuildHash": "b2471becf70fe42d8958c2dbd1edb355dc476580a50779ddee1a072353174f82",
  "bundlesBuiltAtHead": true,
  "bundlesBuiltFromCleanTree": true,
  "supportsCommitIdentity": true,
  "identity_note": "both bundles were built at 6abc769; the build ran over a clean tree at that commit"
}
```

`treeCleanAtMeasure` describes the working tree **while the gate ran**; `bundlesBuiltFromCleanTree`
describes the tree **when the bundle build ran**. They are different instants and the names say which
(KI-84). When they disagree, the gate prints the withheld form and the release documents may not quote an
identity claim for those bytes.

That withheld form is not hypothetical. Two runs earlier in the same day, an uncommitted edit to the gate
itself produced:

```
both bundles were built at 3c3df98; the build recorded an uncommitted working tree (2 file(s) changed at
build time), so these bundle bytes include work no commit names and cannot carry a commit identity claim
```

…retained at `test-results/batchd-playback-auth/2026-11-03-0925`. The gate still measured the journey and
still exited 0 as a measurement; it simply refused to attach an identity claim to bytes no commit
described.

## Three properties this gate is built to have

**It cannot accidentally pay.** Every listed gate is a no-provider measurement. If `FORGE_MUSE_API_KEY`,
`FORGE_FALLBACK_API_KEY`, `META_API_KEY` or `BASETEN_API_KEY` is exported, the release gate exits 2 with
`BLOCKED` and runs nothing, and it also strips those variables from every child. A run that could pay is
not the run the release documents describe.

**A gate that disappears is a failure.** The ten gate names are pinned twice in the source: as the list
that runs, and as the `required` list the count discipline checks (KI-83). A rename, a dropped step, or a
duplicate that inflates a headline cannot quietly produce "N gates passed" for a smaller N.

**Blocked is its own outcome.** A missing browser, a stale bundle, or a port already in use is a
prerequisite problem: it prints `BLOCKED`, names the fix, claims no measurement, and exits 2. A failed
measurement exits 1 and names the failure on the terminal, not only in a file. Confusing these two is how
"we couldn't run it" becomes "it passed" in someone's summary.

## What this gate does not claim

Its own report ends with the sentence, because the summary line above it is easy to quote out of context:

> A pass here means every offline gate above measured what it claims. It says nothing about whether the
> applications the product generates are good, and no gate in this list is allowed to claim otherwise.

Concretely: `verify:beta-journey` drives a **scripted** coding CLI (`tests/fixtures/fake-muse.mjs`), so it
proves the product's plumbing around a generation and nothing about model quality;
`verify:artifact-probes` reports findings about generated applications without failing this gate, because
a defect in someone's generated app is a measurement of that app, not a product failure; and human review
is recorded separately as `human_review_status: required_not_performed`.

## Running it

```bash
pnpm run build
pnpm run verify:release-gate
```

Exit codes: `0` every gate measured and passed · `1` at least one gate failed, with the failing gate and
its log tail printed · `2` a prerequisite refused (credential present, bundles unbuildable, a gate name
that no longer exists), with nothing measured.

If you want the paid chain as part of a release story, it is a separate decision with its own budget:
`pnpm run verify:media-live-smoke` spends media calls and is documented in `docs/MULTIMODAL_STUDIO_STATUS.md`.
The release gate will not run it, and will not run anything else that can spend.
