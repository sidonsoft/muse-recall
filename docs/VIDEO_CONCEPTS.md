# Video concepts — two shortlisted products

> **Historical document.** This is an early video concept. The submission now uses the V14 video (Ocean Pairs) and the Phase 16 / 16B research; see the [README](../README.md) and the [submission copy](submission/SUBMISSION_COPY.md). Kept for the development record.

Both are 3:00, recorded with real Muse inference on a fresh database. Screen actions are exact;
narration is a guide, not a word-for-word script. Nobody has recorded either video yet.

## Concept F — Project handover (recommended)

**Promise:** "When the person who built it leaves, the project remembers."

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:18 | Split screen: a codebase with no owner; a new engineer staring at an unfamiliar decision | "Every project has decisions nobody wrote down, dead ends nobody remembers, and work that stopped mid-step. When the person who knew leaves, that context leaves with them." |
| 0:18–0:40 | Muse Recall opens on `muse-recall-dev`; memory list shows constraint / failed approach / decision / unfinished work with provenance | "Muse Recall keeps that context: project-scoped, sourced, and correctable. Not a chat log — the facts a successor actually needs." |
| 0:40–1:10 | New session (zero history). Successor asks: "Why does persistence use node:sqlite, and what failed before?" Answer cites the native-module constraint and the abandoned `better-sqlite3` build; open **Memory used** to show ranked evidence | "A new session has no transcript. It retrieves the decision, the reason, and the failure — and shows exactly where each came from." |
| 1:10–1:35 | Successor corrects a stale fact ("we now allow one vetted native module"); old memory becomes `superseded` with history; a new session answers with the current fact | "Knowledge changes. Corrections supersede the old fact transactionally, and the history stays auditable — so the next person trusts the memory instead of fearing it." |
| 1:35–2:05 | Ask for a handover brief; Muse generates a validated brief surface (constraints, dead ends, open questions, tasks). Submit; agent drafts tasks; two pending calls; approve | "At handover, Muse assembles the brief and turns open work into tasks. Writes need approval; every call is audited." |
| 2:05–2:30 | New session asks "What is the state of this project and what should I do first?"; answer uses brief + tasks | "A second fresh session can summarise the project and the next step — without either engineer in the room." |
| 2:30–2:45 | Cut to architecture strip: memory → bounded retrieval → validated interfaces → approved actions | "Under the hood: bounded retrieval within a fixed context budget, provenance on every fact, declarative interfaces, and an approval gate on actions." |
| 2:45–3:00 | Title card + repo | "Muse Recall — the memory your project keeps. Built on Meta Muse, local-first." |

**Reliability plan:** pre-seed the four memories through the UI, rehearse twice, and keep the
correction + brief generation as the only long model waits. Record on a fresh database.

**Why it wins:** a concrete human moment (inheriting a project), a clear before/after, and it
uses correction — the least commoditised capability — as the emotional turn.

## Concept A — Developer memory (broader market)

**Promise:** "Stop re-learning your own project."

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:20 | Developer returns after two weeks; greps the repo to re-discover a decision; opens three tabs | "You solved this already. Two weeks later, the reasoning is gone, and the assistant starts from zero." |
| 0:20–0:45 | Muse Recall project view: constraint, failed migration, current decision | "Muse Recall keeps the decisions, the constraints, and the approaches that failed — sourced and project-scoped." |
| 0:45–1:20 | New session: "We need a backup command — what should we use and avoid?" Answer names `node:sqlite`, warns off `better-sqlite3`; Memory used shows evidence | "A fresh session answers from memory, not from a transcript — and shows why it believes each fact." |
| 1:20–1:40 | Ask to plan the backup; generated form; submit; tasks proposed and approved | "When it is time to act, Muse generates the interface it needs and creates tasks with your approval." |
| 1:40–2:10 | Correction: "native modules are now allowed for vetted packages"; supersession; new session uses the new constraint | "When the rule changes, the old fact is superseded — not silently averaged with the new one." |
| 2:10–2:30 | Memory inspector: provenance, scores, supersession chain | "Every answer is inspectable: which memories, which scores, which budget." |
| 2:30–2:50 | Evaluation table (n=4) and pilot result | "Measured with real Muse: 4/4 correct in both configurations, with memory adding about 68 tokens and removing setup turns." |
| 2:50–3:00 | Title card | "Muse Recall — your project's decisions, remembered." |

**Reliability plan:** same as F; the pilot's honest gap ("no tracked unfinished work") should
either be fixed before recording or omitted from the shot list.

## Production rules

- Real inference only; no mocked answers, no fabricated timings.
- Fresh database; no personal notifications or `.env`.
- Show the evidence panel at least once; do not claim memory is cheaper per call.
- If a generation is slow, cut the wait rather than fake the result.
- Both concepts reuse the current release candidate; no new feature is required to record F's
  core (the brief tool would improve 1:35–2:05).
