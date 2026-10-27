# Submission checklist

Status: **not yet submitted**. This file records requirements, evidence, and the actions that
still require the repository owner.

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
| Video requirements | **Not stated.** We prepared a 3-minute storyboard as a safe default |
| Licensing / disclosures | **Not stated** |
| Official Rules | Page says they "will be published"; not retrievable at review time |

Because the Official Rules were unavailable, this checklist marks visibility and submission as
**pending owner decision**, not as satisfied requirements. No submission has been made.

## Engineering checklist

- [x] Phases 1–5 implemented and committed (`349d86c`, `8579c26`, `a3ca8c7`, `0d9df42`, `cec4320`, `7ee9c96`)
- [x] Lint, typecheck, unit/integration tests, production build green
- [x] Live Muse tests green (`MML_LIVE_MUSE=1 pnpm test`)
- [x] Browser verification (28 checks) including generated form completion and submission; tool approval verified separately
- [x] Evaluation comparison with measured results and stated sample size
- [x] Integrated showcase 8/8 checks with real Muse (`docs/benchmarks/showcase.json`)
- [x] Security review: no active secrets (one historical test-fixture key rotated/revoked
      2026-10-27; see `docs/PHASE11_RELEASE_READINESS.md`), no tracked `.env`/databases, six
      bounded tools, no outbound HTTP from the app, generated UI is declarative data only
- [x] Documentation set (submission, evaluation, architecture, demo, storyboard)
- [x] No feature work beyond Phase 5 scope
- [ ] Repository visibility confirmed against the rules **(owner)**
- [ ] Video recorded and uploaded **(owner; storyboard ready)**
- [ ] Submission form completed on the platform **(owner)**
- [ ] Official Rules accepted if required **(owner)**

## Manual actions before submission

1. Read the Official Rules on the submission platform; confirm visibility, video length, and
   required disclosures.
2. If judges must open the repository, make `sidonsoft/muse-recall` public or grant access.
   Nothing else in the project depends on visibility.
3. Record the 3-minute video from `docs/VIDEO_STORYBOARD.md` on a fresh database, following
   `docs/DEMO_SCRIPT.md`.
4. Submit the repository URL, video URL, and the description in
   `docs/HACKATHON_SUBMISSION.md`.
5. Do not claim benchmark significance: the evaluation uses n=4 per configuration.

## Deployment limitations (must be disclosed)

This is a **loopback-only development application**. It has no authentication, no per-user
isolation, and no rate limiting. It must not be exposed to a public network or presented as a
multi-user hosted product. See `docs/security.md`.
