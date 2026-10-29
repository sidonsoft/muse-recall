# Deferred improvements — after the hackathon

Nonessential changes found during the 29 October 2026 housekeeping pass. None blocks
submission. Ordered roughly by value.

| # | Improvement | Why deferred |
| --- | --- | --- |
| 1 | Show a distinct "could not load this project" state when the project load fails (HTTP 500) instead of the empty-project panels. (Audit M-6) | UX change across Studio panels; error banner already shows. |
| 2 | Isolate `verify:browser` test memories from the seeded `forge-demo` project (own project id or own DB by default). (M-7) | Changes a verification script's data model; workaround is re-seeding. |
| 3 | Vendor Phaser (or bundle it) for the seeded demo so the game renders offline. | Changes the recorded demo baseline, which is hashed evidence. |
| 4 | Rename internal identifiers from `muse-memory-lab` / `@mml/*` to Muse Recall, with a DB-path migration. (L-5) | API contract literal and existing users' DB filename. |
| 5 | Upgrade the website to vite 6+ to clear the dev-server esbuild advisory. (L-9) | Breaking upgrade; do it after the website moves into this repo. |
| 6 | Decide whether to adopt "The memory your project keeps" as a tagline. README and website currently share "Correctable project memory for AI-built software", so the story is already consistent. | Copy decision for the owner; changing it touches README, website, video poster wording and submission copy together. |
| 7 | Split the web bundle (lazy-load Memory/Conversations/System) and drop the 2.1 MB production source map from the build output. (L-7) | Local app; no measurable judge benefit. |
| 8 | Consolidate the 37 top-level files in `docs/` into `docs/history/` with redirects. | Many are cited by evidence and by commit permalinks; moving them breaks links. The docs index already routes judges. |
| 9 | Remove or relabel unused exports flagged by `knip`. (L-8) | Most are exported for tests and diagnostics. |
| 10 | Add a lightweight per-route rate limit even for loopback. | Single-user local app; job-level caps already bound cost. |
| 11 | Normalise the two `protocol*.sha256` files to a single path base. (L-11) | Protected evidence; would need a new manifest, not an edit. |
| 12 | Delete merged, unreferenced branches (list in the audit). (L-6) | Needs owner approval. |
