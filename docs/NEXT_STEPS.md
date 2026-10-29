# Next steps

**Current milestone:** post-hackathon local-beta hardening on an isolated branch.
The application remains local, single-user, and loopback-only. This list is the
repository's working backlog; completed items stay for the audit trail.

## P0 — before calling the beta reliable

1. **Reconcile Phase 17 when it finishes.** — **Done (2026-10-29).** Phase 17 is merged
   (`53389a7`, `36fe700`): 480 runs, locked protocol, exact-p correction and review
   disposition published, `pnpm verify:research17` retained. No unfinished run was treated
   as a finding.
2. **Run both CI gates before integrating the hardening branch.** — **Done (2026-10-29).**
   The `verify` and `browser` gates ran before PR #1 merged (`12918fd`); submission
   snapshots, research evidence and tags are unchanged.
3. **Add a repair/restore path for `state_corrupt`.**
   The server now refuses to present a malformed `state.json` as an empty project, which
   is correct but leaves the Studio unable to open that project until the file is fixed.
   Provide an explicit export/repair flow that preserves the damaged file and lets the
   user inspect job records.
4. **Isolate the Forge worker from the server user.**
   The environment allow-list and CLI sandbox flags reduce accidental exposure, but the
   child still runs with the server user's filesystem permissions. Move Forge to a
   dedicated OS user/container with only the staging directory mounted.

## P1 — next hardening

5. **Make job persistence power-loss safe.**
   Add `fsync` for the job/state file and containing directory if the beta needs stronger
   durability than atomic rename.
6. **Expand managed browser coverage.**
   Add visual snapshots, a second browser engine, accessibility assertions, and an
   interrupted-job restart scenario driven through the API. Keep live-model checks
   opt-in. Add observed Studio model identity persisted from CLI telemetry, if the
   protocol exposes it reliably.
7. **Remove the legacy raw `memoryBlock` input.**
   Freeze a local prompt snapshot for the Phase 15A historical protocol, then delete the
   raw input path from production prompt construction.
8. **Surface recovery issues in the System screen.**
   The Studio banner reports them; add a read-only recovery summary to the System status
   page for operators who do not open a project.

## P2 — explicitly out of scope for this milestone

- Authentication, hosted collaboration, multi-user namespaces, or network exposure.
- Embeddings/semantic retrieval, multi-file generation, or new model providers.
- Additional Decision Guard rule families; it remains advisory.
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
