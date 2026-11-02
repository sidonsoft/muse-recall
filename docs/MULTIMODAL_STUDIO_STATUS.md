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
| C — visual references and SAM | built and verified offline, **and** live | `verify:batchc-ui` (22 checks), `verify-studio-workflow` (56 checks), offline resume package, plus real calls in `test-results/batchc-live/` | **yes** — vision, SAM, and coding calls below |
| D — voice and video | built and verified offline for access and playback, **and** live for transcription and clip observation | `verify:batchd-playback-auth` (15 checks, audio **and** video, secured and tokenless), `tests/unit/source-playback.test.ts` (33), `tests/integration/access-token-media-bytes.test.ts`, plus `verify:batchd-live-smoke` (`2026-11-02-0458` audio, `2026-11-02-0400` video) | **yes** — one transcription and one clip observation, both scored against what the fixtures actually contain |
| E — visual and decision-change review | built and verified offline, **and** live for one scored frame | `verify:batche-review-ui` (20 checks), `tests/integration/forge-batche-visual-review.test.ts` (22, including replay-subject and record-fault cases), `tests/integration/forge-batche-generations.test.ts` (6), `tests/unit/studio-batch-e.test.ts` (29) | **yes, one call** — `verify:review-live-smoke` (`2026-11-02-0451`); every other Batch E gate keeps using a deterministic stub by design |

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

Everything after `2026-11-01-0755` — the offline resume package, Batch D's
token-gated playback, Batch E — was verified **without any provider call**. The
Batch C and D gates refuse to start when `FORGE_MUSE_API_KEY` or
`FORGE_FALLBACK_API_KEY` is set.

## What is not proven, and what would prove it

Four of the five live gaps that this file listed a day ago are now closed (the
rows marked **closed** below), because the harnesses that would prove them did
not exist until they were written and paid for. What remains:

| Capability | Gap | Command that records the evidence |
| --- | --- | --- |
| Image asset **inside a generation** — image assets embedded in a shipped artifact from a live pipeline | embedding, CSP and byte identity are proven with live image bytes *and* with fixture-driven generation, but no run has yet gone live image → asset → coding model → artifact in one chain | `pnpm verify:media-live-smoke` (Studio journey incl. code and rollback; spends vision + coding calls, so it needs its own authorization) |
| Review quality on a **Muse-built** app | the live review probe used a frame of a hand-authored app whose contents were known by construction. Judging a real Muse artifact — where "correct" is not precomputable — is unmeasured, and is the reason review stays advisory | a live review run against a frame from an approved generation; no automatic score is possible, a human must read the findings |
| Vision draft **usefulness** | the live vision call returned three drafts and one was approved offline, but no gate measures whether drafts are good guidance | human review of `test-results/batchc-live/*/02-vision-drafts.png` |
| Fresh-install demonstration (§5 gate 7) | not run: no clean-clone install, first-run, browser and backup/restore demonstration on a current build | a clean-clone rehearsal against the current commit |
| Multi-server idempotency | the in-flight dedup is per-process; two servers could both pay for one key | documented as a single-server beta limit; needs a shared store to close |

Already closed by live runs, with the evidence named above:
`muse-image-1.0` generate and edit (**closed**, `2026-11-02-0445`),
`muse-voice-transcribe-1.0` (**closed**, `2026-11-02-0458`), video clip
observation (**closed**, `2026-11-02-0400`), and screenshot review finding
quality on a known frame (**closed**, `2026-11-02-0451`).

Documentation states these gaps rather than leaving them implied:
`docs/BatchB-Media-Decisions.md` (§live provider), `docs/BatchE-Decision-Review.md`
(§Limits to keep honest), and the limits text shipped inside every review payload.

## Verified at the commit the gates ran against

Offline, no provider key, no external network. Gates run at `8fed969`; the
bundles for that commit were rebuilt first and the identity gate records them:

- `pnpm run verify` (lint → product typecheck → test-scope typecheck → Vitest)
  passes as one command: **110 files, 1397 passed, 3 skipped, 0 failed**.
- `npx biome check .`: **0 errors**, 3 warnings, 15 infos. See the correction
  below — this gate had four errors at HEAD and my reports of "0 errors" were
  misreads of the output tail.
- `pnpm run typecheck:tests`: exits 0 (KI-50).
- **Running build identity** (`test-results/batchd-playback-auth/2026-11-02-0456`):
  manifest commit `8fed96980cbe1ac96af1e27eae6ec4a2d56bf830`, `treeClean: true`,
  server `aaf5e74f21ff00ef112c7c5c79a931c158b7717272edf280913dd8c718989972`,
  web `53bb67170dbdfac6ec0297839505bfd172fa7414fcef03a792dd7f61c5f98306`.
- `pnpm verify:batchd-playback-auth`: **PASS 15 checks** — real `<video>` decode
  of the generated H.264 clip, blob bytes hash-matched to the stored source, one
  credential-free download per source in each trust model.
- `pnpm verify:batchc-ui`: **PASS 22 checks**. `pnpm verify:studio-workflow`:
  **56 checks passed** (`studio-workflow-ysfm6v`). `pnpm verify:batche-review-ui`:
  **PASS 20 checks**, including the one-paid-call check and the stale-selection
  refusal.
- `BATCHD_SMOKE_SCOPE=both BATCHD_SMOKE_FIXTURE_ONLY=1 pnpm verify:batchd-live-smoke`:
  **PASS 4 checks, no network** (`test-results/batchd-live/2026-11-02-0456`).
- `pnpm verify:image-live-smoke` with `IMAGE_SMOKE_BOOT_ONLY=1`: exits 0 without
  dispatching (live gates refuse to spend a call unless a key is present).
- `pnpm verify:review-live-smoke` without a key: `live review smoke: unconfigured
  (need FORGE_MUSE_API_KEY; no call made)`, exit 2.
- **Research gates re-ran read-only and reproduce their preserved numbers**:
  `verify:research` (v1 5/16 and 15/16, p=6.351663e-4; v2 0/16 and 15/16,
  p=5.656481e-8; 32/32 raw output hashes, 72/72 recovered hashes),
  `verify:research16`, and `verify:research17` (lock metadata `6640e83f3c99…`,
  as-run analysis hash and p-values matching the preserved values).
  `eval:guard` and `evidence:phase14a` were **not** run: they regenerate tracked
  evidence files. Their recorded numbers remain exactly as committed.

**Identity moves across documentation commits, and the rule is easy to over-read.**
Documentation is not a hashed build input, but the build *identity* (commit, source
hash, build time) is baked into the server bundle, so the server hash moves at every
commit while the web bundle's emitted bytes can stay byte-identical — as they did
here: web stayed `53bb6717…` from the Batch E work through this stretch while the
server hash moved at each commit. The gates above ran against bundles rebuilt at
`d007e7e`; the bundles for this documentation commit are rebuilt after it, and the
identity gate of the next refresh records that pair.

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
- **No provider key** for any gate listed above; the Batch C/D/E gates exit 2 if one
  is present, so a green run is also proof that no paid call happened.

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
   (`verify:media-live-smoke`, needs vision + coding authorization) and a live
   review of a **Muse-built** app, where no automatic score is possible. Everything
   else in the multimodal list is no longer "configured but unverified".
2. **Fresh-install demonstration** on each claimed environment with the browser,
   Node, and ffmpeg prerequisites written down; only this machine has been exercised.
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
