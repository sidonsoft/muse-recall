# Submission checklist

Status on 4 November 2026: **v0.1.0 published; hackathon not yet submitted.** The repository is public and the static website is deployed. A hosted application is not required by the Discord guidance supplied by the owner. The local application runs from the public repository; the website is a landing page, not a hosted app.

## Current release and demo

- [x] Full beta and README promoted to main; v0.1.0 tagged at `707921db83a374d155d3929ef9b99092bcd4e8f1`.
- [x] [Release](https://github.com/sidonsoft/muse-recall/releases/tag/v0.1.0) includes source, checksums and an exact-commit ten-gate report/evidence archive; zero provider calls in those offline gates.
- [x] Public setup instructions support offline browsing and explain the separate live CLI and media credentials.
- [x] Current published demo: exactly **180.000 seconds**, 1920×1080, 30 fps; **14,903,823 bytes**; SHA-256 `d1695c04fbac57779f14be7d834478b86e868291d0f326710cc62dc5fe3a440d`; 57 caption cues; Bella narration on Eleven v4. [Video, transcript, poster and QA](demo/video/V21_QA.md).
- [x] Website and repository serve identical video bytes. Two older cuts belong to history, not to the current path: the 2:50.47 / `4020c0c6…` file at commit `c32d03b`, and the 3:00 / `6c9e985c…` cut published with the v0.1.0 release at `707921d` (that tag and its assets are unchanged).
- [x] Recut published on 4 November against the latest owner-supplied Discord guidance: it opens with the owner-confirmed statement that no product code existed before the event, leads with the recorded generate → review → reject → correct → approve loop, keeps about 156.6 of its 180 seconds on moving product or terminal footage, names the model roles (Muse Code CLI for application generation and change, Meta model APIs for media) and the Meta SAM cutout workflow, is English, and runs exactly 3:00. Beat-level provenance and evidence classes are in [V21_QA.md](demo/video/V21_QA.md).
- [ ] Owner decides whether that cut satisfies the guidance point about **live Meta calls being visible**: the cut shows recorded and retained calls plus labelled replays and fixtures, and made **no new Meta calls during assembly**. It has not been declared compliant with the Official Rules, and submission has not happened.

## Guidance and remaining owner actions

The owner supplied Discord guidance on 4 November: a hosted app is optional; judges need a runnable public repo and a demo of three minutes or less. Marketing production tools are distinct from models called by the product at runtime. Product runtime model calls must use Meta models. This records the supplied guidance, not independent verification of the complete Official Rules.

The owner confirmed: **no existing product code before the event; Muse Recall was built during the event.** Use that disclosure in the recut opening.

- [ ] Owner opens the Codespaces path once if choosing to offer it to judges. It supports seeded offline browsing; live generation still needs the documented CLI setup.
- [ ] Owner reviews and accepts the Official Rules on the submission platform if required.
- [ ] Owner submits the repository URL, final video URL and accurate [submission copy](submission/SUBMISSION_COPY.md) through the platform.
- [ ] Record the actual submitted commit, video identity, submission time and receipt only after submission. Publishing v0.1.0 is not submission.

The earlier recorded deadline is 4 November 2026, 9:00 PM ET; confirm it on the platform. Keep existing frozen submission/research tags and checksummed evidence unchanged. A new submission tag must identify the actual submitted tree.

## Product boundaries to disclose

Single-user beta with default loopback binding and optional shared bearer access; no accounts or hosted collaboration. Live inference sends selected inputs to the configured provider. The coding CLI runs under the server user and its own policy. Approval checks loading, not every interaction or output quality; Guard and screenshot review are advisory. See [limitations](guide/limitations.md), [security](../SECURITY.md) and [recording provenance](demo/video/V21_QA.md).
