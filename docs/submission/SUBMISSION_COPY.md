# Muse Recall — submission copy

Ready-to-paste text for the submission form. All quantitative claims come from the accepted
Phase 11A reliability trials and the Phase 12A memory-influence trial (see
[EVIDENCE_MAP.md](EVIDENCE_MAP.md) for links); nothing is extrapolated.

---

## Project title

**Muse Recall** — persistent creative memory for an AI game studio

## Tagline

An AI creative studio that remembers your decisions, checks its work, and keeps you in control.

## 100-word description

Muse Recall is an AI creative studio that remembers your decisions, checks its work, and keeps you
in control. In Muse Forge, a real Meta Muse model modifies an existing approved Phaser game rather
than regenerating it. Before each change, decisions from earlier sessions — a child-friendly
palette, no flashing effects — are retrieved into the prompt, and the exact prompt is recorded.
After each change, the app plays the game headless in Chrome, an advisory Decision Guard
cross-checks the source against those decisions, a diff is shown, and you approve with full
evidence — correcting any decision and rolling back any version.

## 300-word description

AI creative tools generate code quickly but lose your decisions between sessions: you re-explain
constraints, discover unexpected changes, and repair regressions. Muse Recall adds persistent,
project-scoped creative memory and a controlled modification workflow, demonstrated in Muse Forge,
its game-studio workspace.

Design decisions are stored with provenance and an append-only history. When you change your mind,
a correction supersedes the old decision: the original stays auditable but is never again returned
as current guidance. Every modification retrieves the still-current decisions — constraints are
force-included even when your words barely match them — under a hard context budget, and each run
records the exact prompt bytes and the decision ids used, byte-for-byte reproducible.

Muse then edits the existing approved source rather than regenerating: across five real-model
trials, changes touched 1.2–10.1% of the file. Before approval is possible, the app runs the
modified game headless in real Chrome and rejects page errors, so you review changes that actually
execute. An advisory Decision Guard then compares the new source against the same remembered
decisions and cites them with evidence, while openly reporting what it could not verify — it is a
source-pattern aid, not an enforcement gate, because we audited its accuracy and deliberately kept
the human in charge.

The entire pipeline runs locally around Meta Muse: the Muse Code CLI generates the game and
performs every subsequent edit, falling back once to a contributor key only on quota errors, under
per-run budgets for calls, tokens, and time.

In a controlled A/B/C trial with one model and one identical request, the remembered palette drove
the output: with a sunset decision the game rendered its accent; with no memory, neither palette
appeared; after correcting the decision to an ocean palette, the ocean accent appeared and the
superseded value appeared nowhere. Every change ends in explicit human approval, a diff, and
versioned rollback.

## Technical innovation summary

- **Correctable, supersedeable memory:** atomic transactional corrections with audit history;
  superseded decisions are excluded from retrieval, so stale constraints stop constraining —
  causally demonstrated (the corrected-memory condition produced the corrected palette and no
  trace of the superseded one).
- **Provable memory influence:** one production prompt builder; every job records a prompt SHA-256
  and the injected memory ids; reconstruction reproduces the exact prompt, separating "memory was
  retrieved" from "memory changed the output".
- **Modify-in-place workflow:** staged source, structural validation, mandatory headless-Chrome
  runtime gate, compare-and-swap promotion, immutable versions, rollback.
- **Advisory Decision Guard:** a deterministic, pure, dependency-free engine that checks staged
  source against the job's own decisions and cites them; plus an independent accuracy audit
  (72-case adversarial corpus, confusion matrices, security probes) that is the reason the guard
  stays advisory and the human stays authoritative.

## Problem / solution statement

**Problem:** AI assistants lose project decisions between sessions, so users repeatedly explain
constraints, inspect unexpected changes, and fix regressions; transcripts do not say which fact is
current after a change of mind.

**Solution:** persistent project-scoped creative memory with provenance and correction, retrieval
with hard budgets and pinned constraints, a modification workflow over approved source (stage →
validate → run in Chrome → advisory decision check → human approval → version/rollback), and a
decision-aware advisory review that cites your own decisions and admits what it cannot verify.

## How Meta Muse is used

Meta Muse is the reasoning engine for the entire creative loop: the Muse Code CLI (Meta
subscription provider, with a bounded quota fallback) both generates the original game and performs
every subsequent modification, and conversation/generation features run on Muse models throughout.
The memory layer, prompt construction, validation, runtime check, and Decision Guard are
deterministic infrastructure built around Muse — they make Muse's output trustworthy without
replacing Muse's creativity with another model.

## Technology stack

TypeScript monorepo (pnpm workspaces); Fastify API and React/Vite web client on loopback; SQLite
memory store with bm25-style weighted retrieval and transactional supersession; Muse Code CLI as
model provider; Playwright-driven headless Chrome runtime verification; a pure TypeScript
Decision Guard engine (`@mml/decision-guard`); Biome, Vitest (391 tests passing at the demo
branch), reproducible evaluation scripts.

## Known limitations (stated plainly)

- The Decision Guard is **advisory only** — it never blocks approval — and checks source patterns
  (five rule families), not rendered behaviour; it is not comprehensive compliance verification.
  Its false-positive/false-negative behaviour is measured and published.
- Memory influence is demonstrated in controlled single-trial conditions (n=1 per condition);
  results are directional, not statistically significant. Palette accent tracking was observed;
  one instruction (dark text colour) was not honoured.
- The app is a single-user, loopback-only development build: no authentication, no multi-tenant
  hosting.
- Retrieval selects a subset of memories under a context budget; very many constraints compete for
  the pinned slots.

## Future roadmap

- Evidence-filtered enforcement: auto-act only on guard findings the audit shows are reliable
  (e.g. superseded-palette), with explicit human override and an audit trail.
- Engine fixes targeted by the audit: hex-notation normalisation, tween-based flash detection,
  comment/prose false-positive reduction.
- A larger real-output evaluation corpus for both memory influence and guard accuracy.
- Rendered-pixel compliance checks beyond source text.
- Multi-user deployment once authentication and isolation exist.

## What is demonstrated vs future work

**Demonstrated:** persistent project memory with corrections; retrieval into real generation
prompts with recorded proof; real Muse modification of approved source; runtime verification;
advisory decision-compliance findings citing remembered decisions; explicit approval with rollback;
memory changing generated output in a controlled trial.

**Future work (do not read as demonstrated):** automatic enforcement, comprehensive compliance,
multi-user deployment, and broad statistical evaluation.
