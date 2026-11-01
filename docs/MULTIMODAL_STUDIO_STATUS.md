# Multimodal studio — status against the beta v0.1 plan

**Written:** 2026-11-01
**Commit under review:** `7cf3e63` (`git status --porcelain` empty)
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
| D — voice and video | built and verified offline for access and playback; **transcription and clip observation built and fixture-verified, live result outstanding (harness now exists)** | `verify:batchd-playback-auth` (15 checks, audio **and** video, secured and tokenless), `tests/unit/source-playback.test.ts` (33), `tests/integration/access-token-media-bytes.test.ts` | transcript/clip understanding: **none recorded** |
| E — visual and decision-change review | built and verified offline, **live review quality outstanding** | `verify:batche-review-ui` (20 checks), `tests/integration/forge-batche-visual-review.test.ts` (18), `tests/integration/forge-batche-generations.test.ts` (6), `tests/unit/studio-batch-e.test.ts` (29) | **none recorded** — every Batch E gate uses a deterministic stub by design |

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
| Video clip observation (`muse-spark-1.3` over an uploaded MP4) | no live clip observation recorded | `BATCHD_SMOKE_SCOPE=both pnpm verify:batchd-live-smoke` — one clip call over a generated red-frame/green-square clip; observations are reported for a human, never auto-accepted |
| Screenshot review (`muse-spark-1.3`) | contract, refusal, and no-write behaviour are proven with a stub; whether the findings are *useful* is unmeasured | `verify:batche-review-ui` is offline by design; a live review needs its own authorized run |

Documentation states these gaps rather than leaving them implied:
`docs/BatchB-Media-Decisions.md` (§live provider), `docs/BatchE-Decision-Review.md`
(§Limits to keep honest), and the limits text shipped inside every review payload.

## Verified at this commit

Offline, no provider key, no external network:

- `npx vitest run`: **106 files, 1332 passed, 3 skipped, 0 failed**.
- `pnpm -r run typecheck`: no `error TS`.
- `npx biome check .`: 0 errors (4 warnings, 18 infos pre-existing).
- `pnpm exec tsx scripts/build-production-bundles.ts` after the commit: server
  `buildHash 1e8ea69c1ec8…` (`sourceHash 73d120b89e63…`, 128 inputs), web
  `buildHash ed405f622a6f…` (`sourceHash 40f681cf17f2…`, 74 inputs); both manifests
  carry `commit 7cf3e63…` and `treeClean: true`.
- `pnpm verify:batche-review-ui`: **PASS 20 checks** (`test-results/batche-review-ui`).
- `pnpm verify:batchd-playback-auth`: **PASS 15 checks**
  (`test-results/batchd-playback-auth/2026-11-01-1621`), and it asserts that the
  *running* server's identity equals the verified build:
  `commit 7cf3e63…`, `treeClean true`.
- `pnpm verify:batchc-ui`: **PASS 22 checks** (`test-results/batchc-ui`).
- `pnpm verify:studio-workflow`: **56 checks passed** (project
  `studio-workflow-y1m2i4`; logs and screenshots in `test-results/studio-after/`).
- Evidence directories under `test-results/` are gitignored local artifacts, not
  repository content: the offline gates re-create them on any machine, but the live
  Batch C runs cannot be re-created without spending quota again, so those recorded
  results exist only here.
- Preserved evidence untouched: `test-results/batchc-live/2026-11-01-0755/` and
  `test-results/batchc-resume-staged/2026-11-01-0824/` keep their original mtimes
  and hashes.

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
  its recipe. `BATCHD_SMOKE_FIXTURE_ONLY=1` runs that plumbing check with no network
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

1. **Live results for the four capabilities above.** Until then they are advertised
   as configured-but-unverified, and the beta cut should say so.
2. **Fresh-install demonstration** on each claimed environment with the browser and
   ffmpeg prerequisites written down; only this machine has been exercised.
3. **Independent review of `7cf3e63` and `4aa1282`** — the idempotency and
   failure-coverage work is mine and has not been reviewed by anyone else.
4. **A release decision.** `main` still points at the known-working candidate. There
   is no tag, no beta branch, and no merge from this line; nothing here publishes
   anything.

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
- **Test and script type debt**: `tsconfig.tests.json` is still unwired, so test files
  are not typechecked by `pnpm -r run typecheck`; the suites are the check for them.
