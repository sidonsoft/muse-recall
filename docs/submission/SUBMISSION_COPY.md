# Muse Recall — submission copy

> This is the **unlocked working copy**. The tagged snapshots `submission-v14` and
> `submission-v15` are frozen and were not modified. This copy is the proposed current
> submission narrative, not a tag replacement.

Copy for the submission form. It is written around the strongest supported contribution —
correctable project memory connected to a reviewable software-building workflow — and the
pre-registered Phase 17 trial. Quantitative claims come from Phase 17, the earlier Phase 16 /
16B trials, the Phase 11A reliability trials, the Phase 12A memory-influence trial, the Phase 12D
Guard accuracy audit, the Phase 14A verification record, and the live FocusFlow and Ocean Pairs
demonstrations (2026-10-28). See [EVIDENCE_MAP.md](EVIDENCE_MAP.md); nothing is extrapolated.

**Word limits.** 100-word description: **99 words** (limit 100). 300-word description: **296
words** (limit 300). Counts are whitespace-delimited; re-count after any edit.

## Links for the form

| Field | Link |
| --- | --- |
| Repository | https://github.com/sidonsoft/muse-recall |
| Project website | https://sidonsoft.github.io/muse-recall/ (plays the 2:50 video; links back to the repository and the reproduction steps) |
| Demo video (2:50) | https://github.com/sidonsoft/muse-recall/blob/main/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true (the committed file; the website also plays the cut in the page). If the form wants a video-host link, upload this file and use that link instead |
| Try it, no install | https://codespaces.new/sidonsoft/muse-recall?quickstart=1 |
| Reproduce the evidence | https://github.com/sidonsoft/muse-recall#reproduce-the-evidence (`pnpm verify:research17`) |

---

## Project title

**Muse Recall — correctable project memory for AI-built software**

## Tagline

Correctable project memory for AI-built software.

## Short product description

Muse Recall is a local-first HTML Studio powered by Meta's Muse Spark. It lets a developer
describe and iteratively change a browser application while project decisions persist, can be
corrected, and are supplied to later changes. Every change is staged for review; nothing becomes
the approved version until the developer approves it.

Persistent memory is not new. The contribution is the integration: memory with identity,
provenance and supersession, a controlled application-change workflow, and a pre-registered
behavioural test. An advisory Decision Guard highlights supported source patterns but never
blocks approval.

## 100-word description

Muse Recall gives AI-built software a correctable project memory. Describe a browser app and Muse
Spark writes it; ask for a change and it edits the approved source. Decisions persist with
provenance, so later sessions know them—and you can correct one, keeping the old version in
history. Changes are staged with preview, source and diff; approve, reject or roll back. In
pre-registered trials on Muse Spark and Muse Spark Open, a remembered rule cut violations from
37/57 to 0/58 and 49/60 to 1/60; it matched retyping by hand. Persistent memory is not new;
correctable, reviewable memory is the contribution.

## 300-word description

AI builders are fast at the first draft and weak at the second week. Every session starts from
zero, so users restate requirements. A generated change can forget an earlier decision; the
regression surfaces later. When the user changes their mind, old preferences can return because a
transcript does not say which is current.

Muse Recall is a local-first HTML Studio for Muse Spark. Describe a browser application; Spark
writes one sandboxed index.html, and later requests edit it. Decisions persist with identity,
provenance, confidence and history. A correction supersedes the old decision transactionally: it
stays auditable, the replacement becomes active, and only the replacement is retrieved later. Each
job records the decision ids it received and the SHA-256 of its prompt.

Nothing becomes current automatically. Changes are staged with a preview, exact source and diff.
Approval binds promotion to the checked bytes; every approved change is immutable, and rollback
follows the recorded parent. An advisory Decision Guard checks supported source patterns and cites
the decisions; it never blocks approval and is not compliance certification.

In the pre-registered Phase 17 trial (480 runs, six strata, two models), a remembered rule took
original-rule violations from 37/57 to 0/58 on Muse Spark and 49/60 to 1/60 on Muse Spark Open.
Retyping it by hand gave 0/58 and 0/60, within the +15 pp margin. After correction, the
original-rule detector rose to 41/59 and 50/60: Phase 17's correction was permissive, releasing
the old restrictions rather than substituting a new requirement. In a separate Phase 12A trial,
a sunset palette was corrected to ocean, one run per condition. Eight Spark runs timed out;
none on Open. Exact p-values are a post-run correction.

Limits: six fixed tasks, source code not runtime behaviour; no general application-correctness,
Decision Guard effectiveness or transfer claim. Single-user, loopback-only.

## Technical innovation summary

- **Correctable memory with identity and provenance:** every decision has a UUID, type, project
  scope, source reference, confidence, validation status and append-only history. A correction is
  one transaction that inserts the replacement, records the supersession edge, flips the old
  record to `superseded`, and excludes it from active retrieval. Replaying the correction is
  idempotent.
- **Provable context:** one production prompt builder; every job records a prompt SHA-256, the
  injected decision ids and their rendered provenance, and reconstruction reproduces the exact
  prompt bytes.
- **Modify-in-place HTML workflow:** staged single-file source, structural validation, a blocking
  load-time browser gate, SHA-256 binding between verified bytes and promotion, compare-and-swap
  promotion, immutable versions, and rollback to the recorded parent.
- **Inspectable artifact:** a read-only endpoint returns approved or staged HTML with line count,
  byte size, title, version and SHA-256; the Studio renders it as escaped text and offers a
  disclosed download. The sandboxed preview remains the only renderer.
- **Advisory Decision Guard:** a deterministic, pure, dependency-free engine that checks staged
  source against the job's own decisions and cites them, including hexadecimal equivalence between
  CSS `#FF7E5F` and Phaser `0xFF7E5F`; its independent accuracy audit is why it stays advisory.
  It supports five rule families and reports unverified decisions rather than claiming compliance.
- **A controlled test of correctable memory:** Phase 17's four arms (`none`, `memory`, `manual`,
  `corrected`) separate "the rule is present" from "the rule is retrieved" and from "the rule was
  superseded". It is pre-registered across six strata and two models (480 runs), with a detector
  fixed before the runs, 8 declared Muse Spark timeouts, and a strict verifier that re-derives the
  counts and exact p-values from the retained records. The `manual` arm is the key comparison:
  memory is non-inferior to retyping the same rule, not superior to a well-written prompt.
- **Cross-origin mutation guard:** state-changing routes reject foreign, `null` and malformed
  origins before any handler runs, so a cross-site page cannot approve, reject, roll back or cancel
  even though CORS hides its response.

## Problem / solution statement

**Problem:** AI builders lose project decisions between sessions, so users repeatedly explain
constraints, inspect unexpected changes, and repair regressions. Transcripts also do not say
which fact is current after a change of mind, so an outdated preference can keep constraining new
work.

**Solution:** project-scoped decisions with identity, provenance and explicit supersession;
budgeted retrieval that supplies only active decisions to later generations; and a development
loop over approved source (stage → inspect preview/source/diff → validate → load-time browser gate
→ advisory decision check → human approval → immutable version/rollback).

## How Meta Muse is used

Muse Spark is the reasoning engine for the development loop: the Muse Code CLI on the Meta
subscription generates the original `index.html` and performs every subsequent modification, with
the project's configured, bounded contributor-API fallback. The memory layer, prompt construction,
validation, runtime check, artifact serving, and Decision Guard are deterministic infrastructure
built around the model — they make Muse Spark's output reviewable without replacing its work.

Muse Spark Open (`meta-models/muse-spark-open-1026`), served on Baseten, was used for research
only: the Phase 16B and Phase 17 replications used the production prompt builder. The application
itself does not call it.

Provider independence is an **architectural direction, not a shipped capability**. The server has
a `ModelProvider` boundary, but only the Muse Code CLI and the deterministic offline `echo`
provider are implemented. Experimental use of an open model is not production support.

## Technology stack

TypeScript monorepo (pnpm workspaces); Fastify API and React/Vite web client on loopback; SQLite
memory store with weighted retrieval and transactional supersession; Muse Code CLI as model
provider; Baseten inference for the Muse Spark Open replication; Playwright-managed Chromium for
the load-time gate; a pure TypeScript Decision Guard engine (`@mml/decision-guard`); Biome,
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
- The Ocean Pairs refusal in the 2:46 video is one live run. Its job records are not exported to the
  repository; the screen recording is the record.
- The live FocusFlow countdown refusal is one task-planner run. Decision Guard returned
  `not_verified` with zero findings; it did not detect or block anything in that run.
- Phase 16 / 16B is bounded: one baseline game, one request, one remembered rule, two models. It
  measures code mechanics, not runtime safety. The rule arm also carries the palette decision. On
  Muse Spark 11 of 48 runs were unusable, and on Muse Spark Open 12 of 48 were cut off at the
  output token limit; counting them as violations does not change the conclusion. The open-model
  truncated outputs were first scored as clean; excluding them is a disclosed post-hoc correction
  ([CORRECTION_1.md](../hackathon-evidence/phase16b/CORRECTION_1.md)). Phase 16B used a chat completion rather than the CLI tool loop. Lock times are local
  file times, not an external registration.
- Phase 17 is bounded: two games and one non-game app, two requests per baseline, two rules, two
  models. It measures source-code mechanics, not runtime safety. On Muse Spark 8 of 240 runs hit
  the 30-minute runtime cap and are unusable; Muse Spark Open had 0 unusable runs. Counting the
  unusable runs as violations does not change a verdict. The corrected arm's higher original-rule
  rate **suggests the superseded restriction was released**; it does not test whether a
  replacement requirement is followed. The reported p-values were recomputed exactly after
  review, with the as-run analysis preserved and no verdict change
  ([STATS_CORRECTION.md](../hackathon-evidence/phase17/STATS_CORRECTION.md)). Nothing in Phase 17
  establishes general application correctness, Decision Guard effectiveness, or transfer to
  untested tasks.
- The submission cut (2:50, recorded 29 October 2026) shows the correction sequence, including the
  failure beat: the repeat request kept the old sunset palette and Guard flagged it, and only the
  explicit request for the current art direction produced the ocean version. It is committed
  under `docs/demo/video/`. The earlier 2:46 video, retained as the fallback, has
  no explicit correction beat.
- Provider independence is an **architectural direction, not a shipped capability**. The server has
  a `ModelProvider` boundary, but only the Muse Code CLI and the deterministic offline `echo`
  provider are implemented. Muse Spark Open was used for research, not production support.
- Phase 15B (earlier, superseded by Phase 16) is bounded: one configured Muse model, one game, one remembered rule, one request, edit
  path only. The original automated coder was not preserved; the corrected coder was produced after
  unblinding with narrower operational definitions. The corrected result is not confirmatory.
- The trial's memory arm carried the full project decision set (rule plus palette decisions), not
  one isolated memory item; retrieved memory ids were not recorded per run.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting. Host-header validation raises the cost of DNS rebinding, and the origin guard blocks
  cross-site mutations; neither is a substitute for authentication in a multi-user deployment.

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

**Demonstrated:** Muse Spark generation and live modification of working HTML applications (a
memory game in the 2:50 submission cut; Ocean Pairs in the earlier 2:46 cut; FocusFlow, a
non-game planner, after a disclosed retake); sandboxed
preview; source inspection; staged diffs; persistent project decisions with identity, provenance,
corrections and recorded retrieval; the retrieval explainer; live memory-conflict refusals on both
applications; a Phase 12A correction from a sunset to an ocean palette, one run per condition,
with the old decision superseded and excluded from retrieval; advisory Decision Guard findings
citing remembered decisions; explicit approval, and rollback to the recorded parent (executed
live on Ocean Pairs and proven in the fixture workflow); a cross-origin mutation guard with
regression tests; the pre-registered Phase 17 trial on two Meta models with a published strict
verifier; the earlier Phase 16 / 16B trials; and the Phase 15B trial with both codings published.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
gameplay or interaction verification, verified self-contained export, multi-user deployment,
arbitrary-provider or production open-model support, and evaluation across many tasks, games or
models. The 2:50 submission cut is in `docs/demo/video/`.
The earlier 2:46 video is not that cut.
