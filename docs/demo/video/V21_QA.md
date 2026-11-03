# Beta demo: scope and file verification

**Current cut, published on the public paths on 4 November 2026.** The public filenames are
unchanged, so existing demo links keep working. Measures below were taken on the bytes now in this
folder with `ffprobe`/`shasum`, not copied from an editorial report.

## Current file identity

| Property | Value |
|---|---|
| Video | `Muse_Recall_Demo_V21_1080p.mp4` (= `website/public/video/muse-recall-demo.mp4`, byte-identical) |
| SHA-256 | `d1695c04fbac57779f14be7d834478b86e868291d0f326710cc62dc5fe3a440d` |
| Size | 14,903,823 bytes |
| Duration | exactly 180.000 s (3:00); 5,400 frames at 30 fps |
| Picture / sound | 1920 × 1080 H.264, faststart (`moov` before `mdat`); AAC 48 kHz stereo; 662 kbit/s overall |
| Captions | 57 cues in `Muse_Recall_Demo_V21.srt` and in the website `muse-recall-demo.en.vtt`; identical text; no overlapping cues; last cue ends at 2:59.194; also burned in |
| Transcript | `Muse_Recall_Demo_V21_Transcript.txt` (website copy: `muse-recall-demo-transcript.txt`), beat-by-beat with timecodes |
| Poster / contact sheet | `Muse_Recall_Demo_V21_Poster.jpg` 1920 × 1080 · `Muse_Recall_Demo_V21_Contact_Sheet.jpg` 1920 × 888 |
| Narration | One voice: **Bella** (Professional, Bright, Warm), generated with **Eleven v4**, one complete take, playback 1.0×, no pitch processing; −16.12 LUFS integrated, −1.42 dBFS true peak |
| Narration editing | 5.756 s removed from measured quiet pauses only; every speech sample retained; the loudest removed sample was below −64.29 dBFS; minimum preserved quiet gap 0.35 s |
| Footage | about 156.6 s of moving product or terminal footage; spoken model-role explanation starts at 1:08.6; the spoken Meta SAM sentence starts at 1:42.5 |
| Inference during this cut | 0 new Meta calls were made while assembling it; all model output shown is retained from earlier runs or a labelled deterministic fixture |

The editorial source tree, the original narration takes, the full editing timeline and the QA report
for this cut are kept **outside** the repository. The upstream `QA.json` for this cut also records a
container size of 15,040,086 bytes, which does not match the bytes now shipped
(14,903,823 B, measured above); the shipped size is the one to cite.

## What the footage supports, beat by beat

| Time | Beat | Evidence class |
|---|---|---|
| 0:00 | Owner-confirmed disclosure: no product code existed before the event; Muse Recall was built during it | owner statement |
| 0:03–1:08 | Recorded generation through the Muse Code CLI, review, rejection, a memory correction, an explicit follow-up request, then approval; model and request view enlarged; long generation waits condensed and labelled as condensed | recorded live call + retained model output |
| 1:08 | Spoken map of where Meta is used: application generation and change through the **Muse Code CLI**, media tasks through **Meta model APIs** | narration over product footage |
| 1:42 | "Meta's SAM isolates an object from a reference image. We review the transparent cutout, approve it, and insert it into an application request." | narration over product footage |
| 1:45–2:00 | The retained SAM 3.1 cutout is inspected for transparency, approved, then inserted into the next application request; the insertion/approval continuation is a **labelled replay** over the same cutout bytes, not a fresh call | retained model output + product replay |
| 2:00–2:20 | Image generation and editing with retained `muse-image-1.0` results; voice and video references shown with their playback and clip observations | retained model output; no fresh transcription is claimed by those shots |
| 2:20–2:40 | Vision-proposed decision drafts and screenshot review against selected decision revisions | deterministic fixture, labelled on screen |
| 2:40–3:00 | Memory timeline, provenance and versioned memory export/import; limits stated | retained command output + product replay |

Phase 17's 480 runs are a separate fixed-task, source-pattern experiment with its own bounds; the
demo does not restate them as app quality. Guard and screenshot review remain advisory. Human
approval remains necessary, and the approval gate checks loading — not general correctness,
accessibility, or every interaction.

## Previous cuts at the same paths (historical)

Do not cite these as the current file. Both remain in Git history at the commits named.

| Cut | Identity | Where it lives |
|---|---|---|
| 29 Oct 2026, 2:50.47 | 12,721,832 B · SHA-256 `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308` · 36 caption cues · ElevenLabs George | commit [`c32d03b`](https://github.com/sidonsoft/muse-recall/blob/c32d03b/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true); beat record in [`docs/demo/CORRECTABLE_MEMORY_DEMO.md`](../demo/CORRECTABLE_MEMORY_DEMO.md) §9 |
| 4 Nov 2026, published with the v0.1.0 release | 3:00 · 10,876,299 B · SHA-256 `6c9e985c6cfe2acdf990e8f86d9f0c92c3d75f4289d5e5cf50968f7f84dd9e8b` · 58 caption cues · ElevenLabs George, natural speed 1.0, −16.02 LUFS, −1.47 dBFS true peak | tag [`v0.1.0`](https://github.com/sidonsoft/muse-recall/blob/v0.1.0/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true) at `707921db83a374d155d3929ef9b99092bcd4e8f1` and the frozen `submission-2026-11-04` tag. The v0.1.0 GitHub Release also carries that cut as an
  asset (`Muse_Recall_Beta_Demo_3min.mp4`, 10,876,299 B) with its own `Muse_Recall_Beta_Demo.srt`
  and `Demo-Transcript.txt`; the tag object (`27e27ee…` → commit `707921d…`) and all release assets
  are unchanged |

The tag `v0.1.0` and everything published from it still carry the George-narrated 4 November cut.
`main` and the deployed website now carry the Bella / Eleven v4 recut above. Neither statement about
the older cuts is a claim about the current path.

## Reading the rest of the record

- [README limitations](../../../README.md#limitations) and [live capability records](../../MULTIMODAL_STUDIO_STATUS.md)
- [evidence map](../../submission/EVIDENCE_MAP.md) for claim-by-claim provenance
- [demo walkthrough](../CORRECTABLE_MEMORY_DEMO.md) for the earlier correction recording protocol
