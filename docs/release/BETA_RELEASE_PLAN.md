# v0.1.0 beta release plan

On 4 November 2026 the owner authorized: “Promote the verified beta and README to main, then publish v0.1.0.” This supersedes the earlier freeze on main. Versions already read 0.1.0, so no version bump is required.

1. Assemble the full local integration beta, refreshed README, final three-minute demo and factual website updates in a candidate branch.
2. Run lint, product/test typechecks, tests, research evidence verification, ten offline production gates and website checks. Preserve checksummed evidence and frozen tags.
3. Merge the candidate into integration through a squash PR after required checks pass.
4. Promote integration to main through PR #269 with a merge commit after required checks pass. Publish the updated website.
5. Verify production gates on the resulting main commit. Publish v0.1.0 on that exact commit, with release notes, source archive, checksums and commit-specific verification evidence.
6. Check public release assets, demo bytes, website deployment and preservation of existing frozen tags.

[Release notes](notes/v0.1.0-beta.md) describe the first beta. Editorial sources and intermediate video renders stay outside the repository; final media retains its existing public paths.

The beta release does not send a hackathon form, create a submission tag or establish a submission date. The [submission template](notes/submission-2026-11-04.md) must be updated separately if an actual submission is made.
