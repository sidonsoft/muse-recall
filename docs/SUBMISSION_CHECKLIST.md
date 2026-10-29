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
- [x] Submission cut recorded from a live Muse Spark session (2:50, 1920×1080) and QA'd; kept out
      of git by policy, QA kept alongside the video outside git; README and copy describe it
      accurately, including the failure beat
- [x] Focused correction storyboard and narration prepared, then recorded as the 2:50 cut:
      [`docs/demo/CORRECTABLE_MEMORY_DEMO.md`](demo/CORRECTABLE_MEMORY_DEMO.md)
- [x] Live FocusFlow generation, modification and refusal evidence preserved
- [x] Cross-origin state-mutation guard with regression tests and browser reproduction
- [x] No feature work beyond the approved scope
- [ ] Repository visibility confirmed against the rules **(owner)**
- [ ] Demo video uploaded, and its link added to the README **(owner)**
- [ ] Submission form completed on the platform **(owner)**
- [ ] Official Rules accepted if required **(owner)**

## Manual actions before submission

1. Read the Official Rules on the submission platform; confirm visibility, video length, and
   required disclosures.
2. If judges must open the repository, make `sidonsoft/muse-recall` public or grant access.
   Nothing else in the project depends on visibility.
3. Upload the submission cut `Muse_Recall_Demo_V21_1080p.mp4` (2:50.47, SHA-256
   `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308`, 36-cue SRT sidecar) and
   add the link where the README's opening section marks it. If that cut is not approved, upload
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
