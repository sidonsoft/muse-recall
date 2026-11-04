# Muse Recall — marketing site

The landing page for **[Muse Recall](https://github.com/sidonsoft/muse-recall)**, kept in the
`website/` folder of the product repo — a local-first studio for building small browser
applications with project memory you can inspect and correct.

Every product claim on the page is drawn from this repository (README,
`docs/MULTIMODAL_STUDIO_STATUS.md`, `docs/release/notes/v0.1.0-beta.md`,
`docs/hackathon-evidence/`, `docs/assets/`) and is labelled by evidence class:
**recorded live call · retained model output · product replay · deterministic fixture**.
The page states what each class proves and what it does not, and the limitations section
carries the open findings rather than hiding them.

## Stack

- Vite + React 18, hand-written CSS design system (no UI framework)
- Sections: three-minute demo with beat-by-beat evidence table, interactive
  "one request, three memory states" widget, memory timeline, beta capability grid,
  HTML Studio, media references, **Meta SAM cutouts as their own section**, bundled-engine
  economics, the seven Decision Guard rule families, a model-role table, integrations
  (shared tools / MCP / REST / backups), evidence tables, judge entry point, gallery,
  quickstart, verified-vs-roadmap, limitations, and this page's own QA scoreboard
- Pre-rendered static HTML (`npm run site`), WebP imagery with srcset, JSON-LD
  (`SoftwareSourceCode` + `VideoObject`) and a PWA manifest; the footer links back to this
  folder and to the reproduction steps
- Real product screenshots and the current demo cut in `public/` (MIT, from this repo)

## Run

The site is a standalone npm project, separate from the pnpm workspace:

```bash
cd website
npm ci
npm run dev      # → http://localhost:5173
npm run site     # production build + pre-render into dist/index.html  (what CI runs)
npm run preview  # serve dist/ on :4173
npm run qa       # 33 checks against `vite preview` (needs headless Chrome)
npm run links    # audit every upstream link against the repo tree
```

`npm run build` is the plain Vite build; **use `npm run site`** — it is what `qa`,
`gecko` and the Pages job run, and a stale or un-prerendered `dist/` makes the static-HTML
checks meaningless.

QA is dependency-free (CDP over Node's global WebSocket) and mirrors the product's own
stance: `npm run qa` asserts behaviour, not appearance, and the page's own scoreboard badge
is compared against the suite total, so a stale count fails the run.

## Scoreboard

Measured on the branch that last touched `website/`, 4 November 2026 (macOS, Node 26.8.1,
Chrome 156.0.8078.80, Playwright's Chromium driver):

| Check | Result |
| --- | --- |
| `npm run site` | client bundle 245.5 kB (76.2 kB gzip) · CSS 35.6 kB (8.0 kB gzip) — one hand-written stylesheet, no framework · 105,705 chars of static HTML pre-rendered into `dist/index.html` |
| `npm run qa` | **33/33** — a11y audit, the widget's three memory states and per-state explanations, mobile overflow at 390 px, mobile menu, ⌘K palette, timeline accordion, LCP/CLS, pre-rendered HTML probes (hero promise, SAM heading, evidence classes, demo markup, JSON-LD duration), 404 fallback, **canonical and the
Open Graph URLs pinned as exact strings to the deployed GitHub Pages origin**, demo video + poster + caption track reachable, **posted download size compared with the bytes actually served**, caption sidecar parses (57 cues, no overlaps, last cue inside 180.000 s), transcript served with timecoded beats, caption sidecar offered without double-rendering the burned-in text, every in-page anchor resolves, **every `./assets` and `./video` path named in the built output returns 200**, seven Guard families and seven shared tools counted in the DOM, manifest + icons, 11 images loaded as WebP, hero aspect-ratio and responsive variant, reduced-motion, copy button and command payload, lightbox open/arrow/Escape, JS-disabled fallback, keyboard (skip link first, no unnamed controls), and the self-referential badge gate |
| `npm run links` | **27 unique paths, 0 broken**; the `v0.1.0` tag resolves to `707921db83a374d155d3929ef9b99092bcd4e8f1`, and `CITED_COMMIT` (set in the `qa` CI job) asserts the tag still points where the copy says it does |
| Playwright flow, Chromium driver (`BROWSER=chromium node scripts/firefox-check.mjs`) | PASS — desktop and mobile, no console/page errors, 11 WebP images loaded |
| Playwright flow, Gecko (CI `gecko` job) | runs in CI; the bundled Firefox 157 driver cannot start on macOS 27, which is why the job exists (see the script header) |
| Lighthouse 12.8.2, mobile preset (412×823, simulated throttle) | Performance **97** · Accessibility **100** · Best Practices **100** · SEO **100** — FCP 1.2 s, LCP 2.5 s, TBT 0 ms, CLS 0, 264 KiB total |
| Lighthouse 12.8.2, desktop preset | **100 / 100 / 100 / 100** — FCP 0.3 s, LCP 0.6 s, TBT 0 ms, CLS 0, 294 KiB total |

What is **not** perfect, and why it is left that way: mobile performance loses three points to
`unused-javascript` (~20 kB of the React bundle not needed for first paint), `dom-size`
(1,358 elements on a single long page that is deliberately one page), and the
video poster (`muse-recall-demo-poster.jpg`, 122,193 B) being larger than the small
viewport box needs — it is kept at full frame and byte-identical to the repository copy so
its checksum matches the demo record. The video itself uses `preload="none"`; with the
faststart layout the `moov` box is 199 kB, so metadata (and a real duration readout) is only
paid for when someone plays the cut.

## Demo media

Public paths are unchanged, so old links keep working. The MP4 served here is
**byte-identical** to `docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4`: SHA-256
`d1695c04fbac57779f14be7d834478b86e868291d0f326710cc62dc5fe3a440d`, 14,903,823 bytes,
exactly 180.000 s, 57 caption cues. The poster (122,193 B, `51dc41b1…`) and the transcript
(`94742542…`) are likewise identical at both paths. Caption text is burned into the picture,
so the WebVTT sidecar is offered but **not** switched on by default — showing both would
render the same sentence twice. Narration is one synthetic voice (Bella, generated with
Eleven v4).

Two older cuts live in Git history, not on these paths: the 2:50.47 / `4020c0c6…` recording at
commit `c32d03b`, and the 3:00 / `6c9e985c…` cut published with the
[`v0.1.0`](https://github.com/sidonsoft/muse-recall/blob/v0.1.0/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true)
release at `707921d`, where the same cut is also published as the release asset
`Muse_Recall_Beta_Demo_3min.mp4` — that tag and its release assets are unchanged. There is **no**
`submission-2026-11-04` tag on the remote: `git ls-remote --tags origin` lists `v0.1.0`,
`submission-v14`, `submission-v15`, `phase17-preregistration` and `archive/*` only, and that tag is
planned work in the roadmap, so no copy here cites it. Full provenance,
including the audio-editing measurements and a container-size discrepancy in the upstream
`QA.json`, is in [`docs/demo/video/V21_QA.md`](../docs/demo/video/V21_QA.md). Editing sources
and intermediate renders stay outside the repository.

## Structure

```
index.html               meta, JSON-LD, preloads, no-JS fallback
vite.config.js
public/
  assets/                real screenshots (+ WebP variants and srcset sizes)
                         og-image.png — 1200×630 social card, 235,046 B, SHA-256
                         7424e37452afc09fd222eda59fd74c6c84b910d68d26dbda5b86fe3ccd492f0b
  video/                 current demo cut, WebVTT sidecar, transcript, poster
  404.html  robots.txt  site.webmanifest  icons/
scripts/
  prerender.mjs          builds the SSR bundle and inlines static HTML into dist
  qa.mjs                 the 33 checks above
  links.mjs              upstream link + release-tag audit
  firefox-check.mjs      same flow through Playwright (Gecko on CI)
src/
  main.jsx  App.jsx  ssr.jsx  index.css  loopData.js
  components/
    Nav.jsx  Hero.jsx  StudioLoop.jsx  Timeline.jsx  Lightbox.jsx
    CommandPalette.jsx  Icon.jsx  Sections.jsx
```

## Editing copy

- Keep numbers in sync with the evidence docs in this repo — the site's credibility is its
  honesty: Phase 17 counts and their source-pattern scope, the advisory nature of the Decision
  Guard and screenshot review, the fact that memory supplies context but does not guarantee
  compliance or update an application by itself, and that the approval gate checks loading.
- Do not describe the page as a submission, an acceptance, or a hosted product. Single-user
  beta, loopback by default, optional shared bearer access; offline setup browses and chats but
  generating an application needs the Muse Code CLI, and media needs separate credentials.
- The social card (`public/assets/og-image.png`) quotes research numbers, so it has to label them
  the way the evidence docs do: `37/57 → 0/58` compares the no-memory and retrieved-memory
  arms for **Muse Spark**, aggregated across all six task strata in the 480-run, two-model
  experiment. The card describes source-pattern checks on generated source, not general
  correctness. `og:image:alt`
  carries the same qualification. It is generated from an HTML mock outside the repository; if you
  regenerate it, update the SHA-256 above and re-check the alt text.
- After changing copy, media or links: `npm run site && npm run qa && npm run links`. If you add
  a QA check, update the count in the `SiteVerified` stats — the badge gate will fail otherwise.
- Deployment metadata lives in `index.html`: canonical, `og:url`, `og:image`, `twitter:image`
  and the JSON-LD URLs use `https://sidonsoft.github.io/muse-recall/`. The prerender script
  renders the React page and inlines CSS; it has no `SITE`, `SITE_URL` or `DEFAULT_ORIGIN`
  configuration. Relative asset links resolve against the served page. If the deployment
  origin changes, update the absolute URLs in `index.html` and the corresponding QA probes.

## Deploy

The `build-pages` and `deploy` jobs in `.github/workflows/website.yml` run `npm run site` and
publish `website/dist` to GitHub Pages on pushes to `main` that touch `website/`. PRs that touch
`website/` run the `qa` and `gecko` jobs. `base: './'` keeps the build portable.

The site used to live in `sidonsoft/muse-recall-website` (published at
`sidonsoft.github.io/muse-recall-website/`); its full history was imported here.
