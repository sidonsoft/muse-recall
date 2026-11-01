# Batch E — visual and decision-change review

Batch E adds three things around the decisions a project already keeps: advisory
feedback about a screenshot, an inspectable history of what each approved
generation was actually told, and an update proposal that carries the decisions
the user picked. Nothing in Batch E approves, rewrites, or re-runs anything by
itself.

## What is on screen

**Decision review** (Studio left column)

- Lists the accepted, current decisions for the project, each pinned to the
  revision the row displays (`rev 3`).
- `Review this screenshot` is opt-in and only enabled once a frame has been
  captured and at least one decision is selected.
- Findings render with what the model pointed at in the frame, what a single
  still frame cannot prove, and the model's own self-reported confidence.
- A selected decision the answer skipped is listed as **not assessed**. It is
  never upgraded to "consistent".
- An answer entry that describes a decision nobody selected is counted and
  dropped, not treated as feedback.
- The panel shows the fingerprint of the exact frame that was reviewed and, when
  the review was attached to one, the approved generation it was reviewed beside.

**Generations** (Studio left column)

- Lists approved generations newest first, with the decision reference stored at
  creation time: id, revision, hash of the stored text, and — when they differ —
  the hash and excerpt of the bytes actually placed in the prompt.
- Each generation carries one label: **Received previous decision**,
  **Potentially affected**, or **Matched current decision**, plus the reason and
  the decisions that moved since it ran.
- A generation created before references existed says its relationship is
  **unknown**, never that it was given nothing.
- The comparison limits print on the same screen as the labels. There is no
  approve, restore, or regenerate control in this panel.

**Update proposal** — the normal prompt-panel proposal now sends the selected
decisions, pinned to revisions. The staged change still requires you to review
and approve it.

## Labels are records, not claims

The two labels for stale guidance are deliberately non-causal:

- `received_previous_decision` — the stored record proves the generation was
  handed wording that is no longer current.
- `potentially_affected` — the generation could not have received a decision that
  did not exist when it ran, or no reference was stored. Coverage is unknown.

Nothing may say a decision caused, influenced, or shaped what a generation did.
The limits text travels inside every comparison payload, and the UI prints it
beside the labels rather than in a footnote.

A decision corrected after a generation ran does not change that generation. Only
a new job can use current guidance.

## Stored text versus injected text

A decision reference distinguishes three things that earlier work conflated:

| field | meaning |
| --- | --- |
| `content_sha256` | hash of the stored record's text at supply time |
| `injected_sha256` / `injected_excerpt` | the exact bytes placed in the prompt |
| `injected_truncated` | retrieval or the selection cap shortened the text |

A truncated reference records only the injected prefix, and the panel says so.
Excerpts run through credential redaction; the hash stays over the raw text so a
later in-place edit is detectable.

## Retired is not revised

A decision deleted, purged, or expired is **retired**, not "revised in place".
`compareGeneration` checks the record's status and expiry, and a retired drift
entry carries `current_status` (`deleted`, `expired`) with `current_excerpt: null`
even when the surviving row still holds readable wording — retired wording is
never rendered as current guidance the generation missed.

## Contracts

```
GET  /api/forge/projects/:id/generations      read-only listing + comparison
POST /api/forge/projects/:id/visual-review    advisory screenshot review
POST /api/forge/projects/:id/modify           accepts decisions: [{memory_id, expected_revision}]
```

The review request must pin every selection to a revision. This endpoint has no
older client to stay compatible with, so an id-only selection is refused: without
the pin the route could only review whatever wording the decision has now and
report it as the one the user chose. A mismatch is
`decision_revision_conflict` (409) **before** any provider dispatch.

`job_id` is optional. When supplied it must identify an approved generation of
this project: a queued, running, failed, or finished-but-unapproved run is a job,
not a generation, and naming one is `invalid_job_id` (404). The response echoes
the generation's identity so a reader can see which generation the frame was
reviewed beside. That is identity, not a verdict.

The review writes nothing: no Forge state, no version, no staging file, no job,
no memory. `artifact_changed` is always `false`, and the response carries provider
telemetry (`provider`, `observed`, `provider_attempts`) like every other media
call.

## How it is verified (all offline, no provider calls)

- `tests/unit/decision-reference.test.ts` — reference fingerprinting, injected
  versus stored text, retired-versus-revised classification, expiry, credential
  redaction, non-causal limit text.
- `tests/integration/forge-batche-generations.test.ts` — what a generation was
  handed, stale labels, current wording for new jobs, refusal of
  unselected/superseded/retired/revision-mismatched decisions, and proof that the
  listing restages, re-approves and creates nothing.
- `tests/unit/media-visual-review.test.ts` — only user-selected decisions are
  accepted; invented scope is counted and dropped; missing evidence or
  uncertainty becomes unverified; an unreported decision is never assumed
  consistent.
- `tests/integration/forge-batche-visual-review.test.ts` — the routes: findings
  with evidence and uncertainty, refusals that spend no provider call, the
  revision pin, generation binding, and a byte-for-byte artifact fingerprint that
  does not move.
- `tests/unit/studio-batch-e.test.ts` — the wording itself: label titles, the
  absence of causal phrasing, retired rows, truncation lines, and that the panels
  expose no mutating control.
- `pnpm verify:batche-review-ui` (19 checks) drives the **production** Studio
  build in managed Chromium against the real API with a stub review operation:
  the request pins the revision the row displayed and carries no decision text;
  the reviewed frame is the captured canvas (PNG 320×200 whose sha256 equals the
  fingerprint the panel prints); findings, gaps, and dropped entries render; the
  artifact sha, version count, job count and memory rows are identical
  afterwards; a decision edited under the screen is refused with a repair
  instruction and zero provider calls; a retired decision reads as retired and is
  no longer offered; a proposal carries the pinned revision and rejecting it
  leaves v1 byte-identical. Console clean, one deliberate 409, no non-local
  requests, two stub review calls, zero provider dispatches.

## Limits to keep honest

- Confidence is the model's self-report, never a measured accuracy.
- One still frame cannot show behaviour over time, interaction, or anything
  off-screen; findings describe that frame only.
- `unverified` means not assessed. It is not a pass.
- The generations listing is bounded (most recent 64) and reports truncation.
- Review feedback can be wrong. It is input to your next proposal, and the
  proposal still has to be reviewed and approved by you.
