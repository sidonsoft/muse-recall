# Release notes — Muse Forge beta

Branch `integration`, commit `7f30184`. Verdict and evidence: `docs/beta/READINESS.md`. Gate results:
`docs/beta/RELEASE-GATE.md`. Limitations in full: `docs/guide/limitations.md`.

## What this is

A local-first studio for building small web applications by describing them, with the whole loop visible:
you describe an application, the product writes `index.html`, you read the diff and decide whether to
publish it, and every published version stays listed and recoverable. Around that loop:

- **Project memory.** Decisions you record ("never use countdown timers") are pinned into the next
  generation at the exact revision you chose, and the record says which revision it supplied.
- **Object extraction in a reference image.** Point at an object in a picture; the isolated cutout is
  shown, kept with its alpha channel, inserted into the prompt, and only then does a coding job run.
- **Voice and video sources.** Record or upload, play back, download. With an access token configured,
  the browser fetches bytes through the API and plays them from blob URLs; the token never appears in a
  URL, and nothing logs the credential.
- **Advisory screenshot review.** Send a screenshot of the running application to a vision model against
  the decisions you select, and get findings that do not change the project: no new version, no staging
  file, no memory write.
- **A dependency disclosure in the approval panel.** Before you approve, the panel states whether the
  bytes it would write carry the engine inside them, will ask a remote host when they run, or had a
  remote request refused during verification — measured from the bytes, not from what the model claimed.

## Run it

Prerequisites: Node 24 or newer (`engines.node: ">=24.0.0"`), pnpm, and Chromium for the verification
gates. Real generation needs the Muse Code CLI reachable (`muse --version`, then `muse login`); browsing
and chat can run with `MODEL_PROVIDER=echo`. Studio generation always needs a coding CLI — `echo` does
not power Forge — and `FORGE_MUSE_BIN` can point at an absolute path.

```bash
pnpm install
pnpm run demo:seed          # seeds the forge-demo project and writes .env with MODEL_PROVIDER=echo
pnpm dev                    # API and web UI
pnpm build && pnpm start    # production bundles instead
```

First-run behaviour, ports and egress are documented in `docs/guide/getting-started.md`; the measured
first-run rehearsal is `docs/Fresh-Install-Rehearsal.md`.

## What to try in ten minutes

1. Open the Studio and create a project. Describe something small with one obvious action.
2. Read the diff. The approval panel's Dependencies block tells you what these bytes fetch — for a
   Phaser game the engine is carried inside the file, so the block says *bundled*.
3. Approve. Watch the version list; the approved version is the one the preview loads.
4. Change your mind: request a change, approve the second version, then use *Undo last change* to restore
   the first. The confirmation tells you the restore itself cannot be undone from that screen.
5. Copy the source and download the HTML. Both hand over exactly the bytes the endpoint serves — the
   gates check this byte for byte, because a human review found a generated application whose copy
   control handed over output the app was no longer displaying (KI-88).
6. Do it again at phone width. The journey is gated at 390 px: no overflow, controls inside the viewport,
   and the published application still reachable through the preview.

## Measured, not asserted

The beta ships with the measurements attached. Each row names a directory you can open.

| claim | evidence |
| --- | --- |
| production bundles boot with no provider credential; the Studio journey completes | `test-results/beta-journey/2026-11-03-104816` |
| Copy source and Download HTML hand over the served bytes | same directory, `observations.served_artifact_sha256`, `downloaded_bytes` |
| rollback changes the bytes the browser is served, and says the restore is not undoable | same directory, `rollback_confirmation_wording` |
| ten offline gates pass at the release commit | `test-results/release-gate/2026-11-03-104626` |
| secured media byte playback and download, including a real `<video>` decode path | `test-results/batchd-playback-auth/2026-11-03-1047` |
| SAM suggest → cutout → insert → approve → coding job → restart → rollback, on real provider bytes | `test-results/batchc-live/2026-11-01-0755` |
| the same journey without a provider, on uploaded bytes | `test-results/media-journey/2026-11-03-10471568` |
| a screenshot review stays advisory and revision-pinned in the real UI | `test-results/batche-review-ui` |
| a self-contained artifact is verified and served with no remote origin at all | `test-results/runtime/20261103-1046` |
| a stale published output is distinguishable from a fresh one | `test-results/artifact-probes/2026-11-03-104802` |

## Known limitations, the short version

- **Human judgement is still open.** A person reviewed one generated application (`accept with conditions`)
  and the quality rows in that packet are blank because they belong to a person. See
  `test-results/human-review/palette-bench-2026-11-03-082925/review-packet.md`.
- **Four open findings, all about a generated application** (KI-88 stale published output, KI-89 seed
  values that produce one application, KI-90 undo that is session-scoped, KI-91 five swatches stacked on
  a phone). The product cannot fix them by rewriting someone else's generated file; it can find them, and
  the probe battery does.
- **Idempotency is per database, in-flight locking is per process.** Scaling out in either of two shapes
  breaks the one-paid-call guarantee. Documented, not built (D060).
- **The engine pin is a human decision.** `pnpm run vendor:phaser -- --check` verifies the committed copy
  offline; `pnpm run vendor:phaser -- --against-remote` compares the remote pin and writes nothing either
  way. Nothing refreshes it automatically. Artifacts approved before KI-53 keep their CDN reference and
  remain valid under the older per-document network policy.
- **A dependency disclosure reads bytes, not history.** It cannot see a request whose URL is assembled at
  runtime, and it says so next to the list it qualifies. Versions approved before the record existed are
  reported as *no dependency record was kept for these bytes* — nothing reconstructs a picture the
  approver never saw.
- **Vision-draft is experimental.** Accounted for, working, no evidence yet that it beats asking the
  coding model directly.

## What changed on the way here

The short list, with the reasoning in `docs/KNOWN_ISSUES.md` and `docs/DECISIONS.md`:

- A generated game carries its engine inside it (KI-53, D059): stored source keeps the one CDN tag the
  model wrote, and the pinned copy is inlined only at the boundaries that matter — preview, diff,
  validation, runtime verification, promotion.
- The approval panel discloses dependencies measured from the promoted bytes (KI-74), with three distinct
  states — bundled, fetched, blocked — and the limits of its own reading.
- Vendor delimiters are a format this product writes, never something an artifact may claim (D062); a
  staged file containing a marker text is invalid, so a smuggled payload stays visible in the diff.
- Gate honesty: three outcomes with three exit codes (`pass` / `failed` / `blocked`), pinned check counts
  and required check names (KI-83), ledger parsing treated as a contract where damaged lines are damage
  rather than absence.
- Review economics: one screenshot review costs at most one paid call, replay revalidates the actual
  review subject, and an unanswered dispatch is never counted as zero.
- Evidence discipline: stamps carry seconds, directories collide into `-2` rather than overwriting, cost
  records survive re-measurement hops, and retained evidence is never rewritten (KI-85, KI-86).
- Provenance names the instant it describes (`treeCleanAtMeasure` vs `bundlesBuiltFromCleanTree`, KI-84).
- A review capture measures a state; the probe battery drives sequences and says what it did not run
  (KI-87, KI-92).
- The beta user journey is now a gate on production bundles with no provider in the room, and the two
  handover controls are checked byte for byte.

## Paid calls

17 in total for this build cycle: 16 live media calls across the capability proofs, 1 coding job for the
second human review. Nothing in the release gate, the probe battery, the offline journey or this round of
documents spent anything, and the release gate refuses to start if a credential is present.
