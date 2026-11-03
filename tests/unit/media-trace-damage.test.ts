import { describe, expect, it } from 'vitest';
import { mediaLiveLedgerIssues } from '../../scripts/lib/media-live.js';
import {
  accountDispatches,
  ledgerIntegrityIssues,
  parseMediaTrace,
} from '../../scripts/lib/media-trace.js';

/** One answered paid call, in the shape the adapter actually writes. */
const ONE_ANSWERED_CALL = [
  'attempt=1 path=/v1/images/generations model=muse-image-1.0',
  'outcome=response attempt=1 status=200 bytes=35834',
];

const traced = (lines: readonly string[]): string =>
  lines.map((line) => `[media-trace] ${line}`).join('\n');

const account = (lines: readonly string[]) => accountDispatches(parseMediaTrace(traced(lines)));

describe('damaged lines inside the trace marker', () => {
  it('keeps a tagged line it cannot read, instead of treating it as absent', () => {
    const entries = parseMediaTrace(traced(['garbage']));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.malformed).toContain('garbage');
  });

  it('reports a probe of one call plus two unreadable lines as damage, not as a clean ledger', () => {
    // The exact probe the delta review ran: the parse shapes match, the counts add
    // up, and everything that cannot be matched simply vanished — so the ledger
    // read "no issues" while the audit trail itself was corrupt.
    const ledger = account([...ONE_ANSWERED_CALL, 'garbage', 'attempt=1 path=']);
    expect(ledger.dispatches).toHaveLength(1);
    expect(ledger.malformedLines.length).toBeGreaterThan(0);
    const issues = ledgerIntegrityIssues(ledger, 'image');
    expect(issues.join(' ')).toContain('could not be parsed');
    expect(issues.join(' ')).toContain('no call count read from it can be trusted');
  });

  it('treats an attempt-only line as damage rather than as a line that says nothing', () => {
    // A write truncated mid-line carries an attempt number and nothing that can be
    // paired: dropping it makes a half-recorded call invisible.
    const ledger = account([...ONE_ANSWERED_CALL, 'attempt=2']);
    expect(ledger.malformedLines).toEqual(
      expect.arrayContaining([expect.stringContaining('attempt=2')]),
    );
    expect(ledger.dispatches).toHaveLength(1);
  });

  it('does not turn ordinary server output into ledger damage', () => {
    // The marker is what makes a line part of the ledger. Unrelated log output —
    // including output that mentions numbers or the word attempt — stays out.
    const body = [
      'muse-forge api listening on 127.0.0.1:8787',
      'attempted to load asset: none',
      traced(ONE_ANSWERED_CALL),
    ].join('\n');
    const ledger = accountDispatches(parseMediaTrace(body));
    expect(ledger.malformedLines).toEqual([]);
    expect(ledgerIntegrityIssues(ledger, 'image')).toEqual([]);
    expect(ledger.dispatches).toHaveLength(1);
  });

  it('still pairs a start with its outcome when damage sits between them', () => {
    // Damage is reported, but it must not be double-counted as a missing answer:
    // that would turn one corrupt line into two unrelated claims.
    const ledger = account([
      ONE_ANSWERED_CALL[0] as string,
      'garbage',
      ONE_ANSWERED_CALL[1] as string,
    ]);
    expect(ledger.dispatches).toHaveLength(1);
    expect(ledger.unanswered).toEqual([]);
    expect(ledger.unpairedOutcomes).toEqual([]);
    expect(ledger.dispatches[0]?.status).toBe(200);
    expect(ledger.malformedLines).toHaveLength(1);
  });
});

describe('the live chain gate reads a damaged ledger as a failure', () => {
  it('refuses its own budget when the counts match but the ledger is corrupt', () => {
    const issues = mediaLiveLedgerIssues(
      // An answer whose shape is broken: the attempt is there, the fields are not,
      // so nothing can be paired from it. The old reader discarded it.
      account([...ONE_ANSWERED_CALL, 'outcome= attempt=1 status=200']),
      // A budget the ledger *satisfies*, so the only thing wrong is the damage.
      { generate: 1, edit: 0 },
    );
    expect(issues.join(' ')).toContain('could not be parsed');
    // The counts still read correctly, which is what made the old behaviour so
    // easy to miss: everything except the damage report looked fine.
    expect(issues.join(' ')).not.toContain('expected 1 dispatch(es)');
  });

  it('reads a zero-dispatch boot-only ledger as clean, and a damaged one as damaged', () => {
    expect(mediaLiveLedgerIssues(account([]), { generate: 0, edit: 0 })).toEqual([]);
    const issues = mediaLiveLedgerIssues(account(['garbage']), { generate: 0, edit: 0 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('could not be parsed');
  });

  it('refuses to read a field that is only partly a field', () => {
    /*
     * A prefix match used to accept these: `attempt=1broken` counted as attempt 1,
     * and `status=200garbage` completed an answered paid dispatch. A ledger that
     * parses parts of a token cannot support an exact call count, so every field
     * is validated whole.
     */
    for (const line of [
      'attempt=1broken path=/v1/images/generations model=muse-image-1.0',
      'attempt=1 path=/v1/images/generations model=muse-image-1.0 status=200garbage',
      'attempt=1 path=/v1/images/generations model=muse-image-1.0 outcome=nonsense',
      'attempt=1 path=/v1/images/generations model=muse-image-1.0 unknown=field',
      'attempt=1 attempt=2 path=/v1/images/generations model=muse-image-1.0',
      'attempt=1 path=v1/images/generations model=muse-image-1.0',
      'outcome=response attempt=1 status=200',
      'outcome=error attempt=1',
    ]) {
      const entries = parseMediaTrace(traced([line]));
      expect(entries, line).toHaveLength(1);
      expect(entries[0]?.malformed, line).toContain(line);
    }
  });

  it('still reads the lines the adapter really writes, bare and inside a JSON log', () => {
    const bare = parseMediaTrace(
      traced([...ONE_ANSWERED_CALL, 'outcome=error attempt=2 error=fetch failed: socket hang up']),
    );
    expect(bare.every((entry) => entry.malformed === undefined)).toBe(true);
    expect(bare[2]?.outcome).toBe('error');

    const wrapped = parseMediaTrace(
      '{"level":30,"time":"2026-11-03T09:00:00.000Z","msg":"[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0"}',
    );
    expect(wrapped[0]?.malformed).toBeUndefined();
    expect(wrapped[0]?.path).toBe('/v1/images/generations');
    expect(wrapped[0]?.model).toBe('muse-image-1.0');
  });

  it('does not turn an answered pair into damage for carrying stream event counts', () => {
    const entries = parseMediaTrace(
      traced([
        'attempt=1 path=/v1/responses model=muse-spark-1.3',
        'outcome=response attempt=1 status=200 bytes=512 events=41',
      ]),
    );
    expect(entries.every((entry) => entry.malformed === undefined)).toBe(true);
  });
});
