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

*(Recorded after Phase 4 implementation.)*
