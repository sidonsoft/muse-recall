# Study 02 — corpus diversity / coverage review (review/08)

**Decision: ACCEPT the current corpus** for the primary confirmatory claims, with the explicit scope
limitations and pre-declared sensitivity set in §5. **No expansion before freeze.** Conditions and the
later expansion triggers/plan are in §5.

| | |
|---|---|
| Status | Offline coverage review for the Director's corpus-acceptance gate. **Not** a freeze, **not** a confirmatory run, **no paid calls**. AI-produced review — not human validation. |
| Branch / base | `study02/qual-prep` / `dc104b9` (immutable evidence snapshot) |
| Corpus under review | `corpus/` at `dc104b9`: 60 variants, 400 scenarios, 400 labels; `corpus.sha256` 67 hashes; `gen_corpus.py --check` reproduces all files byte-identically |
| Files read / recomputed from | `corpus/corpus.json`, `corpus/labels.json`, `corpus/validation.json`, `corpus/diversity.json`, `design/design-v2.json`, `design/corpus-spec-v2.md`, `08-CORPUS-DIVERSITY.md`, `review/05-DESIGN-STATISTICAL-REVIEW.md` §1.2/§3 |
| Change this task | **None to the corpus, generator, pilot data or manifests.** This file is the only write. |

**Method.** Counts below were recomputed with stdlib Python directly from the JSON artifacts listed
above (not copied from prose). Similarity values are from `corpus/diversity.json`; detector/twin/size
evidence is from `corpus/validation.json`. Where a claim depends on a design document it is cited.

---

## 1. What the corpus covers

| Dimension | Coverage |
|---|---|
| Baseline families | **3**: `farmyard` (memory-match game), `orchard` (fruit-catching game), `focusflow` (non-game task planner) |
| Structural templates | **30** — 10 per family, `T00`–`T09`, each with a distinct structure/key: header-hud, side-panel, bottom-tray, ribbon, log-column, progress-header, dashboard, minimal, control-column, magazine (games) / agenda, split-sidebar, kanban, timeline, card-grid, detail-panel, tabs, dashboard, accordion, statusbar (planner) |
| Variants | **60** = 30 H (`v00`–`v09` per family) + 30 L (`v10`–`v19`), matched twins; every template has exactly one H and one L variant |
| Strata | **6**: `farm-arcade` 60, `farm-challenge` 60, `orchard-arcade` 60, `orchard-challenge` 60, `focus-reward` 80, `focus-lively` 80 |
| Scenarios | **400**; **200 high / 200 low**; 20 variants per stratum; scenarios per variant = 6 (game) / 8 (focus); scenarios per (variant, stratum) = 3 (game) / 4 (focus) |
| Request paraphrases | **14 corpus** texts (arcade 3, challenge 3, reward 4, lively 4) + 4 pilot-only `p00`; not in corpus |
| Rules / mechanics | **2 rules**: child safety (countdown/timer, flash, mistake/penalty) and calm motion (keyframe/scripted animation). 240 game scenarios carry the 3 game trigger types; 160 focus scenarios carry the 2 animation trigger types |
| Opportunity hooks (H) | farmyard H: `G1` score economy + `G2` mistake/streak feedback + `G3` pacing HUD (3); orchard H: `G1`–`G3` + `G4` core real-time loop (4); focusflow H: `F1` completion + `F2` celebration zone + `F3` progress visual + `F4` transition surface (4). L twins: farmyard 0; orchard `G4`; focusflow `F1` |
| Hook-count rule | H observed 3–4 (min 3); L observed 0–1 (max 1); 30 twin proofs hold; twin difference 43–50 lines/pair |
| Context / palette memory | **3 fixed contexts**, one per family (Farmyard ocean; Orchard meadow; FocusFlow amber/charcoal), held constant across all arms/scenarios (arm-level design, `02-PROTOCOL-DRAFT.md` §3.2) |
| Labels | **400 × 20 fields** (`template_id`, `twin_id`, `variant_role`, opportunity class/hooks, trigger types, detector names, computed cleanliness, invariants, paraphrase, hashes, provenance); 0 scenario↔label mismatches; role/class agreement enforced |
| Static validation | 60/60 single-file HTML; 60/60 detector-clean under primary **and** sensitivity readings; 60/60 inline-JS `node --check`; sizes 15,658–20,199 B; twin proofs 30/30 (`validation.json`) |
| Execution unit prepared | 4 arms × 400 scenarios × 3 reps = **4,800 planned confirmatory executions** (not executed; no confirmatory data exists) |

---

## 2. Quantitative coverage matrix

### 2.1 Stratum × family × request (recomputed from `corpus.json` / `labels.json`)

| Stratum | Family | Request | Variants | Paraphrases | High | Low | Scenarios | H clusters |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `farm-arcade` | farmyard | arcade | 20 | 3 | 30 | 30 | 60 | 10 |
| `farm-challenge` | farmyard | challenge | 20 | 3 | 30 | 30 | 60 | 10 |
| `orchard-arcade` | orchard | arcade | 20 | 3 | 30 | 30 | 60 | 10 |
| `orchard-challenge` | orchard | challenge | 20 | 3 | 30 | 30 | 60 | 10 |
| `focus-reward` | focusflow | reward | 20 | 4 | 40 | 40 | 80 | 10 |
| `focus-lively` | focusflow | lively | 20 | 4 | 40 | 40 | 80 | 10 |
| **Total** | 3 families | 4 requests | — | 26 texts | **200** | **200** | **400** | **30** |

Each H variant is one cluster: 30 H-variant clusters (10 per family), each contributing 6 scenarios
(game) or 8 (focus) across its family's two strata. This is the level at which H2 inference is
clustered (`review/05` §3; `04b` §3.2/§4.5).

### 2.2 Template inventory (family × template × role × request × paraphrase × class)

Each template row instantiates one H and one L variant; each variant is used with **both** requests of
its family (one stratum each) and every paraphrase of that request (3 game / 4 focus), with H and L
each contributing one class per cell. Thus every
`(family, template, role, request, paraphrase, class)` tuple occurs exactly once:
30 templates × 2 roles × 2 requests × (3 or 4) paraphrases = **400 scenarios** (120 + 120 + 160 by
family). `scen/variant` counts scenarios across both strata.

| Family | T | Structure | H variant | L variant | Hooks H | Hooks L | Requests | Paras/stratum | Scen/variant |
|---|---|---|---|---|---|---|---|---:|---:|
| farmyard | T00 | header-hud | farmyard-v00 | farmyard-v10 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T01 | side-panel | farmyard-v01 | farmyard-v11 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T02 | bottom-tray | farmyard-v02 | farmyard-v12 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T03 | ribbon | farmyard-v03 | farmyard-v13 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T04 | log-column | farmyard-v04 | farmyard-v14 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T05 | progress-header | farmyard-v05 | farmyard-v15 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T06 | dashboard | farmyard-v06 | farmyard-v16 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T07 | minimal | farmyard-v07 | farmyard-v17 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T08 | control-column | farmyard-v08 | farmyard-v18 | G1–G3 | — | arcade, challenge | 3 | 6 |
| farmyard | T09 | magazine | farmyard-v09 | farmyard-v19 | G1–G3 | — | arcade, challenge | 3 | 6 |
| orchard | T00 | classic-header | orchard-v00 | orchard-v10 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T01 | side-panel | orchard-v01 | orchard-v11 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T02 | bottom-tray | orchard-v02 | orchard-v12 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T03 | lanes | orchard-v03 | orchard-v13 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T04 | log-column | orchard-v04 | orchard-v14 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T05 | progress-header | orchard-v05 | orchard-v15 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T06 | dashboard | orchard-v06 | orchard-v16 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T07 | minimal | orchard-v07 | orchard-v17 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T08 | control-column | orchard-v08 | orchard-v18 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| orchard | T09 | magazine | orchard-v09 | orchard-v19 | G1–G4 | G4 | arcade, challenge | 3 | 6 |
| focusflow | T00 | agenda | focusflow-v00 | focusflow-v10 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T01 | split-sidebar | focusflow-v01 | focusflow-v11 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T02 | kanban | focusflow-v02 | focusflow-v12 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T03 | timeline | focusflow-v03 | focusflow-v13 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T04 | card-grid | focusflow-v04 | focusflow-v14 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T05 | detail-panel | focusflow-v05 | focusflow-v15 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T06 | tabs | focusflow-v06 | focusflow-v16 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T07 | dashboard | focusflow-v07 | focusflow-v17 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T08 | accordion | focusflow-v08 | focusflow-v18 | F1–F4 | F1 | reward, lively | 4 | 8 |
| focusflow | T09 | statusbar | focusflow-v09 | focusflow-v19 | F1–F4 | F1 | reward, lively | 4 | 8 |

### 2.3 Cell occupancy and empty cells (recomputed)

| Dimension | Potential cells | Occupied | Empty | Note |
|---|---:|---:|---:|---|
| family × request | 3 × 4 = 12 | 6 | **6** | by design: game requests only with game families; focus requests only with FocusFlow |
| template × request | 30 × 4 = 120 | 60 | **60** | by design: every template has only its family's two requests |
| template × stratum | 30 × 6 = 180 | 60 | **120** | by design: a template belongs to one family (2 strata) |
| stratum × template × paraphrase cell | 4×(10×3) + 2×(10×4) = 200 | 200 | **0** | every request×template×paraphrase combination is filled |
| … × opportunity class (H/L) | 200 × 2 = 400 | **400** | **0** | both twins present in every cell |
| hook profile × family | 3 families × 2 roles = 6 | 6 | 0 | but see §2.4: one H bundle and one L bundle per family, no single-hook ablation |
| trigger type × request | 3 game types × 2 game requests + 2 focus types × 2 focus requests = 10 applicable | 0 labelled separately | 10 | **not encoded**: labels attach the family's whole trigger set to every scenario (games: 3; focus: 2), so request×trigger opportunity is not separately labelled (see §3, limitation 4) |
| context/palette × family | 1 context per family | 3 | 0 | context fixed within family; no variation |

### 2.4 Hook / construct coverage

| Hook | Family | H scenarios (role H) | L scenarios (role L) | Affordance added by H | Forbidden mechanic it invites |
|---|---|---:|---:|---|---|
| G1 score economy | farmyard | 60 | 0 | points HUD, increase-only | score/points penalty |
| G2 mistake feedback | farmyard | 60 | 0 | persistent streak/mistake panel | penalty for mistakes |
| G3 pacing HUD | farmyard | 60 | 0 | inert tick/round HUD | countdown/timer |
| G4 real-time loop | orchard | 60 | 60 | shared real-time catch loop | timer/flash/penalty in a real-time game |
| G1–G3 | orchard | 60 each | 0 | points, streak, pacing HUD | penalty, countdown/timer, flash |
| F1 completion event | focusflow | 80 | 80 | core completion handler | animated completion feedback |
| F2 celebration zone | focusflow | 80 | 0 | static celebration region | confetti/bounce/pulse animation |
| F3 progress visual | focusflow | 80 | 0 | progress bar/percentage | animated progress |
| F4 transition surface | focusflow | 80 | 0 | colour/opacity/width transitions (rule-allowed) | keyframes/motion |

Hook-count rule verified: H min 3, H max 4; L min 0, L max 1 (`validation.json` `hook_rules`). Hook
**profiles are bundles**: all farmyard H variants carry exactly {G1,G2,G3}, all orchard H exactly
{G1,G2,G3,G4}, all focusflow H exactly {F1,F2,F3,F4}. There is no variant with a single hook removed
or a partial bundle, so the corpus cannot separate the effect of one hook from the bundle.

### 2.5 Diversity metrics (from `corpus/diversity.json`)

| Pair group | pairs | token J. | 5-gram J. | DOM-token J. | DOM 5-gram J. | norm. line edit distance |
|---|---:|---:|---:|---:|---:|---:|
| Twin pairs (H vs L, same template) | 30 | 0.9396 | 0.8726 | 0.8025 | 0.6162 | 0.0707 |
| Farmyard, different templates — H | 45 | 0.9772 | 0.9136 | 0.6689 | 0.2484 | 0.0200 |
| Farmyard, different templates — L | 45 | 0.9747 | 0.9059 | 0.6086 | 0.1805 | 0.0191 |
| Orchard, different templates — H | 45 | 0.9793 | 0.9187 | 0.6811 | 0.2913 | 0.0179 |
| Orchard, different templates — L | 45 | 0.9767 | 0.9124 | 0.6261 | 0.1845 | 0.0179 |
| Focusflow, different templates — H | 45 | 0.9742 | 0.9172 | 0.6966 | 0.2037 | 0.0128 |
| Focusflow, different templates — L | 45 | 0.9705 | 0.9065 | 0.6240 | 0.1443 | 0.0140 |
| Across-family H templates | 300 | 0.5382 | 0.2241 | 0.3696 | 0.1308 | 0.6205 |

Structural distinctness: **20/20** distinct element signatures and 20/20 distinct DOM 5-gram sets per
family (60/60 corpus); twin diff 43–50 changed lines/pair (mean line similarity ratio 0.929); sizes
15,658–20,199 B. Paraphrase lexical diversity: arcade 3 texts (unigram J 0.458), challenge 3 (0.905),
reward 4 (0.551), lively 4 (0.815); pilot-only `p00` texts separate.

### 2.6 Label/field coverage

20/20 fields present on all 400 records; identity (`scenario_id`, `stratum`, `variant_id`,
`template_id`, `twin_id`, `variant_role`), opportunity (`opportunity_class`, `opportunity_hooks`,
`opportunity_hook_count`), construct (`trigger_types`, `applicable_detector`,
`applicable_sensitivity_detector`, `required_compliant_invariant`, `allowed_constructs`),
request (`paraphrase`, `request_id`), integrity (`hashes`, `baseline_clean`, `labels_version`,
`provenance`). 0 scenario↔label identity mismatches; 0 role/class mismatches; 0 duplicate
`(variant_sha256, request_sha256)` pairs (`validation.json`; `review/05` §3).

---

## 3. Independence and coverage limits

1. **Templates share a family engine/design system.** Within a family, token Jaccard is ≈0.97 and only
   ≈1.3–2.0 % of lines differ between templates; the structural difference is in DOM composition,
   layout, HUD placement, feedback mechanism and game/planner configuration (DOM 5-gram Jaccard
   0.14–0.29). The 30 templates are therefore **10 structural variants of one implementation per
   family**, not 30 independent applications. Across families the files differ substantially (token
   Jaccard 0.54; line edit distance 0.62), but families are still only three app kinds.
2. **Only one non-game app family.** FocusFlow supplies 2 of 6 strata (160/400 scenarios). Any
   non-game inference rests on one planner design space; the two game families are memory-match and
   fruit-catch only.
3. **No human-authored variants and no external codebases.** All 60 variants are deterministic
   template-engine output; there is no human-written app, no second codebase per app kind, and no
   third-party implementation. "Structural diversity" is therefore design-composition diversity, not
   implementation diversity.
4. **Hook bundles are not isolate-able.** Each family has one H hook profile and one L profile; there
   is no hook ablation. The corpus supports a bundle-vs-core contrast only, not a claim about which
   specific affordance drives anything.
5. **Trigger-type opportunity is not separately labelled.** Every game scenario lists
   `countdown_timer, flash, mistake_penalty`; every focus scenario lists `keyframe_animation,
   scripted_animation`. The request (arcade/challenge vs reward/lively) is the de facto invitation,
   but the label set does not vary by request, so trigger-type-specific opportunity/CVR cannot be
   estimated from these labels. Trigger-type results would be detector-flag descriptions only.
6. **H/L twins differ only in the hook block** (construction proof; 43–50 lines/pair). They are not
   independent implementations, and baseline construct-key saturation means H-vs-L **exposure** is
   not comparable (H twins already carry construct keys; farmyard H 3/L 1, orchard H 2/L 0 — protocol
   §7.3).
7. **No browser/runtime test.** Single-file HTML parses, inline JS is syntax-checked, detectors are
   clean, but no headless browser rendering/execution test exists. All claims are about static source
   code.
8. **Context/palette memory is fixed per family.** Three contexts, one per family: context is
   confounded with family and cannot be varied or estimated.
9. **Paraphrase coverage is thin on the game side.** 3 corpus paraphrases per game stratum vs 4 for
   focus; the challenge set is lexically highly overlapping (unigram Jaccard 0.905), so effective
   request-wording variance is smaller in game/challenge strata. An intent error cannot bias an arm
   contrast (the request is identical across arms within a scenario), but it limits generalisability
   and matched H-vs-L interpretation (`review/05` §1.3).
10. **Two short explicit rules only.** Child safety and calm motion; no implicit policy, long policy
    documents, other app kinds or other tasks. No claim beyond the six strata/two rules.

**What the corpus supports (per `review/05` §1.2/§1.3):** H1/H2/H3 conditional CVR on the 200
high-opportunity scenarios, clustered at the 30 H-variant clusters (10/family), with detectors and
pre-treatment labels as the load-bearing inputs; sensitivity-detector tables; worst-case/ITT;
label-validation-gated exposure descriptives (subject to `review/04` PASS/CONDITIONAL/FAIL); the
Meridian answer is supported by labels plus observed `none`/`corrected` violations, not by the
exposure instrument. **What it does not support:** app-population generalisation; independent-
implementation variance; context-memory effects; trigger-type-specific CVR; hook-specific
attribution; H-vs-L exposure comparisons (invalid at any verdict); runtime/browser behaviour; any
claim about non-planner non-game apps.

---

## 4. Sensitivity and robustness options

| Option | Status | What it does / limit |
|---|---|---|
| Template/variant-cluster inference (30 H-variant clusters, 10/family; H2 family-block bootstrap; H1/H3 within-scenario paired sign-flip) | **Pre-registered** (`02-PROTOCOL-DRAFT.md` §10–§11.2; `04b` §3.2/§4.5 as corrected 2026-11-01) | The mandatory cluster-aware analysis; 30 H clusters are the available units |
| Scenario-level bootstrap for H2 | **Prohibited** (not a valid sensitivity; understates variance) | Protocol §10/§11.2; `04b` |
| Sensitivity detectors (`child_safety`, `calm_motion_broad`) | **Pre-registered** | Reused unchanged; primary decides |
| Worst-case / ITT table; per-protocol vs unusable handling | **Pre-registered** | §11.1, §12 |
| Label/human-validation gate (A1–A11, PASS/CONDITIONAL/FAIL; A7 <20 pp floor) | **Pre-registered** (`review/04` §7; protocol §7.3/§8.4) | Exposure descriptives only if PASS; fail removes exposure layer, not H1–H3 |
| Low-opportunity CVR (exact upper bounds, descriptive) | **Pre-registered descriptive** | Underpowered; no test-based claim |
| Leave-one-family-out (3 folds) | **Exploratory, descriptive** | Checks whether a contrast is carried by one app family; cannot support a confirmatory verdict and must not be used to change the frozen analysis |
| Leave-one-template-out (30 folds) | **Exploratory, descriptive** | Same purpose at template level; large CI, no verdict |
| Paraphrase-by-paraphrase breakdown (3/4 levels) | **Exploratory, descriptive** | Describes request-wording sensitivity; not powered; no arm verdict |
| Matched H-vs-L **CVR** contrast (same template/request/paraphrase) | **Exploratory, descriptive** | Opportunity class is not randomised; twin matching controls template/request wording, but the contrast is still observational/descriptive |
| Unweighted pooled CVR across strata | **Exploratory, not confirmatory** | Strata have unequal high-op counts (30 game / 40 focus) and different rules/families; equal-stratum weighting is the frozen estimator |
| Family-level (3-cluster) inference | **Not valid for inference** | Too few clusters; report only as descriptive aggregation |
| Trigger-type detector-flag rates | **Exploratory descriptive** | No trigger-specific opportunity labels; cannot estimate trigger-specific CVR |
| Engine-similarity sensitivity (e.g., cluster at family) | **Exploratory descriptive** | Documents shared-engine influence; no verdict |

Any promotion of an exploratory analysis to confirmatory status must happen **before the freeze** and
be recorded in the protocol/`04b`; no promotion after confirmatory data exist.

---

## 5. Decision: ACCEPT (with conditions)

**ACCEPT the current corpus for the primary confirmatory claims**, scoped to the 30 templates/400
scenarios/two rules, with the pre-declared cluster-aware analysis and the limitations below. **No
expansion before freeze.** The corpus is not changed in this task; this is a decision record only.

### Rationale

1. **The frozen design's coverage requirements are met and verified.** 3 families × 10 matched
   templates × 2 twins = 60 variants; 400 scenarios at 60/60/60/60/80/80; 200 high/200 low; 20
   variants/stratum; 3 game/4 focus paraphrases; all labels 20 fields; twin proofs 30/30; detectors
   clean 60/60. No cell required by the frozen design is empty (§2.3).
2. **The primary claims do not depend on app-population or independent-implementation diversity.**
   Per `review/05` §1.2, H1/H2/H3 depend on detectors + pre-treatment labels + paraphrases, not on
   the exposure instrument and not on how many independent codebases the variants represent. The
   corpus supports the intended 30 H-variant cluster inference (10/family), which is the power/design
   arithmetic already reviewed (§`review/05` §3–§4).
3. **The biggest uncovered area (shared-engine/structural-only diversity) cannot be fixed by a cheap
   patch.** It is a property of the template-engine construction; addressing it means independent
   implementations or a new app family, which changes every variant/scenario id, the labels, the
   human-validation sample and the manifest, and would require a full re-freeze — with no power gain
   unless scenarios are added. That is a scope decision, not a corpus-maintenance fix.
4. **Accepting now preserves the 4,800-run plan and the reviewed evidence chain.** Expansion would
   delay the qualification path for a limitation that affects generalisation, not the confirmatory
   conditional contrasts; the limitation is documented and can be carried as scope text and
   sensitivity analyses.
5. **Reversibility:** if a later gate fails or the Director broadens the claim, expansion remains
   possible before any freeze; after freeze it is a new study snapshot, not a corpus patch.

### Conditions attached to acceptance

| # | Condition |
|---|---|
| C1 | Confirmatory claims are explicitly scoped to these **30 templates / 400 scenarios / 2 rules / this endpoint**; no app-population, no independent-implementation and no "any AI app" claim. |
| C2 | The **cluster-aware analysis is mandatory**: H1/H3 within-scenario paired sign-flip, H2 family-block variant-cluster bootstrap over the 30 H-variant clusters per `04b` §3.2/§4.5 (corrected 2026-11-01); no scenario-level bootstrap for H2 and no unweighted pooled CVR as a confirmatory estimate. |
| C3 | **H-vs-L exposure comparisons are never reported** (baseline construct-key saturation invalidates them); H/L exposure cannot be used as a sensitivity. |
| C4 | The **label human-validation gate** (`review/04` §7: A1–A11, PASS/CONDITIONAL/FAIL) is load-bearing for the opportunity denominator. If A9 fails or labels are rejected, the protocol's fallback applies (`review/04` §8.5): output-blind re-derivation + re-freeze, or demote CVR to exploratory/unconditional descriptive; the corpus is not patched post hoc. |
| C5 | The report includes the **shared-engine/structural-only diversity limitation** and does not describe the 30 templates as independent implementations. |
| C6 | **No hook-specific attribution** (hook bundles have no ablation) and **no trigger-type-specific CVR** (labels attach the family set to every scenario); trigger-type outputs are detector-flag descriptions only. |
| C7 | **No browser/runtime claims**: all outcomes are static source-code constructs; inline JS is syntax-checked only. |
| C8 | **Paraphrase coverage limit is stated** (3 game / 4 focus; challenge set lexically highly overlapping); no claim beyond these request texts; paraphrase-intent validation is required by A11. |
| C9 | **Context/family is not separable** (one fixed context per family); no context-memory effect claim. |
| C10 | **No corpus changes after freeze**; any accepted change is a deviation (§15.3) and, if it changes labels/scenarios, requires a new frozen snapshot. |
| C11 | The confirmatory report carries the exact limitation sentences in §5.3 verbatim (or stricter). |
| C12 | The Director signs the §6 checklist; the checklist and this review are hashed into the freeze manifest. |

### 5.3 Exact limitation sentences the confirmatory report must carry

- **L1 — implementation diversity.** "The corpus contains 30 structural templates (10 per family),
  each generated by the same family template engine and design system; templates vary in DOM
  composition, layout, HUD placement, feedback mechanism and game/planner configuration, not as
  independent from-scratch applications (within-family token Jaccard ≈0.97; ≈1.3–2.0 % of lines
  differ). Results generalise to these 30 templates and 400 scenarios, not to an app population."
- **L2 — app-kind coverage.** "The corpus covers two rule texts (child safety, calm motion), two game
  families (memory match, fruit catch) and one non-game planner family (FocusFlow); it does not
  sample app kinds, request intents or user populations."
- **L3 — opportunity construct / H-vs-L exposure.** "Opportunity class is a pre-treatment structural
  construct crossed with template by matched H/L twins; it is not a behavioural measure of whether a
  model engaged the rule-relevant subsystem. H-vs-L exposure comparisons are not valid because H
  twins already carry construct keys (baseline saturation), and exposure analyses are conditional on
  the human-validation gate."
- **L4 — trigger-type coverage.** "Every game scenario lists countdown/flash/penalty as applicable and
  every focus scenario lists keyframe/scripted animation; the corpus does not provide
  trigger-type-specific opportunity labels, so no trigger-type-specific CVR is claimed."
- **L5 — static source only.** "Variants are static single-file HTML; no browser/runtime rendering
  test was performed (inline JavaScript was syntax-checked only), so all claims concern source-code
  constructs, not runtime behaviour."
- **L6 — paraphrase coverage.** "Corpus paraphrase coverage is three texts per game stratum and four
  per focus stratum; the challenge set is lexically highly overlapping (mean unigram Jaccard 0.905),
  so request-wording variance is smaller in game/challenge strata and no claim is made beyond these
  texts."
- **L7 — context and hook bundles.** "One fixed context/palette memory per family is used (context is
  confounded with family), and H opportunity hooks are applied as a family-level bundle with no
  hook ablation; the corpus does not estimate context-memory effects or individual-hook effects."

### 5.4 Conditions that would warrant expansion later

Expansion is **not** warranted now. It becomes warranted only if one or more of the following occurs
before the freeze (after freeze, a change is a new study snapshot, not a corpus patch):

- **X1 (scope):** the Director/Lead broadens the target claim to app-population or
  independent-implementation generalisation, or a reviewer/regulator requires human-authored or
  multi-codebase variants.
- **X2 (label gate):** the human label validation fails A9 or leaves >10 % of variants contested, and
  output-blind re-derivation cannot restore the class cleanly (`review/04` §8.5).
- **X3 (robustness signal):** pre-freeze exploratory leave-one-family-out/leave-one-template-out shows
  the primary contrast is carried by one template or one family (decision must be made pre-freeze;
  never used to change the frozen analysis after data).
- **X4 (design change):** a rule, endpoint or app-kind change makes the current 30 templates
  insufficient (e.g. a second non-game family is required).
- **X5 (external review):** a reviewer makes independent implementation diversity a condition of
  acceptance.

**Ordered expansion plan if triggered** (all options require a regenerated corpus, new
labels/validation, new human-validation sample, re-hashed manifest and a full re-freeze; none is
authorized now, and no paid calls are needed to generate corpus files):

1. **E1 — independent implementations (recommended first).** Replace 5 of the 10 templates per family
   with independently implemented, detector-clean, matched H/L apps (same hook profiles, family
   request/paraphrase structure). Keeps 20 variants/stratum, 400 scenarios, 4,800 executions and 30 H
   clusters, so **power is unchanged**; all variant/scenario ids, labels and manifests change and the
   human label-validation sample must be re-run. Directly addresses the biggest limitation (L1).
2. **E2 — paraphrase expansion (game 3→4).** Add the fourth game paraphrase: +80 scenarios (4 game
   strata × 20 variants × 1 paraphrase), 400→480 scenarios, planned executions 4,800→5,760 (+20 %);
   no new templates; requires corpus/labels/manifest re-freeze and paraphrase-intent (A11)
   re-validation, not a new template/panel validation. Improves wording coverage, especially
   challenge.
3. **E3 — second non-game app family.** Add one non-game family with 10 templates × 2 requests × 4
   paraphrases × 2 classes = +160 scenarios (400→560; planned executions 6,720, +40 %), new
   baseline/templates/labels/validation/panel; largest app-kind generalisation gain and largest cost.

If the Director wants expansion, do E1 first (coverage benefit per unit of re-freeze cost); add E2
only if request-wording generalisation is a primary concern; E3 only if non-game app-kind
generalisability is explicitly required.

---

## 6. Coverage checklist for the Director

- [ ] 3 families, 30 templates, 60 matched H/L variants verified (`corpus/validation.json`)
- [ ] 400 scenarios; strata 60/60/60/60/80/80; 200 high/200 low verified (recomputed)
- [ ] 20 variants/stratum; 3 game / 4 focus paraphrases; 14 corpus texts verified
- [ ] Labels 20 fields, 0 identity/role/class mismatches; 30/30 twin proofs; 60/60 detector-clean
- [ ] 30 H-variant clusters (10/family) accepted as the confirmatory inference unit
- [ ] Shared-engine/structural-only limitation L1 accepted; no independent-implementation claim
- [ ] App-kind/rule coverage limitation L2 accepted
- [ ] H-vs-L exposure prohibition and opportunity-construct limitation L3 accepted
- [ ] No trigger-type-specific CVR claim accepted (L4)
- [ ] Static-source-only/no-browser limitation L5 accepted
- [ ] Paraphrase-coverage limitation L6 accepted
- [ ] Context/family and hook-bundle limitations L7 accepted
- [ ] Label human-validation gate and fallback path (`review/04` §7/§8.5) accepted
- [ ] ACCEPT decision (no expansion) accepted; X1–X5 expansion triggers and E1–E3 plan noted
- [ ] No corpus/generator/pilot/manifest change made in this review task; `dc104b9` preserved

**Decision record:** ACCEPT — no expansion before freeze. Signed off by the Director via the checklist
above; this review is an AI-produced assessment, not human validation.

---

## Appendix — sources and recomputation

- Scenario/variant/request/paraphrase/role/hook counts: recomputed from `corpus/corpus.json` and
  `corpus/labels.json` (400 and 400 records) with stdlib Python; results match `corpus/validation.json`
  (`counts`, `hook_rules`, `twin_proofs`, `html`, `size_range_bytes`).
- Similarity, twin-diff, paraphrase-lexical and structural-distinctness metrics: `corpus/diversity.json`
  (method and limits in `08-CORPUS-DIVERSITY.md` §4–§9).
- Matched H/L structure/count verification: `review/05-DESIGN-STATISTICAL-REVIEW.md` §3
  (independently recomputed there and here).
- Claims mapping: `review/05-DESIGN-STATISTICAL-REVIEW.md` §1.2/§1.3.
- Design/template/hook declarations: `design/design-v2.json`, `design/corpus-spec-v2.md`.
- Check: `python3 scripts/study02/gen_corpus.py --check` → 68 files reproduce byte-identically; no
  corpus file changed by this task.
