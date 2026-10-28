# Phase 16B — Muse Spark Open (Baseten) replication

**Model:** `meta-models/muse-spark-open-1026` via Baseten inference
**Design:** 48 edits, 16 per arm, same baseline, request, memory text and
detector as Phase 16.
**Status:** complete; pre-registered in `PROTOCOL_OPEN.md`.

---

## 1. Result

| Arm | Usable | Violated | Rate |
|---|---:|---:|---:|
| No memory | 16 | **16** | 100% |
| Palette-only memory | 16 | **6** | 37.5% |
| Safety rule + palette | 16 | **0** | **0%** |

Two pre-registered contrasts:

| Contrast | Risk difference | 95% CI (Newcombe) | Two-tailed Fisher p |
|---|---:|---|---:|
| Rule vs no memory | −100 pp | −100 to −72.6 | **3.3 × 10⁻⁹** |
| Rule vs palette-only | −37.5 pp | −61.4 to −10.4 | **0.018** |

Palette-only vs no memory (descriptive): −62.5 pp, 95% CI −81.5 to −31.8,
p = 2.5 × 10⁻⁴. On this model the palette arm is not inert; it reduces
violations relative to no memory but does not eliminate them.

## 2. Two-model summary

| Arm | Muse Spark (Forge) | Muse Spark Open (Baseten) | Combined |
|---|---:|---:|---:|
| No memory | 12/12 (100%) | 16/16 (100%) | **28/28** |
| Palette-only | 12/12 (100%) | 6/16 (37.5%) | **18/28** |
| Safety rule | **0/13 (0%)** | **0/16 (0%)** | **0/29** |

Only the rule arm reaches zero violations on both models. Palette-only is
inconsistent across models, so the supported claim is about the rule, not
“memory” in general.

## 3. Execution

- 48 cells, same seed and order as Phase 16.
- Six parallel shards; 48/48 returned valid HTML.
- Prompt built with the production `buildForgePrompt` (modify branch), the
  baseline HTML appended, and a full-file return instruction.
- **Declared deviation:** Baseten chat completion, not the Forge CLI tool loop.
  Same task, baseline, request, memory text and detector; different execution
  shell.
- Temperature 0; max 20k output tokens.

## 4. Detector

Unchanged from Phase 16; locked hash in `../phase16/protocol.sha256` and
`protocol-open.sha256`. It reproduces Phase 15B at 15/16 vs 0/16 with zero
mismatches.

## 5. Limits

- One open model, one endpoint, one baseline, one request.
- Chat-completion adaptation; the tool-loop path may differ.
- Palette-only is not inert on this model; the rule contrast is smaller
  (−37.5 pp) than against no memory (−100 pp).
- Source-code mechanics only; no runtime safety claim.
- Two models, not a model family; no generalisation beyond them.

## 6. Artefacts

| Artefact | Path |
|---|---|
| Protocol | `PROTOCOL_OPEN.md` |
| Hashes | `protocol-open.sha256` |
| Runner | `run_baseten.mjs` |
| Raw records | `out/baseten-shard-*.json` |
| Outputs | `out/{no-memory,palette,rule}-*.html` |
| Analysis | `phase16b-analysis.json` |
| Results card | `card_phase16b.py` |
