import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountDispatches,
  assertSingleProviderAttempt,
  countModelAttempts,
  parseMediaTrace,
  readMediaTrace,
  shouldStopAfterVisionOnly,
} from '../../scripts/lib/media-trace.js';

describe('media trace reader (P2)', () => {
  it('parses attempt lines and ignores unrelated lines', () => {
    const entries = parseMediaTrace(
      [
        'noise',
        '[media-trace] attempt=1 path=/v1/responses model=muse-spark-1.3',
        '[media-trace] outcome=response attempt=1 status=200 bytes=42',
        '[media-trace] attempt=2 path=/v1/responses model=muse-spark-1.3',
        '[media-trace] outcome=error attempt=2 error=provider_unavailable',
        '[media-trace] attempt=1 path=/v1/responses model=sam-3.1',
      ].join('\n'),
    );
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ attempt: 1, model: 'muse-spark-1.3' });
    expect(entries[1]).toMatchObject({ attempt: 1, outcome: 'response', status: 200 });
    expect(entries[3]).toMatchObject({ attempt: 2, outcome: 'error' });
    expect(countModelAttempts(entries, 'muse-spark')).toBe(2);
    expect(countModelAttempts(entries, 'sam-3.1')).toBe(1);
  });

  it('reads a real file and treats a missing file as an empty trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-trace-'));
    const path = join(dir, 'server.log');
    writeFileSync(path, '[media-trace] attempt=1 path=/v1/responses model=muse-spark-1.3\n');
    expect(readMediaTrace(path)).toHaveLength(1);
    expect(readMediaTrace(join(dir, 'missing.log'))).toEqual([]);
  });

  it('counts distinct attempts, not duplicate log lines', () => {
    const entries = parseMediaTrace(
      [
        '[media-trace] attempt=1 model=muse-spark-1.3',
        '[media-trace] outcome=response attempt=1 status=200',
        '[media-trace] attempt=1 model=muse-spark-1.3',
      ].join('\n'),
    );
    expect(countModelAttempts(entries, 'muse-spark')).toBe(1);
  });

  it('single-provider-attempt success requires response and trace to agree', () => {
    expect(() =>
      assertSingleProviderAttempt({
        capability: 'vision',
        responseAttempts: 1,
        traceAttempts: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertSingleProviderAttempt({
        capability: 'vision',
        responseAttempts: undefined,
        traceAttempts: 1,
      }),
    ).toThrow(/response provider_attempts=undefined/);
    expect(() =>
      assertSingleProviderAttempt({
        capability: 'vision',
        responseAttempts: 1,
        traceAttempts: 2,
      }),
    ).toThrow(/trace provider attempts=2/);
  });

  it('vision-only success path accepts one response + one trace and stops before SAM', () => {
    const entries = parseMediaTrace(
      '[media-trace] attempt=1 path=/v1/responses model=muse-spark-1.3\n',
    );
    const traceAttempts = countModelAttempts(entries, 'muse-spark');
    expect(() =>
      assertSingleProviderAttempt({
        capability: 'vision',
        responseAttempts: 1,
        traceAttempts,
      }),
    ).not.toThrow();
    expect(shouldStopAfterVisionOnly(true, { sam: 0, coding: 0 })).toBe(true);
  });

  it('vision-only success stops only when SAM/coding are untouched', () => {
    expect(shouldStopAfterVisionOnly(true, { sam: 0, coding: 0 })).toBe(true);
    expect(shouldStopAfterVisionOnly(false, { sam: 0, coding: 0 })).toBe(false);
    expect(() => shouldStopAfterVisionOnly(true, { sam: 1, coding: 0 })).toThrow(/extra/);
    expect(() => shouldStopAfterVisionOnly(true, { sam: 0, coding: 1 })).toThrow(/extra/);
  });
});

describe('dispatch accounting (live call budget)', () => {
  // The exact two lines a permitted live transcription wrote on 2 Nov
  // (test-results/batchd-live/2026-11-02-0349/server.log, no credential in them).
  const ONE_CALL = parseMediaTrace(
    [
      '[media-trace] attempt=1 path=/v1/asr/transcribe model=(none)',
      '[media-trace] outcome=response attempt=1 status=200 bytes=342',
    ].join('\n'),
  );

  it('counts one call, not two log lines', () => {
    const accounted = accountDispatches(ONE_CALL);
    expect(accounted.dispatches).toHaveLength(1);
    expect(accounted.paths).toEqual(['/v1/asr/transcribe']);
    expect(accounted.maxAttempt).toBe(1);
  });

  it('never invents a path out of an outcome line', () => {
    // Counting lines made the outcome line a dispatch on `(unattributed)`, and a
    // run that paid for exactly one allowed call failed its own path check.
    const paths = accountDispatches(ONE_CALL).paths;
    expect(paths).not.toContain('(unattributed)');
    expect(paths.filter((path) => path !== '/v1/asr/transcribe')).toEqual([]);
  });

  it('keeps the provider status as evidence for the dispatch it answers', () => {
    const [dispatch] = accountDispatches(ONE_CALL).dispatches;
    expect(dispatch?.outcome).toBe('response');
    expect(dispatch?.status).toBe(200);
    expect(accountDispatches(ONE_CALL).unanswered).toEqual([]);
  });

  it('a retry is still one path with two attempts', () => {
    const accounted = accountDispatches(
      parseMediaTrace(
        [
          '[media-trace] attempt=1 path=/v1/responses model=x',
          '[media-trace] outcome=error attempt=1 error=timeout',
          '[media-trace] attempt=2 path=/v1/responses model=x',
          '[media-trace] outcome=response attempt=2 status=200 bytes=9',
        ].join('\n'),
      ),
    );
    expect(accounted.dispatches).toHaveLength(2);
    expect(accounted.paths).toEqual(['/v1/responses']);
    expect(accounted.maxAttempt).toBe(2);
  });

  it('an outcome nobody started, and a start nobody answered, are both reported', () => {
    const stray = accountDispatches(
      parseMediaTrace('[media-trace] outcome=response attempt=7 status=200 bytes=1'),
    );
    expect(stray.dispatches).toEqual([]);
    expect(stray.unpairedOutcomes).toHaveLength(1);

    const died = accountDispatches(
      parseMediaTrace('[media-trace] attempt=1 path=/v1/files model=(none)'),
    );
    expect(died.dispatches).toHaveLength(1);
    expect(died.unanswered).toHaveLength(1);
  });

  it('pairs each outcome to its own attempt when two calls share a path', () => {
    const accounted = accountDispatches(
      parseMediaTrace(
        [
          '[media-trace] attempt=1 path=/v1/files model=(none)',
          '[media-trace] attempt=1 path=/v1/responses model=video',
          '[media-trace] outcome=response attempt=1 status=200 bytes=10',
          '[media-trace] outcome=response attempt=1 status=201 bytes=990',
        ].join('\n'),
      ),
    );
    expect(accounted.dispatches.map((entry) => entry.status)).toEqual([200, 201]);
    expect(accounted.unpairedOutcomes).toEqual([]);
  });
});
