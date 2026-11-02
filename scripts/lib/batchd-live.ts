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

import { createServer } from 'node:net';
import { join } from 'node:path';
import { redactSecrets } from '../../packages/shared/src/index.js';
import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace.ts';

/** The sentence the audio fixture speaks. Chosen for distinctive content words. */
export const DEFAULT_SPEECH_PHRASE =
  'Remember that the studio uses a woodland palette, and it never uses countdown timers.';

/** Words the spoken phrase must survive transcription with, in order to count as heard. */
export const DEFAULT_SPEECH_KEYWORDS = ['woodland', 'palette', 'never', 'countdown', 'timers'];

/** What the generated clip shows, used only to report lexical agreement. */
export const DEFAULT_CLIP_TOKENS = ['red', 'green', 'square'];

/** ffmpeg/ffprobe live in the same environment the gates already require. */
// The recipe names the binaries a run will actually execute, honouring the same
// overrides a harness passes to its probes. A harness that checks `ffprobe` while
// the recipe runs plain `ffmpeg` would certify a tool the run never calls.
export const SAY_BIN = process.env.SAY_BIN ?? '/usr/bin/say';
export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe';

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
    // The prompt must name what the recipe draws, otherwise an empty observation
    // is ambiguous: the model may have failed to describe the scene, or it was
    // never asked about it. `clipPromptIssues` checks this wording against the
    // filter graph above.
    prompt:
      'Describe the scene: a red background with a small green square moving across it from left to right. Say what is shown and what changes over time.',
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
/** The only scope names this harness accepts. */
export const LIVE_SCOPE_NAMES: readonly string[] = ['audio', 'video', 'both'];

/**
 * A scope name the harness does not know must be refused, not reinterpreted. `liveScope`
 * falls back to the cheapest scope when handed an unknown string (defence in depth for
 * programmatic callers), but a CLI typo then pays for a different capability than the one
 * the operator asked for — on 2 Nov `BATCHD_SMOKE_SCOPE=clip` fell back to audio while the
 * report still said "live clip", so the ledger rules enforced audio counts against a run
 * described as a clip run.
 */
export function liveScopeNameIssues(env: NodeJS.ProcessEnv): string[] {
  const named = (env.BATCHD_SMOKE_SCOPE ?? '').trim().toLowerCase();
  if (named === '' || LIVE_SCOPE_NAMES.includes(named)) return [];
  return [
    `BATCHD_SMOKE_SCOPE="${named}" is not one of ${LIVE_SCOPE_NAMES.join(' | ')} — this harness will not guess which capability to pay for`,
  ];
}

/** How the applied scope should be described, derived from the parsed scope, never the raw env string. */
export function liveScopeLabel(scope: LiveScope): string {
  if (scope.audio && scope.video) return 'audio + clip observation';
  if (scope.video) return 'clip observation only';
  return 'audio only';
}

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

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Reserve an ephemeral loopback port and hand it back.
 *
 * `listen(0)` is asynchronous: `address()` returns null until the socket is
 * actually bound. Reading the address straight after the call used to yield null,
 * null collapsed to port 0, and the server was started with `PORT=0` — a port the
 * OS picks again — while the harness probed a port nothing had reserved. A live run
 * could therefore never reach a provider call, and its failure message said nothing
 * about the reservation. A null address is now a loud failure.
 */
export async function reserveLoopbackPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  if (port === 0) {
    throw new Error(
      'could not reserve a loopback port: the listener bound but reported no address',
    );
  }
  return port;
}

/**
 * Wait until the server actually answers, instead of assuming a bound port is a
 * running service.
 *
 * `server.listen(0)` returns before the socket is bound, and a process that exits
 * on a configuration error leaves the port in use for nothing. Both look like an
 * unexplained failure unless readiness is probed. A probe that throws (for example
 * ECONNREFUSED while the listener is still opening) counts as "not yet", and the
 * outcome says whether the port ever answered at all.
 */
export async function waitForServerReady(options: {
  port: number;
  probe: (port: number) => Promise<boolean>;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ ready: boolean; attempts: number; lastError?: string }> {
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + (options.timeoutMs ?? SERVER_READY_TIMEOUT_MS);
  let attempts = 0;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      if (await options.probe(options.port)) return { ready: true, attempts };
      lastError = undefined; // the port answered; it just was not ready yet
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(options.pollMs ?? 100);
  }
  return { ready: false, attempts, ...(lastError === undefined ? {} : { lastError }) };
}

export const SERVER_READY_TIMEOUT_MS = 20_000;

/** The ffprobe arguments used to measure a media fixture. */
export function ffprobeArgs(path: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_name,codec_type,width,height,sample_rate,channels,nb_frames',
    '-of',
    'json',
    path,
  ];
}

/** The command sequence that turns a known sentence into the audio fixture. */
/**
 * What a live run needs before it may spend anything.
 *
 * A missing `say`, ffmpeg or ffprobe is a local prerequisite, not a provider
 * result. The run must name it before the first dispatch rather than transcribing
 * an empty file — or failing inside a fixture recipe — and leave the reader to
 * guess whether the model or the machine was at fault.
 */
export function missingLivePrerequisites(options: {
  scope: LiveScope;
  audioSupplied: boolean;
  videoSupplied: boolean;
  videoPresent: boolean;
  platform: NodeJS.Platform;
  hasSay: boolean;
  hasFfmpeg: boolean;
  hasFfprobe: boolean;
}): string[] {
  const missing: string[] = [];
  if (options.scope.audio && !options.audioSupplied) {
    if (options.platform !== 'darwin' || !options.hasSay) {
      missing.push(
        'this host has no macOS `say` to speak the target sentence: supply BATCHD_SMOKE_AUDIO_WAV, a recording that says it',
      );
    }
    if (!options.hasFfmpeg) missing.push('ffmpeg (to normalise the recording to 16 kHz mono PCM)');
    if (!options.hasFfprobe) {
      missing.push('ffprobe (to measure the audio before transcribing it)');
    }
  }
  if (options.scope.video) {
    if (!options.videoSupplied) {
      if (!options.hasFfmpeg) missing.push('ffmpeg (to render the clip fixture)');
      if (!options.hasFfprobe) missing.push('ffprobe (to measure the clip fixture)');
    } else if (!options.videoPresent) {
      missing.push('the MP4 named by BATCHD_SMOKE_VIDEO_MP4 could not be read');
    }
  }
  return missing;
}

/**
 * Does the observation prompt name what the clip recipe draws?
 *
 * The fixture is only a control if the request asks about the thing that was
 * rendered: an empty observation then means the model did not describe the scene,
 * rather than that it was never asked to. The checks mirror the recipe — a red
 * frame, a green square, motion across it.
 */
export function clipPromptIssues(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const issues: string[] = [];
  for (const needed of ['red background', 'green square']) {
    if (!text.includes(needed)) {
      issues.push(`the prompt does not name the ${needed} the fixture renders`);
    }
  }
  if (!/(moving|changes|across|left to right)/.test(text)) {
    issues.push('the prompt does not ask what changes, although the fixture is defined by motion');
  }
  return issues;
}

/** Problems with what `/api/meta` reports about media configuration; empty if sound. */
export function mediaMetaIssues(media: unknown): string[] {
  if (media === null || typeof media !== 'object') {
    return [
      'the running server reports no media configuration at all (`/api/meta` has no `media` object), so the zero-retry rule cannot be confirmed',
    ];
  }
  const reported = media as { max_retries?: unknown };
  if (reported.max_retries !== 0) {
    return [
      `the running server reports media.max_retries=${String(reported.max_retries)}; this run requires 0, otherwise a failure could be retried and the call budget would be wrong`,
    ];
  }
  // Every paid capability must be nameable from the running server. A run that
  // cannot say which model it called has spent quota it cannot account for.
  const unnamed = MEDIA_MODEL_FIELDS.filter((field) => {
    const value = (media as Record<string, unknown>)[field];
    return typeof value !== 'string' || value.length === 0;
  });
  if (unnamed.length > 0) {
    return [
      `the running server does not name ${unnamed.join(', ')} in /api/meta, so the run cannot say which model a call paid for`,
    ];
  }
  return [];
}

/** The media models `/api/meta` must name for a live run to be accountable. */
export const MEDIA_MODEL_FIELDS = [
  'image_model',
  'sam_model',
  'vision_model',
  'transcribe_model',
  'video_model',
] as const;

/** The clip operation touches exactly these two provider paths. */
export const CLIP_MODEL_PATH = '/v1/responses';
export const CLIP_UPLOAD_PATH = '/v1/files';

export interface ClipCallAccount {
  modelDispatches: number;
  uploadDispatches: number;
  /** Empty when the operation stayed inside its allowance. */
  issues: string[];
}

/**
 * Account for one clip observation from the dispatches actually observed.
 *
 * The route reports `provider_attempts` for the whole operation, which includes
 * the file upload that must precede the model call. Reading that number as
 * "model calls" charged every successful clip run twice and failed the run on
 * its own bookkeeping — on 2 Nov a live clip returned five correct timed
 * observations and was still reported as a failure. So the model call and the
 * upload are counted from the trace separately, and the route's own total is
 * checked against them instead of being trusted as the call count.
 */
export function accountClipCalls(
  dispatches: readonly { path: string }[],
  providerAttempts: number,
): ClipCallAccount {
  const modelDispatches = dispatches.filter((entry) => entry.path === CLIP_MODEL_PATH).length;
  const uploadDispatches = dispatches.filter((entry) => entry.path === CLIP_UPLOAD_PATH).length;
  const issues: string[] = [];
  if (modelDispatches !== 1) {
    issues.push(
      `expected exactly one model dispatch on ${CLIP_MODEL_PATH}, saw ${String(modelDispatches)}`,
    );
  }
  if (uploadDispatches !== 1) {
    issues.push(
      `expected exactly one file upload on ${CLIP_UPLOAD_PATH}, saw ${String(uploadDispatches)}`,
    );
  }
  if (providerAttempts !== dispatches.length) {
    issues.push(
      `the route reported ${String(providerAttempts)} attempt(s) for ${String(dispatches.length)} observed dispatch(es)`,
    );
  }
  return { modelDispatches, uploadDispatches, issues };
}

const TRANSCRIBE_PATH = '/v1/asr/transcribe';

/** Provider paths a Batch D scope may touch, and nothing else. */
export function liveScopeAllowedPaths(scope: LiveScope): string[] {
  const allowed: string[] = [];
  if (scope.audio) allowed.push(TRANSCRIBE_PATH);
  if (scope.video) allowed.push(CLIP_UPLOAD_PATH, CLIP_MODEL_PATH);
  return allowed;
}

/**
 * Whole-run ledger problems a Batch D run must refuse before it may report that
 * every live call was accounted for.
 *
 * The per-operation slice checks are still needed, but they only see their own
 * operation: a dispatch outside every slice (an image call inside an audio run, a
 * clip model call in a video-only run) left the run claiming a clean budget while
 * `calls.otherPaidPaths` said otherwise.
 */
export function batchdLedgerIssues(
  ledger: DispatchAccount,
  scope: LiveScope,
  expected: { transcribe: number; clipModel: number; uploads: number },
): string[] {
  const issues = ledgerIntegrityIssues(ledger, 'batchd run');
  const outside = pathsOutside(ledger, liveScopeAllowedPaths(scope));
  if (outside.length > 0) {
    issues.push(
      `batchd run (audio=${String(scope.audio)} video=${String(scope.video)}) dispatched paths outside its scope: ${outside.join(', ')}`,
    );
  }
  const count = (path: string): number => ledger.dispatches.filter((d) => d.path === path).length;
  const transcribe = count(TRANSCRIBE_PATH);
  const clipModel = count(CLIP_MODEL_PATH);
  const uploads = count(CLIP_UPLOAD_PATH);
  if (transcribe !== expected.transcribe) {
    issues.push(
      `expected ${String(expected.transcribe)} transcription dispatch(es), saw ${String(transcribe)}`,
    );
  }
  if (clipModel !== expected.clipModel) {
    issues.push(
      `expected ${String(expected.clipModel)} clip model dispatch(es) on ${CLIP_MODEL_PATH}, saw ${String(clipModel)}`,
    );
  }
  if (uploads !== expected.uploads) {
    issues.push(
      `expected ${String(expected.uploads)} clip upload(s) on ${CLIP_UPLOAD_PATH}, saw ${String(uploads)}`,
    );
  }
  return issues;
}

/** How many dispatches each capability in scope may cost: never more than one. */
export function expectedBatchdCalls(scope: LiveScope): {
  transcribe: number;
  clipModel: number;
  uploads: number;
} {
  return {
    transcribe: scope.audio ? 1 : 0,
    clipModel: scope.video ? 1 : 0,
    uploads: scope.video ? 1 : 0,
  };
}
