/**
 * Batch D live-smoke helpers: fixture recipes, probe parsing, and the measured
 * comparisons the live run reports.
 *
 * Kept apart from the script so the parts that decide pass/fail can be tested
 * without a provider. Nothing here contacts the network.
 *
 * The live run's job is to turn a real provider answer into *measured* evidence:
 * a transcript compared word-by-word against the sentence we know we recorded,
 * turn and observation timestamps checked against the duration measured from the
 * uploaded file, and dispatch counts read from the adapter trace. It deliberately
 * does not pretend to score model quality — a word-overlap ratio is not an
 * accuracy claim, and clip observations are reported for a human to read.
 */

import { join } from 'node:path';
import { redactSecrets } from '../../packages/shared/src/index.js';

/** The sentence the audio fixture speaks. Chosen for distinctive content words. */
export const DEFAULT_SPEECH_PHRASE =
  'Remember that the studio uses a woodland palette, and it never uses countdown timers.';

/** Words the spoken phrase must survive transcription with, in order to count as heard. */
export const DEFAULT_SPEECH_KEYWORDS = ['woodland', 'palette', 'never', 'countdown', 'timers'];

/** What the generated clip shows, used only to report lexical agreement. */
export const DEFAULT_CLIP_TOKENS = ['red', 'green', 'square'];

/** ffmpeg/ffprobe live in the same environment the gates already require. */
const SAY_BIN = '/usr/bin/say';
const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';

export interface FixtureStep {
  command: string;
  args: string[];
}

export interface SpeechFixturePlan {
  phrase: string;
  /** Spoken-word rate passed to `say`; slower speech transcribes more reliably. */
  speechRate: number;
  intermediate: string;
  wavPath: string;
  steps: FixtureStep[];
  /** What a probe must report for the fixture to be usable for transcription. */
  expect: { codec: string; sampleRate: number; channels: number };
}

/**
 * The speech fixture is generated, not committed: a few seconds of 16 kHz mono
 * PCM is small, but a checked-in recording is someone's voice and an unreviewable
 * blob. `say` speaks a known sentence, so the transcript has a known target.
 */
export function speechFixturePlan(
  dir: string,
  options: { phrase?: string; rate?: number } = {},
): SpeechFixturePlan {
  const phrase = options.phrase?.trim() ? options.phrase.trim() : DEFAULT_SPEECH_PHRASE;
  const rate = options.rate ?? 165;
  return {
    phrase,
    speechRate: rate,
    intermediate: join(dir, 'speech.aiff'),
    wavPath: join(dir, 'speech.wav'),
    steps: [
      { command: SAY_BIN, args: ['-r', String(rate), '-o', join(dir, 'speech.aiff'), phrase] },
      {
        command: FFMPEG_BIN,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          join(dir, 'speech.aiff'),
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          '-y',
          join(dir, 'speech.wav'),
        ],
      },
    ],
    expect: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
  };
}

export interface ClipFixturePlan {
  mp4Path: string;
  steps: FixtureStep[];
  /** The focus the observation request asks for. */
  prompt: string;
  expectedTokens: string[];
  expect: { codec: string; width: number; height: number; durationSeconds: number };
}

/**
 * A clip whose content is unambiguous to a human viewer: a red frame with a green
 * square crossing it. It is tiny, reproducible, and needs no copyrighted footage.
 */
export function clipFixturePlan(dir: string, mp4Path?: string): ClipFixturePlan {
  const target = mp4Path ?? join(dir, 'clip.mp4');
  return {
    mp4Path: target,
    steps: [
      {
        command: FFMPEG_BIN,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=red:s=96x96:d=2:r=10',
          '-f',
          'lavfi',
          '-i',
          'color=c=green:s=24x24:d=2:r=10',
          '-filter_complex',
          "[0:v][1:v]overlay=x='t*30':y=36:eval=frame,format=yuv420p",
          '-c:v',
          'libx264',
          '-profile:v',
          'baseline',
          '-level',
          '3.0',
          '-movflags',
          '+faststart',
          '-an',
          '-fflags',
          '+bitexact',
          '-y',
          target,
        ],
      },
    ],
    prompt: 'Describe what is shown and what changes over time.',
    expectedTokens: [...DEFAULT_CLIP_TOKENS],
    expect: { codec: 'h264', width: 96, height: 96, durationSeconds: 2 },
  };
}

export interface ProbeSummary {
  codec: string;
  kind: 'audio' | 'video';
  durationMs: number;
  sampleRate: number | null;
  channels: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/** Read an ffprobe JSON dump into the few numbers the checks care about. */
export function parseProbe(dump: unknown): ProbeSummary | null {
  if (typeof dump !== 'object' || dump === null) return null;
  const record = dump as { streams?: unknown; format?: unknown };
  const streams = Array.isArray(record.streams) ? record.streams : [];
  const format = (
    typeof record.format === 'object' && record.format !== null ? record.format : {}
  ) as Record<string, unknown>;
  for (const entry of streams) {
    if (typeof entry !== 'object' || entry === null) continue;
    const stream = entry as Record<string, unknown>;
    const codecType = typeof stream.codec_type === 'string' ? stream.codec_type : null;
    if (codecType !== 'audio' && codecType !== 'video') continue;
    const duration = numberOrNull(format.duration) ?? numberOrNull(stream.duration);
    return {
      codec: typeof stream.codec_name === 'string' ? stream.codec_name : '',
      kind: codecType,
      durationMs: duration === null ? 0 : Math.round(duration * 1000),
      sampleRate: numberOrNull(stream.sample_rate),
      channels: numberOrNull(stream.channels),
      width: numberOrNull(stream.width),
      height: numberOrNull(stream.height),
      bytes: numberOrNull(format.size),
    };
  }
  return null;
}

export interface ProbeMismatch {
  issues: string[];
}

/** Compare a probe against what the fixture recipe was supposed to produce. */
export function probeIssues(
  probe: ProbeSummary | null,
  expected:
    | { codec: string; sampleRate: number; channels: number; minDurationMs?: number }
    | {
        codec: string;
        width: number;
        height: number;
        durationSeconds: number;
        minDurationMs?: number;
      },
): ProbeMismatch {
  if (probe === null) return { issues: ['ffprobe reported no audio or video stream'] };
  const issues: string[] = [];
  if (probe.codec !== expected.codec) {
    issues.push(`codec is ${probe.codec || '(none)'}, expected ${expected.codec}`);
  }
  if ('sampleRate' in expected) {
    if (probe.sampleRate !== expected.sampleRate) {
      issues.push(
        `sample rate is ${String(probe.sampleRate)}, expected ${String(expected.sampleRate)}`,
      );
    }
    if (probe.channels !== expected.channels) {
      issues.push(`channels is ${String(probe.channels)}, expected ${String(expected.channels)}`);
    }
    if (probe.kind !== 'audio') issues.push('the first media stream is not audio');
  } else {
    if (probe.width !== expected.width || probe.height !== expected.height) {
      issues.push(
        `frame size is ${String(probe.width)}x${String(probe.height)}, expected ${String(expected.width)}x${String(expected.height)}`,
      );
    }
    if (probe.kind !== 'video') issues.push('the first media stream is not video');
  }
  const minimum =
    'minDurationMs' in expected && expected.minDurationMs !== undefined
      ? expected.minDurationMs
      : 'durationSeconds' in expected
        ? expected.durationSeconds * 1000 - 50
        : // A clip this short carries nothing measurable to transcribe.
          500;
  if (probe.durationMs < minimum) {
    issues.push(
      `duration is ${String(probe.durationMs)}ms, expected at least ${String(minimum)}ms`,
    );
  }
  return { issues };
}

/** Lowercased word tokens, punctuation dropped. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 0);
}

export interface TranscriptMatch {
  spokenWords: number;
  matchedWords: number;
  /** Fraction of distinct spoken content words that appear in the transcript. */
  ratio: number;
  missing: string[];
  keywordsExpected: string[];
  keywordsFound: string[];
  keywordsMissing: string[];
}

/**
 * Word agreement between the sentence we recorded and the transcript the provider
 * returned. A ratio, not an accuracy score: a real transcript may reorder,
 * punctuate, or paraphrase, and only the missing keywords are treated as a signal
 * strong enough to fail a run.
 */
export function transcriptMatch(
  spoken: string,
  transcript: string,
  keywords: readonly string[] = DEFAULT_SPEECH_KEYWORDS,
): TranscriptMatch {
  const spokenTokens = tokens(spoken);
  const heard = new Set(tokens(transcript));
  const content = [...new Set(spokenTokens)].filter((word) => word.length > 3);
  const matched = content.filter((word) => heard.has(word));
  const missing = content.filter((word) => !heard.has(word));
  const found = keywords.filter((word) => heard.has(word.toLowerCase()));
  return {
    spokenWords: content.length,
    matchedWords: matched.length,
    ratio: content.length === 0 ? 0 : matched.length / content.length,
    missing,
    keywordsExpected: [...keywords],
    keywordsFound: found,
    keywordsMissing: keywords.filter((word) => !found.includes(word)),
  };
}

export interface TimedEntry {
  start_ms: number;
  end_ms: number;
  text: string;
}

/**
 * Timestamps the provider reported, checked against the duration measured from the
 * uploaded file. A turn or observation outside the clip is a provider contract
 * problem, never navigation data — the same rule the server enforces, asserted
 * independently here so a loosened server check cannot go unnoticed.
 */
export function timestampIssues(
  entries: readonly TimedEntry[],
  measuredDurationMs: number,
  toleranceMs = 2_000,
): string[] {
  const issues: string[] = [];
  const limit = measuredDurationMs + toleranceMs;
  entries.forEach((entry, index) => {
    const label = `entry ${String(index + 1)}`;
    if (!Number.isFinite(entry.start_ms) || !Number.isFinite(entry.end_ms)) {
      issues.push(`${label}: timestamps are not finite`);
      return;
    }
    if (entry.end_ms < entry.start_ms) {
      issues.push(
        `${label}: ends before it starts (${String(entry.start_ms)}→${String(entry.end_ms)})`,
      );
    }
    if (entry.end_ms > limit) {
      issues.push(
        `${label}: ends at ${String(entry.end_ms)}ms, past the measured ${String(measuredDurationMs)}ms clip (plus ${String(toleranceMs)}ms tolerance)`,
      );
    }
  });
  return issues;
}

/** Lexical agreement between clip observations and what the clip actually shows. */
export function clipTokenMatch(
  observations: readonly { observation: string }[],
  expectedTokens: readonly string[] = DEFAULT_CLIP_TOKENS,
): { text: string; found: string[]; missing: string[] } {
  const text = observations.map((entry) => entry.observation).join(' ');
  const heard = new Set(tokens(text));
  const found = expectedTokens.filter((token) => heard.has(token.toLowerCase()));
  return {
    text,
    found,
    missing: expectedTokens.filter((token) => !found.includes(token)),
  };
}

/**
 * A bounded, secret-scrubbed excerpt for the evidence report. The transcript is
 * the user's own recorded speech: the report keeps enough to inspect, never the
 * whole thing, and never a credential it happens to contain.
 */
export function boundedExcerpt(text: string, max = 240): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const redacted = redactSecrets(collapsed);
  if (redacted.length <= max) return redacted;
  let cut = redacted.slice(0, max);
  const marker = /\[REDACTED(?::[^\]]*)?\]$/;
  if (marker.test(cut)) cut = cut.slice(0, -1);
  const open = cut.lastIndexOf('[REDACTED');
  const close = cut.indexOf(']', open);
  if (open >= 0 && close < 0) cut = cut.slice(0, open);
  return `${cut.trimEnd()}…`;
}

export interface LiveScope {
  audio: boolean;
  video: boolean;
  /** Transcription mode. ENDPOINTING reports turn timestamps, which is the part worth measuring. */
  mode: 'PUSH_TO_TALK' | 'ENDPOINTING' | 'DIARIZATION';
  phrase: string;
  keywords: string[];
  /** Paid-call budget: never more than one call of each kind. */
  maxTranscribeCalls: number;
  maxClipCalls: number;
}

/**
 * Read the run scope from the environment. The default is audio only: transcription
 * is the cheapest live answer that still measures something, and a run that wants
 * the video call has to say so.
 */
export function liveScope(env: NodeJS.ProcessEnv): LiveScope {
  const named = (env.BATCHD_SMOKE_SCOPE ?? 'audio').trim().toLowerCase();
  // An unrecognised scope never means "call everything": it falls back to the
  // cheapest measurement that still proves something.
  const requested = named === 'video' || named === 'both' ? named : 'audio';
  const audio = requested === 'audio' || requested === 'both';
  const video = requested === 'video' || requested === 'both';
  const mode = (env.BATCHD_SMOKE_TRANSCRIBE_MODE ?? 'ENDPOINTING').trim().toUpperCase();
  const phrase = env.BATCHD_SMOKE_PHRASE?.trim()
    ? env.BATCHD_SMOKE_PHRASE.trim()
    : DEFAULT_SPEECH_PHRASE;
  const keywords = (env.BATCHD_SMOKE_KEYWORDS ?? DEFAULT_SPEECH_KEYWORDS.join(','))
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  return {
    audio,
    video,
    mode: mode === 'PUSH_TO_TALK' || mode === 'DIARIZATION' ? mode : 'ENDPOINTING',
    phrase,
    keywords,
    maxTranscribeCalls: 1,
    maxClipCalls: 1,
  };
}

export interface TraceTally {
  /** Distinct attempt numbers seen for a path; more than one means a retry. */
  maxAttempt: number;
  attempts: number;
  paths: string[];
}

/** Count adapter trace attempts per provider path. */
export function tallyAttempts(
  entries: readonly { attempt: number; path?: string }[],
  path: string,
): TraceTally {
  const matching = entries.filter((entry) => entry.path === path);
  return {
    maxAttempt: matching.reduce((max, entry) => Math.max(max, entry.attempt), 0),
    attempts: matching.length,
    paths: [
      ...new Set(
        entries
          .map((entry) => entry.path)
          .filter((value): value is string => typeof value === 'string'),
      ),
    ],
  };
}

export { FFPROBE_BIN };

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
