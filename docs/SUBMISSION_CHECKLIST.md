# Submission checklist

Status on 4 November 2026: **v0.1.0 published; the hackathon entry exists.** The original entry
was confirmed at **2026-10-29T11:01:12Z**, and the beta update to that entry was **verified
persisted at 2026-11-04T01:30:03Z** by reloading the submission page and reading the saved state
back (owner-side verification: the platform cannot be read from this repository, the precise save
time is not established, and the stored field values are not re-verified here). Two things are
**not** on record: which commit stood behind the entry on those dates — the entry stores the
unversioned repository URL, so it pinned no commit — and any published tag or archive naming that
submitted tree. A dated archive of the `main` snapshot observed at the 4 November verification
exists and is unpublished (`5770303…`, SHA-256 `f9863520…6aae`); [the preservation
manifest](release/SUBMISSION_PRESERVATION.md) separates what each artifact can and cannot claim.
The repository is public and the static website is deployed. A hosted application is not required
by the Discord guidance supplied by the owner. The local application runs from the public
repository; the website is a landing page, not a hosted app.

## Current release and demo

- [x] Full beta and README promoted to main; v0.1.0 tagged at `707921db83a374d155d3929ef9b99092bcd4e8f1`.
- [x] [Release](https://github.com/sidonsoft/muse-recall/releases/tag/v0.1.0) includes source, checksums and an exact-commit ten-gate report/evidence archive; zero provider calls in those offline gates.
- [x] Public setup instructions support offline browsing and explain the separate live CLI and media credentials.
- [x] Current published demo: exactly **180.000 seconds**, 1920×1080, 30 fps; **14,903,823 bytes**; SHA-256 `d1695c04fbac57779f14be7d834478b86e868291d0f326710cc62dc5fe3a440d`; 57 caption cues; Bella narration on Eleven v4. [Video, transcript, poster and QA](demo/video/V21_QA.md).
- [x] Website and repository serve identical video bytes. Two older cuts belong to history, not to the current path: the 2:50.47 / `4020c0c6…` file at commit `c32d03b`, and the 3:00 / `6c9e985c…` cut published with the v0.1.0 release at `707921d` (that tag and its assets are unchanged).
- [x] Recut published on 4 November against the latest owner-supplied Discord guidance: it opens with the owner-confirmed statement that no product code existed before the event, leads with the recorded generate → review → reject → correct → approve loop, keeps about 156.6 of its 180 seconds on moving product or terminal footage, names the model roles (Muse Code CLI for application generation and change, Meta model APIs for media) and the Meta SAM cutout workflow, is English, and runs exactly 3:00. Beat-level provenance and evidence classes are in [V21_QA.md](demo/video/V21_QA.md).
- [ ] Owner decides whether that cut satisfies the guidance point about **live Meta calls being visible**. Two facts must not be merged. The footage does contain live calls: the first minute is labelled on screen as "Recorded live Muse Spark · actual CLI requests and results", showing the CLI request, the running job and the returned application. What did not happen is new inference calls **while assembling** the cut — that is production provenance, and the later beats are labelled retained media outputs, product replays or deterministic fixtures. Whether the guidance asks for calls performed live while recording, or recorded calls made visible on screen, is the owner's reading to make. Nothing here claims Official-Rules compliance: the entry exists (29 October, updated 4
November), while the rules-acceptance item below stays open.

### Publication and judge-link verification (4 November, after promotion)

The website branch merged to `integration` as `3fdab13` (PR #273), a one-sentence accuracy fix followed as `f28f1ba` (PR #275), and both were promoted to `main` by PR #274 (`08eeb6a`) and PR #276 (`36938f5`). The Pages workflow ran on the pushed `main`: `qa`, `gecko`, `build-pages` and `deploy` all succeeded (run 41749990101; `build-pages` 00:52:54 → 00:53:06 and `deploy` 00:53:10 → 00:54:10 UTC on 4 November), so **the live landing page and the live demo file are the current cut, not the 4 November release cut**.

Checked against the live site and the raw `main` paths, not the local build:

| Judge entry point | Result |
| --- | --- |
| `https://sidonsoft.github.io/muse-recall/video/muse-recall-demo.mp4` | 200 · 14,903,823 B · SHA-256 `d1695c04…40d` — the Bella / Eleven v4 cut |
| `https://github.com/sidonsoft/muse-recall/blob/main/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true` (README link) | 200 · same 14,903,823 B, same SHA-256 — the two paths are byte-identical |
| `https://raw.githubusercontent.com/sidonsoft/muse-recall/main/website/public/video/muse-recall-demo.mp4` | 200 · same SHA-256 |
| Poster / WebVTT / transcript | 200 · 122,193 B · 57 cues, SHA-256 `39e11c69…` · 2,835 characters, SHA-256 `94742542…` |
| Playback in a browser (desktop 1280 px and iPhone 12 Pro 390×844) | `readyState=4`, duration reads exactly **3:00**, seek to 1:42–1:43 shows the Meta SAM chapter card with the alpha-checkerboard cutout, burned-in caption renders **once** (the sidecar track is `disabled` by design), player position 1:43 |
| Mobile layout and navigation | no horizontal overflow (scrollWidth == clientWidth at 390 px), video box 325 px inside the viewport, mobile menu is a native `<details><summary>Menu` with section links, first tab stop is "Skip to content" and its target exists |
| Copy that was live-checked | the Watch footnote now names both historical cuts by reference (3:00 at tag `v0.1.0`, 2:50.47 at commit `c32d03b`) and states neither is a submission record — the earlier wording called the 2:50 file a "submission cut" |

#### Superseded on 4 November by the demo-section cleanup (PR #279, promoted by #280)

The last row above describes the page **before** the demo-section cleanup. PR #279 squashed to
`integration` as `d65f674214ed113c5b43e4cfa28da0a4d5714e90` and PR #280 promoted it to `main` as
`be8eb97a373fa8385a0f0cd292f5d575cea18b62`; that is also the first merge that could publish anything,
because `website.yml` builds and deploys only on a push to `main`. The Watch footnote is gone: the
section now carries one product sentence, the full-width player, four links (**Download video ·
Captions · Transcript · Recording details**, the last pointing at `main`'s `V21_QA.md`) and one scope
line naming recorded live calls, retained outputs and labelled replays. The historical cuts are named
only in [V21_QA.md](demo/video/V21_QA.md). Nothing on the page discusses submission any more, and
`qa.mjs` now fails if submission commentary returns to `#watch`.

Re-checked against the live site after website workflow run `41774329864` (`build-pages` ✓,
`deploy` ✓): `index.html` 143,797 B with the QA badge at **34/34**; MP4 200 · **14,903,823 B ·
`d1695c04…40d`** — identical to the `main` tree, byte-for-byte unchanged by the cleanup; poster
122,193 B; WebVTT 4,556 B; transcript 2,861 B. No media path appears in that diff.

## Guidance and remaining owner actions

The owner supplied Discord guidance on 4 November: a hosted app is optional; judges need a runnable public repo and a demo of three minutes or less. Marketing production tools are distinct from models called by the product at runtime. Product runtime model calls must use Meta models. This records the supplied guidance, not independent verification of the complete Official Rules.

The owner confirmed: **no existing product code before the event; Muse Recall was built during the event.** Use that disclosure in the recut opening.

- [ ] Owner opens the Codespaces path once if choosing to offer it to judges. It supports seeded offline browsing; live generation still needs the documented CLI setup.
- [ ] Owner reviews and accepts the Official Rules on the submission platform if required.
- [x] Owner submits the repository URL, final video URL and accurate [submission copy](submission/SUBMISSION_COPY.md) through the platform. Done: the original entry was confirmed on 29 October 2026 and the beta update to it was verified saved on 4 November 2026. Which exact text and video URL the platform now holds is not readable from here, so this records the owner's confirmation rather than a repository-side re-check.
- [ ] Record the submission time, any receipt, and — if the platform still shows them — the field values of the 29 October entry and the 4 November update. Publishing v0.1.0 is not submission. **The commit that stood behind the entry on either date was never recorded, so the original submitted commit is unknown**; do not back-fill a plausible-looking SHA.
- [ ] Preserve the submitted tree with a submission tag and an archived Release. Separate unfinished work, and it cannot be pinned honestly while the submitted commit is unknown: recovering the platform-side record comes first.

The earlier recorded deadline is 4 November 2026, 9:00 PM ET; confirm it on the platform. Keep existing frozen submission/research tags and checksummed evidence unchanged. A new submission tag must identify the actual submitted tree. Checked against the remote on 4 November: `git ls-remote --tags origin` lists `v0.1.0`, `submission-v14`, `submission-v15`, `phase17-preregistration` and `archive/*` — there is **no** `submission-2026-11-04` tag yet, so no document may describe it as existing. That absence is unfinished preservation work, not evidence that no submission happened: the entry itself predates every one of those tags.

## Product boundaries to disclose

Single-user beta with default loopback binding and optional shared bearer access; no accounts or hosted collaboration. Live inference sends selected inputs to the configured provider. The coding CLI runs under the server user and its own policy. Approval checks loading, not every interaction or output quality; Guard and screenshot review are advisory. See [limitations](guide/limitations.md), [security](../SECURITY.md) and [recording provenance](demo/video/V21_QA.md).
