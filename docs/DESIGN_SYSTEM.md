# Muse Recall — design system

**Scope:** the implementation in `apps/web/src/index.css`, `apps/web/src/components/ui.tsx`,
`apps/web/src/components/Icon.tsx`, and the HTML Studio components. This is the system as
built, not an aspirational spec.

**Direction:** a premium developer workspace. Deep navy-black surfaces, warm-white type, a
single restrained gold accent, and semantic status colour. The generated application is the
brightest thing on screen; chrome recedes. No chat bubbles, no gradient cards, no neon.

---

## 1. Foundations

### 1.1 Colour tokens

Defined in `@theme` in `apps/web/src/index.css`; every UI colour comes from these names.

| Token | Hex | Role |
| --- | --- | --- |
| `base` | `#0a0c11` | App background, code-view surround |
| `surface` | `#10141c` | Panels, header, review rail |
| `surface-2` | `#161c26` | Inputs, chips, secondary blocks |
| `surface-3` | `#1d2531` | Skeleton highlight, raised hint |
| `line` | `#252d3a` | Default divider and panel border |
| `line-bright` | `#3a4658` | Hover border, scrollbar thumb |
| `ink` | `#f1eee6` | Primary text (warm white) |
| `ink-dim` | `#c6cbd6` | Secondary text, code context |
| `muted` | `#949cad` | Metadata, labels, placeholders |
| `accent` | `#e7c17c` | Identity, focus, primary action, current version |
| `accent-dim` | `#cda75f` | Accent hover/pressed |
| `accent-ink` | `#1a1409` | Text on accent fills |
| `ok` | `#5fcf9f` | Approved, passed, success |
| `warn` | `#e8b25e` | Staged, advisory finding, caution |
| `err` | `#ec8291` | Errors, failed validation, destructive text |

**Measured contrast** against `surface` (`#10141c`): ink 15.9:1, ink-dim 11.3:1, muted 6.7:1,
accent 10.8:1, ok 9.6:1, warn 9.6:1, err 7.2:1. All meet WCAG AA for normal text; primary text
meets AAA. Accent on base is 11.5:1; accent-ink on accent is 10.7:1.

**Rules**

- Gold is an accent, not a wash. One primary action per surface.
- Green is only for approved/success. A passing Decision Guard check is **not** green.
- Amber is staged/advisory, not an error.
- Never use colour alone: every status also has a label and often an icon.
- Code surfaces use a near-black (`#0b0e14`) distinct from panels; diff lines use tinted
  backgrounds (`diff-add` / `diff-del`) with readable text.

### 1.2 Typography

| Role | Size / weight | Usage |
| --- | --- | --- |
| Page title | 15–16 px / 600, tracking −0.01em | Studio project title, view title |
| Section title | 12.5 px / 600 | Development, Review, Project memory |
| Body | 12–13 px / 400 | Explanations, findings, dialogs |
| Metadata | 10.5–11 px / 400–500 | Timestamps, SHAs, counts, chips |
| Eyebrow | 10.5 px / 600, tracking 0.13em, uppercase | Product/area labels, example groups |
| Code | 11.5 px / 400 mono, line-height 1.7 | Source, diff, logs |
| Status label | 10.5–11 px / 500–600 | Approve/validation chips |

Family stack: `Inter, ui-sans-serif, system-ui, ...`; mono: `ui-monospace, "SF Mono",
"JetBrains Mono", Menlo, monospace`. The app uses system fallbacks; no network font is required.

**Rules**

- Body line height 1.5; code 1.7.
- Minimum 10 px for metadata, never for a sentence the user must act on.
- No all-caps sentences; uppercase is reserved for short eyebrows/chips.
- Numbers that are compared (SHAs, line counts, versions) are monospace and aligned.

### 1.3 Spacing and layout

- Base unit: 4 px; common steps 6/8/10/12/14/16/20/24.
- Panel padding: 12–14 px. Dense table rows: 6–8 px vertical.
- App shell: fixed top bar (58 px); content fills `min-h-0` with internal scroll.
- Studio grid at ≥1280 px: `280px minmax(0,1fr) 334px` with 12 px gaps.
- Below 1280 px: single column, stacked Development → Artifact → Review.
- Panels: `1px solid line`, radius 12 px, no shadow. Depth comes from surface steps.
- Artifact column is always `minmax(0,1fr)` so the preview wins leftover width.
- No page-level horizontal scroll at 1280, 1440, 1920.

### 1.4 Radii and borders

| Element | Radius |
| --- | --- |
| Panel | 12 px |
| Input / button | 8 px |
| Chip / tag | 6 px |
| Preview frame | 6–8 px |
| Full status pill | 999 px |

Borders are 1 px. A brighter border on hover is the primary affordance; no heavy shadows.

---

## 2. Components

### 2.1 Buttons

| Class | Use | Appearance |
| --- | --- | --- |
| `.btn .btn-primary` | One primary action (Generate, Approve) | Gold fill, dark text, 600 weight |
| `.btn` | Secondary action (Reload, Source, Reject) | Surface-2 fill, line border |
| `.btn .btn-ok` | Approval | Green-tinted fill and border, green text |
| `.btn .btn-quiet` | Toolbar tertiary (Wrap, Additions, Reload) | Transparent until hover |
| `.btn .btn-sm` | Toolbar/rail actions | 11 px, 18 px line height |

Disabled: `opacity: 0.4`, `cursor: not-allowed`, and an adjacent reason text where the reason is
not obvious. Destructive actions never use the primary gold style.

### 2.2 Fields

`.field` — surface-tinted background, line border, 12 px text, 8 px radius, accent border on
focus plus the global focus ring. Placeholders use `muted`. Prompt, change and decision fields
are labelled; keyboard shortcut hints are adjacent, not inside the placeholder.

### 2.3 Tabs

`.tab[aria-selected="true"]` — surface-2 fill with an inset line and `ink` text. Used for
Preview / Source / Changes and for the change/new mode switch. Tabs are real `<button>`s with
`role="tab"`; the artifact tabs support Left/Right arrow navigation.

### 2.4 Chips and badges

`.chip` — 10.5 px mono, 6 px radius, line border. Variants are expressed with utilities
(`border-warn/35 bg-warn/10 text-warn`, `border-ok/30 ...`). Chips carry state: `v1 approved`,
`v2 staged`, `used`, `active`, `superseded`, `staged — not approved`, `large rewrite`.

Status is always a chip + text; a bare coloured dot is never the only signal.

### 2.5 Panels

`.panel` — surface, line border, 12 px radius. Headers use a hairline divider and a 12.5 px
title with an optional icon. Panels do not nest more than one visual level; inner blocks use
surface-2 and a lighter border.

### 2.6 Notices, errors, toasts

Inline notice bars: `.notice` with `.notice-ok` / `.notice-warn` / `.notice-err`. They are
dismissible, use `role="status"` (successors) or `role="alert"` (errors), and never cover the
primary action. The app does not use floating toasts for critical state; a persistent bar keeps
the message in the recorded viewport.

### 2.7 Loading and empty states

- `.spinner` for indeterminate work; label it ("Muse Spark is writing…", "Loading preview…").
- `.skeleton` for panel loads; no layout shift.
- Empty states state what will appear and the next action. Examples: "No HTML application yet",
  "Nothing staged for review", "No approved version yet".
- No percentage progress or invented stages; the backend reports queued/running/succeeded.

### 2.8 Version history and rollback

Each version is a row: version badge, summary, timestamp, short SHA, `current` chip. Rollback is
a two-step inline confirmation that names the **recorded parent**, not `current − 1`. The
current version stays in the list after a rollback, labelled as history rather than current.

### 2.9 Decision Guard panel

Advisory banner first: "Findings do not block approval in this version." Assessment chip,
supported-check scope, engine/source metadata, then findings. A finding shows rule, severity,
decision reference, explanation and a bounded evidence excerpt. No green PASS badge and no
approval control inside the guard.

### 2.10 Code surfaces

Source: near-black pane, sticky line-number gutter, 11.5 px mono, a small HTML tokenizer
(tags/attributes/strings/comments/embedded script-style). Diff: add/del tinted rows, hunk
headers in accent, wrap toggle, jump-to-additions, copy. Source is rendered as React text; it is
never HTML-injected.

---

## 3. Interaction quality

- **Hover:** border brightens; quiet buttons gain a surface. No movement on hover.
- **Focus:** 2 px gold outline with 2 px offset; visible on every interactive element.
- **Transitions:** 120–160 ms on colour/border only. No layout animation.
- **Reduced motion:** `prefers-reduced-motion` disables spinners, skeleton sheen, and
  transitions; scroll behaviour becomes auto.
- **Confirmation:** destructive actions use inline confirmation (rollback) or an explicit mode
  (Reject is a separate button; approval is not implied by generation).
- **No auto-advance:** generating never switches to "approved"; it switches to the staged
  **preview**, with the Changes tab marked `staged` for code review.
- **Provider honesty:** the Development header names the configured engine, including
  "echo (offline)"; the product narrative never turns a test double into live Muse Spark.

---

## 4. Accessibility contract

1. Every interactive element is reachable by Tab in DOM order.
2. Icon-only buttons have `aria-label`.
3. Inputs have a `<label>` or `aria-label`; error text is adjacent and linked by context.
4. Tabs use `role="tab"`, `aria-selected`, and arrow-key navigation; panels reference their tab.
5. Status changes announce via `aria-live` / `role="status"`; errors use `role="alert"`.
6. Contrast is measured in §1.1 and must not regress.
7. The layout reflows at 200% zoom and at 1280 px without horizontal page scroll.
8. Colour is never the sole carrier of a state.
9. Generated HTML runs only inside a sandboxed iframe; the surrounding UI does not absorb its
   styles or events.

---

## 5. Responsive behaviour

| Width | Layout | Notes |
| --- | --- | --- |
| 1920×1080 | 280 / fluid / 334 | Preview ~1,190 px; all provenance visible |
| 1440×900 | 280 / fluid / 334 | Preview ~754 px; review actions visible |
| 1280×720 | 280 / fluid / 334 | Preview ~610 px; full preview and review state visible |
| <1280 | single column | Development → Artifact → Review; internal scroll per rail |
| ≤768 | stacked, top bar wraps | Secondary target; preview retains aspect via mobile toggle |

The mobile toggle renders the iframe at 390 px; it does not simulate a device or alter the
generated application's code.

---

## 6. Content and voice

- Plain, specific, present tense: "Muse Spark staged an HTML version. Review the change."
- Never say "approved" for staged work; never say "live" for the echo provider.
- Distinguish **supplied** from **caused**: "2 decisions supplied to this generation" and
  "Retrieved context, not proof that it changed a model decision."
- Decision Guard copy always includes advisory scope and "not a compliance certification".
- Runtime verification copy says "load-time" and never implies interaction or gameplay testing.
- Export copy says the file may need network for a CDN; never "self-contained" unless verified.

---

## 7. File map

| Concern | File |
| --- | --- |
| Tokens, base, components, motion | `apps/web/src/index.css` |
| Shell, top bar, nav | `apps/web/src/App.tsx`, `components/TopBar.tsx` |
| Studio layout | `components/studio/StudioView.tsx` |
| Development prompt/mode | `components/studio/PromptPanel.tsx` |
| Review, versions, artifact footer | `components/studio/ReviewPanel.tsx` |
| Source and diff | `components/studio/SourceAndDiff.tsx` |
| Project memory rail | `components/studio/StudioMemory.tsx` |
| Decision Guard | `components/forge/DecisionGuardAdvisory.tsx` |
| Shared primitives | `components/ui.tsx` |
| Icons | `components/Icon.tsx` |

This is intentionally a small system: one accent, one panel recipe, one button family, one tab
recipe. New surfaces should reuse these before adding tokens.
