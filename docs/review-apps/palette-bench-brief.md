Build **Palette Bench**, a single-page tool for choosing a five-colour palette.

What it must do:

1. A numeric **seed** field. The palette is derived from the seed, so the same seed
   always produces the same five colours.
2. A **Generate** control that produces five colour swatches from the current seed.
3. Each swatch can be **locked**. Locking keeps that swatch while the other four are
   re-derived from a new seed.
4. Clicking a swatch copies its hex value and reports what happened.
5. Each swatch shows a **contrast readout**: its contrast ratio against white and
   against black, to two decimals, with a WCAG label (`AA`, `AA large`, or `fail`).
6. An **Export** control writes CSS custom properties (`--color-1` … `--color-5`)
   into a textarea so the palette can be copied out.
7. A **Clear** control empties the palette.

Constraints:

- One HTML document with inline CSS and JavaScript. No build step.
- No network requests of any kind: no CDN, no web fonts, no analytics, no external
  images. Everything must work with the network disabled.
- Vanilla JavaScript only.
- Operable from the keyboard: every control reachable and labelled, visible focus.
- Reasonable down to a 390 px wide viewport.
