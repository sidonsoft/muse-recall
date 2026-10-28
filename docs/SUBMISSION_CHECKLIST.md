# Submission checklist

Status: **V15 video produced and QA'd; repository aligned with it; not yet submitted.** This file records requirements,
evidence, and the actions that still require the repository owner.

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
| Video requirements | **Not stated.** The V15 video is 2:46, 1920×1080, with an SRT caption file |
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
- [x] Documentation set (submission, evaluation, architecture, demo, canonical storyboard)
- [x] Phase 15B research published and integrated with provenance and deviation disclosures
- [x] Phase 16 / 16B research published with locked hashes, all outputs and `pnpm verify:research16`
- [x] V15 demonstration video (Ocean Pairs, 2:46, SHA-256 `2bf1a78e4800…`) produced and QA'd; README and submission copy match it
- [x] Live FocusFlow generation, modification and refusal evidence preserved
- [x] Cross-origin state-mutation guard with regression tests and browser reproduction
- [x] No feature work beyond Phase 5 scope
- [ ] Repository visibility confirmed against the rules **(owner)**
- [ ] V15 video uploaded, and its link added to the README **(owner)**
- [ ] Submission form completed on the platform **(owner)**
- [ ] Official Rules accepted if required **(owner)**

## Manual actions before submission

1. Read the Official Rules on the submission platform; confirm visibility, video length, and
   required disclosures.
2. If judges must open the repository, make `sidonsoft/muse-recall` public or grant access.
   Nothing else in the project depends on visibility.
3. Upload the V15 video (and its SRT captions, if the platform accepts them), then add the link
   where the README's opening section marks it.
4. Submit the repository URL, video URL, and the description in
   `docs/submission/SUBMISSION_COPY.md`.
5. Claim significance only for the Phase 16 / 16B contrasts, within their stated limits. The
   memory-versus-inline evaluation uses n=4 per configuration and supports no significance claim.

## Deployment limitations (must be disclosed)

This is a **loopback-only development application**. It has no authentication, no per-user
isolation, and no rate limiting. A server-side Origin guard rejects foreign and `null` origins on
state-changing routes, but that is not authentication. It must not be exposed to a public network
or presented as a multi-user hosted product. See `docs/security.md` and
`docs/release/CROSS_ORIGIN_SECURITY_FIX.md`.
