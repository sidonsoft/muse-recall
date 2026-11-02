import { describe, expect, it } from 'vitest';
import {
  CLIP_MAX_OUTPUT_TOKENS,
  MAX_OBSERVATION_CHARS,
  MAX_OBSERVATIONS,
  parseClipResponse,
  parseTranscribeResponse,
} from '../../apps/server/src/media/voice.js';

const SOURCE = '00000000-0000-4000-8000-000000000001';

function clipEnvelope(observations: unknown): string {
  return JSON.stringify({
    status: 'completed',
    model: 'muse-spark-observed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify({ observations }) }],
      },
    ],
  });
}

describe('transcript validation', () => {
  it('accepts a bounded transcript with measured-duration turns', () => {
    const result = parseTranscribeResponse(
      JSON.stringify({
        transcript: 'Make the header smaller.',
        audioDurationMs: 2_000,
        model: 'muse-voice-observed',
        turns: [
          { turnId: 0, startMs: 0, endMs: 900, transcript: 'Make the header', speaker: 'A' },
          { turnId: 1, startMs: 900, endMs: 2_000, transcript: 'smaller.' },
        ],
      }),
      { sourceId: SOURCE, durationMs: 2_020, model: 'muse-voice-transcribe-1.0' },
    );
    expect(result.transcript).toBe('Make the header smaller.');
    expect(result.turns[1]).toMatchObject({ turn_id: 1, start_ms: 900, end_ms: 2_000 });
    expect(result.audio_duration_ms).toBe(2_000);
    expect(result.observed_model).toBe('muse-voice-observed');
  });

  it('accepts an empty transcript (silence) without inventing text', () => {
    const result = parseTranscribeResponse(
      JSON.stringify({ transcript: '', audioDurationMs: 1_000, turns: [] }),
      { sourceId: SOURCE, durationMs: 1_000, model: 'muse-voice-transcribe-1.0' },
    );
    expect(result.transcript).toBe('');
    expect(result.turns).toEqual([]);
  });

  it('refuses a provider duration that disagrees with the uploaded file', () => {
    expect(() =>
      parseTranscribeResponse(JSON.stringify({ transcript: 'hello', audioDurationMs: 10_000 }), {
        sourceId: SOURCE,
        durationMs: 1_000,
        model: 'muse-voice-transcribe-1.0',
      }),
    ).toThrow(/mismatched result/);
  });

  it('refuses turns whose timestamps fall outside the measured duration', () => {
    expect(() =>
      parseTranscribeResponse(
        JSON.stringify({
          transcript: 'hello',
          turns: [{ startMs: 500, endMs: 9_000, transcript: 'hello' }],
        }),
        { sourceId: SOURCE, durationMs: 1_000, model: 'muse-voice-transcribe-1.0' },
      ),
    ).toThrow(/outside 0\.\.1000 ms/);
  });

  it('refuses reversed turns and non-object envelopes', () => {
    expect(() =>
      parseTranscribeResponse(
        JSON.stringify({ transcript: 'x', turns: [{ startMs: 800, endMs: 100, text: 'x' }] }),
        { sourceId: SOURCE, durationMs: 1_000, model: 'muse-voice-transcribe-1.0' },
      ),
    ).toThrow(/invalid shape or timestamp/);
    expect(() =>
      parseTranscribeResponse('not json', {
        sourceId: SOURCE,
        durationMs: 1_000,
        model: 'muse-voice-transcribe-1.0',
      }),
    ).toThrow(/not a JSON object/);
  });

  it('refuses an error object instead of treating it as an empty transcript', () => {
    expect(() =>
      parseTranscribeResponse(JSON.stringify({ type: 'error', message: 'unsupported encoding' }), {
        sourceId: SOURCE,
        durationMs: 1_000,
        model: 'muse-voice-transcribe-1.0',
      }),
    ).toThrow(/unsupported encoding/);
  });
});

describe('clip observation validation', () => {
  it('accepts observations inside the measured duration and clamps tolerance edges', () => {
    const result = parseClipResponse(
      clipEnvelope([
        { observation: 'A card grid is visible.', startMs: 0, endMs: 1_000, confidence: 0.9 },
        {
          observation: 'The primary button pulses.',
          startMs: 1_000,
          endMs: 1_030,
          confidence: 0.5,
        },
      ]),
      { sourceId: SOURCE, durationMs: 1_020, model: 'muse-spark-1.3', fileId: 'file-abc' },
    );
    expect(result.observations).toHaveLength(2);
    expect(result.observations[1]?.end_ms).toBe(1_020);
    expect(result.file_id).toBe('file-abc');
    expect(result.observed_model).toBe('muse-spark-observed');
  });

  it('accepts zero observations as a valid result', () => {
    const result = parseClipResponse(clipEnvelope([]), {
      sourceId: SOURCE,
      durationMs: 5_000,
      model: 'muse-spark-1.3',
      fileId: null,
    });
    expect(result.observations).toEqual([]);
  });

  it('refuses timestamps beyond the measured duration', () => {
    expect(() =>
      parseClipResponse(
        clipEnvelope([
          { observation: 'Something happens.', startMs: 0, endMs: 6_500, confidence: 0.8 },
        ]),
        { sourceId: SOURCE, durationMs: 5_000, model: 'muse-spark-1.3', fileId: null },
      ),
    ).toThrow(/outside 0\.\.5000 ms/);
  });

  it('refuses invalid confidence, empty text, and non-JSON output', () => {
    expect(() =>
      parseClipResponse(
        clipEnvelope([{ observation: 'x', startMs: 0, endMs: 10, confidence: 1.5 }]),
        { sourceId: SOURCE, durationMs: 5_000, model: 'muse-spark-1.3', fileId: null },
      ),
    ).toThrow(/invalid shape/);
    expect(() =>
      parseClipResponse(
        clipEnvelope([{ observation: '   ', startMs: 0, endMs: 10, confidence: 0.5 }]),
        {
          sourceId: SOURCE,
          durationMs: 5_000,
          model: 'muse-spark-1.3',
          fileId: null,
        },
      ),
    ).toThrow(/invalid shape/);
    expect(() =>
      parseClipResponse(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'nope' }] }],
        }),
        { sourceId: SOURCE, durationMs: 5_000, model: 'muse-spark-1.3', fileId: null },
      ),
    ).toThrow(/did not return observation JSON/);
  });

  it('refuses a refusal response instead of returning an empty list', () => {
    expect(() =>
      parseClipResponse(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot analyze this.' }],
            },
          ],
        }),
        { sourceId: SOURCE, durationMs: 5_000, model: 'muse-spark-1.3', fileId: null },
      ),
    ).toThrow(/refused/);
  });
});

describe('clip output budget (sized from the schema, not guessed)', () => {
  it('never caps the answer below what its own schema permits the model to write', () => {
    // The live failure was truncation at the cap, so an incomplete result here
    // means the request asked for less output than the response format allows.
    const worstCaseTextTokens = Math.ceil(
      (MAX_OBSERVATIONS * MAX_OBSERVATION_CHARS) / 4 +
        // the array wrapper, keys, numbers and separators a strict answer spends
        MAX_OBSERVATIONS * 12,
    );
    expect(CLIP_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(worstCaseTextTokens);
  });

  it('stays inside a sane ceiling so a runaway budget cannot replace a runaway answer', () => {
    expect(CLIP_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4_000);
    expect(CLIP_MAX_OUTPUT_TOKENS).toBeGreaterThan(1_200);
  });
});
