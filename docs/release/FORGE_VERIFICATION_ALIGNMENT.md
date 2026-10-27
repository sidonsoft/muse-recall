# Forge verification alignment

**Status:** closed for release candidate
**P1 issue:** `pnpm verify:forge` passed 9/9 while targeting the obsolete Muse Memory Lab UI
**Decision:** keep backend and browser responsibilities separate; rewrite the browser
command for the current HTML Studio; fail loudly on the wrong application
**Branch:** `agent/muse-recall-final-p1-fixes` (base `2ba4ba2`)

---

## 1. What existed before

| Command | Script | Actual target | What it proved |
|---|---|---|---|
| `pnpm verify:forge` | `scripts/verify-forge.ts` | `http://127.0.0.1:5173`, legacy “Muse Memory Lab” UI | Clicked **Forge**, filled **Forge project id**, clicked **Generate game**, waited for a **Game preview** canvas, approved, captured, modified, rejected, approved v2, clicked **Undo last change**. 9 checks. |
| `pnpm verify:browser` | `scripts/verify-ui.ts` | `VERIFY_URL`, default `http://127.0.0.1:5173` | Broad smoke: System, provider bench, memory inspector, conversations, and the HTML Studio tab shell. 27 checks on the echo provider. |
| `pnpm verify:runtime` | `scripts/verify-runtime.ts` | Headless Chrome, direct `checkGameRuntime` | Load-time approval check: valid scene passes; broken scene and HTTP/WebSocket exfiltration fail. |
| `pnpm test` | Vitest | In-process Fastify + fake Muse | Backend workflow semantics, including a non-game application, approval, rejection, rollback and policy enforcement. |

### 1.1 Legacy assumptions in `verify-forge.ts`

The script referenced controls that no longer exist after the Studio
repositioning:

- nav button **Forge** (current nav is **HTML Studio**);
- **Forge project id** / **Open project** (current UI is a project-switcher
  dialog with a **Project id** field and an **Open** button);
- **Generate game** (current control is **Generate HTML** / **Stage new version**);
- iframe title **Game preview** (current title is **HTML application preview**);
- **Capture preview** as a mandatory step (current capture is canvas-only and
  optional);
- **Undo last change** (still present, but only after a change exists; the old
  script assumed it unconditionally).

Because the default base URL pointed at a legacy dev server, the command could
pass without touching the repositioned Studio. The live-demo readiness report
recorded exactly this ambiguity as a P1.

---

## 2. Changes made

### 2.1 `scripts/verify-forge.ts` — current Studio browser workflow

- Default base remains `http://127.0.0.1:5173` (the documented dev port) and is
  configurable with `FORGE_VERIFY_BASE`.
- A preflight asserts the **Preview** tab and the **HTML Studio** surface with
  `aria-current="page"`. If the legacy page is served, the command aborts with
  a specific message naming the legacy UI and the base URL. It cannot silently
  pass on the obsolete application.
- The workflow now covers the shipped Studio:
  1. lands on HTML Studio;
  2. opens an isolated project through the project switcher;
  3. generates a non-game HTML application (deterministic fixture);
  4. verifies the staged preview renders and a JavaScript interaction works;
  5. verifies **Source** (staged `index.html`, line/byte/SHA metadata);
  6. verifies **Changes** (staged diff with added lines);
  7. approves v1 and confirms approved preview/source replace the staged view;
  8. exports the HTML artifact via **Download HTML**;
  9. stages a modification and switches **Approved v1 ↔ Staged v2**;
  10. confirms **Decision Guard — Advisory** and the project-memory retrieval
      caveat are visible;
  11. rejects the change and confirms v1 is untouched;
  12. stages and approves v2;
  13. rolls back to the recorded parent v1;
  14. fails on any console or page error.
- Screenshots go to `test-results/verify-forge/` by default
  (`FORGE_VERIFY_SHOTS` overrides). They are never written to tracked evidence.

### 2.2 `pnpm verify:forge-workflow` — backend semantics

New command:

```bash
pnpm verify:forge-workflow   # vitest run tests/integration/forge-api.test.ts
```

It exercises the API directly with the fake-Muse transport, independent of UI
branding: generate, staged preview, diff, validation, approval, rejection,
rollback, concurrency, stale approval, tampering, budget/timeout/cancel,
provider fallback, memory capture, Decision Guard advisory, non-game apps, and
preview policy. 37 tests.

### 2.3 `pnpm verify:formsandbox` — interaction contract

New deterministic Chrome check for the form/sandbox contract. See
[`FORM_SANDBOX_COMPATIBILITY.md`](FORM_SANDBOX_COMPATIBILITY.md).

### 2.4 `scripts/verify-ui.ts` — documented scope

The header now states that it is a broad product smoke test (System, provider,
memory, conversations, Studio shell), **not** the Studio generation/review
workflow. `VERIFY_URL` remains configurable. Screenshots remain under
`test-results/verify-ui/`.

### 2.5 README

The verification block lists the four distinct commands and their scopes.

---

## 3. Current responsibilities

| Responsibility | Command | Runs against | Browser? | Deterministic? |
|---|---|---|---|---|
| Backend workflow semantics | `pnpm verify:forge-workflow` | In-process Fastify + fake Muse | No | Yes |
| Studio browser workflow | `pnpm verify:forge` | A running web client + API (`FORGE_VERIFY_BASE`) | Yes | Yes, with `FAKE_MUSE_MODE=app` |
| Broad product UI smoke | `pnpm verify:browser` | A running web client + API (`VERIFY_URL`) | Yes | Yes, with the echo provider |
| Form/sandbox contract | `pnpm verify:formsandbox` | Local fixtures in Chrome | Yes | Yes |
| Approval runtime + exfiltration | `pnpm verify:runtime` | Headless Chrome, direct runtime check | Yes | Yes |
| UX frames | `pnpm evidence:ux` | Own servers on 8908/5218 | Yes | Yes |
| Unit/integration suite | `pnpm verify` | In-process | No | Yes |

**Rule:** a browser command must assert the current surface, not just a port.
A backend command must not depend on UI text.

---

## 4. Port handling

- `verify:forge` ← `FORGE_VERIFY_BASE` (default `http://127.0.0.1:5173`).
- `verify:browser` ← `VERIFY_URL` (default `http://127.0.0.1:5173`).
- `evidence:ux` owns `8908` (API) and `5218` (web).
- The web client proxies `/api` to `VITE_PROXY_TARGET` (default `8787`).

No port is embedded in an assertion. To verify on the demo ports, run:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:8799 pnpm --filter @mml/web exec vite --port 5199
FORGE_VERIFY_BASE=http://127.0.0.1:5199 pnpm verify:forge
```

For a deterministic Studio run, start the API with:

```bash
FORGE_MUSE_BIN="$PWD/tests/fixtures/fake-muse.mjs" \
FAKE_MUSE_MODE=app \
FAKE_MUSE_APP="$PWD/tests/fixtures/general-app-form.html" \
MODEL_PROVIDER=echo PORT=8899 pnpm --filter @mml/server exec tsx src/index.ts
```

Use absolute fixture paths: `pnpm --filter` runs the server with
`apps/server` as its working directory.

---

## 5. Wrong-application failure (verified)

With the legacy “Muse Memory Lab” server on `:5173`:

```text
Error: verify:forge expected the current HTML Studio at http://127.0.0.1:5173,
but its Preview tab never appeared. This looks like the legacy Muse Memory Lab
UI; verify:forge no longer targets it. Point FORGE_VERIFY_BASE at the current
web client. Page began: Muse Memory Lab …
```

Exit code 1. With the current Studio on `:5299` (isolated verification
servers), the command passed 14 checks plus the no-console-error check.

---

## 6. Screenshot output and evidence protection

| Script | Default output | Destructive? |
|---|---|---|
| `verify:forge` | `test-results/verify-forge/` | No; disposable, gitignored |
| `verify:browser` | `test-results/verify-ui/` | No; disposable, gitignored |
| `evidence:ux` | `docs/ux-evidence/final/` | Designated UX evidence; run deliberately |
| `verify:formsandbox` | none | No |
| `verify:runtime` | none | No |

`docs/assets/`, `docs/hackathon-evidence/`, `docs/demo/evidence/`,
`docs/ux-evidence/baseline/` and the demonstration video are never written by
routine verification. The old `verify-forge.ts` wrote
`docs/assets/phase9-forge-*.png`; that behaviour was removed in `7a4ca50` and
is preserved here.

During this task `pnpm evidence:ux` was run successfully and produced 24
frames. The frames were visually inspected at 1920×1080, 1440×900 and
1280×720; because this task changes no UI, the regenerated files (which differ
only by environment rendering and seeded timestamps) were reverted to the
approved committed evidence.

---

## 7. Residual limitations

1. `verify:forge` requires a running API and web client; it does not start
   them. `evidence:ux` does.
2. `verify:forge` uses a deterministic fixture, not a live model. It proves the
   Studio workflow, not model quality or prompt compliance.
3. `verify:browser` still skips the live-Muse probe and generative-interface
   journey when the echo provider is configured; that is intentional CI/offline
   behaviour.
4. Backend workflow coverage remains in Vitest, not a standalone long-running
   browser E2E. This is deliberate: it is faster and cannot be fooled by UI
   branding.
5. The Studio browser command does not exercise mobile layout; the form
   contract and evidence scripts cover responsive frames separately.
6. Approval's runtime check is load-time only. It does not click through the
   app; `verify:forge` and `verify:formsandbox` add interaction coverage for the
   verification fixtures, not for arbitrary generated apps.
