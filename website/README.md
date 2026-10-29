# Muse Recall — marketing site

The landing page for **[Muse Recall](https://github.com/sidonsoft/muse-recall)** —
correctable project memory for AI-built software. A local-first HTML Studio for
Meta's Muse Spark, built for the Meta Muse hackathon ("Push the Frontier").

All product copy, stats and screenshots come from the `sidonsoft/muse-recall`
repository (README, `docs/submission/SUBMISSION_COPY.md`, `docs/assets/`), so the
site states exactly what the evidence supports.

## Stack

- Vite + React 18, hand-written CSS design system (no UI framework)
- Interactive "one request, three memory states" widget with a guided tour and
  per-state explanation panel, reconstructing the recorded demo / Phase 16–17
  arms (memory supplied · not supplied · corrected) plus the advisory Decision
  Guard
- **Memory timeline** of expandable decision cards built from the real seeded
  demo records (`scripts/lib/demo-seed.ts` in the product repo) — texts verbatim
- ⌘K command palette, screenshot lightbox, copy-to-clipboard quickstart,
  printable judge one-pager (`@media print`), `prefers-reduced-motion` and
  JS-disabled fallbacks
- Pre-rendered static HTML (`npm run site`), WebP imagery with srcset, JSON-LD
  and PWA manifest; the footer names the product-repo commit the copy mirrors
- Real product screenshots in `public/assets/` (MIT, from the source repo)

## Run

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build
npm run qa       # build, then verify against the preview: a11y audit,
                 # widget state machine, mobile overflow, LCP/CLS (needs Chrome)
```

QA mirrors the product's own stance — `scripts/qa.mjs` is dependency-free
(CDP over Node's global WebSocket) and also runs on CI (`.github/workflows/site-qa.yml`,
test-only, not a deploy).

`npm run site` builds and then **pre-renders the app into `dist/index.html`**
(`scripts/prerender.mjs`) — the built output is a portable, static page that
serves full content to crawlers, link-preview bots, and JS-disabled readers;
the client bundle still loads and takes over interactions.

Every upstream link used on the site is audited against the real repo tree with
`npm run links` (expects the `muse-recall` checkout as `../muse-recall-src`,
override with `UPSTREAM=...`).

## Scoreboard

Verified state of this repo at the product-repo commit the footer cites:

| Check | Result |
| --- | --- |
| `npm run qa` (local + CI) | 21/21 — a11y audit, widget state machine + explanations, timeline accordion, ⌘K palette, lightbox, copy button, mobile overflow, WebP sources, aspect-ratio guard, no-JS fallback, reduced-motion, manifest, LCP/CLS |
| `npm run links` | 12/12 paths + commit resolve against the upstream repo |
| Lighthouse (mobile preset) | Perf 100 · A11y 100 · Best-Practices 100 · SEO 100 |
| Lighthouse (desktop preset) | 100 · 100 · 100 · 100 |
| Content parity | every quantitative claim re-grepped verbatim against `docs/hackathon-evidence/` |

## Deploy

Deliberately **not deployed yet** — iteration is active. The branch
`deploy-ready` carries a GitHub Pages workflow (`npm run site` → static
`dist/`, portable `base: './'` so any subpath works); merging it turns on
hosting without touching this branch's behavior.

## Structure

```
index.html
vite.config.js
public/assets/        real screenshots (from muse-recall/docs/assets)
src/
  main.jsx            entry
  App.jsx             page composition + reveal effect
  index.css           design tokens + all styles
  loopData.js         data for the interactive loop widget
  components/
    Nav.jsx  Hero.jsx  StudioLoop.jsx  Sections.jsx
```

## Editing copy

Keep numbers in sync with the evidence docs in the source repo — the site's
credibility is its honesty: Phase 17 counts and p-values, the advisory nature of
the Decision Guard, and the stated trial bounds.
