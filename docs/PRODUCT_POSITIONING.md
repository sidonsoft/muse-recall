# Muse Recall — product positioning

**Status:** adopted for the hackathon submission candidate on
`agent/muse-recall-product-positioning`. This document defines what the product
claims, what it demonstrates, and what it must not imply.

---

## 1. The one-sentence product

**Muse Recall is an AI development workspace powered by Meta's Muse Spark: it
builds working HTML applications, remembers the decisions that shaped them, and
keeps the developer in control of every change.**

Tagline: **Build with Muse Spark. Remember what matters.**

The previous framing — "memory companion for Meta Muse" with a game-studio demo —
undersold the engineering capability and made the product read as a memory
research prototype. The capability was already there: Muse writes a complete
`index.html`, the server stages it, validates it, runs it in headless Chrome, and
promotes it only on human approval. That is an application development loop. The
product now presents it as one.

The demonstration still uses a game because a game is the most legible proof that
a generated document *works*: it renders, responds to input, and survives a
runtime check. Games are **one use case**, not the product category.

---

## 2. The three-part promise

| Layer | Promise | What the user sees |
| --- | --- | --- |
| **Muse Spark builds** | Describe a browser application in natural language; get a working, single-file HTML application. | HTML Studio: prompt, live sandboxed preview, source, staged diff. |
| **Recall remembers** | Project decisions persist across sessions, are retrieved into later prompts, and can be corrected without erasing history. | Project memory rail, active/superseded indicators, recorded decision ids and prompt hash. |
| **You decide** | Nothing is published automatically. Review findings, approve, reject, or roll back. | Review rail: advisory Decision Guard, approval, rejection, version history, rollback. |

This ordering is deliberate. The generated application is the hero; memory is the
differentiator; human control completes the workflow.

---

## 3. Product identity

### Name and copy

- Product: **Muse Recall**
- Feature surface: **HTML Studio**
- Feature subtitle: **From prompt to working browser application.**
- Engine: **Meta Muse Spark** (through the Muse Code CLI on the Meta subscription,
  with the project's existing bounded contributor-API fallback)
- Workflow line: **Memory guides. Guard warns. You decide.**
- Closing line: **Muse Spark builds it. Recall remembers why. You remain in control.**

Internal identifiers (`@mml/*` packages, `muse-memory-lab` service name, Forge API
routes, database names) are unchanged. This is a presentation and workflow
positioning change, not a rewrite of the platform.

### What the product is not

- Not a general chat assistant. Conversations remain a supporting surface.
- Not a game generator. The seeded demo is a game; the capability is HTML
  applications.
- Not an autonomous publisher. No generated change becomes current without a
  human approval.
- Not a compliance product. Decision Guard is advisory and explicitly bounded.

---

## 4. The workflow we present

```
Describe  →  Muse Spark writes index.html  →  Stage
   ↑                                            ↓
   └────  Approve / reject / roll back  ←  Preview · Source · Diff · Decision Guard
```

1. **Describe.** A prompt names the application and its requirements.
2. **Build.** Muse Spark writes exactly one `index.html` into a staging copy.
   The approved version is untouched.
3. **Inspect.** The staged document runs in a sandboxed iframe with an opaque
   origin. Source and a line diff are one click away.
4. **Review.** Structural validation and a browser load check must pass.
   Decision Guard reports advisory findings, citing the decisions they came from.
5. **Decide.** Approve promotes the exact verified bytes to an immutable version.
   Reject deletes the staging copy. Rollback restores the recorded parent.
6. **Remember.** The developer may save their own decision sentence to project
   memory; a later request retrieves it.

---

## 5. Why memory matters to this workflow

Iterative development is where context is lost. A palette, a child-safety
constraint, a "we use this date format" decision, a rejected approach: each is
cheap to state once and expensive to restate every session.

Muse Recall stores project decisions with:

- **provenance** — where the decision came from and which job recorded it;
- **confidence and validation status** — not every note is a verified fact;
- **append-only correction** — a correction supersedes the old decision while the
  old record stays auditable;
- **retrieval records** — each job stores the decision ids it was given and the
  SHA-256 of the exact prompt, so the context is reconstructable;
- **a retrieval explainer** — the Memory view shows why a decision surfaced.

### The honesty boundary

The interface says **"supplied to this generation"**, not "caused this output".
A retrieved memory is visible context. It is evidence of inclusion, not proof of
influence. Causal language is reserved for the controlled A/B/C trials recorded in
`docs/EVALUATION_REPORT.md` and the Phase 12 evidence, where one run per condition
was measured and the result is explicitly directional.

This distinction is a product feature. Judges should be able to see exactly what
was remembered without being sold a causal story the evidence cannot support.

---

## 6. Decision Guard's role

Decision Guard is presented as an **independent, advisory review layer**:

- It checks supported, deterministic source patterns against the job's own
  decisions.
- It reports findings with rule, severity, decision reference, explanation, and a
  bounded evidence excerpt.
- It never feeds `validation`, never blocks approval, and cannot turn a finding
  into authorisation.
- It reports what it could not verify, rather than implying full coverage.

Interface copy must always retain: **"Advisory only. Findings do not block
approval. Supported checks only — not a compliance certification."**

---

## 7. Human control

The visible state vocabulary maps to real implementation states:

| Label | Reality |
| --- | --- |
| **Staged** | A succeeded job with a staging file and no version. |
| **Approved / current** | A promoted immutable version. |
| **Rejected** | The staging file was deleted; the current version is untouched. |
| **Rolled back** | The current pointer was moved to a recorded ancestor. |
| **Failed** | Validation or runtime verification rejected the staged file. |

The UI must never show "approved" for a staged file, and must never imply a
recorded replay was generated live. The existing provenance disclosures are
preserved.

---

## 8. Audience and judging narrative

| Audience | What they need in the first minute |
| --- | --- |
| Hackathon judge | "Muse Spark builds working software, not chat." |
| Developer evaluating it | "I can inspect and change the code, and it won't overwrite my app." |
| Memory/AI reviewer | "Decisions persist, corrections are auditable, retrieval is recorded." |
| Safety reviewer | "The generated document is sandboxed; the guard is advisory; humans approve." |

Narrative order:

1. **Muse Spark builds.** A working HTML application appears from one prompt.
2. **Muse Spark develops.** A natural-language change edits the approved source.
3. **Recall remembers.** The project's decisions are visible and supplied.
4. **Decision Guard reviews.** Advisory findings cite those decisions.
5. **The developer decides.** Approve, reject, roll back.

---

## 9. Claims register

| Claim | Supported? | Evidence |
| --- | --- | --- |
| Muse Spark writes a complete working HTML application. | Yes | Recorded Forge baseline; live pipeline; preview + runtime check. |
| Generated applications run sandboxed with an opaque origin. | Yes | `sandbox="allow-scripts"` iframe plus CSP `sandbox allow-scripts`; preview route. |
| A staged change never becomes current without approval. | Yes | Staging directories, promotion, compare-and-swap; integration tests. |
| Rollback follows recorded ancestry. | Yes | `base_version` ancestry; unit and integration tests. |
| Project decisions persist and are retrieved into later prompts. | Yes | Memory engine, retrieval records, prompt hash, Phase 11/12 evaluation. |
| Retrieved memory *caused* a specific decision. | Only in controlled trials | A/B/C trial, n=1 per condition; directional. The UI never claims this generally. |
| Decision Guard is comprehensive compliance verification. | **No** | Advisory, five supported rule families; accuracy audit published. |
| Runtime verification proves gameplay or pixel correctness. | **No** | Load-time only: page errors, blank render, canvas when Phaser is used. |
| Exported HTML is self-contained. | **Not necessarily** | Download preserves the artifact; a CDN reference still needs network. The UI says so. |
| The demo modification was generated live. | **No** | Recorded Phase 12A source replayed; on-screen provenance label preserved. |

---

## 10. What changed in this pass

- Public identity renamed from "Muse Memory Lab / Forge" to **Muse Recall / HTML
  Studio** in the interface; internal names are unchanged.
- Landing surface is HTML Studio, not a system dashboard.
- The backend now accepts **general HTML applications**, not only Phaser games:
  validation requires a real document body with renderable content; Phaser
  documents still require a canvas or `Phaser.Game`; runtime verification accepts
  visible rendered content or a canvas.
- Modifications no longer require a screenshot; a screenshot remains optional
  visual grounding.
- Source inspection and export are first-class through the read-only artifact
  endpoint.
- Memory and Decision Guard are visible in the development workspace, not only in
  separate inspector screens.

The prompt wording changed accordingly. Recorded evidence from earlier phases is
historical and is not rewritten; it remains valid for the code and prompt that
produced it, and any new run should be treated as a new measurement.
