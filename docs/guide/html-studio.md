# HTML Studio

HTML Studio is the product surface where Muse Spark builds and edits one browser application. The
unit of work is a **job**: generate a new `index.html`, or modify the approved one. A job writes to a
staging directory and stops. Only an explicit human approval promotes it.

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)

## The artifact contract

- **One file:** a complete `index.html` with inline CSS and JavaScript. There is no build step,
  package installation, multi-file project, or server-side execution.
- **Network:** no external assets except the approved CDN, `https://cdn.jsdelivr.net`. Phaser 3 is
  available there for games; non-game applications do not need it.
- **Sandbox interaction:** generated code must use explicit click/keydown handlers and
  `<button type="button">`. Native form submission and top-level navigation are blocked in the
  sandboxed preview. Enter must be handled explicitly.
- **Storage:** the application may use its own `localStorage`, wrapped in `try/catch`, and keep
  working in memory when storage throws. `sessionStorage`, IndexedDB and cookies are not part of the
  contract.
- **No credentials or external services.** The preview has no access to the application origin,
  cookies or app storage.

These are prompt and validation constraints, not a guarantee about every generated application.
Structural checks and a load-time browser check are described below; semantic correctness and later
interactions remain a human review responsibility.

## Before generating: project decisions

HTML Studio retrieves project memory in the **forge** profile: pinned `constraint`, `goal`,
`preference` and `technical_decision` records, up to 6 memories and 3,000 rendered characters. The
job records the exact memory ids it received in `memory_ids` and the SHA-256 of the prompt in
`prompt_sha256`.

Use **Project memory → Add decision** to save a constraint or preference before generating. A
project with no decisions still generates; the Guard will report `not_verified` because it has no
recorded decisions to check, not `PASS`.

Retrieval and correction semantics are covered in [Project memory](project-memory.md).

## Generate and modify

| Action | Endpoint | Input | Base |
| --- | --- | --- | --- |
| Generate a first or replacement app | `POST /api/forge/projects/:id/generate` | `prompt`, 10–4,000 characters | Empty staging directory. |
| Modify the approved app | `POST /api/forge/projects/:id/modify` | `request`, 3–2,000 characters; optional PNG screenshot | The current approved `index.html` is copied into staging and edited in place. |

The UI exposes these as **New app** and **Change this app**. A modification requires an approved
version; otherwise the API returns `no_current_version`. The screenshot is optional and is used as a
visual reference when supplied; the prompt explicitly says when none is attached.

A project may have at most **two active jobs** (`queued`/`running`). Starting a third returns
`too_many_jobs`. Defaults for a job are a 10-minute wall-clock cap, 25 observed model calls and
1.5M observed input tokens; these are deployment configuration, not promises about model behavior.

### Job lifecycle

```
queued ─► running ─► succeeded ─► approved (status stays succeeded; version set)
   │          │           └────► rejected (staging deleted)
   │          ├────► failed / budget_exceeded / cancelled
   └──────────┴────► interrupted (server restarted; never resumed)
```

The job record is persisted **before** the model process starts. A job that cannot be stored
durably is not started. Status, logs, usage, `memory_ids` and validation are visible while it runs
and after it finishes.

## Stage and review

A successful job has staged bytes at
`WORKSPACE_ROOT/forge/<project-id>/staging/<job-id>/index.html`. Nothing is visible as a version
yet. The Review panel and the main tabs expose:

| Tab / panel | What it shows |
| --- | --- |
| **Preview** | The sandboxed document: approved version or the staged job. Desktop/mobile widths and a reload control. |
| **Source** | The exact HTML as text, with line numbers and artifact identity (bytes, lines, SHA-256). Source is rendered as text, never executed in the app origin. |
| **Changes** | A unified line diff of the approved source versus the staged source, plus the structural validation result. |
| **Review** | Proposed version, base version, memory count, Guard advisory, provenance, approval controls and version history. |
| **Project memory** | Active and superseded decisions for this project; the `used` marker means the decision id was recorded on the job, not that it caused a particular visual choice. |

Structural validation before review checks:

- `index.html` exists, is a regular file, is not a symlink, and is inside the project workspace.
- The file is not suspiciously small and does not exceed 1.5 MB.
- Every inline `<script>` passes `node --check`.
- A document that references Phaser has a `<canvas>` or explicit `Phaser.Game`/`Phaser.AUTO`
  initialisation; a general application has a `<body>` with visible text or a renderable element.

A failed validation is shown in the diff and blocks approval. It does not prove the application is
correct.

### Decision Guard is advisory

The Guard runs on the staged source against the job's recorded decisions. It supports seven rule
families: **countdown mechanics, flashing effects, mistake penalties, superseded palettes,
colour-only cues, autoplaying media and external assets**. It cites the decision, a bounded evidence excerpt and an explanation. A snapshot
is recorded when generation finishes and recomputed after the approval-time runtime check, so
`runtime_verified` distinguishes the two contexts.

| Assessment | Meaning |
| --- | --- |
| `violation_detected` | At least one supported check reported a possible violation. |
| `no_violation_detected` | Every recorded decision matched a supported check and those checks passed, with no limitation recorded. This is **not** a compliance certificate. |
| `not_verified` | At least one decision or constraint could not be checked. |
| `evaluation_unavailable` | The engine did not complete; no result exists. |

**A Guard `BLOCK` is a finding, not enforcement.** The server never adds it to `validation.ok`,
never uses it to authorise or deny approval, and never disables the human's decision. The review UI
shows it beside the evidence, not as a blocking error. A reviewer may approve a staged change after
reading a `BLOCK`; the human remains the enforcement layer. Only structural validation, job/version
state, the load-time runtime check and exact-byte/persistence checks can stop promotion.

The Guard checks source text, not rendered behavior. Its supported rule set is deliberately narrow;
false positives, false negatives and abstentions are why enforcement is left to the reviewer. See
[Limitations](limitations.md).

## Approve

Approval is the only path that makes a staged file current. It runs under a per-project lock so
approval and rejection cannot race.

1. The job must be `succeeded` and must not already have a version.
2. The approved project version must still equal the job's `base_version`. If someone approved
   another change in between, approval returns `version_conflict`; regenerate the change.
3. The server snapshots the staged bytes and their SHA-256.
4. It loads those bytes in headless Chromium with all network blocked except the approved CDN and
   all WebSockets closed. A page error, console error, blocked request, or blank render fails the
   check. A Phaser document must create a canvas; any application must render visible content. The
   check uses managed Chromium by default; system Chrome only when `FORGE_RUNTIME_BROWSER=chrome`
   is set, with no automatic fallback.
5. If the check passes, the staged bytes are copied to an immutable `versions/<n>/index.html` and
   the state pointer is flipped. Promotion re-checks that the bytes still hash to the value the
   browser loaded; a rewrite between check and promotion returns `staged_changed`.
6. The version records the syntax/structure result, runtime result, checked artifact hash, browser
   identity when available, and the approval timestamp in `approval_verification`.

Optional **Remember this decision** requires a decision written by the user. On approval it creates a
project-scoped `technical_decision` with confidence 0.9 and source reference `forge:<job-id>`. The
model's terminal summary is never promoted into memory.

If runtime verification fails, the job becomes `failed` with bounded diagnostics and no version is
created. The same is true when the browser cannot launch; the error is actionable rather than
silently falling back.

### What the approval check does not prove

It is a **load-time** verification. It does not click controls, play a game, inspect pixels, test
accessibility or exercise later state changes. A page that renders cleanly can still be wrong or
misleading. Reading the diff and using the preview remain manual review steps.

## Reject

Rejection requires a `succeeded`, unapplied job. It deletes the staging directory, records
`status: rejected`, and leaves the current approved version untouched. Approval and rejection share
the project lock, so a rejection cannot delete bytes that a concurrent approval is promoting.

**N2 follow-up fix:** approval and rejection no longer rewrite `finished_at`. That field records when
generation finished. The approval time is `approval_verification.recorded_at`; a runtime failure
records the failure time instead. This keeps job duration and review latency separate.

## Rollback

Rollback restores the version named by the current version's recorded `base_version`, after checking
that version's stored SHA-256. It does not create a new version and does not delete history; it
moves the current pointer back, and `can_rollback` is derived from whether a valid older target
exists (a recorded parent, or the documented legacy fallback).

Ancestry is not array adjacency. If v3 was approved from v1, rollback from v3 restores **v1**, not
v2, even though v2 sits between them in the list. Legacy state without a recorded parent falls back
to the immediately preceding version, guarded so the target is always older.

## History and provenance

Each job record carries its prompt, request, base version, status, timestamps, logs, usage,
`memory_ids`, structural validation, optional Guard advisory, and `prompt_sha256`. Each version
carries its summary, `base_version`, `job_id`, SHA-256 and approval verification.

Versions approved before approval telemetry existed show **“not recorded”**, not “passed.” A
historical version does not inherit a verification claim it never had. The Studio’s model label is
the **configured** Forge model (or “CLI default (configured)”), not an independently observed
execution identity.

## Preview, artifact and export

`GET /api/forge/projects/:id/preview[?job=<uuid>]` serves the approved or staged document with:

```
Content-Security-Policy: sandbox allow-scripts; default-src 'none';
  script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline';
  img-src data: blob:; connect-src https://cdn.jsdelivr.net;
  frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'
```

The server never evaluates the HTML in the application origin. The iframe has an opaque origin and
cannot read app storage, cookies or privileged APIs. The preview injects a storage shim because a
sandboxed document's real `localStorage`/`sessionStorage` accessors throw; app data written there
lives for the life of the preview document and resets on reload. It is never written into the
artifact or approved file.

`GET /api/forge/projects/:id/artifact[?job=<uuid>]` returns the approved or staged source as JSON
with title, bytes, lines, SHA-256 and the HTML text. **Download HTML** exports exactly the artifact
you are viewing. The exported file runs **outside** the sandbox and may need network access for CDN
dependencies; it is not a verified self-contained bundle.

## Recovery and cancellation

- `POST /api/forge/jobs/:jobId/cancel` requests cancellation of a queued/running job.
- On a graceful shutdown, new starts stop, active jobs are marked cancelled, owned children receive
  SIGTERM then SIGKILL after a bounded grace period, and terminal state is flushed.
- On startup, `queued`/`running` records become `interrupted`. The model is **not** resumed; staged
  bytes and logs remain for inspection.
- A malformed `state.json` or job record is reported as a recovery issue and left in place. It is not
  silently replaced with an empty project.
- The recovery banner can be acknowledged, and a storage check can re-test the workspace. An active
  storage failure remains visible until a healthy check clears it. Acknowledgement hides the notice;
  it does not delete job records or audit history.

Forge jobs are durable on disk but single-process: one JSON file per job, atomic replace, no
database lease or multi-process coordination. A queued/running job interrupted by a restart is never
resumed automatically.

## Current follow-up fixes

| ID | Current behavior |
| --- | --- |
| N1 | Retrieval preview accepts `mode: "forge"` and returns Studio's exact selection and prompt block. The explainer defaults to Forge mode. |
| N2 | `finished_at` is generation completion; approval time lives in `approval_verification.recorded_at`; rejection preserves the generation finish. |
| N3 | Correction responses re-read superseded records, so lifecycle fields match a fresh GET. See [Project memory](project-memory.md). |

The underlying F6 behavior is unchanged: a correction changes retrieval, not an already approved
artifact. The application change must still be requested and reviewed. See the
[repeat live run](../hackathon-evidence/live-dsh-run-2026-10-29/after/AFTER_FIXES.md).

## Related references

- [HTML Studio assessment](../HTML_STUDIO_ASSESSMENT.md) — capability and security scope
- [Architecture](architecture.md) — job manager, workspace layout and approval internals
- [Project memory](project-memory.md) — retrieval profiles, correction and the exact prompt block
- [Security model](../security.md) — sandbox, origin guard, child environment
- [Local-beta hardening](../LOCAL_BETA_HARDENING.md) — durable jobs, recovery, managed browser
- [FocusFlow validation](../demo/NON_GAME_HTML_VALIDATION.md) — a non-game application in the same pipeline

---

[Guide](README.md) · [Getting started](getting-started.md) · [Project memory](project-memory.md) · [HTML Studio](html-studio.md) · [Architecture](architecture.md) · [Limitations](limitations.md)
