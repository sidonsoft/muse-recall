# Muse Recall guide

Muse Recall is a local-first **HTML Studio** for building single-file browser applications with
Meta's Muse Spark. It combines three things that are usually separate: project decisions that
survive across sessions and can be corrected, generated changes that wait for review before they
become current, and an advisory source check that shows where a staged change may conflict with a
remembered decision.

**Current scope:** one user, one local machine. The API binds loopback and has no authentication.
It is not a hosted or multi-user product.

These pages document the current repository, including the N1–N3 follow-up fixes merged after the
initial local-beta hardening. They are written as source material for a product site as well as for
people running the code. No benchmark is introduced here; measured results live in the linked
evidence documents.

## Read this guide

| Page | Read it for |
| --- | --- |
| [Getting started](getting-started.md) | Prerequisites, install, environment, demo seed, run, verification commands, troubleshooting |
| [Project memory](project-memory.md) | Decision types, creation, correction and supersession, retrieval, Forge mode, the exact prompt block |
| [HTML Studio](html-studio.md) | Generate and modify, staging, review, approve, reject, rollback, Decision Guard, export |
| [Architecture](architecture.md) | Local processes, packages, data at rest, request and job lifecycles, security boundaries |
| [Limitations](limitations.md) | Honest boundaries: loopback-only, load-time verification, advisory Guard, provider and evidence scope |

Every page starts with the same navigation line and closes with further reading or the same links.
All links are relative to this repository.

## The loop in one view

| Step | What happens | Surface |
| --- | --- | --- |
| 1. Decide | A constraint, preference or technical decision is stored with scope, provenance, confidence and validation state. | **HTML Studio → Project memory**, or **Memory** |
| 2. Generate | HTML Studio retrieves active project decisions, renders them as bounded reference data, and asks Muse Spark for one `index.html`. | **HTML Studio** |
| 3. Stage | The result is written to a per-job staging directory. Nothing becomes current. | **HTML Studio → Preview / Source / Changes** |
| 4. Review | The staged document, its diff, structural checks, runtime preview and advisory Guard findings are visible. | **HTML Studio → Review** |
| 5. Approve or reject | Approval loads the exact staged bytes in a browser and promotes exactly those bytes to an immutable version. Rejection deletes the staging copy and leaves the current version alone. | **HTML Studio → Review** |
| 6. Correct and reuse | A correction inserts the replacement, records the supersession edge, marks the old decision `superseded`, and excludes it from later retrieval. | **Memory → detail → Correct** |
| 7. Roll back if needed | Rollback restores the recorded parent version; the version list stays as an audit trail. | **HTML Studio → Review → Version history** |

A correction changes what later generations are told. It does **not** rewrite an already approved
application by itself: after correcting a decision, ask for the application change explicitly and
review the resulting job. This residual behavior is recorded as F6 in the
[live-run evidence](../hackathon-evidence/live-dsh-run-2026-10-29/after/AFTER_FIXES.md).

## Surfaces

| Surface | Purpose |
| --- | --- |
| **HTML Studio** | The landing surface. Project switcher, development prompt, sandboxed preview, source, diff, review, version history. |
| **Memory** | Search and filter decisions, inspect provenance and score components, create, correct, edit or delete, and run the retrieval explainer. |
| **Conversations** | Chat with the agent. Each turn retrieves active project memory within the chat budget. |
| **System** | API health, configured models, retrieval configuration and the honest module status reported by `GET /api/meta`. |

## What is deliberately not claimed

- **Decision Guard is advisory, not enforcement.** It can report `BLOCK` findings, but those
  findings are not wired into validation or approval. A human can approve a staged change that the
  Guard flags. See [HTML Studio](html-studio.md).
- **Runtime verification is load-time only.** Approval loads the staged page once in headless
  Chromium. It does not click through the application, inspect pixels, or prove correctness. See
  [Limitations](limitations.md).
- **Provider support is narrow.** The shipped providers are the Meta Muse Code CLI (`muse-cli`) and
  a deterministic offline `echo` provider. Muse Spark Open on Baseten was used for research; the
  application does not call it, and arbitrary provider support is not implemented.
- **The application is not hosted.** It runs locally, or in your own GitHub Codespace on the
  offline provider (see [Getting started](getting-started.md#run-in-github-codespaces)). The
  [project website](https://sidonsoft.github.io/muse-recall-website/) is a static landing page, not a copy of the app. The recorded
  submission cut is committed under [`docs/demo/video/`](../demo/video/).

## Related references

- [Repository README](../../README.md) — product overview, current evidence and full command list
- [Architecture overview](../ARCHITECTURE_OVERVIEW.md) — the short architectural companion
- [Memory design](../memory-design.md) — schema and retrieval invariants in detail
- [Security model](../security.md) — threat model, Forge child environment, origin guard
- [Known issues](../KNOWN_ISSUES.md) — granular defect and limitation list
- [HTML Studio assessment](../HTML_STUDIO_ASSESSMENT.md) — what the Studio contract does and does not cover
- [Evaluation](../evaluation.md) and [Phase 17 results](../hackathon-evidence/phase17/RESULTS.md) — measured evidence, with scope and corrections
- [Muse integration](../muse-integration.md) — verified CLI behavior
- [Evidence map](../submission/EVIDENCE_MAP.md) — claim-by-claim mapping

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
