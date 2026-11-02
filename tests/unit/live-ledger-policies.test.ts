import { describe, expect, it } from 'vitest';
import {
  batchdLedgerIssues,
  expectedBatchdCalls,
  liveScopeAllowedPaths,
} from '../../scripts/lib/batchd-live.js';
import { imageLedgerIssues } from '../../scripts/lib/image-live.js';
import {
  accountDispatches,
  ledgerIntegrityIssues,
  parseMediaTrace,
  pathsOutside,
} from '../../scripts/lib/media-trace.js';
import { reviewLedgerIssues } from '../../scripts/lib/review-live.js';

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
