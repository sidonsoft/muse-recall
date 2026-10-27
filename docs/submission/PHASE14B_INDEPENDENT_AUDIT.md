# Phase 14B — Independent submission, evidence and demo audit

**Auditor:** Strata (local worker, independent documentation review)
**Date:** 2026-10-27
**Scope:** Accuracy of the Phase 13 submission narrative, evidence integrity, demo plan, security
presentation, official-requirements status. Read-only audit: production code untouched, the five
Phase 13 submission documents untouched, no branches merged. All claims below were re-verified
today against files read with `git show`/`git grep` (no checkouts of other branches).

**Verdict summary: CONDITIONAL GO for the submission package** — see §10 for the conditions.

---

## 1. Verified baselines

| Item | Required | Verified value | Status |
| --- | --- | --- | --- |
| Documentation baseline | `agent/strata-phase13-submission` @ `84e6a8c` | `84e6a8ce028b9d5e3e8bd5c04abbf7f3824ccc1a` | ✅ exact |
| Technical release candidate | `agent/phase12e-release-hardening` @ `156c65c9a55833e00f6764f4fee20d93eec17e49` | same SHA (`git rev-parse`) | ✅ exact |
| This audit branch | based on `84e6a8c` | `agent/strata-phase14b-submission-audit` created at `84e6a8c` | ✅ |

Release-candidate lineage (read-only, not merged): `156c65c` sits on top of the Phase 12C tip
`260d9ce`, then the 12D audit (`a92de2f`, `e4a6786`) and the 12E hardening (`9054081`, `156c65c`).
The 12E branch is the accepted technical RC: it changes the Decision Guard engine
(`GUARD_VERSION = '1.2.0'` in `packages/decision-guard/src/index.ts:28`), the guard UI panel, the
shared advisory schema, and adds evidence under `docs/hackathon-evidence/phase12e/`.

Cross-checked: the seeded demo baseline `demo/forge-baseline/index.html` hashes to
`79c9d67a654e39a6ec78807a6bc7d1875e371643aa8dc7f3f8fbfc8de9ba9e41` on both `260d9ce` and `156c65c`
— identical, so the "sha `79c9d67a…9ba9e41`" claim in the runbook/evidence map is exact.

All 14 commit SHAs cited in `EVIDENCE_MAP.md` resolve (verified with `git rev-parse --verify`):
`0ce6444 dece8c1 90dfac9 1b16417 687bbe0 3b4c74c 398418a 740292f 8f2d509 260d9ce 0ea7c76 4680ad3
d35fa9d a806145`. `79c9d67a…` is a file sha, not a commit — correct as cited.

---

## 2. Submission narrative audit — claim corrections

Nothing below has been edited in the five documents; each row is a recommendation the cloud agent
owns. Line numbers refer to the Phase 13 baseline `84e6a8c`.

### 2a. Stale references (Phase 12C → Phase 12E)

The Phase 13 documents were written when 12C (`260d9ce`) was the accepted branch. The accepted RC
is now 12E (`156c65c`). Every outdated reference identified:

| # | File | Line / section | Existing claim | Problem | Suggested replacement |
| --- | --- | --- | --- | --- | --- |
| S1 | `DEMO_SCRIPT_3MIN.md` | L8 | "Recording base: branch `agent/phase12c-guard-advisory`" | RC is `agent/phase12e-release-hardening` (`156c65c`); 12E changes guard UI labels and evidence | "Recording base: branch `agent/phase12e-release-hardening` (RC tip — confirm the post-fix tip with the director before recording)" |
| S2 | `DEMO_SCRIPT_3MIN.md` | L96–98 | guard captures "in the Phase 12C evidence" | 12E evidence at `docs/hackathon-evidence/phase12e/screenshots/` contains the current-labelled captures (same filenames + assessment chips) | cite the `phase12e` evidence paths; keep 12C paths as history |
| S3 | `DEMO_SCRIPT_3MIN.md` | L113–114 | fallback "recorded `ui-approved-with-findings.png`" (implies 12C copy) | same-named 12E capture exists and reflects the current UI | cite the 12E capture |
| S4 | `DEMO_RUNBOOK.md` | L3–5 | "taken from … the Phase 12C verification appendix … on the same branch" | appendix is now the 12E verification record | reference `docs/PHASE12E_RELEASE_HARDENING.md` §9 / `docs/hackathon-evidence/phase12e/verification.json` |
| S5 | `DEMO_RUNBOOK.md` | L9–12 (§0) | "Run the demo from **`agent/phase12c-guard-advisory` (tip `260d9ce`)** — the accepted Phase 12C branch" | 12E is the accepted RC and contains everything 12C had plus hardening | "Run the demo from the 12E release candidate (`agent/phase12e-release-hardening`; pin the director-confirmed tip)" |
| S6 | `DEMO_RUNBOOK.md` | L17 | `git checkout agent/phase12c-guard-advisory` | as above | `git checkout agent/phase12e-release-hardening` |
| S7 | `DEMO_RUNBOOK.md` | L133–137 | packaged-evidence list: 12A / 12C / 11A only | omits `docs/hackathon-evidence/phase12e/` (accuracy JSONs, screenshots, verification record) | add the phase12e entry |
| S8 | `DEMO_RUNBOOK.md` | L146 (§10) | "`pnpm verify` green (expect **391 passed / 3 skipped**)" | 12E `verification.json`: **457 passed / 3 skipped** at `156c65c`; will change again when the rollback fix lands | quote the count "at the pinned RC tip" and update to the cloud agent's verified number |
| S9 | `EVIDENCE_MAP.md` | L20–28 (branch table) | no row for Phase 12E | RC missing from the reference table | add: 12E hardening + RC — `agent/phase12e-release-hardening` — `9054081` (code/evidence), `156c65c` (report/tip) |
| S10 | `EVIDENCE_MAP.md` | L150–152 (C10) | test counts only 391@`260d9ce` / 388@`4680ad3` | 457/3 at `156c65c` is the RC number | add the 12E number, and re-pin all counts to the final RC tip after the rollback fix |
| S11 | `SUBMISSION_COPY.md` | L99–100 (stack) | "Vitest (**391 tests passing** at the demo branch)" | stale if the demo/RC branch is 12E | "457 tests passing at the release candidate" (re-pin after the fix) |

Verified still-accurate environment claims (re-checked on `156c65c`, so S4–S6 only change the
branch name, not the values): `PORT` default 8787, `MODEL_PROVIDER=muse-cli`, `MUSE_BIN=muse`,
`FORGE_MAX_RUNTIME_MS` 600 s, `FORGE_MAX_CALLS` 25 (`apps/server/src/config.ts`), web `strictPort:
true` (`apps/web/vite.config.ts:20`), `tests/fixtures/fake-muse.mjs` present, and scripts
`demo:seed`, `verify:runtime`, `verify:forge`, `eval:guard`, `evidence:guard-ui` all present on 12E.

### 2b. Rollback claims (P1 — ancestry defect open until cloud verifies)

The defect, as characterized from the code at `156c65c`: `workspace.ts` promotion records
`base_version` per version, but `rollback()` (L297–320) simply restores `versions[index - 1]` — the
previous **entry in the list**, not the recorded parent. For a single approve-then-undo cycle
(v1→v2, undo→v1) this is correct and is exactly what the 12E §6 test covers ("Approve v1, approve
v2 with advisory findings, rollback returns v1") and what `verify:forge` exercises. But after
undo → approve a new version (v3 based on v1) → undo, the list walk restores **v2** (a stale
branch), not v1 — wrong parent. Until the cloud fix + a multi-step ancestry test land, these claims
must stay scoped:

| # | File | Line | Existing claim | Why it overreaches | Suggested replacement |
| --- | --- | --- | --- | --- | --- |
| R1 | `PROJECT_STORY.md` | L30 | "Every approved change becomes a version you can roll back." | untested generalization; P1 shows multi-step undo can restore the wrong parent | "Every approved change becomes an immutable version; you can roll the current version back one step (audit trail preserved)." |
| R2 | `PROJECT_STORY.md` | L114–115 | "every version can be rolled back" | implies rollback to an arbitrary version from any state | "rollback restores the previous version and the whole trail stays inspectable" |
| R3 | `SUBMISSION_COPY.md` | L25 (100-word) | "rolling back **any** version" | same as R1/R2 | "rolling back the current version" |
| R4 | `DEMO_SCRIPT_3MIN.md` | L110–111 | "Verified behaviour: approval succeeds with findings present; rollback restores the base." | true only for the single-step path demonstrated | "Verified behaviour (single approve → single undo): approval succeeds with findings present; rollback restores the base. Multi-step ancestry hardening is in progress." — or drop the second clause from the script and state the demo path only |
| R5 | `EVIDENCE_MAP.md` | L137–146 (C9) | title "every change is versioned and rollable"; "Confidence: high" | high is justified for the single-step and the 12E test path; the multi-step case is now a known open P1 | keep "versioned", scope "rollable" to one step from current; add: multi-step ancestry under repair; re-grade after cloud verification |

The demo itself (script segment 2:40–2:55) performs exactly one approve → one rollback, which is
the verified path; the on-camera flow is safe as scripted. Keep it that way until verified.

### 2c. Runtime-verification overclaims (P1 — see §5 for exact wording)

| # | File | Line | Existing claim | Why inaccurate/unclear |
| --- | --- | --- | --- | --- |
| T1 | `PROJECT_STORY.md` | L28–29 | "the app **runs the game** headless in Chrome" | it loads the staged HTML and checks boot health; it does not run/play the game |
| T2 | `PROJECT_STORY.md` | L94–96 | "verifies the canvas **actually renders**" | check is `page.locator('canvas').count() > 0` — presence of a canvas element, not rendered pixels |
| T3 | `DEMO_SCRIPT_3MIN.md` | L75–76 | "the app has *played the game itself* … and **confirms the game renders**" | never plays; presence + error scan only |
| T4 | `SUBMISSION_COPY.md` | L23 (100-word) | "the app **plays the game** headless in Chrome" | "plays" implies gameplay interaction |
| T5 | `SUBMISSION_COPY.md` | L42–43 | "runs the modified game headless in real Chrome and rejects page errors, so you review changes that actually **execute**" | borderline; "execute" is defensible for boot only — should say so |
| T6 | `SUBMISSION_COPY.md` | L128 (demonstrated list) | "runtime verification" (undefined) | fine as a label once defined as boot-level in limitations |

`EVIDENCE_MAP.md` C5 (L79–88) is the model of correct wording: it says "checks page errors + canvas
presence, not gameplay semantics" — keep C5 as-is and align the other four documents to it.

### 2d. Decision Guard accuracy figures vs the shipped engine (v1.2.0)

`EVIDENCE_MAP.md` C7 (L113–117) offers headline numbers from v1.0.0/v1.1.0, but the RC engine is
`GUARD_VERSION = 1.2.0`. Recomputed from the 12E report §8.1/§8.2 (corpus unchanged):

- v1.0.0: 33 blocking verdicts, 13 wrong ≈ 2 in 5 (doc's claim ✅ still right for v1.0.0).
- v1.1.0: 27 blocking verdicts, 7 wrong ≈ 1 in 4 (doc's "1 in 4–6" ✅ for v1.1.0).
- **v1.2.0 (shipped): 27 blocking verdicts, 6 wrong ≈ 1 in 4.5**; 14 abstentions.

Two C7 sub-claims are now stale for the shipped engine:

| # | File | Line | Existing claim | Correction for v1.2.0 |
| --- | --- | --- | --- | --- |
| G1 | `EVIDENCE_MAP.md` | L116–117 | "hex-palette findings are the most reliable signal" | per v1.2.0 table, **countdown** precision is 1.000 (0 FP), palette 0.833 (1 FP); palette is no longer the top-precision family. Say "the targeted palette-equivalence and countdown checks are the strongest signals" or quote the per-rule table |
| G2 | `EVIDENCE_MAP.md` | L117 | "`0x`/`#` hex notation are known blind spots" | 12E fixed 6-digit `#`/`0x` equivalence (D12: abstain → TP). Remaining palette FNs: 8-digit RGBA (D07), multi-supersession (D14). Tween-flash FNs (B05/B08/B09) remain |

Suggested C7 headline replacement (all figures from `docs/hackathon-evidence/phase12e/accuracy-v1.2.0-phase12e.json`, report §8):
"under the shipped v1.2.0 engine, roughly 1 in 4–5 blocking verdicts would have been wrong on the
adversarial corpus, with 15/72 cases abstained; countdown and targeted palette checks are the most
precise families; flash via tween/animation and renamed counters remain blind spots."

Note: `PROJECT_STORY.md` L101–104 ("five pattern rule families: countdown mechanics, flashing
effects, mistake penalties, superseded palette colours, colour-only cues") ✅ still exactly matches
v1.2.0 (`SUPPORTED_CHECKS` in `DecisionGuardAdvisory.tsx`); no change needed.

### 2e. Claims verified as accurate (no change needed)

- Latency + trial stats (script L3–6; copy L40–41; map C3/C4): recomputed from `trials.json` —
  n=5, mean 55.7 s, median 48.1 s, range 34.1–104.2 s; 995,828 input / 8,180 output tokens over 34
  calls; diff 1.2–10.1 % (min 1.163, max 10.078, rounds to cited); all five approved, rolled back,
  `validation.ok` true, `page_errors: []`, `verified_preview: true`; failover fired on all five ✅.
- Retrieval budget "at most 6 memories / 3,000 characters per job" (`PROJECT_STORY.md` L56–57):
  `apps/server/src/forge/runner.ts:160` — `{ max_memories: 6, max_characters: 3_000 }` ✅.
- CAS promotion / stale-base refusal: `workspace.ts` promote throws `version_conflict` unless
  `base_version` still current ✅ (`PROJECT_STORY.md` L88–90 accurate).
- Staged-source safety (size/symlink/syntax guards, `readContained` symlink rejection) ✅.
- Guard advisory-only, never read by approve/promote/validateStaged (`PROJECT_STORY.md` L106–109,
  `SUBMISSION_COPY.md` L104–106): confirmed in 12E §6 and integration tests ✅.
- Guard "two high-severity findings citing the child-safety decision" (`DEMO_RUNBOOK.md` L97–98):
  12C `evaluation.json` case A — findings = 2, rules `countdown-mechanics` + `mistake-penalty`,
  both `severity: high`, same `decision_id` ✅.
- "Nothing sticks without my approval" (`DEMO_SCRIPT` L107) — staging never promoted on runtime
  failure (422 path tested) ✅.
- Minor precision: `PROJECT_STORY.md` L57–59 says decision memories are "force-included … so a
  constraint still reaches the prompt" — retrieval.ts reserves only **two pinned slots**
  (PINNED_TYPES `constraint`/`goal`); beyond two, constraints compete on score. `SUBMISSION_COPY`
  L112–113 already states this honestly. Suggested tweak: "up to two constraints are pinned ahead
  of keyword relevance; the rest compete on score within the budget."

### 2f. Submission-form word budgets (copy hygiene)

- "100-word description" (L19–25): actual **103 words** — trim to ≤100 before pasting into any
  field that enforces a cap (cap itself unresolved, §8).
- "300-word description" (L29–56): actual **307 words** — same caution.

---

## 3. Recommended three-minute timeline (revised)

### 3a. Assessment of the current script (`DEMO_SCRIPT_3MIN.md`)

- Narration word count (all eight segments, counted programmatically): **381 spoken words** ≈
  143–152 s of speech at 150–160 wpm, leaving only ≈28–37 s for all non-speech screen action
  (generation wait ≥10 s, typing, approve/rollback clicks, card holds). Margin is thin to negative.
- Requirement gaps against the brief:
  1. **Game within 20 s** — violated: game preview appears at 0:20–0:45.
  2. Guard segment is **25 s** (brief: ≈15 s).
  3. The script approves "with advisory findings on screen" (L108) — if the on-screen job is the
     labelled mutation, this approves a deliberately violating mutation on camera (brief: avoid).
  4. Recording base 12C is stale (§2a S1).

### 3b. Recommended timeline (target 3:00; ≈345 spoken words ≈ 138 s @150 wpm)

| Slot | Dur | Segment | On screen | Spoken w | Speech s |
| --- | --- | --- | --- | --- | --- |
| 0:00–0:20 | 20 | **Cold open: the game itself.** "This game was built by Meta Muse — and it keeps being built. The problem with AI creative tools is what happens when you close the tab: the model forgets your palette, your rules, your review." | live playable preview, v1 badge | 45 | ~18 |
| 0:20–0:40 | 20 | **The memory fix, shown.** Memory inspector: child-safety decision + rationale; sunset→ocean correction with sunset marked superseded. 8 s flash of the A/C accent screenshots as proof teaser. | inspector, correction history, split screenshot A `0xFF7E5F` vs C `0x4EA8DE` | 48 | ~19 |
| 0:40–1:25 | 45 | **Live modify.** Type "more exciting, honoring our design decisions". Job starts; retrieved-decisions list + `prompt_sha256` visible **before 1:00**. Play pre-recorded run at real speed (≥12 s visible). | Forge submit → job → recorded generation | 50 | ~20 (+≥12 s real wait) |
| 1:25–1:50 | 25 | **Evidence, honestly scoped.** Diff (few lines, "single-digit % of the file"). "The app *boots* the game in real headless Chrome — a page error fails the job — and checks the canvas is created. It checks the game starts; it does not play it for you — that's my job." | diff panel, structural + runtime results, rendered screenshot | 55 | ~22 |
| 1:50–2:05 | 15 | **Decision Guard (≈15 s).** Labelled-mutation cutaway (banner states it is a test mutation): two findings cite the child-safety decision. "Advisory only, and it reads source patterns, not behaviour — we audited its accuracy, so the call stays human." | recorded guard panel with assessment chip | 36 | ~14 |
| 2:05–2:30 | 25 | **Memory influence, A/C.** Same request, same model, one variable: memory. A (sunset memory) → sunset button rendered; C (corrected to ocean) → ocean button, sunset hex absent from source; B (no memory) → neither. | A/C rendered screenshots, memory blocks, prompt hashes | 46 | ~18 (+~7 s holds) |
| 2:30–2:50 | 20 | **Approve + roll back — the real run.** Approve the live clean run (not the mutation) → v2; one-click rollback → v1. "Nothing becomes current without my OK — and one step back is always there." | approve click, v2 list, rollback click, v1 | 40 | ~16 (+~5 s clicks) |
| 2:50–3:00 | 10 | **Close.** Product message + repo/URL card. | title card | 25 | ~10 |

Totals: speech ≈138 s; non-speech screen action (real wait 12–20 s, typing ~5 s, clicks ~6 s,
screenshot holds ~7 s) ≈30–38 s; projected total ≈168–176 s → **margin ≈4–12 s** inside 3:00. If
more slack is wanted, trim the 1:25 diff narration by ~15 words.

Brief compliance: game by 0:00–0:20 ✅; memory problem by ~0:15 ✅; memory influence anchored before
1:00 (superseded/corrected decision pair at 0:20–0:40 + retrieved decisions + prompt hash on the
live job by ~0:55; full A/C causal comparison at 2:05) ✅; guard ≈15 s ✅; authentic approval +
rollback on the *clean* run, mutation kept as a labelled cutaway ✅; product message close ✅.

---

## 4. Memory-influence evidence assessment (Phase 12A A/B/C)

Independently re-verified today from `agent/phase12-memory-validation`
(`docs/PHASE12_MEMORY_VALIDATION.md` @`687bbe0`/tip `90dfac9`;
`docs/hackathon-evidence/phase12/pilot.json` + `{A,B,C}-v2.html` + 6 screenshots).

| Check | Result |
| --- | --- |
| Same baseline | ✅ `baseline_sha256` = `79c9d67a65…9ba9e41` for all three conditions, equal to the recorded `demo/forge-baseline/index.html` hash (verified independently via `shasum` on 12C and 12E branches); `baseline_matches_shared: true` |
| Same user request | ✅ identical string "Add a Next Level button beneath the Restart button."; `request_sha256` `8309c21b…` identical in all three |
| Different memory conditions | ✅ A: 1 injected memory id (sunset); B: 0 memories; C: 1 injected memory id (ocean correction); `memory_ids_reconstructed` match job records |
| Corrected decision supersession | ✅ C's injected block contains only the ocean constraint (`aceff9cf…`); the superseded sunset memory id (`8de86811…`) is recorded but not injected |
| Generated source differences | ✅ greps on the archived sources: A contains `0xFF7E5F` ×1 (and no `0x4EA8DE`); C contains `0x4EA8DE` ×1 and **zero** `0xFF7E5F`; B contains neither — matches `source_palette_v2` counts (sunset_after 0 in C) |
| Rendered visual evidence | ✅ `rendered_palette_visible`: A accent 1.082 %, B 0.005 %, C 0.879 %; `A/C-v2.png` and `A/C-v2-visible.png` present; measurement revision (overlay-dismissed capture) disclosed in `metrics_note` and report §76–78, "no model output changed" |
| Authentic Muse provenance | ✅ model forced to `muse-spark-1.3-contributor` via API key, `failover: false` in all three; all jobs approved, runtime-verified, rolled back (`approved/rollback/runtime_verified` true) |
| Prompt inclusion proof | ✅ per job `prompt_sha256` == independently reconstructed sha (`prompt_matches_job: true` for A, B and C) |
| Reported limitations | ✅ honestly documented: n=1/condition, exploratory, no significance claim; **dark text colour not applied in any condition** (`dark_pct 0`); single visual signal; forced-key mode differs from subscription-first; reconstruction proves presence, not attention |
| A/C contrast claim | ✅ A renders the sunset accent `0xFF7E5F`; C renders the ocean accent `0x4EA8DE` with the superseded value absent from source — the exact contrast the brief asks for; SUBMISSION_COPY 300-word and EVIDENCE_MAP C8 describe it accurately |

**Why A/C is stronger evidence than showing retrieved memories in a prompt.** A prompt with
retrieved memories shows only that memory was *available* — the model could ignore it and the
artifacts would still be "memory-influenced" claims. The A/C trial is a manipulation experiment:
input (request bytes, baseline bytes, model, budgets) held constant; the *only* manipulated variable
is the memory condition. The effect then appears in the output itself — three different rendered
pixel distributions (1.082 % vs 0.005 % vs 0.879 %) and different source hex tokens, each matching
exactly the injected memory, with the superseded memory's value absent from C. Combined with
byte-exact prompt-hash reconstruction, the causal chain closes: decision → provably in prompt →
provably in rendered pixels, and correction → provably *removed* from both. That is output-level,
condition-controlled evidence, not retrieval logs.

Keep the framing bounded: **n=1 per condition, single palette vocabulary, one visual signal, no
statistical significance claim** (consistent with all documents; nothing to correct).

---

## 5. Runtime-verification wording corrections (exact replacements)

What the check actually does (`apps/server/src/forge/runtime-check.ts` at `156c65c`, re-read):
launches real Chrome headless (`chromium.launch({channel:'chrome'})`), loads the staged HTML,
waits 1.2 s, collects `pageerror` events and console `error` messages (favicon and 404 resource
messages filtered), requires `canvas` element count > 0; otherwise job fails and approval is
blocked (422 `runtime_failed` tested; staged file never promoted). It does **not** click, play,
advance game states, sample pixels, or verify post-boot interactions.

Approved sentence (usable everywhere):
> "Before approval is possible, the app loads the staged game in real headless Chrome: any page or
> console error fails the job, and the game must create its canvas. That's a boot check — it proves
> the game starts cleanly; it doesn't play the game or verify rendered pixels."

Replacements:
- `PROJECT_STORY.md` L28–29: "**runs the game**" → "**boots the game**".
- `PROJECT_STORY.md` L94–96: "verifies the canvas actually renders" → "verifies the game creates
  its canvas"; keep the blocking-gate sentence but scope the failure class: "a change that errors
  or fails to start in the browser can never be approved."
- `DEMO_SCRIPT_3MIN.md` L75–76: "has *played the game itself*" → "has *booted the game in a real
  browser for me*"; "confirms the game renders" → "confirms it starts without errors and creates
  its canvas" (then show the rendered screenshot as separate visual evidence — the screenshot, not
  the check, carries the "it looks right" claim).
- `SUBMISSION_COPY.md` L23: "plays the game headless" → "boots the game headless".
- `SUBMISSION_COPY.md` L42–43: keep "rejects page errors" but add "; it verifies the game starts,
  not that it plays."
- `SUBMISSION_COPY.md` L128 + L102–113: add one limitation bullet: "runtime verification is
  boot-level (load + page/console error scan + canvas presence), not gameplay testing."

Not overclaimed, keep as-is: EVIDENCE_MAP C5, runbook §7 runtime-failure row, runbook §1 Chrome
row, `DEMO_SCRIPT` L80 ("all runtime-verified" is consistent with recorded job records).

---

## 6. Decision Guard presentation recommendations

1. **UI expectation changed on the RC (12E).** The panel header now shows an *assessment* chip —
   `VIOLATION DETECTED` / `NO VIOLATION DETECTED · SUPPORTED CHECKS` / `NOT VERIFIED` /
   `EVALUATION UNAVAILABLE` — deliberately neutral tone, never a green PASS badge; the footer still
   prints engine version (1.2.0), source sha prefix, and the "pre-runtime review snapshot / after
   runtime verification" line. Runbook §6/§7 and the script's guard beats should describe these
   labels and cite the 12E screenshots (`phase12e/screenshots/ui-decision-guard-advisory.png`,
   `ui-review-page.png`, `ui-approved-with-findings.png`, A/B/C panel shots).
2. **Findings evidence excerpts are now engine match spans ±16 chars, redacted before persistence**
   (12E P0-A) — a good on-camera honesty point; do not describe the excerpt as "the model's line
   verbatim" (it is an excerpt around the matched construct).
3. **Keep the two honesty lines** the script already has (advisory; source-pattern check, not
   compliance) — they match the audit reality — and compress to ≈30–40 s of speech total for a
   15 s slot: findings → "advisory only" → "reads source, not behaviour — we audited it, so the
   human decides".
4. **Do not approve the labelled mutation on camera.** Use the recorded mutation as a clearly
   labelled cutaway for the guard findings; approve/rollback live on the *clean* modification run.
   If the authentic run itself happens to trigger findings, approving it on camera is fine and is
   the stronger story — the only rule is that the deliberately violating mutation stays a cutaway.
5. **Numbers to quote:** only v1.2.0 figures from the 12E evidence (§2d), e.g. "on a 72-case
   adversarial audit, even the hardened engine abstains on 14 cases and would have been wrong about
   1 in 4–5 of its blocks — which is exactly why it advises rather than enforces."
6. **Rollback beat stays single-step** until the cloud ancestry fix is verified (§2b).

---

## 7. Evidence gaps

| # | Gap | Impact | Minimum action |
| --- | --- | --- | --- |
| E1 | No spontaneous (non-mutation) model violation flagged end-to-end by the guard | guard's real-world firing is probe-evidence only | record one authentic run; if it fires, keep it; if not, keep the labelled cutaway framing (already honest) |
| E2 | Multi-step rollback ancestry (Opus P1) has no passing test at `156c65c` | blocks §2b claims and any "undo to any version" wording | cloud fix + integration test (v2 approved over rolled-back v1 → undo must land on the recorded parent); re-verify test counts |
| E3 | No seeded-`forge-demo` screenshot/recording pass on the RC tip yet | all current visuals are 12A/12C/12E-evidence captures, not the demo project | execute §9 recording checklist on the final RC tip |
| E4 | 12E engine v1.2.0 has no *new* spontaneous-model observations (authentic corpus still n=1) | C7 authentic-generalisation limit unchanged | acceptable; keep "corpus is fixture" framing |
| E5 | Test-count citations drift with the incoming rollback fix | S8/S10/S11 numbers stale twice | docs must pin counts to the final RC tip SHA at submission time |
| E6 | Official rules (video specs, repo visibility, deliverables) unretrieved | §8 | resolve from Official Rules / Discord / submission form before Nov 4 |
| E7 | 12A trial ran in forced-key mode; subscription-first path untested for memory conditions | minor comparability caveat (already disclosed in 12A §98/§134) | none required; keep the caveat |

---

## 8. Official requirements status (re-checked 2026-10-27)

Re-fetched the official page (https://cerebralvalley.ai/e/meta-ai-developer-hackathon) — HTTP 200.

**Confirmed from the official page:**
- Event window Oct 26 – **Nov 4, 9:00 PM ET submission deadline** (judging Nov 4–8, closing Nov 9).
- Two tracks; **indie track judged on "creativity, technical ambition, and whether it works"** —
  the demo plan and evidence posture align with this.
- Themes: "Build for Your World" / "Push the Frontier"; built with Meta models (Muse Spark series,
  Muse Wonder, Muse Image, SAM 3.1, Muse Code). The project's Muse Code + `muse-spark-1.3` usage
  fits; no "must use X" clause is stated.
- Eligibility: worldwide except sanctioned countries/regions (incl. Belarus, China, Russia, Syria,
  Cuba, North Korea, Iran, Crimea/DNR/LNR); Meta/Cerebral Valley employees/contractors/interns and
  families ineligible; duplicate/spam applications disqualified.

**Still unresolved (not asserted anywhere):**
- Repository visibility (public vs private at submission) — still not stated; repo currently
  private. **Do not flip visibility without confirming the rules** (per local restrictions too).
- Required deliverables (video length/format, written description, deployed/demo URL) — not stated
  on the official page.
- Pre-existing-code restrictions and development-window rules — not stated.
- The page says "Official Rules will be published before the Hackathon begins on October 26,
  2026 and must be accepted" — the rules text itself is not reachable at `/rules`,
  `/official-rules`, `/terms`, or the waiver page (still a client-side "Loading…" shell today).
  A Google "Meta Hackathon Submission Form" found via search references metallama3.devpost.com and
  AWS/Groq-era sponsors — **a different, older hackathon; do not treat it as this event's form.**
- Action for director: confirm deliverable spec + visibility from the Official Rules, Cerebral
  Valley Discord, or the submission form actually linked at submission time. `requirements-review.md`
  remains accurate as a written uncertainty record; deadline confirmation can be added by the cloud
  agent.

---

## 9. Recording checklist (demo day, on the final RC tip)

1. Pin the RC tip the director confirms after the rollback fix lands; record `git rev-parse` SHA.
2. Fresh `pnpm install`; `pnpm verify` green — record the actual passed/skipped counts (expected
   ≥457 passed / 3 skipped at `156c65c`; re-check after the fix).
3. `pnpm demo:seed` (baseline sha `79c9d67a…9ba9e41`); enter the two decision memories (child-safety;
   sunset→ocean correction) exactly as the runbook §4 describes.
4. Record, end-to-end real time on seeded `forge-demo`: inspector + correction history (segment 2);
   live submit → job with retrieved memories + `prompt_sha256` (segment 3); guard-panel capture from
   the labelled-mutation job showing the 12E assessment chip (segment 5); **live approve + single
   rollback of the clean run** (segment 7).
5. Keep every artifact: job id, prompt hash, diff stats, runtime screenshot, guard JSON. Do not
   re-stage or edit model output; re-run on failure rather than fabricate.
6. A/C comparison cut: reuse the 12A screenshots (authentic; cite branch + commit on card).
7. Screenshot scrub before publishing: no API keys, no `/Users/…` paths, no hostnames/IPs, no
   account names (UI job ids are UUIDs — fine). Note: 12E `verification.json` internally contains
   the workspace path `/Users/burnz/projects/muse-memory-lab` — fine inside the repo; exclude from
   published slides.
8. Pre-flight: desktop Chrome present, Muse CLI logged in, quota plan (subscription-first;
   contributor-key fallback fires on 429 only — each real run consumed 134–243 k input tokens in
   11A, so budget for one dry run + one recorded keep, not many).
9. `GET /api/health` 200; browser zoom set; private window; bookmarks hidden.

---

## 10. Final readiness verdict

**CONDITIONAL GO** for the submission package, consistent with the director's CONDITIONAL GO:

- **GO now (verified):** product positioning and innovation framing are clear and accurate; the
  memory-influence A/C evidence (the centerpiece) verifies end-to-end at output level, with honest
  limitations; trial statistics, diff-size ranges, retrieval budgets, CAS, staging safety, guard
  advisory semantics, and the 12C guard findings all re-derive from authentic evidence; the copy's
  "what we do NOT claim" discipline is strong.
- **Conditions before submit (cloud-owned):**
  1. Rollback ancestry P1 fixed and verified; rollback claims then stay scoped to the verified
     behaviour (§2b).
  2. Stale 12C references and test counts repinned to the final RC tip (§2a).
  3. Runtime wording corrected to boot-check scope everywhere (§5); guard figures updated to
     v1.2.0 and guard-UI labels updated (§2d, §6.1).
  4. §9 recording completed on the final tip (demo currently relies on earlier-phase captures).
  5. Official Rules / submission-form requirements resolved (visibility, deliverables, video
     specs) — the package must not claim compliance with unverified requirements.
- **NO-GO claims (any phase):** guard enforcement, "comprehensive compliance", runtime
  "gameplay verification", rollback to any version, statistical significance, and any
  performance-savings number beyond the cited 11A trial figures.
- Demo plan: adopt the §3 timeline (345 spoken words, ≈168–176 s) — meets every brief requirement
  with a small margin.

---

## Appendix — verification log (what was checked, where)

- Baselines: `git rev-parse` on both branches (exact match); lineage `git log
  --oneline agent/phase12e-release-hardening`.
- Runtime check code: `git show 156c65c:apps/server/src/forge/runtime-check.ts`.
- Rollback/promote: `git show 156c65c:apps/server/src/forge/workspace.ts` (promote L~240–295,
  rollback L297–320).
- Guard: `GUARD_VERSION` constant (`156c65c` index.ts:28); UI labels
  `apps/web/src/components/forge/DecisionGuardAdvisory.tsx` at `260d9ce` (old PASS badge) and
  `156c65c` (assessment chips); 12E report §5, §8.1–8.6.
- Guard UI evidence: `docs/hackathon-evidence/phase12c/` (12C tree) and
  `docs/hackathon-evidence/phase12e/` (12E tree incl. screenshots, accuracy JSONs,
  `verification.json`: 457 passed / 3 skipped, exit 0).
- 12A evidence: `pilot.json` fully parsed (all checks in §4 table); greps on `{A,B,C}-v2.html`;
  `docs/PHASE12_MEMORY_VALIDATION.md` scanned for limits.
- 11A trials: `trials.json` parsed; mean/median/range, token totals, diff %, approval/rollback,
  failover all recomputed.
- 12C guard findings: `evaluation.json` parsed (2 high findings, one decision id).
- Config/scripts: `config.ts` defaults; `package.json` scripts; `vite.config.ts` strictPort;
  `fake-muse.mjs` present — all at `156c65c`.
- Retrieval: `packages/memory-engine/src/retrieval.ts` (filters, bm25, pinned types/slots);
  `runner.ts:160` budget constants.
- Evidence-path existence: every path cited in `EVIDENCE_MAP.md` resolved on its named branch
  (`git ls-tree -r`), plus `experiments/muse-forge/game/index.html`,
  `tests/unit/memory-engine-phase2.test.ts`, `docs/MUSE_FORGE_FEASIBILITY.md` (records
  `muse-wonder-1.0`), `docs/hackathon-evidence/requirements-review.md`.
- Official page re-fetched today: deadline/tracks/eligibility as in §8; rules pages still
  unreachable.
