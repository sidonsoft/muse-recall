# Next steps

**Current milestone:** hackathon submission (owner actions in
[SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)), then local-beta hardening. The hardening
branch merged to `main` in PR #1. The application remains local, single-user, and loopback-only. This list is the
repository's working backlog; completed items stay for the audit trail.

## P0 — before calling the beta reliable

1. **Reconcile Phase 17 when it finishes.** — **Done (2026-10-29).** Phase 17 is merged
   (`53389a7`, `36fe700`): 480 runs, locked protocol, exact-p correction and review
   disposition published, `pnpm verify:research17` retained. No unfinished run was treated
   as a finding.
2. **Run both CI gates before integrating the hardening branch.** — **Done (2026-10-29).**
   The `verify` and `browser` gates ran before PR #1 merged (`12918fd`); submission
   snapshots, research evidence and tags are unchanged.
3. **Add a repair/restore path for `state_corrupt`.** — **Done (2026-10-30).**
   The server now refuses to present a malformed `state.json` as an empty project, which
   is correct but leaves the Studio unable to open that project until the file is fixed.
   Provide an explicit export/repair flow that preserves the damaged file and lets the
   user inspect job records. Shipped on `integration`: `GET .../recovery/state` inspects
   damage (failure mode, bounded raw bytes, surviving versions, job listing) and
   `POST .../recovery/repair` archives the damaged bytes before rebuilding state from
   surviving approved versions (PR #32); the Studio banner wires both, and the managed
   browser workflow corrupts `state.json` live and repairs through the UI as a standing
   gate (PR #33, 35 checks). Repair refuses on a valid state (`state_valid`, 409).
4. **Isolate the Forge worker from the server user.**
   The environment allow-list and CLI sandbox flags reduce accidental exposure, but the
   child still runs with the server user's filesystem permissions. Move Forge to a
   dedicated OS user/container with only the staging directory mounted.

## P1 — next hardening

5. **Make job persistence power-loss safe.** — **Done (2026-10-30).**
   Add `fsync` for the job/state file and containing directory if the beta needs stronger
   durability than atomic rename. Every Forge atomic write now fsyncs the temporary file
   before its rename and syncs the containing directory after: job records, `state.json`,
   promoted version bytes plus the versions directory entry, recovery acknowledgements,
   and the repair archive rename. File syncs are strict (a failure is a write failure);
   directory syncs are best-effort and documented, because platforms that refuse
   directory fsync must not break writes that are still atomic.
6. **Expand managed browser coverage.** — **Partial (2026-10-30).**
   Done: a second browser engine (managed Firefox as a CI matrix leg; Chromium keeps
   the required-check name), accessibility assertions (banner/navigation/main
   landmarks, role=status live notices, dialog focus handoff), and an
   interrupted-job scenario driven live end to end — SIGKILL mid-generation, restart,
   UI interrupted notice, job record kept, queue recovers. Live-model checks remain
   opt-in. Visual snapshot comparison landed the same day: three timestamp-free
   Studio regions (navigation, Development panel, Decision Guard advisory) are compared
   against CI-recorded per-engine baselines with a pixel budget; drift failures upload
   actual+diff PNGs; non-Linux local runs skip the stage honestly. Remaining: observed
   Studio model identity persisted from CLI telemetry, if the protocol exposes it
   reliably.
7. **Remove the legacy raw `memoryBlock` input.** — **Done (2026-10-30).**
   Freeze a local prompt snapshot for the Phase 15A historical protocol, then delete the
   raw input path from production prompt construction. The historical wording is frozen
   in `scripts/lib/phase15a-prompt-snapshot.ts` (provenance recorded to `defe684`,
   byte-verified against the production builder at freeze time, and pinned by unit tests
   against the recorded fixtures); the production builder now renders structured
   retrieval records only, and the evaluation harnesses were switched to the structured
   path so measured prompts cannot drift from production again.
8. **Surface recovery issues in the System screen.** — **Done (2026-10-30).**
   The Studio banner reports them; add a read-only recovery summary to the System status
   page for operators who do not open a project. `GET /api/health` now carries a
   store-wide `forge` summary (storage state, open/acknowledged notice counts, current
   and startup interrupted-job counts, up to five issues), and the System screen renders
   it as a read-only panel. Acknowledgement and repair deliberately stay in the Studio
   project view.

## P2 — explicitly out of scope for this milestone

- Authentication, hosted collaboration, multi-user namespaces, or network exposure.
- Embeddings/semantic retrieval, multi-file generation, or new model providers.
- Decision Guard rule-family breadth: **extended (2026-10-30, v1.5.0)** with autoplay-media and
  external-assets plus 22 corpus cases; it remains advisory.
- A verified self-contained HTML export (downloaded files currently lose the sandbox).

---

## Historical plan (Phase 6, kept for the development record)

> This section is superseded by the backlog above. It is retained so the earlier
> submission plan is not rewritten.

Feature freeze was in effect for the hackathon submission.

1. Read the Official Rules on the submission platform; confirm repository visibility, video
   length, disclosures, and deadline (currently documented as Nov 4, 9:00 PM ET).
2. Repository visibility: the repository is being made public so judges can open it without
   authentication. Nothing in the code depends on visibility.
3. Record the 3-minute video using `docs/VIDEO_STORYBOARD.md` and `docs/DEMO_SCRIPT.md` on a
   fresh database.
4. Complete the submission form with the repository URL, video URL, and the description in
   `docs/HACKATHON_SUBMISSION.md`.
5. Do not claim statistical significance: the comparison uses n=4 per configuration.

Deferred at that time: embeddings/semantic retrieval, additional model providers,
shell/filesystem/network tools, multi-agent orchestration, authentication, and hosted
multi-user deployment.
