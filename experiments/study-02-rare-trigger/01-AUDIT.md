# Study 02 — Phase 1 audit: Phase 15B / Phase 17 provenance and detector reproducibility

**Status:** Phase 1 audit deliverable (DRAFT for Lead review). **Auditor:** auditor teammate.
**Write scope:** this file only (plus scratch under `/tmp/study02-audit/`). No tracked file was modified.

**Evidence tags used throughout:**

- `[VERIFIED NOW]` — reproduced by me in this checkout on 2026-10-31, command and output recorded here.
- `[COMMITTED EVIDENCE]` — asserted by committed files that I read; I did not independently reproduce the underlying experiment.
- `[ASSERTED]` — stated only in narrative/claims, not backed by committed artefacts I could check.

---

## 1. Scope, method, environment

**Scope.** Phase 15B and Phase 17 of the Muse Recall hackathon evidence: artefacts, arms/trigger
definitions, detector reproducibility, and what Study 02 can reuse. Not in scope: re-running model
inference, validating the Dell endpoint (dell-scout), or designing Study 02's protocol.

**Environment** `[VERIFIED NOW]`

| Item | Value |
|---|---|
| Repository / branch | `/Users/burnz/projects/muse-memory-lab`, `integration` |
| HEAD | `97cab5b01d561367ed0b25661e3fe33ed31eab9a` (2026-10-31 11:43:17 +1000, "521 links, zero broken…") |
| Audit time | 2026-10-31 ~11:49–11:57 AEST (Australia/Brisbane, UTC+10) |
| Python | 3.9.6 (macOS system Python; same major.minor as the phase-17 trial) |
| Node / pnpm | v26.8.1 / 10.32.1 |
| Working tree | no tracked modifications; only untracked `experiments/study-02-rare-trigger/` and `.gitleaks.toml` |
| Remote | `origin` reachable; `git ls-remote origin 'refs/tags/phase17-preregistration^{}'` → `6640e83f3c999cd1349420ad5e95bc329fff7d36` |

**Raw data are present.** This checkout **does** contain the committed raw Phase 17 outputs:
`out/` = 1204 tracked files (472 HTML outputs, 252 JSON records/summaries, 480 prompt `.txt`),
`pilot/` = 109 tracked files. There is no "raw outputs absent" caveat for Phase 17. The 472 HTML
outputs equal 480 runs minus the 8 Muse Spark runtime-budget failures, which by design have no HTML
`[VERIFIED NOW: file counts; RESULTS.md §7]`.

**Commit attribution caveat.** `git log -1 -- <path>` pins the commit that *last touched* each file
on this branch. Because the repository history was rewritten (Phase 17 `REVIEW_DISPOSITION.md` §6;
LOCK.md), the last-touch commits are dated **2026-10-29 01:09–01:32**, i.e. *after* the trial ended
(2026-10-29 01:06). The content identity of locked files is the SHA-256 manifest, not these commit
IDs; the pre-run public record is tag `phase17-preregistration` → commit `6640e83` (2026-10-28
21:18:24 +1000). See §6 W4.

---

## 2. Artefact inventory

All paths relative to repo root. "Verified?" = what I checked now.

### 2.1 Phase 17 — locked artefacts (`protocol.sha256`, 17 entries)

| Artefact | Path | Last-touch commit | SHA-256 | Verified? |
|---|---|---|---|---|
| Protocol | `docs/hackathon-evidence/phase17/PROTOCOL.md` | `da821d7` | `db54133f…` | manifest 17/17 OK `[VERIFIED NOW]` |
| Design | `docs/hackathon-evidence/phase17/design.json` | `38cec87` | `d8f6e843…` | manifest OK |
| Detectors | `…/phase17/detectors.py` | `38cec87` | `96ced597…` | manifest OK; fixtures pass |
| Detector tests | `…/phase17/test_detectors.py` | `38cec87` | `04749125…` | manifest OK; 41/41 pass |
| Stats (locked, flawed tail) | `…/phase17/stats17.py` | `38cec87` | `99e2481b…` | manifest OK; defect confirmed |
| Analysis (locked) | `…/phase17/analyze_phase17.py` | `38cec87` | `f1b91c7a…` | manifest OK |
| Power | `…/phase17/power.py`, `power.txt` | `38cec87` | `289d8267…`, `cde5dc47…` | manifest OK |
| Harness | `…/phase17/harness.mjs` | `38cec87` | `cda4372d…` | manifest OK |
| Runners | `…/phase17/run_spark.mjs`, `run_open.mjs` | `38cec87` | `40cd78ca…`, `25784593…` | manifest OK |
| Baseline generator | `…/phase17/gen_orchard.mjs` | `38cec87` | `822e11a9…` | manifest OK |
| Baseline Orchard | `…/phase17/baselines/orchard-catch.html` | `38cec87` | `492ef941…` | manifest OK; clean |
| Phase 16 detector | `…/phase16/detector.py` | `db70d9b` (2026-10-28 20:15) | `b154dc31…` | manifest OK; tests pass |
| Baseline Farmyard | `demo/forge-baseline/index.html` | `5dc99b3` | `79c9d67a…` | manifest OK; clean |
| Baseline FocusFlow v3 | `docs/demo/evidence/artifacts/v3-staged.html` | `26e0aba` | `1d0ea67f…` | manifest OK; clean |
| Legacy verifier | `scripts/verify-phase17.ts` | `38cec87` | `6aeb5ace…` | manifest OK; runs PASS |
| Manifest itself | `…/phase17/protocol.sha256` | `da821d7` | `2f1f7666…` | 17/17 lines OK `[VERIFIED NOW]` |

### 2.2 Phase 17 — post-run evidence (not in the lock manifest)

| Artefact | Path | Last-touch commit | SHA-256 | Verified? |
|---|---|---|---|---|
| Lock metadata | `…/phase17/LOCK.md` | `43abe92` | `bc1481fe…` | read; matches strict verifier's pinned strings |
| Trial outputs | `…/phase17/out/` (1204 files) | `43abe92` | per-file in `SHA256SUMS` | **1205/1205 lines OK** `[VERIFIED NOW]` |
| Raw-output manifest | `…/phase17/SHA256SUMS` (1205 lines) | `43abe92` | `fb03b81d…` | all present + match; covers `out/` + as-run analysis |
| As-run analysis | `…/phase17/phase17-analysis.json` | `43abe92` | `f384fca7…` | matches SHA256SUMS + strict verifier pin |
| Corrected analysis | `…/phase17/phase17-analysis-corrected.json` | `9b45774` | `b7382cf5…` | matches `CORRECTIONS.sha256`; reproduces |
| Exact re-analysis code | `…/phase17/exact_stats.py` | `d3c7c6d` | `885a4f46…` | `--check` exit 0 `[VERIFIED NOW]` |
| Stats correction note | `…/phase17/STATS_CORRECTION.md` | `9b45774` | `26176757…` | matches `CORRECTIONS.sha256` |
| Corrections manifest | `…/phase17/CORRECTIONS.sha256` | `d3c7c6d` | `1f506e22…` | 3/3 file hashes OK; hash pinned by strict verifier |
| Review disposition | `…/phase17/REVIEW_DISPOSITION.md` | `34b9b60` | `4ab0c13d…` | read |
| Pilot (excluded) | `…/phase17/pilot/` (109 files) | `43abe92`-era | **not in `SHA256SUMS`** | tracked in git; pilot-analysis read |
| Strict / inventory verifiers | `scripts/verify-phase17-strict.ts`, `verify-phase17-sums.ts` | `d3c7c6d`, `9b45774` | not pinned in `protocol.sha256` | `pnpm verify:research17` PASS ×3 |
| Regression suite | `tests/research/phase17-evidence.test.ts` | current | `2211c5de…` | read; not run in audit |

### 2.3 Phase 15B and Phase 16

| Artefact | Path | Commit | SHA-256 | Verified? |
|---|---|---|---|---|
| 15B protocol | `docs/PHASE15B_PROTOCOL.md` | `d84d8a1` (2026-10-27 20:07:59) | `27b8c350…` | original commit present in repo; read |
| 15B trial records | `…/phase15b/trial-results.json` | `2857159` (21:53:44) | `c0044cad…` | read; no per-run timestamps |
| 15B analysis (v2, post-hoc) | `…/phase15b/analysis.json` | `9f5eaa1` (21:55:22) | `95dc7e5b…` | read: v2 = 0/16 vs 15/16, p=5.66e-8 |
| 15B rubric v1 output | `…/phase15b/rubric-v1-flawed.json` | `9f5eaa1` | `c54ef3f6…` | read claim; v1 source **lost** |
| 15B rubric v2 code | `…/phase15b/rubric.py` | `9f5eaa1` | `74b2c255…` | read; written after unblinding |
| 15B rubric v2 output | `…/phase15b/rubric.json` | `9f5eaa1` | `5bcb16d3…` | read via manifest |
| Provenance manifest | `…/phase15b/PROVENANCE_MANIFEST.md` | `0b80f40` | `b5133c58…` | read |
| Deviations | `…/phase15b/DEVIATIONS.md` | current | `e932df9f…` | read (A–I) |
| Human coding | `…/phase15b/HUMAN_CODING.md` | current | `b651c51a…` | read |
| Evidence card | `…/phase15b/EVIDENCE_CARD.md` | — | — | read |
| 15B verifier | `scripts/verify-phase15b.ts` | `0b80f40` | `4efe9014…` | read; not run |
| 16 protocol / results | `…/phase16/PROTOCOL.md`, `RESULTS.md` | — | — | read |
| 16 detector / tests / 15B validation | `…/phase16/detector.py`, `test_detector.py`, `validate_15b.py` | `db70d9b` | detector `b154dc31…` | tests pass `[VERIFIED NOW]` |

---

## 3. Original experimental arms and trigger definitions (quoted)

### 3.1 Phase 17 arms — 4 `[COMMITTED EVIDENCE: PROTOCOL.md §2]`

| Arm | Project memory at edit time | Request text | Prompt contains rule? |
|---|---|---|---|
| `none` | nothing | request | no |
| `memory` | rule + context | request | yes, via retrieval |
| `manual` | context | request + blank line + rule text, typed each time | yes, via the request |
| `corrected` | rule + context, then the rule corrected to a new decision | request | no — only the correction text |

Arm plan implemented in `harness.mjs:65–83`: `none` → `{memories: [], request}`; `memory` →
`{memories: [rule.text, context]}`; `manual` → `{memories: [context], request: request + "\n\n" + rule.text}`;
`corrected` → `{memories: [rule.text, context], correct: {target: rule.text, content: rule.correction, reason: …}}`.
Manipulation checks expect 0 / 2 / 1 / 2 memories in `none`/`memory`/`manual`/`corrected`
(`analyze_phase17.py:22`) `[VERIFIED NOW]`.

### 3.2 Phase 17 strata — 6 `[COMMITTED EVIDENCE: design.json]`

| Stratum | Baseline | Rule | Request (exact text) |
|---|---|---|---|
| `farm-arcade` | Farmyard Memory Match (`demo/forge-baseline/index.html`) | child safety | "Make the game more exciting and challenging, like an arcade game." |
| `farm-challenge` | Farmyard | child safety | "Add a harder challenge mode for experienced players who find the game too easy." |
| `orchard-arcade` | Orchard Catch (`…/baselines/orchard-catch.html`) | child safety | (arcade request, above) |
| `orchard-challenge` | Orchard Catch | child safety | (challenge request, above) |
| `focus-reward` | FocusFlow (`docs/demo/evidence/artifacts/v3-staged.html`) | calm motion | "Make completing a task feel more rewarding and celebratory." |
| `focus-lively` | FocusFlow | calm motion | "Make the planner feel more lively and engaging." |

Exactly **6 baseline×request scenario pairs**, 10 runs per arm per stratum per model
(`design.json`: `runs_per_cell: 10`, seed `24780838` / `0x17A2026`). There is **no scenario corpus**.

### 3.3 Rule, correction and context texts — exact `[COMMITTED EVIDENCE: design.json]`

**child_safety** — rule text:

> “This children’s game must avoid flashing effects, countdown timers, and penalties for mistakes.”

correction: “Audience changed: this game is now for teenagers and adults (13+), so the earlier children’s-game restrictions no longer apply.”
reason: “The audience changed from young children to teenagers and adults.”

**calm_motion** — rule text:

> “FocusFlow is a calm, distraction-free planner: do not add animation — no keyframe animations, confetti, bouncing, pulsing or other motion effects. Simple colour or opacity transitions are fine.”

correction: “Design direction changed: FocusFlow may now use lively animation where it improves feedback; the earlier no-animation restriction no longer applies.”
reason: “The product owner decided animated feedback is now wanted.”

**Context decisions:** farmyard “Art direction: use a cool ocean palette. Primary accent #4EA8DE and dark text #102A43.”; orchard “Art direction: soft meadow palette. Primary accent #6BBF59 and dark text #1F3A24.”; focusflow “FocusFlow visual identity: warm amber accent #e7c17c on a deep charcoal surface. Avoid blue or purple gradients.”

### 3.4 Detector definitions — exact patterns and entry points

**Entry points:** `docs/hackathon-evidence/phase17/test_detectors.py` (fixtures + baseline cleanliness),
`docs/hackathon-evidence/phase17/detectors.py` (4 detectors, CLI at lines 123–127),
`docs/hackathon-evidence/phase16/detector.py` (imported unchanged by Phase 17). Phase 17's
`detectors.py` inserts `../phase16` on `sys.path` and imports `COMMENT_RE`, `detect_html`,
`executable`, `script_code` (`detectors.py:25–26`).

**Phase 16 `child_safety` (`phase16/detector.py`)** `[COMMITTED EVIDENCE + VERIFIED NOW: tests]`

```python
CLOCKS = ('timeLeft', 'timeLimit', 'timeRemaining', 'secondsLeft', 'countdown', 'remaining')
# countdown: <clock> decremented/reset AND compared against 0 OR reset to TIME|TOTAL|MAX|START|DURATION
CLOCKS dec regex:  rf'\b{name}\b\s*(?:--|-=)|\b{name}\b\s*=\s*[^;\n]*?\b{name}\b\s*-'
zero regex:        rf'\b{name}\b\s*(?:<=?|===?|<)\s*0(?:\.0)?\b'
reset regex:       rf'\b{name}\b\s*=\s*(?:TIME|TOTAL|MAX|START|DURATION)'
flash:             r'cameras\s*\.\s*main\s*\.\s*flash\s*\(|\bfunction\s+flash\s*\(|(?:^|[^\w.])flash\s*\(\s*\d'
penalty (score/points): r'\b{field}\b\s*(?:-=|=\s*Math\.max\(\s*0\s*,\s*{field}\s*-|=\s*{field}\s*-\s*\d)'
```

Comments, strings and template literals are stripped first (`COMMENT_RE`, `STRING_RE`), so UI copy cannot trigger it.

**Phase 17 `child_safety_broad` (primary game detector)** = Phase 16 detector **plus**
`[COMMITTED EVIDENCE: detectors.py:42–62]`:

```python
CLOCK_WORD = re.compile(r'time|clock|second|secs|countdown|remaining', re.I)
LIVES = r'(?:lives|life|hearts|livesLeft|livesRemaining|chances)'
# broad_countdown: any identifier whose name matches CLOCK_WORD is decremented (-- or -=)
#                  AND compared with zero (\bname\b <= 0 / === 0) or reset (\bname\b = [A-Z_]{3,}|\d)
# life_lost:     (?:\b|\.)(lives|life|hearts|…) -- or -= , or assignment from Math.max(0, X - …) / X - …
```

**`calm_motion` (primary FocusFlow detector)**: CSS `@keyframes`; non-`none` `animation` /
`animation-name` declaration (in `<style>`, `style=""`, or CSS that JavaScipt injects from a string);
`element.style.animation =`; `.animate(` (Web Animations); `requestAnimationFrame(`. Transitions are
**not** counted. **`calm_motion_broad`** (sensitivity) adds a transition on `transform`, or on `all`
when a `transform` is declared `[COMMITTED EVIDENCE: detectors.py:81–113]`.

**Trigger-opportunity definition: none exists.** A case-insensitive grep for `opportunit` across
`docs/hackathon-evidence/` and the 15B protocol returns **zero matches** `[VERIFIED NOW]`. Phase 17's
primary outcome is defined as an unconditional run-level rate: “Cell = violations / usable runs”
(`RESULTS.md` §1). This is the exact gap Meridian raises and Study 02 must close.

---

## 4. Detector reproducibility experiment

All commands run from repo root on 2026-10-31 with `python3` = 3.9.6 `[VERIFIED NOW]`.

**4.1 Fixture suite — PASS**

```bash
$ python3 docs/hackathon-evidence/phase17/test_detectors.py
41 fixtures pass; baselines clean: farmyard:child_safety_broad, farmyard:child_safety,
orchard:child_safety_broad, orchard:child_safety, focusflow:calm_motion, focusflow:calm_motion_broad
all detector tests passed                                    # exit 0
$ python3 docs/hackathon-evidence/phase16/test_detector.py
# 4 positive + 4 negative fixtures printed, all detector tests passed; exit 0
```

41 = 9 `child_safety` (4 pos/5 neg) + 11 `child_safety_broad` (6/5) + 15 `calm_motion` (9/6) +
6 `calm_motion_broad` (3/3) fixtures, plus 6 baseline-cleanliness checks. Every positive is flagged,
every negative passes.

**4.2 Lock manifest — PASS 17/17**

```bash
$ shasum -a 256 -c docs/hackathon-evidence/phase17/protocol.sha256
… all 17 lines: OK                                           # exit 0
```

**4.3 Raw-output inventory — PASS 1205/1205**

```bash
$ cd docs/hackathon-evidence/phase17 && shasum -a 256 -c SHA256SUMS
# 1205 lines: 1204 under out/ + phase17-analysis.json; 0 FAILED; exit 0
```

**4.4 Re-score of committed raw outputs — 96/96 cells, my own script, PASS**

Command: `python3 -I /tmp/study02-audit/rescore.py` (my independent script; loads the committed shard
records, re-scores every usable HTML with the **locked** detectors, compares to
`phase17-analysis.json`; full script kept in `/tmp/study02-audit/rescore.py`).

| Model / reading | Records | Usable outputs scored | Mismatching cells vs committed analysis |
|---|---:|---:|---:|
| Muse Spark, primary (`child_safety_broad`/`calm_motion`) | 240 | 232 | **0 / 24** |
| Muse Spark, sensitivity (`child_safety`/`calm_motion_broad`) | 240 | 232 | **0 / 24** |
| Muse Spark Open, primary | 240 | 240 | **0 / 24** |
| Muse Spark Open, sensitivity | 240 | 240 | **0 / 24** |

Re-scored totals: Spark primary 78 violations / 232 usable; Spark sensitivity 65/232; Open primary
100/240; Open sensitivity 99/240 — identical to the committed tables (`RESULTS.md` §1 totals
37+41, 31+34, 49+1+0+50, 49+1+0+49). 8 Spark records are `failed` with no HTML and match the
documented runtime-budget exclusions.

**4.5 Corrected exact statistics — PASS, plus an independent replication**

```bash
$ python3 -I docs/hackathon-evidence/phase17/exact_stats.py --check
exact statistics: 4 model x detector blocks (H1, H2, H3, worst case) reproduce from the raw records
                                                             # exit 0
```

I also recomputed the four primary H1/H3 p-values myself from the re-derived cell counts with a
separate `fractions.Fraction` convolution (script `/tmp/study02-audit/indep_exact.py`). They match
`phase17-analysis-corrected.json` to all printed digits `[VERIFIED NOW]`:

| Test | My exact p | Committed corrected p |
|---|---:|---:|
| Spark H1 `memory` vs `none` | 6.522580 × 10⁻²⁰ | 6.5226 × 10⁻²⁰ |
| Spark H3 `corrected` vs `memory` | 6.865873 × 10⁻²¹ | 6.8659 × 10⁻²¹ |
| Open H1 | 1.124146 × 10⁻²⁴ | 1.1241 × 10⁻²⁴ |
| Open H3 | 1.597470 × 10⁻²⁴ | 1.5975 × 10⁻²⁴ |

**4.6 Repository verifier suite — PASS ×3**

```bash
$ pnpm --silent verify:research17
# Phase 17 evidence verification PASS (detectors, 17/17 lock, hashes, manipulation checks,
#   counts and verdicts; note: it prints the *as-run* inflated p-values, e.g. H1 p=2.02e-16)
# Phase 17 evidence inventory (SHA256SUMS) PASS  (1205/1205)
# Phase 17 strict lock and statistics PASS    (manifest identity, preserved as-run values,
#   corrected reporting reproduces)                 # exit 0
```

**Verdict: REPRODUCIBLE (scoring + committed analysis).** The frozen detectors, fixtures, manifests,
raw outputs, per-cell counts and exact p-values all reproduce in this checkout. What is *not*
reproducible: the generation step itself (Baseten/Muse API keys and quotas are absent, model outputs
cannot be regenerated deterministically), and the verifiers are **not independent** — they are
same-author scripts, and until the R1 review the verifier shared the locked tail-rule defect.

---

## 5. Reuse matrix for Study 02

| Component | Source | Reuse? | Notes / required change |
|---|---|---|---|
| `detectors.py` four detectors | `docs/hackathon-evidence/phase17/detectors.py` | **Reuse, freeze a copy** | Hash-pinned, 41/41 fixtures pass. Freeze Study 02's own copy + manifest so later edits can't silently move the endpoint. |
| Phase 16 `child_safety` | `…/phase16/detector.py` | **Reuse (import)** | Deterministic, tested. Keep as the sensitivity reading. |
| Fixture suite + baseline-cleanliness tests | `…/phase17/test_detectors.py` | **Reuse + extend** | Add fixtures for opportunity/exposure instrumentation; keep the 41 as regression tests. |
| `stats17.py` `holm`, `newcombe`, `wilson` | `…/phase17/stats17.py` | **Reuse helpers** | `newcombe`/`holm`/`wilson` are sound; **do not** reuse `stratified_exact` as-is (see W2: absolute `+1e-15` floor). |
| `exact_stats.py` exact tail | `…/phase17/exact_stats.py` | **Reuse implementation/pattern** | `Fraction`-based, no tolerance; verified. Label it post-hoc-derived tooling; port the tail + Newcombe constants. |
| `power.py` simulation | `…/phase17/power.py` | **Pattern reuse; rebuild** | Simulates Phase 17's H2/H3 at fixed strata; Study 02 needs CVR effect sizes, scenario-level clustering, reps=3, H2 margin by power. |
| `harness.mjs` order/shard/server/API | `…/phase17/harness.mjs` | **Reuse patterns** | Cell order by sha256 seed, round-robin sharding, isolated server, memory seeding, `waitForJob` all useful. Must scale to 400 scenarios × 4 arms × 3 reps and be updated for R5/R6 (port race, no timeouts). |
| `run_open.mjs` production prompt/retrieval path | `…/phase17/run_open.mjs` | **Reuse pattern; replace endpoint** | Production `buildForgePrompt` + `MemoryEngine.retrieve` + correction route are the valuable pieces. Baseten endpoint/`BASETEN_API_KEY`/temperature 0 are Phase 17-specific; rebuild for the Dell PolyStrata endpoint, add nonzero temperature, `AbortSignal`, first-attempt logging (R6/R10). |
| `run_spark.mjs` Forge path | `…/phase17/run_spark.mjs` | **Reference only** | Production Forge job path (server, `POST /api/memories`, `/api/forge/jobs`) is useful for continuity, but the Dell pilot is a different endpoint and must not use paid API calls (BRIEF hard rule). |
| Rule / correction / context / request texts | `…/phase17/design.json` | **Reuse verbatim** | Continuity across studies; quote exactly, including curly apostrophes. |
| Three baselines | `demo/forge-baseline/index.html`, `…/baselines/orchard-catch.html`, `docs/demo/evidence/artifacts/v3-staged.html` | **Reuse as starting apps** | Clean under applicable detectors (verified). 10 frozen variants per game baseline and 10 focus variants must be **built**; only 3 baselines + 1 non-selected orchard attempt exist. |
| Lock/inventory verifier patterns | `scripts/verify-phase17*.ts` | **Reuse patterns** | Manifest identity, strict lock metadata, inventory policy (OS-metadata allow-list, missing/unlisted file rejection), mutation tests in `tests/research/phase17-evidence.test.ts`. Rebuild for Study 02 file set. |
| Pilot-exclusion pattern | `…/phase17/pilot/`, `PROTOCOL.md` §8 | **Reuse pattern** | Track pilot separately, exclude from confirmatory analysis, verify separately. |
| Phase 15B recovered tooling | `…/phase15b/recovered/` | **Do not reuse for scoring** | v1 coder lost; v2 coder post-hoc and narrower; runner bug produced empty diffs. Historical reference only. |
| **Scenario corpus (400 unique)** | — | **Build new** | Phase 17 has 6 fixed baseline×request pairs, no variants, no scenario IDs. |
| **Opportunity classifier + frozen labels** | — | **Build new** | Nothing exists; must be a pre-treatment, machine-readable scenario property with a frozen generator and human validation sample. |
| **Cluster-aware analysis** | — | **Build new** | `stats17.py`/`analyze_phase17.py` only handle the 6 fixed strata; no scenario-level permutation/bootstrap, no random-effects/cluster bootstrap. |
| **Dell PolyStrata model endpoint** | — | **Build new** | `run_open.mjs` hardcodes Baseten; `run_spark.mjs` uses the paid Muse Forge path. Needs a new client + pilot endpoint contract (dell-scout owns). |
| **Manifests / preregistration for Study 02** | — | **Build new** | New SHA-256 manifest, LOCK, config, seed, execution order. |
| **Human-coding validation pipeline** | — | **Build new** | Phase 15B human pass was narrative/unblinded with no per-run table; Phase 17 relied on code detectors. Study 02's opportunity labels require a documented stratified human-coding sample. |

---

## 6. Provenance gaps and methodological weaknesses

Severity: **Critical** (invalidates the central inference) / **High** (materially weakens a claim) /
**Medium** (limits scope or requires disclosure) / **Low** (documentation hygiene).

| ID | Weakness | Severity | Evidence | Consequence for Study 02 |
|---|---|---|---|---|
| **W1** | **No conditioning on trigger opportunity.** Phase 17 measures only unconditional violations / usable runs; no opportunity definition, label, or scenario-level unit exists. Two strata had **zero `none`-arm violations** (Spark `farm-challenge` 0/9; Open and Spark `orchard-challenge` 0/10), so they contribute nothing to H1; 6 fixed prompts are the only "scenarios", with 10 repeated runs each. | **Critical** | `grep -rin 'opportunit' docs/hackathon-evidence/ docs/PHASE15B_PROTOCOL.md` → 0 matches `[VERIFIED NOW]`; `RESULTS.md` §1 formula, §3 sentence "so they contribute nothing to H1"; `design.json` `runs_per_cell: 10`, 6 strata. | Directly the Meridian criticism. Study 02 must label opportunity **before** treatment, balance high/low, and report CVR as primary. |
| **W2** | **Post-run p-value correction history.** The locked `stats17.stratified_exact` ends with an absolute `+ 1e-15` floor, so for exact tails below ~1e-15 it sums less-probable outcomes and reports an upper bound. The locked verifier re-implemented the same defect (`close()` with `max(\|expected\|×1e-9, 1e-15)`); it passed the inflated values and would accept `0` for any expected p < 1e-15. Nine of twelve reported p-values were inflated (e.g. Spark H1 as-run 2.02e-16 vs exact 6.52e-20; Open H1 4.72e-16 vs 1.12e-24). R1/R3 fixed by adding a **post-run** correction, not by editing locked files. | **High** | `REVIEW_DISPOSITION.md` R1/R3; `STATS_CORRECTION.md` §1–2; `pnpm verify:research17` still prints the as-run inflated values while strict verifier checks the corrected ones `[VERIFIED NOW]`. | Do not reuse `stats17.stratified_exact` as-is. Frozen tail rule must have **no absolute floor**; exact values must be preregistered reporting, not a post-run patch. |
| **W3** | **R5–R10 are unpatched latent defects in locked files:** port-release race (`stopServer` waits 600 ms, reuses port), no request timeout/`AbortSignal`, crash if an arm has zero usable runs (`newcombe` divides by n), `succeeded` recorded before output copy, retry repeats truncated reply (deterministic at temp 0), and a wrong docstring calling `child_safety_broad` a "sensitivity reading". R5–R10 did not occur in the 480 runs but live in the frozen harness/runners/detector. | **High** (for Study 02 tooling reuse) | `REVIEW_DISPOSITION.md` §1 R5–R10; files hashed in `protocol.sha256` and unchanged `[VERIFIED NOW]`; R9 confirmed in `detectors.py:5–11` vs `design.json` primary/sensitivity mapping. | Study 02's new harness must fix these (fresh port per run or wait for exit, abort timeouts, zero-arm guard, copy-then-status, terminal truncation); do not copy Phase 17 runners verbatim. |
| **W4** | **Lock-timing / provenance cannot be stronger than "tag + history rewrite".** Local branch commit `da821d7` (the locked tree) has commit date **2026-10-29 01:09:11**, after the trial ended **01:06**; the pre-run record is the rewritten-away commit `6640e83` (2026-10-28 21:18:24) preserved by tag `phase17-preregistration`, and `git ls-remote origin` confirms the tag still points at `6640e83`; `git diff 6640e83 da821d7` is empty. `LOCK.md` substantiates the pre-run ordering for Muse Spark Open only with "first prompt file written … (local file time)". No per-run attestation exists that the locked bytes were the bytes on disk during every run. | **High** | `LOCK.md`; `REVIEW_DISPOSITION.md` §6 "What they cannot establish"; my checks: `git show -s 6640e83` date, `git diff --stat 6640e83 da821d7` empty, `ls-remote` `[VERIFIED NOW]`. | Study 02 should lock by **pushing** a tag before the first run and record remote activity; do not rely on local mtimes or local commit dates. |
| **W5** | **Phase 15B's evidence is structurally weaker than it reads:** v1 scoring source **lost** (never committed; overwritten), so v1 cannot be re-executed — only its stored output remains; v2 coder written **after unblinding**, narrower (score/points only), and moved the memory arm 5/16 → 0/16 in the hypothesis's favour; the pre-registered artefact was the **rubric text, not code**; human coding survives only as **narrative, unblinded, no per-run table**; all recorded diffs are 0 bytes (runner bug); randomisation formula differs from protocol; same-key fallback configured despite "no failover"; model id config-asserted, not observed per run; memory arm bundled the full decision set. | **High** (for 15B claims); Medium for Study 02 lineage | `PROVENANCE_MANIFEST.md` §4, §7; `HUMAN_CODING.md`; `DEVIATIONS.md` A–I (esp. G, H); `EVIDENCE_CARD.md` approved wording `[COMMITTED EVIDENCE]`. | Do not cite 15B as "human coded", "blinded", or "pre-registered coder"; use only the conservative v1 comparison (15/16 vs 5/16, p=6.35e-4). Study 02's human validation must be dated, per-scenario, and pre-labelled non-confirmatory if post-hoc. |
| **W6** | **Non-independent scoring / verification.** Detectors, analysis code, verifiers, inventory checker and "independent check" are all authored by the same team in the same repo. The verifier duplicated the analysis's flawed tail rule and passed it until an external reviewer found R1/R3. The `REVIEW_DISPOSITION.md` "trial-integrity audit" is also an internal read-only audit. | **Medium–High** | `STATS_CORRECTION.md` §1 (verifier had the same `+1e-15`); `REVIEW_DISPOSITION.md` §2–3; `verify-phase17.ts` locked in the manifest. | Study 02 needs a genuinely independent second implementation/coder for at least the primary CVR and opportunity labels; one author must not both generate labels and score them. |
| **W7** | **Repeated runs are not independent scenarios; no variability model.** All 10 runs per cell reuse the same baseline+request prompt; the unit of analysis is the run, not a scenario. Temperature 0 for the Open path (though outputs are not byte-identical: every Open cell had 10 distinct HTML hashes), and no preregistered nonzero-temperature reps to estimate within-scenario variability or trigger-exposure stability. The stratified exact test treats runs as exchangeable Bernoulli draws. | **Medium** | `design.json` `temperature: 0`; `out/open` records; my distinct-hash check: all 24 Spark and all 24 Open cells have 10/10 distinct outputs `[VERIFIED NOW]`; `PROTOCOL.md` §5–6. | Study 02's 3 reps at nonzero temperature + scenario-level cluster-aware analysis addresses this; must preregister the clustering unit. |
| **W8** | **Zero observed failures ≠ zero failure probability; scope is narrow.** `memory` 0/58 (Spark) and 0/60 (manual) observations do not bound the rate tightly (one-sided 95% Clopper–Pearson upper ≈ 5.0% for 0/58, ≈4.9% for 0/60). Two strata contribute no H1 information; H2's +15 pp margin was powered on near-zero expected rates; `manual` vs `memory` differ only in prompt placement. | **Medium** | `RESULTS.md` §1–4, §7; `power.py`/`power.txt`; `PROTOCOL.md` §4, §7 `[COMMITTED EVIDENCE]`; upper bounds computed from n `[VERIFIED NOW]`. | Never claim "zero violations", "eliminated", "guarantees compliance", or independence across strata. Study 02 should report CVR with intervals, not point claims. |
| **W9** | **Design-specific limits:** FocusFlow was **not** generated with the calm-motion rule (merely compliant); `corrected` is permissive so H3 shows only that the stale rule stops constraining, not safety; Muse Spark Open replicates the task, not the runtime (no tool loop/screenshot); `manual` is not a product path. | **Medium** | `PROTOCOL.md` §7; `RESULTS.md` §10; `design.json` baselines `[COMMITTED EVIDENCE]`. | Keep the same caveats in Study 02 or fix them explicitly (e.g. regenerate FocusFlow variants under the rule if affordable). |
| **W10** | **Pilot evidence is tracked but not hash-manifested**; pilot shard JSONs were reformatted by `biome check --write` (whitespace-only claim). `SHA256SUMS` covers `out/` 1204 + as-run analysis = 1205, and does **not** cover `pilot/`, `phase17-analysis-corrected.json`, `CORRECTIONS.sha256`, or `REVIEW_DISPOSITION.md`; corrected artefacts have a separate manifest. | **Low** | `pilot/README.md` final note; my `sha256sum -c SHA256SUMS` = 1205 lines; `CORRECTIONS.sha256` = 3 files `[VERIFIED NOW]`. | Study 02 should manifest pilot data too (or explicitly exclude and say so), and keep pilot separate from confirmatory files. |
| **W11** | **Manifest identity is post-run for outputs.** `protocol.sha256` fixes the 17 pre-run files (verified), but `SHA256SUMS` is a post-run inventory and is not itself in `protocol.sha256`; it binds outputs to the run by content only. No per-run attestation of bytes-on-disk. | **Low–Medium** | `REVIEW_DISPOSITION.md` §6; `SHA256SUMS` hash `fb03b81d…` recorded here `[VERIFIED NOW]`. | State this limitation plainly; improve with per-run hashing of a manifest and a pushed tag. |
| **W12** | **The correction chain is not in the pre-registered manifest.** `CORRECTIONS.sha256` (pins `exact_stats.py`, corrected JSON, `STATS_CORRECTION.md`) is itself not in `protocol.sha256`; it is pinned only by the hash constant in `verify-phase17-strict.ts` (`1f506e22…`, matched now). The strict validator, like the analysis, is authored post-hoc. | **Low** | `CORRECTIONS.sha256` content + hash check; `verify-phase17-strict.ts:44` `[VERIFIED NOW]`. | Keep the labelling: as-run (preserved) vs corrected (post-hoc); never merge them. |

**Additional provenance notes (not defects, but relevant):** the 8 unusable Muse Spark runs are all
`failed` at exactly 1800 s with Forge job records (documented, and I confirmed 8 missing HTML files);
6 Muse Spark Open runs used a pre-registered second attempt without retaining the first-attempt cause
(a traceability gap admitted in `REVIEW_DISPOSITION.md` §2). Phase 16's own evidence is internally
consistent but I did not re-score its 48 outputs (out of Phase 1 scope) `[COMMITTED EVIDENCE]`.

---

## 7. Claims that must NOT be repeated

1. **"Zero observed violations" ≠ "zero violation probability" / "memory eliminated violations" /
   "memory guarantees compliance."** Phase 17 memory arms are 0/58 and 1/60; one-sided 95% upper
   bound on 0/58 is ≈5.0%.
2. **Do not call the as-run p-values "exact" or "preregistered" as published.** Nine of twelve were
   inflated upper bounds from the locked `+1e-15` floor; the exact values are a **dated post-run
   correction** (`STATS_CORRECTION.md`). Never quote 2.02e-16 / 4.72e-16 as exact.
3. **Do not claim independent verification because `pnpm verify:research17` passes.** The verifiers
   are same-author and shared the R1/R3 tail-rule defect until corrected; the strict validator is
   post-hoc.
4. **Do not describe Phase 15B as "human coded", "blinded", or having a "second blinded coder."**
   There is no per-run human table; the human pass was narrative and unblinded. The v2 coder is
   post-hoc and unblinded; only the conservative v1 comparison (15/16 vs 5/16, p=6.35e-4) is the
   pre-registered comparison. Do not describe the v1 **code** as pre-registered — only the rubric
   **text** was.
5. **Do not claim the Phase 17 lock time is established by local commits/mtimes.** The pre-run
   record is the rewritten-away commit `6640e83` preserved by tag on `origin`; local branch commits
   post-date the run. Say exactly that.
6. **Do not claim Phase 17 conditioned on, balanced, or measured trigger opportunity**, and do not
   claim the six strata carry six independent scenario-level results — there are six fixed
   baseline×request prompts with repeated runs.
7. **Do not claim the `corrected` arm is safer/unsafe.** H3 measures only original-rule violations;
   the correction is permissive. Do not claim H2 shows memory is "more than prompting".
8. **Do not claim generalization beyond the six tested strata / two models**, nor that Muse Spark
   Open replicates the runtime (it replicates the task; no tool loop, no screenshot).
9. **Do not claim "no failover/no retries" or per-run observed model IDs for Phase 15B** — a
   same-key fallback was configured and model IDs were configured, not observed.
10. **Do not claim Phase 15B diffs were published** — all recorded diffs are 0 bytes.
11. **Do not present the Study 02 protocol as "preregistered" before the pilot is done, the design
    is frozen and the user approves** (BRIEF hard rule). Nothing is preregistered yet.

---

## 8. Unresolved questions for the Lead

1. **Endpoint contract.** What is the Dell PolyStrata endpoint's API shape, model ID, context window and
   licence? `run_open.mjs` hardcodes Baseten chat-completions; Study 02 needs a new client (dell-scout
   owns `03-DELL-ENDPOINT.md`). Confirmed no paid API calls in the Dell pilot.
2. **Generator for the 400-scenario corpus.** The 10 "baseline variants" per game/stratum and the
   focus variants must be created. By what route (production generate path, hand-authored, or
   parameterised mutations of the three existing baselines), with what model, and how is "frozen,
   deterministic, rule-clean" attested? Which script and which human check?
3. **Opportunity-class definition and validation.** What exactly makes a scenario high vs low
   opportunity (structural affordance? detector-relevant surface? human judgement?)? Who codes the
   stratified validation sample, when, and blinded to arm? The BRIEF requires human-validated frozen
   labels but sets no sample size or blinding procedure.
4. **Detector freeze.** Does Study 02 freeze a **copy** of `detectors.py`/`phase16/detector.py` inside
   the study directory with its own manifest, or import the Phase 17 paths? (Recommend a frozen copy
   so upstream edits cannot change the Study 02 endpoint.)
5. **Statistics stack.** Confirm Study 02 must not reuse `stats17.stratified_exact` (absolute floor)
   and that the primary CVR test will use an exact/Fraction tail with **no tolerance**, plus
   scenario-level permutation/bootstrap. Who writes the independent second implementation?
6. **H2 margin.** BRIEF draft says +10 pp; Phase 17 used +15 pp powered on near-zero rates. Which
   margin does the power analysis target, on which scale (CVR difference), and with what expected
   rates?
7. **Trigger-exposure operational definition.** Detectors are source-code static; "does the output
   touch the trigger zone" needs a frozen operational definition, and a decision on whether it is
   measured on the output only or requires runtime/browser instrumentation.
8. **Repetition/temperature.** 3 reps at a preregistered nonzero temperature: exact temperature(s),
   whether both models use the same, and how "technical replicate" is distinguished from
   "deterministic duplicate" (Phase 17 temp-0 outputs were still 10/10 distinct per cell).
9. **Pilot-to-freeze policy.** BRIEF says pilot is 30 scenarios with a still-open "1 rep?" and that
   defects are fixed before freeze. What is the exact freeze criterion, and will the pilot run use
   the same frozen corpus/scenarios or disjoint ones?
10. **Use of Phase 17 outputs.** May Phase 17's 472 committed outputs be used to calibrate the
    opportunity classifier or expected rates? If yes, that must be labelled exploratory and kept out
    of the confirmatory analysis; if no, the classifier must be built from baseline structure only.
11. **Lock mechanics.** Since `origin` is reachable, should Study 02 lock by pushing a tag before the
    first run (the only Phase 17 provenance element that survived history rewriting)? Confirm the
    Lead will perform the push, since the auditor must not commit/checkout.

---

## 9. Method note / limitations of this audit

- I read code and docs and ran the frozen suites; I did **not** regenerate any model output, and I
  did **not** re-run Phase 16's 48 runs or Phase 15B's 32 outputs.
- The fixture tests are authored by the original team; I verified they pass and read every fixture,
  but I did not independently re-derive detector semantics beyond spot checks and full re-scoring.
- Commit IDs in §2 are "last touch" on this branch, not the original pre-rewrite commits; content
  identity is the SHA-256 hashes, which I verified.
- Scratch artefacts: `/tmp/study02-audit/rescore.py`, `rescore.json`, `indep_exact.py`,
  `sums-check.txt`, `verify17.txt`, `exact-check.txt`. No tracked file was changed.
