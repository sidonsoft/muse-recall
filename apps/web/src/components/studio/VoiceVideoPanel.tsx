import {
  MEDIA_AUDIO_MAX_BYTES,
  MEDIA_AUDIO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_BYTES,
  type MediaClipObservation,
  type MediaClipResponse,
  type MediaProposalMemoryType,
  type MediaSourceMime,
  type MediaSourceRecordView,
  type MediaTranscribeMode,
  type MediaTranscript,
} from '@mml/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { Icon } from '../Icon.tsx';

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
  const [sources, setSources] = useState<MediaSourceRecordView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [mode, setMode] = useState<MediaTranscribeMode>('PUSH_TO_TALK');
  const [transcript, setTranscript] = useState<MediaTranscript | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptType, setTranscriptType] =
    useState<MediaProposalMemoryType>('technical_decision');
  const [clip, setClip] = useState<MediaClipResponse | null>(null);
  const [clipPrompt, setClipPrompt] = useState('');
  const [selectedClips, setSelectedClips] = useState<Set<number>>(() => new Set());
  const [clipType, setClipType] = useState<MediaProposalMemoryType>('preference');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recordingRef = useRef(false);
  const chunksRef = useRef<Float32Array[]>([]);
  const inputRateRef = useRef(TARGET_SAMPLE_RATE);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const active = sources.find((source) => source.source_id === activeId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const list = await api.mediaSources(projectId);
      setSources(list.items);
      setActiveId((current) => {
        if (current !== null && list.items.some((item) => item.source_id === current)) {
          return current;
        }
        return list.items[0]?.source_id ?? null;
      });
    } catch (error) {
      setNotice({ tone: 'err', text: messageOf(error) });
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    return () => {
      void releaseCapture();
    };
  }, [releaseCapture]);

  const upload = useCallback(
    async (
      mime: MediaSourceMime,
      dataBase64: string,
      origin: 'upload' | 'recording',
      originalName: string,
    ): Promise<void> => {
      const record = await api.mediaSourceUpload(projectId, {
        mime,
        dataBase64,
        origin,
        originalName,
      });
      setActiveId(record.source_id);
      await refresh();
      setNotice({
        tone: 'ok',
        text:
          origin === 'recording'
            ? 'Recording ready. Transcribe it, edit the draft, then choose what to propose.'
            : 'Source ready. Nothing has been sent to a model yet.',
      });
    },
    [projectId, refresh],
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
        setNotice({ tone: 'err', text: 'The recording was too short to use.' });
        return;
      }
      setBusy(true);
      try {
        const wav = encodeWav(captured, rate);
        if (wav.byteLength > MEDIA_AUDIO_MAX_BYTES) {
          setNotice({ tone: 'err', text: 'The recording exceeds the 16 MB audio limit.' });
          return;
        }
        await upload('audio/wav', bytesToBase64(wav), 'recording', 'recording.wav');
      } catch (error) {
        setNotice({ tone: 'err', text: messageOf(error) });
      } finally {
        setBusy(false);
      }
    },
    [releaseCapture, upload],
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
    setNotice(null);
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      setNotice({
        tone: 'err',
        text: 'Microphone capture is unavailable here. Upload a mono 16-bit PCM WAV instead.',
      });
      return;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor === undefined) {
      setNotice({
        tone: 'err',
        text: 'Web Audio capture is unavailable here. Upload a mono 16-bit PCM WAV instead.',
      });
      return;
    }
    setBusy(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContextCtor();
      await context.resume();
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
      setNotice({
        tone: 'err',
        text: `Microphone unavailable (${messageOf(error)}). Upload a WAV file instead.`,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = (file: File | undefined): void => {
    if (!file) return;
    const mime = sourceMimeForFile(file);
    if (mime === null) {
      setNotice({
        tone: 'err',
        text: 'Unsupported file. Use mono 16-bit PCM WAV (16/24 kHz) or an MP4 video.',
      });
      return;
    }
    const limit = mime === 'audio/wav' ? MEDIA_AUDIO_MAX_BYTES : MEDIA_VIDEO_MAX_BYTES;
    if (file.size > limit) {
      setNotice({
        tone: 'err',
        text: `${mime === 'audio/wav' ? 'Audio' : 'Video'} is ${formatBytes(file.size)}; the limit is ${formatBytes(limit)}.`,
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    void readFileBase64(file)
      .then((data) => upload(mime, data, 'upload', file.name))
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const selectSource = (sourceId: string): void => {
    setActiveId(sourceId);
    setTranscript(null);
    setTranscriptText('');
    setClip(null);
    setSelectedClips(new Set());
    setNotice(null);
  };

  const transcribe = (): void => {
    if (active === null || active.kind !== 'audio') return;
    setBusy(true);
    setNotice(null);
    void api
      .mediaSourceTranscribe(projectId, active.source_id, { mode })
      .then((result) => {
        setTranscript(result);
        setTranscriptText(result.transcript);
        setNotice({
          tone: 'ok',
          text:
            result.transcript.trim().length === 0
              ? 'No speech was detected. You can still type what the recording meant.'
              : 'Transcript draft ready. Correct it before proposing anything.',
        });
      })
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const understand = (): void => {
    if (active === null || active.kind !== 'video') return;
    setBusy(true);
    setNotice(null);
    void api
      .mediaSourceClip(
        projectId,
        active.source_id,
        clipPrompt.trim().length > 0 ? clipPrompt.trim() : undefined,
      )
      .then((result) => {
        setClip(result);
        setSelectedClips(new Set());
        setNotice({
          tone: 'ok',
          text:
            result.observations.length === 0
              ? 'The model found no supported observations in this clip.'
              : 'Observations are drafts. Select only the ones the clip actually supports.',
        });
      })
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const proposeTranscript = (): void => {
    if (active === null) return;
    const content = transcriptText.trim();
    if (content.length === 0) return;
    setBusy(true);
    setNotice(null);
    void api
      .mediaSourcePropose(projectId, active.source_id, [
        { kind: 'transcript', memory_type: transcriptType, content },
      ])
      .then((result) => {
        setNotice({
          tone: 'ok',
          text: `Recorded ${String(result.proposed.length)} proposal(s). They stay proposed until accepted in Memory Review.`,
        });
      })
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const proposeClips = (): void => {
    if (active === null || clip === null) return;
    const chosen = clip.observations.filter((_item, index) => selectedClips.has(index));
    if (chosen.length === 0) return;
    const proposals = chosen.map((observation) => ({
      kind: 'clip_observation' as const,
      memory_type: clipType,
      content: observation.observation,
      start_ms: observation.start_ms,
      end_ms: observation.end_ms,
    }));
    setBusy(true);
    setNotice(null);
    void api
      .mediaSourcePropose(projectId, active.source_id, proposals)
      .then((result) => {
        setNotice({
          tone: 'ok',
          text: `Recorded ${String(result.proposed.length)} proposal(s). They stay proposed until accepted in Memory Review.`,
        });
      })
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  const toggleClip = (index: number): void => {
    setSelectedClips((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
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
            <audio
              controls
              preload="metadata"
              src={api.mediaSourceBytesUrl(projectId, active.source_id)}
              className="h-8 w-full"
            >
              <track kind="captions" />
            </audio>
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={api.mediaSourceBytesUrl(projectId, active.source_id)}
              className="max-h-40 w-full rounded border border-line bg-black"
            >
              <track kind="captions" />
            </video>
          )}
          <a
            href={api.mediaSourceBytesUrl(projectId, active.source_id)}
            download={`${active.source_id}.${active.kind === 'audio' ? 'wav' : 'mp4'}`}
            className="inline-flex items-center gap-1 text-[10px] text-muted underline decoration-dotted"
          >
            <Icon name="download" className="size-3" />
            Download {active.kind === 'audio' ? 'WAV' : 'MP4'}
          </a>

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
                    onChange={(event) => setTranscriptText(event.target.value)}
                    aria-label="Editable transcript"
                    rows={4}
                    className="w-full rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink"
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={transcriptType}
                      onChange={(event) =>
                        setTranscriptType(event.target.value as MediaProposalMemoryType)
                      }
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
                  onChange={(event) => setClipPrompt(event.target.value)}
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
                          checked={selectedClips.has(index)}
                          onToggle={() => toggleClip(index)}
                        />
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={clipType}
                      onChange={(event) =>
                        setClipType(event.target.value as MediaProposalMemoryType)
                      }
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
                      disabled={busy || selectedClips.size === 0}
                      onClick={proposeClips}
                      className="rounded border border-line px-2 py-1 text-[10.5px] text-ink disabled:opacity-50"
                    >
                      Propose selected ({selectedClips.size})
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
