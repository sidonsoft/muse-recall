# Cleanup changelog — 29 October 2026

Every change made on branch `claude/project-thread-kbe9t7`, with the reason. Nothing under
`docs/hackathon-evidence/` or `docs/demo/evidence/`, no research data, the demo video and its
fallback were touched. No history was rewritten and no branch was deleted.

| # | File(s) | Change | Why | Audit ID |
| --- | --- | --- | --- | --- |
| 1 | `apps/web/src/components/studio/StudioView.tsx` | Studio grid gets `auto-rows-max` below `xl` and `xl:auto-rows-auto` at desktop. | Rows were shrinking to zero inside the fixed-height scroller, so panels overlapped at tablet and phone widths. Desktop layout is byte-for-byte the same. | M-1 |
| 2 | `apps/web/src/components/TopBar.tsx` | `h-[58px]` → `min-h-[58px] py-2`; nav gets `overflow-x-auto`; nav buttons `shrink-0 whitespace-nowrap`. | Header wrapped on narrow screens but kept a fixed height, so the nav overlaid the page title and clipped "System". | M-2 |
| 3 | `apps/web/src/components/conversations/ConversationsView.tsx`, `apps/web/src/App.tsx` | Removed the unused `meta` prop and its `ServiceMeta` import; `maxLength={16_000}`. | Dead conditional (`meta?.phase ? 16_000 : 16_000`). Behaviour unchanged. | L-1 |
| 4 | `README.md` | Opening line links the live website (source repo in brackets) instead of "goes live with one Pages toggle". | Website is live. | H-1 |
| 5 | `README.md` | 2:46 cut row: "kept for the record; the 2:50 cut above is the submission video". | The 2:50 cut is published; "fallback if not published" was stale. | M-4 |
| 6 | `README.md` | Release state: repository is public (29 Oct); only the form remains. Status table splits "make public" (Done) from "submit the form" (pending). | Accuracy. | H-1 |
| 7 | `README.md` | System-screen sentence now says it reads *module* states from `/api/meta`. | The old wording implied the whole status table came from the API, which it does not. | — |
| 8 | `docs/SUBMISSION_CHECKLIST.md` | Visibility item ticked; manual step 2 records the repo is public; video-URL step no longer says "once public". | Accuracy. | M-3 |
| 9 | `docs/submission/EVIDENCE_MAP.md` | Gap 3 gains a dated "Resolved 29 October 2026" line; the original note is kept as written. | Keeps the record honest without rewriting it. | M-3 |
| 10 | `.env.example` | Header "Muse Memory Lab" → "Muse Recall". | Branding; comment only. | L-4 |
| 11 | `scripts/verify-forge.ts` | Doc comment uses `FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs"`. | The relative path makes `verify:forge` time out because the server's cwd is `apps/server`. Comment only. | L-3 |
| 12 | `.gitignore` | Ignore `__pycache__/` and `*.pyc`. | The research verifiers create them inside the evidence folders. | L-2 |
| 13 | `docs/release/housekeeping-2026-10-29/*` | Added the six housekeeping reports. | Deliverables. | — |
| 14 | `docs/README.md` | One line pointing to the housekeeping reports. | Discoverability without touching the judge-facing README. | — |

Reverting: every change is in ordinary commits on the branch; `git revert` of the PR's merge
commit restores the previous state exactly.
