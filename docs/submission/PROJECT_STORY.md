# Muse Recall — project story

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
  generation prompt, and records *which* decisions were used — provable after the fact.
- Muse does not regenerate the whole game. It edits the **existing approved source**, and you see a
  real diff before anything is committed.
- After generation, the app **runs the game** headless in Chrome and shows you structural
  validation, runtime results, and an advisory compliance check — then **you** approve. Every
  approved change becomes a version you can roll back.

## Innovation

The innovation is not one algorithm; it is the closed loop that connects four things a normal
assistant keeps apart:

1. **Remembered design intent** — current decisions, with their rationale, retrieved into the prompt.
2. **Actual generated modification** — a real Muse model editing the approved source in place.
3. **Runtime evidence** — the modified game is executed and checked before you are asked to approve.
4. **Human control** — an explicit approval step, a diff, an advisory review that cites your own
   decisions, and rollback at every version.

Memory alone is a database. Generation alone is a demo. Muse Recall's differentiator is that the
remembered decision **changes what the model produces**, the app produces **evidence about the
result**, and the human makes the **final call** with that evidence in front of them.

## Technical architecture

Each stage below is implemented and exercised in the demo; the companion
[EVIDENCE_MAP.md](EVIDENCE_MAP.md) links each capability to its evidence.

### Memory storage and retrieval

Memories live in a local SQLite database and are scoped to a project. Retrieval applies hard
filters (project, status, expiry), weighted scoring (bm25 relevance plus scope, confidence,
recency and type priority), and a hard context budget (at most 6 memories / 3,000 characters per
job). Decision-type memories (`constraint`, `goal`) are force-included ahead of keyword relevance,
so a constraint still reaches the prompt even when the user's request shares almost no words with
it. Every retrieval result carries component scores and provenance — nothing is stored without a
record of where it came from.

### Decision correction and supersession

`correct()` is an atomic, transactional supersession: the replaced memory keeps its history
(action, actor, reason, timestamp) and moves to a superseded status; only the correction is
retrievable as current. Replaying the same correction is idempotent; conflicting corrections fail
loudly. This is how a changed creative direction stops leaking stale guidance into new work —
demonstrated causally in the A/B/C trial (see Evidence map).

### Prompt construction

Every Forge job builds its prompt with one production function, and the memory block is framed to
the model as authoritative project decisions. Each job records the SHA-256 of its exact prompt,
plus the ids of the memories that were injected. Retrieving the same memories and rebuilding the
prompt reproduces that hash byte-for-byte — so "the decision was in the prompt" is provable, not
asserted.

### Muse generation

The app drives the Muse Code CLI as its model provider (Meta subscription first, with a bounded
one-retry fallback to a contributor API key on quota errors, under per-job call/token/time budgets).
For a modification, the prompt contains the approved source and the request; the model returns the
modified file. Generated output is treated strictly as data.

### Staged source

Muse writes into a staging copy, never the approved file. Structural validation (size, symlink,
syntax guards) runs on the staged bytes. Nothing becomes current until you approve and promotion's
compare-and-swap check confirms the base version is still current — concurrent edits cannot be
silently overwritten.

### Runtime validation

Before approval is possible, the staged game is launched headless in real Chrome. The check fails
the job on page errors and verifies the canvas actually renders. This is a blocking gate: a change
that crashes in the browser can never be approved, regardless of what the model or the guard says.

### Advisory Decision Guard

After the staged source exists, a deterministic, dependency-free engine checks the staged bytes
against the job's own retrieved decisions, using five pattern rule families (countdown mechanics,
flashing effects, mistake penalties, superseded palette colours, colour-only cues). Findings cite
the decision they came from and show the source excerpt as evidence; when a decision cannot be
checked, the guard says so instead of claiming compliance.

Two honest limits, by design and by audit: the guard is **advisory only — it never blocks
approval**, and it is a **pattern-level source check, not comprehensive compliance verification**
(it sees source text, not rendered pixels). An independent accuracy audit quantified where it is
reliable and where it is not, which is why enforcement was deliberately left to the human.

### Approval and rollback

The reviewer sees: the unified diff against the approved version, structural and runtime results,
and the advisory findings. Approval promotes the staged file to a new immutable version; every
version can be rolled back, and the whole trail (job, memories used, prompt hash, validation,
advisory) stays inspectable.

## Differentiation

**More than a game generator.** A generator gives you an artifact and a fresh start. Here, the same
approved artifact is the base for every change; the diff is small and reviewable (observed line
change: 1.2–10.1% across real trials); and the output is executed and gated before it can become
current.

**More than chat memory.** Ordinary assistant memory stores text blobs and hopes for keyword
matches. Muse Recall stores structured, project-scoped decisions with provenance and budgets, and
— uniquely for this demo — the memory is *correctable*: when the creative direction changed from a
warm sunset palette to a cool ocean palette, the next generation used the ocean accent and the
superseded sunset value appeared nowhere in the new source, while the sunset-free control run
produced neither.

**The verified differentiator** is continuity plus trust across sessions: remembered intent in the
prompt, a real model editing real approved source, runtime evidence, an advisory check that cites
your decisions and is honest about what it cannot verify, and explicit human approval with
rollback. We do not claim the AI enforces your decisions for you — we show the evidence and keep
you in the loop.
