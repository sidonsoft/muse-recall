/**
 * Batch D — audio/video source format validation.
 *
 * A source is accepted only when its bytes are a real, bounded container the
 * documented provider path can consume:
 *
 * - `audio/wav`: RIFF/WAVE, mono, 16-bit integer PCM, 16 kHz or 24 kHz.
 *   Muse Voice Transcribe rejects anything else, so this is checked before a
 *   paid call rather than discovered from a provider 400.
 * - `video/mp4`: ISO base media file format. Duration is read from `mvhd`
 *   and must be positive; fragmented or truncated files without a measurable
 *   duration are refused instead of guessing.
 *
 * Duration is measured from the container, never trusted from the client.
 * The product bounds (3 minutes audio, 30 seconds video) are applied here so
 * every downstream layer can assume a bounded, measurable source.
 */

import {
  MEDIA_AUDIO_MAX_BYTES,
  MEDIA_AUDIO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_MAX_DURATION_MS,
  type MediaSourceKindName,
  type MediaSourceMime,
} from '@mml/shared';

export type MediaSourceErrorCode =
  | 'invalid_project_id'
  | 'invalid_source_id'
  | 'invalid_source'
  | 'unsupported_format'
  | 'malformed_media'
  | 'duration_exceeded'
  | 'size_exceeded'
  | 'source_not_found'
  | 'source_corrupt'
  | 'kind_mismatch'
  | 'persistence_failed';

export class MediaSourceError extends Error {
  constructor(
    readonly code: MediaSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaSourceError';
  }
}

export interface InspectedSource {
  kind: MediaSourceKindName;
  mime: MediaSourceMime;
  durationMs: number;
}

const MARKUP_HEAD = /^(?:﻿)?\s*<(?:svg|html|!doctype|xml)/i;

function upper(bytes: Buffer, start: number, length: number): string {
  return bytes.subarray(start, start + length).toString('ascii');
}

function maxBytesFor(kind: MediaSourceKindName): number {
  return kind === 'audio' ? MEDIA_AUDIO_MAX_BYTES : MEDIA_VIDEO_MAX_BYTES;
}

function maxDurationFor(kind: MediaSourceKindName): number {
  return kind === 'audio' ? MEDIA_AUDIO_MAX_DURATION_MS : MEDIA_VIDEO_MAX_DURATION_MS;
}

function kindOf(mime: MediaSourceMime): MediaSourceKindName {
  return mime === 'audio/wav' ? 'audio' : 'video';
}

interface WavLayout {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  bitsPerSample: number;
  dataBytes: number;
}

function parseWav(bytes: Buffer): WavLayout {
  if (bytes.length < 44 || upper(bytes, 0, 4) !== 'RIFF' || upper(bytes, 8, 4) !== 'WAVE') {
    throw new MediaSourceError(
      'malformed_media',
      'Audio is not a RIFF/WAVE file. Export mono 16-bit PCM WAV at 16 kHz or 24 kHz.',
    );
  }
  let pos = 12;
  let fmt: Omit<WavLayout, 'dataBytes'> | null = null;
  let dataBytes: number | null = null;
  let guard = 0;
  while (pos + 8 <= bytes.length) {
    guard += 1;
    if (guard > 64) {
      throw new MediaSourceError('malformed_media', 'WAV has too many chunks to inspect.');
    }
    const id = upper(bytes, pos, 4);
    const size = bytes.readUInt32LE(pos + 4);
    const dataStart = pos + 8;
    if (dataStart + size > bytes.length) {
      throw new MediaSourceError(
        'malformed_media',
        `WAV chunk ${JSON.stringify(id)} declares ${String(size)} bytes past the end of the file.`,
      );
    }
    if (id === 'fmt ') {
      if (size < 16) {
        throw new MediaSourceError('malformed_media', 'WAV fmt chunk is truncated.');
      }
      const audioFormat = bytes.readUInt16LE(dataStart);
      const channels = bytes.readUInt16LE(dataStart + 2);
      const sampleRate = bytes.readUInt32LE(dataStart + 4);
      const byteRate = bytes.readUInt32LE(dataStart + 8);
      const bitsPerSample = bytes.readUInt16LE(dataStart + 14);
      fmt = { audioFormat, channels, sampleRate, byteRate, bitsPerSample };
    } else if (id === 'data') {
      dataBytes = size;
    }
    pos = dataStart + size + (size % 2);
  }
  if (fmt === null) {
    throw new MediaSourceError('malformed_media', 'WAV is missing its fmt chunk.');
  }
  if (dataBytes === null || dataBytes < 2) {
    throw new MediaSourceError('malformed_media', 'WAV has no usable audio data.');
  }
  // WAVE_FORMAT_PCM only. WAVE_FORMAT_EXTENSIBLE (0xfffe) could be valid PCM
  // but the provider contract is narrow; refuse with an actionable message.
  if (fmt.audioFormat !== 1) {
    throw new MediaSourceError(
      'unsupported_format',
      `WAV audio format ${String(fmt.audioFormat)} is not supported. Use uncompressed 16-bit PCM (format 1).`,
    );
  }
  if (fmt.channels !== 1) {
    throw new MediaSourceError(
      'unsupported_format',
      `WAV has ${String(fmt.channels)} channels. Mono is required; convert with -ac 1.`,
    );
  }
  if (fmt.bitsPerSample !== 16) {
    throw new MediaSourceError(
      'unsupported_format',
      `WAV is ${String(fmt.bitsPerSample)}-bit. 16-bit PCM is required; convert with -c:a pcm_s16le.`,
    );
  }
  if (fmt.sampleRate !== 16_000 && fmt.sampleRate !== 24_000) {
    throw new MediaSourceError(
      'unsupported_format',
      `WAV sample rate is ${String(fmt.sampleRate)} Hz. Use 16000 or 24000 Hz; convert with -ar 24000.`,
    );
  }
  if (fmt.byteRate !== fmt.sampleRate * fmt.channels * 2) {
    throw new MediaSourceError(
      'malformed_media',
      'WAV byte rate disagrees with its sample rate, channels and bit depth.',
    );
  }
  return { ...fmt, dataBytes };
}

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'msnv',
  'M4V ',
  'M4VP',
]);

function assertMp4Brands(bytes: Buffer): void {
  if (upper(bytes, 4, 4) !== 'ftyp' || bytes.length < 16) {
    throw new MediaSourceError(
      'malformed_media',
      'Video is not an MP4 file with an ftyp header. Muse Spark video input is MP4 only.',
    );
  }
  const major = upper(bytes, 8, 4);
  if (major === 'M4A ' || major === 'M4B ') {
    throw new MediaSourceError(
      'unsupported_format',
      'This is an audio-only MP4/M4A container, not a video clip.',
    );
  }
  if (MP4_BRANDS.has(major)) return;
  // Some encoders write a compatible brand list instead of a known major
  // brand. Accept only a known compatible brand in the bounded header.
  const end = Math.min(bytes.length, 8 + bytes.readUInt32BE(0));
  for (let pos = 16; pos + 4 <= end; pos += 4) {
    if (MP4_BRANDS.has(upper(bytes, pos, 4))) return;
  }
  throw new MediaSourceError(
    'unsupported_format',
    `MP4 brand ${JSON.stringify(major)} is not a supported video profile. Re-encode as H.264/AAC MP4.`,
  );
}

interface BoxHeader {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

function readBox(bytes: Buffer, start: number, limit: number): BoxHeader | null {
  if (start + 8 > limit) return null;
  let size = bytes.readUInt32BE(start);
  const type = upper(bytes, start + 4, 4);
  let headerSize = 8;
  if (size === 1) {
    if (start + 16 > limit) return null;
    const high = bytes.readUInt32BE(start + 8);
    const low = bytes.readUInt32BE(start + 12);
    if (high > 0x001f_ffff) return null;
    size = high * 2 ** 32 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = limit - start;
  }
  if (size < headerSize || start + size > limit) return null;
  return { type, start, headerSize, size };
}

/** Read `mvhd` duration from a moov box; null when not measurable. */
function readMvhdDuration(bytes: Buffer, moovStart: number, moovEnd: number): number | null {
  let pos = moovStart + 8;
  let guard = 0;
  while (pos + 8 <= moovEnd) {
    guard += 1;
    if (guard > 10_000) return null;
    const box = readBox(bytes, pos, moovEnd);
    if (box === null) return null;
    if (box.type === 'mvhd') {
      const payload = box.start + box.headerSize;
      const payloadEnd = box.start + box.size;
      if (payload + 4 > payloadEnd) return null;
      const version = bytes[payload];
      if (version === 0) {
        if (payload + 20 > payloadEnd) return null;
        const timescale = bytes.readUInt32BE(payload + 12);
        const duration = bytes.readUInt32BE(payload + 16);
        if (timescale === 0 || duration === 0 || duration === 0xffffffff) return null;
        return (duration * 1000) / timescale;
      }
      if (version === 1) {
        if (payload + 32 > payloadEnd) return null;
        const timescale = bytes.readUInt32BE(payload + 20);
        const high = bytes.readUInt32BE(payload + 24);
        const low = bytes.readUInt32BE(payload + 28);
        if (
          timescale === 0 ||
          (high === 0 && low === 0) ||
          (high === 0xffffffff && low === 0xffffffff)
        )
          return null;
        if (high > 0x001f_ffff) return null;
        return ((high * 2 ** 32 + low) * 1000) / timescale;
      }
      return null;
    }
    pos = box.start + box.size;
  }
  return null;
}

function parseMp4Duration(bytes: Buffer): number {
  assertMp4Brands(bytes);
  let pos = 0;
  let guard = 0;
  while (pos + 8 <= bytes.length) {
    guard += 1;
    if (guard > 10_000) {
      throw new MediaSourceError('malformed_media', 'MP4 has too many top-level boxes to inspect.');
    }
    const box = readBox(bytes, pos, bytes.length);
    if (box === null) {
      throw new MediaSourceError('malformed_media', 'MP4 has a truncated or invalid box header.');
    }
    if (box.type === 'moov') {
      const end = box.start + box.size;
      const durationMs = readMvhdDuration(bytes, box.start, end);
      if (durationMs === null || !Number.isFinite(durationMs)) {
        throw new MediaSourceError(
          'malformed_media',
          'MP4 duration could not be measured from its mvhd box. Re-encode as a standard MP4.',
        );
      }
      return durationMs;
    }
    pos = box.start + box.size;
  }
  throw new MediaSourceError(
    'malformed_media',
    'MP4 has no moov box, so its duration cannot be validated.',
  );
}

/**
 * Inspect declared source bytes. Throws a typed MediaSourceError for every
 * refusal; the caller maps it to an HTTP status and a user-facing message.
 */
export function inspectSourceBytes(bytes: Buffer, declared: MediaSourceMime): InspectedSource {
  if (bytes.length === 0) {
    throw new MediaSourceError('malformed_media', 'The uploaded file is empty.');
  }
  const kind = kindOf(declared);
  const maxBytes = maxBytesFor(kind);
  if (bytes.length > maxBytes) {
    throw new MediaSourceError(
      'size_exceeded',
      `${kind === 'audio' ? 'Audio' : 'Video'} is ${String(bytes.length)} bytes; the limit is ${String(maxBytes)} bytes.`,
    );
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8');
  if (MARKUP_HEAD.test(head)) {
    throw new MediaSourceError(
      'unsupported_format',
      'Markup and SVG files are not audio or video sources.',
    );
  }

  let detected: MediaSourceMime | null = null;
  if (upper(bytes, 0, 4) === 'RIFF' && upper(bytes, 8, 4) === 'WAVE') detected = 'audio/wav';
  else if (upper(bytes, 4, 4) === 'ftyp') detected = 'video/mp4';
  else if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    detected = null;

  if (detected === null) {
    throw new MediaSourceError(
      'unsupported_format',
      declared === 'audio/wav'
        ? 'Unsupported audio container. Upload a mono 16-bit PCM WAV at 16 kHz or 24 kHz.'
        : 'Unsupported video container. Upload an MP4 (H.264/AAC); WebM and MOV are not accepted.',
    );
  }
  if (detected !== declared) {
    throw new MediaSourceError(
      'malformed_media',
      `Declared ${declared} disagrees with the detected ${detected} container; refusing mismatched bytes.`,
    );
  }

  let durationMs: number;
  if (detected === 'audio/wav') {
    const wav = parseWav(bytes);
    durationMs = (wav.dataBytes / (wav.sampleRate * 2)) * 1000;
  } else {
    durationMs = parseMp4Duration(bytes);
  }
  if (!Number.isFinite(durationMs) || durationMs < 1) {
    throw new MediaSourceError('malformed_media', 'The media duration could not be measured.');
  }
  const rounded = Math.round(durationMs);
  const maxDuration = maxDurationFor(kind);
  if (rounded > maxDuration) {
    throw new MediaSourceError(
      'duration_exceeded',
      `${kind === 'audio' ? 'Audio' : 'Video'} is ${(rounded / 1000).toFixed(1)}s; the beta limit is ${String(maxDuration / 1000)}s.`,
    );
  }
  return { kind, mime: detected, durationMs: rounded };
}
