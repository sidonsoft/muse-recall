# Demo script

Recorded results come from real Muse inference (`muse-wonder-1.0`, Muse Code 1.4.13) on the
reference machine. Reproduce with a **fresh database** — Demo B supersedes a fact, and
replaying it against an already-corrected store would find nothing to supersede.

```bash
rm -f apps/server/data/demo.db*
DATABASE_PATH=./data/demo.db MODEL_PROVIDER=muse-cli pnpm dev:server
# in a second terminal:
pnpm demo:sessions     # Demo A and B
pnpm bench:context     # Demo C
```

Evidence JSON is written to `docs/benchmarks/`.

---

## Demo A — persistent memory across sessions (≈2 minutes)

1. Open **Conversations → New conversation**, project `montys-memory-meadow`.
2. Say:

   > We are building a children memory game using Phaser. The target platform is mobile web.
   > The art direction is colourful illustrated farmyard scenery. Remember these requirements.

   Watch the green **Saved 3 memory record(s)** note and the **Memory used** disclosure.
3. Open **Memories** and show the three records with `source ref = explicit-command`.
4. Start a **new conversation in the same project** and ask:

   > What game are we building, which engine are we using, and what is the target platform?

5. Expand **Memory used**: two memories retrieved, scores and evidence shown,
   `history messages: 0` — no transcript was carried over.

**Recorded answer:** "A children's memory game, using Phaser, targeting mobile web."

**Point to make:** the second session never saw the first conversation. The answer came from
retrieved project memory, not from history.

---

## Demo B — correctable memory (≈2 minutes)

1. In a new conversation (same project), say:

   > We have changed the target platform. The game will now prioritize desktop browsers
   > instead of mobile web. Remember this correction.

   The capture note reports **superseded an earlier record**.
2. Open **Memories**, filter to *All visible*: the old platform record is `superseded` and
   links to its replacement; its history shows `created` → `superseded`.
3. Start a **new conversation** and ask:

   > What platform are we targeting now, and did that change?

**Recorded answer:** "We are now targeting **desktop browsers** for Monty's Memory Meadow.
Yes — that changed. It was previously mobile web…"

4. Expand **Memory used**: only the active record is retrieved. The previous value appears
   in the labelled `recent_corrections` section, not as an active memory.

**Point to make:** correction is transactional, history is preserved, and stale facts never
enter ordinary retrieval.

---

## Demo C — context efficiency (measured, not assumed)

Run `pnpm bench:context`. Baseline: facts supplied in a previous turn, so the answering call
re-sends them as history. Memory: fresh session, facts retrieved.

| Metric | Baseline | Memory |
| --- | --- | --- |
| Turns per task | 2 | 1 |
| Answering-call input tokens | 16,863 | 16,900 |
| Whole-task input tokens | 33,671 | 16,900 |
| Correctness | 100% | 100% |

**Point to make:** memory costs ~37 more tokens on the answering call and saves an entire
setup turn, halving the task's input tokens. Both pay the CLI's ~16.6k baseline, so we do not
claim per-call savings.

---

## Demo D — generated interface (Phase 4)

1. New conversation in the project, ask: *"Help me plan the game's first milestone."*
2. Muse returns an inline planning form (project name, genre, platforms, features).
3. Fill it in and submit; the agent continues with a plan, and the submitted values are
   stored as project memory.
4. New conversation: *"What did we decide for the first milestone?"* → recalls it.

**Recorded result (real Muse, `muse-wonder-1.0`):** asked *"Plan the first playable milestone
for our Phaser game"*, Muse returned an 8-field form — milestone name, core memory mechanic
(select), content scope (select), features (multiselect), target session length (number),
art/audio direction (textarea), playtest goal (textarea), touch support (checkbox) — in 6.99 s.
The form renders inline, labelled **Generated interface** and "validated spec".

Submitting it:

- validated every value against the stored form;
- saved the submission as **project memory** with provenance `ui:<surfaceId>`;
- ran an agent turn that produced a milestone plan with scope, build tasks, and a "done when"
  section;
- showed "Interface submitted. The plan was saved as project memory and Muse continued."

A new conversation in the same project recalls the submitted plan from memory.

**Point to make:** the model chose the *fields*, not the layout or code; the server validated
the spec before rendering and validated the submission against that same spec before acting.


---

## Demo E — authorized tools (Phase 5)

1. New conversation in `montys-memory-meadow`.
2. Ask: *"Create a project task to fix the menu layout, and another to add sound effects."*
3. Muse plans two `task.create` calls. Both appear under **Tool activity** as `pending` with
   their arguments; the answer says they have not run yet.
4. Approve each. The task is created, the audit entry flips to `executed`, and Muse continues
   with the result.
5. Ask: *"List the project tasks and tell me what is planned."* The read tool runs without
   approval and Muse answers with the tasks.
6. Start a **new conversation** and ask: *"What tasks are planned for this project?"* — Muse
   calls `task.list` and answers, proving the state lives in the project, not the transcript.

**Recorded result (real Muse, `muse-wonder-1.0`):**

- planning turn: 2 × `task.create` pending — "Fix the menu layout", "Add sound effects";
- approvals: both `executed` (follow-up turns used 16,953 and 17,138 input tokens);
- list turn answered with both tasks and their ids;
- new session: `task.list` executed and answered "2 tasks are planned (both todo)".

**Point to make:** the model planned the work, but a human authorized every write; the audit
log contains the requests, decisions, results, and timings.
