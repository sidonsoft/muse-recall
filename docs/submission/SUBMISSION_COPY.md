# Muse Recall — submission copy (Phase 14C)

Ready-to-paste text for the submission form. Quantitative claims come from the accepted Phase 11A
reliability trials, the Phase 12A memory-influence trial, and the Phase 14A verification record (see
[EVIDENCE_MAP.md](EVIDENCE_MAP.md)); nothing is extrapolated.

**Word limits (verified programmatically, whitespace-delimited):** 100-word description = **99
words** (limit 100); 300-word description = **290 words** (limit 300). Both are inside the preferred
safety margins (95–99 and 285–295).

---

## Project title

**Muse Recall** — persistent creative memory for an AI game studio

## Tagline

An AI creative studio that remembers your decisions, checks its work, and keeps you in control.

## 100-word description

Muse Recall is an AI creative studio that remembers your decisions and keeps you in control. In Muse
Forge, a real Meta Muse model edits an approved Phaser game rather than regenerating. Earlier
decisions — a child-safety rule, a palette — are retrieved into the prompt, which is recorded. A
correction supersedes the old decision while keeping its audit history. Before promotion, Muse Forge
loads the staged build in headless Chrome and rejects load failures or a missing canvas. An advisory
Decision Guard cites those decisions. You review and approve the diff; approved changes roll back to
their parent.

## 300-word description

AI creative tools generate quickly but lose your decisions between sessions: you re-explain
constraints, discover unexpected changes, and repair regressions. Muse Recall adds persistent,
project-scoped creative memory and a controlled modification workflow, demonstrated in Muse Forge,
its game-studio workspace.

Decisions are stored with provenance and an append-only history. When you change your mind, a
correction supersedes the old decision: the original stays auditable but is never returned as
current guidance. Each modification retrieves the still-current decisions — pinned constraints
included within a hard context budget, even when your words barely match — and records exact prompt
bytes and decision ids used.

Muse edits the existing approved source rather than regenerating. Across five real-model trials,
changes touched 1.2–10.1% of the file. Before promotion, Muse Forge loads the staged build in
headless Chrome and rejects builds that throw on load or fail to create a canvas. That gate is
load-time only: it does not play the game, inspect pixels, or test every mechanic, so diff review
matters. An advisory Decision Guard compares source patterns against the same decisions and cites
them with evidence — a source-pattern aid, not an enforcement gate; its accuracy was audited and the
human stays in charge.

The pipeline runs locally around Meta Muse: the Muse Code CLI generates the game and performs every
subsequent edit, with a bounded quota fallback and per-run budgets.

In a controlled A/B/C trial with one model and one request, the remembered palette drove output:
sunset memory produced the sunset accent, with no memory neither appeared, and the corrected ocean
decision produced the ocean accent with the superseded value absent. Results are one run per
condition — directional, not statistical. Each change is human-approved, diffed, and can roll back
to its recorded parent.

## Technical innovation summary

- **Correctable, supersedeable memory:** atomic transactional corrections with audit history;
  superseded decisions are excluded from retrieval, so stale constraints stop constraining —
  demonstrated in the controlled A/C trial (the corrected-memory condition produced the corrected
  palette and no
  trace of the superseded one).
- **Provable memory influence:** one production prompt builder; every job records a prompt SHA-256
  and the injected memory ids; reconstruction reproduces the exact prompt.
- **Modify-in-place workflow:** staged source, structural validation, a blocking load-time
  headless-Chrome gate, SHA-256 binding between verified bytes and promotion, compare-and-swap
  promotion, immutable versions, and rollback to the recorded parent.
- **Advisory Decision Guard:** a deterministic, pure, dependency-free engine that checks staged
  source against the job’s own decisions and cites them, including hexadecimal notation equivalence
  between CSS `#FF7E5F` and Phaser `0xFF7E5F`; plus an independent accuracy audit (72-case
  adversarial corpus, confusion matrices, security probes) that is the reason the guard stays
  advisory.

## Problem / solution statement

**Problem:** AI assistants lose project decisions between sessions, so users repeatedly explain
constraints, inspect unexpected changes, and fix regressions; transcripts do not say which fact is
current after a change of mind.

**Solution:** persistent project-scoped creative memory with provenance and correction, retrieval
with hard budgets and pinned constraints, a modification workflow over approved source (stage →
validate → load-time browser gate → advisory decision check → human approval → version/rollback),
and a decision-aware advisory review that cites your own decisions and admits what it cannot verify.

## How Meta Muse is used

Meta Muse is the reasoning engine for the creative loop: the Muse Code CLI (Meta subscription
provider, with a bounded quota fallback) generates the original game and performs every subsequent
modification, and conversation/generation features run on Muse models throughout. The memory layer,
prompt construction, validation, runtime check, and Decision Guard are deterministic infrastructure
built around Muse — they make Muse’s output more reviewable without replacing Muse’s creativity.

## Technology stack

TypeScript monorepo (pnpm workspaces); Fastify API and React/Vite web client on loopback; SQLite
memory store with bm25-style weighted retrieval and transactional supersession; Muse Code CLI as
model provider; Playwright-driven headless Chrome for the load-time gate; a pure TypeScript
Decision Guard engine (`@mml/decision-guard`); Biome, Vitest (484 passing / 3 opt-in live-Muse tests
skipped at Phase 14A), reproducible evaluation and evidence scripts.

## Known limitations (stated plainly)

- The Decision Guard is **advisory only** — it never blocks approval — and checks source patterns
  (five rule families), not rendered behaviour; it is not comprehensive compliance verification.
  Its false-positive/false-negative behaviour and abstention rates are measured and published.
- The runtime gate is load-time only: page/console errors and canvas creation. It does not play the
  game, inspect pixels, test every mechanic, or guarantee later interactions cannot crash.
- Memory influence is demonstrated in controlled single-trial conditions (n = 1 per condition);
  results are directional, not statistically significant. Palette accent tracking was observed; one
  instruction (dark text colour) was not honoured.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting. Host-header validation raises the cost of DNS rebinding; it is not a substitute for auth.
- The demo modification footage is a **replay of recorded Phase 12A C source**, labelled on screen
  “Replay of recorded Phase 12A Muse output.” The replay job retrieves two active memories and its
  ids/prompt hash describe the replay, not the original generation; the original C run retrieved one
  active memory (ocean). The replay demonstrates staging, review, approval and rollback; the A/C
  trial demonstrates memory influence. These are separate claims.
- No demo video was produced in Phase 14A; screenshots, a rehearsal record and a recording runbook
  are provided.

## Future roadmap

- Evidence-filtered enforcement: auto-act only on guard findings the audit shows are reliable, with
  explicit human override and an audit trail.
- Engine fixes targeted by the audit: 8-digit RGBA normalisation, tween-based flash detection,
  comment/prose false-positive reduction.
- A larger real-output evaluation corpus for both memory influence and guard accuracy.
- Rendered-pixel compliance checks beyond source text.
- Multi-user deployment once authentication and isolation exist.

## What is demonstrated vs future work

**Demonstrated:** persistent project memory with corrections; retrieval into real generation
prompts with recorded proof; real Muse modification of approved source; a blocking load-time browser
gate; advisory decision-compliance findings citing remembered decisions; explicit approval with
rollback to the recorded parent; memory changing generated output in a controlled trial; a
reproducible seeded demo.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
gameplay/pixel verification, multi-user deployment, and broad statistical evaluation.
