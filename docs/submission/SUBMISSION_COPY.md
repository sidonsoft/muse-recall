# Muse Recall — submission copy

Copy for the submission form, written to match the V14 demonstration video (Ocean Pairs, 2:46).
Quantitative claims come from the Phase 16 / 16B trials, the Phase 11A reliability trials, the
Phase 12A memory-influence trial, the Phase 12D Guard accuracy audit, the Phase 14A verification
record, the live FocusFlow and Ocean Pairs demonstrations (2026-10-28), and the Phase 15B trial
(see [EVIDENCE_MAP.md](EVIDENCE_MAP.md)); nothing is extrapolated.

**Word limits.** 100-word description: **99 words** (limit 100). 300-word description: **281
words** (limit 300). Counts are whitespace-delimited; re-count after any edit.

---

## Project title

**Muse Recall — Build with Muse Spark. Remember what matters.**

## Tagline

AI-powered HTML development with persistent project memory.

## Short product description

Muse Recall is an HTML development workspace powered by Meta's Muse Spark. It enables developers to
generate, preview and iteratively improve working HTML applications using natural-language requests.

Persistent project decision memory helps maintain requirements across development iterations. An
independent advisory Decision Guard highlights potential conflicts, while human approval and rollback
preserve developer control.

## 100-word description

Muse Recall is a local-first HTML development workspace powered by Meta's Muse Spark. Describe an app and Muse Spark writes it; ask for a change and it edits the approved source. Project decisions persist across sessions, with provenance and correctable history, and reach every later change. Each change is staged: preview it and read the diff, then approve, reject or roll back. In pre-registered trials on two Meta models, a remembered child-safety rule took violations from 28 of 28 edits to 0 of 29; palette-only memory left 18 of 28. Muse Spark builds it. Recall remembers why. You decide.

## 300-word description

AI builders are fast at the first draft and weak at the second week: decisions vanish between sessions, so users re-explain constraints and find regressions later.

Muse Recall is a local-first HTML workspace powered by Meta's Muse Spark. Describe an app and Muse Spark writes one sandboxed index.html. The next request edits the approved source, and the change waits, staged, with a live preview, the exact source and a diff. Approve, reject, or roll back to the recorded parent. Before approval the server loads the staged file in headless Chrome and binds promotion to those bytes.

Recall stores project decisions with provenance and an append-only history. A correction supersedes old guidance without deleting it. Retrieval is budgeted and explainable, and every job records which decisions it was given and the SHA-256 of its prompt. An advisory Decision Guard cites remembered decisions against staged code; it never blocks approval.

In the demo, Ocean Pairs is a children's memory game built with one rule: no countdowns, flashing or penalties. Asked later for a countdown and a penalty, Muse Spark returned no change. A fitting change was reviewed, approved, then rolled back.

Does the remembered rule matter? Two pre-registered 48-run trials applied the same "make it more exciting" request to one game. Without memory, 28 of 28 usable edits added a countdown, flash or score penalty. With palette-only memory, 18 of 28 did. With the rule, 0 of 29 did, on both Muse Spark and Muse Spark Open (rule versus no memory, p < 10⁻⁶ on each). The violation detector was locked before the runs.

Limits: one game, one request, one rule; source code, not runtime safety; Decision Guard is advisory; single-user and loopback-only.

## Technical innovation summary

- **Correctable, supersedeable memory:** atomic transactional corrections with audit history;
  superseded decisions are excluded from retrieval, so stale constraints stop constraining.
- **Provable context:** one production prompt builder; every job records a prompt SHA-256 and the
  injected decision ids, and reconstruction reproduces the exact prompt bytes.
- **Modify-in-place HTML workflow:** staged single-file source, structural validation, a blocking
  load-time headless-Chrome gate, SHA-256 binding between verified bytes and promotion,
  compare-and-swap promotion, immutable versions, and rollback to the recorded parent.
- **Inspectable artifact:** a read-only endpoint returns approved or staged HTML with line count,
  byte size, title, version and SHA-256; the Studio renders it as escaped text and offers a
  disclosed download. The sandboxed preview remains the only renderer.
- **Advisory Decision Guard:** a deterministic, pure, dependency-free engine that checks staged
  source against the job's own decisions and cites them, including hexadecimal equivalence between
  CSS `#FF7E5F` and Phaser `0xFF7E5F`; its independent accuracy audit is why it stays advisory.
- **A controlled test of memory, on two models:** a three-arm design (no memory, palette-only,
  rule + palette) separates "the rule helps" from "memory helps"; a code-only violation detector
  locked before the runs; 96 outputs and a verifier that re-derives every count and p-value.
- **Cross-origin mutation guard:** state-changing routes reject foreign, `null` and malformed
  origins before any handler runs, so a cross-site page cannot approve, reject, roll back or cancel
  even though CORS hides its response.

## Problem / solution statement

**Problem:** AI builders lose project decisions between sessions, so users repeatedly explain
constraints, inspect unexpected changes, and repair regressions; transcripts do not say which fact
is current after a change of mind.

**Solution:** persistent project-scoped memory with provenance and correction, retrieval with hard
budgets and pinned constraints, and an HTML development loop over approved source (stage → validate
→ load-time browser gate → advisory decision check → human approval → version/rollback) in which the
generated application is previewable and its source inspectable.

## How Meta Muse is used

Muse Spark is the reasoning engine for the development loop: the Muse Code CLI on the Meta
subscription generates the original `index.html` and performs every subsequent modification, with
the project's pre-existing bounded contributor-API fallback. The memory layer, prompt construction,
validation, runtime check, artifact serving, and Decision Guard are deterministic infrastructure
built around the model — they make Muse Spark's output reviewable without replacing its work.

Muse Spark Open (`meta-models/muse-spark-open-1026`), served on Baseten, was used for research
only: the Phase 16B replication ran the same 48 cells through the production prompt builder. The
application itself does not call it.

## Technology stack

TypeScript monorepo (pnpm workspaces); Fastify API and React/Vite web client on loopback; SQLite
memory store with weighted retrieval and transactional supersession; Muse Code CLI as model
provider; Baseten inference for the Muse Spark Open replication; Playwright-driven headless Chrome
for the load-time gate; a pure TypeScript Decision Guard engine (`@mml/decision-guard`); Biome,
Vitest, and reproducible evidence scripts.

## Known limitations (stated plainly)

- Decision Guard is **advisory only** — it never blocks approval — and checks source patterns
  against supported rule families, not rendered behaviour or full semantics; it is not
  comprehensive compliance verification. Its false-positive/false-negative behaviour and abstention
  rates are measured and published.
- The runtime gate is load-time only: page/console errors, a blank render, and canvas creation for
  Phaser documents. It does not play the game, inspect pixels, exercise interactions, or guarantee
  that later use cannot fail.
- General HTML support is deliberately narrow: one self-contained file, no build step, inline CSS
  and JavaScript, and no network assets outside the approved CDN. It is not a general framework or
  package build environment.
- Exported HTML is the artifact, not a sandboxed or verified self-contained bundle. Opening it from
  disk runs it unsandboxed, and a document that references the CDN still needs network access.
- The live FocusFlow demonstration is a **retake**: attempt 1 was rejected after a sandbox form
  failure, and attempt 2 added a human-written sandbox instruction. It is not presented as an
  identical retry.
- FocusFlow model identity is **configured**, not independently observed in every job record.
  Retrieved memory is proven to be supplied but does not establish causation for a visual choice.
  Rollback was recorded as available but was not executed on FocusFlow.
- The Ocean Pairs refusal in the video is one live run. Its job records are not exported to the
  repository; the screen recording is the record.
- The live FocusFlow countdown refusal is one task-planner run. Decision Guard returned
  `not_verified` with zero findings; it did not detect or block anything in that run.
- Phase 16 / 16B is bounded: one baseline game, one request, one remembered rule, two models. It
  measures code mechanics, not runtime safety. The rule arm also carries the palette decision. On
  Muse Spark 11 of 48 runs were unusable; counting them as violations does not change the
  conclusion. Phase 16B used a chat completion rather than the CLI tool loop. Lock times are local
  file times, not an external registration.
- Phase 15B (earlier, superseded by Phase 16) is bounded: one configured Muse model, one game, one remembered rule, one request, edit
  path only. The original automated coder was not preserved; the corrected coder was produced after
  unblinding with narrower operational definitions. The corrected result is not confirmatory.
- The trial's memory arm carried the full project decision set (rule plus palette decisions), not
  one isolated memory item; retrieved memory ids were not recorded per run.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting. Host-header validation raises the cost of DNS rebinding, and the origin guard blocks
  cross-site mutations; neither is a substitute for authentication in a multi-user deployment.
- The demonstration video is V14 (2:46, 1920×1080), delivered separately from the repository. It
  replaces the V2 video described in [V2_VIDEO_PRODUCTION_MANIFEST.md](V2_VIDEO_PRODUCTION_MANIFEST.md)
  and [V2_VIDEO_QA_REPORT.md](V2_VIDEO_QA_REPORT.md), which are kept as historical records.

## Future roadmap

- Evidence-filtered enforcement: auto-act only on guard findings the audit shows are reliable, with
  explicit human override and an audit trail.
- Engine fixes targeted by the audit: 8-digit RGBA normalisation, tween-based flash detection,
  comment/prose false-positive reduction.
- Rendered-pixel and interaction checks beyond load-time verification.
- Verified self-contained export (asset inlining with an allowlist) before using that label.
- A larger real-output corpus for memory influence and guard accuracy.
- Multi-user deployment once authentication, CSRF protection and isolation exist.

## What is demonstrated vs future work

**Demonstrated:** Muse Spark generation and live modification of working HTML applications (Ocean
Pairs in the video; FocusFlow, a non-game planner, after a disclosed retake); sandboxed preview;
source inspection; staged diffs; persistent project memory with provenance, corrections and
recorded retrieval; the retrieval explainer; live memory-conflict refusals on both applications;
advisory Decision Guard findings citing remembered decisions; explicit approval, and rollback to the
recorded parent (executed live on Ocean Pairs and proven in the fixture workflow); a cross-origin
mutation guard with regression tests; the Phase 16 / 16B trials on two Meta models with a published
verifier; and the earlier Phase 15B trial with both codings published.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
gameplay or interaction verification, verified self-contained export, multi-user deployment, and
evaluation across many tasks, games or models.
