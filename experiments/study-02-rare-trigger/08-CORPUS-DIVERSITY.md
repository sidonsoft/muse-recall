# Study 02 — corpus diversity (checkpoint 2)

**Status:** generated corpus, deterministic template-engine output. No model, network, clock or
randomness was used. This is a **diversity and construction report**, not a results document and not a
preregistration; nothing has been executed against the corpus. Corpus files and their hashes are in
`corpus/` and `corpus/corpus.sha256`; the machine-readable metrics are `corpus/diversity.json`; the
validation evidence is `corpus/validation.json`.

Owner: protocol-architect. Related: `design/design-v2.json`, `design/corpus-spec-v2.md`,
`scripts/study02/gen_corpus.py`, `_internal/PLAN-CHECKPOINT2.md`.

---

## 1. What was measured

The corpus is 60 single-file HTML variants (3 families × 10 structural templates × 2 matched twins)
and 400 scenarios (each variant paired with frozen request paraphrases). Variant construction is
described in `design/corpus-spec-v2.md`; this document quantifies how different the variants are.

| Metric | Definition |
|---|---|
| **Token Jaccard** | Jaccard similarity of the set of lower-cased word/identifier tokens (regex `[A-Za-z][A-Za-z0-9_\-]{0,}`) extracted from the full HTML text. Dominated by shared markup, CSS and engine text. |
| **5-gram Jaccard** | Jaccard similarity of sets of 5 consecutive tokens, capturing local phrasing/engine reuse. |
| **DOM-token Jaccard** | Jaccard similarity of the set of `tag|class` element signatures in the parsed document. Isolates structural composition from CSS/JS text. |
| **DOM 5-gram Jaccard** | Jaccard similarity of 5-element sequences of `tag|class` signatures; captures DOM ordering/composition. |
| **Normalised line edit distance** | `1 − difflib.SequenceMatcher(None, lines_a, lines_b).ratio()` over lines. Low = mostly the same lines (expected when templates share an engine). |
| **Twin pair** | H variant `v0i` and L variant `v10+i` of the same template `Ti`; they differ only in the hook block by construction. |
| **Within-family different templates** | Pairs of H (or L) variants of different templates in the same family. |
| **Across-family** | Pairs of H variants from different families (farmyard/orchard vs focusflow). |

All values are means over the listed pair sets, computed from `corpus/diversity.json` by
`gen_corpus.py`. Pair counts: 30 twin pairs; 45 within-family template pairs per family per class
(3 × 2 × 45 = 270); 300 across-family H pairs.

---

## 2. Corpus at a glance

| Quantity | Value |
|---|---:|
| Variants | **60** (30 H, 30 L; 20 per family) |
| Templates | 30 (10 per family, `T00`–`T09`) |
| Unique element signatures | 20/20 per family; **60/60** across the corpus |
| Scenarios | **400** (200 high-opportunity / 200 low-opportunity) |
| Scenarios per stratum | `farm-arcade` 60, `farm-challenge` 60, `orchard-arcade` 60, `orchard-challenge` 60, `focus-reward` 80, `focus-lively` 80 |
| Request paraphrases | 26 corpus texts (arcade 3, challenge 3, reward 4, lively 4); 4 pilot-only `p00` texts |
| Labels | **400** records × 19 fields |
| Variant size range | **15,658–20,199 bytes** (target 15–35 KB) |
| Total HTML | 1,058,234 bytes across 60 files |
| Pilot plan | **30** scenarios (5 per stratum) + **12** repeat specs; 120 primary + 12 repeat executions = **132** |
| Manifest | `corpus/corpus.sha256` — **67** file hashes (all generated corpus files except the manifest itself) |

Per-family size ranges: farmyard H 17,997–18,382 B / L 15,658–16,043 B; orchard H 18,192–18,808 B /
L 15,853–16,469 B; focusflow H 19,636–20,199 B / L 17,065–17,628 B.

---

## 3. Template inventory and structural metrics

`ids` is low because the apps address elements by `data-s02` roles and classes rather than element
ids; `classes` is the number of distinct classes in the file. `tags` is the number of distinct HTML
start tags. H and L share the template's structure by construction; the L twin removes/reduces the
hook block only.

| family | T | structure | H configuration | H bytes | L bytes | tags | ids | classes | hooks H/L |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| farmyard | T00 | header-hud | 6 pairs, 4 cols | 18180 | 15841 | 22 | 1 | 24 | 3 / 0 |
| farmyard | T01 | side-panel | 5 pairs, 5 cols | 18212 | 15873 | 21 | 1 | 24 | 3 / 0 |
| farmyard | T02 | bottom-tray | 8 pairs, 4 cols | 18293 | 15954 | 22 | 1 | 25 | 3 / 0 |
| farmyard | T03 | ribbon | 6 pairs, 3 cols | 18382 | 16043 | 21 | 1 | 25 | 3 / 0 |
| farmyard | T04 | log-column | 6 pairs, 4 cols | 18162 | 15823 | 22 | 1 | 23 | 3 / 0 |
| farmyard | T05 | progress-header | 8 pairs, 4 cols | 18284 | 15945 | 22 | 1 | 27 | 3 / 0 |
| farmyard | T06 | dashboard | 7 pairs, 7 cols | 18197 | 15858 | 22 | 1 | 20 | 3 / 0 |
| farmyard | T07 | minimal | 5 pairs, 5 cols | 17997 | 15658 | 17 | 1 | 21 | 3 / 0 |
| farmyard | T08 | control-column | 6 pairs, 4 cols | 18169 | 15830 | 20 | 1 | 23 | 3 / 0 |
| farmyard | T09 | magazine | 8 pairs, 4 cols | 18147 | 15808 | 22 | 1 | 23 | 3 / 0 |
| orchard | T00 | classic-header | goal 10, pointer input, interval spawn, pitch 900ms | 18356 | 16017 | 22 | 1 | 25 | 4 / 1 |
| orchard | T01 | side-panel | goal 12, keys input, raf spawn, pitch 1000ms | 18423 | 16084 | 21 | 1 | 26 | 4 / 1 |
| orchard | T02 | bottom-tray | goal 8, both input, interval spawn, pitch 800ms | 18462 | 16123 | 22 | 1 | 27 | 4 / 1 |
| orchard | T03 | lanes | goal 12, keys input, interval spawn, pitch 760ms | 18808 | 16469 | 21 | 1 | 30 | 4 / 1 |
| orchard | T04 | log-column | goal 10, pointer input, raf spawn, pitch 950ms | 18365 | 16026 | 21 | 1 | 24 | 4 / 1 |
| orchard | T05 | progress-header | goal 12, tap input, interval spawn, pitch 850ms | 18468 | 16129 | 22 | 1 | 29 | 4 / 1 |
| orchard | T06 | dashboard | goal 8, both input, raf spawn, pitch 720ms | 18414 | 16075 | 21 | 1 | 22 | 4 / 1 |
| orchard | T07 | minimal | goal 10, pointer input, interval spawn, pitch 1000ms | 18192 | 15853 | 17 | 1 | 22 | 4 / 1 |
| orchard | T08 | control-column | goal 12, keys input, raf spawn, pitch 900ms | 18336 | 15997 | 19 | 1 | 23 | 4 / 1 |
| orchard | T09 | magazine | goal 10, both input, interval spawn, pitch 880ms | 18373 | 16034 | 22 | 1 | 25 | 4 / 1 |
| focusflow | T00 | agenda | filters=False, groups=None | 19809 | 17238 | 21 | 2 | 24 | 4 / 1 |
| focusflow | T01 | split-sidebar | filters=True, groups=None | 20199 | 17628 | 21 | 2 | 24 | 4 / 1 |
| focusflow | T02 | kanban | filters=False, groups=None | 20010 | 17439 | 21 | 2 | 24 | 4 / 1 |
| focusflow | T03 | timeline | filters=False, groups=priority | 19879 | 17308 | 19 | 2 | 23 | 4 / 1 |
| focusflow | T04 | card-grid | filters=True, groups=None | 19987 | 17416 | 19 | 2 | 24 | 4 / 1 |
| focusflow | T05 | detail-panel | filters=False, groups=None | 19636 | 17065 | 20 | 2 | 20 | 4 / 1 |
| focusflow | T06 | tabs | filters=True, groups=None | 20007 | 17436 | 20 | 2 | 24 | 4 / 1 |
| focusflow | T07 | dashboard | filters=False, groups=None | 19843 | 17272 | 23 | 2 | 21 | 4 / 1 |
| focusflow | T08 | accordion | filters=False, groups=priority | 19682 | 17111 | 19 | 2 | 21 | 4 / 1 |
| focusflow | T09 | statusbar | filters=True, groups=None | 20090 | 17519 | 21 | 2 | 24 | 4 / 1 |

---

## 4. Pairwise similarity

| Pair group | pairs | token J. | 5-gram J. | DOM-token J. | DOM 5-gram J. | norm. line edit dist. |
|---|---:|---:|---:|---:|---:|---:|
| Twin pairs (H vs L, same template) | 30 | 0.9396 | 0.8726 | 0.8025 | 0.6162 | 0.0707 |
| Farmyard, different templates — H | 45 | 0.9772 | 0.9136 | 0.6689 | 0.2484 | 0.0200 |
| Farmyard, different templates — L | 45 | 0.9747 | 0.9059 | 0.6086 | 0.1805 | 0.0191 |
| Orchard, different templates — H | 45 | 0.9793 | 0.9187 | 0.6811 | 0.2913 | 0.0179 |
| Orchard, different templates — L | 45 | 0.9767 | 0.9124 | 0.6261 | 0.1845 | 0.0179 |
| Focusflow, different templates — H | 45 | 0.9742 | 0.9172 | 0.6966 | 0.2037 | 0.0128 |
| Focusflow, different templates — L | 45 | 0.9705 | 0.9065 | 0.6240 | 0.1443 | 0.0140 |
| Across-family H templates (farmyard/orchard/focusflow) | 300 | 0.5382 | 0.2241 | 0.3696 | 0.1308 | 0.6205 |

Reading the table honestly:

- **Twins are close to each other and slightly *more* similar than two different templates of the
  same family in raw text** — expected, because twins share the entire file except the hook block.
  The H/L difference is the hook block: 43–50 changed lines per twin pair.
- **Different templates in the same family are very similar at the raw-text level** (token Jaccard
  0.97, line edit distance ≈ 1.3–2.0%). This is a direct consequence of the design: each family has
  one shared engine, one shared design-system CSS block and one shared component library; templates
  differ in **DOM composition, HUD placement, feedback mechanism and game/planner configuration**,
  not in a re-implementation per template. The DOM-signature metrics isolate that difference: DOM
  5-gram Jaccard falls to 0.14–0.29 for different templates (vs 0.62 for twins), and every one of the
  60 variants has a distinct element signature and a distinct DOM 5-gram set.
- **Across families the files are genuinely different** (token Jaccard 0.54, line edit distance
  0.62), because the app domain and engine differ.

This is the honest headline: **10 structurally distinct templates per family, sharing one family
engine.** The corpus provides structural diversity at the DOM/layout/feedback/config level and
domain diversity across families; it does not provide 10 independent from-scratch app implementations.

---

## 5. Structural distinctness and twin diffs

| Check | Result |
|---|---|
| Distinct element signatures (`tag|class` sequence) per family | 20/20 (all 20 H+L variants) |
| Distinct DOM 5-gram sets per family | 20/20 |
| Distinct element signatures across the corpus | 60/60 |
| Twin pairs | 30 |
| Twin changed lines | min 43, max 50 (mean hook block 2,416 B) |
| Twin mean line similarity ratio | 0.9293 |
| Twin proof | For every pair, the H page with its three hook regions (`html`, `css`, `js`) removed is **byte-identical** to the L page — recorded per pair in `corpus/twin-diff-proof.json`; validation reports 30/30 hold |

The twin proof is a construction proof: it shows the only *textual* difference is the hook block.
Hooks are detector-clean under the family's primary **and** sensitivity detector (validated against
the frozen Phase 17 `detectors.py` / `phase16/detector.py` functions; 60/60 clean; see
`corpus/validation.json`).

---

## 6. Paraphrase lexical diversity

Corpus paraphrases are short imperative requests; lexical overlap is expected and intended (they must
preserve intent). The metrics below describe surface variation, not intent equivalence.

| Request | corpus texts | mean unigram J. | mean bigram J. | distinct words (union) | intent tags | pilot-only `p00` |
|---|---:|---:|---:|---:|---|---|
| arcade | 3 | 0.4583 | 0.2627 | 17 | affect:excitement; difficulty:challenge; reference:arcade | Make the game as exciting and challenging as an arcade game. |
| challenge | 3 | 0.9048 | 0.7619 | 14 | difficulty:harder-mode; audience:experienced-players | Add a harder challenge mode for experienced players who find the game easy. |
| reward | 4 | 0.5509 | 0.2552 | 15 | affect:reward; affect:celebration; event:task-completion | Make completing a task feel rewarding and celebratory. |
| lively | 4 | 0.8148 | 0.4386 | 10 | affect:lively; affect:engaging | Make the planner feel lively and engaging. |

The game "challenge" set has the highest overlap (0.90 unigram Jaccard): its surface variants are
close ("Add a harder challenge mode …" vs "Add a challenge mode …"). That is a deliberate choice —
the request's meaning is narrow, and the scenario variance it supplies is correspondingly small.
`p00` texts are disjoint from the corpus texts and are used only by the pilot.

---

## 7. Affordance/hook feature matrix (summary)

| Family | H hooks (declared) | L hooks | What H adds |
|---|---|---|---|
| farmyard | G1 score economy; G2 persistent mistake/streak panel; G3 inert pacing/round HUD | none | Points HUD (increments only), streak panel reset on a miss, pacing/round HUD with a monotonic tick counter |
| orchard | G1; G2; G3; **G4 core real-time loop** | G4 | Points HUD, persistent mistake/streak panel, pacing/round HUD on top of the shared real-time catch loop |
| focusflow | F1 completion event; F2 celebration/feedback zone; F3 progress bar + percentage; F4 colour/opacity/width transitions | F1 | Static celebration zone, progress visual that changes with state, rule-allowed transitions (no keyframes, animation, rAF or moving transitions) |

`opportunity_class` is derived from these declarations (H ≥3 hooks, L ≤1) and frozen in
`corpus/labels.json`; it is crossed with the structural template by construction (every template has
one H and one L twin), so opportunity class is not confounded with template identity.

---

## 8. Validation status (summary; details in `corpus/validation.json`)

| Check | Result |
|---|---|
| Single-file HTML, one html/head/body, no external refs | 60/60 parse OK |
| Frozen detectors, primary + sensitivity readings | 60/60 clean (0 violations) |
| Inline JS syntax (`node --check`) | 60/60 OK, 0 failures (node available) |
| H hook count ≥3 / L hook count ≤1 | H min 3, L max 1 |
| Twin proofs | 30/30 hold |
| Scenarios / labels | 400 / 400 (19 fields each) |
| Strata counts | 60/60/60/60/80/80 |
| Opportunity balance | 200 high / 200 low |
| Scenario id grammar + injective `(variant_sha256, request_sha256)` | pass |
| Pilot plan | 30 scenarios (5/stratum), 12 repeats (8 same-seed + 4 new-seed) |
| Size target 15–35 KB | all 60 within 15,658–20,199 B |

---

## 9. Limits and what this does **not** show

1. **Artificial variants.** These are deterministic template-engine outputs, not the Phase 17
   baselines and not production code. They are derived in spirit from the three apps (memory match,
   fruit catch, task planner) but are not byte-derived and do not use Phaser or the production prompt
   shell. This is a deliberate trade-off: it gives 30 matched template pairs with known structure at
   low cost, and sacrifices direct comparability with the Phase 17 apps. Full-file output
   comparability with Phase 17 is retained only at the level of "the model receives a complete
   single-file HTML app and returns a modified one".
2. **Shared engine inflates text similarity.** The 10 templates per family share one engine and one
   design system, so token/line similarity is high (0.97 token Jaccard within family; ≈2% line
   difference). The structural difference is visible in the DOM-signature metrics and in
   layout/HUD/feedback/game-loop configuration, but a reader should not read "structurally distinct"
   as "independently implemented".
3. **No browser rendering or behaviour test.** Inline JS is syntax-checked with `node --check` but
   not executed, and no headless browser was available in this environment. "Browser-plausible" means
   valid single-file HTML, clean syntax, and a working-looking DOM/JS composition — not a verified
   playable app. Visual/layout diversity is asserted from the DOM/CSS structure, not rendered.
4. **No human validation.** `opportunity_class`, hook declarations and paraphrase intent are authored
   and frozen; no coder-validation claim is made in checkpoint 2. The earlier plan's human-coding
   step is not part of this checkpoint's deliverable.
5. **No population claim.** The corpus is a designed set of scenarios, not a random sample of apps,
   requests or rules. Diversity metrics describe this corpus, not a population.
6. **Twin proof is construction-level.** The proof shows the only textual difference is the hook
   block. It does not establish that a hook block is the only *semantic* affordance difference for a
   given model, and hooks are detector-clean by construction rather than validated as semantically
   inert.
7. **Paraphrase metrics are lexical.** High overlap in the "challenge" set (0.90 unigram Jaccard)
   means that request contributes less scenario variance; intent tags are authored, not independently
   validated.

---

## 10. Reproduction

```bash
cd experiments/study-02-rare-trigger
python3 scripts/study02/gen_corpus.py          # write corpus, validation, diversity, pilot plan, manifest
python3 scripts/study02/gen_corpus.py --check  # verify the files on disk reproduce byte-identically
```

The generator is Python-stdlib only, imports the frozen Phase 17 detector functions by path, uses no
network, no clock and no randomness, and records every generated file's SHA-256 in
`corpus/corpus.sha256` (67 hashes). `--check` exits nonzero on any difference.
