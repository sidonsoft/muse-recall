import { Buffer } from 'node:buffer';

export interface WavOptions {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  durationMs?: number;
  audioFormat?: number;
}

/** Build a deterministic PCM WAV fixture; deliberately permissive for refusal tests. */
export function wavBytes(options: WavOptions = {}): Buffer {
  const sampleRate = options.sampleRate ?? 24_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const durationMs = options.durationMs ?? 1_000;
  const audioFormat = options.audioFormat ?? 1;
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataBytes = frames * channels * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}

export interface Mp4Options {
  durationMs?: number;
  timescale?: number;
  brand?: string;
  omitMoov?: boolean;
  zeroDuration?: boolean;
  tracks?: Array<'vide' | 'soun'>;
  malformedHandler?: boolean;
}

function hdlr(handlerType: 'vide' | 'soun', malformed: boolean): Buffer {
  const payload = Buffer.alloc(malformed ? 8 : 24);
  if (!malformed) payload.write(handlerType, 8);
  return box('hdlr', payload);
}

/** Build a minimal ISO-BMFF fixture with ftyp, moov/mvhd, and explicit tracks. */
export function mp4Bytes(options: Mp4Options = {}): Buffer {
  const durationMs = options.durationMs ?? 10_000;
  const timescale = options.timescale ?? 1_000;
  const brand = options.brand ?? 'isom';
  const tracks = options.tracks ?? ['vide'];
  const ftypPayload = Buffer.alloc(12);
  ftypPayload.write(brand, 0);
  ftypPayload.writeUInt32BE(512, 4);
  ftypPayload.write('isom', 8);
  const ftyp = box('ftyp', ftypPayload);
  if (options.omitMoov === true) return ftyp;
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt8(0, 0);
  mvhdPayload.writeUIntBE(0, 1, 3);
  mvhdPayload.writeUInt32BE(0, 4);
  mvhdPayload.writeUInt32BE(0, 8);
  mvhdPayload.writeUInt32BE(timescale, 12);
  mvhdPayload.writeUInt32BE(options.zeroDuration === true ? 0 : durationMs, 16);
  const mvhd = box('mvhd', mvhdPayload);
  const traks = tracks.map((handler) =>
    box('trak', box('mdia', hdlr(handler, options.malformedHandler === true))),
  );
  return Buffer.concat([ftyp, box('moov', Buffer.concat([mvhd, ...traks]))]);
}

export function base64(bytes: Buffer): string {
  return bytes.toString('base64');
}
