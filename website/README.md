# Muse Recall — marketing site

The landing page for **[Muse Recall](https://github.com/sidonsoft/muse-recall)** —
correctable project memory for AI-built software. A local-first HTML Studio for
Meta's Muse Spark, built for the Meta Muse hackathon ("Push the Frontier").

All product copy, stats and screenshots come from the `sidonsoft/muse-recall`
repository (README, `docs/submission/SUBMISSION_COPY.md`, `docs/assets/`), so the
site states exactly what the evidence supports.

## Stack

- Vite + React 18, hand-written CSS design system (no UI framework)
- Interactive "one request, three memory states" widget reconstructing the
  recorded demo / Phase 16–17 arms (memory supplied · not supplied · corrected),
  with the advisory Decision Guard panel
- Real product screenshots in `public/assets/` (MIT, from the source repo)
- Scroll-reveal via IntersectionObserver; `prefers-reduced-motion` respected

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
