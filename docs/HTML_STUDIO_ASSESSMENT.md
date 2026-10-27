# HTML Studio — capability assessment

**Scope:** what the existing Forge pipeline already supported, what was missing to
present it honestly as HTML application development, what was implemented in this
pass, and what remains out of scope.

**Method:** source audit of `apps/server/src/forge/*`, `apps/server/src/routes/forge.ts`,
`packages/shared/src/forge.ts`, the web Studio components, and the integration,
unit, and browser verification tests. Live generation was not run for cost reasons;
the deterministic fake-Muse fixtures and recorded baseline were used.

---

## 1. What already worked

| Capability | Evidence in the existing implementation |
| --- | --- |
| Single-file HTML generation | Muse is prompted to write one `index.html` in a staging workspace. |
| Sandboxed preview | `GET /api/forge/projects/:id/preview` sends `CSP: sandbox allow-scripts` and the UI uses `<iframe sandbox="allow-scripts">`; opaque origin. |
| Staged changes | Every job writes to `staging/<job-id>/index.html`; approval copies to `versions/<n>/index.html`. |
| Structural validation | File containment, symlink checks, size bounds, inline-script `node --check`. |
| Runtime verification | Headless Chrome load, page-error capture, network allowlist, canvas check. |
| Human approval | Explicit approve/reject endpoints; approval re-verifies the exact staged bytes. |
| Immutable versions + rollback | SHA-256 per version; rollback follows recorded `base_version` ancestry. |
| Project memory | Superseding decisions, retrieval with budgets, recorded decision ids per job. |
| Decision Guard | Advisory engine snapshot stored beside — never inside — validation. |
| Provenance | Prompt SHA-256, usage, logs, decision ids, engine version. |

The pipeline was genuinely an application-development loop. The presentation, not
the architecture, was the gap.

## 2. What was missing or misleading

| Issue | Severity | Why it mattered |
| --- | --- | --- |
| Validation **required Phaser** (`No Phaser reference found`). | P0 | Any non-game HTML application failed validation. Presenting "HTML applications" without changing this would have been false. |
| Runtime verification **required a canvas**. | P0 | A calculator, timer, or dashboard could never be approved. |
| Generation prompt said **"Create a playable browser game"**. | P0 | Even with validation relaxed, Muse would be asked for a game regardless of the user's request. |
| Modification **required a screenshot**. | P1 | Natural-language iteration was gated behind a canvas capture, and non-game DOM applications have no canvas to capture. |
| No way to inspect approved source as data. | P1 | The diff carried `before`/`after`, but after approval there was no source view or artifact identity. |
| No export path. | P2 | The artifact could not leave the app, which weakens the "working application" story. |
| Preview fixed at 520 px and buried below a system inspector. | P1 | The generated app was not the visual centre. |
| Memory and guard were not visible beside development. | P1 | The differentiator was hidden in other screens. |

## 3. What this pass changed

### 3.1 Validation accepts general HTML applications

`ForgeWorkspace.validateStaged` now:

- keeps every containment, symlink, size, and inline-script syntax check;
- if the document references Phaser, still requires `<canvas>` or
  `Phaser.Game`/`Phaser.AUTO`;
- otherwise requires a `<body>` with either visible text or a renderable element;
- rejects an empty shell.

Tests: unit cases for a general application, a Phaser document without a canvas,
and an empty shell.

### 3.2 Runtime verification accepts a rendered application

`checkGameRuntime` (name retained for script compatibility) now returns both
`canvas` and `rendered`. Approval succeeds when:

- the page rendered visible text or a laid-out element, **or** created a canvas; and
- there were no page/console errors and no blocked network requests.

A Phaser document that renders no canvas still fails with an explicit error.
Browser verification (`scripts/verify-runtime.ts`) passes for a valid game, fails a
broken scene, and blocks HTTP and WebSocket exfiltration. A non-game fixture is
verified separately to render and approve.

This remains a **load-time** check. It does not click through the application,
inspect pixels, or prove that later interactions cannot fail.

### 3.3 Prompt is application-first

`buildForgePrompt` now asks for a complete, single-file browser application with
inline CSS/JS, no build step, responsive layout, and no network assets beyond the
approved CDN. A game request keeps the Phaser 3 contract. Modification says "the
current approved application", keeps the existing runtime, and only mentions an
attached screenshot when one is actually attached.

Prompt parity fixtures were regenerated. A fourth fixture pins the
screenshot-bearing variant.

### 3.4 Screenshot is optional

`ForgeModifySchema.screenshot_data_url` is optional; the route decodes it only when
present; the prompt says "No screenshot is attached" otherwise. Integration tests
cover a text-only modification through approval.

The screenshot remains useful when a change is visual. It is no longer a gate.

### 3.5 Source and artifact inspection

A read-only endpoint returns the approved or staged artifact as JSON:

```
GET /api/forge/projects/:id/artifact[?job=<uuid>]
```

It returns project, job, version, staged flag, title (tags stripped), bytes, lines,
SHA-256, and the HTML text. The HTML is **data**, rendered as text by the Source
view; it is never injected into the application origin. The sandboxed preview
remains the only renderer.

### 3.6 Export

Export is implemented as a client-side download of the artifact already fetched
through the endpoint:

- names the file from the sanitised document title, project, and version/job;
- does not re-render or re-execute the HTML in the application origin;
- states that the file may still reference an external CDN and is **not** claimed
  to be self-contained.

This is a minimal export, not a packaging step. No bundler, inliner, or asset
rewriting was added.

## 4. Security impact

The changes do **not** weaken the existing posture:

- Preview CSP remains `sandbox allow-scripts; default-src 'none'; script-src
  'unsafe-inline' https://cdn.jsdelivr.net; ...; frame-ancestors 'self'`.
- The iframe remains `sandbox="allow-scripts"` (no `allow-same-origin`).
- Runtime verification still aborts every request outside `cdn.jsdelivr.net`,
  closes every WebSocket, and strips credentials.
- Source viewing uses React text children; there is no `dangerouslySetInnerHTML`.
- Artifact JSON is read-only and path-validated by the workspace.
- Export is a Blob download on the client; no server file path is exposed.
- No API keys are added to preview, artifact, or export payloads.

Residual risks:

- A general application can be visually deceptive or contain malicious UI logic
  (phishing copy) without tripping a load-time check. The approval step and diff
  review are the control.
- The CDN allowlist permits `cdn.jsdelivr.net`, which can serve arbitrary packages.
  This was already true for Phaser and is unchanged.
- The preview runs generated scripts. That is the product. The sandbox limits its
  authority; it does not make the script trustworthy.

## 5. Testing performed

| Check | Result |
| --- | --- |
| `pnpm verify` (lint, typecheck, unit/integration tests) | Run recorded in the final report. |
| `pnpm build` | Run recorded in the final report. |
| `scripts/verify-runtime.ts` | PASS — valid scene, broken scene, HTTP block, WebSocket block. |
| Non-game fixture runtime | `{ ok: true, canvas: false, rendered: true }`. |
| Empty document runtime | `{ ok: false, rendered: false }` with a render error. |
| Forge API integration | General application generated, previewed, approved; text-only modify approved; artifact endpoint staged/approved. |

## 6. Out of scope

- Multi-file projects, build steps, package installation, or server-side execution.
- Playing a game, pixel comparison, or interaction testing.
- Automatic enforcement of Decision Guard findings.
- Verified self-contained export (asset inlining).
- A separate generation pipeline for "apps" versus "games" — deliberately one
  pipeline with one artifact contract.
- Changing the Muse model configuration or provider.

## 7. Recommendation

Keep HTML Studio as the public surface. Keep the single-file, sandboxed artifact as
the contract. If export needs to be advertised as self-contained later, add an
explicit inliner with an allowlist and a verification test, and only then change
the label. Do not describe load-time verification as gameplay or application
testing.
