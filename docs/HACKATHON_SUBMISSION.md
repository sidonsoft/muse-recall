# Muse Recall — submission description

> **Historical document.** This is an earlier product description (the Phase 5 memory companion with generated forms and tools). The submission now uses the Ocean Pairs demo video and the Phase 16 / 16B research; see the [README](../README.md) and the [submission copy](submission/SUBMISSION_COPY.md). Kept for the development record.

## Problem

AI assistants lose useful context between sessions. Users re-explain project constraints,
repeat decisions, and quietly work around stale advice. Retaining a full transcript is not a
fix: it is expensive, unselective, and still cannot say which fact is current.

## Solution

**Muse Recall** is a local-first memory companion for Meta Muse. It extracts durable project
knowledge, stores it with provenance, retrieves it selectively under a hard context budget,
and — crucially — lets the user correct it. Corrections supersede the old fact transactionally:
the previous value stays auditable but is never returned as current.

## Differentiator

Memory alone is a database. Muse Recall pairs it with two capabilities that make the memory
*usable*:

1. **Dynamically generated interfaces.** Muse designs a task-specific planning form, which is
   validated against a closed schema and rendered by a fixed component registry. No
   model-authored HTML or JavaScript executes.
2. **Authorized actions.** Submitting that form becomes a structured agent turn, and Muse can
   call six audited project tools. Reads run immediately; every write waits for explicit user
   approval. The project scope comes from the session, never from model arguments.

## Technical contribution

- **Bounded retrieval:** hard scope/status/expiry filters, weighted scoring (bm25 relevance,
  scope, confidence, validation, per-type recency, type priority), pinned constraints, and
  configurable count/character budgets. Every result carries component scores and an evidence
  sentence; the prompt is assembled with per-section accounting.
- **Provenance-aware corrections:** supersession, immutable history, FTS-safe deletion, and a
  turn-evidence table that stores ranking metadata but *not* memory content, so purging a
  memory cannot erase the record that it influenced an answer.
- **Declarative UI generation:** strict Zod schemas, a block allow-list, and server-side
  validation of both generation output and submissions.
- **Auditable tool execution:** a typed registry with Zod input/output validation, a
  two-phase approval for writes, and an audit log that also records invalid and denied calls.

## Demonstration

One project, Monty's Memory Meadow, across five sessions: requirements captured in session A;
a brand-new session B answers from memory with zero history; a correction in session C
supersedes the platform decision; session D generates a planning form whose submission
produces pending tool calls; after approval, a new session recalls the project, the current
platform, and the planned tasks. One run of `pnpm demo:showcase` performs all of it with real
Muse inference and writes machine-readable evidence.

## Evidence

| Claim | Evidence |
| --- | --- |
| Requirements survive a new session | `docs/benchmarks/showcase.json` (8/8 checks) |
| Corrections supersede and stale facts are excluded | showcase + `tests/unit/memory-engine-phase2.test.ts` |
| Generated interfaces are validated and drive work | `packages/ui-protocol`, `tests/unit/ui-protocol.test.ts` |
| Tools require approval and are audited | `tests/integration/tools-api.test.ts` |
| Evaluation is measured, not asserted | `docs/EVALUATION_REPORT.md` (n=4) |
| Test suite | 263 tests (265 with live Muse) |

## Honest limitations

Keyword retrieval misses two vocabulary-gap cases in the 22-question evaluation; embeddings
are recommended but deliberately not implemented in this phase. The Muse CLI adds a ~16.6k
token baseline that dominates per-call totals, so memory is not claimed to be cheaper per call
— the measured saving comes from removing setup turns. The application is a single-user,
loopback-only development build with no authentication.

## Why it fits the event

It uses Meta Muse as the reasoning engine for every conversation, generation, and tool plan;
it demonstrates a real capability the base model lacks (persistent, correctable project state);
and it is a working, inspectable product rather than a slideware concept.
