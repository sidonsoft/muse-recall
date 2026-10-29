# Website UX polish, 29 October 2026

Before and after captures for the website polish pass. Each image pairs the
live `main` build (before) with the polished build (after), at 1440px desktop
and 390px mobile, with reduced motion so nothing is mid-animation.

| Capture | What changed |
| --- | --- |
| `desktop-hero.jpg`, `mobile-hero.jpg` | "For judges" in the nav; "Try it" renamed "Run it locally" so it no longer reads like "Try the loop"; the four headline numbers share one size; less dead space above the hero on phones; the hackathon badge fits on one line |
| `desktop-gallery.jpg`, `mobile-gallery.jpg` | Product screenshots were stretched to 1000px tall and showed a cropped corner; they now show the whole screen at 16:10, two per row on desktop |
| `desktop-judges.jpg`, `mobile-judges.jpg` | The five judge cards fill the row (three above two) instead of leaving an empty cell; section labels get their intended small pink style back |
| `desktop-guard.jpg`, `mobile-guard.jpg` | The five Decision Guard rule families use the same three-over-two layout |
| `mobile-footer.jpg` | Footer links wrap as whole phrases instead of breaking word by word |

Checks after the change: `npm run qa` 26/26, `npm run links` 0 broken.
