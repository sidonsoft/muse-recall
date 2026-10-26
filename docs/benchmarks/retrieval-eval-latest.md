# Retrieval evaluation — measured

Generated 2026-10-26T22:24:11.993Z · run `ptpng9` · model `muse-wonder-1.0`.
Corpus: 16 seeded memories across 3 projects, including one corrected
and one deleted memory.

| Metric | Result |
| --- | --- |
| Retrieval questions | 22 |
| Retrieval passes | 20 (90.9%) |
| Muse answers sampled | 7 |
| Answers correct | 7 |
| Answers **memory-grounded** (correct + supporting retrieval) | 7 |

## By category

| Category | Pass / total |
| --- | --- |
| exact terminology | 2 / 2 |
| different vocabulary | 2 / 2 |
| indirect question | 2 / 2 |
| multiple projects | 1 / 1 |
| project isolation | 1 / 1 |
| corrected information | 2 / 3 |
| missing information | 2 / 2 |
| deleted memory | 1 / 1 |
| project constraint | 3 / 3 |
| project goal | 1 / 1 |
| unfinished work | 1 / 2 |
| failed approach | 1 / 1 |
| contradictory information | 1 / 1 |

## Per question

| # | Category | Result | Mode | Selected | Retrieved |
| --- | --- | --- | --- | --- | --- |
| q01 | exact terminology | PASS | relaxed | 3 | We are building Monty's Memory Meadow with Phaser.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q02 | exact terminology | PASS | relaxed | 3 | The art direction is colourful illustrated farmyard scenery.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q03 | different vocabulary | PASS | relaxed | 4 | Starlight persists data in Postgres.<br>Every Starlight endpoint must require authentication.<br>Rate limiting for Starlight is not implemented yet.<br>The Starlight API uses Fastify for its HTTP server. |
| q04 | different vocabulary | PASS | relaxed | 2 | The Starlight API uses Fastify for its HTTP server.<br>Every Starlight endpoint must require authentication. |
| q05 | indirect question | PASS | relaxed | 2 | The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q06 | indirect question | PASS | relaxed | 3 | We tried a canvas-only renderer and it broke accessibility, so we abandoned it.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q07 | multiple projects | PASS | relaxed | 4 | The garden planner is built with React and Vite.<br>The garden planner must work on a phone screen.<br>The garden planner palette should be high-contrast navy.<br>The garden planner palette should be warm pastel green. |
| q08 | project isolation | PASS | relaxed | 2 | The Starlight API uses Fastify for its HTTP server.<br>Every Starlight endpoint must require authentication. |
| q09 | corrected information | PASS | relaxed | 3 | The target platform is desktop browsers.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q10 | corrected information | PASS | relaxed | 3 | The target platform is desktop browsers.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q11 | missing information | PASS | fallback | 7 | The game must run offline on integrated graphics.<br>The target platform is desktop browsers.<br>Ship the first playable build by December 2026.<br>The art direction is colourful illustrated farmyard scenery.<br>We are building Monty's Memory Meadow with Phaser.<br>The sprite animation pipeline is still unfinished.<br>We tried a canvas-only renderer and it broke accessibility, so we abandoned it. |
| q12 | deleted memory | PASS | fallback | 7 | The game must run offline on integrated graphics.<br>The target platform is desktop browsers.<br>Ship the first playable build by December 2026.<br>The art direction is colourful illustrated farmyard scenery.<br>We are building Monty's Memory Meadow with Phaser.<br>The sprite animation pipeline is still unfinished.<br>We tried a canvas-only renderer and it broke accessibility, so we abandoned it. |
| q13 | project constraint | PASS | relaxed | 2 | The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q14 | project goal | PASS | relaxed | 3 | Ship the first playable build by December 2026.<br>We are building Monty's Memory Meadow with Phaser.<br>The game must run offline on integrated graphics. |
| q15 | unfinished work | PASS | relaxed | 3 | The sprite animation pipeline is still unfinished.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q16 | failed approach | PASS | relaxed | 3 | We tried a canvas-only renderer and it broke accessibility, so we abandoned it.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q17 | project constraint | PASS | relaxed | 1 | Every Starlight endpoint must require authentication. |
| q18 | unfinished work | FAIL | relaxed | 2 | The Starlight API uses Fastify for its HTTP server.<br>Every Starlight endpoint must require authentication. |
| q19 | corrected information | FAIL | relaxed | 3 | The sprite animation pipeline is still unfinished.<br>The game must run offline on integrated graphics.<br>Ship the first playable build by December 2026. |
| q20 | contradictory information | PASS | relaxed | 4 | The garden planner palette should be high-contrast navy.<br>The garden planner palette should be warm pastel green.<br>The garden planner must work on a phone screen.<br>The garden planner is built with React and Vite. |
| q21 | project constraint | PASS | relaxed | 4 | The garden planner must work on a phone screen.<br>The garden planner palette should be high-contrast navy.<br>The garden planner palette should be warm pastel green.<br>The garden planner is built with React and Vite. |
| q22 | missing information | PASS | relaxed | 4 | The garden planner must work on a phone screen.<br>The garden planner palette should be high-contrast navy.<br>The garden planner palette should be warm pastel green.<br>The garden planner is built with React and Vite. |

A correct answer is only counted as memory-grounded when the retrieval evidence for
that turn contains the supporting memory. Retrieval alone is not proof that the model
used it, and a correct guess without evidence is not counted.
