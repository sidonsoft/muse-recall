# Muse Recall — product strategy

Status: **recommendation for owner approval.** No product direction is final, and no
implementation of a new direction has started. Branch: `experiment/product-validation`.

## 1. Executive summary

Muse Recall today is a technically strong memory companion with an unclear primary user. The
capability is real (cross-session recall, corrections, explainable retrieval, generated forms,
authorized tools), but "AI with memory" is a crowded category and the product currently
demonstrates a *technology*, not a *job*.

The strongest job is narrower than "developer memory": **project handover**. When work changes
hands — a contractor leaves, a teammate rotates, a solo developer returns months later — the
expensive failure is not missing chat history, it is re-discovering decisions, dead ends, and
unfinished work. Muse Recall already stores exactly those artifacts, can supersede wrong ones,
and can explain why it believes them.

Recommendation: position Muse Recall as **"the memory your project keeps"**, with handover as
the wedge and developer project memory as the broader market. This reuses >90% of the existing
build; the main gap is a project-brief workflow and capture discipline, not new infrastructure.

## 2. Competitive landscape (verified 2026-10-27)

| Product | Target user | Memory model | Correction / forgetting | Tools & UI | Verified limitations relevant to us |
| --- | --- | --- | --- | --- | --- |
| **Claude Code** | Developers in a terminal | Project instructions/memory files, session context | Not verified in the docs we could fetch | Tools, terminal | Memory docs exist ("Store instructions and memories") but the page body was truncated; treat specifics as **partially verified** |
| **Cursor Rules** | Developers in an IDE | Prompt-level persistent context: `.cursor/rules` (`.mdc`), user/team rules, `AGENTS.md` | **None described**: rules are static text, no supersession, no staleness tracking, no provenance | Agent tools, IDE | Docs state plainly that models "don't retain memory between completions"; rules are re-injected text ([docs](https://cursor.com/docs/rules)) |
| **Letta (MemGPT)** | Developers building stateful agents | Memory blocks / core memory, stateful agents, server/ADE | Self-editing memory; temporal invalidation and per-fact audit **not verified** | Agent framework, tools | Page for memory blocks verified; capabilities beyond it are **hypotheses** |
| **Mem0** | Developers adding memory to apps | Extraction + retrieval pipeline; messages vs memories; add/search/update/delete | Update/delete operations; staleness semantics **not verified** | API, MCP, integrations incl. Claude Code | A memory *layer*, not project state: no tasks, no generated interfaces, no approval model ([docs](https://docs.mem0.ai/core-concepts/how-it-works)) |
| **Zep** | Enterprise teams | Temporal Context Graph, fact invalidation with invalidated-at timestamps, provenance via source episodes, governance | **Strong**: invalidated facts retain when they became invalid | Retrieval API, context blocks | Enterprise/cloud-oriented; not local-first; no generated UI or authorized project tasks ([docs](https://help.getzep.com/concepts)) |
| **OpenHands** | Developers running agents | Microagents/knowledge (docs URL redirected; **not verified**) | Unverified | Agent platform | Excluded from scoring; claims would be speculative |
| **Codex / OpenClaw** | — | `AGENTS.md`-style instructions / unclear | Unverified | — | **Excluded**: no primary source fetched; "OpenClaw" existence not confirmed |

What this means: file-based rules (Cursor) and memory services (Mem0, Zep) are real competitors.
Two things are underserved together:

1. **Correction and staleness as a first-class user action**, not just an API operation. Cursor
   rules have no notion of a superseded rule; Mem0/Zep expose update/invalidate but not a
   project-scoped, auditable correction workflow a human performs and inspects.
2. **Turning remembered decisions into work** — a validated interface, approved tasks, and a
   brief a successor can read. Memory products stop at retrieval; coding agents stop at code.

## 3. Product candidates

| ID | Concept | Specific problem | Primary user |
| --- | --- | --- | --- |
| A | Developer memory | Re-investigating decisions, repeating failed approaches, losing constraints between sessions | Solo devs and small teams |
| B | Personal project companion | Long personal projects (renovation, restoration, game) lose decisions and stall | Non-professional builders |
| C | Memory layer for existing agents | Users will not switch assistants to gain memory | Developers using Claude Code/Cursor |
| D | AI project operations companion | Goals, decisions, tasks and progress live in heads and scattered docs | Tech leads |
| E | Dynamic interface agent | Repeated forms/dashboards are rebuilt by hand per task | Operators, analysts |
| F | **Project handover** (original) | When work changes hands, decisions, dead ends and unfinished work are lost or expensive to reconstruct | Teams/freelancers handing over a codebase; returning solo devs |

## 4. Weighted decision matrix

Internal product criteria, not the hackathon rubric. Scores 1–10; weighted total out of 10.

| Criterion (weight) | A | B | C | D | E | F |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Real-world usefulness (25%) | 9 | 8 | 8 | 7 | 6 | 9 |
| Clear differentiation (20%) | 7 | 5 | 8 | 6 | 8 | 9 |
| Three-minute demo impact (20%) | 7 | 8 | 6 | 8 | 10 | 8 |
| Effective use of Muse (15%) | 9 | 8 | 7 | 8 | 9 | 8 |
| Feasibility before deadline (10%) | 10 | 8 | 6 | 7 | 8 | 9 |
| Long-term potential (10%) | 8 | 7 | 9 | 7 | 6 | 8 |
| **Weighted total** | **8.20** | **7.30** | **7.35** | **7.15** | **7.85** | **8.55** |

Reasoning for the decisive rows:

- **A vs F.** A is broad and feasible, but "developer memory" invites comparison with Cursor,
  Claude Code and Mem0 on their turf. F is the same capability aimed at a moment where the pain
  is acute, measurable and easy to narrate.
- **C** scores high on differentiation and long-term distribution (work with the assistant
  people already use), but feasibility is the weakest: MCP/HTTP integration is real work and
  the product becomes infrastructure with no visible interface.
- **E** wins the demo criterion outright — a generated interface is visually distinctive — but
  the problem (form fatigue) is thinner and the user is unclear.
- **B** demos well but requires non-technical users to run a local Node app and a CLI, which is
  an adoption wall we cannot fix before the deadline.
- **D** overlaps F but lacks a sharp moment; "operations companion" is a category, not a job.

## 5. Two strongest concepts

### F — Project handover (recommended)

- **Positioning:** "The memory your project keeps when people leave."
- **Target user:** freelance/small-team developers handing a codebase to a successor; a solo
  developer returning after months.
- **Core workflow:** while working, decisions/constraints/dead ends are captured (explicitly or
  confirmed from suggestions) → at handover, Muse compiles a brief → the successor asks "why is
  this like this?" and gets sourced answers → the successor corrects stale facts, which
  supersede the old ones.
- **User journey:** install → point at project → answer/confirm a few captures → generate
  handover brief → successor opens a new session and asks questions → corrections → tasks.
- **MLP:** project-scoped memory (exists) + correction with history (exists) + a **project brief
  tool** that returns constraints, failed approaches, open questions and tasks (new, small) +
  a generated handover surface (UI protocol exists) + task creation with approval (exists).
- **Reuses:** memory engine, retrieval, evidence, corrections, sessions, generated UI, tools,
  audit, evaluation harness — essentially all of Phases 1–6.
- **New:** brief composition tool, handover-specific prompt/surface, capture affordances
  ("remember this decision" button), onboarding/sample project.
- **Risks:** capture discipline (empty memory = no value); successor may not trust memory
  without provenance (we have it); overlap with documentation tools.
- **Demo:** see `docs/VIDEO_CONCEPTS.md`.
- **Roadmap:** 2–3 days MLP → 2 weeks polish (import from git log/ADRs, brief export, team
  roles) → later: MCP server so other agents can read the same memory.

### A — Developer memory (broader market)

- **Positioning:** "Your project's decisions, remembered."
- **Target user:** solo developers and small teams using an AI assistant daily.
- **Core workflow:** capture decisions/failures/constraints as they happen; next session starts
  with the relevant ones, not a transcript.
- **MLP:** current product, plus a "project brief" view and better capture ergonomics.
- **Reuses:** everything; **new:** mostly UX and capture.
- **Risks:** crowded category; value is invisible until the second session; users must adopt a
  new tool rather than keep their existing assistant.
- **Demo:** strongest when it shows a failed approach *not repeated*.

## 6. Real-world validation

### Pilot run (executed 2026-10-27, real Muse, n=1)

Protocol: seed a project with a constraint (`node:sqlite`, no native modules), a failed approach
(`better-sqlite3` build failure on Node 26), a decision (append-only migrations), and an
unfinished task (project import). Ask the same question in a fresh session with and without
memory: *"We need to add a database backup command. What should it use, what should we avoid,
and what is still unfinished?"*

| Outcome | Baseline (no memory) | Memory-enabled |
| --- | --- | --- |
| Answer | "I don't have that information…" (lists what is missing) | "Use Node's built-in `node:sqlite`… Avoid native modules — specifically `better-sqlite3`, abandoned because its build failed on Node 26…" |
| Input tokens | 16,893 | 17,452 |
| Retrieved memories | 0 | 2 |

**Failure found:** the unfinished-work memory was **not** retrieved ("unfinished" vs
"not implemented" — a vocabulary gap), and the agent additionally called `task.list`, found
zero tasks, and concluded "no tracked unfinished work" even though an unfinished *memory*
existed. This is a real product gap: **tasks and unfinished memories are separate stores with
no unified brief.** It strengthens the case for the brief tool and is a concrete, fixable item.

This is a pilot, not a user study: n=1, one model, synthetic seed. It demonstrates mechanism,
not demand. No time-savings percentage is claimed.

### Next validation (recommended)

Recruit 2–3 developers with a real dormant repository. Record 10 decisions/failures, wait at
least a week, then ask the same 10 questions with and without Muse Recall. Measure: correct
answers, repeated investigation avoided, corrections needed, setup time. Success threshold:
≥70% correct with memory vs ≤30% without, and ≥5 of 10 questions answered without re-reading
the repo.

## 7. Three-minute video concepts

Full outlines are in `docs/VIDEO_CONCEPTS.md`.

- **F (recommended):** new engineer inherits a project; asks why; gets sourced decisions and a
  documented dead end; corrects a stale assumption (supersession visible); generates a handover
  brief; approves task creation; a fresh session summarises the project.
- **A:** a developer returns after two weeks, avoids repeating a failed migration approach, and
  continues with the recorded constraint.

## 8. Technical feasibility

| Need | Status |
| --- | --- |
| Project memory with provenance and evidence | Built |
| Correction with supersession and history | Built |
| Bounded retrieval and context accounting | Built |
| Generated interfaces from validated specs | Built |
| Authorized tools with audit | Built |
| Tasks and project metadata | Built |
| **Unified project brief (constraints + failures + unfinished + tasks)** | **Missing** — the pilot exposed the gap |
| Capture ergonomics (one-click "remember this") | Missing |
| Import from git log / ADRs / README | Missing |
| Multi-user auth / hosting | Out of scope |

Estimate for the handover MLP: **2–3 focused days** (brief tool + handover surface + capture
button + sample project), plus 3–5 days for video, docs, and hardening. No architectural change.

## 9. Recommended direction

**F — Project handover**, expressed as "Muse Recall: the memory your project keeps."

Why: it is the only direction that (a) turns an existing strength — auditable, correctable,
project-scoped memory — into a job someone urgently needs done, (b) demos in three minutes with
a clear before/after, (c) is feasible without new infrastructure, and (d) has a distribution
path (handover briefs are natural artifacts to share, and an MCP server later lets other agents
read the same memory).

## 10. Why the alternatives were rejected

- **B:** adoption wall (non-technical users + local CLI); demo charm does not offset it.
- **C:** strongest long-term distribution, weakest standalone demo and highest integration cost;
  better as a later channel than as the submission.
- **D:** category, not a moment; overlaps F without the sharp trigger.
- **E:** best visual demo, thinnest problem; risks looking like a demo trick.

## 11. Remaining assumptions (must be validated, not asserted)

1. Handovers happen often enough and hurt enough that a tool is adopted rather than endured.
2. People will record decisions while working if capturing costs one click.
3. A successor will trust sourced memory enough to act on it.
4. Corrections are a real workflow, not a nicety — Zep/Mem0 offer invalidation, but usage
   patterns are unverified.
5. Local-first + Muse CLI is acceptable to the target user (developers: plausible; others: no).

## 12. Proposed next milestone (requires approval)

**Milestone 0 — validate before building (1 week, no product changes):**
run the dormant-repository protocol with 2–3 developers; instrument the existing app only with
a short questionnaire and a script. Decision gate: if ≥70% correct-with-memory and ≥5/10
questions answered without re-reading the repo, proceed to Milestone 1 (brief tool + handover
surface); otherwise re-score A vs F with the new evidence.

No implementation of the selected direction has begun.
