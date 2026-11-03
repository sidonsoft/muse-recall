import { describe, expect, it } from 'vitest';
import {
  assetProvenance,
  journeyLedgerIssues,
  parseAssetSource,
} from '../../scripts/lib/media-journey.js';
import { accountDispatches, parseMediaTrace } from '../../scripts/lib/media-trace.js';

/**
 * The media journey gate runs on two rails: paid image calls, or uploaded bytes with no
 * provider at all. The ledger has to say which one happened, and an unknown mode name must
 * not quietly become the expensive one.
 */

/** Trace lines in the exact shape the adapter writes. Lines without the prefix are ignored. */
function trace(lines: readonly string[]): string {
  return lines.map((line) => `[media-trace] ${line}`).join('\n');
}

const GENERATE_START = 'attempt=1 path=/v1/images/generations model=muse-image-1.0';
const GENERATE_OUTCOME = 'outcome=response attempt=1 status=200 bytes=171670';
const EDIT_START = 'attempt=1 path=/v1/images/edits model=muse-image-1.0';
const EDIT_OUTCOME = 'outcome=response attempt=1 status=200 bytes=169024';

function ledger(lines: readonly string[]) {
  return accountDispatches(parseMediaTrace(trace(lines)));
}

describe('media journey asset-source parsing', () => {
  it('defaults to the live rail when the mode is not named', () => {
    const parsed = parseAssetSource(undefined);
    expect(parsed.issues).toEqual([]);
    expect(parsed.source).toBe('live');
    expect(parsed.source_of_truth).toBe('default');
  });

  it('refuses a mode name it does not know, instead of paying for the expensive one', () => {
    const parsed = parseAssetSource('clip');
    expect(parsed.source).toBe('live');
    expect(parsed.requested).toBe('clip');
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toContain('MEDIA_JOURNEY_ASSET_SOURCE="clip"');
    expect(parsed.issues[0]).toContain('not one of live | upload');
  });

  it('accepts both real modes', () => {
    expect(parseAssetSource('upload').source).toBe('upload');
    expect(parseAssetSource('live').source).toBe('live');
    expect(parseAssetSource('  upload  ').source).toBe('upload');
  });
});

describe('media journey ledger policy', () => {
  it('accepts a live ledger of one generate and one edit', () => {
    const issues = journeyLedgerIssues(
      ledger([GENERATE_START, GENERATE_OUTCOME, EDIT_START, EDIT_OUTCOME]),
      'live',
    );
    expect(issues).toEqual([]);
  });

  it('refuses a live ledger that says nothing was dispatched', () => {
    const issues = journeyLedgerIssues(ledger([]), 'live');
    expect(issues.some((issue) => issue.includes('expected exactly 1 dispatch on'))).toBe(true);
  });

  it('refuses a doubled generate even though the totals look reachable', () => {
    const issues = journeyLedgerIssues(
      ledger([
        GENERATE_START,
        GENERATE_OUTCOME,
        GENERATE_START,
        GENERATE_OUTCOME,
        EDIT_START,
        EDIT_OUTCOME,
      ]),
      'live',
    );
    expect(
      issues.some(
        (issue) =>
          issue.includes('expected exactly 1 dispatch on /v1/images/generations') &&
          issue.includes('saw 2'),
      ),
    ).toBe(true);
  });

  it('refuses a paid path the journey never budgets for', () => {
    const issues = journeyLedgerIssues(
      ledger([
        GENERATE_START,
        GENERATE_OUTCOME,
        EDIT_START,
        EDIT_OUTCOME,
        'attempt=1 path=/v1/files model=(none)',
        'outcome=response attempt=1 status=200 bytes=12',
      ]),
      'live',
    );
    expect(issues).toContain('/v1/files');
  });

  it('refuses an unanswered dispatch: the paid-call count is unknown', () => {
    const issues = journeyLedgerIssues(ledger([GENERATE_START, EDIT_START, EDIT_OUTCOME]), 'live');
    expect(issues.some((issue) => issue.includes('started and were never answered'))).toBe(true);
  });

  it('refuses a transport retry', () => {
    const issues = journeyLedgerIssues(
      ledger([
        GENERATE_START,
        GENERATE_OUTCOME,
        'attempt=2 path=/v1/images/generations model=muse-image-1.0',
        'outcome=response attempt=2 status=200 bytes=171670',
        EDIT_START,
        EDIT_OUTCOME,
      ]),
      'live',
    );
    expect(issues.some((issue) => issue.includes('attempt beyond 1'))).toBe(true);
  });

  it('requires an offline ledger to be empty, and says so when it is not', () => {
    expect(journeyLedgerIssues(ledger([]), 'upload')).toEqual([]);
    const issues = journeyLedgerIssues(ledger([GENERATE_START, GENERATE_OUTCOME]), 'upload');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('offline (uploaded-asset) journey dispatched 1 provider call(s)');
    expect(issues[0]).toContain('/v1/images/generations (attempt 1)');
  });

  it('does not accept an offline run whose only trace lines were prose', () => {
    // Lines without the [media-trace] prefix are not a ledger, but they must not be
    // mistaken for one either: the account stays empty, and the empty account is what
    // the offline claim rests on.
    const entries = parseMediaTrace('provider calls: 2\n/v1/images/generations returned 200');
    expect(accountDispatches(entries).dispatches).toEqual([]);
  });
});

describe('media journey asset provenance labels', () => {
  it('labels an uploaded asset as proof of the flow, not of provider bytes', () => {
    const labeled = assetProvenance('upload');
    expect(labeled.asset_source).toBe('upload');
    expect(labeled.asset_provenance).toContain('not that provider bytes flow through it');
  });

  it('labels a live asset as paid provider bytes', () => {
    const labeled = assetProvenance('live');
    expect(labeled.asset_provenance).toContain('paid generate + edit');
  });
});

describe('the offline journey cannot call a damaged ledger "zero dispatches"', () => {
  it('reports ledger damage in upload mode even when no dispatch is counted', () => {
    /*
     * The offline gate's headline claim is "the journey dispatched nothing". An
     * earlier version of the check returned as soon as the upload branch saw an
     * empty list, so a ledger that could not be read at all satisfied it: the
     * claim was then about a log the gate could not parse, not about a run.
     */
    const orphanOutcome = ledger(['outcome=response attempt=1 status=200 bytes=171670']);
    expect(orphanOutcome.dispatches).toEqual([]);
    const orphanIssues = journeyLedgerIssues(orphanOutcome, 'upload');
    expect(orphanIssues.join(' ')).toContain('answer no dispatch');

    const truncated = ledger(['attempt=']);
    expect(truncated.dispatches).toEqual([]);
    expect(truncated.malformedLines.length).toBeGreaterThan(0);
    expect(journeyLedgerIssues(truncated, 'upload').join(' ')).toContain('could not be parsed');

    // A legible empty ledger still passes: the claim is honest when the log is
    // readable and truly records nothing.
    expect(journeyLedgerIssues(ledger([]), 'upload')).toEqual([]);
  });

  it('still refuses a live rail that paid the wrong number of calls', () => {
    const issues = journeyLedgerIssues(ledger([GENERATE_START, GENERATE_OUTCOME]), 'live');
    expect(issues.join(' ')).toContain('/v1/images/edits');
  });
});
