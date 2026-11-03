# Multimodal studio — status against the beta v0.1 plan

**Written:** 2026-11-01
**Commit gated:** named in §Verified at this commit, together with the build identity
those runs proved. The checks were run against the production bundles rebuilt at that
commit, with `git status --porcelain` empty.
**Scope:** the five expansion batches in the multimodal studio plan (§4) plus the
release gate (§5). The pre-expansion product (memory, chat, approval, rollback,
research trials) is covered by the earlier phase docs; this file only records the
expansion.

Status words mean exactly one thing here:

- **built and verified offline** — the behaviour exists and deterministic tests or
  browser gates prove the contract, including how it fails.
- **built, live result outstanding** — the behaviour exists and is fixture-verified,
  but no real provider call has been recorded for it, so its *quality* is unproven.
- **not built** — the behaviour does not exist.

## Position per batch

| Batch | Status | What proves it | Live provider evidence |
| --- | --- | --- | --- |
| A — access, storage, recovery | built and verified offline | asset store, versioning, CSP-inline embedding, backup/restore drill (`pnpm media:drill`), provenance gate | see Batch B note on image calls |
| B — Muse Image and integration | built and verified offline, **and** live measured | media API/journey suites, `verify:media-journey`, embedded-asset verification in `verify:studio-workflow`, plus `verify:image-live-smoke` (`2026-11-02-0445`) | **yes** — one generate and one edit call, measured in pixels (see below) |
| C — visual references and SAM | built and verified offline, **and** live | `verify:batchc-ui` (22 checks), `verify-studio-workflow` (58 checks), offline resume package (PASS 14 at `2026-11-01-0824`; that fixture is now consumed, so the gate refuses to re-run it), plus real calls in `test-results/batchc-live/` | **yes** — vision, SAM, and coding calls below |
| D — voice and video | built and verified offline for access and playback, **and** live for transcription and clip observation | `verify:batchd-playback-auth` (15 checks, audio **and** video, secured and tokenless), `tests/unit/source-playback.test.ts` (33), `tests/integration/access-token-media-bytes.test.ts`, plus `verify:batchd-live-smoke` (`2026-11-02-0458` audio, `2026-11-02-0400` video) | **yes** — one transcription and one clip observation, both scored against what the fixtures actually contain |
| E — visual and decision-change review | built and verified offline, **and** live for one scored frame | `verify:batche-review-ui` (20 checks), `tests/integration/forge-batche-visual-review.test.ts` (25, including replay-subject, record-fault and creates-no-state cases), `tests/integration/forge-batche-generations.test.ts` (8), `tests/unit/studio-batch-e.test.ts` (29) | **yes, one call** — `verify:review-live-smoke` (`2026-11-02-0451`); every other Batch E gate keeps using a deterministic stub by design |

## What the live evidence actually shows

From `test-results/batchc-live/` (real calls, `FORGE_MEDIA_MAX_RETRIES=0` enforced
and asserted):

- **Muse Spark vision** (`muse-spark-1.3`) — `2026-11-01-0106`: HTTP 200, three
  decision drafts proposed from a reference, exactly one dispatch, `max_retries: 0`.
- **SAM** (`sam-3.1`) — `2026-11-01-0755`: one match, box `{x1:931,y1:135,x2:1123,
  y2:201}`, 10 stream events (1 text delta, 7 ignored), response sha256
  `2d87c603…`, cutout asset `5bc77b15` v1 at 192×66, sha256 `52d90d98…`. Genuine
  zero-match responses were also observed live (`…-0556`, `…-0559`, `…-0731`) and
  are treated as valid empties, never as errors.
- **Muse Wonder coding** (`muse-wonder-1.0`) — job `adcab017-5847-4f53-92b1-ad77dbb5be52`
  in the same run: `succeeded`, `model_observed: muse-wonder-1.0`, `usage.calls: 6`,
  one job only, and the cutout is byte-identical inside the staged artifact.
- **Quota reality** — a later run ended in `API error 429 … Subscription quota
  exhausted`, which is why the offline paths exist. A quota failure surfaces as
  `provider_auth_failed` (502 on the review surface) with bounded telemetry, not as
  a silent success.

### Live runs on 2026-11-02: image, voice, video clip, screenshot review

Each of these spends a fixed number of calls, asserts `max_retries: 0`, and
accounts for dispatches from the server's own trace log rather than from what
the client submitted.

- **Muse Image generate** (`muse-image-1.0`) — `test-results/image-live/2026-11-02-0445`:
  one dispatch on `/v1/images/generations`, HTTP 200, attempt 1. The stored bytes
  decode to 1600×1600 (requested 512×512 — the model decides the canvas), 1,376
  distinct colours, and the picture matches the prompt's subject: red-dominant
  21.5% of pixels, green-dominant 78.4%. The asset's recorded sha256 matched the
  bytes read back from disk.
- **Muse Image edit** — same run, one dispatch on `/v1/images/edits`, attempt 1,
  new version of the same asset: blue-dominant pixels appeared (2.4%) while red
  (19.1%) and green (78.5%) survived, so the edit added the requested circle
  without discarding the scene.
- **Voice transcription** (`muse-voice-transcribe-1.0`) —
  `test-results/batchd-live/2026-11-02-0458`: one dispatch on `/v1/asr/transcribe`,
  and the transcript contained **9 of 9** content words from the speech the harness
  generated locally with `say` (5.1 s of real 16 kHz PCM). PASS, 7 checks.
- **Video clip observation** (`muse-spark-1.3`) — `…/2026-11-02-0400`: one model
  dispatch plus the required file upload, 4 timed observations whose text names
  what the 96×96 fixture actually renders (red field, small green square, moves
  left to right), 3/3 expected tokens, no timestamp outside the clip. PASS,
  10 checks.
- **Screenshot review** (`muse-spark-1.3`) — `test-results/review-live/2026-11-02-0451`:
  one dispatch, two accepted decisions pinned at revision 1, frame contents known
  by construction. The model flagged the countdown as `possible_conflict`
  (evidence: "large centered yellow text reading 'COUNTDOWN 10'"), left the
  satisfied score preference `consistent` (evidence: "top bar upper-right corner
  displaying 'SCORE 120'"), and volunteered the right limits ("a still image
  cannot show whether the number actually decrements"). A replay with the same
  Idempotency-Key came back byte-identical with `idempotent-replayed: 1` and cost
  nothing. Nothing was written: no version, no job, same two memory rows.

**What those runs cost, including the attempts that produced nothing.** Live runs
were: 1 transcription (a first attempt failed on the harness's own accounting
after the transcript had already succeeded, and the retry above is the clean
record); 3 clip model calls plus 3 uploads (one truncated by the old token
budget, one correct answer killed by the harness's call accounting, one clean
PASS); 4 image calls (one generate whose bytes were deleted by a wrong path in
the harness before measuring, one generate stored but unmeasurable because the
harness could not decode WebP, then the PASS run's generate + edit); 1 review
call. Total: 9 paid calls, zero transport retries, and every failure was in this
repository's code — never a provider refusal. Failed attempts keep their evidence
directories rather than being deleted, so the cost stays visible.

### Live chain run on 2026-11-02 (`2026-11-02T13-53-08`): image → coding → artifact

Later the same day, the last remaining live gap was closed by one paid run of
`pnpm verify:media-live-smoke` (21 checks, `test-results/media-live/2026-11-02T13-53-08`):
a live generated image, approved, edited live, approved as v2, inserted as an
`muse-asset://` reference into a change request, handed to the real coding model, rendered in
the staged preview, approved, kept **byte-identical across a server restart**, changed again to
v3, and rolled back to byte-identical v2 with the image still embedded.

Its cost, read from both accounts rather than asserted:

| rail | measured |
| --- | --- |
| media ledger | 1 dispatch on `/v1/images/generations`, 1 on `/v1/images/edits`, attempt 1, HTTP 200, **no other path, no retry** |
| coding jobs (from each job record) | `generate` 6 calls → v1, `modify` 4 calls → v2 (asset embedded), `modify` 4 calls → v3; all `muse-wonder-1.0`, matching what `/api/meta` reported configuring; cap 15/job |

So this run adds 2 media calls plus 14 coding-internal calls (16 paid calls in total for the
day, zero transport retries). The version HTML that shipped through the chain is
`e17df26f578d99f1ca6a5ffcefea26384422490e59d95a64b8662b93cf3f1007`.

That gate had also been the one live gate with no accounting at all, so it was hardened
first (`711de72`): media trace, zero-retry pin read back from `/api/meta`, an inverse-allowlist
path policy, a coding account read from the job records, build provenance before any call,
credential check against log contents, `report.json` plus the isolate on **every** exit path,
and `MEDIA_LIVE_BOOT_ONLY=1` to validate the harness for free. Then the run's own ledger
exposed one more defect — the edit dispatch reported `model=(none)` (KI-61) — fixed in `81ad991`
after the run, so the retained ledger line in that evidence predates the fix.

Everything after `2026-11-01-0755` — the offline resume package, Batch D's
token-gated playback, Batch E — was verified **without any provider call**. The
Batch C and D gates refuse to start when `FORGE_MUSE_API_KEY` or
`FORGE_FALLBACK_API_KEY` is set.

## What is not proven, and what would prove it

Every live capability gap this file listed two days ago is now closed, because the
harnesses that would prove them did not exist until they were written and paid for.
What remains is not a capability gap but a judgement gap (review quality on a
Muse-built app, vision-draft usefulness) and one documented single-server limit:

| Capability | Gap | Command that records the evidence |
| --- | --- | --- |
| ~~Image asset **inside a generation**~~ | **closed 2026-11-02 at `711de72`**: live image → approved asset → `muse-asset://` insert → real coding model → preview + diff → approve → restart keeps v2 bytes → rollback restores them with the image embedded. 21 checks, 2 media calls + 14 coding calls | `pnpm verify:media-live-smoke` (paid: 1 generation, 1 edit, 3 coding jobs capped at 15 calls each; `MEDIA_LIVE_BOOT_ONLY=1` proves the harness for free) |
| Review quality on a **Muse-built** app | the live review probe used a frame of a hand-authored app whose contents were known by construction. Judging a real Muse artifact — where "correct" is not precomputable — is unmeasured, and is the reason review stays advisory | a live review run against a frame from an approved generation; no automatic score is possible, a human must read the findings |
| Vision draft **usefulness** | the live vision call returned three drafts and one was approved offline, but no gate measures whether drafts are good guidance | human review of `test-results/batchc-live/*/02-vision-drafts.png` |
| ~~Fresh-install demonstration (§5 gate 7)~~ | **done 2026-11-02 at `1d32761`**: clean clone → frozen-lockfile install → aggregate check → production bundles naming the clone's own commit → documented first run → both restore drills → production browser gate inside the clone → a live smoke that refuses without a credential | `pnpm verify:fresh-install`, PASS 17 checks; `docs/Fresh-Install-Rehearsal.md` |
| Offline behaviour of a generated game | measured on 2026-11-02: no canvas, approval refused, preview shows a blank frame with no message; the refusal now names the CDN origin | closing it is a product decision: vendor Phaser locally, or accept that games need network; a preview-level message needs an in-document bridge |
| Multi-server idempotency | the in-flight dedup is per-process; two servers could both pay for one key | documented as a single-server beta limit; needs a shared store to close |

Closed by live runs, with the evidence named above:
`muse-image-1.0` generate and edit (**closed**, `2026-11-02-0445`),
`muse-voice-transcribe-1.0` (**closed**, `2026-11-02-0458`), video clip
observation (**closed**, `2026-11-02-0400`), screenshot review finding quality on a
known frame (**closed**, `2026-11-02-0451`), and the live image → coding → artifact
chain with restart and rollback (**closed**, `2026-11-02T13-53-08`).

Documentation states these gaps rather than leaving them implied:
`docs/BatchB-Media-Decisions.md` (§live provider), `docs/BatchE-Decision-Review.md`
(§Limits to keep honest), and the limits text shipped inside every review payload.

## Verified at the commit the gates ran against

Offline: no provider key and no paid model call. That phrase needs its precise meaning stated,
because it was previously written as "no external network" and that is wrong. The gates make no
provider request and refuse to start when a provider credential is present. Since KI-53 closed, the
game engine is no longer an exception either: a generated game carries the copy of Phaser this
product vendors, and `pnpm verify:runtime` boots one with **no remote origin granted at all**. The
most recent full set of offline gate numbers is at `2774a2b` (KI-76 to KI-82) and is named in
*The newest identity pair that may stand for a beta cut* above: `verify` 127 files / 1 611 passed /
3 skipped, `verify:runtime` **14**, `verify:studio-workflow` **59**, `verify:batchc-ui` 22,
`verify:batche-review-ui` 20, `verify:batchd-playback-auth` 15, `verify:media-journey-offline` 6.
(The Studio total of 59 is measured by the gate as edited in the commit that records KI-83, against
the bundles built at `2774a2b`: gate scripts are not hashed inputs, so the bundle pair does not move
with a gate change, but the count belongs to the gate that produced it.)
The per-gate descriptions below are written against the older set they first ran with, and each
carries its own commit stamp where it matters. The
one remaining case that needs the network is a document that still references the CDN — an artifact
approved before that change, or a Phaser version outside the pin — and `verify:runtime` exits 2 with
the reason when that host is unreachable rather than reporting a product failure. The numbers below are the
gates re-run at `3189df9`, the commit that made the game engine a carried copy instead of a network
call (KI-53 / D059); it also ran them at `c9c18cf`, the commit that enforced the paid-call budgets
the accounting previously only reported (KI-55 items 9-12), and at `b698070`, which fixed the
read-only-route write (KI-54). A documentation commit moves the build *identity* without moving
bundle contents (docs are not hashed inputs) — but this one is different: both bundles moved,
because the server gained the vendored engine module and the shared schema gained the version
manifest. The identity pair for the newest commit is recorded by the identity gate named below, and
`verify:batchd-playback-auth` refuses to run a gate against bundles that do not match the checkout
running it.

**The newest identity pair that may stand for a beta cut** comes from
`test-results/batchd-playback-auth/2026-11-03-0822/report.json`: commit
`b6b065698be0` (KI-85 and KI-86, the two review-harness defects), with
`treeCleanAtMeasure: true` (the KI-84 name — the state of the checkout while the gate ran),
`bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`,
`serverBuildHash: e792a59fc933…` and `webBuildHash: b2471becf70f…`. **The web bundle did not move
across KI-84, KI-85 or KI-86**, and that is now a measurement rather than a reason: only
`scripts/build-production-bundles.ts` and `scripts/lib/build-provenance.ts` among the `scripts/` tree
are hashed inputs, and the server bundle moved from `1d18b46e93b5…` to `e792a59fc933…` because the
provenance library itself changed and the manifest embeds the commit.
`pnpm run verify` at that commit: 130 files, 1 631 passed, 3 skipped; Biome 0 errors /
3 warnings / 14 infos; `pnpm run typecheck:tests` exit 0. Re-run against those bundles in the same
round: `verify:batchc-ui` (22), `verify:batche-review-ui` (**20**), `verify:runtime` (**14** checks,
`test-results/runtime/20261103-0823/report.json`), `verify:studio-workflow` (**59** checks, project
`studio-workflow-0f9wcd`, with `dependency-disclosure-staged.png` and
`dependency-disclosure-approved.png` in `test-results/studio-after/`) and the offline media journey
(**6** checks, 0 dispatches, `test-results/media-journey/2026-11-03-08235171`).

The pair one round earlier — `test-results/batchd-playback-auth/2026-11-03-0700/report.json`, commit
`2774a2b9ee5f`, server `1d18b46e93b5…`, web `b2471becf70f…` — is kept, and is superseded rather than
wrong: it carried the fourth review's findings and was measured with the old field names, including a
bare `treeClean` whose ambiguity KI-84 later removed.

**Where that pair sits relative to HEAD, measured rather than reasoned.** It was measured
at `2774a2b`; the commits on top of it (`0d0bf17` docs, `775e2ed` the KI-83 gate guard)
touch documents and gate scripts. The hashed input sets say which scripts count: only
`scripts/build-production-bundles.ts` and `scripts/lib/build-provenance.ts` are hashed
(plus `package.json`, `tsconfig`s, `apps/*/src` and `packages/*/src`), so
`verify-studio-workflow.ts` and `scripts/lib/gate-check-count.ts` are not. Rebuilding at
`775e2ed` confirms both halves: the web bundle is byte-identical (`b2471becf70f…`) while
the server bundle moves (`1d18b46e93b5…` → `4c11fad019a8…`) because its build manifest
embeds the commit. So a beta cut is re-measured at the commit actually cut, and this pair
cannot be inherited. Nothing that spends a
provider call was re-run: this round made **no** paid call, and Studio's checks used the
deterministic fixture CLI.

**The run that pair replaces, and why it cannot stand** is
`test-results/batchd-playback-auth/2026-11-03-0659/report.json`: same commit, bundles built one
minute earlier over a checkout with one uncommitted file. It reports `bundlesBuiltFromCleanTree: false`
(the build instant, the one that matters for an identity claim — see KI-84), `supportsCommitIdentity: false` and an `identity_note` naming
the problem, and its check list carries one extra line saying so. It is kept because it is the
clearest measured demonstration so far that KI-58's guard fires on a dirty build tree rather than
quietly inheriting the previous claim.

**The pair that round superseded** is
`test-results/batchd-playback-auth/2026-11-03-0531/report.json`: commit
`32300ff0937da4cd4d08121d3dcde7fa0cfb1d66` (KI-74, the approval-rail dependency disclosure),
`serverBuildHash: d5f219fbf41d…` (corrected here: this document previously printed
`d5f219fbf414…`, a typo in a hash, which is the kind of drift KI-68 was about) and
`webBuildHash: aca1962dccfa…`. `pnpm run verify` at that commit: 126 files, 1 587 passed,
3 skipped; Biome 0 errors / 3 warnings / 16 infos, with `verify:runtime` at **11** checks
(`test-results/runtime/20261103-0532/report.json`). The pair before that,
`test-results/batchd-playback-auth/2026-11-03-0048/report.json` (`c000a85ca324`, the KI-75 fix,
`serverBuildHash: b1507048d914…` moved by that commit because `package.json` is a hashed input,
`webBuildHash: 34ee5eda1b6f…`), remains on disk with the older pairs.
The pair one commit earlier, `test-results/batchd-playback-auth/2026-11-03-0041/report.json`
(`3dab9db18a87`,
`serverBuildHash: dc417e0d7ac6…`, `webBuildHash: 34ee5eda1b6f…`) carries the same web bytes and the
`identity_note`: `both bundles were built at 3dab9db; the build ran over a clean tree at that
commit`. The pair one engine-move earlier —
`test-results/batchd-playback-auth/2026-11-03-0027/report.json`, commit `3189df9b2850`,
`bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`,
`supportsCommitIdentity: true`, server build `fecff3f9b6cd…`, web build `34ee5eda1b6f…`, and the
report's own `identity_note`: `both bundles were built at 3189df9; the build ran over a clean tree
at that commit`. **This is the first pair whose web bundle moved in this release line**, and the
reason is not the vendored engine (which is server-side): `packages/shared/src/forge.ts` gained the
vendor manifest fields on `ForgeVersionSchema`, and shared types are bundled into the web client.
The previous pair (`2026-11-02-2155` at `80c0780`, server `a2db64a54269…`, web `065ee809a766…`) is
kept, as is `2026-11-02-2110` at `41770e0` (`59deb4ab3232…`), the first run of that gate whose
report stated a verdict at all — `ok: true`, `status: "PASS"`, `completed_checks: 15` (`KI-69`).
The same round at `3189df9` re-ran `pnpm run verify` (122 files, 1560 passed, 3 skipped; Biome 0
errors / 3 warnings / 15 infos), `verify:batchc-ui` (22 checks), `verify:batche-review-ui`
(20 checks), `verify:runtime` (8 checks, `test-results/runtime/20261103-0027/report.json`),
`verify:studio-workflow` (56 checks) and the offline media journey
(`test-results/media-journey/2026-11-03-00280397`: 6 checks, **0** dispatches,
`ledger_issues: []`). Nothing that spends a provider call was re-run at this commit; the paid live
chain evidence at `test-results/media-live/2026-11-02T13-53-08` **predates** KI-53, so the artifact
it approved still carries a CDN reference rather than the vendored engine. The prior pairs
(`2026-11-02-1529` at `340ff79`, server `67f1ad14942b…`; `2026-11-02-1445` at `9ffa49d`, server
`44c67eb0345c…`) are kept, and the earlier `2026-11-02-1226` at `398e124` stays as the record of the
first run that printed the `identity_note` wording (`KI-58`).

A docs-only commit changes no hashed **input**, and that is not the same as changing no bundle
bytes: the build manifest bakes the commit into the server bundle, so its hash moves with every
commit while the source behind it is identical (`3dab9db` server `dc417e0d7ac6…` vs `3189df9`
server `fecff3f9b6cd…`, web byte-identical `34ee5eda1b6f…` across both). A pair therefore cannot be
inherited by reasoning about what changed — it has to be re-measured at the commit that would be
cut, which is why the gate refuses to run against bundles that do not match the checkout running
it. The rule stays mechanical: the identity a beta cut would carry is the `buildProvenance` block of
the newest `test-results/batchd-playback-auth/` directory whose
`observations.buildProvenance.supportsCommitIdentity` is `true`. The previous paragraph quoted a
pair two commits behind HEAD and named a field the report does not emit; that is what this
correction fixes.

**Three more gate defects found while reviewing this fix pass** (`KI-57`, `KI-58`, `KI-59`): a
paid gate could exit 1 without printing its reason (the catch printed only crashes, and every
deliberate `fail()` was the expected type); the build-identity report named the tested commit
rather than the commit the bundle bytes came from, and stayed silent about a build made over a
dirty tree; and a dead server was reported by the last characters of its stack instead of its
own `Fatal startup error` line. All three are reporting defects — the measurements were right,
the narration was not, which is how an operator re-runs a run that already spent quota.

- **rehearsal re-run at `c456600`** (`test-results/fresh-install/2026-11-03-0032`): **PASS 17
  checks** — install with no downloads, full suite in the clone, bundles built at the clone's own
  commit (`bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`, server
  `3c7c7f2e5ac4`, web `34ee5eda1b6f` — byte-identical to the author checkout's web bundle), both
  restore drills green, live smoke refused with exit 2. The first-run line is `outbound none`, and
  §KI-74 in `docs/KNOWN_ISSUES.md` states what that line does and does not prove.
- **rehearsal re-run at `a131c5e`** (`test-results/fresh-install/2026-11-02-1531`): **PASS 17
  checks** on the child-process backup path — install, full suite, typechecks, bundles
  (server `bfb8b17afee8`, web `065ee809a766`), first run contacting `outbound none`, **both backup
  drills green through the new killed-at-deadline copy**, production browser gate, and a live run
  blocked with exit 2. The earlier rehearsal at `2026-11-02-1300` (commit `9a5b610`) is kept as the
  run that *caught* KI-56's second occurrence.
- **at `340ff79`, the third-review remediation commit**: `pnpm run verify` → Biome 0 errors
  (3 warnings, 15 infos), product typecheck clean, `pnpm run typecheck:tests` exit 0, Vitest
  **118 files / 1 507 passed / 3 skipped** (+8 tests: gate-lifecycle refusals, trace-model
  classification, malformed ledger lines, coding-record structure, copy-process lifetime). Offline
  gates re-run at that commit: `verify:batchd-playback-auth` 15 checks
  (`test-results/batchd-playback-auth/2026-11-02-1529`), `verify:media-journey-offline` 6 checks
  with 0 dispatches (`test-results/media-journey/2026-11-02-15294475`), `verify:runtime` 5 checks.
  No paid call: the live chain gate ran only unconfigured (exit 2, `status: "BLOCKED"`) and in
  boot-only mode (exit 0, `status: "PASS (boot-only, no paid call)"`).
- `pnpm run verify` as one command (lint → product typecheck → test-scope typecheck →
  Vitest): **0 lint errors** (3 warnings, 15 infos), 0 product typecheck diagnostics,
  `pnpm run typecheck:tests` exit 0, Vitest **114 files / 1 448 passed / 3 skipped**.
  The `tests/unit/backup-restore.test.ts` timeouts that earlier failed this gate are now
  explained and closed (KI-56): node:sqlite's online backup promise does not settle inside a
  full-suite Vitest worker, while it returns in 1-19 ms in plain processes even 8-way
  concurrent. The product now bounds that copy (15 s, `FORGE_BACKUP_TIMEOUT_MS`, `0` disables)
  and parks unfinished copies instead of leaving a truncated file under the backup name; the
  online API is tested in a plain child process, the way it ships. The deadline then caught
  the same stall in `tests/unit/data-at-rest.test.ts` inside a fresh clone, which is how we
  learned it was never one file; that call site and `health-alerts` moved as well. The lint counts are read from Biome's summary line, not from an output tail —
  a previous report of "0 errors" was a tail misread while HEAD had four errors.
- `pnpm verify:fresh-install`: **PASS 17 checks** at `c9c18cf`
  (`test-results/fresh-install/2026-11-02-1045/report.json`, clone bundles server
  `920c6036a536` / web `065ee809a766`), and earlier at `b698070`
  (`test-results/fresh-install/2026-11-02-0759/report.json`) and at `1d32761`
  (`…/2026-11-02-0613`). A clean clone installed with `--frozen-lockfile` with **no
  provider credential exported** ran the aggregate check and built production bundles
  naming the **clone's own commit** on a clean tree (`c9c18cfa5b4b`: server `920c6036a536…`,
  web `065ee809a766…`; at `b698070ed151`: server `50edca5dea45…`). Then the documented first run, both restore
  drills, and the production browser gate — inside the clone — and a live smoke that
  refuses instead of spending a call. The environment manifest records tool presence, not
  values; on this machine `say` is not on the PATH that probe reads, which blocks the live
  audio fixture path and nothing in the rehearsal.
- `pnpm verify:first-run`: **PASS 4 checks** (`test-results/first-run/2026-11-03-0035`,
  1 029 ms to ready, 4 336 ms walking the screens): `MODEL_PROVIDER=echo pnpm dev`,
  `http://127.0.0.1:5173` in managed Chromium, mounted app on the `echo` provider with
  `environment: development`, HTML Studio / Memory / Conversations / System each **asserted to
  render** (not merely clicked) with a clean console including `pageerror`, and no listener left on
  `8787`/`5173` afterwards. The outbound-host check now states what it measured instead of naming a
  CDN: in the author checkout it reads `every host the fresh app contacted is one the product
  allowlists (allowlisted: cdn.jsdelivr.net)` — that workspace holds a pre-KI-53 artifact for the
  Studio to preview — and in a fresh clone, which has no artifacts to preview, it reads
  `the fresh app contacted no host outside localhost at all`
  (`outbound none`, `test-results/fresh-install/2026-11-03-0032`). A clone's zero egress is **not**
  evidence that vendoring worked: there was nothing there to fetch. The evidence for that is
  `verify:runtime` booting a game that carries its engine with no remote origin granted.
- `pnpm verify:batchd-playback-auth`: PASS 15 checks — real `<video>` decode of the
  in-script H.264 clip, blob bytes hash-matched to the stored source, one credential-free
  download per source in each trust model, and the running server proving it is the
  verified clean-tree build.
- `pnpm verify:runtime`: **PASS 11 checks** (KI-53, plus the three KI-74 cross-checks: the panel's
  `blocked` origins must equal the origins the real browser refused, in both directions; a permitted
  load that the network refused is disclosed as fetched, never as blocked; and the panel names the
  carried engine and nothing else for a self-contained game). A game carrying the vendored engine boots with
  **no remote origin granted** and reaches for nothing; a self-contained game that phones home is
  blocked; a Phaser version this product does not vendor keeps its reference and is reported as a
  named gap. Then the older policy: a permitted engine load that the network refuses must name
  `https://cdn.jsdelivr.net` and must not leak the script path; a blocked host must never be
  reported as a permitted failure; and a scene that throws after its engine loads must not be
  blamed on the CDN. Each case records the policy it was verified under
  (`network_policy: vendored | cdn-allowlist`) in `test-results/runtime/<stamp>/report.json`.
- `pnpm verify:batchc-ui`: PASS 22 checks. `pnpm verify:batche-review-ui`: PASS 20 checks,
  including the one-paid-call check and the stale-selection refusal.
  `pnpm verify:studio-workflow`: 56 checks at that commit; the same gate measures **58** at
  `32300ff` and later, after the approval-rail dependency block was added to what it asserts, and
  **59** from `2774a2b` once the record's own limits were added to what it asserts (KI-83 also pins
  that count so a deleted check cannot hide behind a steady total).
- `pnpm verify:batchc-resume-staged` **cannot be re-run at this commit, and refuses rather
  than pretending**: `job already published version 2; this isolate is consumed and cannot
  be re-approved offline` (`test-results/batchc-resume-staged/2026-11-02-0758`). The gate
  approves a *retained* staging state inside a copy of a live isolate, so its fixture is
  single-use by construction. The recorded PASS stands at `2026-11-01-0824` (14 checks);
  re-running it would need a fresh consumed-but-unapproved isolate, i.e. another paid coding
  run. That was a process defect, not just an exhausted fixture: 14 checks left the standing
  suite the day after they first ran, and no free gate covered the embedded-bytes leg of the
  journey they proved (KI-62).
- `pnpm verify:media-journey-offline`: **PASS 6 checks with zero provider calls**
  (`test-results/media-journey/2026-11-02-14400103`) — the remedy for KI-62. Uploaded PNG →
  approved asset → `muse-asset://` reference → approved v1 **embeds the asset bytes** →
  restart byte-identical → modify → v2 → rollback returns byte-identical v1 **and the exact
  embedded image** (data URL sha `199fbe8655fc…`, v1 HTML sha `f72f65e92fc2…`, v2 `4ecbca956b21…`).
  Its zero-call claim is read, not asserted: `the offline journey dispatched nothing (426 bytes
  of trace read, 0 dispatch lines)`. The mode is refused if unknown, and the offline rail refuses
  to start while a provider credential is configured. The paid rail of the same journey now
  fails unless the ledger shows exactly one answered generate and one answered edit, with no
  other path and no attempt beyond 1. `tests/unit/media-journey-policy.test.ts` (13) pins both
  ledgers against real-shaped trace lines, and `verify:media-journey-offline` is a CI leg on both
  browser legs — free, headless, no credential. What it does **not** prove: that provider-returned
  bytes flow through the journey. That stays with the paid evidence named above.
- `BATCHD_SMOKE_SCOPE=both BATCHD_SMOKE_FIXTURE_ONLY=1 pnpm verify:batchd-live-smoke`:
  PASS 4 checks with no network. `pnpm verify:image-live-smoke` with
  `IMAGE_SMOKE_BOOT_ONLY=1` exits 0 without dispatching; `pnpm verify:review-live-smoke`
  without a key reports `unconfigured (need FORGE_MUSE_API_KEY; no call made)` and exits 2.
- **Research gates re-ran read-only and reproduce their preserved numbers**:
  `verify:research` (v1 5/16 and 15/16, p=6.351663e-4; v2 0/16 and 15/16,
  p=5.656481e-8; 32/32 raw output hashes, 72/72 recovered hashes), `verify:research16`,
  and `verify:research17` (lock metadata `6640e83f3c99…`, as-run analysis hash and p-values
  matching the preserved values). `eval:guard` and `evidence:phase14a` were **not** run:
  they regenerate tracked evidence files, and their committed numbers remain as recorded.

**Which gate ran at which commit.** Everything below ran at `c9c18cf`, the newest source
commit: `pnpm run verify`; `verify:batchd-playback-auth` (PASS 15, running server proving
`c9c18cfa5b4b` on a clean tree, server build `34f23e8a44df…`, web build `065ee809a766…`
unchanged — `test-results/batchd-playback-auth/2026-11-02-1040`); `verify:batche-review-ui`
(PASS 20); `verify:batchc-ui` (PASS 22); `verify:runtime` (PASS 5);
`verify:studio-workflow` (56 checks); `verify:first-run` (PASS 4 — 1 039 ms to ready,
4 861 ms walking the screens, `test-results/first-run/2026-11-02-1041`); the fixture-only and
boot-only live legs (batchd PASS 4 with **no trace log at all** — the fixtures-only path
returns before the server starts, so no ledger rule was checkable, and the report now says
so instead of printing `ledger_issues: []`; `test-results/batchd-live/2026-11-02-1039` and
`2026-11-02-1135`), image boot-only PASS, review-live refusing with exit 2); and the whole fresh-install rehearsal (PASS 17,
`test-results/fresh-install/2026-11-02-1045`). The same gates ran at `b698070` and
`f763ef9` before it (`test-results/batchd-playback-auth/2026-11-02-0804` records that
identity pair). The docs commit that records this re-ran the aggregate check (identical
counts) and the identity gate: PASS 15 with the running server proving `36a861a1dd27` on a
clean tree, server build `975f6fc62745…`, web `065ee809a766…` unchanged
(`test-results/batchd-playback-auth/2026-11-02-1105`). Recording every further docs commit
this way would recurse, so the rule for later ones is mechanical: the identity a beta cut
would carry is the `buildProvenance` block of the **newest** `test-results/batchd-playback-auth/`
directory **whose `observations.buildProvenance.supportsCommitIdentity` is `true`**. That
flag is what makes the pair mean what it says: the commit recorded in each build manifest
equals the tested commit, and the build recorded a clean working tree. A run where the flag
is false still measures the product honestly — it simply cannot anchor a release identity,
and the report now says so in words (`KI-58`). Gates not named at a commit did not run at
it; the only thing a docs commit proves about them is that the source they measured has not
moved.

**Which commit the bundle bytes came from is a separate fact from which commit was tested** (`KI-58`).
`verifyBuildProvenance` reports `commit` = the tested checkout, and proves the bundles' hashed
inputs equal that checkout's inputs. It does not, by itself, say which commit produced the bytes.
A run at `09d2258` passed with manifests naming `94d3c62` — legitimate, because the two commits
differ only in documentation and `scripts/verify-*.ts`, none of which the production build hashes
— but the report printed `commit: 09d2258…` and a reader could take that to mean the bytes were
built there. The same run printed `treeClean: false` — unqualified, which is itself a defect fixed
later by KI-84, since the field described the working tree while the gate ran rather than the tree the
bundles were built from — and in that run the working tree did carry uncommitted edits: those bundles
contained work no commit names. `describeBundleIdentity()`
now separates the facts and the gate records `bundlesBuiltAtCommit`, `bundlesBuiltFromCleanTree` and
`supportsCommitIdentity`, printing the explanation as a check line whenever it is not safe to read
the pair as release identity.

**Identity moves across documentation commits, and the rule is easy to over-read.** The
build identity (commit, source hash, build time) is baked into the server bundle, so the
server hash moves at every commit, while web bundles are content hashes over web sources —
so a web-hash change means the web sources changed. Web stayed `53bb6717…` through the
whole live-acceptance stretch, then moved to `065ee809…` at `1d32761`, which is the
expected signature of the `StudioView` key fix and not of the documentation.

## Prerequisites for reproducing the checks

- **Node ≥ 24** (`package.json` engines) and pnpm workspaces.
- **A browser for the gates**: `FORGE_RUNTIME_BROWSER=managed` (default) uses
  Playwright-managed Chromium and needs `pnpm exec playwright install chromium`;
  `chrome` uses a local Chrome install. Batch E capture needs a browser that can
  rasterise the app's `<canvas>`; Batch D's decode proof needs a Chromium with
  H.264 enabled — without it the gate fails loudly instead of downgrading to a
  route-only check.
- **ffmpeg/ffprobe** for the Batch D video fixture (generated in-script, 3 305-byte
  H.264 96×96 clip for the live harness, 2 891 bytes for the playback gate; recipes are
  recorded in the evidence directory). `BATCHD_VIDEO_MP4` / `BATCHD_SMOKE_VIDEO_MP4`
  override them; ffprobe validation still applies.
- **`/usr/bin/say` (macOS)** to build the live transcription fixture, or
  `BATCHD_SMOKE_AUDIO_WAV=/path/to.wav` to supply a recorded one. The harness probes
  what it builds (16 kHz mono `pcm_s16le`) and refuses a fixture that does not match
  its recipe. Missing tools are named as prerequisites before any credential, port or
  dispatch, and the recipe binaries follow `SAY_BIN` / `FFMPEG_BIN` / `FFPROBE_BIN` so a
  prerequisite check cannot certify a tool the run never calls. `BATCHD_SMOKE_FIXTURE_ONLY=1` runs that plumbing check with no network
  call at all; without `FORGE_MUSE_API_KEY` the live mode reports `BLOCKED before any
  provider call` and exits 2.
- **`cdn.jsdelivr.net` reachable** only for the `verify:runtime` case that exercises a document
  which still asks the CDN for its engine — an artifact approved before KI-53 closed, or a Phaser
  version outside the pin. Games produced by the current code carry the engine, and `verify:runtime`
  boots one with no remote origin granted. That gate exits 2 with the reason when the CDN is
  unreachable rather than reporting a verifier defect, and its self-contained cases run either way.
- **No provider key** for any gate listed above; the Batch C/D/E gates exit 2 if one
  is present, so a green run is also proof that no paid call happened.
- **Rehearsal refusal**: `verify:fresh-install` and `verify:first-run` refuse outright if
  `FORGE_MUSE_API_KEY`, `FORGE_FALLBACK_API_KEY` or `META_API_KEY` is exported, and record
  only whether credentials are set, never their values.
- **Free ports `8787` and `5173`** for `verify:first-run` and `verify:fresh-install`: both
  block and name the occupied port instead of failing inside the app, and neither kills a
  process it did not start.

## Release gate position

Proven against the §5 bullets: contract plus browser coverage per batch, deterministic
fixtures for CI, failure paths for auth/quota, malformed and truncated media, provider
timeouts, duplicate submissions (idempotency), stale selection, retired decisions,
broken references, and storage failure; byte-consistency of approved artifacts across
failure, restart, and rejected proposals; credentials kept out of URLs, logs, exports
and excerpts while hashes stay over raw bytes.

Still open before a beta cut, none of which is a code question I should answer alone:

1. **Live results: recorded, with two chains still unexercised.** Image generate
   and edit, voice transcription, video clip observation and one scored screenshot
   review now have live evidence, each from a harness that fixes the call budget
   and scores the provider's answer against content this repository controls.
   Still unexercised end to end: a **live image asset inside a generated artifact**
   (`verify:media-live-smoke`, run and closed on 2026-11-02 at `711de72`) and a live
   review of a **Muse-built** app, where no automatic score is possible. Everything
   else in the multimodal list is no longer "configured but unverified".
2. **Fresh-install rehearsal: done here, not elsewhere.** `pnpm verify:fresh-install`
   rehearses the clean-clone path and passed 17 checks at `1d32761`, with the prerequisites
   and the environment manifest written down in `docs/Fresh-Install-Rehearsal.md`. What it
   does **not** cover: any platform other than this `darwin arm64` machine, a cold package
   cache or restricted network, upgrade paths (existing database, stale `dist/`, leftover
   `node_modules`), or an installer — the repository ships none, so "fresh install" means
   "clean clone plus `pnpm install`", which is what the README documents.
3. **Independent review of the newest commits.** A read-only review of
   `4aa1282`, `7cf3e63`, `5bed18b` and `8148cf0` was carried out by a separate agent
   (verdict: ship-with-fixes); its findings are addressed in `e0cd2eb` and `8250b44`.
   Nothing since — the test-scope typecheck work, the live harnesses for image,
   voice, clip and review, the WebP dimension fix, and the call-accounting fixes —
   has been reviewed by anyone but the author. Coordinator reviews of earlier Batch E
   commits do not extend to any of it.
4. **A release decision.** `main` still points at the known-working candidate. There
   is no tag, no beta branch, and no merge from this line; nothing here publishes
   anything.

## Corrections made after independent review

An independent read-only review of the four commits that added idempotency,
failure coverage, this status file and the voice/video live harness is the antecedent for
everything below.

The review found claims in this file and in the harness that were stronger than the
evidence. Each was fixed rather than reworded:

- **The voice/video live harness could not reach a provider call.** It read
  `listener.address()` immediately after `listen(0, …)`; the address is null until the
  socket is bound, so the run failed at port reservation. Reservation is now awaited,
  exported, and covered by a test that reserves a port, binds a server to that exact
  port, and observes readiness. A run that never reaches a dispatch no longer gets to
  describe itself as "blocked by credentials".
- **A missing local tool was reported as a failure, not a blocker.** Without `say`,
  ffmpeg or ffprobe the harness died inside the fixture recipe. It now lists the
  missing prerequisites and exits before any credential, port or dispatch; the
  fixture-only check went from 2 to 4 assertions.
- **Dispatch accounting could not say which call spent what.** Trace lines were matched
  by path, but `/v1/responses` is shared by clip observation, vision and coding, so a
  coding call inside a clip step would have passed as the clip's own dispatch. Each
  operation now owns a slice of the trace.
- **A reused Idempotency-Key could replay the wrong answer.** The route re-validated
  the pinned decisions, but a valid key sent with a different frame, a different
  decision at a different revision, or a different generation returned the stored
  feedback unchanged. A replay is now checked against the subject it claims to answer,
  and a mismatch is `idempotency_key_reused`.
- **A paid-for answer could be lost by a bookkeeping write.** A throw from
  `IdempotencyStore.record()` escaped after the provider had answered: the client got
  an internal error and the evidence went to the log. The write is now non-fatal.
- **`AppDependencies.idempotency` did nothing.** The option was neither declared nor
  read, so a supplied store was silently discarded; a failing store could not be
  observed at all.
- **A quota refusal looked like a bad request.** HTTP 429 mapped to `invalid_request`,
  which would have told the operator to fix a correct request; the exact
  "Subscription quota exhausted" error this project already hit would have read that
  way. It maps to `provider_auth_failed`, still terminal under zero retries.
- **The clip prompt did not name the clip.** The prompt asked generically while the
  recipe renders a red frame with a green square crossing it, so an empty observation
  was ambiguous. The prompt and the recipe are now checked against each other.
- **The contract understated which models were configured.** `/api/meta` already sent
  `transcribe_model` and `video_model`, but `ServiceMetaSchema` did not declare them,
  so typed clients could not see them and validation stripped them. They are in the
  contract now, and the live harness refuses to run against a server that cannot name
  all five media models.

### The second review: `d69b798..549dc93`, verdict needs-work

`codex/gpt-6.1-sol` at `xhigh` reviewed the live-acceptance and fresh-install chain in a
detached clean checkout with the evidence copied in. No P1; one P2; six gate-accounting
findings. Every one reproduced against the code as shipped, and all are fixed in `b698070`:

- **the advisory route wrote.** `POST …/visual-review` and `GET …/generations` opened with
  `ensureProject()`, which creates `state.json`, while promising to change nothing. The suite
  seeded its own Forge state in `beforeEach`, so there was never a cold project to observe.
  See `KI-54`.
- **`countModelAttempts()` could report two paid dispatches as one**, because it counted
  distinct attempt numbers while attempt numbering restarts per operation. The zero-retry
  budget rested on that function. See `KI-55`.
- **a failed live run erased its own ledger**: `calls` were assigned on the success path only,
  so a measured failure printed `calls.* = 0` and an empty ledger while the server log held
  the dispatches. Counts now come from the trace on every exit path.
- **forbidden paths were attributed to real capabilities**: both harnesses billed
  `/v1/responses` to `calls.coding` (the image run copied that into `calls.vision`) while
  asserting that path was never used. Forbidden paths now go to `calls.otherPaidPaths`, which
  is what the budget assertion reads.
- **the clip budget was asserted against the wrong number** (`provider_attempts`, which
  includes the file upload) and against a whole-run model count rather than an
  operation-scoped slice.
- **the credential-leak check searched the log's filename for the API key**, so it could never
  have matched. It reads the log body now.
- **the first-run gate asserted clicks, not screens**: 800 ms after a nav click, a screen that
  threw in its own effects counted as visited; an unwrapped `/api/meta` body was accepted; the
  environment was never asserted, so a production build — exactly the build where the KI-52
  React warning is absent — would have passed as "the README's first run". Readiness is now
  asserted per screen (active nav marked `aria-current`, a heading under `<main>`, and the
  named `Development` panel for HTML Studio, whose heading is the artifact title: measured
  `["Farmyard Memory Match"]`, with no heading at all before the first click). `pageerror` is
  captured apart from `console.error`; startup time and walkthrough time are reported apart.

One figure in that review needs correcting against the recorded evidence: it counted the
retained review run's `provider_attempts: 2` as a second paid call. That run paid **one**
dispatch (one `callDispatch`/`callOutcome` pair on `/v1/responses`); the second attempt is the
replay, which cost nothing and returned the byte-identical answer with
`idempotent-replayed: 1`. `calls.review` and `calls.vision` in that report are two names for
the same single dispatch, as `observations.paths` shows — a naming wart in the harness, not a
second charge. Renaming those fields would rewrite retained live evidence, so they are left as
recorded and stated here.

**A follow-up review of the fixes themselves: `549dc93..f79dfb7`.** Same reviewer
(`codex/gpt-6.1-sol`, medium effort), read-only in its own clean checkout with the
evidence copied in. Verdict: **needs-work** — no P1; it confirmed KI-54, the
duplicate-attempt counter, failure-path ledger retention, clip accounting and the
credential-log check as genuinely closed (it restored the removed `ensureProject()`
calls in a scratch copy and watched the three new regression tests fail), and it found
four things the fix pass had itself got wrong. All four are fixed in the commit that
records this paragraph:

- **the forbidden-path count was computed and never enforced.** `calls.otherPaidPaths`
  was reported, and the whole-run check only named the paths it had thought to forbid —
  so an image run that also dispatched `/v1/files` passed while printing "touched only
  image paths", and an audio run with an extra image call passed while claiming every
  call was accounted for. Each live scope now has an allowlist, and the inverse rule is
  asserted: every path in the ledger must be on it (`pathsOutside` in
  `scripts/lib/media-trace.ts`, with `imageLedgerIssues`, `batchdLedgerIssues` and
  `reviewLedgerIssues` beside the code that uses them; `tests/unit/live-ledger-policies.test.ts`
  reproduces both reported cases with synthetic traces).
- **an incomplete ledger could satisfy an exact-call claim.** One start line with no
  outcome (the transport died mid-call, so the number of paid calls is unknown) and an
  outcome answering nothing both passed a bare "exactly one dispatch" check. A ledger
  with unanswered starts or orphan outcomes is now refused, and the retry rule moved
  into the same check.
- **the new grounding rule could fail a correct answer.** A denial word anywhere in the
  evidence was read as "the model says the timer is absent", so
  *"A countdown timer is visible despite the instruction not to show one"* — a correct
  reading of the fixture — scored as a model failure. Denial is now an absence
  construction about the countdown/timer within one clause of it; ambiguous negation is
  left to the human reader, and that sentence is pinned by a test.
- **origin-only diagnostics did not cover a URL inside the *reason*.** The request URL
  was reduced to its origin, but the browser's reason text was only redacted and
  truncated, so `net::ERR_FAILED https://host/path?query=…` echoed the path and query.
  URLs in the reason are reduced to origins before bounding; the test uses a URL short
  enough to survive truncation, so truncation gets no credit.

Two smaller honesties from the same review: `walkthroughMs` had included the shutdown
wait (it now measures the walkthrough only, and a test asserts the split), and this
file's test counts for two Batch E suites had gone stale (25 and 8, not 22 and 6).

**Then I reviewed those fixes myself: `f79dfb7..` the commit that records this.** Four
defects, all of them in the fixes rather than in the code they were fixing, each
reproduced without a provider call (KI-55 items 13-16):

- **the grounding rule was still too broad.** It required an absence construction *about*
  the countdown, which fixed the reviewer's sentence and left the class open: "despite the
  instruction **not to show** a **timer**" and "**told not to display** a countdown, and one
  appears" both read as denials. Since the probe's decisions literally say "Never show a
  countdown timer in the game UI.", a correct model answer is *likely* to echo them, and the
  harness would have burned a paid call reporting a correct answer as a model failure.
  Denial is now judged clause by clause, directive language suppresses it, and a clause where
  the readings collide is reported as ambiguous
  (`evidence_negation_quotes_decision`) instead of scored either way. The first narrowing
  attempt also went the other way, swallowing "the frame contains no timer, so the decision
  is honoured" — thirteen probe sentences pin **both** directions.
- **the most expensive paid gate had no budget.** The path/integrity rule was copied gate by
  gate and Batch C — the gate that spends coding calls — was missed. `scripts/lib/batchc-scope.ts`
  plus `assertPaidCallBudget()` now bound it, respecting the two facts that make it not a
  copy: vision and SAM share `/v1/responses` (so the counts must match the model on each
  start line), and coding runs through the Muse CLI, which never writes a media-trace line
  (so an extra media path is an extra media *media* call, never the coding job). The scope
  budgets match the retained runs: `vision-only` 1+0, `resume` 0+1, `resume-cutout` 0+0,
  `full` 1+1.
- **a ledger claim rested on a log that did not exist.** The fixtures-only Batch D run
  printed `ledger_issues: []`, `dispatch_ledger: []` and `unanswered_dispatches: 0` with **no
  `server.log` in its evidence**: that path returns before the server starts, and
  `readMediaTrace` turns a missing file into an empty trace. `ledgerEvidence()` now records
  log presence and byte size, and a run with no log reports `ledger_issues: null` plus a note.
  The previous paragraph's own wording ("PASS 4 with an empty ledger") was that overclaim in
  print, and is corrected above rather than left standing.
- **the new policies were tested against traces the product does not write.** My synthetic
  outcome lines carried paths and models; every retained paid log writes
  `outcome=response attempt=1 status=200 bytes=…` with neither. A rule matching needles
  against outcome lines would have called every real run's ledger incomplete — a false alarm
  the next live acceptance would pay for twice. The retained lines are now transcribed
  verbatim into `tests/unit/live-ledger-policies.test.ts` (six real logs: the 0106 and 0755
  Batch C runs, the 0400 and 0458 Batch D runs, the 0451 review and the 0445 image run) and
  every policy must find **no** violation in them. Same failure shape as KI-51, one layer up:
  a fixture that matches the parser instead of the format.

The four policies were then run against the real retained logs as a check, not just as test
literals: clip, audio, review and image all come back with no path outside scope and no
integrity issue, so the tightened rules do not invent violations on ledgers that were paid
for.

**Scope limit of the first review**: it covered `d69b798..549dc93`. The KI-53 runtime fix (`55204f5`) and
these corrections (`b698070`) have not been reviewed by anyone but the author. The review ran
in its own checkout, so its server bundle hash for the same commit differs (`ad6f9dfb…` against
the author's `c9d6c613…`) because the manifest carries build-time metadata; the web hash
matched byte for byte.

### After the review: the items it left actionable, and what they turned out to be

The six findings were fixed and committed. Checking the review's *claims* rather than only its
list turned up four more, all closed:

- **`KI-69` — the three offline browser gates could not say how they ended.** Batch C's
  `summary.json` had no status field at all, Batch D's report (the one this document cites for
  release identity) recorded `status: "live browser results"`, and a missing Chromium exited 1
  with a stack like a product defect. The review's own count — `verify:batchc-ui` at **21** checks
  where the script has 22 call sites at every commit in the range — could be neither confirmed nor
  refuted from evidence. `scripts/lib/gate-outcome.ts` now classifies an ended run (blocked →
  exit 2, failed → exit 1, pass → 0) and every gate writes that classification into its evidence.
  Measured both ways: an exported provider key produces
  `BLOCKED before measuring anything: paid provider keys are set in the environment…` with exit 2
  and `summary.json` at `ok: false`, `completed_checks: 0`; the same gate without keys produces
  `PASS: 22 checks` with `ok: true`, `status: "PASS"`, `completed_checks: 22`.
- **`KI-70` — capability probes paid for models the ledger could not name.** The `transcribe`
  probe posts multipart with `model` inside the `request` part, so its trace line read
  `model=(none)`: quota spent, model unknown. Every probe now states `traceModel`. Pinned with a
  real adapter and a scripted fetch.
- **`KI-70` — the ledger-damage parser fix shipped with no test.** Seven tests now pin it,
  including the review's own probe (one answered call plus two unreadable `[media-trace]` lines)
  and the case where unmarked server output must *not* be counted as damage.
- **A suite run whose failure name I did not capture.** The first full run after these changes
  reported `1 failed | 1521 passed`; my grep pattern omitted `FAIL`, so the failing test never
  appeared in the output. Four subsequent full runs (one through `pnpm run verify`, three direct)
  were green: **120 files / 1 522 passed / 3 skipped**. The failure is recorded as unreproduced
  rather than dismissed — and the harness lesson is the one `KI-57` already taught: a gate's
  output has to name what failed, even when the person reading it is me.

### The third review: `f79dfb7..d00d4d2`, verdict needs-work

A fresh `codex/gpt-6.1-sol` session at medium effort reviewed the KI-56 backup work, the ledger
enforcement, and the live-chain gate, and ran its own probes. Every gate it could run passed
(`verify:runtime` 5, `verify:batchc-ui` 21, `verify:batche-review-ui` 20, `pnpm verify`
117 files / 1 483 tests), and it confirmed the live chain evidence at
`test-results/media-live/2026-11-02T13-53-08` is internally honest: 21 checks, two answered media
dispatches on the only two allowed paths, three coding jobs whose internal calls total 14 against
a cap of 15, zero transport retries. The findings were about what happens when those gates
**fail**:

1. **P1 — the live chain gate could pay for calls and then report its own failure as success**
   (`KI-63`). An early refusal exited 0 with an empty check list; a mid-run failure could write
   `status: "PASS"` with `checks: []`, no `failure_reason`, and possibly no `FAILED.md`, because
   teardown wrote the report in a `finally` before the outcome was captured. Fixed by separating
   journey, outcome capture, and report writing, and verified: unconfigured → `BLOCKED` and exit
   2; boot-only → `PASS (boot-only, no paid call)` and exit 0 with `logBytes: 26` and
   `ledger_issues: []`. Boot-only mode had a second defect: it asserted zero dispatches against a
   budget of two, and treated a missing trace log as a clean empty ledger.
2. **P2 — the KI-56 deadline bounded the promise, not the copy** (`KI-56` follow-up).
   `node:sqlite` has no abort path, so after the timer fired the copy kept running in-process with
   its handle on the parked partial — the exact situation the parking rule exists for. The copy
   now runs in a child that is killed at the deadline, and the test asserts the child process list
   is empty afterwards rather than inferring it from a rejected promise.
3. **P2 — a complete, answered, unbudgeted paid dispatch passed the Batch C budget check**
   (`KI-64`). `model=unbudgeted-paid-model` on the one allowed path was classified by neither
   substring category, so three dispatches against a two-call budget reported nothing. Model ids
   are now taken from `/api/meta` and matched exactly; an unclassified dispatch (including
   `model=(none)`) is a violation, and a run that never read its configured ids may not claim
   exact call counts.
4. **P2 — malformed lines inside `[media-trace]` were discarded as if absent** (`KI-65`).
   Garbage under the marker reported the same issues as no line at all. Such lines are now retained
   as `malformed` entries and counted by ledger integrity, while unmarked server output is still
   ignored.
5. **P3 — the coding-job account accepted impossible structure** (`KI-66`). Two generations plus
   one modification satisfied an expectation of one generation and two modifications;
   `usage: { calls: -2 }` and `1.5` were usable counts; a job file holding JSON `null` crashed the
   harness. Kinds are compared as a multiset, call counts must be finite non-negative integers, and
   non-object records become invalid records that count as unknown cost.
6. **P3 — transcription still paid for a model the ledger could not name** (`KI-67`). The KI-61
   fix covered the image edit path only; `/v1/asr/transcribe` carries its model inside a multipart
   part and was still traced as `model=(none)`. The claim in `docs/KNOWN_ISSUES.md` that KI-61 had
   closed the problem was overstated and is now scoped to what the code does.

The review also caught drift **in this file**: a release pair quoted from two commits back
(`2026-11-02-1226` at `398e124`), a provenance field the report never emits
(`supports_commit_identity`, actually `supportsCommitIdentity`), a rehearsal record attributed to
`c9c18cf` when the newest rehearsal ran at `9a5b610`, and an assertion that production content had
not changed. All corrected: the newest pair is
`test-results/batchd-playback-auth/2026-11-02-1445` at `9ffa49d5efd4`, and the rehearsal row cites
`test-results/fresh-install/2026-11-02-1300` while keeping the `1245`/`1248` pair as belonging to
`c9c18cf`.

### The fourth review: `d00d4d2..4035c2f`, verdict needs-work

A fresh `codex/gpt-6.1-sol` session at medium effort, read-only inside a prepared snapshot
(`/tmp/review-4035c2f`, same commit, dependencies installed, bundles built there, retained
`test-results/` copied). It was pointed at the two most recent product decisions — KI-53's engine
vendoring and KI-74's dependency disclosure — and told to attack the invariants those decisions
claim rather than the tests written for them. Every gate it ran passed (`pnpm verify` 126 files /
1 587 tests, `verify:runtime` 11, `verify:studio-workflow` 58, `verify:batchc-ui` 22,
`verify:batche-review-ui` 20, `verify:batchd-playback-auth` 15, `verify:media-journey-offline` 6),
and it noted that the snapshot's server bundle hash differs from the author checkout's for the same
commit because build manifests carry build-time metadata — the web bundle was byte-identical, so
that is build noise, not source drift.

Seven findings, all reproduced in the live checkout before being fixed, all with a mutation test:

| Finding | What the mutation measured | Fix |
| --- | --- | --- |
| KI-76 (P1) | a staged document writing the product's own vendor delimiters: 162 shipped bytes, 30-byte review view, payload executed | delimiters are a format only this product writes: `unvendorScripts` collapses exactly the span `vendorScripts` produces, and `vendorMarkerTextIssues` refuses marker text in staged source |
| KI-77 (P1) | `<script src="…"></SCRIPT>` read as a script *with a body*: the engine was swapped and the author's closing text left behind | script bodies are not re-scanned for markup, closing tags match case-insensitively, and a tag with attributes or a body is left as written and named |
| KI-77 (P2) | an engine tag carrying `onload` was vendored **and** the handler deleted | vendoring applies only where it provably preserves the document; both refused forms were run in Chromium and still load and render |
| KI-77/78 (P2) | an unquoted `src=` was invisible to the policy scan, the gap list and the disclosure, so the preview served a script that could not load | one parsing module answers "what do these bytes reference" for the browser, the preview CSP and the panel, quoted or not |
| KI-79 (P2) | the preview CSP granted `https://cdn.jsdelivr.net` to **every** document, including a self-contained game and one reaching for an unapproved host | the grant is derived from the references the served bytes carry; a non-allowlisted reference grants nothing anywhere |
| KI-80 (P2) | a reference the product refused to vendor disappeared from `x-forge-vendor-gaps`, so "no gaps" meant "the swap failed quietly" | gaps come from the document references that survive, and `verify:runtime` asserts the gap list, the runtime report and the disclosure row agree |
| KI-78 (P2) | a URL inside a **comment** was disclosed as a request the policy refused — measured in Chromium, that document performs no requests at all; and an empty list read as "fetches nothing outside themselves", while a URL built at run time (`const h="https://…"; fetch(h+"/collect")`) produced exactly that empty list | rows carry `basis` (`document_reference` vs `code_text`) and `observed` (was a refusal actually recorded against these bytes), and every record carries `scan_limits`, rendered always |
| KI-81 (P2) | the offline journey's "the journey dispatched nothing" was claimed about a log the gate could not read (one orphan outcome line, one truncated `attempt=`) | ledger damage is checked before any mode-specific claim |
| KI-82 (P3) | `attempt=1broken` counted as attempt 1 and `status=200garbage` completed a paid dispatch | every `[media-trace]` token is validated whole against the format the adapter writes |

Two of these were not bugs in the usual sense but implicit decisions: the source view collapsed
text between markers, and a scan that finds nothing printed an empty list. Both turned a
*representation* into an *assurance*, which is what D062 now rules on. The review also found a typo
**in this file**: `d5f219fbf414…` where the report says `d5f219fbf41d…` — corrected above, and the
kind of drift KI-68 was about.

Fixed in `2774a2b`. No provider call was made: every gate used the fixture CLI, and no paid gate was
re-run. `verify:runtime` grew from 11 to **14** checks, the three new ones measuring the tag forms
that cannot be swapped, the uppercase closing tag, and a forged marker — each against a real browser
rather than a parser assertion.

Remediating it found one more defect, in the harness rather than the product (KI-83): editing the
Studio gate for KI-78 deleted a `check(...)` call, the headline count did not move because a new
assertion had just been added, and the run still said PASS. The claim that vanished is one the release
documents quote by name. `scripts/lib/gate-check-count.ts` now pins both a floor and the named claims
for any gate whose headline is a count, and the guard was verified by deleting a check again and
watching the gate refuse.

## Self-review of the fix passes, in a new session

The newest commits (`c9c18cf`, `36a861a`, `1bf4a82`) were unreviewed, so the author reviewed
them in a fresh session with the delta reviewer's rules. Four defects found, all fixed in
`94d3c62` and recorded as `KI-55` items 13-16:

- **The grounding rule was still wrong** after the last fix. Any "not … near countdown" was
  read as the model denying the frame, which fails a correct answer that quotes the decision
  ("despite the instruction **not** to show a timer"). Clause-by-clause rules plus suppression
  for decision language now decide that case **ambiguous** and report
  `evidence_negation_quotes_decision`, while plain denials still fail. Cost if left: a false
  negative about a model that cost quota, and a probe too twitchy to re-run.
- **Batch C had no whole-run budget** — vision and SAM share `/v1/responses`, so a stray
  dispatch was invisible. `batchcExpectedCalls` / `batchcLedgerIssues` now gate by scope
  (`full` 1+1, `vision-only` 1+0, `resume` 0+1, `resume-cutout` 0+0) before a PASS is printed.
- **A missing trace log read as a clean empty ledger.** Fixture-only Batch D reported
  `ledger_issues: []` over a file that was never written. `ledgerEvidence()` now names the log
  and its byte count, and the report keeps the issue list `null` when nothing was read.
- **The new rules were tested against lines the product never writes.** Synthetic outcome lines
  carried path and model; real ones are `[media-trace] outcome=response attempt=1 …`. Six
  verbatim real logs (0106, 0755, 0400, 0458, 0451, 0445) are now test inputs, and every policy
  must find no violation in ledgers that were paid for.

**A fifth defect found while proving the fourth** (`KI-57`, fixed in the same commit
that adds this section): `verify:image-live-smoke` and `verify:review-live-smoke` printed **no reason** when
their own assertions failed. The catch printed only unexpected errors, and every `fail()` raises
the expected type, so a paid gate could exit 1 in silence — the condition that makes an operator
re-run a run that already spent quota. Reasons now print as `FAILED before completion: …`;
designed refusals (exit 2, no credential) stay unchanged.

**Method warning from this pass.** The first mutation used trace lines without the
`[media-trace]` prefix. The parser ignores such lines, the gate passed, and the fix looked
unbreakable. Ledger mutations must use the documented line shape, or they test the parser's
filter instead of the assertion.

## What rehearsing the first run changed

`pnpm verify:fresh-install` (release gate §5 item 7) passed with 17 checks at `1d32761`,
and `docs/Fresh-Install-Rehearsal.md` records the steps, the environment manifest and the
limits. Two findings:

- **KI-52, fixed here.** Three sibling Studio panels each carried `key={projectId}`, so
  development React logged "Encountered two children with the same key" on every mount.
  Production React strips those warnings, so the four production-bundle gates and CI's
  browser legs were silent about a defect a newcomer sees on the first screen — and
  duplicate sibling keys are the same class of bug Batch D fixed for playback state:
  mis-keyed siblings make one element's state attributed to another. Keys are now prefixed
  per panel, and `pnpm verify:first-run` (documented dev start → open `:5173` → walk the
  documented screens → fail on any console error) runs on both CI browser legs, because
  dev-mode React is a surface those gates structurally cannot see.
- **KI-75, found by accident and closed.** The vendoring round documented `pnpm run vendor:phaser`
  in six places and never added the script, and described `--check` as proof that the CDN still
  serves the pinned bytes when that mode fetches nothing. `package.json` gained the script, the
  script gained the mode the documents implied (`-- --against-remote`, measured: the pinned URL still
  serves 1 181 917 bytes at sha256 `62081f6a…`), and `tests/unit/release-command-inventory.test.ts`
  now forbids release documents from naming scripts or gate files that do not exist — verified
  against the defect itself, since removing the script makes two of its four tests fail.
- **KI-74 closed by the approval rail, not by tightening the policy.** Vendoring is still
  deliberately narrow, so a document can still keep a remote engine reference: a Phaser version
  outside the pin, a tag with `defer`/`integrity`/`async`/`crossorigin` or a script body, or an
  artifact approved before the change. What changed is that a person who can act on that now sees it
  in the rail where they approve: a **Dependencies** block classifies every dependency as
  `bundled` (the product's pinned copy, with its sha256, sits in these bytes), `fetched` (these bytes
  ask a remote host, and the policy permits that host) or `blocked` (these bytes reach for a host the
  policy refuses, so the check that passed never saw that dependency). Since the fourth review, the
  block also says **how** each row was found — a reference the document actually carries versus text
  that merely resembles a request, measured in a browser to perform no request at all — and whether a
  refusal was **observed** during verification or only implied by the policy. Every record states what
  the reading cannot see (KI-78), and the rail renders those limits even for a record written before
  the field existed, so an empty list never reads as a guarantee. It is measured from the staged bytes after the vendoring pass — the same bytes the
  preview, validation, the browser check and promotion read, and whose sha256 the record carries —
  never from the source view the diff renders and never from model claims. A version approved before
  the field existed says **no dependency record was kept**; nothing reconstructs one, and no historical
  artifact was rewritten to make the panel look complete. Measured at `2774a2b`: `verify:runtime`
  **14** checks (`test-results/runtime/20261103-0658`) including the cross-check against what the real
  browser refused, and `verify:studio-workflow` 58 checks with
  `test-results/studio-after/dependency-disclosure-{staged,approved}.png`; the superseded measurement
  at `32300ff` (`verify:runtime` 11, `test-results/runtime/20261103-0532`) is kept rather than edited. The policy itself is
  unchanged (a document that references nothing still runs under the CDN grant, and the block says so
  in those words rather than implying a fetch), the block renders no verdict, and the engine pin is
  refreshed only by a deliberate human act (D061): `-- --check` is offline verification of the
  committed copy, `-- --against-remote` compares bytes and writes nothing either way. Concretely
  visible, and still true: the author checkout's first run contacts `cdn.jsdelivr.net` because
  `workspaces/forge/forge-demo/` holds the 2026-10-31 Spark baseline (`79c9d67a…`) with its CDN tag —
  which the rail now shows as a fetched dependency — while a fresh clone contacts nothing at all.
- **KI-53 closed — the product now carries its own game engine** (decision D059: a self-contained
  artifact is more reproducible, and less dependent on a third party's availability, than 1.18 MB
  saved is worth). Phaser 3.80.1 is pinned by URL, byte length and sha256 in a generated module that
  includes the MIT licence; `pnpm run vendor:phaser` re-fetches it and refuses to write if the hash
  or length moved; `-- --check` verifies the committed copy offline and `-- --against-remote` asks
  the pinned URL whether it still serves those bytes (measured 2026-11-03: it does, and the
  committed copy matches). A
  stored document keeps the one `<script src=…>` tag the model wrote and the engine is inlined at the
  moment bytes are handed to something that runs them — preview, diff, validation, runtime
  verification, promotion — so a modification is seeded from the short source view and never from
  1.18 MB of base64. Runtime verification and the preview CSP pick their network policy per document:
  self-contained means no remote origin at all, and an unvendored Phaser version is reported as a
  named gap rather than silently swapped. What is deliberately **not** rewritten: artifacts approved
  before the change keep their CDN reference, and the frozen research fixtures keep their prompts
  (the Phase 16/17 protocol bytes depend on prompt and artifact hashes, so those prompts were copied
  to separate `.phase15a` fixtures rather than regenerated). Cost measured here, on a machine where
  the CDN answers and is cached: a full runtime verification takes 1.6–2.0 s either way, so the
  inlined engine is within ~0.2 s of the fetch it replaces, and each game artifact grows ~1.18 MB —
  the staged-HTML ceiling went from 1.5 MB to 4 MB to keep room for the game code itself.

## What running against live providers changed

Live acceptance was requested for image, voice and review. It found four defects,
all in this repository, and one of them was a defect in a shipped product path:

- **The product mis-measured the images the live model returns.** `muse-image-1.0`
  returns a VP8X WebP; `parseWebpDimensions()` read the canvas size from the wrong
  offsets, so a 1600×1600 frame was stored in its own manifest as **1×1600**. The
  measurement gate caught it only because it decoded the stored bytes with a real
  browser and compared. Fixed in `apps/server/src/media/assets.ts`, with two
  spec-shaped VP8X fixtures. The old fixture was `RIFF…WEBPVP8X` plus nothing,
  which is exactly the shape the buggy offsets happened to read as 1×1.
- **The clip's answer was cut off by its own token budget, and the failure said
  nothing.** The terminal response was `incomplete` with `reason=max_output_tokens`;
  the gate could only report "no observations were returned". The budget is now
  derived from the response contract itself (8 observations × 500 characters ⇒
  2,224 output tokens) and an incomplete answer reports the reason and the token
  count. The paid call that was truncated keeps its evidence.
- **`provider_attempts` is not a model-call count.** For a clip it is 2: one file
  upload plus one model call. A successful live run was reported as a failure
  because the gate read that field as "model calls". Call accounting now reads
  the transport trace, separates `/v1/files` from `/v1/responses`, and asserts
  the route's count against the observed dispatches.
- **A harness can destroy the evidence it paid for.** The first paid image run
  deleted its isolate before measuring, because the gate guessed the asset path
  instead of deriving it from `MediaAssetStore`. Asset paths now come from a
  helper pinned to the real store by test, and a failed live run copies the
  isolate's `media/` and `media-jobs/` into the evidence directory before
  cleanup.
- **A gate reported the wrong health.** `pnpm run lint` was failing at HEAD with
  four errors, and the last two status entries said it reported 0. The reports
  were read from the tail of the output rather than from the count line; counts
  are now taken explicitly (`--reporter=summary`).

The first run of each live harness also failed on plumbing rather than on the
provider — an empty `ACCESS_TOKEN` string, an unreserved port, a health probe
pointed at the wrong port, a browser evaluation killed by the test runner's
`__name` helper, and PNG-only measurement of WebP bytes. All of those are fixed
and unit-tested where they are library behaviour.

## Known limits to keep honest

- **Review labels are records, not causes.** A generation is `Received previous
  decision` or `Potentially affected`; nothing in Batch E claims the model was
  influenced. The limits travel inside the payload.
- **A screenshot is one frame.** Review cannot speak to behaviour over time, input
  handling, or anything off-screen, and `confidence` is the model's self-report.
- **Canvas-less apps cannot be captured**, so review is unavailable there rather than
  guessing from the DOM.
- **Generations created before Batch E have no stored reference**, so they read as
  `unknown`, never as "was given nothing".
- **Reopening the same project keeps earlier review feedback on screen** as history;
  switching projects clears it. The stale-refusal and one-call-per-question rules
  still apply on every attempt.
- **The test-scope typecheck is now a gate, with a stated boundary.**
  `pnpm run typecheck:tests` covers `tests/**` and `scripts/**` and CI runs it. The
  protocol-locked Phase 16/17 scripts stay outside it: their own bytes are hashed by
  the research evidence chain, so a type-only edit would break the chain. The one
  whose math a test exercises (`verify-phase17-strict`) now has that math in
  `tests/research/phase17-math.ts`, and a test compares the two copies text by text
  so the locked script and the tested helper cannot disagree. KI-50 records the
  measured path and the reasoning.

## Handing the judgement questions to a person

The capability gaps are closed; the remaining release questions are judgement, and the honest
answer is that no gate can settle them. So the repository gained a producer of review material
rather than another score: `pnpm run review:app` (`scripts/build-review-app.ts`) builds one real
app through the product's own path and writes a packet for a human to fill in.

- **One app, one job, stated cost.** `docs/review-apps/palette-bench-brief.md` went in as the
  prompt; `docs/review-apps/palette-bench-decisions.json` seeded four project decisions at pinned
  revisions that the brief never mentions, so the app had to infer them from the project. One
  `generate` job under an Idempotency-Key, capped at 12 internal calls, ended `succeeded` with
  **3** calls, model `muse-wonder-1.0`, and the media ledger recorded **zero** provider media
  calls. Paid basis in the packet: the logged-in coding CLI, because no `FORGE_MUSE_API_KEY` was
  set and the run said so instead of guessing.
- **The artifact is real bytes with a real hash.** v1, 19,409 bytes, 464 lines, sha256
  `b306418d95dbed9582d9709470fb5c9298f5eacb116aa8c9b38a371efba50dde`, 7 interactive controls, 491
  characters of visible text, 492 distinct colours, 0 console errors, 0 failed requests, and zero
  external URL references in the saved HTML — the self-containment the brief asked for, proven
  against the bytes rather than asserted.
- **The app is captured in a used state, and the measurement is separate from the
  verdict.** `REVIEW_APP_STEPS` drives the app (type a seed, press Generate, press
  Export) and every step taken is written into the capture labels. For Palette Bench
  that produced measurable facts without a score: 64 text elements measured against a
  flat background with **0** below 4.5:1 (worst 6.70:1), **0** native dialogs raised,
  inline status text as the reporting channel, 17 named controls of which 5 are
  icon-only, and the export area holding all five generated hexes after Export.
  Getting there took three harness defects that a reader would never have seen:
  `page.evaluate` through TypeScript dies on `__name`, the same code in a plain
  template literal silently loses its regex backslashes and reports `0 measured` as
  though it had looked, and a failed capture left the browser connected so the run
  died on an external timeout with no verdict. KI-73.
- **The sheet is blank on purpose.** `review-packet.md` carries one row per quality dimension
  (`REVIEW_DIMENSIONS` in `scripts/lib/review-packet.ts` — the document names no count so it cannot
  drift from the code) and one row per pinned decision, and refuses to carry any score of ours. The only machine contribution is
  `evidence quality`, which exists to stop a person judging from a capture that cannot support it.
- **A mis-measured packet is corrected without paying again.**
  `REVIEW_APP_REMEASURE_DIR=<packet> pnpm run review:app` re-measures retained bytes for zero
  provider calls, refuses if the bytes no longer match the hash the original report recorded, and
  writes a new directory rather than editing the old packet.

**The first human round came back: REVIEW PENDING, not accepted.** The assessment read the packet as
well-formed but unusable for the current candidate: five quality rows and four decision rows blank,
the interactive rows written as instructions, the tested build predating the candidate — and the
provenance looked self-contradictory. Three of those four readings are the packet working as designed
(the blanks and the instructions are for a person, and a harness that filled them in would be scoring
the app). The fourth was a defect in my fields, and the reviewer was right to stop on it: `treeClean`
and `bundlesBuiltFromCleanTree` sit adjacent and neither says which instant it describes. KI-84.

**Does the current candidate contain what was tested — measured, not assumed.** The packet's build is
`94867e5`, and `git merge-base --is-ancestor` says it is an ancestor of `43127ec` (18 commits between),
as are `f8d8874` (the control/field split the packet used), `32300ff` and `4035c2f`. So the current
candidate contains everything that round tested, plus three commits that move hashed product inputs:
`3189df9` (engine vendoring), `32300ff` (dependency disclosure), `2774a2b` (KI-76 to KI-82) — and
`d706f2d` moves the server bundle again because `scripts/lib/build-provenance.ts` is a hashed input.
The reviewer-facing packet for the tested app is now
`test-results/human-review/palette-bench-2026-11-03-081952`: a **free re-measurement of the same paid
bytes** (`sha256 b306418d95db…`, identical to `-2026-11-02-2250`), taken by the harness at `d706f2d`,
printing `1 coding job(s), 3 internal call(s), capped at 12, 0 provider media call(s),
Idempotency-Key a6f98754…` and a `bytes built at / measured by` row so nobody can read it as a build at
the current commit. Its `app_facts` are byte-equal to the 2250 packet's: the measurement layer did not
drift across KI-73, KI-84 and KI-85.

**What is still missing is not a measurement.** New app bytes at the current candidate cost exactly one
coding job through `pnpm run review:app`, and no authorization to spend one has been given since
`94867e5`. Re-measuring cannot produce them, and no offline gate can: the open question is whether a
person would hand the app to a colleague.

### The second round: the same brief and decisions, run against the current candidate (paid, authorized)

Authorization was explicit and bounded: one coding job, capped at 12 internal calls, billed to the
logged-in CLI, no key introduced, no media calls, prior packets preserved. The run spent exactly that.

`test-results/human-review/palette-bench-2026-11-03-082925` — PASS 9 checks:

- **what it cost**, read back from the harness's own accounting: 1 coding job
  (`6fff2d0f…`, kind `generate`, status `succeeded`, **5 internal calls** against the cap of 12,
  version 1, model `muse-wonder-1.0`), submitted with `Idempotency-Key 10132e2b-5f33-4c54-aec6-04ea79264bb2`,
  and **0 provider media calls** — the trace log was read (213 bytes) rather than assumed absent, and
  its `dispatch_paths` is empty;
- **who paid**: `the logged-in coding CLI: no FORGE_MUSE_API_KEY was set, so the spend lands on
  whatever account that CLI is authenticated to`; the CLI is named as `/Users/burnz/.local/bin/muse`;
- **which bytes were under test**: `commit 0ff747b…`, `treeCleanAtMeasure: true`,
  `bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`,
  server `e1515d84308d…`, web `b2471becf70f…` — both instants printed with the KI-84 field names;
- **comparability, proven rather than asserted**: the brief and the seeded decisions hash identically
  to the copies retained inside the first packet (`brief.md` `37dac94d…`, decisions `296832b2…`), the
  same three interaction steps were driven (`type 42` → `Generate` → `Export`), the same cap and the
  same CLI were used.

**Measured side by side.** No verdict in this table — these are the same measurements the first packet
carried, taken the same way:

| measured fact | original (`94867e5`) | current candidate (`0ff747b`) |
| --- | --- | --- |
| artifact bytes | 19 409 | 13 882 |
| artifact sha256 | `b306418d95db…` | `529e520aac9e…` |
| page title | Palette Bench | Palette Bench |
| interactive controls | 17 | 17 |
| named controls / icon-only / text fields | 17 / 5 / 2 | 17 / 5 / 2 |
| distinct colours (initial → used capture) | 492 → 1 047 | 1 844 → 1 959 |
| visible text characters | 985 | 746 |
| text elements measured for contrast | 64 | 38 |
| elements below 4.5:1 | 0 (worst 6.70:1) | 0 (worst 7.23:1) |
| native dialogs raised | 0 | 0 |
| console errors / failed requests / non-local requests | 0 / 0 / none | 0 / 0 / none |
| status text after Export | "Exported five CSS custom properties to the text area below." | "Exported 5 colours as CSS custom properties." |
| internal calls / media calls | 3 / 0 | 5 / 0 |

What the numbers say and do not say: the two apps are different bytes with the same control topology,
both self-contained (no non-local requests), neither raised a native dialog, and neither measured any
text below 4.5:1 — so the two decisions about dialogs and contrast are **not contradicted by
measurement** in either run, which is not the same as a person agreeing they were followed. The colour
counts differ by a factor of roughly four in the current candidate's initial capture; whether that is
richer or noisier is exactly the judgement the blank rows are for. Bytes are not quality.

**Offline gates re-run against the bundles that produced this artifact** (all at `0ff747b`):
`verify:batchd-playback-auth` PASS 15 (`test-results/batchd-playback-auth/2026-11-03-0831`),
`verify:batchc-ui` 22, `verify:batche-review-ui` 20, `verify:runtime` 14
(`test-results/runtime/20261103-0831`), `verify:media-journey-offline` 6 with
`ledger_issues: []` and an empty dispatch ledger over a 426-byte trace
(`test-results/media-journey/2026-11-03-08320799`), and `verify:studio-workflow` 59 checks
(`project studio-workflow-0fje1v`, guard passed). `pnpm run verify` at this commit: 130 files /
1 631 passed / 3 skipped; `typecheck:tests` exit 0. No regression surfaced.

**The standing identity pair moves** to `test-results/batchd-playback-auth/2026-11-03-0926`: commit
`302643d044d4…`, server `a4834b7fd534…`, web `b2471becf70f…`, `treeCleanAtMeasure: true`,
`bundlesBuiltAtHead: true`, `bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`. The web
bundle is byte-identical to the one the previous rounds carried — nothing hashed on the web side moved.
The server bundle moves on every commit because its manifest embeds the commit.

**Three conclusions, kept apart on purpose.**

1. **Harness reliability** — the measurement layer is reproducible: re-measuring the original bytes at
   the current commit produced byte-equal `app_facts`, and its cost record now survives hops
   (KI-85). Supported, with the caveat that "1 631 tests pass" measures the harness and product
   behaviour, not the quality of a generated app.
2. **Artifact correctness** — generation is reproducible under identical inputs, the current candidate
   produced a self-contained, zero-console-error, zero-egress app that loaded in Chromium at both
   viewports and answered the driven interaction steps, and every claim above is backed by a named
   evidence file.
3. **Human quality** — **still unassessed.** The five judgement rows and four decision rows in
   `test-results/human-review/palette-bench-2026-11-03-082925/review-packet.md` are blank, and the
   machine flagged `issues: []`, meaning the capture can support a judgement — not that one has been
   made.

**Release position recorded by the reviewer for this round: conditional acceptance for the next
evaluation round, not final beta approval.** The remaining decision belongs to a person reading the
new packet against the old one.

Two harness defects found on the way, recorded rather than smoothed over: KI-71 (a self-contained
app was flagged as a network violator because egress was measured by hostname instead of protocol,
and 464 lines of source were reported as 12,189 characters of "visible text") and KI-72 (the
harness passed an empty `FORGE_MUSE_API_KEY` through, killing the server on a key-length rule, and
then reported a dead socket instead of the server's own cause line — KI-59's rule, skipped).

Evidence: `test-results/human-review/palette-bench-2026-11-02-2148` (the paid run and its bogus
flag, kept), `-2026-11-02-2146` (the zero-cost refusal that exposed KI-72, kept),
`-2026-11-02-2151` and `-2026-11-02-2245` (the earlier corrected and used-state packets, kept),
`-2026-11-02-2250` (the packet the first human round read — and the bytes every later packet
re-measures), `-2026-11-03-0811` (kept as the measured evidence of KI-85: the hop where the cost
record degraded to nulls), and `-2026-11-03-081947` / `-2026-11-03-081952` (two runs five seconds
apart, kept as the measured evidence that KI-86's directory collision is fixed). None of the later
packets spent anything.

What this does **not** settle stays open and is now the list: whether the review model's findings
about a Muse-built app match what a person would notice; whether a vision draft is worth the call
that produces it; whether generated apps are good enough to ship. Those need a person with the
packet in front of them, and the packets now exist.

### A person judged the app, and what they found said more about the harness than about the app

**The verdict, as given:** **accept with conditions**. Of the four seeded decisions, three were
assessed as passing and one partial — undo is session-scoped, so "every destructive action is
undoable" holds inside a load and not across a reload (KI-90). The five quality rows are still blank:
the conditions came out of the decisions and out of three defects, not from the judgement sheet, and no
machine filled anything in.

**The three defects** are KI-88 (the app hands over colours it is not displaying: Export, regenerate,
Copy CSS and the clipboard carries the palette the screen no longer shows), KI-89 (seeds `1` and
`4294967297` render one palette, because the seed field accepts a number the generator folds into 32
bits) and KI-90, plus KI-91 as an enhancement. All are findings about a generated artifact and are
recorded as open: a retained review artifact is not something this product edits, and rewriting it
would destroy the evidence that the review happened.

**Why they belong in this document anyway.** The capture had already measured those exact bytes and
printed `issues: []`. That flag was accurate about every thing it measured — load from retained bytes,
no storage, no console error, no non-local request, controls and contrast recorded. It is the wrong
*shape* for the question. A load plus a scripted fill-and-click measures a state; staleness, numeric
wrap-around and lost history are properties of **sequences**. No set of assertions about one state can
find them, and `issues: []` reads, to a person skimming a two-page packet before deciding, as "nothing
is wrong with this app". The packet's own wording — the flags judge the evidence, not the application —
is true and was not enough, because the failure mode is silence rather than a wrong claim.

**What changed.** The review harness runs sequence probes now:
`scripts/lib/artifact-probes.ts`, `pnpm run verify:artifact-probes`, CI-gated. Fixture mode runs two
documents, one that keeps handing over output it no longer displays and one that refreshes it, and the
battery must flag the first and leave the second alone — because a battery that cannot tell those apart
would print "no findings" over the real defect. Packet mode runs against retained bytes and *reports*,
never fails the run: a defect in a generated app is a measurement of that app, not a product failure.
Bytes are served over `http://127.0.0.1`, not `file://`, because a file document has an opaque origin
and the clipboard API refuses to work there — and the clipboard is exactly where KI-88 was hiding.
Control names are accessible names: this artifact's copy button reads "Copy CSS" on screen and is named
"Copy exported CSS to clipboard", and passing the visible words fails, which is the honest outcome —
the probe could not find the affordance a user would name.

**Measured.** Re-run against the bytes the reviewer had just judged
(`test-results/human-review/palette-bench-2026-11-03-082925`, evidence at
`test-results/artifact-probes/2026-11-03-092425`; the battery's own CI run passes at
`2026-11-03-092409`), the battery reported all three: a published output
carrying five colours the application is not displaying and omitting five it is; seeds `1` and
`4294967297` producing one palette; and undo that does not carry across a reload while a destructive
action taken after the reload still offers a way back. Free, local, reproducible on retained bytes. Two
rules had to be fixed inside the helpers first: "nothing was handed over" is not staleness, and "no undo
control before the reload and none after" is not a pass — the first draft compared two booleans for
equality and read the *absence* of an undo affordance as one that survived (KI-87, with 16 unit tests
on the wording).

**The loop this exercise was built to test worked, and not in the way planned.** The plan was that the
review model's eye would be checked against a human's. It was — and what the human found, first, was a
blind spot in the harness. That is still the value: **the product's own artifact showed the review
harness what the review harness could not see**, and the harness is now wider because of it. The three
conclusions hold, with the harness conclusion now carrying a named blind spot that has been closed
rather than a clean bill of health.

## The battery's own gaps, and the beta gates that walk what probes cannot

**Six of the seven promised sequences were never driven, and the battery could not admit it** (`KI-92`).
The first battery reported a bare findings count, so a sequence it never ran and a sequence it ran cleanly
produced the same output — and it had in fact driven six of the seven, not seven, and sampled ten seeds
for the wrap-around probe rather than all of a 1024-value space. The report was not wrong; it was *shaped*
so that an omission looked like a result, which is the same failure as `issues: []` one level up. Four
outcomes now exist — `finding`, `clean`, `not_tested`, `incomplete` — every row carries a reason,
`not_tested` and `incomplete` mean zero findings, and the summary names its subject and says that findings
in a generated application are a measurement of that application, not a product failure. Fixture mode
became honest too: eight knobs, each installing exactly one known defect, each checked by the sequence that
should catch it **and by no other**, plus a clean baseline that must report nothing. Writing those
expectations exposed two defects in the battery itself. The clean baseline disagreed with itself because
the knob model conflated *re-export* with *what was already handed over* (`export_mode` had to become
`publish_mode: refresh | stale-copy | frozen`, with `stale-copy-export` as the KI-88 shape specifically:
re-pressing Export keeps the app in step, while Copy reads an export region no state change rewrites). And
the reload probe sampled undo visibility **before** the destructive action that made it relevant, which
reported a document that offers undo as one that does not — caught by the `no-undo-control` fixture, whose
evidence is kept at `test-results/artifact-probes/2026-11-03-091706` rather than quietly deleted
(`KI-92`). Re-measured with the corrected battery on the reviewed bytes
(`test-results/artifact-probes/2026-11-03-094809`): 3 findings, 4 clean, 0 not-tested, 0 incomplete. The
same three findings, now with the counts to show nothing was skipped.

**Then a gate was added for the journey the probes cannot walk** (`verify:beta-journey`, CI-gated).
It boots the **production** server bundle and `vite preview` over the built web assets, and drives the real
Studio UI in the order a beta user would: open a project, describe an application, read the change, approve,
look at it, take it away, come back, change it, go back, and do the same on a phone. Two checks exist
because of KI-88's class of defect rather than in search of it: **Copy source hands over exactly the bytes
the artifact endpoint serves** and **Download HTML hands over the bytes of the current version**, each
verified by hashing what the browser was given and comparing it with the endpoint's own recorded hash. Both
pass. That is a statement about this product's handover controls; it says nothing about the handover
controls of an application the model wrote, where KI-88 lives.

Two fixes were needed before it could measure anything, both worth recording because they are the kind of
thing that makes a gate silently measure nothing. A `page.evaluate` block that declared a named helper
died in the browser with `ReferenceError: __name is not defined` — the bundler injects that helper for named
functions, and it does not exist page-side; the fix is to keep page-side blocks free of named helpers, and
`tests/unit/beta-journey-gate.test.ts` now rejects that shape in the gate's own source so the fix cannot be
undone by a later tidy-up. And the phone measurement keyed on control *words* the product reuses for two
different actions (`Generate HTML` before a version exists, `Stage new version` after one does), so the
probe measures by panel role and class and records the words it found instead.

**A release gate that aggregates, and refuses to pay** (`verify:release-gate`). Ten named offline gates run
in sequence after building both production bundles, each reporting its own outcome, seconds and evidence
directory. It refuses to start when a provider credential is exported and strips those variables from every
child, so its `provider_calls: 0` line has a guard behind it rather than an intention; it fails when a gate
name disappears or duplicates (`KI-83` applied to its own list); and a blocked prerequisite — missing
browser, stale bundle, occupied port — exits `2` with `BLOCKED` and claims no measurement, which is the
difference between "we could not run it" and "it passed". It also caught its own bug: the build step invoked
the TypeScript build through `node` rather than the loader the documents name (`pnpm exec tsx`), which fails
on the first import, and a release gate that cannot build has no business reporting a pass.

**Standing release identity.** `test-results/batchd-playback-auth/2026-11-03-1047` — commit
`7f30184b40d26c22c26541249ee4a90cc142894b`, `treeCleanAtMeasure: true`, `bundlesBuiltAtHead: true`,
`bundlesBuiltFromCleanTree: true`, `supportsCommitIdentity: true`, server build
`7ff2b7fe…`, web build `b2471bec…`. The gate run that produced it is
`test-results/release-gate/2026-11-03-104626`: 10 gates, status pass. This is the strongest identity the
repository can claim, and it belongs to that commit: a later commit that only edits documents changes no
hashed production input but still moves the commit string embedded in the server bundle, so a beta cut at a
later commit rebuilds and re-measures before quoting an identity. The beta documents
(`docs/beta/READINESS.md`, `docs/beta/RELEASE-GATE.md`, `docs/beta/RELEASE-NOTES.md`,
`docs/beta/DEMO-CHECKLIST.md`) say that in their own words, and their commands and field names are checked
by `tests/unit/release-command-inventory.test.ts` and `tests/unit/identity-field-names-in-docs.test.ts`.

**Beta readiness says "human sign-off required", and means it.** The verdict in `docs/beta/READINESS.md` is
neither "ready" nor "blocked": every gate passes, the release identity is supported, and no product defect
is open at any priority — the four open findings (KI-88, KI-89, KI-90, KI-91) are all inside a generated
application, which is a fact about the generated file and not something the product may fix by rewriting
someone else's bytes. What is missing is a person's judgement, and the harness will not supply it: the
round-two packet's quality rows and decision-compliance rows are blank on purpose. Provider accounting for
all of the above: **zero paid calls**; the day's total stays 17, being 16 live media calls plus the one
coding job the second review brief paid for.
