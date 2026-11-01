import { describe, expect, it } from 'vitest';
import {
  boundedExcerpt,
  clipFixturePlan,
  clipTokenMatch,
  liveScope,
  parseProbe,
  probeIssues,
  speechFixturePlan,
  tallyAttempts,
  timestampIssues,
  transcriptMatch,
} from '../../scripts/lib/batchd-live.js';

const AUDIO_DUMP = {
  streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '16000', channels: '1' }],
  format: { duration: '5.138938', size: '164524' },
};

const VIDEO_DUMP = {
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 96, height: 96, nb_frames: '20' }],
  format: { duration: '2.000000', size: '3305' },
};

describe('Batch D live fixture recipes', () => {
  it('describes a speech fixture that transcribes at a known rate', () => {
    const plan = speechFixturePlan('/tmp/run');
    expect(plan.wavPath).toBe('/tmp/run/speech.wav');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.args).toEqual(['-r', '165', '-o', '/tmp/run/speech.aiff', plan.phrase]);
    expect(plan.steps[1]?.args).toContain('pcm_s16le');
    expect(plan.steps[1]?.args).toContain('16000');
    const probe = parseProbe(AUDIO_DUMP);
    expect(probe).not.toBeNull();
    const issues = probeIssues(probe, {
      codec: plan.expect.codec,
      sampleRate: plan.expect.sampleRate,
      channels: plan.expect.channels,
    });
    expect(issues.issues).toEqual([]);
    // The measured duration is what every timestamp check is against.
    expect(probe?.durationMs).toBe(5139);
    expect(probe?.bytes).toBe(164_524);
  });

  it('describes a clip fixture that stays small and probeable', () => {
    const plan = clipFixturePlan('/tmp/run');
    expect(plan.mp4Path).toBe('/tmp/run/clip.mp4');
    expect(plan.steps[0]?.args).toContain('+faststart');
    expect(plan.steps[0]?.args).toContain('-an');
    const probe = parseProbe(VIDEO_DUMP);
    const issues = probeIssues(probe, plan.expect);
    expect(issues.issues).toEqual([]);
    expect(probe?.durationMs).toBe(2000);
  });

  it('refuses a fixture that does not match its own recipe', () => {
    const compressed = {
      streams: [{ codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: '2' }],
      format: { duration: '0.4', size: '1200' },
    };
    const plan = speechFixturePlan('/tmp/run');
    const issues = probeIssues(parseProbe(compressed), {
      codec: plan.expect.codec,
      sampleRate: plan.expect.sampleRate,
      channels: plan.expect.channels,
    });
    expect(issues.issues.join(' ')).toContain('codec is opus');
    expect(issues.issues.join(' ')).toContain('sample rate is 48000');
    expect(issues.issues.join(' ')).toContain('duration is 400ms');

    // A dump with no media stream at all is an unusable fixture, not a pass.
    expect(probeIssues(parseProbe({ streams: [], format: {} }), plan.expect).issues).toHaveLength(
      1,
    );
    expect(probeIssues(parseProbe(null), plan.expect).issues).toHaveLength(1);
  });
});

describe('measuring a real transcript', () => {
  it('reports word agreement without claiming accuracy', () => {
    const spoken =
      'Remember that the studio uses a woodland palette, and it never uses countdown timers.';
    const heard = 'remember that the studio used a woodland pale it never uses count down timers';
    const match = transcriptMatch(spoken, heard, ['woodland', 'never', 'countdown', 'timers']);
    expect(match.spokenWords).toBeGreaterThan(5);
    expect(match.keywordsFound).toEqual(['woodland', 'never', 'timers']);
    expect(match.keywordsMissing).toEqual(['countdown']);
    expect(match.missing).toContain('countdown');
    expect(match.ratio).toBeGreaterThan(0.5);
    expect(match.ratio).toBeLessThan(1);
  });

  it('treats an empty transcript as heard nothing', () => {
    const match = transcriptMatch('woodland palette never countdown timers', '   ');
    expect(match.matchedWords).toBe(0);
    expect(match.ratio).toBe(0);
    expect(match.keywordsMissing.length).toBeGreaterThan(0);
  });

  it('is not fooled by a fluent transcript that dropped the content words', () => {
    const match = transcriptMatch(
      'Remember that the studio uses a woodland palette, and it never uses countdown timers.',
      'This is a recording of somebody talking about design choices.',
      ['woodland', 'palette', 'countdown'],
    );
    expect(match.keywordsFound).toEqual([]);
    expect(match.keywordsMissing).toEqual(['woodland', 'palette', 'countdown']);
  });
});

describe('timestamps are measured against the file, not the provider', () => {
  it('accepts turns inside the measured duration', () => {
    expect(
      timestampIssues(
        [
          { start_ms: 0, end_ms: 2400, text: 'a' },
          { start_ms: 2400, end_ms: 5100, text: 'b' },
        ],
        5139,
      ),
    ).toEqual([]);
  });

  it('refuses a turn that runs past the clip or backwards', () => {
    const issues = timestampIssues(
      [
        { start_ms: 4000, end_ms: 9000, text: 'a' },
        { start_ms: 3000, end_ms: 1000, text: 'b' },
      ],
      5139,
      1000,
    );
    expect(issues.join(' ')).toContain('past the measured 5139ms clip');
    expect(issues.join(' ')).toContain('ends before it starts');
  });
});

describe('clip observations are reported, not judged', () => {
  it('records lexical agreement with what the clip actually shows', () => {
    const match = clipTokenMatch([
      { observation: 'A green square moves across a red background.' },
    ]);
    expect(match.found.sort()).toEqual(['green', 'red', 'square']);
    expect(match.missing).toEqual([]);
    const none = clipTokenMatch([{ observation: 'Something changes over time.' }]);
    expect(none.found).toEqual([]);
    expect(none.missing.sort()).toEqual(['green', 'red', 'square']);
  });
});

describe('evidence excerpts', () => {
  it('keeps a transcript excerpt bounded and collapsed', () => {
    const long = `line one\n  line two   ${'x'.repeat(400)}`;
    const excerpt = boundedExcerpt(long, 60);
    expect(excerpt.length).toBeLessThanOrEqual(61);
    expect(excerpt).not.toContain('\n');
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('redacts a credential the spoken content happens to contain', () => {
    const excerpt = boundedExcerpt('the key is sk-live-ABCDEFGH1234567890 and that is that');
    expect(excerpt).not.toContain('sk-live-ABCDEFGH1234567890');
    expect(excerpt).toContain('[REDACTED');
  });

  it('never splits a redaction marker at the cut', () => {
    const text = `a b ${'y'.repeat(200)} sk-live-ABCDEFGH1234567890 tail`;
    const excerpt = boundedExcerpt(text, 214);
    expect(excerpt).not.toMatch(/\[REDACTED(?::[^\]]*)?…$/);
    expect(excerpt).not.toContain('sk-live-');
  });
});

describe('run scope and dispatch accounting', () => {
  it('defaults to the cheapest live measurement', () => {
    const scope = liveScope({});
    expect(scope.audio).toBe(true);
    expect(scope.video).toBe(false);
    expect(scope.mode).toBe('ENDPOINTING');
    expect(scope.maxTranscribeCalls).toBe(1);
    expect(scope.maxClipCalls).toBe(1);
  });

  it('only spends the video call when the run names it', () => {
    expect(liveScope({ BATCHD_SMOKE_SCOPE: 'both' }).video).toBe(true);
    expect(liveScope({ BATCHD_SMOKE_SCOPE: 'video' }).audio).toBe(false);
    // A nonsense scope still yields a defined one, never "everything by accident".
    const fallback = liveScope({ BATCHD_SMOKE_SCOPE: 'everything' });
    expect(fallback.audio).toBe(true);
    expect(fallback.video).toBe(false);
  });

  it('reads retries straight from the adapter trace', () => {
    const trace = [
      { attempt: 1, path: '/v1/asr/transcribe', outcome: 'response', status: 200 },
      { attempt: 1, path: '/v1/files' },
      { attempt: 1, path: '/v1/responses', outcome: 'response', status: 200 },
    ];
    expect(tallyAttempts(trace, '/v1/asr/transcribe').maxAttempt).toBe(1);
    expect(tallyAttempts(trace, '/v1/never-called').attempts).toBe(0);
    expect(tallyAttempts(trace, '/v1/responses').paths).toContain('/v1/files');
    const retried = [
      { attempt: 1, path: '/v1/asr/transcribe' },
      { attempt: 2, path: '/v1/asr/transcribe' },
    ];
    expect(tallyAttempts(retried, '/v1/asr/transcribe').maxAttempt).toBe(2);
  });
});
