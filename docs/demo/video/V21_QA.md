# V21 demo QA — no spoken color codes, no spoken fractions

**Recorded:** 2026-10-29 08:18–08:21 Australia/Brisbane (2026-10-28 22:18–22:21 UTC)
**Cut finished:** 2026-10-29 09:45 Australia/Brisbane
**Video:** `Muse_Recall_Demo_V21_1080p.mp4`
**Duration:** 170.47 s (2:50.47)
**Format:** 1920×1080, 30 fps, H.264, AAC 48 kHz stereo
**SHA-256:** `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308`
**Size:** 12,721,832 bytes
**Captions:** burned in; sidecar `Muse_Recall_Demo_V21.srt` (36 cues)
**Contact sheet:** `Muse_Recall_Demo_V21_Contact_Sheet.jpg`
**Poster:** `Muse_Recall_Demo_V21_Poster.jpg`

**Committed to the repository** under `docs/demo/video/` on 2026-10-29, after the owner lifted
the earlier out-of-git policy. The file above is the V21 cut byte for byte.

## 1. Voice

| | |
|---|---|
| Provider | ElevenLabs |
| Voice | George (`JBFqnCBsd6RMkjVDRZzb`) |
| Model | `eleven_multilingual_v2` |
| Settings | stability 0.62 · similarity 0.80 · style 0.10 · speaker boost on · speed 0.97 |
| Narration | 377 words, seven segments |
| Voice duration | 144.475 s |
| Processing | 48 kHz stereo, loudness normalized to −16 LUFS; no voice time-stretch |
| Mix | mean −20.3 dB, max −1.4 dB; audio starts at 0:08 |

### Readability changes

- **No spoken color codes.** The narration says “soft coral accent and dark text” and “clear
  blue accent and deep navy text.” It does not read `#FF7E5F`, `#2D1E2F`, `#4EA8DE` or `#102A43`.
- **No spoken slash fractions.** The evidence sentence now says “thirty-seven of fifty-seven to
  zero of fifty-eight on Muse Spark, and forty-nine of sixty to one of sixty on Muse Spark Open.”
  It does not say “one sixty.”
- **“Sunset hex” is gone** from the spoken script; it says “the sunset color is gone.”
- The cards still show the actual hex tokens as source evidence. They are visual evidence, not
  narration.
- Captions come from ElevenLabs character timestamps; the long evidence sentence is split at
  the comma into two readable cues.

## 2. Live session

| | |
|---|---|
| Model | `muse-spark-1.3-contributor`, effort `high` |
| CLI | Muse Code 1.4.14 |
| API | production build on `127.0.0.1:8899`, isolated `/tmp` database and workspace |
| Web | production Vite preview on `127.0.0.1:5201` |
| Project | `hackathon-demo-v17` |
| v1 generation | job `21501dcb-4f14-4782-b598-2aa8a8922d74` |
| First Next Level change (sunset) | job `a7a38864-497e-429a-81d9-ab868a4bf724` |
| Repeat after correction | job `793f8315-97d6-418d-a88a-d4b1b3262218` |
| Theme request | `e9fe9cd3-487b-41b6-9a43-ac3722d91785` |
| Final versions | v1 (`base_version: null`), v2 (`base_version: 1`); v2 current |

### Source checks

| Stage | Sunset hex | Ocean hex | Guard |
|---|---:|---:|---|
| v1 generation | 2 | 0 | `NOT VERIFIED` |
| First Next Level change | 2 | 0 | `NOT VERIFIED` |
| Repeat Next Level after correction | 2 | 0 | `VIOLATION DETECTED` — `superseded-palette` |
| Theme request after correction | 0 | 3 | `NO VIOLATION DETECTED · SUPPORTED CHECKS` |

The repeat request still used the old palette; that failure remains in the cut. The next request
explicitly asked for the project’s current art direction from memory; it produced ocean, and v2
was approved.

## 3. Edit and pacing

- Continuous 1920×1080 Playwright screen recording with a visible cursor, typing and scrolling.
  Raw recording: 185.84 s.
- Generation waits are speed-ramped (6×–12×); UI actions remain at normal speed except the
  correction section, slowed to 0.75× for readability.
- Card inserts: title/problem/saved-constraint/first-change source/memory/Guard/history/ocean
  source/evidence/limits/end. The workflow itself is live footage.
- Picture was rebuilt around the ElevenLabs durations. The shorter s1/s3 reads are not padded with old
  voice; scene lengths, the saved-decision hold, the memory hold and the approval card were
  recomputed.
- 36 captions; the evidence sentence is split at the comma when it needs two cues.

## 4. What to review

| Time | Beat |
|---|---|
| 0:00 | New intro: the second week is the hard part |
| 0:08 | Problem statement; live Studio montage |
| 0:25 | Save the sunset constraint; generate; approve v1 |
| 0:43 | New session; request Next Level; sunset source; Guard `NOT VERIFIED`; reject |
| 0:58 | Correct to ocean; sunset superseded; ocean active |
| 1:13 | Repeat request; sunset returns; Guard flags `superseded-palette`; reject |
| 1:31 | Ask for current art direction from memory; ocean; Guard clean |
| 1:49 | Approve v2; version history v1/v2 |
| 1:58 | Phase 17 evidence card, with the Phase 12A replacement distinction |
| 2:32 | Limits card; closing brand card |

## 5. Honest limits

- One live project, one app, one correction. This is a demo, not a general correctness claim.
- The repeat request did not apply the corrected palette. The model needed an explicit theme
  request; Guard caught the stale palette, but Guard is advisory and did not block approval.
- The detectors read source code; they do not play the game or test runtime safety.
- One live run; no new-instruction detector was run.
- The cut is edited from a live screen recording, with static inserts for the saved decision,
  source detail, memory, Guard, history and evidence. It is not an unedited screen capture.
- No Phase 17, evidence, tag, submission or application source file was modified.

## 6. V20 → V21

- Subtitle changed from “what this demo supports” to **“what this evidence supports.”**
- The left workflow line now ends **“(one project, one correction)”**.
- Right-column line changed from “Automatic correction” to **“Applying the new preference
  unprompted: the repeat request still used sunset.”** This avoids implying the correction
  feature itself does not work.
- Added BT.709 colour tags (`color_range=tv`, `colorspace=bt709`, `color_primaries=bt709`,
  `color_transfer=bt709`).
- Audio and captions are unchanged; the card is still eight seconds.
- Tracked docs were scrubbed of video version numbers and dead `release-deliverables/` links.
