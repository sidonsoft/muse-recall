# Product comparison — Handover vs Muse Forge

Same internal weights as Phase 7. Scores reflect **verified** evidence, not ambition.

| Criterion (weight) | Handover | Muse Forge |
| --- | ---: | ---: |
| Real-world usefulness (25%) | 9 | 9 |
| Differentiation (20%) | 9 | 9 |
| Three-minute demo impact (20%) | 8 | 10 |
| Meta Muse alignment (15%) | 8 | 10 |
| Delivery feasibility (10%) | 9 | 4 |
| Long-term potential (10%) | 8 | 8 |
| **Weighted total** | **8.55** | **8.75** |

Reasoning:

- **Usefulness:** both solve real continuity problems; game developers feel the pain of
  iterating on visuals and losing design decisions, but the market is narrower and more
  crowded with coding agents.
- **Differentiation:** Forge's screenshot-conditioned iteration + creative memory + approval is
  distinctive; "ask a coding agent for a Phaser game" is not. Handover's correction workflow is
  also distinctive and less contested.
- **Demo:** Forge wins clearly — a playable game and a visible before/after edit beats a
  text-based handover, provided the in-app loop exists.
- **Muse alignment:** Forge is squarely on Meta's stated game/multimodal positioning.
- **Feasibility:** this is Forge's decisive weakness. Today the loop is CLI + external browser:
  no workspace management, preview, selection, change approval, or rollback in the app. The
  existing tool runtime deliberately forbids arbitrary filesystem access, so a safe workspace
  needs design (scoped root, allowlist, approvals, diff review).
- **Long-term:** both can become open-source tools; Forge has more competition from agentic
  coding tools.

## Implementation estimate

| Work | Forge |
| --- | --- |
| Reuse | provider, memory engine, corrections, project scope, sessions, typed tools + audit, generated UI, tasks, evaluation harness (~70%) |
| Must add | scoped game workspace, Muse CLI job runner with `--workspace`/`--image`, preview iframe/static server, screenshot capture, change diff + approval, rollback, token-budget guard |
| MLP | 2–3 focused days (single project, single `index.html`, generate → preview → screenshot-modify → approve) |
| Video + docs | 1 day |

## Decision

**Recommendation: Muse Forge, conditional on a 24-hour gate.**

- Gate by hour 24: an in-app loop that generates a game into a scoped workspace, previews it,
  attaches a fresh screenshot to a modification request, shows the diff, and applies it only
  after approval.
- If the gate is missed, **do not pivot**; submit Project Handover from `main` (`8da738a`),
  which is demo-ready today and does not depend on unbuilt infrastructure.
- Either way, keep `main` untouched and the product-validation branch intact.

This is not an automatic preference for the visually impressive option: Forge scores higher
only because its demo and Muse alignment are stronger, and it passes the technical gates. The
feasibility score of 4 is the reason for the explicit fallback.


## Phase 9 evidence update

The MVP changed the feasibility picture, so the delivery score is re-scored against working code:

| Capability | Result |
| --- | --- |
| Real-Muse in-app generation | **PASS** — 122.4 s, 8 calls, 320k input tokens, approved as v1 |
| Sandboxed preview + canvas | **PASS** — desktop/mobile, reload, screenshot capture |
| Screenshot-driven modification | **PASS with caveats** — 53.2 s narrow change validated; broad first attempt replaced Phaser (rejected); one retry exceeded 600 s |
| Diff review + approval | **PASS** — validation, approval gate, decision capture |
| Rollback | **PASS** — verified in the browser and by tests |
| Memory injection | **PASS** — retrieval before jobs, provenance recorded; tests cover superseded exclusion |
| Runtime safety | **PARTIAL** — runtime errors are surfaced and block approval; no automated gameplay test |

Revised delivery feasibility: **6/10**. The workflow works end to end, but real modification
latency is variable and the validator is structural. Forge now scores **8.95** (up from 8.75);
Handover remains 8.55. The condition for submission is that the demo uses narrow, rehearsed
changes and shows the runtime-error gate rather than hiding it.
