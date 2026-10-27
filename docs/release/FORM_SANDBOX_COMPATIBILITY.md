# Form / sandbox compatibility

**Status:** closed for release candidate
**P1 issue:** native HTML form submission is blocked by the preview sandbox
**Decision:** fix the generation instructions; the sandbox is unchanged
**Branch:** `agent/muse-recall-final-p1-fixes` (base `2ba4ba2`)

---

## 1. Original failure mechanism

The first live FocusFlow generation (attempt 1, job
`1621b9db-76ac-4c94-9a3a-48ee1290fd42`) produced this interaction:

```html
<form class="add-row" id="addForm" autocomplete="off">
  <label class="visually-hidden" for="taskInput">New task</label>
  <input id="taskInput" name="task" type="text" maxlength="200" … />
  <button class="btn btn-primary" type="submit">Add task</button>
</form>
```

```js
form.addEventListener("submit", function (event) {
  event.preventDefault();
  // … add the task
});
```

The model **did** call `event.preventDefault()`. The application still failed:
after typing “Draft launch checklist” and clicking **Add task**, the list stayed
empty and the input retained its value. The recorded browser check
(`docs/demo/evidence/records/v1-browser-failure.json`) reports:

```text
Blocked form submission to '' because the form's frame is sandboxed and the
'allow-forms' permission is not set.
```

Two independent restrictions are in force:

1. The preview iframe is `sandbox="allow-scripts"`; `allow-forms` is absent.
2. The preview response CSP includes `form-action 'none'`.

### 1.1 What Chrome actually blocks

The task brief allowed for the possibility that a form managed by JavaScript
with `event.preventDefault()` might be compatible. It is not, in Chrome.

Chrome checks the sandboxed-forms flag **before dispatching the `submit`
event**. The handler never runs, so `preventDefault()` cannot rescue the
submission. This was confirmed deterministically in Chrome with the exact
sandbox and CSP (see `tests/fixtures/general-app-submit-prevented.html` and
`pnpm verify:formsandbox`):

- `type="submit"` click → `submit` listener count remains 0;
- `form.requestSubmit()` → `submit` listener count remains 0;
- the console reports the sandbox block both times;
- only a synthetic `dispatchEvent(new Event('submit'))` reaches the listener,
  which is not a real submission and is not a supported pattern.

The live v1 evidence and the deterministic negative control agree. The
compatibility guidance therefore had to be stronger than “call
`preventDefault()`”: do not use submit controls at all.

### 1.2 Which behaviour failed

It is **navigation/submission**, not rendering, scripting, labels or focus.
The same page rendered, its scripts ran, and `type="button"` controls worked.
Only the implicit/explicit form submission path was rejected.

---

## 2. Existing sandbox restrictions (unchanged)

| Layer | Restriction |
|---|---|
| iframe | `sandbox="allow-scripts"` only. No `allow-forms`, `allow-same-origin`, `allow-top-navigation`, popups or downloads. |
| Preview CSP | `sandbox allow-scripts`; `default-src 'none'`; `script-src 'unsafe-inline' https://cdn.jsdelivr.net`; `style-src 'unsafe-inline'`; `img-src data: blob:`; `connect-src https://cdn.jsdelivr.net`; `frame-ancestors 'self'`; `base-uri 'none'`; `form-action 'none'`; `object-src 'none'`. |
| Origin | The sandboxed document has an opaque origin. It cannot read application storage, cookies or privileged APIs. |
| Approval runtime check | Headless Chrome load check with a network allowlist (`cdn.jsdelivr.net` only) and all WebSockets closed. |
| Artifact source | Read-only JSON; generated HTML is never executed in the application origin. |

No value in this table changed in this task. `pnpm verify`
(`tests/unit/forge-sandbox-policy.test.ts`) now fails if any of
`allow-forms`, `allow-top-navigation`, `allow-same-origin`, or a CSP directive
is removed or weakened. `tests/integration/forge-api.test.ts` also asserts the
live preview response headers.

---

## 3. Prompt correction

`apps/server/src/forge/prompt.ts` now states the contract for both generation
and modification jobs, before the user request:

> Interaction contract: the preview runs in a sandboxed frame with scripts but
> without native form submission or top-level navigation. Chrome blocks a
> sandboxed form submission before its submit event runs, so
> `event.preventDefault()` cannot rescue it. Implement every action with
> client-side JavaScript and explicit click or keydown listeners. Use
> `<button type="button">` for actions. A semantic `<form>` is fine for grouping
> and labels, but do not use `<button type="submit">` or rely on native
> submission or page navigation.
>
> Preserve accessibility and keyboard operation: give every control an
> accessible label, keep inputs labelled, and handle Enter explicitly in a
> keydown listener. Do not use browser storage (`localStorage`,
> `sessionStorage`, `IndexedDB`), external services, or unrestricted browser
> capabilities.

Modification jobs receive the same contract, plus “keep explicit Enter
handling instead of relying on `event.preventDefault()`”.

This applies to **future generations only**. The recorded FocusFlow artifacts
are historical evidence and were not edited to conform.

---

## 4. Accessibility considerations

The correction does not ban semantic HTML. The supported pattern is:

- keep `<form>` for grouping and label association when it helps;
- use `<button type="button">` for actions, not `type="submit"`;
- keep every input labelled (`<label for>` or `aria-label`);
- handle Enter on text inputs with an explicit `keydown` listener;
- keep native focus behaviour and visible focus styles;
- use descriptive accessible names for icon or delete controls.

`tests/fixtures/general-app-form.html` is the reference implementation. It is a
validated, previewable, approvable application that uses a semantic form, a
`type="button"` add control, Enter handling, labelled inputs, and an accessible
delete action. It is exercised by `pnpm verify:formsandbox` and by the Forge API
integration test.

A residual accessibility trade-off is accepted: because a submit control
cannot be used, implicit Enter submission is not inherited from the platform.
The application must implement Enter itself. The prompt says so explicitly.

---

## 5. Regression tests

| Test | What it proves |
|---|---|
| `tests/unit/forge-prompt.test.ts` | Generate and modify prompts state the contract; submit controls are forbidden; `preventDefault()` is not presented as a workaround; semantic form markup remains allowed; accessibility/keyboard guidance is present; the contract precedes the user request. |
| `tests/unit/forge-sandbox-policy.test.ts` | The iframe sandbox, preview CSP and runtime network/WebSocket allowlist are unchanged. `allow-forms` and `allow-top-navigation` cannot be introduced silently. |
| `tests/integration/forge-api.test.ts` | The contract is written into the actual staged `prompt.txt`; a semantic-form app validates, previews and approves; the preview response still serves `sandbox allow-scripts` and `form-action 'none'`. |
| `scripts/verify-form-sandbox.ts` (`pnpm verify:formsandbox`) | In real Chrome: `type="button"` + click works; Enter works; delete works with an accessible name; browser storage is blocked; submit + `preventDefault()` is still blocked; native submission is still blocked and does not navigate. |
| `scripts/verify-forge.ts` (`pnpm verify:forge`) | A generated non-game application with JS-driven interaction completes the Studio workflow end to end. |
| `scripts/verify-runtime.ts` (`pnpm verify:runtime`) | External HTTP and WebSocket exfiltration attempts are still rejected at approval. |

All are deterministic. None requires live Muse inference.

---

## 6. Residual limitations

1. **The prompt is guidance, not a syntactic guarantee.** A model can still
   choose a submit control. The approval gate remains the backstop: runtime
   verification proves the page loads, but it does not click the app, so a
   broken interaction can still reach human review. The live attempt 1 is the
   precedent; human/browser review caught it.
2. **No static lint currently rejects `type="submit"`.** Adding one would be a
   product decision (and could reject valid non-submit uses). Not in scope.
3. **The browser contract test uses a local fixture, not the live preview
   endpoint.** It mirrors the iframe attribute and CSP; the integration test
   asserts the real response headers. Neither weakens the sandbox.
4. **`preventDefault()` is still correct defensive code** if markup changes,
   but it is not a compatibility mechanism. The prompt says this.
5. **Browser storage remains unavailable by design.** Applications must keep
   state in memory; persistence is not a sandbox feature and was not added.
6. **Capture remains canvas-only.** This is unrelated to the P1 and was not
   changed; non-canvas apps can preview and export but the “Capture” control
   may report that there is no canvas.

---

## 7. Decision record

- **Chosen:** correct the generation/modification instructions; keep the
  sandbox closed; add deterministic regression coverage.
- **Rejected:** adding `allow-forms`, adding `allow-top-navigation`, removing
  `form-action 'none'`, or treating `preventDefault()` as sufficient.
- **Evidence preserved:** FocusFlow attempt 1 (failed), attempt 2 (approved
  v1), modification (approved v2), guard probe (no-op/rejected), screenshots
  and job records are untouched under `docs/demo/evidence/`.
