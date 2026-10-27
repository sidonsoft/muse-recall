# V2 video QA report — Muse Recall

**Prepared:** 2026-10-28 (Australia/Brisbane)
**File under test:** `release-deliverables/Muse_Recall_Demo_V2_1080p.mp4` (delivery directory; the MP4 is not committed to the repository)
**SHA-256:** `57ce9eadae3c2256802cbfd3aea480f34403ca3b9768f03689f37cdaa73cebf8`
**Verdict:** technically valid; evidence-faithful; **director acceptance pending**. No
submission was made.

---

## 1. Technical checks

| Check | Measured | Result |
|---|---|---|
| Container / duration | MP4, **172.000 s** | PASS (target 172 s; ceiling 180 s) |
| Resolution | 1920 × 1080 | PASS |
| Frame rate / count | 30 fps, **5160** frames | PASS |
| Video codec | H.264 High, level 4.1, `yuv420p` | PASS (broad playback compatibility) |
| Audio codec | AAC-LC, 48 kHz, stereo, 192 kb/s | PASS |
| Fast start | `moov` at front (`+faststart`) | PASS |
| File size | 8,833,551 bytes | PASS |
| Integrated loudness | **−16.1 LUFS** | PASS |
| True peak | **−1.5 dBTP** | PASS (no clipping) |
| Sample peak | −1.49 dB | PASS |
| Black frames | `blackdetect d=0.1 pix_th=0.10` → **0 events** | PASS |
| Silent gaps | `silencedetect n=-45dB d=1.5` → **0 events** | PASS |
| Aspect ratio | 16:9, no stretching; stills padded to the 1920×1080 stage | PASS |

The check was run on the rendered file, not inferred from the encoder exit code.

---

## 2. Frame inspection

Thirteen representative frames were extracted and inspected at full resolution, plus a
contact sheet:

- 0:03 title card
- 0:08 FocusFlow v1 with generation job / recorded-stills label
- 0:10 generation still with attempt-2 reminder
- 0:16 v2 approved with retake disclosure
- 0:40 memory rail spotlight
- 1:00 Phase 12A figure
- 1:20 modification request / staged result
- 1:27 v1/v2 comparison
- 1:40 staged source / approval
- 1:58 labelled-mutation guard card
- 2:05 live advisory panel
- 2:20 rejected attempt 1
- 2:30 Phase 15B card
- 2:45 end card

Contact sheet: `release-deliverables/V2_VIDEO_CONTACT_SHEET.jpg`.

Findings:

- No cropped application UI in the evidence stills; the derived comparison cites its
  two source screenshots on screen.
- Titles, captions, job ids and disclosure ribbons are legible at 1080p.
- FocusFlow is recognisable as a real application (working task input, filters, progress,
  priority controls), not a mockup.
- The v1 → v2 difference is visible side by side: no priority controls on the left;
  Normal/High selector, High badge and high-priority remaining count on the right.
- Memory is visible as project context (five active decisions; four supplied to the
  modification) and the rail itself says retrieval is not proof of causation.
- Approval is visible in the version history and the approval button spotlight; rollback
  is described as available, never as executed on FocusFlow.
- Decision Guard is shown as advisory (`not_verified`, 0 findings) and the packaged
  finding is labelled as a mutation.
- The Phase 15B figures are legible, including the p-values and the post-hoc label.
- The ending states the value proposition and the limitations.

---

## 3. Audio inspection

- Narration is present for every scene and starts 0.35 s after each scene boundary.
- No clipped narration: the longest scene audio fits its slot; no line was cut
  mid-word. The only compression applied is playback-rate fitting (see §8).
- No editing gaps: the ambient bed runs continuously under the narration and fades only
  in the last 1.5 s.
- No channel imbalance or DC offset observed; the mix is stereo 48 kHz.
- Voice: `edge-tts` `en-GB-RyanNeural`. This is a synthetic voice, not the ElevenLabs
  voice used for the fallback cut. The change is audible and is disclosed here and in
  the production manifest.

---

## 4. Caption inspection

| Check | Result |
|---|---|
| Cue count | **59** |
| Cues outside their scene | **0** |
| Longest cue | 55 characters |
| Overlapping cues | 0 (ends trimmed to the next start) |
| Punctuation | Recovered from the narration text; sentence punctuation retained |
| Placement | Bottom centre, above the safe edge; no collision with disclosure ribbons |
| Sampled cues | 0:45, 1:20, 1:58, 2:05, 2:30, 2:45 — match the spoken line |

Captions are burned in; the same cue text is preserved in `video/v2/captions/captions.json`.

---

## 5. Provenance verification

| Segment | Evidence shown | Disclosure | Verdict |
|---|---|---|---|
| 0:00–0:14 | FocusFlow v1 app; title card | `Live Muse Spark generation — job e358246a… · recorded stills`; `Attempt 2 selected — attempt 1 rejected after a sandbox form failure` | PASS |
| 0:14–0:36 | v2 approved Studio; version history; v2 app | Exact retake text: `Retake with an added sandbox instruction — attempt 1 was rejected after a sandbox form failure; attempt 2 selected.` | PASS |
| 0:36–0:56 | Memory rail; 4 decisions supplied | `5 active decisions · retrieval is supplied context, not proof of causation`; `4 decisions supplied to this modification · ids recorded on the job` | PASS |
| 0:56–1:14 | Phase 12A A/B/C figure | `Authentic Phase 12A output — one run per condition. Directional, not statistical.`; `Palette accent only · n = 1 per condition · exploratory` | PASS |
| 1:14–1:54 | Modification request, staged preview, diff, source, approval | `Live Muse Spark modification — job aeb6b175-…`; `Generation time condensed — approximately 2 minutes elapsed.`; `Headless Chrome load check passed · load-time only — it does not play the app` | PASS |
| 1:54–2:12 | Guard card, live advisory panel, refusal card | `Labelled mutation — packaged evidence, not model output.`; `Live FocusFlow advisory — not_verified · 0 findings · never blocks approval`; `Live run — model honoured the remembered rule; no change promoted` | PASS |
| 2:12–2:28 | Approval, rejected attempt 1, later no-op | `Approved 2026-10-27T19:45:07Z · v2 current · v1 recoverable`; `Attempt 1 — rejected: native form blocked by preview sandbox.`; `Later no-op rejected · v2 remains current · not a Guard finding` | PASS |
| 2:28–2:40 | Phase 15B card | Figures, post-hoc label, one-model/game/rule/request scope, missing-scorer note, evidence link | PASS |
| 2:40–2:52 | End card | `Decision Guard is advisory. Runtime verification is load-time only. Retrieval is not proof of causal influence outside the controlled trials.` | PASS |

The Phase 12A figure is a published result graphic, not replay footage, so the
`Replay of recorded Phase 12A Muse output.` label is not applicable; the segment is
labelled as authentic recorded output and as directional. No replay of recorded output
is spliced into the cut.

---

## 6. Security and privacy inspection

- No terminal window, shell prompt, environment file, provider dashboard or browser
  address bar appears in any frame.
- No API key, token, password, local absolute path or account identifier is visible.
- The live refusal quote is shortened and its `/Users/…` path is removed; only the
  substantive sentence is shown.
- The only URLs shown are the public repository and the public evidence path.
- Job ids and project id (`focusflow`) are public evidence identifiers, intentionally
  displayed for provenance.
- No screen recording or desktop capture was used, so unrelated desktop content cannot
  leak into the cut.

---

## 7. Research-claim inspection

- Phase 15B figures match `analysis.json` and `EVIDENCE_CARD.md`: original coding
  15/16 without memory vs 5/16 with memory, p = 0.000635; corrected coding 15/16 vs
  0/16, p = 5.66 × 10⁻⁸.
- The corrected result is labelled **post-hoc** on the card and in the narration
  (`Corrected post-hoc: zero of sixteen.`). It is not presented as preregistered.
- The card states the scope: one model, one game, one child-safety rule inside a larger
  project-memory set, one request.
- The card states that the original scorer was not preserved and that corrected coding
  was post-hoc, unblinded and narrow.
- A text scan of all caption text found no occurrence of “eliminated”, “guarantee(s)”,
  “caused”, “proves”, “prevents” or “certif*”.
- The FocusFlow retrieval is not presented as causal; the Phase 12A trial is the causal
  evidence, and it is explicitly one run per condition.

---

## 8. Storyboard alignment

| Segment | Canonical window | Actual window | Shot sequence | Verdict |
|---|---|---|---|---|
| 1 Muse Spark builds | 0:00–0:14 | 0:00–0:14 | title → v1 app | PASS |
| 2 Artifact is the hero | 0:14–0:36 | 0:14–0:36 | v2 Studio → version history → v2 app | PASS |
| 3 Recall remembers | 0:36–0:56 | 0:36–0:56 | memory rail → 4 decisions supplied | PASS |
| 4 Authentic influence | 0:56–1:14 | 0:56–1:14 | Phase 12A figure → panels | PASS |
| 5 Muse Spark develops | 1:14–1:36 | 1:14–1:36 | staged result → diff → comparison | PASS |
| 6 Inspect and review | 1:36–1:54 | 1:36–1:54 | source → approval | PASS |
| 7 Decision Guard warns | 1:54–2:12 | 1:54–2:12 | packaged finding → live advisory → refusal | PASS |
| 8 The developer decides | 2:12–2:28 | 2:12–2:28 | approval → attempt 1 → no-op | PASS |
| 9 Experimental evidence | 2:28–2:40 | 2:28–2:40 | Phase 15B card | PASS |
| 10 Close | 2:40–2:52 | 2:40–2:52 | end card | PASS |

Deviations from the storyboard's *production notes*, all disclosed:

1. **Stills, not continuous footage.** The plan permits preserved stills when a new paid
   recording run is not commissioned. Every live-job still carries its job id and
   `recorded stills`. No still is cut to imply continuous capture.
2. **Condensed narration.** Scenes 4, 7, 8 and 9 are read at +9%, +17%, +18% and +5%
   respectively to fit the canonical windows. Scenes 4, 7 and 9 are also slightly
   condensed in wording; no required claim or disclosure was removed, and the full
   claims remain on the cards.
3. **Typeset guard card.** The packaged finding is reproduced from the recorded JSON at
   1080p rather than upscaling the 538 × 547 screenshot. The content, rule, severity,
   decision reference, evidence excerpt and source hash are unchanged; the mandatory
   label is larger and repeated in the ribbon.
4. **Synthetic voice.** `edge-tts` was used because the ElevenLabs credential was not
   available. This is a delivery limitation, not a claim change.

---

## 9. Outstanding issues

1. **Voice identity differs from the fallback cut.** The narration is Microsoft Edge TTS
   (`en-GB-RyanNeural`), not the ElevenLabs voice used for CutA. Director may prefer to
   re-voice before submission; the script is cached and a re-voice is a drop-in rebuild.
2. **The cut uses recorded stills, not motion screen capture.** This is permitted by the
   canonical plan and disclosed on screen and here, but it is a production choice the
   director should accept explicitly.
3. **Condensed narration in scenes 4, 7, 8 and 9.** The card carries the full Phase 15B
   caveats; the spoken line is shorter.
4. **The original MP4 remains the fallback.** V2 is a new file and has not replaced it.
5. **No submission has been made.** Director acceptance is required before upload.

No unresolved technical, privacy or provenance defect was found.
