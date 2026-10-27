# Muse Recall — submission copy

Copy for the submission form. Quantitative claims come from the Phase 11A reliability trials, the
Phase 12A memory-influence trial, the Phase 12D Guard accuracy audit, the Phase 14A verification
record, the live FocusFlow demonstration (2026-10-28), and the Phase 15B trial (see
[EVIDENCE_MAP.md](EVIDENCE_MAP.md)); nothing is extrapolated.

**Word limits.** 100-word description: **100 words** (limit 100). 300-word description: **300
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

Muse Recall is an HTML development workspace powered by Meta's Muse Spark. Describe an application and Muse Spark writes a working app; ask for a change and it edits the approved source in place. Persistent project decisions are remembered across sessions, retrieved with provenance, and corrected without erasing history. Advisory Decision Guard cites remembered rules against staged changes; the developer reviews the diff and decides: approve, reject, or roll back to the recorded parent. In the live demo, Muse Spark built and modified FocusFlow, a task planner; every change was reviewed. Generated applications are the work; memory keeps them consistent.

## 300-word description

AI builders are fast at the first draft and weak at the second week: decisions vanish between sessions, so users re-explain constraints and discover regressions later.

Muse Recall is a local-first HTML workspace powered by Meta's Muse Spark. Describe an app and Muse Spark writes one sandboxed index.html. The result runs in an interactive preview; source and staged diff are inspectable. The next request edits the approved source in place; the change waits as a staged version: review, approve, reject, or roll back to the recorded parent.

Recall stores decisions with provenance and an append-only history. A correction supersedes outdated guidance without deleting it, so stale rules stop being retrieved while the audit trail remains. Every job records supplied decision ids and the prompt SHA-256.

The live demo is FocusFlow, a non-game task planner. Muse Spark generated it; a human rejected the first attempt after a sandbox form failure, and a retake with an added sandbox instruction became v1. Muse Spark then modified v1 to add priorities and a high-priority count as v2. A later countdown request was refused because the project remembered a no-countdown rule; the no-op change was rejected. Decision Guard returned not_verified, not a violation.

Before promotion the server loads the staged file in headless Chrome and binds promotion to those bytes. Decision Guard is advisory: it checks supported source patterns, cites evidence, never blocks approval, and is not compliance verification. Approval publishes an immutable version; rejection leaves the current version untouched; rollback follows recorded ancestry.

Evidence is bounded. In a preregistered 32-run trial, the original automated coding found 15 of 16 violations without project memory and 5 of 16 with it; a post-hoc correction found 0 of 16 under narrower definitions. The original scorer was not preserved. One model, game, rule and request: no general claim.

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
built around the model — they make Muse Spark's output reviewable without replacing its work. The
separate Baseten open-weight model has not been used in this project.

## Technology stack

TypeScript monorepo (pnpm workspaces); Fastify API and React/Vite web client on loopback; SQLite
memory store with weighted retrieval and transactional supersession; Muse Code CLI as model
provider; Playwright-driven headless Chrome for the load-time gate; a pure TypeScript Decision
Guard engine (`@mml/decision-guard`); Biome, Vitest, and reproducible evidence scripts.

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
- The live countdown refusal is one task-planner run. Decision Guard returned `not_verified` with
  zero findings; it did not detect or block anything in that run.
- Phase 15B is bounded: one configured Muse model, one game, one remembered rule, one request, edit
  path only. The original automated coder was not preserved; the corrected coder was produced after
  unblinding with narrower operational definitions. The corrected result is not confirmatory.
- The trial's memory arm carried the full project decision set (rule plus palette decisions), not
  one isolated memory item; retrieved memory ids were not recorded per run.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting. Host-header validation raises the cost of DNS rebinding, and the origin guard blocks
  cross-site mutations; neither is a substitute for authentication in a multi-user deployment.
- The V2 demonstration is delivered separately as `Muse_Recall_Demo_V2_1080p.mp4` (172 s, 1920×1080,
  SHA-256 `57ce9eadae3c2256802cbfd3aea480f34403ca3b9768f03689f37cdaa73cebf8`), built from recorded
  FocusFlow stills and published evidence. The protected fallback MP4 was not re-rendered,
  overwritten or re-tagged. Production and QA:
  [V2_VIDEO_PRODUCTION_MANIFEST.md](V2_VIDEO_PRODUCTION_MANIFEST.md) and
  [V2_VIDEO_QA_REPORT.md](V2_VIDEO_QA_REPORT.md).

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

**Demonstrated:** Muse Spark generation of a working HTML application (FocusFlow v1 after a disclosed
retake); live modification of the approved source (FocusFlow v2 with priorities); sandboxed preview;
source inspection; staged diffs; persistent project memory with corrections and recorded retrieval;
a live memory-conflict refusal that was rejected; advisory Decision Guard findings citing remembered
decisions; explicit approval with rollback to the recorded parent (proven in the fixture workflow);
a cross-origin mutation guard with regression tests; and the Phase 15B 32-run trial with both
codings published.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
gameplay or interaction verification, verified self-contained export, multi-user deployment, and
broad statistical evaluation.
