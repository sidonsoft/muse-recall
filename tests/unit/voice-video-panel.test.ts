import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  encodeWav,
  sourceMimeForFile,
  VoiceVideoPanel,
} from '../../apps/web/src/components/studio/VoiceVideoPanel.tsx';

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
