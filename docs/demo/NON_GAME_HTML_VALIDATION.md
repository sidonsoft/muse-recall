# Non-game HTML application — live Muse Spark validation

**Application:** FocusFlow — a single-file personal task planner
**Repository:** `sidonsoft/muse-recall`
**Branch:** `agent/muse-recall-live-demo` (from `agent/muse-recall-product-positioning` at `41b1684`)
**Date:** 2026-10-28 05:36–05:46 Australia/Brisbane (2026-10-27 19:36–19:46 UTC)
**Server:** isolated demo server on `127.0.0.1:8799`; provider `muse-cli`; Forge model
`muse-spark-1.3-contributor`; effort `high`; maximum supported budgets
(see [`LIVE_MUSE_CONFIGURATION.md`](LIVE_MUSE_CONFIGURATION.md)).

**Verdict:** a genuine Muse Spark generation produced a working, responsive, non-game HTML
application; a genuine Muse Spark modification added task priorities and a high-priority
remaining count. Both were verified by driving the real browser preview, not by trusting a
`succeeded` job status. The first generation was rejected after a real sandbox failure and a
second attempt was approved.

---

## 1. What this validates

The product claim is not "the model returned HTML". It is:

1. Muse Spark can generate a working browser application that is **not a game**.
2. Muse Spark can modify the approved application with a small, reviewable change.
3. Project decisions are retrieved and supplied to both generations.
4. The staged result is validated, reviewed, and only then promoted.
5. Failures are preserved and reported, not overwritten.

The application is deliberately ordinary: a task planner with add, complete, delete, filter,
progress, and (after modification) priority. It has no game loop, no Phaser, no canvas, and no
external dependency.

---

## 2. Memory seeded before the first generation

Three project-scoped decisions were created before any application existed. They were retrieved
for the first generation and for every later job in this project.

| # | Type | Memory id | Content (abridged) |
|---|---|---|---|
| M1 | `constraint` | `94eb8a88-b4dd-42d7-a7ca-b22e0c8bbd5c` | Single self-contained `index.html`; no build step, external services, or browser storage; state in memory only |
| M2 | `technical_decision` | `313d7bea-477d-4888-805c-364b72cc7160` | Warm amber accent `#e7c17c` on a deep charcoal surface; avoid blue/purple gradients |
| M3 | `preference` | `f94c57f9-ce23-4848-95bf-846550bcf3e6` | Concise copy; plain verbs; progress stated as completed-of-total in text, not colour alone |

The retrieval preview for the first generation returned all three (`runs/v1-retrieval.json`).
The first job recorded all three in `memory_ids`.

Two further decisions were captured by the human at approval time:

| # | Type | Memory id | Captured at | Content (abridged) |
|---|---|---|---|---|
| M4 | `technical_decision` | `1c31b594-cc3e-4df3-9d32-5475d50dc84f` | approval of v1 | FocusFlow v1 shipping decision: single-file, in-memory, amber/charcoal, plain-verb controls, no native form submission |
| M5 | `technical_decision` | `e685eb97-ebc6-4a15-b164-e81195a5fc19` | approval of v2 | Priorities: Normal/High, visible per-task control, persistent high-priority remaining count excluding completed tasks |

The modification job recorded **four** active decisions (M1, M2, M3, M4) in `memory_ids`; the
retrieval preview (`runs/v3-retrieval.json`) shows all four, including M4. That is the concrete
"remembered across iterations" evidence.

> **What the retrieval proves and does not prove.** The job record proves the memories were
> selected and injected. It does not, by itself, prove that a particular visual choice was caused
> by the memory. The generated artifact uses the remembered amber accent (`--accent: #e7c17c`),
> which is consistent with memory influence; a controlled causal claim belongs to the
> Phase 12A/15B designs, not to this demonstration.

---

## 3. Attempt 1 — generation, rejected

### 3.1 Request

The exact first-generation prompt:

```text
Build a polished, responsive single-file HTML task planner called FocusFlow.

Users should be able to add tasks, mark tasks complete, delete tasks and filter between all, active and completed tasks.

Include a clear progress indicator and an attractive modern interface.

Use HTML, CSS and JavaScript in one file.

Keep application state in memory during the session rather than using localStorage or external services.

Do not require a build step.

The application must work in the existing Muse Recall sandbox.
```

### 3.2 Provenance

| Field | Value |
|---|---|
| Job id | `1621b9db-76ac-4c94-9a3a-48ee1290fd42` |
| Kind | `generate` |
| Created / finished | `2026-10-27T19:36:09.887Z` / `2026-10-27T19:37:15.000Z` |
| Provider / configured model | `muse-cli` / `muse-spark-1.3-contributor` |
| Reasoning effort | `high` |
| Prompt SHA-256 | `0ed6bcb7690e61ba3d267a605a8bcea6e3b7cf83338e209764e333a4e17b9560` |
| Retrieved memory ids | M1, M3, M2 (all three) |
| Model calls | 9 |
| Input / output tokens | 329,279 / 7,117 |
| Runtime | 65,111 ms |
| Server validation | `{ ok: true, issues: [] }` |
| Decision Guard | `UNVERIFIED` / `not_verified` (unsupported decisions) |
| Artifact | `v1-staged.html` (12,389 bytes) |
| Artifact SHA-256 | `95aa8d1dfa289d288010891fa6035410ead89d316c2a30fca1ce500891a566eb` |
| Outcome | **rejected** |

### 3.3 Why it was rejected

The server-side validation passed, and the page rendered. But the add-task interaction used a
native `<form>` submit. The preview is served with the production CSP:

```text
sandbox allow-scripts
```

`allow-forms` is intentionally absent. Chrome blocks the submission:

```text
Blocked form submission to '' because the form's frame is sandboxed and the
'allow-forms' permission is not set.
```

The browser test entered "Draft launch checklist" and clicked the submit button. The task list
still showed the empty state; the input still held the text. **A `succeeded` job was not a working
application.** The attempt was rejected, and the artifact and failure record were preserved.

Evidence:

- `v1-failure-form-blocked.png`
- `runs/v1-browser-failure.json`
- `runs/v1-staged.html`
- `runs/v1-job-post-rejection.json`

This is a real product finding: any generated application that relies on native form submission
cannot work in the shipped preview sandbox. It is not a defect introduced by this demonstration.

---

## 4. Attempt 2 — generation retake, approved v1

### 4.1 Request delta

The retake kept the original request and added one explicit sandbox constraint, derived from the
observed failure:

```text
Sandbox constraint (important): the Muse Recall preview iframe is sandboxed with allow-scripts but without allow-forms, so native form submission is blocked. Do not use form submission to add tasks. Wire the "Add task" button with a click handler and support Enter in the text input; both must update the in-memory task list.
```

This is a prompt change, not a hand edit of generated code. The model received it in full.

### 4.2 Provenance

| Field | Value |
|---|---|
| Job id | `e358246a-6741-499c-8057-6b2447e31718` |
| Kind | `generate` |
| Created / finished | `2026-10-27T19:39:25.443Z` / `2026-10-27T19:40:14.596Z` |
| Provider / configured model | `muse-cli` / `muse-spark-1.3-contributor` |
| Reasoning effort | `high` |
| Prompt SHA-256 | `bbf6a0ef86b60a9b027653d92f920ec99989a05ad1778d2bea32feec5af1a7a8` |
| Retrieved memory ids | M1, M3, M2 |
| Model calls | 6 |
| Input / output tokens | 208,950 / 6,077 |
| Runtime | 49,151 ms |
| Server validation | `{ ok: true, issues: [] }` |
| Decision Guard | `UNVERIFIED` / `not_verified` (unsupported decisions) |
| Artifact | `v2-staged.html` (13,015 bytes) |
| Artifact SHA-256 | `53d1e47498c735746c0fd0b5f4b70d83872f26bbb1bb34f05d6d12030fc8e995` |
| Approval | **v1**, `2026-10-27T19:41:46.570Z` |

The approval ran the server-side headless-Chrome load check on the exact staged bytes; it passed
(`runtime_verified: true` in the post-approval guard snapshot). The human captured M4 in the same
act.

### 4.3 Browser validation — 21/21

The preview was driven with Playwright (Chrome, 1440×1000, then 390×844). Results are stored in
`runs/v2-browser-validation.json`.

| Check | Result |
|---|---|
| Initial sample state (2 tasks, 1 completed, 50%) | pass |
| Add by button click | pass |
| Add by Enter key | pass |
| Progress label / percent / `aria-valuenow` update | pass |
| Complete a task | pass |
| Active filter hides completed | pass |
| Completed filter shows completed | pass |
| All filter restores all | pass |
| Delete a task | pass |
| Clear completed | pass |
| Delete / clear update progress correctly | pass |
| No browser storage calls (`localStorage`, `sessionStorage`, `indexedDB`) | pass — 0 calls |
| State does not survive reload (in-memory only) | pass |
| No external network requests | pass |
| No console errors or page exceptions | pass |
| Mobile 390×844 has no horizontal overflow | pass |

Screenshots:

- `v2-desktop-empty.png`
- `v2-desktop-tasks.png`
- `v2-desktop-completed.png`
- `v2-mobile.png`
- `v2-approved-desktop.png`
- `v2-approved-mobile.png`
- `ui-01-studio-review.png` (staged review)
- `ui-02-diff.png` (initial diff)
- `ui-03-source.png` (source inspection)
- `ui-05-approved.png` (v1 approved)

The application deliberately starts with two sample tasks, one completed, so the progress
indicator is visible on first load. That is a model choice, not a harness injection. The browser
test records it explicitly.

---

## 5. Modification — priorities and a high-priority remaining count

### 5.1 Request

The exact modification prompt:

```text
Improve FocusFlow by adding task priorities and a compact summary showing the number of high-priority tasks remaining.

Keep all existing functionality working.

Preserve the current visual style.

Do not introduce external dependencies or browser storage.

Make the smallest practical changes.
```

The approved preview screenshot was attached as the visual reference (`v1-approved-preview.png`).

### 5.2 Provenance

| Field | Value |
|---|---|
| Job id | `aeb6b175-01a6-4c9b-93a1-757cddf475e1` |
| Kind | `modify` |
| Created / finished | `2026-10-27T19:42:14.911Z` / `2026-10-27T19:44:11.244Z` |
| Provider / configured model | `muse-cli` / `muse-spark-1.3-contributor` |
| Reasoning effort | `high` |
| Base version | 1 (approved FocusFlow v1) |
| Retrieved memory ids | M3, M1, M2, **M4** (four) |
| Model calls | 17 |
| Input / output tokens | 681,229 / 5,183 |
| Runtime | 116,334 ms |
| Server validation | `{ ok: true, issues: [] }` |
| Decision Guard | `UNVERIFIED` / `not_verified` (unsupported decisions) |
| Artifact | `v3-staged.html` (15,827 bytes) |
| Artifact SHA-256 | `1d0ea67f383bd4ec2f172d93fc97e82d53a889c3376491b33d0c22f4fbbb881d` |
| Approval | **v2**, `2026-10-27T19:45:07.115Z`, base v1 |

The diff is additive and local: +83 lines net (477 added / 394 removed in the unified diff
because the formatter reflowed the file, but the behavioural change is the priority control and
summary). The modification started from the **approved v1 source**; it did not regenerate the
application. The job recorded `base_version: 1`.

### 5.3 What the modification actually added

- A `Normal` / `High` selector beside the task input (`#priorityInput`).
- A per-task button that toggles priority (`Mark high priority: …` / `Mark normal priority: …`).
- A visible `High` badge on high-priority rows.
- A persistent summary line (`#prioritySummary`):
  - `No high-priority tasks remaining`
  - `1 high-priority task remaining`
  - `N high-priority tasks remaining`
- The count excludes completed tasks (`!completed && priority === 'high'`).
- The two sample tasks now carry explicit priorities: one `normal`, one `high`.

### 5.4 Browser validation — 25/25

Results: `runs/v3-browser-validation.json`.

| Check | Result |
|---|---|
| Existing sample state and progress preserved | pass |
| High-priority count includes the seeded high task | pass |
| Add a high-priority task | pass |
| Selector resets to Normal after add | pass |
| High badge visible | pass |
| Count rises to 2 | pass |
| Add a normal task | pass |
| Complete a high-priority task | pass |
| Count drops to 1 | pass |
| Reactivate the high task | pass |
| Count returns to 2 | pass |
| Toggle a normal task to High | pass |
| Count rises to 3 | pass |
| Active / Completed / All filters still work | pass |
| Delete still works | pass |
| Delete updates the high count | pass |
| Clear completed still works | pass |
| High count excludes completed tasks | pass |
| No browser storage calls | pass — 0 |
| State does not survive reload | pass |
| Amber accent `#e7c17c` preserved | pass |
| Mobile 390×844 has no horizontal overflow | pass |
| No external network requests | pass |
| No console errors or page exceptions | pass |

Screenshots:

- `v3-desktop-empty.png`
- `v3-desktop-priorities.png`
- `v3-mobile.png`
- `ui-06-modification-review.png`
- `ui-07-modification-diff.png`
- `ui-08-modification-source.png`
- `ui-09-modification-decision.png`
- `ui-10-approved-v2.png`

### 5.5 Honest deviations

- The generated background changed from `#191712` to `#141311`. Both are deep charcoal and the
  amber accent is unchanged, but this is not a byte-identical preservation of the original
  background. It is recorded rather than hidden.
- The model's first pass wrote the priority selector and stored priority but had not yet rendered
  the badge or updated the summary when the file was inspected mid-job. The terminal artifact
  (after 17 calls) contains both. The mid-job snapshot is not represented as the final output.
- The diff formatter reflows the file; the review panel labels this a "large rewrite" even though
  the behavioural change is small. The human read the source before approving.

---

## 6. Attempt log (all attempts preserved)

| Attempt | Kind | Job id | Model | Outcome | Reason |
|---|---|---|---|---|---|
| 1 | generate | `1621b9db-76ac-4c94-9a3a-48ee1290fd42` | `muse-spark-1.3-contributor` | rejected | native form submission blocked by preview sandbox |
| 2 | generate | `e358246a-6741-499c-8057-6b2447e31718` | `muse-spark-1.3-contributor` | approved v1 | click/Enter handlers; 21/21 browser checks |
| 3 | modify | `aeb6b175-01a6-4c9b-93a1-757cddf475e1` | `muse-spark-1.3-contributor` | approved v2 | priorities + high-priority count; 25/25 checks |
| 4 | modify | `0ecc11a0-6eac-4e30-a1c4-cf2eaed49daf` | `muse-spark-1.3-contributor` | rejected (no-op) | model honoured the remembered countdown prohibition; file unchanged |

**Retake count: 1** (attempt 2 retook attempt 1). Attempt 1 is preserved and is not presented as
the first successful generation.

---

## 7. Memory-conflict probe (live refusal)

> **Naming note (added at release integration).** This section was historically titled "Decision
> Guard probe". Decision Guard returned `not_verified` with **0 findings**; it did not detect, block
> or certify anything here. The observation is a **memory-conflict refusal**, and the accurate
> public label is "live memory-conflict refusal". The evidence below is unchanged.

This was an **exploratory demonstration**, not a new hypothesis test. It adds a project
constraint — *"Never add countdown mechanics to FocusFlow; avoid countdown timers and time
pressure."* (memory `70f5acb3-e721-48aa-8e53-6d171b5c4560`) — then makes an explicit conflicting
request:

```text
Add a countdown timer showing the time remaining today and bonus points for finishing tasks quickly. Keep all existing functionality working.
```

### 7.1 Provenance

| Field | Value |
|---|---|
| Job id | `0ecc11a0-6eac-4e30-a1c4-cf2eaed49daf` |
| Kind | `modify` |
| Base version | 2 (approved FocusFlow v2) |
| Created / finished | `2026-10-27T19:45:31.149Z` / `2026-10-27T19:46:12.903Z` |
| Provider / configured model | `muse-cli` / `muse-spark-1.3-contributor` |
| Memory ids | 6, including the countdown constraint and the captured v1/v2 decisions |
| Model calls | 3 |
| Input / output tokens | 100,193 / 1,718 |
| Runtime | 41,662 ms |
| Server validation | `{ ok: true, issues: [] }` |
| Decision Guard | `UNVERIFIED` / `not_verified`; **0 findings** |
| Artifact | byte-identical to approved v2, SHA-256 `1d0ea67f383bd4ec2f172d93fc97e82d53a889c3376491b33d0c22f4fbbb881d` |
| Diff | `+0` lines (only the trailing-newline artefact of the diff format) |
| Outcome | **rejected** (no-op; nothing to promote) |

### 7.2 What the model did

Muse Spark **did not** add the countdown. It returned the approved file unchanged and explained
why. Normalised transcript from the stream deltas (no words changed; whitespace at delta
boundaries is normalised):

> I did not add the countdown timer or speed bonuses to index.html.
>
> They conflict with the authoritative FocusFlow decisions for this workspace:
>
> - Never add countdown mechanics.
> - Avoid countdown timers and time pressure.
> - Keep copy concise and calm.
>
> A time-remaining-today timer and bonus points for finishing quickly would both add time
> pressure. I left the file unchanged, so existing controls, state, layout, and identity are
> preserved.
>
> If you want to lift the no-countdown rule, say so explicitly. A calm alternative would be a
> static today progress count with no timer or scoring.

This is a genuine memory-respecting refusal. It is **not** a general claim that memory overrides
explicit instructions: the Phase 15B exploratory boundary probe found the opposite for a game
countdown request, and this is one task-planner run. The contrast is worth stating, not
flattening.

### 7.3 What Decision Guard did

The countdown rule was evaluated: the countdown decision does **not** appear in the advisory's
`unverified` list, and `findings` is empty. The overall assessment remains `not_verified` because
the other five decisions are outside the supported rule set (`unsupported_decision`). This is the
correct advisory behaviour: no violation to report when the source complies, and no false
"compliance" claim for rules that cannot be checked.

No live violation finding was manufactured. The V2 plan uses the existing packaged Phase 12C/12E
labelled-mutation finding for the on-screen "Guard warns" moment, with the mandatory
`Labelled mutation — packaged evidence, not model output.` overlay. The live FocusFlow guard
panel is shown as an advisory limitation, not as a violation.

Evidence:

- `runs/v4-job-final.json`
- `runs/v4-diff.json` (empty behavioural diff)
- `runs/v4-model-response.txt`
- `runs/v4-retrieval.json`
- `runs/v4-staged.html` (byte-identical to approved v2)
- `runs/v4-job-post-rejection.json` *(save after rejection)*

---

## 8. Memory provenance summary

| Job | Memory ids recorded | Retrieval preview |
|---|---|---|
| v1 generation | `94eb8a88…`, `f94c57f9…`, `313d7bea…` | 3 of 3 |
| v2 generation | `94eb8a88…`, `f94c57f9…`, `313d7bea…` | 3 of 3 |
| v3 modification | `f94c57f9…`, `94eb8a88…`, `313d7bea…`, `1c31b594…` | 4 of 4 |
| guard probe | 6 retrieved, including the countdown constraint | see `runs/v4-retrieval.json` |

The memory rail in the Studio shows `used` on every supplied decision and states: *"Recall
supplied N decisions to this generation. Retrieved context, not proof that it changed a model
decision."* That wording is intentional and is preserved in the recording plan.

---

## 9. Reproducibility

| Asset | Path |
|---|---|
| Launcher environment (redacted) | `$HOME/muse-demo-live/runs/effective-config.json` |
| Server log | `$HOME/muse-demo-live/logs/server.log` |
| Generation logs | `$HOME/muse-demo-live/logs/generate-v1.log`, `generate-v2-retake.log` |
| Modification log | `$HOME/muse-demo-live/logs/modify-v3.log` |
| Guard probe log | `$HOME/muse-demo-live/logs/guard-probe-v4.log` |
| Job records | `$HOME/muse-demo-live/runs/v{1,2,3,4}-job-*.json` |
| Prompts | `$HOME/muse-demo-live/runs/v2-prompt.txt`, `v3-modify-prompt.txt`, `v4-guard-request.txt` |
| Artifacts | `$HOME/muse-demo-live/runs/v{1,2,3,4}-staged.html` |
| Browser checks | `$HOME/muse-demo-live/runs/v{1,2,3}-browser-*.json` |
| Screenshots | `$HOME/muse-demo-live/screenshots/` |
| Final project state | `$HOME/muse-demo-live/runs/focusflow-state-final.json` |

The demo database and workspace are isolated under `$HOME/muse-demo-live/`; no Phase 15B file,
database, or result was read-modify-written.

---

## 10. Limitations

- One application, one model, one modification. This is a demonstration, not a general
  capability measurement.
- Browser checks exercise the shipped preview sandbox and the documented DOM; they do not prove
  accessibility conformance, cross-browser parity, or long-session behaviour.
- The server-side approval check is a **load-time** headless-Chrome check. It does not play the
  application, inspect pixels, or test every interaction. The interaction checks above are a
  separate Playwright validation, not part of the approval gate.
- Memory retrieval is proven; controlled causal influence is not claimed for this app.
- Forge attribution rests on the validated `FORGE_MUSE_MODEL=muse-spark-1.3-contributor` config and
  the CLI's acceptance of that id. The Forge job record does not persist the CLI's observed-model
  event; do not claim a per-job observed-model field that the artifact does not contain.
- The first attempt's sandbox failure is a real product constraint that should be addressed in
  the generator prompt or the preview policy; it is not fixed in this branch.
