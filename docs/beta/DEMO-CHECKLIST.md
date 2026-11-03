# Demo verification checklist

A rehearsal checklist, not a script to read out. Each beat names what you should **see**, because those
are the observations the automated gates assert; if the UI says something else, stop and record it rather
than talking around it.

## Pre-flight

Run these before an audience is in the room. Everything here spends nothing.

```bash
git rev-parse --short HEAD            # write this down; it is the build you are demoing
pnpm run build                        # production bundles (web then server)
env -u FORGE_MUSE_API_KEY -u FORGE_FALLBACK_API_KEY -u META_API_KEY \
  pnpm run verify:release-gate
```

- [ ] The commit you wrote down is the commit in the release identity block. `supportsCommitIdentity` must
      be `true`; if the tree was dirty during the build it is `false`, and the honest statement is "these
      bytes include work no commit names" (KI-84).
- [ ] `verify:release-gate` prints `PASS — 10 gates` and names an evidence directory. Screenshot that line.
- [ ] Ports `8787` and `5173` are free if you are demoing with `pnpm dev`; the production preview path uses
      whatever the gates used. Nothing here kills a listener it did not start.
- [ ] Browser decision recorded by the gates: the first line of any browser gate names the engine and the
      policy (e.g. `Chromium 156.0.8078.4 (managed)`). A missing browser is a **blocked prerequisite**, exit
      2, with the install command named — it is not a product failure, and it must not be demoed as one.
- [ ] Decide the credential posture now and say it out loud at the start:
      - **offline demo**: no provider credential exported; Studio generation runs against a scripted CLI.
        Say that the generation you show is scripted, because otherwise you are implying model evidence
        you do not have.
      - **live demo**: a coding CLI is logged in, or `FORGE_MUSE_API_KEY` will be delivered over stdin.
        Know the call budget before you start, and never paste a key into a chat window.

## The beats

Play them in this order; it is the order the journey gate walks.

**1. Open the Studio and name the project.**
Expected: the Studio is the surface you land on; the project heading shows the project you opened; the
coding provider line shows what is configured (`scripted-muse (configured)` offline, or the configured
model name live).
Proves: the product knows which project you are in, and tells you what powers generation.

**2. Describe an application with an empty form.**
Expected: the Generate control is disabled with nothing typed; submitting an empty prompt through the API
is refused and starts no job, and the refusal names the field and the rule
(`prompt: Too small: expected string to have >=10 characters`).
Proves: refusals are refusals, and they explain themselves.

**3. Generate.**
Expected: the job runs; the status reports the model identity the CLI reported
(`reported model scripted-muse` offline); the staged version is labelled `staged — not approved` in the
preview tab bar.
Proves: nothing reaches your approved version without your decision.

**4. Read the change, then read the Dependencies block.**
Expected: for a Phaser game the block says the engine is bundled in these bytes; for a document that
references a remote host it says that host must answer when the artifact runs; if verification refused a
request it says the request was blocked, so a passed load check never saw that dependency. The block also
states what it cannot see.
Proves: the approval decision is made about bytes, not about a model's description of them (KI-74).

**5. Approve.**
Expected: `First version approved.` then `v1 approved` in the version history, with `current` beside it.
Proves: publication is an explicit act, and the version list reflects it.

**6. Look at it.**
Expected: the preview iframe shows the application you approved. For a self-contained document, no remote
origin is requested at all.
Proves: the document that passed verification is the document that runs (KI-79, KI-53).

**7. Take it away.**
Expected: *Copy source* puts the artifact bytes on the clipboard; *Download HTML* downloads the same
bytes. The gates hash both and compare with the endpoint's own recorded hash.
Proves: the handover is not stale — the defect class a human reviewer found inside a generated application
(KI-88) is measured here and clean.

**8. Come back.**
Expected: reload keeps the project and its current version reachable.
Proves: your session is not the only place the state lives.

**9. Change it, then go back.**
Expected: an empty change request is refused (`request: Too small: expected string to have >=3 characters`);
a real one stages a new version, the rail offers `Approve & publish v2`, and after approving, the bytes the
endpoint serves change. Then *Undo last change* → the confirmation asks **"Restore v1 as the current
version?"** and adds that the restore itself cannot be undone from that screen.
Proves: versions are recoverable, and the product does not pretend the recovery is free.

**10. Do it on a phone.**
Expected: at 390 px the document does not overflow, the tabs, prompt field, primary action and download
control have usable boxes inside the viewport, and switching panels changes what is displayed.
Proves: the beta journey is completable on a small screen, measured rather than assumed.

## Optional beats that cost money

Say the cost out loud before starting, and keep the receipts afterwards.

- **Live image → coding → artifact chain**: one `/v1/images/generations` and one `/v1/images/edits`, no
  other media path, no retries (`FORGE_MEDIA_MAX_RETRIES=0`), three coding jobs. Proven at
  `test-results/media-live/2026-11-02T13-53-08`.
- **SAM object extraction on a real photo**: suggest → cutout with alpha preserved → insert → approve →
  coding job → restart → rollback. Proven at `test-results/batchc-live/2026-11-01-0755`.
- **Voice/video and screenshot review**: transcription and clip, then one paid visual review whose replay
  is free. A second submission of the same review subject must cost nothing.

If a paid call fails, keep the failed attempt. A failed attempt is evidence about a real defect and about
what was spent; overwriting it destroys both.

## After the demo

- [ ] Record the evidence directories from the run, including the release-gate directory, and keep the
      earlier ones. Retained evidence is not rewritten.
- [ ] Write down anything the UI said that differs from the expected text above. A mismatch is a finding,
      not a rehearsal slip, even if the gate passed an hour earlier.
- [ ] Have a person fill the judgement rows in the review packet. The harness flags evidence quality and
      deliberately leaves app quality blank; a demo does not fill that in either.
