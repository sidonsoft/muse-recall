# Muse Recall — submission copy

Copy for the submission form. Quantitative claims come from the accepted Phase 11A reliability
trials, the Phase 12A memory-influence trial, the Phase 12D guard accuracy audit, and the Phase 14A
verification record (see [EVIDENCE_MAP.md](EVIDENCE_MAP.md)); nothing is extrapolated.

**Word limits.** 100-word description: **93 words** (limit 100). 300-word description: **289 words**
(limit 300). Counts are whitespace-delimited; re-count after any edit.

---

## Project title

**Muse Recall — Build with Muse Spark. Remember what matters.**

## Tagline

AI-powered HTML development with persistent project memory.

## Short product description

Muse Recall is an AI development workspace powered by Meta's Muse Spark. It enables developers to
generate, preview and iteratively improve working HTML applications using natural-language requests.

Persistent project decision memory helps maintain requirements across development iterations. An
independent advisory Decision Guard highlights potential conflicts, while human approval and rollback
preserve developer control.

## 100-word description

Muse Recall is an HTML development workspace powered by Meta's Muse Spark. Describe an application
and Muse Spark writes a working browser app; ask for a change and it edits the approved source
instead of regenerating. Persistent project decisions are remembered across sessions, retrieved into
later prompts with provenance, and corrected without erasing history. An independent advisory
Decision Guard cites remembered rules against staged changes, then the developer reviews the diff
and decides: approve, reject, or roll back to the recorded parent. Generated applications are the
work; memory is why they stay consistent.

## 300-word description

AI builders are fast at the first draft and weak at the second week: decisions made in one session
vanish from the next, so users re-explain constraints and discover regressions after the fact.

Muse Recall is a local-first HTML development workspace powered by Meta's Muse Spark. In HTML Studio
a developer describes a browser application; Muse Spark writes one sandboxed index.html. The result
runs immediately in an interactive preview, and its source and staged diff are inspectable. The next
request edits the approved source in place rather than regenerating, and the change waits as a
staged version: review it, approve it, reject it, or roll back to the recorded parent.

Recall stores project decisions with provenance and an append-only history. A correction supersedes
outdated guidance without deleting it, so stale rules stop being retrieved while the audit trail
remains. Every job records the decision ids supplied and the SHA-256 of the exact prompt.

Before promotion the server loads the staged file in headless Chrome, rejects page errors or a blank
render, and binds promotion to those verified bytes. Decision Guard, an independent advisory layer,
checks supported source patterns against the same decisions and cites its evidence. It never blocks
approval and is not compliance verification.

The developer keeps authority. Approval publishes an immutable version; rejection leaves the current
version untouched; rollback follows recorded ancestry. A Memory view and retrieval explainer show
what was remembered and why it surfaced.

Evidence is deliberately bounded: memory influence was measured in controlled trials with one run
per condition, so results are directional, not statistical. The demo modification is a labelled
replay of recorded Muse output, not a live generation. Generated applications are the hero; memory
is the differentiator; human control completes the loop.

## Technical innovation summary

- **Correctable, supersedeable memory:** atomic transactional corrections with audit history;
  superseded decisions are excluded from retrieval, so stale constraints stop constraining.
- **Provable context:** one production prompt builder; every job records a prompt SHA-256 and the
  injected decision ids, and reconstruction reproduces the exact prompt bytes.
- **Modify-in-place HTML workflow:** staged single-file source, structural validation, a blocking
  load-time headless-Chrome gate, SHA-256 binding between verified bytes and promotion,
  compare-and-swap promotion, immutable versions, and rollback to the recorded parent.
- **Inspectable artifact:** a read-only endpoint returns approved or staged HTML with line count,
  byte size, title, version, and SHA-256; the Studio renders it as escaped text and offers a
  disclosed download. The sandboxed preview remains the only renderer.
- **Advisory Decision Guard:** a deterministic, pure, dependency-free engine that checks staged
  source against the job's own decisions and cites them, including hexadecimal equivalence between
  CSS `#FF7E5F` and Phaser `0xFF7E5F`; its independent accuracy audit is why it stays advisory.

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

- Decision Guard is **advisory only** — it never blocks approval — and checks source patterns (five
  rule families), not rendered behaviour; it is not comprehensive compliance verification. Its
  false-positive/false-negative behaviour and abstention rates are measured and published.
- The runtime gate is load-time only: page/console errors, a blank render, and canvas creation for
  Phaser documents. It does not play the game, inspect pixels, exercise interactions, or guarantee
  that later use cannot fail.
- General HTML support is deliberately narrow: one self-contained file, no build step, inline CSS
  and JavaScript, and no network assets outside the approved CDN. It is not a general framework or
  package build environment.
- Exported HTML is the artifact, not a verified self-contained bundle. A document that references
  the CDN still needs network access, and the UI says so.
- Memory influence is demonstrated in controlled single-trial conditions (n = 1 per condition);
  results are directional, not statistically significant. Palette accent tracking was observed; one
  instruction (dark text colour) was not honoured.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting. Host-header validation raises the cost of DNS rebinding; it is not a substitute for auth.
- The demonstration modification is a **replay of recorded Phase 12A C source**, labelled on screen
  “Replay of recorded Phase 12A Muse output.” The replay job retrieves two active memories and its
  ids/prompt hash describe the replay, not the original generation; the original C run retrieved one
  active memory (ocean). The replay demonstrates staging, review, approval and rollback; the A/C
  trial demonstrates memory influence. These are separate claims.
- The existing demonstration MP4 is a protected artifact outside this branch. It was not re-rendered
  or overwritten; see `docs/submission/REVISED_DEMO_STORYBOARD.md` for the re-recording decision.

## Future roadmap

- Evidence-filtered enforcement: auto-act only on guard findings the audit shows are reliable, with
  explicit human override and an audit trail.
- Engine fixes targeted by the audit: 8-digit RGBA normalisation, tween-based flash detection,
  comment/prose false-positive reduction.
- Rendered-pixel and interaction checks beyond load-time verification.
- Verified self-contained export (asset inlining with an allowlist) before using that label.
- A larger real-output corpus for memory influence and guard accuracy.
- Multi-user deployment once authentication and isolation exist.

## What is demonstrated vs future work

**Demonstrated:** Muse Spark generation of a working HTML application; sandboxed preview; source
inspection; staged diffs; persistent project memory with corrections and recorded retrieval;
advisory decision-compliance findings citing remembered decisions; explicit approval with rollback
to the recorded parent; memory changing generated output in a controlled trial; a reproducible
seeded demo.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
gameplay or interaction verification, verified self-contained export, multi-user deployment, and
broad statistical evaluation.
