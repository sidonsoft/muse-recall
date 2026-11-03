# Beta readiness report

Written for the beta on the `integration` branch, at the commit whose production bytes are quoted below
(`6abc769`). Every number here was measured, and each one names the directory it came from. Where
something is **not** measured, that sentence says so. If the beta is cut at a later commit, re-run
`pnpm run verify:release-gate` there and quote that run: the server bundle embeds the commit, so the
identity below does not travel forward on its own. For that reason the newest pass is found by looking at
the last directory under `test-results/release-gate/` rather than by trusting this sentence: each run
records the commit it built, so the evidence stays attributable even as the documents move.

## Verdict

**HUMAN SIGN-OFF REQUIRED.**

Not "blocked": the product's own gates pass, the release identity is supported, and there is no open
product defect at any priority. Not "ready" either: the one question a beta cannot answer for itself —
would you hand an application this product generated to a colleague — was asked of a person, and their
judgement sheet is still blank in the places only they can fill. The machine's evidence-quality flags
are filled in; the quality rows are empty on purpose. See `docs/review-apps/README.md` and
`test-results/human-review/palette-bench-2026-11-03-082925/review-packet.md`.

## Release identity

From `test-results/release-gate/2026-11-03-111530/report.json`, which is the run that built the bundles
every gate in `RELEASE-GATE.md` then tested:

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

That is the strongest identity this repository can claim: the bytes under test were built at the commit
being described, from a tree with nothing uncommitted. A later commit that only changes documents does
**not** inherit it — the server bundle embeds the commit, so a document-only commit still needs a
rebuild and a re-measure before it can carry the claim. The gate refuses to claim it when the tree is
dirty, and that withheld form is itself kept as evidence (`test-results/batchd-playback-auth/2026-11-03-0925`).

## What the final release gate measured

`pnpm run verify:release-gate` — see `docs/beta/RELEASE-GATE.md`. Run:
`test-results/release-gate/2026-11-03-111530`. Status: **pass**, 10 of 10 gates, and the bundles it tested
were the ones that run built at that same commit.

| gate | outcome | what it measured, in its own words |
| --- | --- | --- |
| `verify:security` | pass | the origin guard refuses cross-origin writes |
| `verify:runtime` | pass (14 checks) | an approved artifact runs in a real browser under the network policy |
| `verify:formsandbox` | pass | a form inside an artifact cannot escape the preview sandbox |
| `verify:batchc-ui` | pass | a suggested object becomes an inserted image the user approves |
| `verify:batche-review-ui` | pass (20 checks) | a screenshot review stays advisory and revision-pinned |
| `verify:batchd-playback-auth` | pass (15 checks) | secured byte playback and download, and the identity block above |
| `verify:media-journey-offline` | pass (6 checks) | asset → artifact → restart → rollback on uploaded bytes, with no provider |
| `verify:studio-workflow` | pass | the Studio UI drives generate → review → approve → restart end to end |
| `verify:artifact-probes` | pass (10 checks) | the probe battery tells a stale published output from a fresh one |
| `verify:beta-journey` | pass (18 checks) | the beta user journey on production bundles, both handover controls byte-checked |

Offline unit/typecheck/lint aggregate at this commit: `pnpm run verify` → exit 0, 132 test files,
1670 tests passed, 3 skipped; Biome 0 errors, 3 warnings (all three are deliberate `innerText` choices
explained in comments, not oversights).

## The beta user journey, walked

`verify:beta-journey` (`test-results/beta-journey/2026-11-03-111721`) boots the **production** server
bundle and `vite preview` over the built web assets, and drives the real Studio UI in the order a user
would: open a project → describe an application → read the change → approve → look at it → take it away
→ come back → change it → go back to the earlier version → do it on a phone.

Two checks exist because a human review found the class of defect they look for (KI-88):

- **Copy source hands over exactly the bytes the artifact endpoint serves** — the clipboard content is
  hashed and compared with the served artifact's own recorded hash.
- **Download HTML hands over the bytes of the version the UI calls current** — the downloaded file is
  hashed the same way (254 bytes, matching).

Both pass. That is a measurement of *this product's* handover controls, and it is worth saying plainly
that it does not extend to applications the model writes — where KI-88 lives.

The journey also measured refusals rather than assuming them: an empty prompt and an empty change request
are both refused, no job starts, and the reason names the field and the rule
(`prompt: Too small: expected string to have >=10 characters`,
`request: Too small: expected string to have >=3 characters`). The rollback confirmation is read whole,
because a first version of the check read only the question line and would have passed a dialog that
never mentioned that the restore cannot itself be undone.

**What this journey deliberately is not.** The coding CLI is `tests/fixtures/fake-muse.mjs`. No provider
call of any kind is made — the gate refuses to start if `FORGE_MUSE_API_KEY`, `FORGE_FALLBACK_API_KEY`,
`META_API_KEY` or `BASETEN_API_KEY` is exported, and it asserts the server's `[media-trace]` log exists,
is undamaged, and contains zero dispatches. So this gate measures the product's plumbing around a
generation. It is not evidence about what a model would generate, and its report says
`coding_cli: fixture:tests/fixtures/fake-muse.mjs` so nobody can read it as model evidence.

## Release-blocker register

Priority means what it costs a beta user, and the class column is not decoration: a defect inside a
generated application is not a product defect, and "the product cannot fix it" is a fact about the fix,
not an excuse.

| id | class | severity | state | what a beta user experiences |
| --- | --- | --- | --- | --- |
| KI-88 | generated application | P1 for that app | open | an application may hand over colours it is not displaying; the product's own Copy/Download are measured clean |
| KI-89 | generated application | P2 | open | a seed field can accept two numbers that produce one application |
| KI-90 | generated application | P2 | open | undo works inside a load and not across a reload |
| KI-91 | generated application | enhancement | open | five stacked swatches on a phone make comparison a scroll, not a glance |
| KI-92 | this repository's harness | P1 for the harness | closed | the probe battery could not say "I did not run", and drove six of seven promised sequences |
| — | product | — | none open | every open entry in `docs/KNOWN_ISSUES.md` is about a generated artifact |

So: **no unresolved P0/P1 product blockers**, and four open findings in the class of thing the product
generates. That distinction is the reason the verdict is sign-off rather than blocked: the product's
behaviour is measured, and what remains is a person deciding how good the generated output has to be for
a beta.

## Known limitations, in the short form

The long form is `docs/guide/limitations.md`. The parts a reviewer most often trips on:

- **Idempotency is per database, in-flight locking is per process.** Two servers sharing nothing, or one
  database behind two processes, break the "one paid call per review" guarantee in different ways. It is
  documented rather than built (D060).
- **The engine pin is a human decision.** A generated Phaser game carries the engine inside it
  (KI-53/D059). `pnpm run vendor:phaser -- --check` verifies the committed copy offline;
  `pnpm run vendor:phaser -- --against-remote` compares the remote pin and writes nothing either way.
  Nothing refreshes the pin automatically, and artifacts approved before KI-53 keep their CDN reference
  and stay valid under the older per-document network policy.
- **A dependency disclosure is a reading of bytes, not a record of what ran.** A request whose URL is
  assembled at runtime will not appear in it, and the panel says so in the same block as the list.
- **Vision-draft is experimental.** It works and it is accounted for; there is no evidence it beats
  asking the coding model directly.
- **Paid capability is real but expensive and bounded.** The live chain (image → coding → artifact, with
  restart and rollback) is proven at `test-results/media-live/2026-11-02T13-53-08`. The offline journey
  proves the same product path on uploaded bytes, and labels the difference: uploaded bytes are not
  provider-returned bytes.

## Provider accounting

Nothing in this readiness round cost anything.

| round | paid calls | evidence |
| --- | --- | --- |
| KI-52…KI-92 hardening, probes, beta journey, release gate | **0** | each gate's own log and `observations.ledger` |
| live media chain (16 calls: generate, edit, transcription, clip, review) | 16 | `test-results/media-live/2026-11-02T13-53-08` and the batch evidence directories |
| second Palette Bench generation (one coding job, cap 12, 5 internal calls) | 1 | `test-results/human-review/palette-bench-2026-11-03-082925` |

Total paid on this machine-day: **17**, unchanged since the second Palette Bench run. `verify:release-gate`
refuses to run at all if a provider credential is present, which is why its `provider_calls: 0` line is a
measurement with a guard behind it rather than an intention.

## What is proven, and what is not

Proven, with evidence named above: production-bundle boot with no credential; the Studio journey;
approval, version listing, rollback and their byte-level effects; both handover controls; secured media
byte playback/download; visual review staying advisory and revision-pinned; the SAM suggest → cutout →
insert → approve → coding → restart → rollback chain (live and offline); the probe battery's ability to
distinguish a stale published output from a fresh one; build identity at `6abc769`.

Not proven by any gate here:

- **Whether generated applications are good.** A person reviewed one and said *accept with conditions*.
  The five quality rows and the decision-compliance rows in that packet are blank because they are a
  person's rows.
- **Whether the model would generate something different under this brief tomorrow.** Reproducibility of
  the *product* is measured; determinism of the *model* is not claimed anywhere.
- **Multi-instance behaviour.** Single process, single database; see the idempotency limitation.

## Next action

1. A person fills the judgement rows in the round-2 packet (`test-results/human-review/palette-bench-2026-11-03-082925/review-packet.md`;
   byte-identical reviewer copies in `/Users/burnz/projects/muse-recall-integration/review-round-2-0ff747b/`).
2. If the cut is taken at a later commit, rebuild and re-measure the identity pair there before quoting
   it — `pnpm run verify:release-gate` does both in one pass.
3. If a second generated application is to be reviewed, brief it with the rules the last round exposed
   (published output must reflect the state it was published from; accepted inputs must all mean
   something; destructive actions undoable across a reload), and let the probe battery report against
   them rather than arguing about them.
