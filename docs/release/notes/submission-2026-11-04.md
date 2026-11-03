> **Unpublished submission template.** Publishing v0.1.0 does not submit the hackathon form or establish a submission date. Use the [v0.1.0 release notes](v0.1.0-beta.md) for the beta release. Update and verify this template separately if a submission is made.

# Release body: `submission-2026-11-04`

Paste-ready text for the GitHub Release created at submission time (step 2 of
[SUBMISSION_PRESERVATION.md](../SUBMISSION_PRESERVATION.md#steps-at-submission-time)).
Title: **Hackathon submission (v0.1.0 local beta)**. Target: `main` as it stands when the
form is sent. Leave "Set as a pre-release" **unticked** so this shows as the repository's
latest release; the "beta" label is carried by the title and body.

Replace `<SHA>` before publishing. Attach `muse-recall-submission-2026-11-04.tar.gz`.

---

Muse Recall is a local-first HTML Studio for Meta's Muse Spark. It remembers a project's
decisions, lets you correct them, and makes every generated change wait for your review.
This release is the exact tree submitted to the Meta AI Developer Hackathon on 4 November
2026 (commit `<SHA>`). It is a **local, single-user beta** (version 0.1.0): loopback by default,
no hosted service.

**Try it**

- In the browser, no install: https://codespaces.new/sidonsoft/muse-recall?quickstart=1
- Locally (Node 24, pnpm 10): `pnpm install && pnpm demo:seed && MODEL_PROVIDER=echo pnpm dev`
  (the offline `echo` provider needs no key)
- Demo video (3:00): [Muse_Recall_Demo_V21_1080p.mp4](https://github.com/sidonsoft/muse-recall/blob/submission-2026-11-04/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true)
- Website: https://sidonsoft.github.io/muse-recall/

**What is in it**

- Correctable project memory: decisions with provenance and confidence; a correction
  supersedes the old decision and only the replacement is retrieved later.
- Staged review: every change shows preview, source and diff; approve, reject or roll back.
  Approved versions are immutable.
- Advisory Decision Guard that cites the decisions behind each finding and never blocks approval.
- Durable Forge jobs with restart recovery and a managed browser verification workflow.

**Headline evidence.** In the pre-registered Phase 17 trial (480 runs, two models), retrieved
memory took rule violations from 37/57 to 0/58 on Muse Spark and from 49/60 to 1/60 on Muse
Spark Open, matching the rule retyped by hand. Reproduce with `pnpm verify:research17`;
details and limits in the [README](https://github.com/sidonsoft/muse-recall/blob/submission-2026-11-04/README.md#what-is-verified).

**Known limits.** Local single-user beta, no authentication on the default loopback
posture, one generated `index.html` per project. See
[KNOWN_ISSUES.md](https://github.com/sidonsoft/muse-recall/blob/submission-2026-11-04/docs/KNOWN_ISSUES.md).

**Verify this release**

```sh
git fetch origin --tags
test "$(git rev-parse 'submission-2026-11-04^{commit}')" = "<SHA>" && echo "tag OK"
sha256sum muse-recall-submission-2026-11-04.tar.gz   # compare with the value below
```

Archive SHA-256: `<to record>`
