# Judge entry-point audit — 29 October 2026

**Goal.** A judge arriving at any entry point should understand Muse Recall's purpose within
15 seconds, see convincing evidence within 60 seconds, and know how to try it within 90
seconds. The three entry points are the GitHub README, the project website and the submission
text (the form itself is off GitHub; its text lives in
[`docs/submission/SUBMISSION_COPY.md`](../submission/SUBMISSION_COPY.md)).

The headline evidence is Phase 17, quoted from
[RESULTS.md](../hackathon-evidence/phase17/RESULTS.md) and
[STATS_CORRECTION.md](../hackathon-evidence/phase17/STATS_CORRECTION.md). No checksummed
evidence and no video file was changed.

## Findings and fixes

| Entry point | Target | Before | Fix |
| --- | --- | --- | --- |
| README | 15 s purpose | Met: title, tagline, two-sentence problem and product statement at the top. | Kept. |
| README | 60 s evidence | Phase 17 appeared only after a full-width screenshot and the video poster, as one sentence that did not say what was measured and mixed the result with its interpretation ("about as well as retyping the rule by hand"). | A **Headline result** section now sits directly under the product statement: what was measured (the two rules, the change requests, the detector fixed before the first run), a three-row table of observed counts, the exact p-values, and a separately labelled "How we read it" paragraph with the scope. |
| README | 90 s try it | Met for running the app (Codespaces badge, five-line local quickstart), but the website and video links were split across two paragraphs, and the evidence check (`pnpm verify:research17`) was buried in a 30-line command list. | One link row under the product statement: demo video, project website, Codespaces, and a new **Reproduce the evidence** section under "Try it" that explains what the verifier prints, including why its first block shows the preserved as-run p-values. Re-run on 29 October 2026: three `PASS` blocks, 1205/1205 hashes, counts as quoted. |
| Website | 15 s purpose | Met: headline, lede and "View on GitHub" in the first screen. | "Run it locally" button renamed **Try it** (the section also offers Codespaces). |
| Website | 60 s evidence | The four headline stats sat below the full-width hero screenshot, without saying what was measured, and one of the four tiles was the test count. | Stats moved above the screenshot. Tiles are now the two model results, the run count with exact p, and the retyped-by-hand comparison. A one-paragraph "What was measured" note follows, with links to the full table and to the README's reproduction steps. |
| Website | Links back | GitHub buttons existed, but nothing pointed to reproduction instructions, and the footer claimed the page mirrored commit `aaa70ca` (stale since the site moved into `website/`). | Quickstart adds `pnpm verify:research17` and links to the README's reproduce section, the full quickstart and the source. The footer now names the `website/` folder and adds a "Reproduce the evidence" link. |
| Submission copy | 15 / 60 s | Met within the word limits: purpose in the first sentence, Phase 17 counts in both descriptions. | Descriptions untouched (still 99 and 296 words). |
| Submission copy | 90 s try it | No links section: the repository, website, video and Codespaces URLs were not collected anywhere for the form. | New **Links for the form** table. |
| Submission copy | Accuracy | "Ocean Pairs in the current video" was stale; Ocean Pairs is the earlier 2:46 cut. | Corrected to name both cuts. |

Website QA after the change: `npm run qa` 26/26, LCP 912 ms, CLS 0, no horizontal overflow at
390 px. `npm run links` now also checks that README anchors the site links to (such as
`#reproduce-the-evidence`) exist, so a renamed heading is caught when the site checks run.

## Owner-only actions

- Paste the descriptions and the links table from the submission copy into the form.
- Open the Codespaces badge once to confirm the no-install path works end to end; it has not
  been tried in a real codespace.
- If the form needs a video-host link rather than the GitHub file, upload
  `docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4` and use that link.
