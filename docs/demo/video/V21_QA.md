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
| Production provenance | No inference calls were made **while assembling this cut**. That is not the same as saying the footage has no live calls: the opening minute is labelled on screen as "Recorded live Muse Spark · actual CLI requests and results", and later beats show retained media outputs, labelled product replays and deterministic review fixtures — every beat is classified below |
| Chapter boundaries below | Taken from the shipped caption cues (`Muse_Recall_Demo_V21.srt`, cue start times) and checked against frames pulled from the video, not from rounded estimates |

The editorial source tree, the original narration takes, the full editing timeline and the QA report
for this cut are kept **outside** the repository. The upstream `QA.json` for this cut also records a
container size of 15,040,086 bytes, which does not match the bytes now shipped
(14,903,823 B, measured above); the shipped size is the one to cite.

## What the footage supports, beat by beat

Times are the first caption cue of each chapter. The in-video card text is quoted so a reviewer
can confirm each label against the frame.

| Time | Beat | In-video label / what is on screen | Evidence class |
|---|---|---|---|
| 0:00.2 | Owner-confirmed disclosure: no product code existed before the event; the project was built during it | disclosure card | owner statement |
| 0:05.2 | One project decision is saved, a farm-animal memory game is requested, the staged page follows the decision, version one is approved | card: "Save the project decision. **Recorded live Muse Spark · actual CLI requests and results**"; model and request view enlarged; generation waits condensed and labelled | **recorded live call** — Muse Spark CLI request, running job, returned application |
| 0:25.1 | A fresh page with no request history asks for a Next Level button; Guard reports not verified; the change is rejected | card: "New session. Request a change. · Recorded live Muse Spark · actual CLI requests and results" | recorded live call |
| 0:34.0 | The decision is corrected: the old record becomes superseded, the replacement active, the reason stays in history | card: "Correct the decision. Keep the superseded record. · Recorded live Muse Spark · actual CLI requests and results · UI actions condensed" | recorded live call, UI actions condensed |
| 0:43.7 | The same request brings the retired palette back and Guard flags it; because Guard is advisory it does not block, so the change is rejected | card: "Repeat the request with the corrected memory. · Recorded live Muse Spark · actual CLI requests and results" | recorded live call — the real failure, kept in |
| 0:51.9 | An explicit request to follow the project's current decisions produces the corrected source; approved as version two | card: "Explicitly request the current decisions from memory. · Recorded live Muse Spark · actual CLI requests and results" | recorded live call |
| 1:08.7 | Where Meta is used: the **Muse Code CLI** generates and changes applications; **Meta media APIs** handle image generation and editing, segmentation, transcription and visual review | cards: "Where and how Meta models are used. · Running beta UI · retained real Meta-generated application", then "WHERE META IS USED": Muse Code CLI → generate and change HTML; Media APIs → image, speech and vision tasks; SAM → select objects and extract cutouts | narration over recorded product footage |
| 1:22.5 | Each decision keeps its source and history; what a generation received is inspectable; memory is exported and imported with its replacement links | card: "Keep each decision and its history visible · recorded detail of the Muse Spark actual CLI request and application output" — memory search, timeline and relationships, then a terminal running `curl … /api/memories/export` and `curl -X POST … /api/memories/import` returning `records_imported: 3, history_imported: 5, edges_imported: 1, projects_ensured: 1, dry_run: true` | recorded UI + **retained command output** (the import shown is a **dry run**) |
| 1:35.4 | References enter the same workflow: upload an image, generate one, or edit an asset | card: "Meta image models: generate and edit project assets · retained real Meta-generated outputs" | **retained model output** |
| 1:42.5 | The explicit SAM sentence: "Meta's SAM isolates an object from a reference image. We review the transparent cutout, approve it, and insert it into an application request." | card: "Meta SAM: isolate an object from a reference image · actual retained Meta SAM result" — reference image, selected object, alpha cutout on a checkerboard | **retained model output** (`sam-3.1`) |
| 1:45.9 → 1:56.9 | The cutout is inspected for transparency, approved, then carried into an application request as a `muse-asset://` reference | card: "Retained Meta result. Approval and insertion replayed here · actual retained SAM cutout · current product UI replay" | **product replay** over the same bytes — no second segmentation call |
| 1:57.3 | The media panel fills with references — uploaded and generated images plus four notes — including a 0:00:39 clip whose recorded observations say "a duck quacks at 0:20 and a wrong-answer tone plays at 0:26"; each reference can be summarised or used in a new request, and suggested decisions stay unapproved | card: "Media speech and vision: transcribe audio and inspect clips · recorded detail of upload/playback fixtures, media and preview transcription and clip generations"; burned-in caption at 2:00: "upload, play back, transcribe speech, and inspect a clip"; at 2:09: "these features help assemble the brief, they do not approve" | recorded UI: the reference clips played back here are **fixtures**, while the asset list and clip observations are recorded detail from earlier runs — none of it is a call made during editing |
| 2:12.1 | The preview is captured and that frame is reviewed against selected decision revisions; findings carry uncertainty; nothing is approved; Guard is separate and both are advisory | card: "Meta vision: review a frame against selected decisions · actual beta UI, deterministic review fixtures — not live vision judgement" | **deterministic fixture** |
| 2:30.0 | Phase 17 with its scope: Muse Spark 37/57 → 0/58, Muse Spark Open 49/60 → 1/60, 480 runs, six fixed tasks, source-code checks, 8 timeouts, and no claim of general correctness or media-quality validation | card: "Evidence has a scope. The product still needs review … Phase 17 is a separate fixed-task trial" beside the Palette Bench application | running beta UI over retained output; the trial is separate bounded evidence |
| 2:55.4 | Close: "Muse Recall. The memory your project keeps." | title card | title card |

The denominators quoted in the cut count usable runs within each model and condition,
aggregated across all six fixed task strata. For **Muse Spark**, 37/57 is the no-memory arm
and 0/58 is the retrieved-memory arm. The full experiment retained 480 runs across two models,
six strata and four arms. The cut states that it does not establish general correctness or
validate newer media features. Guard and screenshot review remain advisory; approval checks
loading rather than correctness, accessibility or every interaction.

## Previous cuts at the same paths (historical)

Do not cite these as the current file. Both remain in Git history at the commits named.

| Cut | Identity | Where it lives |
|---|---|---|
| 29 Oct 2026, 2:50.47 | 12,721,832 B · SHA-256 `4020c0c6fff3faa6b0caf4451bd921908b5fd3bf375a3b6d6407f811c913b308` · 36 caption cues · ElevenLabs George | commit [`c32d03b`](https://github.com/sidonsoft/muse-recall/blob/c32d03b/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true); beat record in [`docs/demo/CORRECTABLE_MEMORY_DEMO.md`](../CORRECTABLE_MEMORY_DEMO.md) §9 |
| 4 Nov 2026, published with the v0.1.0 release | 3:00 · 10,876,299 B · SHA-256 `6c9e985c6cfe2acdf990e8f86d9f0c92c3d75f4289d5e5cf50968f7f84dd9e8b` · 58 caption cues · ElevenLabs George, natural speed 1.0, −16.02 LUFS, −1.47 dBFS true peak | tag [`v0.1.0`](https://github.com/sidonsoft/muse-recall/blob/v0.1.0/docs/demo/video/Muse_Recall_Demo_V21_1080p.mp4?raw=true) at `707921db83a374d155d3929ef9b99092bcd4e8f1`. The v0.1.0 GitHub Release also carries that cut as an asset (`Muse_Recall_Beta_Demo_3min.mp4`, 10,876,299 B) with its own `Muse_Recall_Beta_Demo.srt` and `Demo-Transcript.txt`; the tag object (`27e27ee…` → commit `707921d…`) and all release assets are unchanged |

**No `submission-2026-11-04` tag exists on the remote.** `git ls-remote --tags origin` lists
`v0.1.0`, `submission-v14`, `submission-v15`, `phase17-preregistration` and `archive/*` tags —
nothing for a 4 November submission tree. The [roadmap](../../roadmap/POST_HACKATHON_ROADMAP.md)
and [preservation manifest](../../release/SUBMISSION_PRESERVATION.md) describe such a tag as work
still to do ("to record"), and [`docs/release/notes/submission-2026-11-04.md`](../../release/notes/submission-2026-11-04.md)
is an unpublished template. Nothing in this record depends on that tag. The submission itself is a
separate fact, and it happened: the original entry was confirmed at 2026-10-29T11:01:12Z and the
beta update to it was verified persisted at 2026-11-04T01:30:03Z by reloading the submission page.
Neither reading recorded the commit behind the entry, so a tag naming the **submitted** tree stays
open as a missing-fact problem, not a missing-submission problem. Preserving the `main` snapshot
that was observed during the 4 November verification (`5770303…`, archived and checksummed,
unpublished) is a separate act and does not wait on that fact — see the manifest's "What
preservation can and cannot mean now". The previous cut
is reachable at `v0.1.0` and through `main`'s history at
`707921db83a374d155d3929ef9b99092bcd4e8f1`, not through a submission tag.

The tag `v0.1.0` and everything published from it still carry the George-narrated 4 November cut.
`main` and the deployed website now carry the Bella / Eleven v4 recut above. Neither statement about
the older cuts is a claim about the current path.

## Reading the rest of the record

- [README limitations](../../../README.md#limitations) and [live capability records](../../MULTIMODAL_STUDIO_STATUS.md)
- [evidence map](../../submission/EVIDENCE_MAP.md) for claim-by-claim provenance
- [demo walkthrough](../CORRECTABLE_MEMORY_DEMO.md) for the earlier correction recording protocol
