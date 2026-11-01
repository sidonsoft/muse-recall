import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  boundedExcerpt,
  clipFixturePlan,
  clipPromptIssues,
  clipTokenMatch,
  FFMPEG_BIN,
  FFPROBE_BIN,
  liveScope,
  MEDIA_MODEL_FIELDS,
  mediaMetaIssues,
  missingLivePrerequisites,
  parseProbe,
  probeIssues,
  reserveLoopbackPort,
  SAY_BIN,
  speechFixturePlan,
  tallyAttempts,
  timestampIssues,
  transcriptMatch,
  waitForServerReady,
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

describe('Batch D live prerequisites and readiness', () => {
  it('waits for the port to answer instead of trusting a bind', async () => {
    // `listen(0)` returns before the socket is bound, so readiness has to be
    // probed: a false answer means "not yet", and the probe count is evidence of
    // how long the run waited.
    let probes = 0;
    const ready = await waitForServerReady({
      port: 4321,
      probe: async () => {
        probes += 1;
        return probes === 3;
      },
      sleep: async () => undefined,
    });
    expect(ready).toEqual({ ready: true, attempts: 3 });
  });

  it('names the transport error when a port never answers', async () => {
    // A server that died at startup leaves the port closed. Collapsing that into a
    // generic "never became healthy" hid whether the process, the port or the probe
    // was at fault.
    const outcome = await waitForServerReady({
      port: 4321,
      probe: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:4321');
      },
      timeoutMs: 250,
      pollMs: 0,
      sleep: async () => undefined,
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.attempts).toBeGreaterThan(1);
    expect(outcome.lastError).toContain('ECONNREFUSED');
  });

  it('recovers from a probe that throws before the server is up', async () => {
    let probes = 0;
    const outcome = await waitForServerReady({
      port: 4321,
      probe: async () => {
        probes += 1;
        if (probes === 1) throw new Error('socket hang up');
        return true;
      },
      sleep: async () => undefined,
    });
    expect(outcome).toEqual({ ready: true, attempts: 2 });
  });

  it('reserves a real port and then sees a server bound to it', async () => {
    // The reservation is the point: `listen(0)` reports no address until the socket
    // is bound, so reading it synchronously yields null. A harness that turns that
    // into port 0 can never reach the server it means to probe.
    const port = await reserveLoopbackPort();
    expect(port).toBeGreaterThan(1023);
    expect(await reserveLoopbackPort()).not.toBe(port);

    // An HTTP server, because the readiness probe speaks HTTP: the reserved port
    // has to be one a health check can actually answer on.
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    try {
      const ready = await waitForServerReady({
        port,
        probe: async (probePort) =>
          (await fetch(`http://127.0.0.1:${String(probePort)}/api/health`)).status === 200,
        sleep: async () => undefined,
      });
      expect(ready).toEqual({ ready: true, attempts: 1 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('calls a missing fixture tool a local blocker, not a provider result', () => {
    const audio = liveScope({ BATCHD_SMOKE_SCOPE: 'audio' });
    // Without `say` there is no known sentence to speak, so the run has nothing to
    // measure; it must say so instead of transcribing silence.
    const problems = missingLivePrerequisites({
      scope: audio,
      audioSupplied: false,
      videoSupplied: false,
      videoPresent: true,
      platform: 'linux',
      hasSay: false,
      hasFfmpeg: true,
      hasFfprobe: true,
    });
    expect(problems).toEqual([expect.stringContaining('BATCHD_SMOKE_AUDIO_WAV')]);

    const videoOnly = missingLivePrerequisites({
      scope: liveScope({ BATCHD_SMOKE_SCOPE: 'video' }),
      audioSupplied: false,
      videoSupplied: false,
      videoPresent: true,
      platform: 'darwin',
      hasSay: true,
      hasFfmpeg: false,
      hasFfprobe: true,
    });
    expect(videoOnly).toEqual([expect.stringContaining('ffmpeg')]);

    // A supplied recording or MP4 removes the local requirement entirely.
    const supplied = missingLivePrerequisites({
      scope: liveScope({ BATCHD_SMOKE_SCOPE: 'both' }),
      audioSupplied: true,
      videoSupplied: true,
      videoPresent: true,
      platform: 'linux',
      hasSay: false,
      hasFfmpeg: false,
      hasFfprobe: false,
    });
    expect(supplied).toEqual([]);

    expect(
      missingLivePrerequisites({
        scope: liveScope({ BATCHD_SMOKE_SCOPE: 'video' }),
        audioSupplied: false,
        videoSupplied: true,
        videoPresent: false,
        platform: 'darwin',
        hasSay: true,
        hasFfmpeg: true,
        hasFfprobe: true,
      }),
    ).toEqual([expect.stringContaining('BATCHD_SMOKE_VIDEO_MP4')]);
  });

  it('refuses to assume zero retries when the server says nothing about media', () => {
    expect(mediaMetaIssues(undefined)).toEqual([expect.stringContaining('/api/meta')]);
    expect(mediaMetaIssues({ max_retries: 2 })).toEqual([
      expect.stringContaining('media.max_retries=2'),
    ]);
    const complete = {
      max_retries: 0,
      image_model: 'muse-image-1.0',
      sam_model: 'sam-3.1',
      vision_model: 'muse-spark-1.3',
      transcribe_model: 'muse-voice-transcribe-1.0',
      video_model: 'muse-spark-1.3',
    };
    expect(mediaMetaIssues(complete)).toEqual([]);
    // A server that reports the retry knob but not the voice model cannot support
    // the claim "this call paid for transcription".
    expect(mediaMetaIssues({ ...complete, transcribe_model: '' })).toEqual([
      expect.stringContaining('transcribe_model'),
    ]);
    expect(MEDIA_MODEL_FIELDS).toContain('video_model');
  });

  it('asks the clip prompt about exactly what the recipe renders', async () => {
    const plan = clipFixturePlan('/tmp/run');
    // The recipe is the control; the prompt must name it, or an empty observation
    // cannot be read as a model result.
    expect(clipPromptIssues(plan.prompt)).toEqual([]);
    expect(clipPromptIssues('Describe what is shown and what changes over time.')).toEqual(
      expect.arrayContaining([expect.stringContaining('red background')]),
    );
    // The observation tokens the match is scored against appear in both.
    for (const token of plan.expectedTokens) {
      expect(plan.prompt.toLowerCase()).toContain(token);
    }
    const graph = plan.steps[0]?.args.join(' ') ?? '';
    expect(graph).toContain('red');
    expect(graph).toContain('green');
    expect(plan.prompt).toContain('green square');
  });

  it('names the binaries a run will actually execute', () => {
    // A prerequisite check that tests one binary while the recipe runs another
    // certifies a tool the run never calls.
    const speech = speechFixturePlan('/tmp/run');
    const clip = clipFixturePlan('/tmp/run');
    expect(speech.steps[0]?.command).toBe(SAY_BIN);
    expect(speech.steps[1]?.command).toBe(FFMPEG_BIN);
    expect(clip.steps[0]?.command).toBe(FFMPEG_BIN);
    // ...and those constants follow the same overrides a harness passes to its
    // probes, so a prerequisite check cannot certify a binary the run never calls.
    expect(FFMPEG_BIN).toBe(process.env.FFMPEG_BIN ?? 'ffmpeg');
    expect(FFPROBE_BIN).toBe(process.env.FFPROBE_BIN ?? 'ffprobe');
  });
});
