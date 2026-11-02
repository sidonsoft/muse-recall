import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { batchcExpectedCalls, batchcLedgerIssues } from '../../scripts/lib/batchc-scope.js';
import {
  batchdLedgerIssues,
  expectedBatchdCalls,
  liveScopeAllowedPaths,
} from '../../scripts/lib/batchd-live.js';
import { imageLedgerIssues } from '../../scripts/lib/image-live.js';
import {
  accountDispatches,
  ledgerEvidence,
  ledgerIntegrityIssues,
  parseMediaTrace,
  pathsOutside,
} from '../../scripts/lib/media-trace.js';
import { reviewLedgerIssues } from '../../scripts/lib/review-live.js';

const root = mkdtempSync(join(tmpdir(), 'ledger-policies-'));

/**
 * Whole-run paid-call budgets, exercised with synthetic traces.
 *
 * These are the two holes an independent review found in the accounting that
 * `b698070` introduced: forbidden-path counts were computed but never required to
 * be zero, and an incomplete ledger (a start line nobody answered, or an outcome
 * that answers nothing) could still satisfy an "exactly one dispatch" check. Both
 * are reproduced here without a provider, because the gate code is pure.
 */
const trace = (lines: string[]): ReturnType<typeof accountDispatches> =>
  accountDispatches(parseMediaTrace(lines.map((line) => `[media-trace] ${line}`).join('\n')));

const start = (path: string, model: string, attempt = 1): string =>
  `attempt=${String(attempt)} path=${path} model=${model}`;
const done = (attempt = 1, status = 200): string =>
  `outcome=response attempt=${String(attempt)} status=${String(status)} bytes=64`;

describe('whole-run paid-call budgets', () => {
  it('refuses an image run that also touched a path nobody thought to forbid', () => {
    // The exact case the review reported: generate + edit + an extra upload. The
    // forbidden list named only /v1/responses and /v1/asr/transcribe, so the run
    // printed "touched only image paths" while otherPaidPaths sat at 1.
    const ledger = trace([
      start('/v1/images/generations', 'muse-image-1.0'),
      done(),
      start('/v1/images/edits', 'muse-image-1.0'),
      done(),
      start('/v1/files', 'upload'),
      done(),
    ]);
    const issues = imageLedgerIssues(ledger, { generate: 1, edit: 1 });
    expect(issues.join(' ')).toContain('/v1/files');
    expect(issues.join(' ')).toContain('never allowed to touch');
  });

  it('refuses a batchd run that paid on a path outside its scope', () => {
    const audioScope = { audio: true, video: false } as never;
    const ledger = trace([
      start('/v1/asr/transcribe', 'muse-voice-transcribe-1.0'),
      done(),
      start('/v1/images/generations', 'muse-image-1.0'),
      done(),
    ]);
    const issues = batchdLedgerIssues(ledger, audioScope, expectedBatchdCalls(audioScope));
    expect(issues.join(' ')).toContain('outside its scope');
    expect(issues.join(' ')).toContain('/v1/images/generations');
  });

  it('refuses a review run that shows a second review dispatch', () => {
    const ledger = trace([
      start('/v1/responses', 'muse-spark-1.3'),
      done(),
      start('/v1/responses', 'muse-spark-1.3'),
      done(),
    ]);
    expect(reviewLedgerIssues(ledger, 1).join(' ')).toContain('expected 1 review dispatch');
  });

  it('refuses an unanswered start line, because the paid-call count is then unknown', () => {
    const ledger = trace([start('/v1/images/generations', 'muse-image-1.0')]);
    expect(ledger.unanswered.length).toBe(1);
    // "Exactly one dispatch" was satisfied here while the call may never have
    // completed; the integrity rule is what closes that.
    const issues = imageLedgerIssues(ledger, { generate: 1, edit: 0 });
    expect(issues.join(' ')).toContain('never answered');
    expect(ledgerIntegrityIssues(ledger, 'review run').join(' ')).toContain(
      'how many calls were paid is unknown',
    );
  });

  it('refuses an outcome line that answers no dispatch this run started', () => {
    const ledger = trace([
      start('/v1/responses', 'muse-spark-1.3'),
      done(),
      'outcome=response attempt=7 status=200 bytes=12',
    ]);
    expect(ledger.unpairedOutcomes.length).toBe(1);
    expect(reviewLedgerIssues(ledger, 1).join(' ')).toContain('answer no dispatch');
  });

  it('refuses a retry instead of reporting it as an extra capability', () => {
    const ledger = trace([
      start('/v1/asr/transcribe', 'muse-voice-transcribe-1.0'),
      done(1, 500),
      start('/v1/asr/transcribe', 'muse-voice-transcribe-1.0', 2),
      done(2),
    ]);
    const audioScope = { audio: true, video: false } as never;
    const issues = batchdLedgerIssues(ledger, audioScope, expectedBatchdCalls(audioScope));
    expect(issues.join(' ')).toContain('attempt beyond 1');
  });

  it('accepts a complete ledger that matches its budget exactly', () => {
    const ledger = trace([
      start('/v1/asr/transcribe', 'muse-voice-transcribe-1.0'),
      done(),
      start('/v1/files', 'upload'),
      done(),
      start('/v1/responses', 'muse-spark-1.3'),
      done(),
    ]);
    const both = { audio: true, video: true } as never;
    expect(batchdLedgerIssues(ledger, both, expectedBatchdCalls(both))).toEqual([]);
    expect(liveScopeAllowedPaths(both).sort()).toEqual(
      ['/v1/asr/transcribe', '/v1/files', '/v1/responses'].sort(),
    );
    expect(pathsOutside(ledger, ['/v1/asr/transcribe', '/v1/files', '/v1/responses'])).toEqual([]);
  });

  it("reports the scope's allowed paths for a video-only run", () => {
    const video = { audio: false, video: true } as never;
    expect(liveScopeAllowedPaths(video)).toEqual(['/v1/files', '/v1/responses']);
    expect(expectedBatchdCalls(video)).toEqual({ transcribe: 0, clipModel: 1, uploads: 1 });
    // A transcription dispatch is out of scope for a video-only run even though
    // /v1/asr/transcribe is a legitimate product path elsewhere.
    const ledger = trace([start('/v1/asr/transcribe', 'muse-voice-transcribe-1.0'), done()]);
    expect(batchdLedgerIssues(ledger, video, expectedBatchdCalls(video)).join(' ')).toContain(
      'outside its scope',
    );
  });
});

/**
 * The same policies applied to the real lines real money produced.
 *
 * `test-results/` is gitignored, so the lines below are transcribed verbatim from the
 * retained evidence rather than read at run time:
 *   test-results/batchc-live/2026-11-01-0106/server.log      (vision-only, 1 dispatch)
 *   test-results/batchc-live/2026-11-01-0755/server.log      (resume: SAM only, +coding via CLI)
 *   test-results/batchd-live/2026-11-02-0400/server.log      (clip: upload + model)
 *   test-results/batchd-live/2026-11-02-0458/server.log      (transcription)
 *   test-results/review-live/2026-11-02-0451/server.log      (one review dispatch)
 *   test-results/image-live/2026-11-02-0445/server.log       (generate + edit)
 * Synthetic traces found the accounting holes; these pin the other direction — that the
 * tightened rules do not invent violations on ledgers that were actually paid for. A
 * policy that fails a real paid run is a false alarm the next live acceptance will pay
 * for twice.
 */
const realClipRun = trace([
  'attempt=1 path=/v1/files model=(none)',
  'outcome=response attempt=1 status=200 bytes=165',
  'attempt=1 path=/v1/responses model=muse-spark-1.3',
  'outcome=response attempt=1 status=200 bytes=2025',
]);
const realAudioRun = trace([
  'attempt=1 path=/v1/asr/transcribe model=(none)',
  'outcome=response attempt=1 status=200 bytes=338',
]);
const realReviewRun = trace([
  'attempt=1 path=/v1/responses model=muse-spark-1.3',
  'outcome=response attempt=1 status=200 bytes=1668',
]);
const realImageRun = trace([
  'attempt=1 path=/v1/images/generations model=muse-image-1.0',
  'outcome=response attempt=1 status=200 bytes=35834',
  'attempt=1 path=/v1/images/edits model=(none)',
  'outcome=response attempt=1 status=200 bytes=51660',
]);
const realVisionOnlyRun = trace([
  'attempt=1 path=/v1/responses model=muse-spark-1.3',
  'outcome=response attempt=1 status=200 bytes=1520',
]);
const realResumeRun = trace([
  'attempt=1 path=/v1/responses model=sam-3.1',
  'outcome=response attempt=1 status=200 bytes=9591 events=10',
]);

describe('real paid ledgers', () => {
  it('finds no violation in any retained paid run', () => {
    const video = { audio: false, video: true } as never;
    const audio = { audio: true, video: false } as never;
    expect(batchdLedgerIssues(realClipRun, video, expectedBatchdCalls(video))).toEqual([]);
    expect(batchdLedgerIssues(realAudioRun, audio, expectedBatchdCalls(audio))).toEqual([]);
    expect(reviewLedgerIssues(realReviewRun, 1)).toEqual([]);
    expect(imageLedgerIssues(realImageRun, { generate: 1, edit: 1 })).toEqual([]);
    expect(batchcLedgerIssues(realVisionOnlyRun, batchcExpectedCalls('vision-only'))).toEqual([]);
    expect(batchcLedgerIssues(realResumeRun, batchcExpectedCalls('resume'))).toEqual([]);
  });

  it('reads a model name from the start line and never from the outcome line', () => {
    // Several real start lines log `model=(none)`; an outcome line logs no path and
    // no model at all. A rule that matched needles against outcome lines would report
    // every real run as having unanswered dispatches.
    const audio = realAudioRun.dispatches[0];
    const sam = realResumeRun.dispatches[0];
    if (audio === undefined || sam === undefined) {
      throw new Error('the trace reader dropped a dispatch from a real paid ledger');
    }
    expect(realAudioRun.dispatches.length).toBe(1);
    expect(audio.path).toBe('/v1/asr/transcribe');
    expect(audio.model).toBe('(none)');
    expect(realAudioRun.unanswered).toEqual([]);
    expect(realAudioRun.unpairedOutcomes).toEqual([]);
    expect(sam.model).toBe('sam-3.1');
  });
});

describe('the Batch C paid gate is bounded the same way as the others', () => {
  it('authorises exactly what each scope pays for', () => {
    expect(batchcExpectedCalls('full')).toEqual({ vision: 1, sam: 1 });
    expect(batchcExpectedCalls('vision-only')).toEqual({ vision: 1, sam: 0 });
    expect(batchcExpectedCalls('resume')).toEqual({ vision: 0, sam: 1 });
    expect(batchcExpectedCalls('resume-cutout')).toEqual({ vision: 0, sam: 0 });
  });

  it('refuses a vision-only run that also paid for SAM', () => {
    // Vision and SAM share /v1/responses, so the path budget alone cannot catch this:
    // the run looks like one permitted dispatch on a permitted path.
    const ledger = trace([
      'attempt=1 path=/v1/responses model=muse-spark-1.3',
      'outcome=response attempt=1 status=200 bytes=1520',
      'attempt=1 path=/v1/responses model=sam-3.1',
      'outcome=response attempt=1 status=200 bytes=786',
    ]);
    const issues = batchcLedgerIssues(ledger, batchcExpectedCalls('vision-only'));
    expect(issues.join(' ')).toContain('expected 0 SAM dispatch(es) on model sam-, saw 1');
  });

  it('refuses a Batch C run that touched an image path', () => {
    const ledger = trace([
      'attempt=1 path=/v1/responses model=muse-spark-1.3',
      'outcome=response attempt=1 status=200 bytes=1520',
      'attempt=1 path=/v1/images/generations model=muse-image-1.0',
      'outcome=response attempt=1 status=200 bytes=35834',
      'attempt=1 path=/v1/responses model=sam-3.1',
      'outcome=response attempt=1 status=200 bytes=9591',
    ]);
    const issues = batchcLedgerIssues(ledger, batchcExpectedCalls('full'));
    expect(issues.join(' ')).toContain('never allowed to touch: /v1/images/generations');
    // The message says why an extra media path is always an extra media call.
    expect(issues.join(' ')).toContain('coding never appears in this ledger');
  });

  it('refuses a resume run that paid for vision it was supposed to reuse', () => {
    const issues = batchcLedgerIssues(realVisionOnlyRun, batchcExpectedCalls('resume'));
    expect(issues.join(' ')).toContain('expected 0 vision dispatch(es) on model muse-spark');
  });
});

describe('a ledger claim names the log behind it', () => {
  it('says nothing was read when there is no log, instead of calling the ledger clean', () => {
    const evidence = ledgerEvidence(join(root, 'does-not-exist.log'));
    expect(evidence.logPresent).toBe(false);
    expect(evidence.logBytes).toBe(0);
    expect(evidence.note).toContain('nothing was read');
    // An empty ledger is only a fact about an empty string.
    const empty = accountDispatches(parseMediaTrace(''));
    expect(empty.dispatches).toEqual([]);
    expect(ledgerIntegrityIssues(empty, 'run')).toEqual([]);
  });

  it('records the byte size of a log it did read', () => {
    const logPath = join(root, 'trace.log');
    writeFileSync(
      logPath,
      '[media-trace] attempt=1 path=/v1/responses model=muse-spark-1.3\n[media-trace] outcome=response attempt=1 status=200 bytes=1668\n',
      'utf8',
    );
    const evidence = ledgerEvidence(logPath);
    expect(evidence.logPresent).toBe(true);
    expect(evidence.logBytes).toBeGreaterThan(60);
    expect(evidence.note).toContain('bytes');
  });
});
