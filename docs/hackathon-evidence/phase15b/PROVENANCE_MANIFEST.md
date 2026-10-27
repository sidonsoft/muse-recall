# Phase 15B — provenance manifest

**Scope:** the 32-run child-safety memory trial published on `agent/phase15b` and integrated into
`agent/muse-recall-release-candidate`.

| | |
|---|---|
| Experiment branch | `agent/phase15b` (pushed unchanged; remote tip `9f5eaa19698f6b969b53671cc7fca5fb0fafd415`) |
| Protocol commit | `d84d8a14621a129efbb54457083a45ae1f43a80d` — 2026-10-27 20:07:59 +10:00 |
| Results commit | `2857159972211ca96c78689a47d938b6abd60d56` — 2026-10-27 21:53:44 +10:00 |
| Correction commit | `9f5eaa19698f6b969b53671cc7fca5fb0fafd415` — 2026-10-27 21:55:22 +10:00 |
| Baseline SHA-256 | `5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03` |
| Machine-readable companion | [`provenance-manifest.json`](provenance-manifest.json) |
| Deviations disclosure | [`DEVIATIONS.md`](DEVIATIONS.md) |
| Evidence card | [`EVIDENCE_CARD.md`](EVIDENCE_CARD.md) |
| Recovered tooling | [`recovered/`](recovered/) |

## 1. Commit chronology

The protocol was committed **before the first of the 32 trial runs**:

| Event | Time (AEST) | Evidence |
|---|---|---|
| Protocol commit `d84d8a1` | 20:07:59 | git commit timestamp |
| First trial output `mem-03.html` | 20:10:30 | preserved file mtime |
| Last trial output `mem-12.html` | 21:52:40 | preserved file mtime |
| Results commit `2857159` | 21:53:44 | git commit timestamp |
| Correction commit `9f5eaa1` | 21:55:22 | git commit timestamp |

The ordering is strong enough to establish that the **confirmatory design and rubric text** were
fixed before the 32 trial observations. It does **not** establish a wall-clock timestamp for any
individual run, because `trial-results.json` records no timestamps.

**Chronology caveat.** The protocol header says "NOT YET RUN … Nothing in this document has been
executed." That is true of the 32-run confirmatory trial only. Eight exploratory/pilot runs had
already executed between 19:46 and 20:06, and two of them are the boundary probe the protocol
itself describes in §3. The header statement was never revised after the protocol commit. See
[`DEVIATIONS.md`](DEVIATIONS.md) Deviation H.

## 2. Baseline provenance

| | |
|---|---|
| Path | `video/probe/baseline/sky-pairs-high-cand2.html` (recovered) |
| SHA-256 | `5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03` |
| Bytes | 19,383 |
| Selection | candidate 2 of 2 at `effort: high`; the only candidate that rendered and ran without page errors |
| Candidate manifest | [`recovered/baseline/baseline-candidates-high.json`](recovered/baseline/baseline-candidates-high.json) |
| Model attribution in manifest | `muse-spark-1.3-contributor` (reported by the generation tool, not independently re-observed) |

The medium-effort candidates are also preserved in the same directory. The baseline is not a trial
run and is excluded from all counts.

## 3. Trial population

- **32 records**, 16 memory and 16 no-memory, all `succeeded`, **0 unusable**.
- Outputs are preserved at `sources/<id>.html` and every SHA-256 matches the record.
- The analysis population is exactly the `mem-*` and `nomem-*` rows in `trial-results.json`. The
  `rubric.json` files also contain eight pilot rows; those are excluded from the 32-run analysis
  (see [`DEVIATIONS.md`](DEVIATIONS.md) Deviation I).

| Run | Condition | Output SHA-256 |
|---|---|---|
| `mem-03` | memory | `4f860f831400d06737cf819d6545c53990bff4dc71631b7673d6e9509b1a9c47` |
| `mem-10` | memory | `a3773915bdcc9a3fc47d1b7d811d23dde74e525c22a7974904bb0621137bd287` |
| `nomem-02` | no-memory | `b8d1824a8221fe98bc85ac9753c680a11f97d23f0c4d263df65b0fac4fba68cb` |
| `mem-13` | memory | `2bffd1856394c58b55bff44824ee06bcb49be0ee767beea3e3c7b4a88ac0eff6` |
| `nomem-04` | no-memory | `3d3e3891008464f6a66d934aae0ed46c006c264dd8631f4c849cf8be0b0b38ad` |
| `mem-05` | memory | `33bfe8953b0023a002ec5f47b0143907dece3b93e1aebf73a6837cfd601f67a9` |
| `mem-06` | memory | `f127d045f8bf4ba19e9cefc770aa61db5f7ad9d9d8f3d3e06cd0a15f076615a7` |
| `nomem-09` | no-memory | `c08c46609eeffef1bf8a66722f632dbb2b4bf44f07a83de7817015de4dfcc5e0` |
| `nomem-06` | no-memory | `b1ace130c5865df90c497914324c07f88354287408f28e0940d0bb61850cc081` |
| `nomem-07` | no-memory | `113568138139aab999f53e6275a1cba37ef3254f98b54bc8fc170dea9785a0b9` |
| `nomem-12` | no-memory | `601731a592b2c39f666bc23e1ddf265da1b0fb4495f482385b5c1424335e4fd4` |
| `nomem-10` | no-memory | `f74860cd9281285be8f433eaa399d8994c5307a45688ad3bbfdcb9c2d4d95d58` |
| `mem-11` | memory | `be05552f3767a5ba89d807b0b0353f1ee1a37ec18ac0a7e87440de3666a46768` |
| `mem-14` | memory | `23965f052b0e639faaea3297ec8f1e340fe2d302217b4ad2da52e171d7aa5eab` |
| `nomem-16` | no-memory | `5063d495b1a6646d2b8054f8e50bd9b19b96c0e58bdc242bf062ae2003f4a818` |
| `nomem-05` | no-memory | `54b06c7e310b1233f4d3bc7e05d3fbfb7f74df21bf38233a2ad67545c4bdba2f` |
| `mem-09` | memory | `a61a90f4b836c3a0c16da0358b47f8f583cd046f1d386d20086a97b35fbbf629` |
| `mem-01` | memory | `10a7a13eb964ce1d84dc419a063ba90dd865cd9ca011a11a6f87a9cadb8ee7da` |
| `mem-16` | memory | `cfd90cfd2330290fba3e2a5cca2fe59f69374ec3285d5824780037188479d88a` |
| `mem-02` | memory | `23d29c44cc1e6e878c8b28e8263873296ecab89e2c8a426f300a276ee7dd7268` |
| `mem-04` | memory | `f7f6f2b045976a97dda002119a82c9389593821c437d8b5a21ea2ea7b7ae9ce0` |
| `mem-08` | memory | `7964abe451b422e0090edca155da328ab1dc629269168717d518b452d2cab963` |
| `nomem-15` | no-memory | `cfcef87a9d151acdd53355b6a6c3ba37ea31bd2ede1fce2d7daf6c12943c6374` |
| `nomem-01` | no-memory | `1587cba4eee2da80042042a9ff5b6529dd63396c8c1d1b5276fcce90531e558f` |
| `nomem-13` | no-memory | `e1ecde5d74ced88106b0b28614bae3bcfaa8e40d4a5494279c56338485e2633e` |
| `nomem-14` | no-memory | `e674fc2da2c36011bc715ef58341f8b9ab95c2dd6e122471291b56b1210da7ad` |
| `nomem-03` | no-memory | `119bf5b17654a490e74ff54dee65261cd39f7191ebf9f8bf984d6e867b31a93d` |
| `mem-15` | memory | `5b04caeea7c1c5a6faaf99f64c50d95ce0a1ea797b64afdf950e6409beab94d6` |
| `mem-07` | memory | `fab9ae844b5319239375741ddd3eba275e4d69c6a897e8341ed38d82cd5418ee` |
| `nomem-11` | no-memory | `ebed2501108d2473ee7063d8537543886e63b8f911b9094d96bf181f8d442406` |
| `nomem-08` | no-memory | `b6438b19b44c154c126ecc50ccd2706707f24a141470a2d43f2c91daad41c650` |
| `mem-12` | memory | `a258f1a01237c9ae64cc149636508b81053917e796de67554a4f7d93a2416b34` |

## 4. Scoring implementations

| Implementation | Status | SHA-256 / note |
|---|---|---|
| Original v1 coder | **Lost** | Never committed. Working copy `video/tools/rubric.py` was overwritten by v2 at 21:55:01. No source survives; it cannot be re-executed. |
| Original v1 output | Published | [`rubric-v1-flawed.json`](rubric-v1-flawed.json), `c54ef3f62831b83daaa15805e223b2acbd4057a82e208f1dd61f2fbf04db273b`. Byte-identical to `2857159:docs/hackathon-evidence/phase15b/rubric.json` (blob `6af013e7…`). |
| Corrected v2 coder | Published | [`rubric.py`](rubric.py), `74b2c2551c476c7c6c28fa4b5f958137575357160ca02e11e21eb5d3c8baa5ea`. Created **after unblinding**. |
| Corrected v2 output | Published | [`rubric.json`](rubric.json), `5bcb16d33ef354886595282ee5ed62bab4d749c39fa865a268727be7ef68ebdd` |
| Analysis | Published | [`analysis.json`](analysis.json), `95dc7e5bbceaba6c2cda8107a5921c5b411022bc2ea26dadc23f06a525b4ae18`; script at [`recovered/tools/analyze-15b.py`](recovered/tools/analyze-15b.py) |
| Trial runner | Recovered | [`recovered/tools/pilot-15b.mjs`](recovered/tools/pilot-15b.mjs) |

**Wording correction.** The protocol pre-registered the rubric **text**, not scoring code. The v1
implementation was an instrument built to that text; it was not itself pre-registered and is not
preserved. `RESULTS.md`'s shorthand "the pre-registered coding" must not be quoted as evidence that
the code was pre-registered or is reproducible.

## 5. Recovered tooling and baseline

Recovered on 2026-10-28 from the untracked, locally excluded `video/` directory of the original
worktree. All 72 files are byte-for-byte copies; see [`recovered/SHA256SUMS`](recovered/SHA256SUMS)
and [`recovered/recovery-manifest.json`](recovered/recovery-manifest.json).

| Recovered file | SHA-256 | Bytes | Source mtime |
|---|---|---:|---|
| `baseline/baseline-candidates-high.json` | `f8220575c8863264cb7f046ab28bfac6ef09dfc0e6450e26dd63ff3c0cb6ef1c` | 1679 | 2026-10-27T19:39:46+10:00 |
| `baseline/baseline-candidates.json` | `809cadad614a515d0616612714ca670324c228ca90ba8db7f396e2328a736493` | 1664 | 2026-10-27T19:31:10+10:00 |
| `baseline/sky-pairs-high-cand2.html` | `5385c5582dac572351c29ee0c1bba128609a49bc5ba171db03f656e065bdee03` | 19385 | 2026-10-27T19:39:41+10:00 |
| `tools/analyze-15b.py` | `c68cc34cd90700e9ae94f4b305f560918de59a3573334a78d0ba695fcf5d8312` | 3559 | 2026-10-27T20:08:54+10:00 |
| `tools/gen-baseline.mjs` | `5f75a43d9d44b1e0022a32519c6affd45907780ed473926e8ab7e35f75a1559a` | 6788 | 2026-10-27T19:35:10+10:00 |
| `tools/model-check.mjs` | `bd8100a8fae38c414f8832445fd6dd8dfea39b2ca23f6c71001d5329da3d7296` | 690 | 2026-10-27T19:15:39+10:00 |
| `tools/pilot-15b.mjs` | `08a65de40e3423e03c963f040a2dc70208261dab76aa9f7109193c97b13d4e5d` | 8939 | 2026-10-27T20:06:56+10:00 |

The recovery bundle also contains all five baseline candidates, all candidate screenshots, the
eight pilot outputs, three pilot run records and the 40 recorded diff files. Every recorded diff is
**0 bytes** (Deviation F). No recovered file was edited.

## 6. Statistical verification

Both values were recomputed independently during release integration with a separate two-tailed
Fisher exact implementation (not the published `analyze-15b.py`):

| Coding | Memory violations | No-memory violations | Two-tailed Fisher p |
|---|---:|---:|---:|
| v1 — original, flawed | 5/16 | 15/16 | `0.000635166` (≈ 6.35 × 10⁻⁴) |
| v2 — corrected, post-hoc | 0/16 | 15/16 | `5.65648 × 10⁻⁸` |

The v2 figure is **post-hoc and unblinded**. It is not a confirmatory result. The v1 figure is the
conservative one because every v1 memory-arm flag was a false positive. See
[`EVIDENCE_CARD.md`](EVIDENCE_CARD.md) for the public wording.

## 7. Known evidence limitations

- The v1 coder source is lost; only its per-run output survives.
- No per-run timestamps, observed model identifiers or retrieved-memory identifiers exist.
- All recorded diffs are empty because of the runner bug.
- No per-run human coding table survives; the human pass is narrative only.
- The corrected coder's definitions are narrow: it looks for countdowns, full-screen flashes and
  score deductions. It does not count streak resets or shortened reveal times as penalties, and
  some memory-arm outputs contain those.
- The memory arm carried the full demo decision set, not one isolated rule.
- Whether the same-key fallback activated is unknown.
- Protocol text contains stale statements ("across two rules", "8/8 vs 0/8", "draft — NOT YET
  RUN") that describe an earlier design. They are disclosed, not rewritten.

Every limitation is expanded, with planned procedure, actual procedure, available evidence,
potential effect and verifiability, in [`DEVIATIONS.md`](DEVIATIONS.md).

## 8. Verification commands

```bash
# Recovered file integrity
cd docs/hackathon-evidence/phase15b/recovered && shasum -a 256 -c SHA256SUMS

# Raw output integrity (from repository root)
cd docs/hackathon-evidence/phase15b
python3 - <<'EOF'
import json, hashlib
trial = json.load(open("trial-results.json"))["results"]
for r in trial:
    h = hashlib.sha256(open(f"sources/{r['id']}.html", "rb").read()).hexdigest()
    assert h == r["output_sha256"], r["id"]
print("32/32 output hashes match")
EOF
```

The corrected coder resolves its inputs relative to `video/`; run it from a scratch copy of that
layout, not from this directory, to reproduce `rubric.json`.
