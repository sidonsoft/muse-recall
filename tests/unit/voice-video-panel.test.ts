import type { MediaClipResponse, MediaSourceRecordView, MediaTranscript } from '@mml/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  encodeWav,
  sourceMimeForFile,
  VoiceVideoPanel,
} from '../../apps/web/src/components/studio/VoiceVideoPanel.tsx';
import {
  clipTarget,
  initialState,
  sourceKey,
  transcriptTarget,
  type VoiceVideoState,
  voiceVideoReducer,
} from '../../apps/web/src/components/studio/voice-video-state.ts';

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return Array.from(bytes.subarray(start, start + length))
    .map((value) => String.fromCharCode(value))
    .join('');
}

describe('VoiceVideoPanel helpers', () => {
  it('encodes mono 16-bit PCM WAV at the provider sample rate', () => {
    const inputRate = 48_000;
    const samples = new Float32Array(inputRate);
    samples.fill(0.25);
    const wav = encodeWav([samples], inputRate);
    const view = new DataView(wav.buffer);
    expect(readAscii(wav, 0, 4)).toBe('RIFF');
    expect(readAscii(wav, 8, 4)).toBe('WAVE');
    expect(readAscii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(24_000 * 2);
    expect(view.getInt16(44, true)).toBe(Math.trunc(0.25 * 0x7fff));
    expect(wav.byteLength).toBe(44 + 24_000 * 2);
  });

  it('resamples and rejects empty or invalid input', () => {
    const wav = encodeWav([new Float32Array(24_000).fill(-0.5)], 24_000);
    expect(wav.byteLength).toBe(44 + 24_000 * 2);
    expect(() => encodeWav([], 48_000)).toThrow(/empty/);
    expect(() => encodeWav([new Float32Array(10)], 0)).toThrow(/sample rate/);
  });

  it('accepts only WAV audio and MP4 video by type or extension', () => {
    expect(sourceMimeForFile({ name: 'note.wav', type: '' })).toBe('audio/wav');
    expect(sourceMimeForFile({ name: 'note', type: 'audio/x-wav' })).toBe('audio/wav');
    expect(sourceMimeForFile({ name: 'clip.mp4', type: '' })).toBe('video/mp4');
    expect(sourceMimeForFile({ name: 'clip.mov', type: 'video/quicktime' })).toBeNull();
    expect(sourceMimeForFile({ name: 'clip.webm', type: 'video/webm' })).toBeNull();
  });
});

describe('VoiceVideoPanel', () => {
  it('renders the empty state with bounded capture and no automatic provider call', () => {
    const html = renderToStaticMarkup(createElement(VoiceVideoPanel, { projectId: 'alpha' }));
    expect(html).toContain('Voice &amp; video');
    expect(html).toContain('Record voice');
    expect(html).toContain('Upload WAV/MP4');
    expect(html).toContain('Nothing is sent to a model until you press Transcribe or Inspect clip');
    expect(html).toContain('Record a voice note or upload a WAV/MP4 to begin.');
    expect(html).not.toContain('Propose transcript');
    expect(html).toContain('24 kHz');
    expect(html).toContain('3 minutes');
  });
});

const PROJECT = 'alpha';
const OTHER_PROJECT = 'beta';
const AUDIO_A = '11111111-1111-4111-8111-111111111111';
const AUDIO_B = '22222222-2222-4222-8222-222222222222';
const AUDIO_C = '33333333-3333-4333-8333-333333333333';
const VIDEO_A = '44444444-4444-4444-8444-444444444444';
const VIDEO_B = '55555555-5555-4555-8555-555555555555';

function record(
  sourceId: string,
  kind: 'audio' | 'video',
  projectId = PROJECT,
): MediaSourceRecordView {
  return {
    source_id: sourceId,
    project_id: projectId,
    kind,
    mime: kind === 'audio' ? 'audio/wav' : 'video/mp4',
    duration_ms: 1_000,
    byte_size: 1_024,
    sha256: 'a'.repeat(64),
    origin: 'upload',
    original_name: null,
    created_at: '2026-11-01T00:00:00.000Z',
  };
}

function transcript(sourceId: string, text = 'A draft.'): MediaTranscript {
  return {
    source_id: sourceId,
    transcript: text,
    turns: [],
    duration_ms: 1_000,
    audio_duration_ms: 1_000,
    model: 'muse-voice-transcribe-1.0',
    observed_model: null,
    session_id: null,
    provider_attempts: 1,
  };
}

function clip(sourceId: string): MediaClipResponse {
  return {
    source_id: sourceId,
    duration_ms: 1_000,
    observations: [
      { observation: 'A card is visible.', start_ms: 0, end_ms: 500, confidence: 0.8 },
    ],
    model: 'muse-spark-1.3',
    observed_model: null,
    provider_attempts: 2,
    file_id: 'file-test',
  };
}

function loaded(items: MediaSourceRecordView[]): VoiceVideoState {
  return voiceVideoReducer(initialState(PROJECT), {
    type: 'sourcesLoaded',
    projectId: PROJECT,
    items,
  });
}

function start(state: VoiceVideoState): { state: VoiceVideoState; token: number } {
  const token = state.operationToken + 1;
  return {
    state: voiceVideoReducer(state, { type: 'operationStarted', token }),
    token,
  };
}

function select(state: VoiceVideoState, sourceId: string, projectId = PROJECT): VoiceVideoState {
  return voiceVideoReducer(state, {
    type: 'select',
    token: state.operationToken + 1,
    projectId,
    sourceId,
  });
}

describe('source-bound panel state', () => {
  it('clears drafts on a same-kind source switch and ignores the old transcript', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    const first = start(state);
    state = first.state;
    state = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: first.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A),
    });
    expect(transcriptTarget(state)?.key.source_id).toBe(AUDIO_A);

    state = select(state, AUDIO_B);
    expect(state.activeId).toBe(AUDIO_B);
    expect(state.transcript).toBeNull();
    expect(state.busy).toBe(false);
    expect(transcriptTarget(state)).toBeNull();

    const afterSwitch = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: first.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A, 'Stale text.'),
    });
    expect(afterSwitch.transcript).toBeNull();
    expect(transcriptTarget(afterSwitch)).toBeNull();
  });

  it('binds an upload selection to the new source and drops old drafts', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    const old = start(state);
    state = old.state;
    state = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: old.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A),
    });

    const upload = start(state);
    state = upload.state;
    state = voiceVideoReducer(state, {
      type: 'uploadSucceeded',
      token: upload.token,
      record: record(AUDIO_C, 'audio'),
    });
    expect(state.activeId).toBe(AUDIO_C);
    expect(state.transcript).toBeNull();
    expect(state.sources[0]?.source_id).toBe(AUDIO_C);
    expect(transcriptTarget(state)).toBeNull();

    state = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: old.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A, 'Stale text.'),
    });
    expect(state.transcript).toBeNull();

    const fresh = start(state);
    state = voiceVideoReducer(fresh.state, {
      type: 'transcriptLoaded',
      token: fresh.token,
      key: sourceKey(PROJECT, AUDIO_C),
      transcript: transcript(AUDIO_C, 'Fresh text.'),
    });
    expect(transcriptTarget(state)).toMatchObject({
      key: { project_id: PROJECT, source_id: AUDIO_C },
      text: 'Fresh text.',
    });
  });

  it('clears a draft when a refresh drops the active source and picks another', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    state = select(state, AUDIO_B);
    const op = start(state);
    state = voiceVideoReducer(op.state, {
      type: 'transcriptLoaded',
      token: op.token,
      key: sourceKey(PROJECT, AUDIO_B),
      transcript: transcript(AUDIO_B),
    });
    expect(transcriptTarget(state)?.key.source_id).toBe(AUDIO_B);

    state = voiceVideoReducer(state, {
      type: 'sourcesLoaded',
      projectId: PROJECT,
      items: [record(AUDIO_A, 'audio')],
    });
    expect(state.activeId).toBe(AUDIO_A);
    expect(state.transcript).toBeNull();
    expect(state.busy).toBe(false);
    expect(transcriptTarget(state)).toBeNull();
  });

  it('ignores a delayed clip result after switching between two videos', () => {
    let state = loaded([record(VIDEO_A, 'video'), record(VIDEO_B, 'video')]);
    const first = start(state);
    state = first.state;
    state = voiceVideoReducer(state, {
      type: 'clipLoaded',
      token: first.token,
      key: sourceKey(PROJECT, VIDEO_A),
      clip: clip(VIDEO_A),
    });
    expect(clipTarget(state)?.key.source_id).toBe(VIDEO_A);

    state = select(state, VIDEO_B);
    expect(state.clip).toBeNull();
    state = voiceVideoReducer(state, {
      type: 'clipLoaded',
      token: first.token,
      key: sourceKey(PROJECT, VIDEO_A),
      clip: clip(VIDEO_A),
    });
    expect(state.clip).toBeNull();
    expect(clipTarget(state)).toBeNull();

    const second = start(state);
    state = voiceVideoReducer(second.state, {
      type: 'clipLoaded',
      token: second.token,
      key: sourceKey(PROJECT, VIDEO_B),
      clip: clip(VIDEO_B),
    });
    expect(clipTarget(state)?.key.source_id).toBe(VIDEO_B);
  });

  it('does not let an obsolete completion clear a newer busy state', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    const first = start(state);
    state = select(first.state, AUDIO_B);
    const second = start(state);
    state = second.state;
    expect(state.busy).toBe(true);

    state = voiceVideoReducer(state, { type: 'operationFinished', token: first.token });
    expect(state.busy).toBe(true);
    state = voiceVideoReducer(state, {
      type: 'operationFailed',
      token: first.token,
      notice: { tone: 'err', text: 'Stale failure.' },
    });
    expect(state.busy).toBe(true);
    expect(state.notice).toBeNull();

    state = voiceVideoReducer(state, { type: 'operationFinished', token: second.token });
    expect(state.busy).toBe(false);
  });

  it('keeps busy correct when a refresh token coincides with the next operation', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    state = select(state, AUDIO_B);
    state = voiceVideoReducer(state, {
      type: 'sourcesLoaded',
      projectId: PROJECT,
      items: [record(AUDIO_A, 'audio')],
    });
    const token = state.operationToken;
    state = voiceVideoReducer(state, { type: 'operationStarted', token });
    expect(state.busy).toBe(true);
    state = voiceVideoReducer(state, { type: 'operationFinished', token });
    expect(state.busy).toBe(false);
  });

  it('clears drafts and rejects old results across a project switch', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    const first = start(state);
    state = first.state;
    state = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: first.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A),
    });

    state = voiceVideoReducer(state, {
      type: 'resetProject',
      token: state.operationToken + 1,
      projectId: OTHER_PROJECT,
    });
    expect(state).toMatchObject({
      projectId: OTHER_PROJECT,
      sources: [],
      activeId: null,
      transcript: null,
      clip: null,
    });

    const staleProjectList = voiceVideoReducer(state, {
      type: 'sourcesLoaded',
      projectId: PROJECT,
      items: [record(AUDIO_A, 'audio')],
    });
    expect(staleProjectList).toBe(state);
    const staleResult = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: first.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A),
    });
    expect(staleResult).toBe(state);
    expect(transcriptTarget(staleResult)).toBeNull();

    state = voiceVideoReducer(state, {
      type: 'sourcesLoaded',
      projectId: OTHER_PROJECT,
      items: [record(AUDIO_A, 'audio', OTHER_PROJECT)],
    });
    expect(state.activeId).toBe(AUDIO_A);
    expect(state.projectId).toBe(OTHER_PROJECT);
  });

  it('refuses a proposal target after the active source changes', () => {
    let state = loaded([record(AUDIO_A, 'audio'), record(AUDIO_B, 'audio')]);
    const first = start(state);
    state = first.state;
    state = voiceVideoReducer(state, {
      type: 'transcriptLoaded',
      token: first.token,
      key: sourceKey(PROJECT, AUDIO_A),
      transcript: transcript(AUDIO_A),
    });
    expect(transcriptTarget(state)).not.toBeNull();

    state = select(state, AUDIO_B);
    expect(transcriptTarget(state)).toBeNull();
  });
});
