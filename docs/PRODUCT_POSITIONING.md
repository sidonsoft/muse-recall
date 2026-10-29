# Muse Recall — product positioning

**Status:** current for `main` at `12918fd` (2026-10-29). This replaces the earlier
positioning drafts. Historical Phase 5 and Phase 14A narratives remain in
[`HACKATHON_SUBMISSION.md`](HACKATHON_SUBMISSION.md) and
[`submission/PROJECT_STORY.md`](submission/PROJECT_STORY.md) as development records.

---

## 1. The one-sentence product

**Muse Recall gives AI-built software a correctable project memory: it carries design
decisions across sessions, lets users revise them, and makes generated changes reviewable
before they become the approved version.**

Tagline: **Correctable project memory for AI-built software.**

The focused demo's replacement correction (sunset → ocean) is supported by
[Phase 12A](PHASE12_MEMORY_VALIDATION.md), one run per condition. Phase 17's correction was
**permissive**: it released the old restrictions rather than substituting a new requirement.

The generated browser application is the visible artifact. Correctable memory is the
differentiator. Human review is the control surface.

---

## 2. The user problem

AI builders are fast at the first draft and weak at the second week:

- **Requirements are restated.** A new session starts from zero, so the user explains the
  same constraint again.
- **Changes forget.** A generated edit can drop an earlier decision. The regression appears
  later, when it is expensive to find.
- **Stale preferences persist.** When the user changes their mind, the old preference can
  keep coming back. A transcript is a record of everything said, not a statement of what is
  current.

A longer transcript does not solve this. It is expensive, unselective, and still cannot say
which decision is current after a correction.

---

## 3. The three-part promise

| Layer | Promise | What the user sees |
| --- | --- | --- |
| **Muse Spark builds** | Describe a browser application; get a working single-file `index.html`. Ask for a change; the approved source is edited. | HTML Studio: prompt, sandboxed preview, source, staged diff. |
| **Recall remembers and corrects** | Project decisions persist with identity, provenance and history. A correction supersedes the old decision without erasing it. Active decisions are supplied to later generations. | Project memory rail, active/superseded states, retrieval explainer, recorded decision ids and prompt SHA-256. |
| **You review and decide** | Nothing becomes current automatically. Read the preview, source and diff; approve, reject, or roll back. | Review rail: syntax/load checks, advisory Decision Guard, approval, version history, rollback. |

The order in the UI is deliberate: the application is the hero; memory explains continuity;
review makes the change trustworthy.

---

## 4. Product identity

- Product: **Muse Recall**
- Feature surface: **HTML Studio**
- Engine: **Meta Muse Spark** through the Muse Code CLI on the Meta subscription, with the
  configured bounded contributor-API fallback
- Workflow line: **Memory guides. Guard warns. You decide.**
- Closing line: **Muse Spark builds it. Recall remembers why. You decide what ships.**

Internal identifiers (`@mml/*` packages, `muse-memory-lab`, Forge API routes, database names)
are unchanged.

### What the product is not

- Not a general chat assistant. Conversations remain a supporting surface.
- Not a game generator. The recorded demo is a game; the capability is browser applications.
- Not an autonomous publisher. No generated change becomes current without human approval.
- Not a compliance product. Decision Guard is advisory and explicitly bounded.
- Not a multi-provider production platform. Provider independence is an architectural
  direction; only the Muse Code CLI and the deterministic `echo` provider are implemented.

---

## 5. The workflow we present

```
Describe  →  Muse Spark writes index.html  →  Stage
   ↑                                            ↓
   └──  Approve / reject / roll back  ←  Preview · Source · Diff · Guard
                    ↑
             Correct a decision
             (old one superseded)
```

1. **Describe.** A prompt names the application and its requirements.
2. **Build.** Muse Spark writes exactly one `index.html` into a staging copy. The approved
   version is untouched.
3. **Inspect.** The staged document runs in a sandboxed iframe with an opaque origin. Source
   and a line diff are one click away. The job records the decisions it retrieved and the
   SHA-256 of its prompt.
4. **Correct when the direction changes.** In Memory, the user supplies a replacement and a
   reason. One transaction inserts the replacement, records the supersession edge, marks the
   old decision `superseded`, and keeps the history. The old record is excluded from active
   retrieval.
5. **Review.** Structural checks and a load-time browser gate run; Decision Guard reports
   advisory findings from supported source patterns, citing the decisions they came from.
6. **Decide.** Approval promotes the exact verified bytes to an immutable version. Rejection
   deletes the staging copy. Rollback restores the recorded parent.
7. **Remember.** The user may save their own decision sentence; the model's summary is never
   promoted automatically.

---

## 6. What is genuinely different

Persistent project memory is not new. Retrieval stores, transcripts and long-running agents
all provide versions of it. The contribution is the **integration** of three things that are
usually separate:

1. **Correctable memory** — a decision can be revised without losing its audit trail, and the
   correction changes what later generations retrieve.
2. **Controlled application changes** — a generated change is staged, inspectable, loaded
   once in a browser, and promoted only by explicit human approval; versions and rollback are
   first-class.
3. **Measured behavioural evidence** — across Phase 16 and Phase 17: a palette-only control in
   Phase 16, and the `none`, `memory`, `manual` and `corrected` arms in Phase 17, with the
   protocol and detectors fixed before the runs. Phase 17's correction was permissive (it
   released the old restrictions); the sunset-to-ocean replacement in the focused cut is
   Phase 12A evidence, one run per condition.

Memory alone is a database. Generation alone is a demo. The product is the loop that connects
them, with the human deciding what becomes current.

---

## 7. Decision Guard's role

Decision Guard is an **independent, advisory review layer**:

- It checks supported, deterministic source patterns against the job's own decisions:
  countdown mechanics, flashing effects, mistake penalties, superseded palette and
  colour-only cues.
- It reports findings with the rule, severity, decision reference, explanation and a bounded
  evidence excerpt. A decision it cannot check is reported as **not verified**, never as a
  pass.
- It never feeds validation, never blocks approval, and cannot turn a finding into
  authorisation.
- Its measured false positives, false negatives and abstentions are why enforcement remains a
  human decision. It sees source text, not rendered behaviour.

Interface copy must retain: **"Advisory only. Findings do not block approval. Supported checks
only — not a compliance certification."**

---

## 8. Evidence boundary

Phase 17 is the current behavioural evidence: 480 pre-registered runs, four arms × six strata ×
two models. Counts are violations / usable runs for the original rule.

| Arm | Muse Spark | Muse Spark Open |
| --- | ---: | ---: |
| No memory (`none`) | 37/57 | 49/60 |
| Retrieved memory (`memory`) | **0/58** | **1/60** |
| Rule retyped by hand (`manual`) | 0/58 | 0/60 |
| Rule corrected before the edit (`corrected`) | 41/59 | 50/60 |

- `memory` vs `none`: exact p = 6.5 × 10⁻²⁰ (Spark) and 1.1 × 10⁻²⁴ (Open).
- `memory` vs `manual`: upper 90% bounds +4.5 pp and +7.1 pp, inside the pre-registered +15 pp
  non-inferiority margin. Memory is not worse than retyping the rule; this is not a claim that
  memory beats a well-written prompt.
- Eight Muse Spark runs hit the 30-minute cap and are unusable; Open had none. Counts use the
  remaining denominators. Counting unusable runs as violations does not change a verdict.
- The `corrected` arm is measured with the original-rule detector. Its higher rate **suggests
  the superseded restriction was released**; it does **not** test whether a replacement
  requirement is followed. Phase 17's correction was permissive; the sunset-to-ocean
  replacement is Phase 12A evidence, one run per condition.
- The exact p-values are a post-run reporting correction; the as-run analysis is preserved and
  no verdict changed.

**What this does not establish:** general application correctness, runtime safety, Decision
Guard effectiveness, or transfer to tasks, rules or models outside the six tested strata.

The Phase 12A A/B/C palette trial and the Phase 16 / 16B trials are earlier, separately bounded
evidence. They are mapped in [`submission/EVIDENCE_MAP.md`](submission/EVIDENCE_MAP.md).

---

## 9. Audience and judging narrative

| Audience | What they need in the first minute |
| --- | --- |
| Hackathon judge | "Muse Spark builds working software, and the project remembers why." |
| Developer evaluating it | "I can inspect and change the code, and it will not overwrite my app." |
| Memory/AI reviewer | "Decisions persist, corrections are auditable, retrieval is recorded." |
| Safety reviewer | "The generated document is sandboxed; Guard is advisory; humans approve." |

Narrative order:

1. **The problem.** Restated requirements, forgotten decisions, stale preferences.
2. **Muse Spark builds.** A working browser application appears.
3. **Muse Spark changes it.** A new-session request edits the approved source.
4. **Recall remembers and can be corrected.** The active decision is visible; a correction
   supersedes the old one.
5. **The change is reviewable.** Preview, source, diff, load check, advisory Guard.
6. **The human decides.** Approve, reject, roll back.
7. **The evidence.** Phase 17's narrow, pre-registered result, with its limits.

### Fit with the “Push the Frontier” software theme

The theme rewards work that moves software building forward, not another chat surface. Our
reading is that the next step is not a larger context window but a project memory you can
correct and a change you can review before it becomes current. Muse Recall is a working
integration of those pieces, with a pre-registered behavioural test rather than a demo-only
claim.

This is our interpretation of the theme. It is **not** an organizer endorsement, and we make
no prediction about the outcome.

---

## 10. Claims register

| Claim | Supported? | Evidence |
| --- | --- | --- |
| Muse Spark writes a complete working HTML application. | Yes | Recorded Forge baseline; live FocusFlow generation; preview + load check. |
| Generated applications run sandboxed with an opaque origin. | Yes | `sandbox="allow-scripts"` iframe plus CSP; preview route. |
| Project decisions persist with identity and provenance. | Yes | Memory schema and history; Forge job `memory_ids` and prompt SHA-256; tests. |
| A correction supersedes the old decision and excludes it from active retrieval. | Yes | Transactional `correct()`; supersession edges; retrieval filters `active`; seed and tests. |
| A staged change never becomes current without approval. | Yes | Staging directories, exact-byte promotion, compare-and-swap; integration tests. |
| Rollback follows recorded ancestry. | Yes | `base_version` ancestry; unit and integration tests. |
| Memory is supplied to later generations. | Yes | Production retrieval before each Forge job; recorded ids and prompt hash. |
| The remembered rule reduced original-rule violations in the tested tasks. | Yes, bounded | Phase 17: 37/57→0/58 and 49/60→1/60; exact p-values; 8 Spark timeouts. |
| Memory is non-inferior to retyping the rule. | Yes, bounded | H2 upper 90% bounds +4.5 pp / +7.1 pp against +15 pp. |
| A correction released the superseded restriction. | Supported as a **suggestion** | H3 original-rule rate rises to 41/59 and 50/60; no new-rule detector. |
| Retrieved memory *caused* a specific visual choice generally. | No | Only narrow controlled evidence; Phase 12A is n = 1 per condition. |
| Decision Guard is comprehensive compliance verification. | **No** | Advisory, five source-pattern families; measured FPs/FNs/abstentions. |
| Guard effectiveness is proven by Phase 17. | **No** | Phase 17 tests memory; Guard was not the intervention. |
| Runtime verification proves gameplay or pixel correctness. | **No** | Load-time only: page/console errors, blank render, canvas when Phaser is used. |
| Exported HTML is self-contained. | **Not necessarily** | Download preserves the artifact; a CDN reference still needs network. |
| The app supports arbitrary providers in production. | **No** | Only Muse Code CLI and deterministic `echo`; independence is a direction. |
| The 2:46 cut shows the explicit correction. | **No** | It shows the stored rule, refusal, fit, approval and rollback. The 2:50 cut shows the correction but is kept out of git and not yet uploaded. |

---

## 11. What this positioning pass changed

- Replaced the earlier "memory companion" and "game studio" framing with **correctable
  project memory for AI-built software**.
- Made correction and supersession, not memory alone, the differentiator.
- Put the reviewable change loop (stage → inspect → approve → history/rollback) at the center
  of the product story.
- Replaced Phase 16 headline numbers with the stronger, pre-registered Phase 17 evidence,
  including the manual comparison and the correction nuance.
- Kept Decision Guard explicitly advisory and separated its supported checks from blocking
  validation.
- Marked provider independence as an architectural direction and the 2:46 cut as a
  pre-correction artifact.
- Added a focused demo storyboard, then recorded it as the 2:50 cut, and extended the evidence
  map with Phase 17 and the demo status; no application behavior or research evidence was
  changed.
