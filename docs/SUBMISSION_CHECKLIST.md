# Submission checklist

Status: **submission cut recorded (2:50) and QA'd; the earlier 2:46 cut is retained as
the fallback; repository aligned with the current evidence; not yet submitted.** This file records
requirements, evidence, and the actions that still require the repository owner.

## Official requirements — what could and could not be verified

Sources: [event page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon),
[waiver page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) (renders
client-side; text not retrievable). `/rules`, `/official-rules`, `/terms` return 404.

| Requirement | Status |
| --- | --- |
| Event window | **Verified:** Oct 26 – Nov 4, 2026; submissions due **Nov 4, 9:00 PM ET** |
| Submission platform | Not stated on the reachable page; likely the Cerebral Valley submission form (link existed but rendered no form content) |
| Required Meta Muse usage | Implied by event scope; our integration uses Muse Code CLI throughout |
| Judging criteria | Track/theme descriptions only; no numeric rubric published |
| Repository access | **Not stated.** We have not assumed public access is required |
| Video requirements | **Not stated.** The submission cut is 2:50 (1920×1080) with burned-in captions and an SRT sidecar; the earlier cut is 2:46. |
| Licensing / disclosures | **Not stated** |
| Official Rules | Page says they "will be published"; not retrievable at review time |

Because the Official Rules were unavailable, this checklist marks visibility and submission as
**pending owner decision**, not as satisfied requirements. No submission has been made.

## Engineering checklist

- [x] Phases 1–5 implemented and committed (`349d86c`, `8579c26`, `a3ca8c7`, `0d9df42`, `cec4320`, `7ee9c96`)
- [x] Lint, typecheck, unit/integration tests, production build green
- [x] Live Muse tests green (`MML_LIVE_MUSE=1 pnpm test`)
- [x] Browser verification including generated form completion and submission; tool approval verified separately
- [x] Evaluation comparison with measured results and stated sample size
- [x] Integrated showcase 8/8 checks with real Muse (`docs/benchmarks/showcase.json`)
- [x] Security review: no active secrets (one historical test-fixture key rotated/revoked
      2026-10-27; see `docs/PHASE11_RELEASE_READINESS.md`), no tracked `.env`/databases, six
      bounded tools, no outbound HTTP from the app, generated UI is declarative data only
- [x] Documentation set (submission, evaluation, architecture, demo)
- [x] Phase 15B research published and integrated with provenance and deviation disclosures
- [x] Phase 16 / 16B research published with locked hashes, all outputs and `pnpm verify:research16`
- [x] Phase 17 four-arm trial published with locked protocol, retained records, review disposition,
      exact-p correction and `pnpm verify:research17`
- [x] Earlier cut (Ocean Pairs, 2:46) produced and QA'd; README and submission copy state
      that it predates the explicit-correction cut
- [x] Submission cut recorded from a live Muse Spark session (2:50, 1920×1080) and QA'd; committed
      with its QA, captions and transcript under `docs/demo/video/`; README and copy describe it
      accurately, including the failure beat
- [x] Focused correction storyboard and narration prepared, then recorded as the 2:50 cut:
      [`docs/demo/CORRECTABLE_MEMORY_DEMO.md`](demo/CORRECTABLE_MEMORY_DEMO.md)
- [x] Live FocusFlow generation, modification and refusal evidence preserved
- [x] Cross-origin state-mutation guard with regression tests and browser reproduction
- [x] No feature work beyond the approved scope
- [x] Repository made public on 29 October 2026 (still confirm against the Official Rules) **(owner)**
- [x] Demo video committed under `docs/demo/video/` and linked from the README
- [x] User guide published under [`docs/guide/`](guide/README.md) and linked from the README
- [x] One-click Codespaces environment for judges (offline provider, seeded demo) under
      [`.devcontainer/`](../.devcontainer/README.md), with a README badge
- [x] Project website published at [sidonsoft.github.io/muse-recall-website](https://sidonsoft.github.io/muse-recall-website/): a
      static landing page with the 2:50 video, not a hosted copy of the app
- [ ] Submission form completed on the platform **(owner)**
- [ ] Official Rules accepted if required **(owner)**

## Manual actions before submission

1. Read the Official Rules on the submission platform; confirm visibility, video length, and
   required disclosures.
2. Done 29 October 2026: `sidonsoft/muse-recall` is public, so judges can open the repository,
   the committed video and the evidence without being granted access.
3. The submission cut `Muse_Recall_Demo_V21_1080p.mp4` (2:50.47, SHA-256
   `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308`, 36-cue SRT sidecar) is
   committed under `docs/demo/video/` and linked from the README's opening section. If the form
   needs a video URL, use its GitHub link (the repository is public), the
   [project website](https://sidonsoft.github.io/muse-recall-website/) (which plays the same cut and is reachable now), or upload it to a
   video host. If that cut is not approved, upload
   the 2:46 video instead and keep the README's fallback wording. Describe whichever cut is
   uploaded accurately: the 2:50 cut includes the correction and its failure beat; the 2:46 cut
   does not show an explicit correction.
4. Submit the repository URL, video URL, and the description in
   `docs/submission/SUBMISSION_COPY.md`.
5. Claim significance only for the Phase 17 contrasts, within their stated limits; Phase 16 / 16B
   is earlier, narrower evidence. Use the corrected exact p-values, not the original as-run values,
   and keep the correction percentages described as release of the superseded restriction — not as
   full compliance with the new instruction. The memory-versus-inline evaluation uses n=4 per
   configuration and supports no significance claim.

## Deployment limitations (must be disclosed)

This is a **loopback-only development application**. It has no authentication, no per-user
isolation, and no rate limiting. A server-side Origin guard rejects foreign and `null` origins on
state-changing routes, but that is not authentication. It must not be exposed to a public network
or presented as a multi-user hosted product. See `docs/security.md` and
`docs/release/CROSS_ORIGIN_SECURITY_FIX.md`.
