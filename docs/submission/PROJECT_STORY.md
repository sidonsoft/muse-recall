# Muse Recall — project story (Phase 14A)

> **Historical document.** This is the Phase 14A project story. The submission now uses the V14 video (Ocean Pairs) and the Phase 16 / 16B research; see the [README](../../README.md) and the [submission copy](SUBMISSION_COPY.md). Kept for the development record.

**Demonstration environment:** Muse Forge (the game-studio workspace inside the app)
**One-line message:** An AI creative studio that remembers your decisions, checks its work, and keeps you in control.

## Problem

AI creative tools can produce code quickly, but they usually start each session from zero. Between
sessions the model forgets the constraints you agreed on: the palette you chose, the mechanics you
ruled out, the accessibility requirement you insisted on. So you re-explain them, you inspect
unexpected changes, and you repair regressions the assistant quietly introduced. A longer chat
transcript does not fix this — it is expensive, unselective, and cannot tell you which fact is
current after you changed your mind.

## Solution

Muse Recall gives the studio a **persistent, project-scoped creative memory** and puts every code
change through a **controlled modification workflow**:

- Decisions are stored as structured memories per project — with provenance (which session, which
  reference, how confident) and an append-only history.
- When you change your mind, you **correct** the decision. The correction supersedes the old one:
  the old decision stays auditable, but it is never returned as current guidance again.
- Every modification request retrieves the decisions that are still current, injects them into the
  generation prompt, and records *which* decisions were used and the exact prompt hash — provable
  after the fact.
- Muse does not regenerate the whole game. It edits the **existing approved source**, and you see a
  real diff before anything is committed.
- When you request approval, the app **loads the staged game headless in Chrome** and refuses to
  promote it if it throws on load or never creates a canvas. It also shows an advisory
  decision-compliance check. Then **you** approve; every approved change becomes a version you can
  roll back to its recorded parent.

## Innovation

The innovation is not one algorithm; it is the closed loop that connects four things a normal
assistant keeps apart:

1. **Remembered design intent** — current decisions, with their rationale, retrieved into the prompt.
2. **Actual generated modification** — a real Muse model editing the approved source in place.
3. **Evidence about the result** — a load-time browser gate, a reviewable diff, and an advisory
   source check that cites your own decisions while stating what it cannot verify.
4. **Human control** — an explicit approval step, an explicit user-written decision when one is
   saved, and rollback at every version.

Memory alone is a database. Generation alone is a demo. Muse Recall's differentiator is that the
remembered decision **changes what the model produces**, the app produces **bounded evidence about
the result**, and the human makes the **final call** with that evidence in front of them.

### The causal evidence (authentic, n = 1 per condition)

One controlled A/B/C trial with one model, one identical request, and one identical baseline:

| Condition | Memory state | Observed output |
| --- | --- | --- |
| A | sunset decision active | rendered sunset accent `0xFF7E5F` (1.082% visible coverage) |
| B | no memory | neither palette accent (0.005% background noise) |
| C | sunset superseded by ocean | rendered ocean accent `0x4EA8DE` (0.879%); no sunset hex in source |

The corrected decision is the interesting case: the superseded value does not appear in the new
source, while the corrected accent does. The remembered text colour was **not** applied in A or C;
that partial result is reported rather than smoothed over. See
[EVIDENCE_MAP.md](EVIDENCE_MAP.md) and the presentation in
`docs/hackathon-evidence/phase14a/memory-influence.{md,html,png}`.

## Technical architecture

Each stage below is implemented and exercised in the demo; the companion
[EVIDENCE_MAP.md](EVIDENCE_MAP.md) links each capability to its evidence.

<details>
<summary>Implementation detail for reviewers</summary>

### Memory storage and retrieval

Memories live in a local SQLite database and are scoped to a project. Retrieval applies hard
filters (project, status, expiry), weighted scoring (bm25 relevance plus scope, confidence,
recency and type priority), and a hard context budget (at most 6 memories / 3,000 characters per
job). Constraint and goal memories are force-included ahead of keyword relevance, so a constraint
still reaches the prompt even when the request shares almost no words with it. Every retrieval
result carries component scores and provenance.

### Decision correction and supersession

`correct()` is an atomic, transactional supersession: the replaced memory keeps its history
(action, actor, reason, timestamp) and moves to a superseded status; only the correction is
retrievable as current. Replaying the same correction is idempotent; conflicting corrections fail
loudly. This is how a changed creative direction stops leaking stale guidance into new work —
demonstrated causally in the A/B/C trial.

### Prompt construction

Every Forge job builds its prompt with one production function, and the memory block is framed to
the model as authoritative project decisions. Each job records the SHA-256 of its exact prompt,
plus the ids of the memories that were injected. Retrieving the same memories and rebuilding the
prompt reproduces that hash byte-for-byte.

### Muse generation

The app drives the Muse Code CLI as its model provider (Meta subscription first, with a bounded
one-retry fallback to a contributor API key on quota errors, under per-job call/token/time budgets).
For a modification, the prompt contains the approved source and the request; the model returns the
modified file. Generated output is treated strictly as data.

### Staged source and checked-source integrity

Muse writes into a staging copy, never the approved file. Structural validation (size, symlink,
syntax guards) runs on the staged bytes. Approval takes one snapshot of the staged bytes, runs the
browser gate on exactly those bytes, and binds promotion to that snapshot's SHA-256 — if staging
changes between verification and promotion, the promotion is refused. Promotion's compare-and-swap
check also confirms the base version is still current, so concurrent edits cannot be silently
overwritten.

### Runtime validation (precise scope)

When approval is requested, the staged game is loaded in headless Chrome. The check fails on page
errors or console errors and requires a canvas element to be created. It is a **blocking
load-time gate** — a build that throws on load cannot be approved — but it does **not** play the
game, inspect rendered pixels, test every mechanic, produce a verification screenshot, or guarantee
that later interactions cannot crash. Network access during the check is restricted to the approved
Phaser CDN; other HTTP requests are aborted, every WebSocket is closed, and both are reported.

### Advisory Decision Guard

A deterministic, dependency-free engine checks the staged source against the job's own retrieved
decisions, using five pattern rule families (countdown mechanics, flashing effects, mistake
penalties, superseded palette colours, colour-only cues). Findings cite the decision and show a
source excerpt; when a decision cannot be checked, the guard says so instead of claiming compliance.

Phase 12E hardened this layer: comment/prose masking, bounded evidence projection with secret
redaction, and hexadecimal **notation equivalence** — CSS `#FF7E5F` and Phaser `0xFF7E5F` normalise
to the same RGB token, so a superseded palette is detected across both notations. That equivalence
is a targeted notation fix, not semantic colour analysis: 8-digit RGBA hexes remain a known gap.

Two honest limits: the guard is **advisory only — it never blocks approval**, and it is a
**pattern-level source check, not comprehensive compliance verification**. It sees source text,
not rendered behaviour. An independent accuracy audit quantified false positives, false negatives
and abstentions, which is why enforcement was deliberately left to the human.

### Approval, rollback ancestry, and explicit decisions

The reviewer sees the unified diff against the approved version, structural validation, the
advisory findings, and can approve or reject. Rejection and approval are serialised under the
project lock. Approval promotes the staged file to a new immutable version. Saving a decision to
memory is a separate, explicit act: the user must type the decision; the model's terminal summary
is never promoted into a verified creative decision.

Rollback restores the current version's **recorded parent** (`base_version`), not the previous
array entry. This matters after a non-linear history: approve v1, approve v2, undo to v1, approve
v3 from v1 — undoing v3 restores v1. Legacy records without a usable parent fall back to the
immediately preceding older version; a parentless root reports that there is nothing to roll back.

</details>

## Differentiation

**More than a game generator.** A generator gives you an artifact and a fresh start. Here, the same
approved artifact is the base for every change; the diff is small and reviewable (observed line
change: 1.2–10.1% across real trials); the output must survive a load-time browser gate; and the
human decision is recorded.

**More than chat memory.** Ordinary assistant memory stores text blobs and hopes for keyword
matches. Muse Recall stores structured, project-scoped decisions with provenance and budgets, and
the memory is *correctable*: when the direction changed from sunset to ocean, the next generation
used the ocean accent and the superseded value appeared nowhere in the new source, while the
no-memory control produced neither.

**The verified differentiator** is continuity plus trust across sessions: remembered intent in the
prompt, a real model editing real approved source, bounded and honestly-described verification, an
advisory check that cites your decisions and says what it cannot verify, and explicit human
approval with rollback. We do not claim the AI enforces your decisions for you — we show the
evidence and keep you in the loop.

## What we deliberately do not claim

- No automatic enforcement of remembered decisions; the guard does not block.
- No complete design compliance, and no claim that all constraints reach every generation.
- No gameplay or pixel-level verification by the runtime gate.
- No statistically significant memory-influence result (n = 1 per condition).
- No multi-user or hosted-security story: this is a loopback, single-user build.
