# Phase 12C evidence — Decision Guard advisory integration

Branch `agent/phase12c-guard-advisory` · implementation `8f2d509` · advisory only.
Narrative and analysis: [docs/PHASE12C_GUARD_INTEGRATION.md](../../PHASE12C_GUARD_INTEGRATION.md).

## What was evaluated

No model call was made. The baseline is authentic recorded Spark output; the violation case is a
deterministic, in-file-labelled mutation of it. The fake-Muse fixture's `copy` mode only transports
chosen bytes into staging; structural validation, the real Chrome runtime check, the guard, approval
and promotion are production code.

| File | sha256 | What it proves |
| --- | --- | --- |
| `evaluation.json` | `7e3f9658…a669` | Per-case source hashes, decision ids, runtime result, guard verdict/findings/limitations, approval outcome, engine FP/FN probes. |
| `sources/A-violation-mutation.html` | `c5dfd00a…650e` | The controlled test mutation: authentic baseline + `timeLeft` countdown + `score -= 1` mistake penalty. Banner in-file: “PHASE 12C TEST MUTATION — NOT SPONTANEOUS MUSE OUTPUT”. |
| `sources/B-compliant-baseline.html` | `79c9d67a…9ba9e41` | Byte copy of the authentic recorded Spark baseline used for categories B and C. |
| `sources/supplementary-A-v2-authentic.html` | `e22586b2…b878` | Authentic Phase 12A condition-A output used to expose rule D's `0x`/`#` false negative. |
| `screenshots/A-violation.png` | `6563621e…ebad` | The mutated game renders in Chrome (runtime verification passes despite the violation). |
| `screenshots/B-compliant.png` | `6e15169a…e221` | Authentic baseline renders. |
| `screenshots/C-ambiguous.png` | `6e15169a…e221` | Same authentic baseline; the ambiguity is in the decision, not the pixels. |
| `screenshots/supplementary-palette-correction.png` | `e03ca814…7a65` | Authentic A-v2 renders; rule D returns UNVERIFIED rather than a finding. |
| `screenshots/ui-decision-guard-advisory.png` | `455b7af6…a68` | Review panel: **Decision Guard — Advisory**, **Findings do not block approval in this version.**, two findings with rule, severity, decision id/reference, evidence excerpt and explanation. |
| `screenshots/ui-review-page.png` | `4af888ea…e862` | Full page: advisory is separate from the green “validation passed” chip. |
| `screenshots/ui-approved-with-findings.png` | `bd1c2e22…67ab` | Approval succeeded (`approved: v1`, “Change approved”) while advisory findings were present. |

## Results at a glance

| Case | Guard | Findings | Unverified | Runtime | Approval |
| --- | --- | --- | --- | --- | --- |
| A — known violation (mutation) | BLOCK | countdown, mistake penalty | 0 | pass | approved v1 |
| B — known compliant (authentic) | PASS | 0 | 0 | pass | approved v1 |
| C — ambiguous (authentic) | UNVERIFIED | 0 | colour-only-cue | pass | approved v1 |
| S — palette correction (authentic A-v2) | UNVERIFIED | 0 | superseded-palette | pass | approved v1 |

Engine probes (pure, in `evaluation.json`): comment/prose “countdown” → **BLOCK (false positive)**;
`yoyo/repeat: -1` alpha tween → **PASS (false negative)**; `0xFF7E5F` vs `#FF7E5F` → **UNVERIFIED
(false negative)**. These are documented for Strata review; the engine was not modified.

## Reproduce

```bash
pnpm eval:guard          # writes evaluation.json, sources, game screenshots
pnpm evidence:guard-ui   # writes ui-*.png (starts API + Vite on 8899/5199)
```

The UI screenshots come from a separate run with its own seeded decision id (`9f58e063…`); the panel
behaviour is the same production path.

## Notes

- Category C and S intentionally return UNVERIFIED, not PASS: the deterministic engine cannot establish
  compliance, and the UI must not claim it.
- B and C screenshots are byte-identical because they render the same authentic source; only the decision
  set differs.
- No credentials, absolute filesystem paths, or raw generated source appear in `evaluation.json`.
