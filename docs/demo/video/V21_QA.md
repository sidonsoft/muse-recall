# Beta demo: scope and file verification

Published with v0.1.0 on 4 November 2026. The existing public filenames are retained so demo links continue to work.

- Video: `Muse_Recall_Demo_V21_1080p.mp4`
- Duration: exactly 180.000 seconds; 5,400 frames at 30 fps
- Format: 1920 × 1080 H.264; AAC 48 kHz stereo
- SHA-256: `6c9e985c6cfe2acdf990e8f86d9f0c92c3d75f4289d5e5cf50968f7f84dd9e8b`
- Size: 10,876,299 bytes
- Captions: 58 cues, no overlapping cues; burned-in and SRT/VTT sidecars
- Narration: George, natural speed 1.0, no time stretching or pitch processing
- Audio: −16.02 LUFS integrated, −1.47 dBFS true peak

## What the footage supports

The demo is edited from several sources, not a continuous live session:

- The retained live palette correction demonstrates an actual stale result, an advisory Guard finding and an explicit follow-up request that succeeded. Correcting memory alone did not update the application.
- The expanded beta Studio displays retained, real Muse-generated applications and assets. Replaying them made no new model calls.
- The image generate/edit pair and SAM cutout are retained provider-returned assets. They show successful examples, not a general quality benchmark.
- The voice/video panels use uploaded reference fixtures; no fresh transcription is implied by those shots.
- Screenshot-review and revision-comparison shots use deterministic test responses. They demonstrate the interface and workflow boundaries, not live model judgement.
- Memory export/import uses actual command output. The history detail includes a retained earlier UI recording.
- Phase 17 covers 480 retained runs in fixed tasks, with usable-run denominators. It does not validate media quality, runtime safety or general correctness.

Guard and screenshot review are advisory. Human approval remains necessary, and load-time checks do not establish application quality. See the [README](../../../README.md#limitations) and [live capability records](../../MULTIMODAL_STUDIO_STATUS.md).

The downloadable video and website video are identical bytes. Editorial source files and intermediate renders are kept outside the repository.
