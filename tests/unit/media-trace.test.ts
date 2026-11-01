import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
