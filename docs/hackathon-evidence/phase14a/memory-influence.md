# Authentic memory influence — A/B/C (Phase 12A)

Recorded with **muse-spark-1.3-contributor (forced API key)**. One trial per condition. One controlled A/B/C trial, run once per condition. Not repeated, not extrapolated.

Request (byte-identical in all three conditions): "Add a Next Level button beneath the Restart button."

## Remembered decisions

- **Sunset (superseded)** — `8de86811-dbe3-478d-92bd-9de56af53e60` — Art direction: maintain a warm sunset palette. Use #FF7E5F as the primary accent and #2D1E2F for dark text. Avoid aggressive neon colours.
- **Ocean (active)** — `aceff9cf-0f0a-4cdf-9465-39e98ba8d423` — Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.

## Conditions

| Condition | Retrieved memories | Accent in source | Rendered accent coverage | Evidence |
| --- | --- | --- | --- | --- |
| A | de20b28e-d961-4e16-828a-c1375d930b02 | `0xFF7E5F` (sunset) | 1.082% | `../phase12/A-v2-visible.png` |
| B | none (control) | neither | 0.005% | `../phase12/B-v2-visible.png` |
| C | aceff9cf-0f0a-4cdf-9465-39e98ba8d423 | `0x4EA8DE` (ocean) | 0.879% | `../phase12/C-v2-visible.png` |

## Reading

- A (sunset decision active): the rendered game contains the sunset accent 0xFF7E5F at 1.082% visible coverage.
- B (no memory): neither palette accent appears; 0.005% is background noise.
- C (sunset superseded by ocean): the ocean accent 0x4EA8DE appears at 0.879% visible coverage and the source contains no sunset hex.
- The remembered text colour was not applied in A or C; this is a partial palette result, not full constraint adherence.

## Limits

- n = 1 per condition; exploratory, not statistically significant.
- Single palette vocabulary; the only measured causal claim is palette accent selection.
