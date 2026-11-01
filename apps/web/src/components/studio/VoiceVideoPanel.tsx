import {
  MEDIA_AUDIO_MAX_BYTES,
  MEDIA_AUDIO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_BYTES,
  type MediaClipObservation,
  type MediaProposalMemoryType,
  type MediaSourceMime,
  type MediaTranscribeMode,
} from '@mml/shared';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { Icon } from '../Icon.tsx';
import { playbackMessage, useSourceDownload, useSourcePlayback } from './source-playback.ts';
import {
  clipTarget,
  initialState,
  transcriptTarget,
  type VoiceVideoNotice,
  voiceVideoReducer,
} from './voice-video-state.ts';

/**
 * Voice and video studio (Batch D).
 *
 * Voice is captured in the browser as mono 16-bit PCM WAV (24 kHz) so the
 * upload already matches the documented transcription contract. A WAV file
 * download is always available, and a WAV/MP4 file picker is the fallback
 * when microphone permission is unavailable.
 *
 * Transcription and clip understanding produce DRAFTS. Nothing is written to
 * project memory until the person edits the text, selects observations, and
 * presses Propose. Proposals are stored with status `proposed`; retrieval
 * ignores them until a reviewer accepts them in Memory Review.
 *
 * Every draft and in-flight result is bound to its exact project and source.
 * Switching sources, uploading, or changing project clears drafts and advances
 * an operation token, so a late response cannot be shown or proposed against
 * a different source.
 */

const TARGET_SAMPLE_RATE = 24_000;
const MIN_RECORDING_SECONDS = 0.25;
const PROPOSAL_TYPES: MediaProposalMemoryType[] = [
  'preference',
  'constraint',
  'technical_decision',
  'project',
  'goal',
];

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Linear-interpolated mono WAV encoding; exported for deterministic tests. */
export function encodeWav(
  chunks: Float32Array[],
  inputRate: number,
  targetRate = TARGET_SAMPLE_RATE,
): Uint8Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0) {
    throw new Error('Recording sample rate is invalid.');
  }
  const totalInput = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (totalInput === 0) throw new Error('The recording is empty.');
  const frames = Math.max(1, Math.round((totalInput / inputRate) * targetRate));
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frames * 2, true);
  const ratio = inputRate / targetRate;
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const source = frame * ratio;
    const lower = Math.floor(source);
    const upper = Math.min(totalInput - 1, lower + 1);
    const mix = source - lower;
    const a = sampleAt(chunks, lower);
    const b = sampleAt(chunks, upper);
    const value = Math.max(-1, Math.min(1, a + (b - a) * mix));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return bytes;
}

function trimChunks(chunks: Float32Array[], maxSamples: number): Float32Array[] {
  let remaining = maxSamples;
  const kept: Float32Array[] = [];
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    if (chunk.length <= remaining) {
      kept.push(chunk);
      remaining -= chunk.length;
    } else {
      kept.push(chunk.subarray(0, remaining));
      remaining = 0;
    }
  }
  return kept;
}

function sampleAt(chunks: Float32Array[], index: number): number {
  let remaining = index;
  for (const chunk of chunks) {
    if (remaining < chunk.length) return chunk[remaining] ?? 0;
    remaining -= chunk.length;
  }
  return 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('The file could not be read.'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function sourceMimeForFile(file: { name: string; type: string }): MediaSourceMime | null {
  const name = file.name.toLowerCase();
  if (file.type === 'audio/wav' || file.type === 'audio/x-wav' || name.endsWith('.wav')) {
    return 'audio/wav';
  }
  if (file.type === 'video/mp4' || name.endsWith('.mp4')) return 'video/mp4';
  return null;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return seconds >= 60
    ? `${String(Math.floor(seconds / 60))}m ${(seconds % 60).toFixed(1)}s`
    : `${seconds.toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_024))} KB`;
}

function RecordingControls({
  recording,
  elapsedMs,
  busy,
  onStart,
  onStop,
}: {
  recording: boolean;
  elapsedMs: number;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={recording ? onStop : onStart}
        className={`rounded px-2 py-1 text-[10.5px] font-medium disabled:opacity-50 ${
          recording ? 'border border-err/60 bg-err/10 text-err' : 'bg-accent text-accent-ink'
        }`}
      >
        {recording ? 'Stop & use' : 'Record voice'}
      </button>
      {recording ? (
        <span className="font-mono text-[10px] text-err">
          {formatDuration(elapsedMs)} / {formatDuration(MEDIA_AUDIO_MAX_DURATION_MS)}
        </span>
      ) : null}
    </div>
  );
}

export function VoiceVideoPanel({ projectId }: { projectId: string }) {
  const [state, dispatch] = useReducer(voiceVideoReducer, projectId, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seqRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [mode, setMode] = useState<MediaTranscribeMode>('PUSH_TO_TALK');

  const stateMatchesProject = state.projectId === projectId;
  const sources = stateMatchesProject ? state.sources : [];
  const activeId = stateMatchesProject ? state.activeId : null;
  const busy = stateMatchesProject ? state.busy : false;
  const notice: VoiceVideoNotice | null = stateMatchesProject ? state.notice : null;
  const transcriptDraft = stateMatchesProject ? transcriptTarget(state) : null;
  const clipDraft = stateMatchesProject ? clipTarget(state) : null;
  const clipPrompt = stateMatchesProject ? state.clipPrompt : '';
  const transcript = transcriptDraft?.transcript ?? null;
  const transcriptText = transcriptDraft?.text ?? '';
  const transcriptType = transcriptDraft?.memoryType ?? 'technical_decision';
  const clip = clipDraft?.clip ?? null;
  const selectedClips = clipDraft?.selected ?? [];
  const clipType = clipDraft?.memoryType ?? 'preference';
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recordingRef = useRef(false);
  const chunksRef = useRef<Float32Array[]>([]);
  const inputRateRef = useRef(TARGET_SAMPLE_RATE);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const active = sources.find((source) => source.source_id === activeId) ?? null;
  // Bytes come through the API client (bearer header included when stored) and
  // reach the element as a blob: URL, so playback and download work under
  // ACCESS_TOKEN without a token ever appearing in a URL.
  const playback = useSourcePlayback(projectId, active?.source_id ?? null);
  const sourceDownload = useSourceDownload(
    projectId,
    active?.source_id ?? null,
    active?.mime ?? null,
  );

  const advanceToken = useCallback((): number => {
    const token = Math.max(seqRef.current, stateRef.current.operationToken) + 1;
    seqRef.current = token;
    return token;
  }, []);

  const beginOperation = useCallback((): number => {
    const token = advanceToken();
    dispatch({ type: 'operationStarted', token });
    return token;
  }, [advanceToken]);

  const releaseCapture = useCallback(async () => {
    recordingRef.current = false;
    const context = contextRef.current;
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    if (context !== null && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    setRecording(false);
    setElapsedMs(0);
    chunksRef.current = [];
    void releaseCapture();
    const token = advanceToken();
    dispatch({ type: 'resetProject', token, projectId });
    let cancelled = false;
    void api
      .mediaSources(projectId)
      .then((list) => {
        if (cancelled) return;
        dispatch({ type: 'sourcesLoaded', projectId, items: list.items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatch({ type: 'notice', notice: { tone: 'err', text: messageOf(error) } });
      });
    return () => {
      cancelled = true;
    };
  }, [advanceToken, projectId, releaseCapture]);

  useEffect(() => {
    return () => {
      void releaseCapture();
    };
  }, [releaseCapture]);

  const upload = useCallback(
    async (
      token: number,
      mime: MediaSourceMime,
      dataBase64: string,
      origin: 'upload' | 'recording',
      originalName: string,
    ): Promise<void> => {
      try {
        const record = await api.mediaSourceUpload(projectId, {
          mime,
          dataBase64,
          origin,
          originalName,
        });
        dispatch({ type: 'uploadSucceeded', token, record });
      } catch (error) {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      } finally {
        dispatch({ type: 'operationFinished', token });
      }
    },
    [projectId],
  );

  const stopRecording = useCallback(
    async (keep: boolean): Promise<void> => {
      const chunks = chunksRef.current;
      const rate = inputRateRef.current;
      chunksRef.current = [];
      setRecording(false);
      setElapsedMs(0);
      await releaseCapture();
      if (!keep) return;
      const maxSamples = Math.floor((rate * MEDIA_AUDIO_MAX_DURATION_MS) / 1000);
      const captured = trimChunks(chunks, maxSamples);
      const samples = captured.reduce((total, chunk) => total + chunk.length, 0);
      if (samples < rate * MIN_RECORDING_SECONDS) {
        dispatch({
          type: 'notice',
          notice: { tone: 'err', text: 'The recording was too short to use.' },
        });
        return;
      }
      const token = beginOperation();
      dispatch({ type: 'notice', notice: null });
      try {
        const wav = encodeWav(captured, rate);
        if (wav.byteLength > MEDIA_AUDIO_MAX_BYTES) {
          dispatch({
            type: 'operationFailed',
            token,
            notice: { tone: 'err', text: 'The recording exceeds the 16 MB audio limit.' },
          });
          return;
        }
        await upload(token, 'audio/wav', bytesToBase64(wav), 'recording', 'recording.wav');
      } catch (error) {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      }
    },
    [beginOperation, releaseCapture, upload],
  );

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= MEDIA_AUDIO_MAX_DURATION_MS && recordingRef.current) {
        void stopRecording(true);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [recording, stopRecording]);

  const startRecording = useCallback(async (): Promise<void> => {
    dispatch({ type: 'notice', notice: null });
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      dispatch({
        type: 'notice',
        notice: {
          tone: 'err',
          text: 'Microphone capture is unavailable here. Upload a mono 16-bit PCM WAV instead.',
        },
      });
      return;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor === undefined) {
      dispatch({
        type: 'notice',
        notice: {
          tone: 'err',
          text: 'Web Audio capture is unavailable here. Upload a mono 16-bit PCM WAV instead.',
        },
      });
      return;
    }
    const token = beginOperation();
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContextCtor();
      await context.resume();
      if (token !== seqRef.current || token !== stateRef.current.operationToken) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        await context.close().catch(() => undefined);
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      chunksRef.current = [];
      inputRateRef.current = context.sampleRate;
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      contextRef.current = context;
      streamRef.current = stream;
      startedAtRef.current = Date.now();
      recordingRef.current = true;
      setRecording(true);
      setElapsedMs(0);
    } catch (error) {
      recordingRef.current = false;
      chunksRef.current = [];
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (context !== null && context.state !== 'closed') {
        await context.close().catch(() => undefined);
      }
      dispatch({
        type: 'operationFailed',
        token,
        notice: {
          tone: 'err',
          text: `Microphone unavailable (${messageOf(error)}). Upload a WAV file instead.`,
        },
      });
      return;
    } finally {
      dispatch({ type: 'operationFinished', token });
    }
  }, [beginOperation]);

  const pickFile = (file: File | undefined): void => {
    if (!file) return;
    const mime = sourceMimeForFile(file);
    if (mime === null) {
      dispatch({
        type: 'notice',
        notice: {
          tone: 'err',
          text: 'Unsupported file. Use mono 16-bit PCM WAV (16/24 kHz) or an MP4 video.',
        },
      });
      return;
    }
    const limit = mime === 'audio/wav' ? MEDIA_AUDIO_MAX_BYTES : MEDIA_VIDEO_MAX_BYTES;
    if (file.size > limit) {
      dispatch({
        type: 'notice',
        notice: {
          tone: 'err',
          text: `${mime === 'audio/wav' ? 'Audio' : 'Video'} is ${formatBytes(file.size)}; the limit is ${formatBytes(limit)}.`,
        },
      });
      return;
    }
    const token = beginOperation();
    dispatch({ type: 'notice', notice: null });
    void readFileBase64(file)
      .then((data) => upload(token, mime, data, 'upload', file.name))
      .catch((error: unknown) => {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      });
  };

  const selectSource = (sourceId: string): void => {
    if (sourceId === activeId) return;
    const token = advanceToken();
    dispatch({ type: 'select', token, projectId, sourceId });
  };

  const transcribe = (): void => {
    if (active === null || active.kind !== 'audio') return;
    const key = { project_id: projectId, source_id: active.source_id };
    const token = beginOperation();
    dispatch({ type: 'notice', notice: null });
    void api
      .mediaSourceTranscribe(projectId, active.source_id, { mode })
      .then((result) => {
        dispatch({ type: 'transcriptLoaded', token, key, transcript: result });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      })
      .finally(() => {
        dispatch({ type: 'operationFinished', token });
      });
  };

  const understand = (): void => {
    if (active === null || active.kind !== 'video') return;
    const key = { project_id: projectId, source_id: active.source_id };
    const token = beginOperation();
    dispatch({ type: 'notice', notice: null });
    void api
      .mediaSourceClip(
        projectId,
        active.source_id,
        clipPrompt.trim().length > 0 ? clipPrompt.trim() : undefined,
      )
      .then((result) => {
        dispatch({ type: 'clipLoaded', token, key, clip: result });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      })
      .finally(() => {
        dispatch({ type: 'operationFinished', token });
      });
  };

  const proposeTranscript = (): void => {
    const draft = transcriptTarget(stateRef.current);
    if (draft === null || draft.key.project_id !== projectId) return;
    const content = draft.text.trim();
    if (content.length === 0) return;
    const token = beginOperation();
    dispatch({ type: 'notice', notice: null });
    void api
      .mediaSourcePropose(draft.key.project_id, draft.key.source_id, [
        { kind: 'transcript', memory_type: draft.memoryType, content },
      ])
      .then((result) => {
        dispatch({
          type: 'operationSucceeded',
          token,
          notice: {
            tone: 'ok',
            text: `Recorded ${String(result.proposed.length)} proposal(s). They stay proposed until accepted in Memory Review.`,
          },
        });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      })
      .finally(() => {
        dispatch({ type: 'operationFinished', token });
      });
  };

  const proposeClips = (): void => {
    const draft = clipTarget(stateRef.current);
    if (draft === null || draft.key.project_id !== projectId) return;
    const chosen = draft.clip.observations.filter((_item, index) => draft.selected.includes(index));
    if (chosen.length === 0) return;
    const proposals = chosen.map((observation) => ({
      kind: 'clip_observation' as const,
      memory_type: draft.memoryType,
      content: observation.observation,
      start_ms: observation.start_ms,
      end_ms: observation.end_ms,
    }));
    const token = beginOperation();
    dispatch({ type: 'notice', notice: null });
    void api
      .mediaSourcePropose(draft.key.project_id, draft.key.source_id, proposals)
      .then((result) => {
        dispatch({
          type: 'operationSucceeded',
          token,
          notice: {
            tone: 'ok',
            text: `Recorded ${String(result.proposed.length)} proposal(s). They stay proposed until accepted in Memory Review.`,
          },
        });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'operationFailed',
          token,
          notice: { tone: 'err', text: messageOf(error) },
        });
      })
      .finally(() => {
        dispatch({ type: 'operationFinished', token });
      });
  };

  const toggleClip = (index: number): void => {
    if (clipDraft === null) return;
    dispatch({ type: 'clipToggled', key: clipDraft.key, index });
  };

  return (
    <section aria-label="Voice and video" className="panel shrink-0">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="mic" className="size-3.5 text-muted" />
          Voice &amp; video
        </h2>
        <span className="font-mono text-[10px] text-muted">{sources.length}</span>
      </div>

      <div className="space-y-2 border-b border-line/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <RecordingControls
            recording={recording}
            elapsedMs={elapsedMs}
            busy={busy}
            onStart={() => void startRecording()}
            onStop={() => void stopRecording(true)}
          />
          <button
            type="button"
            disabled={busy || recording}
            onClick={() => fileInput.current?.click()}
            className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-dim disabled:opacity-50"
          >
            Upload WAV/MP4
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/wav,audio/x-wav,video/mp4,.wav,.mp4"
            className="sr-only"
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        <p className="text-[10px] leading-4 text-muted">
          Audio is mono 16-bit PCM WAV at 24 kHz, up to 3 minutes / 16 MB. Video is MP4, up to 30
          seconds / 32 MB. Nothing is sent to a model until you press Transcribe or Inspect clip.
        </p>
        {notice ? (
          <p className={`text-[10.5px] ${notice.tone === 'ok' ? 'text-ok' : 'text-err'}`}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <ul className="max-h-40 divide-y divide-line/70 overflow-y-auto">
        {sources.length === 0 ? (
          <li className="px-3 py-3 text-[10.5px] text-muted">
            Record a voice note or upload a WAV/MP4 to begin.
          </li>
        ) : (
          sources.map((source) => (
            <li key={source.source_id}>
              <button
                type="button"
                onClick={() => selectSource(source.source_id)}
                aria-pressed={source.source_id === activeId}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  source.source_id === activeId ? 'bg-surface-raised' : 'hover:bg-surface'
                }`}
              >
                <Icon
                  name={source.kind === 'audio' ? 'mic' : 'film'}
                  className="size-3.5 shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-ink">
                    {source.original_name ?? `${source.kind} source`}
                  </span>
                  <span className="block font-mono text-[9.5px] text-muted">
                    {formatDuration(source.duration_ms)} · {formatBytes(source.byte_size)} ·{' '}
                    {source.origin}
                  </span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>

      {active ? (
        <div className="space-y-2 border-t border-line/70 px-3 py-2.5">
          {active.kind === 'audio' ? (
            playback.status === 'ready' && playback.objectUrl !== null ? (
              <audio
                key={playback.sourceKey}
                controls
                preload="metadata"
                src={playback.objectUrl}
                className="h-8 w-full"
              >
                <track kind="captions" />
              </audio>
            ) : (
              <p
                role="status"
                className={
                  playback.status === 'error'
                    ? 'text-[10.5px] text-err'
                    : 'text-[10.5px] text-muted'
                }
              >
                {playbackMessage(playback)}
              </p>
            )
          ) : playback.status === 'ready' && playback.objectUrl !== null ? (
            <video
              key={playback.sourceKey}
              controls
              playsInline
              preload="metadata"
              src={playback.objectUrl}
              className="max-h-40 w-full rounded border border-line bg-black"
            >
              <track kind="captions" />
            </video>
          ) : (
            <p
              role="status"
              className={
                playback.status === 'error' ? 'text-[10.5px] text-err' : 'text-[10.5px] text-muted'
              }
            >
              {playbackMessage(playback)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={sourceDownload.download}
              disabled={sourceDownload.pending}
              className="inline-flex items-center gap-1 text-[10px] text-muted underline decoration-dotted disabled:opacity-50"
            >
              <Icon name="download" className="size-3" />
              Download {active.kind === 'audio' ? 'WAV' : 'MP4'}
            </button>
            {sourceDownload.pending ? (
              <span className="text-[10px] text-muted">Preparing download…</span>
            ) : null}
            {sourceDownload.error !== null ? (
              <span role="alert" className="text-[10px] text-err">
                {sourceDownload.error}
              </span>
            ) : null}
          </div>

          {active.kind === 'audio' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as MediaTranscribeMode)}
                  aria-label="Transcription mode"
                  className="rounded border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
                >
                  <option value="PUSH_TO_TALK">Push to talk</option>
                  <option value="ENDPOINTING">Endpointing</option>
                  <option value="DIARIZATION">Diarization</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={transcribe}
                  className="rounded bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-50"
                >
                  Transcribe
                </button>
              </div>
              {transcript ? (
                <>
                  <textarea
                    value={transcriptText}
                    onChange={(event) => {
                      if (transcriptDraft === null) return;
                      dispatch({
                        type: 'transcriptEdited',
                        key: transcriptDraft.key,
                        text: event.target.value,
                      });
                    }}
                    aria-label="Editable transcript"
                    rows={4}
                    className="w-full rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink"
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={transcriptType}
                      onChange={(event) => {
                        if (transcriptDraft === null) return;
                        dispatch({
                          type: 'transcriptTypeChanged',
                          key: transcriptDraft.key,
                          memoryType: event.target.value as MediaProposalMemoryType,
                        });
                      }}
                      aria-label="Transcript memory type"
                      className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
                    >
                      {PROPOSAL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || transcriptText.trim().length === 0}
                      onClick={proposeTranscript}
                      className="rounded border border-line px-2 py-1 text-[10.5px] text-ink disabled:opacity-50"
                    >
                      Propose transcript
                    </button>
                  </div>
                  <p className="font-mono text-[9.5px] text-muted">
                    {transcript.observed_model ?? transcript.model} ·{' '}
                    {String(transcript.provider_attempts)} call(s)
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  value={clipPrompt}
                  onChange={(event) =>
                    dispatch({ type: 'clipPromptChanged', text: event.target.value })
                  }
                  placeholder="What should the clip focus on?"
                  aria-label="Clip focus"
                  className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink placeholder:text-muted"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={understand}
                  className="rounded bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-50"
                >
                  Inspect clip
                </button>
              </div>
              {clip ? (
                <>
                  {clip.observations.length === 0 ? (
                    <p className="text-[10.5px] text-muted">
                      No supported observations were returned.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {clip.observations.map((observation, index) => (
                        <ClipObservationRow
                          key={`${String(observation.start_ms)}-${String(index)}`}
                          observation={observation}
                          checked={selectedClips.includes(index)}
                          onToggle={() => toggleClip(index)}
                        />
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={clipType}
                      onChange={(event) => {
                        if (clipDraft === null) return;
                        dispatch({
                          type: 'clipTypeChanged',
                          key: clipDraft.key,
                          memoryType: event.target.value as MediaProposalMemoryType,
                        });
                      }}
                      aria-label="Clip memory type"
                      className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
                    >
                      {PROPOSAL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || selectedClips.length === 0}
                      onClick={proposeClips}
                      className="rounded border border-line px-2 py-1 text-[10.5px] text-ink disabled:opacity-50"
                    >
                      Propose selected ({selectedClips.length})
                    </button>
                  </div>
                  <p className="font-mono text-[9.5px] text-muted">
                    {clip.observed_model ?? clip.model} · {String(clip.provider_attempts)} call(s)
                  </p>
                </>
              ) : null}
            </div>
          )}
          <p className="text-[9.5px] leading-4 text-muted">
            Proposals stay in review and are never auto-accepted. Clip timestamps come from the
            provider and are validated against the measured file duration.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ClipObservationRow({
  observation,
  checked,
  onToggle,
}: {
  observation: MediaClipObservation;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-1.5 text-[10.5px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select observation at ${formatDuration(observation.start_ms)}`}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-ink-dim">{observation.observation}</span>
        <span className="block font-mono text-[9px] text-muted">
          {formatDuration(observation.start_ms)}–{formatDuration(observation.end_ms)} ·{' '}
          {observation.confidence.toFixed(2)}
        </span>
      </span>
    </li>
  );
}
