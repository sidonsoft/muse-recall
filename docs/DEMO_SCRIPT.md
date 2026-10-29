# Demo script

> This is the earlier conversational demo record (Demos A–E). For the focused hackathon demo
> built around correctable memory and reviewable changes, see
> [demo/CORRECTABLE_MEMORY_DEMO.md](demo/CORRECTABLE_MEMORY_DEMO.md).

All results below were produced with real Muse inference (`muse-wonder-1.0`, Muse Code 1.4.13)
on a fresh database. Nothing is mocked; the deterministic provider is used only by tests.

## Setup

```bash
git clone https://github.com/sidonsoft/muse-recall.git && cd muse-recall
pnpm install
cp .env.example apps/server/.env
rm -f apps/server/data/demo.db*
DATABASE_PATH=./data/demo.db pnpm dev
```

Open `http://127.0.0.1:5173`. Two terminals also work: `pnpm dev:server` / `pnpm dev:web`.

## One-command rehearsal

```bash
DATABASE_PATH=./data/showcase.db pnpm dev:server     # fresh database
pnpm demo:showcase                                   # Demos A, B, D, E with real Muse
pnpm eval:comparison                                 # Demo C measurements
```

`pnpm demo:showcase` writes `docs/benchmarks/showcase.json` and prints a PASS/FAIL line per
check. Last recorded run: **8/8 passed**.

---

## Demo A — persistent memory (recorded)

1. Conversations → New conversation → project `montys-memory-meadow`.
2. Send: *"We are building a children memory game using Phaser. The target platform is mobile
   web. The art direction is colourful illustrated farmyard scenery. Remember these
   requirements."*
3. Start a **new conversation**, same project, and ask: *"What game are we building, which
   engine are we using, and what is the target platform?"*

**Recorded answer:** "We're building a children's memory game using Phaser, targeting mobile
web." — 2 memories retrieved, `history_messages: 0`.

## Demo B — correctable memory (recorded)

1. New conversation. Send: *"We have changed the target platform. The game will now prioritize
   desktop browsers instead of mobile web. Remember this correction."*
2. Memories → *All visible*: the mobile record is `superseded` and links to its replacement.
3. New conversation. Ask: *"What platform are we targeting now, and did that change?"*

**Recorded answer:** "We're now targeting desktop browsers. Yes, that changed — the previous
target was mobile web." — the old value appears only in the labelled `recent_corrections`
section, never in active retrieval.

## Demo C — context efficiency (measured)

`pnpm eval:comparison` — n=4 per configuration, single-call comparison:

| Metric | Facts inline | Memory |
| --- | --- | --- |
| Input tokens (mean) | 16,849 | 16,916.5 |
| Correct answers | 4/4 | 4/4 |

Across a multi-turn task (Phase 3 measurement): 2 turns / 33,671 tokens baseline vs 1 turn /
16,900 tokens with memory. Memory is not cheaper per call; it removes the setup turn.

## Demo D — generated interface (recorded)

1. In a conversation, ask: *"Plan the first playable milestone for our Phaser game."*
   Muse generates an 8-field registry-rendered form ("Monty's Memory Meadow: First Playable
   Milestone") in ~7 s.
2. Complete and submit it. The submission is validated against the stored spec, saved as
   project memory, and handed to the agent, which continues with a milestone plan.

## Demo E — authorized tools (recorded)

1. After the submission, Muse plans `memory.create` and `task.create`; both show as `pending`
   under **Tool activity**.
2. Approve them. They execute, the audit flips to `executed`, and Muse continues.
3. Ask: *"List the project tasks and tell me what is planned."* The read tool runs without
   approval.
4. Start a **new conversation** and ask: *"Summarise the project for a teammate: what are we
   building, what platform, and what tasks are planned?"*

**Recorded answer:** "Monty's Memory Meadow — a children's memory matching game built with
Phaser. Platform: Desktop browsers. First milestone: 'Playable meadow loop'…" — project
memory and tasks both retrieved.

## Screenshots

`docs/assets/phase6-showcase.png` (conversation list), `phase5-ui-tools.png` (approval),
`phase4-ui-generative-ui.png` (generated form), `phase2-ui-memory-detail.png` (correction
history), `phase2-ui-memory-retrieval.png` (retrieval evidence).
