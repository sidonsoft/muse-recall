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
| B — Muse Image and integration | built and verified offline; **live image result outstanding** | media API/journey suites, `verify:media-journey`, embedded-asset verification in `verify:studio-workflow` | **none recorded in this tree** — `pnpm verify:media` reports `unconfigured (FORGE_MUSE_API_KEY is not set)` and exits 2 |
| C — visual references and SAM | built and verified offline, **and** live | `verify:batchc-ui` (22 checks), `verify-studio-workflow` (56 checks), offline resume package, plus real calls in `test-results/batchc-live/` | **yes** — vision, SAM, and coding calls below |
| D — voice and video | built and verified offline for access and playback; **transcription and clip observation built and fixture-verified, live result outstanding** — the live harness exists and, after review, was repaired to the point where it can reach a dispatch (see Corrections after review) | `verify:batchd-playback-auth` (15 checks, audio **and** video, secured and tokenless), `tests/unit/source-playback.test.ts` (33), `tests/integration/access-token-media-bytes.test.ts` | transcript/clip understanding: **none recorded** |
| E — visual and decision-change review | built and verified offline, **live review quality outstanding** | `verify:batche-review-ui` (20 checks), `tests/integration/forge-batche-visual-review.test.ts` (22, including replay-subject and record-fault cases), `tests/integration/forge-batche-generations.test.ts` (6), `tests/unit/studio-batch-e.test.ts` (29) | **none recorded** — every Batch E gate uses a deterministic stub by design |

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

Everything after `2026-11-01-0755` — the offline resume package, Batch D's
token-gated playback, Batch E — was verified **without any provider call**. The
Batch C and D gates refuse to start when `FORGE_MUSE_API_KEY` or
`FORGE_FALLBACK_API_KEY` is set.

## What is not proven, and what would prove it

Nothing in this list is claimed to work end to end. Each line names the command
that would produce the evidence; running any of them spends real quota and needs an
explicit go-ahead.

| Capability | Gap | Command that records the evidence |
| --- | --- | --- |
| `muse-image-1.0` generate and edit | no live call recorded in this tree; embedding and CSP are proven only with fixture bytes | `pnpm verify:media` (server-side live check), `pnpm verify:media-live-smoke` (Studio journey incl. code and rollback) |
| `muse-voice-transcribe-1.0` | transcript agreement and turn timing against real audio unproven | `pnpm verify:batchd-live-smoke` (default scope `audio`): speaks a known sentence with `say`, transcribes it once, and fails if the content words do not come back |
| Video clip observation (the model `/api/meta` names as `media.video_model`, default `muse-spark-1.3`, over an uploaded MP4) | no live clip observation recorded | `BATCHD_SMOKE_SCOPE=both pnpm verify:batchd-live-smoke` — one clip call over a generated red-frame/green-square clip; the prompt now names that scene, so an empty observation reads as a model result rather than a mismatched request. Observations are reported for a human, never auto-accepted |
| Screenshot review (`muse-spark-1.3`) | contract, refusal, and no-write behaviour are proven with a stub; whether the findings are *useful* is unmeasured | `verify:batche-review-ui` is offline by design; a live review needs its own authorized run |

Documentation states these gaps rather than leaving them implied:
`docs/BatchB-Media-Decisions.md` (§live provider), `docs/BatchE-Decision-Review.md`
(§Limits to keep honest), and the limits text shipped inside every review payload.

## Verified at the commit the gates ran against

Offline, no provider key, no external network. Gates run at `d007e7e` (the last
commit changing sources, gates, scripts or CI in this stretch); the bundles for
that commit were rebuilt first, and the identity gate records them:

- `npx vitest run`: **107 files, 1361 passed, 3 skipped, 0 failed**. The extra test
  against the previous count is the Phase 17 math drift guard (KI-50); no coverage
  was lost during the typing work.
- `pnpm -r run typecheck`: no `error TS`. `npx biome check .`: 0 errors
  (4 warnings, 18 infos pre-existing).
- **`pnpm run typecheck:tests`: exits 0** — `tests/**` and `scripts/**` are now
  typechecked under the same strict base the products use, and CI runs it as
  "Typecheck test and gate sources" between the product typecheck and the test
  run. Measured path 311 → 0; KI-50 records what changed and what stays out of
  scope by design (the protocol-locked Phase 16/17 scripts).
- **Running build identity** (`test-results/batchd-playback-auth/2026-11-02-0325`):
  manifest commit `d007e7e63666ac3ccd54d1b0858ff4939ba99c15`, `treeClean: true`,
  server `5e0a55a9b37064a60c977674b27e2fe5d9c49a2614a9f8bb34067e198af98be3`,
  web `53bb67170dbdfac6ec0297839505bfd172fa7414fcef03a792dd7f61c5f98306`.
- `pnpm verify:batchd-playback-auth`: **PASS 15 checks** in that same run, which
  is also the browser proof for the voice/video branch — real `<video>` decode of
  the generated H.264 clip, blob bytes hash-matched to the stored source, and one
  credential-free download per source in each trust model.
- `pnpm verify:batchc-ui`: **PASS 22 checks**.
- `pnpm verify:studio-workflow`: **56 checks passed** (project `studio-workflow-yp6xsl`).
- `pnpm verify:batche-review-ui`: **PASS 20 checks** (`test-results/batche-review-ui`),
  including the one-paid-call check (same frame and selection sends the same
  Idempotency-Key and costs one stub dispatch) and the stale-selection refusal.
- `BATCHD_SMOKE_SCOPE=both BATCHD_SMOKE_FIXTURE_ONLY=1 pnpm verify:batchd-live-smoke`:
  **PASS 4 checks, no network** (`test-results/batchd-live/2026-11-02-0326`).
- `pnpm verify:batchc-live-smoke` without a key: writes a report saying
  `BLOCKED before any provider call` and exits 2 (zero calls, zero dispatches).
- **Research gates re-ran read-only and reproduce their preserved numbers**:
  `verify:research` (v1 5/16 and 15/16, p=6.351663e-4; v2 0/16 and 15/16,
  p=5.656481e-8; 32/32 raw output hashes, 72/72 recovered hashes),
  `verify:research16`, and `verify:research17` (lock metadata `6640e83f3c99…`,
  as-run analysis hash and p-values matching the preserved values).
  `eval:guard` and `evidence:phase14a` were **not** run: they regenerate tracked
  evidence files. Their recorded numbers remain exactly as committed; the type
  changes to those two scripts add the schema's own default values and the guard
  code never reads the fields that were missing.

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

1. **Live results for the four capabilities above.** Each now has a harness that
   records it (`verify:media`, `verify:media-live-smoke`, `verify:batchd-live-smoke`,
   and an authorized live review run for Batch E), and each still has no recorded
   result. Until they exist these capabilities are advertised as
   configured-but-unverified, and the beta cut should say so. Running any of them
   spends real quota and needs an explicit go-ahead.
2. **Fresh-install demonstration** on each claimed environment with the browser,
   Node, and ffmpeg prerequisites written down; only this machine has been exercised.
3. **Independent review of the newest commits.** A read-only review of
   `4aa1282`, `7cf3e63`, `5bed18b` and `8148cf0` was carried out by a separate agent
   (verdict: ship-with-fixes). Its findings are addressed in `e0cd2eb` and `8250b44`;
   the review of those two fixes has not happened, and this line of work is otherwise
   unreviewed by anyone else. Coordinator reviews of earlier Batch E commits do not
   extend to any of it.
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
