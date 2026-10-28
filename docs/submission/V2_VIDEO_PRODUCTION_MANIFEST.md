# V2 video production manifest — Muse Recall

> **Historical document.** This is the V2 video production record. The submission now uses the Ocean Pairs demo video and the Phase 16 / 16B research; see the [README](../../README.md) and the [submission copy](SUBMISSION_COPY.md). Kept for the development record.

**Prepared:** 2026-10-28 (Australia/Brisbane)
**Deliverable:** `Muse_Recall_Demo_V2_1080p.mp4`
**Status:** rendered and QA'd; **not submitted**. Director acceptance remains pending.
**Authority:** director-authorised final release and V2 production brief. The canonical
storyboard is [`docs/submission/V2_DEMO_RECORDING_PLAN.md`](V2_DEMO_RECORDING_PLAN.md)
on `main` @ `328092c`.

---

## 1. Final file

| Field | Value |
|---|---|
| Filename | `Muse_Recall_Demo_V2_1080p.mp4` |
| Delivery path | `release-deliverables/Muse_Recall_Demo_V2_1080p.mp4` |
| Working path | `video/v2/Muse_Recall_Demo_V2_1080p.mp4` |
| SHA-256 | `57ce9eadae3c2256802cbfd3aea480f34403ca3b9768f03689f37cdaa73cebf8` |
| Size | 8,833,551 bytes |
| Duration | **172.000 s** (2:52) |
| Resolution | 1920 × 1080 |
| Frame rate | 30 fps, progressive |
| Video | H.264 High profile, level 4.1, `yuv420p`, CRF 18 / slow |
| Audio | AAC-LC, 48 kHz, stereo, 192 kb/s |
| Container | MP4, `+faststart` |
| Loudness | **−16.1 LUFS integrated**, true peak **−1.5 dBTP**, LRA 11.8 LU |
| Captions | 59 burned cues, plus the narration text in the production source |

The protected fallback is unchanged:

| Field | Value |
|---|---|
| File | `video/cut/Muse_Recall_CutA_1080p.mp4` |
| SHA-256 | `656a21b2bea40003394345e0a4481f45486ddb4d4096a7fc9a92263f668042e0` |
| Size | 11,333,490 bytes |
| Duration / resolution | 172 s / 1920 × 1080 |

**V2 does not overwrite, rename, trim or re-tag the fallback.** The two files coexist.

---

## 2. Production method

The cut follows the canonical 172 s, ten-segment storyboard exactly. It uses **preserved
evidence stills**, not newly generated model output and not a continuous screen recording:

- No Muse inference was run for this video. No API credential was used or displayed.
- Screen material is the recorded evidence in `docs/demo/evidence/screenshots/` (FocusFlow,
  2026-10-28), the Phase 12A published figure, and the packaged Phase 12D/14A guard record.
- Every still that represents a live job carries that job id and the words **recorded
  stills**. No still is presented as continuous live footage.
- The one derived comparison graphic (`compare-v1-v2.png`) is built from two recorded
  screenshots and is labelled as such on screen.
- The Decision Guard finding is a typeset reproduction of the packaged
  `docs/hackathon-evidence/phase14a/guard-advisory.json`, carrying the mandatory
  `Labelled mutation — packaged evidence, not model output.` banner.
- Narration is synthetic speech generated with `edge-tts` voice
  `en-GB-RyanNeural` (Microsoft Edge TTS). The ElevenLabs voice used for the fallback
  cut was unavailable because no `ELEVENLABS_API_KEY` was present in the environment.
  This is disclosed in the QA report; it is a voice change, not a claim change.
- The ambient bed is the original procedurally generated track from
  `video/cut/audio/music.wav` (`make_music.py`), mixed at 0.18 under the narration.

---

## 3. Source material and hashes

All hashes are SHA-256. Paths are relative to the `muse-recall-rc` worktree at
`328092c` unless noted.

| Asset | SHA-256 | Role |
|---|---|---|
| `docs/demo/evidence/screenshots/ui-10-approved-v2.png` | `1e2925e20537f76e7dda6af7b2579ce48c0a83182cb5716b5d1bf60aecbcefdd` | v2 approved Studio, memory rail, version history |
| `docs/demo/evidence/screenshots/ui-06-modification-review.png` | `2d5fec2794569e13ed5949acb9c5c1b679a203e88de93fb6462367bd331c6ad7` | staged v2, decisions supplied, advisory panel |
| `docs/demo/evidence/screenshots/ui-07-modification-diff.png` | `0e6d05de3497d000d0212ecd67830841fe94f456d92d9e3a11848ffe0af838e0` | staged diff |
| `docs/demo/evidence/screenshots/ui-08-modification-source.png` | `96c7ab8f6c5be73de8f66b72ef3cfeb17070b99f9e6d95320f11771805d35b10` | staged source, SHA and size |
| `docs/demo/evidence/screenshots/ui-05-approved.png` | `3e193a2d86e2d773e0b97864f2742ca5728038f05bf6e20f0bc0074b22d92d2c` | v1 approved source for the v1 preview crop |
| `docs/demo/evidence/screenshots/v2-approved-desktop.png` | `4f8cd1ad09b732db4c241fd78da0f434521c1242ca52f37283e71967ccb6a46e` | v2 app, priority controls |
| `docs/demo/evidence/screenshots/v1-failure-form-blocked.png` | `792f487b395cbc2ed031308d6ef469133e02a36565e5be5f093611d950d18282` | rejected attempt 1 |
| `docs/hackathon-evidence/phase14a/screenshots/11-memory-influence.png` | `07fddf940c3dc4cc1a0f57f0b189a218f3bbe324f0f219cab33637783cca73e5` | Phase 12A A/B/C figure |
| `docs/hackathon-evidence/phase14a/guard-advisory.json` | `2ac881834d64938bf68f4ada33d5e234bb56f04c01cc613d4b5ee64b0de9942d` | packaged guard finding |
| `docs/hackathon-evidence/phase15b/EVIDENCE_CARD.md` | `dc763221297df77442597667592a20b27e6e16a47e38145e31bf473110138448` | Phase 15B wording and numbers |
| `docs/hackathon-evidence/phase15b/analysis.json` | `95dc7e5bbceaba6c2cda8107a5921c5b411022bc2ea26dadc23f06a525b4ae18` | Fisher exact outputs |
| `docs/hackathon-evidence/phase15b/trial-results.json` | `c0044cad3b6914f14fbc3716318476100efda900839d0e9cc11b5de9e3f1b23d` | 32-run records |
| `docs/demo/evidence/records/provenance.json` | `522385f909042c378f741f3804a46a701ccae152c2909c732ff072b8f95f35ea` | job ids, artifacts, prompts |
| `docs/demo/evidence/records/v4-model-response.txt` | `ff767e1cde81cf1027051c1323abf8d5d5a70bad33be82ef467b4e8c3affc34a` | live refusal (path redacted on screen) |
| `docs/demo/evidence/records/v4-guard-request.txt` | `3e6b4191aa760a4434a4af0d3c15f971dfb59d35daf21e4e4e922acc86fc1c8c` | refusal request |
| `docs/demo/evidence/records/v2-browser-validation.json` | `cea8bcfe61c93a02822163180fdc5a68b5c0e4a523908b15c76da77693d31f38` | 21/21 checks |
| `docs/demo/evidence/records/v3-browser-validation.json` | `6a076f7bc7e4a5bc0cd69b8a3d4bb84001f7021cabb37da696cecdfabaa0281c` | 25/25 checks |
| `video/cut/audio/music.wav` (primary workspace) | `46019a78dc86d4f64a71980c98ed047819eeee93ef8c3e766860371f268082a2` | generated ambient bed |
| `source/ui05-preview-crop-top.png` (derived) | `e24166105d8b1f07811dc5cd93bd9dbdca85b0e789365bc0bf0818fed261401f` | derived crop of `ui-05` |
| `source/compare-v1-v2.png` (derived) | `3a5d5847bedc3c2540d765555941ac1f1d64230d4067ecdf3fe006ed82c1771d` | derived v1/v2 comparison |
| `source/memory-panels.png` (derived) | `d0b6a4a56525e1d7746e40b217bb45f60d2bcb577614860e36f71688b2cca74a` | derived Phase 12A crop |
| `audio/mix-final.wav` (derived) | `22d8a2603fb4793a57589b2a5a1c45fd691d179af5b540ddc57985e3b5393921` | final 172 s mix |
| `captions/captions.json` (derived) | `3ab2b47eb1f2138f19b36c94594419b259d94e5c2d503ff202a3ca3ad965e773` | 59 caption cues |

No source above was modified. All original evidence files remain byte-identical on
`main` @ `328092c`.

---

## 4. Timeline mapping

All times are destination timeline (30 fps; frame numbers are exact multiples of 1/30).
Segments match the canonical storyboard windows exactly.

| Scene | Timeline | Shot | Source | Overlays / disclosures |
|---|---|---|---|---|
| 01 | 0:00.00–0:06.00 | s01a | `card-title.png` | — |
| 01 | 0:06.00–0:14.00 | s01b | `ui05-preview-crop-top.png` | generation job, attempt-2 note |
| 02 | 0:14.00–0:22.00 | s02a | `ui-10-approved-v2.png` | retake disclosure |
| 02 | 0:22.00–0:28.00 | s02b | `ui-10-approved-v2.png` | version-history spotlight, retake |
| 02 | 0:28.00–0:36.00 | s02c | `v2-approved-desktop.png` | — |
| 03 | 0:36.00–0:46.00 | s03a | `ui-10-approved-v2.png` | memory-rail spotlight |
| 03 | 0:46.00–0:56.00 | s03b | `ui-06-modification-review.png` | 4-decisions spotlight |
| 04 | 0:56.00–1:05.00 | s04a | `11-memory-influence.png` | Phase 12A provenance |
| 04 | 1:05.00–1:14.00 | s04b | `memory-panels.png` | provenance + palette-only note |
| 05 | 1:14.00–1:23.00 | s05a | `ui-06-modification-review.png` | modification job, condensed |
| 05 | 1:23.00–1:29.00 | s05b | `ui-07-modification-diff.png` | modification job, condensed |
| 05 | 1:29.00–1:36.00 | s05c | `compare-v1-v2.png` | derived comparison |
| 06 | 1:36.00–1:45.00 | s06a | `ui-08-modification-source.png` | source spotlight, job |
| 06 | 1:45.00–1:54.00 | s06b | `ui-06-modification-review.png` | approval spotlight, job, load-time |
| 07 | 1:54.00–2:02.00 | s07a | `card-guard.png` | labelled mutation |
| 07 | 2:02.00–2:07.00 | s07b | `ui-06-modification-review.png` | live advisory spotlight |
| 07 | 2:07.00–2:12.00 | s07c | `card-refusal.png` | live refusal |
| 08 | 2:12.00–2:19.00 | s08a | `ui-10-approved-v2.png` | approval / version-history |
| 08 | 2:19.00–2:23.00 | s08b | `v1-failure-form-blocked.png` | attempt-1 rejection |
| 08 | 2:23.00–2:28.00 | s08c | `card-refusal.png` | later no-op rejection |
| 09 | 2:28.00–2:40.00 | s09a | `card-15b.png` | Phase 15B results |
| 10 | 2:40.00–2:52.00 | s10a | `card-close.png` | end disclaimer |

---

## 5. Disclosure windows

| Window | Text as displayed | Applies to |
|---|---|---|
| 0:06–0:14 | `Live Muse Spark generation — job e358246a-6741-499c-8057-6b2447e31718 · recorded stills` | generation still |
| 0:06–0:14 | `Attempt 2 selected — attempt 1 rejected after a sandbox form failure` | generation still |
| 0:14–0:28 | `Retake with an added sandbox instruction — attempt 1 was rejected after a sandbox form failure; attempt 2 selected.` | v2 hero |
| 0:36–0:46 | `5 active decisions · retrieval is supplied context, not proof of causation` | memory rail |
| 0:46–0:56 | `4 decisions supplied to this modification · ids recorded on the job` | staged modification |
| 0:56–1:14 | `Authentic Phase 12A output — one run per condition. Directional, not statistical.` | Phase 12A figure |
| 1:05–1:14 | `Palette accent only · n = 1 per condition · exploratory` | Phase 12A crop |
| 1:14–1:29, 1:36–1:54 | `Live Muse Spark modification — job aeb6b175-01a6-4c9b-93a1-757cddf475e1 · recorded stills` | staged modification / review |
| 1:14–1:29 | `Generation time condensed — approximately 2 minutes elapsed.` | 116 s job represented by stills |
| 1:45–1:54 | `Headless Chrome load check passed · load-time only — it does not play the app` | approval |
| 1:54–2:02 | `Labelled mutation — packaged evidence, not model output.` | guard finding card |
| 2:02–2:07 | `Live FocusFlow advisory — not_verified · 0 findings · never blocks approval` | live advisory panel |
| 2:07–2:12 | `Live run — model honoured the remembered rule; no change promoted` | refusal card |
| 2:12–2:19 | `Approved 2026-10-27T19:45:07Z · v2 current · v1 recoverable` | version history |
| 2:19–2:23 | `Attempt 1 — rejected: native form blocked by preview sandbox.` / `No task was added — the native form submit never dispatched` | rejected generation |
| 2:23–2:28 | `Later no-op rejected · v2 remains current · not a Guard finding` | refusal card |
| 2:40–2:52 | `Decision Guard is advisory. Runtime verification is load-time only. Retrieval is not proof of causal influence outside the controlled trials.` | end card |

The Phase 15B card (2:28–2:40) carries the figures, the post-hoc label, the scope
sentence, the missing-scorer disclosure and the published-evidence pointer in the card
itself.

---

## 6. Narration and captions

| Scene | Window | Text source | TTS rate | Cues |
|---|---|---|---|---:|
| 01 | 0:00–0:14 | `production.json` | +0% | 4 |
| 02 | 0:14–0:36 | `production.json` | +0% | 6 |
| 03 | 0:36–0:56 | `production.json` | +0% | 7 |
| 04 | 0:56–1:14 | `production.json` | +9% | 8 |
| 05 | 1:14–1:36 | `production.json` | +0% | 6 |
| 06 | 1:36–1:54 | `production.json` | +0% | 7 |
| 07 | 1:54–2:12 | `production.json` | +17% | 8 |
| 08 | 2:12–2:28 | `production.json` | +18% | 6 |
| 09 | 2:28–2:40 | `production.json` | +5% | 4 |
| 10 | 2:40–2:52 | `production.json` | +0% | 3 |

Total **59 cues**, all inside their scene bounds, longest cue 55 characters. Captions
are burned into the picture with a semi-opaque plate; the same text is preserved in
`captions/captions.json`.

Narration was condensed from the storyboard table only where the written line could not
be spoken at a credible pace inside the canonical window. No required claim or
disclosure was removed; the full claims remain on the cards. The condensed lines are
scenes 4, 7, 8 and 9; this is recorded in the QA report as a production deviation from
the storyboard's prose, not from its claims.

---

## 7. Render and reproduction

Scripts (local, not committed to the application release):

```text
video/v2/scripts/narrate.py       # edge-tts narration + caption cues
video/v2/scripts/prep_images.py   # derived crops / comparison graphic
video/v2/scripts/graphics_v2.py   # cards, ribbons, spotlights, caption plates
video/v2/scripts/build_v2.py      # shots -> scenes -> captions -> concat -> mix -> encode
```

Core encode settings:

```text
ffmpeg -i picture.mp4 -i audio/mix-final.wav \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -crf 18 -preset slow -profile:v high -level 4.1 \
  -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -movflags +faststart -t 172 Muse_Recall_Demo_V2_1080p.mp4
```

Rebuild:

```bash
python3 video/v2/scripts/narrate.py
python3 video/v2/scripts/prep_images.py
python3 video/v2/scripts/graphics_v2.py
python3 video/v2/scripts/build_v2.py
```

Narration synthesis uses the Microsoft Edge TTS endpoint. No Muse key, repository
secret or personal credential is used by any script.

---

## 8. Integrity statement

- The protected MP4 is byte-identical to the recorded fallback (`656a21b2…`, 11,333,490
  bytes) before and after production.
- No file under `docs/demo/evidence/`, `docs/hackathon-evidence/` or `docs/ux-evidence/`
  was modified by video production.
- No new model inference was performed; no paid call was made.
- No credential, environment file, personal path, terminal or browser chrome appears in
  any frame. The refusal transcript is quoted with its local path removed.
- The final file was inspected after encoding, not merely assumed from a successful
  render command. See `V2_VIDEO_QA_REPORT.md`.
