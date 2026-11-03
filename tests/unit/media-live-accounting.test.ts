import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CodingJobAccount,
  codingJobIssues,
  MEDIA_LIVE_ALLOWED_PATHS,
  mediaLiveLedgerIssues,
  readCodingJobs,
  totalCodingCalls,
} from '../../scripts/lib/media-live.js';
import { accountDispatches, parseMediaTrace } from '../../scripts/lib/media-trace.js';

/**
 * The media chain smoke pays on two rails and must account for both (KI-55). These
 * tests use verbatim `[media-trace]` line shapes, because a synthetic line the parser
 * ignores proves nothing about the assertion (KI-55 item 16).
 */
function ledger(text: string) {
  return accountDispatches(parseMediaTrace(text));
}

const GENERATION_LINES = [
  '[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0',
  '[media-trace] outcome=response attempt=1 status=200 bytes=160102',
].join('\n');

const EDIT_LINES = [
  '[media-trace] attempt=1 path=/v1/images/edits model=muse-image-1.0',
  '[media-trace] outcome=response attempt=1 status=200 bytes=159887',
].join('\n');

describe('media chain ledger policy', () => {
  it('accepts the ledger the real run produces: one generation, one edit, no retry', () => {
    const issues = mediaLiveLedgerIssues(ledger(`${GENERATION_LINES}\n${EDIT_LINES}`));
    expect(issues).toEqual([]);
  });

  it('fails a second generation instead of reading two paid calls as one step', () => {
    const doubled = [
      '[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0',
      '[media-trace] outcome=response attempt=1 status=200 bytes=160102',
      '[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0',
      '[media-trace] outcome=response attempt=1 status=200 bytes=157221',
      EDIT_LINES,
    ].join('\n');
    const issues = mediaLiveLedgerIssues(ledger(doubled));
    expect(issues).toContain('expected 1 dispatch(es) on /v1/images/generations, saw 2');
  });

  it('treats a path nobody thought to forbid as out of scope', () => {
    // The old gates listed the paths they meant to deny, so a new paid path slipped
    // through. The inverse allowlist catches it.
    const withUpload = [
      GENERATION_LINES,
      '[media-trace] attempt=1 path=/v1/files model=muse-image-1.0',
      '[media-trace] outcome=response attempt=1 status=200 bytes=64',
      EDIT_LINES,
    ].join('\n');
    const issues = mediaLiveLedgerIssues(ledger(withUpload));
    expect(issues.some((issue) => issue.includes('outside the image scope: /v1/files'))).toBe(true);
  });

  it('refuses a ledger whose paid-call count is unknown', () => {
    const started = [
      '[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0',
      EDIT_LINES,
    ].join('\n');
    const issues = mediaLiveLedgerIssues(ledger(started));
    expect(
      issues.some((issue) => issue.includes('1 dispatch(es) started and were never answered')),
    ).toBe(true);
  });

  it('refuses an outcome line that answers no dispatch this run started', () => {
    const orphan = [
      GENERATION_LINES,
      EDIT_LINES,
      '[media-trace] outcome=response attempt=7 status=200 bytes=12',
    ].join('\n');
    const issues = mediaLiveLedgerIssues(ledger(orphan));
    expect(issues.some((issue) => issue.includes('outcome line(s) answer no dispatch'))).toBe(true);
  });

  it('names a transport retry instead of letting it pass as one call', () => {
    const retried = [
      '[media-trace] attempt=1 path=/v1/images/generations model=muse-image-1.0',
      '[media-trace] outcome=error attempt=1 error=timeout',
      '[media-trace] attempt=2 path=/v1/images/generations model=muse-image-1.0',
      '[media-trace] outcome=response attempt=2 status=200 bytes=160102',
      EDIT_LINES,
    ].join('\n');
    const issues = mediaLiveLedgerIssues(ledger(retried));
    expect(issues.some((issue) => issue.includes('attempt beyond 1'))).toBe(true);
  });

  it('supports a zero-call claim when the boot-only budget says zero', () => {
    const issues = mediaLiveLedgerIssues(ledger('server started, no dispatches'), {
      generate: 0,
      edit: 0,
    });
    expect(issues).toEqual([]);
  });

  it('keeps the allowlist the single source of scope', () => {
    expect(MEDIA_LIVE_ALLOWED_PATHS).toEqual(['/v1/images/generations', '/v1/images/edits']);
  });
});

function job(overrides: Partial<CodingJobAccount>): CodingJobAccount {
  return {
    job_id: 'a1b2c3d4-0000-0000-0000-000000000001',
    kind: 'generate',
    status: 'succeeded',
    usage_calls: 6,
    version: 1,
    base_version: null,
    model_observed: 'muse-wonder-1.0',
    ...overrides,
  };
}

describe('media chain coding account', () => {
  const kinds = ['generate', 'modify', 'modify'];

  it('accepts three succeeded jobs that each report their calls and model', () => {
    const jobs = [
      job({}),
      job({ job_id: 'b'.repeat(36), kind: 'modify', version: 2, base_version: 1 }),
      job({ job_id: 'c'.repeat(36), kind: 'modify', version: 3, base_version: 2 }),
    ];
    expect(
      codingJobIssues(jobs, {
        expectedKinds: kinds,
        maxCallsPerJob: 15,
        configuredModel: 'muse-wonder-1.0',
      }),
    ).toEqual([]);
    expect(totalCodingCalls(jobs)).toEqual({ known: 18, unknownJobs: 0 });
  });

  it('refuses a job that ran over the call cap this run configured', () => {
    const issues = codingJobIssues(
      [
        job({ usage_calls: 16 }),
        job({ job_id: 'b'.repeat(36), kind: 'modify' }),
        job({ job_id: 'c'.repeat(36), kind: 'modify' }),
      ],
      { expectedKinds: kinds, maxCallsPerJob: 15 },
    );
    expect(issues.some((issue) => issue.includes('used 16 calls, above the 15-call cap'))).toBe(
      true,
    );
  });

  it('refuses a succeeded job that names no model', () => {
    const issues = codingJobIssues(
      [
        job({ model_observed: null }),
        job({ job_id: 'b'.repeat(36), kind: 'modify' }),
        job({ job_id: 'c'.repeat(36), kind: 'modify' }),
      ],
      { expectedKinds: kinds, maxCallsPerJob: 15 },
    );
    expect(issues.some((issue) => issue.includes('succeeded but names no model'))).toBe(true);
  });

  it('refuses a job that ran a different model than the server reported configuring', () => {
    const issues = codingJobIssues(
      [
        job({ model_observed: 'some-other-model' }),
        job({ job_id: 'b'.repeat(36), kind: 'modify' }),
        job({ job_id: 'c'.repeat(36), kind: 'modify' }),
      ],
      {
        expectedKinds: kinds,
        maxCallsPerJob: 15,
        configuredModel: 'muse-wonder-1.0',
      },
    );
    expect(
      issues.some((issue) => issue.includes('while /api/meta reports the configured coding model')),
    ).toBe(true);
  });

  it('counts a missing expected job kind rather than calling two jobs three', () => {
    const issues = codingJobIssues([job({}), job({ job_id: 'b'.repeat(36), kind: 'modify' })], {
      expectedKinds: kinds,
      maxCallsPerJob: 15,
    });
    expect(issues).toContain('expected 3 coding job(s), found 2');
  });

  it('treats an unreadable job record as unknown cost, never as free', () => {
    const issues = codingJobIssues(
      [
        job({ usage_calls: null }),
        job({ job_id: 'b'.repeat(36), kind: 'modify' }),
        job({ job_id: 'c'.repeat(36), kind: 'modify' }),
      ],
      { expectedKinds: kinds, maxCallsPerJob: 15 },
    );
    expect(issues.some((issue) => issue.includes('reports no usable usage.calls'))).toBe(true);
    expect(totalCodingCalls([job({ usage_calls: null })])).toEqual({
      known: 0,
      unknownJobs: 1,
    });
  });

  it('refuses a second job of one kind where a different kind was expected', () => {
    // Presence checks alone accepted two generations plus one modification for a run
    // that was supposed to pay for one generation and two modifications: an extra
    // generation is an extra paid job either way.
    const issues = codingJobIssues(
      [
        job({}),
        job({ job_id: 'b'.repeat(36), kind: 'generate' }),
        job({ job_id: 'c'.repeat(36), kind: 'modify' }),
      ],
      { expectedKinds: kinds, maxCallsPerJob: 15 },
    );
    expect(issues.join(' ')).toContain(
      'expected (generate, modify, modify) are not the kinds recorded (generate, generate, modify)',
    );
  });

  it('treats an impossible usage.calls and a non-object job file as unknown, never as a number', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-live-jobs-bad-'));
    const jobsDir = join(dir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    writeFileSync(
      join(jobsDir, 'negative.json'),
      JSON.stringify({
        id: 'negative',
        kind: 'generate',
        status: 'succeeded',
        version: 1,
        usage: { calls: -2 },
        model_observed: 'muse-wonder-1.0',
      }),
    );
    writeFileSync(
      join(jobsDir, 'fractional.json'),
      JSON.stringify({ id: 'fractional', usage: { calls: 1.5 } }),
    );
    writeFileSync(join(jobsDir, 'null.json'), 'null');
    const jobs = readCodingJobs(dir);
    const negative = jobs.find((entry) => entry.job_id === 'negative');
    const nullRecord = jobs.find((entry) => entry.job_id === 'null');
    expect(negative?.usage_calls).toBeNull();
    expect(negative?.record_invalid).toContain(
      'usage.calls holds -2, which is not a non-negative integer',
    );
    expect(nullRecord?.status).toBe('unreadable');
    expect(nullRecord?.record_invalid).toContain('the job file holds null, not a job object');
    const issues = codingJobIssues(jobs, { expectedKinds: kinds, maxCallsPerJob: 15 });
    expect(issues.join(' ')).toContain('not a non-negative integer');
    expect(issues.join(' ')).toContain('the job file holds null');
    expect(totalCodingCalls(jobs)).toEqual({ known: 0, unknownJobs: 3 });
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds no jobs for a project directory that does not exist', () => {
    expect(readCodingJobs('/definitely/not/a/project')).toEqual([]);
  });

  it('reads the job records the product writes, and flags a record it cannot parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-live-jobs-'));
    const jobsDir = join(dir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    writeFileSync(
      join(jobsDir, 'one.json'),
      JSON.stringify({
        id: 'one',
        kind: 'generate',
        status: 'succeeded',
        version: 1,
        usage: { calls: 7 },
        model_observed: 'muse-wonder-1.0',
      }),
    );
    writeFileSync(join(jobsDir, 'broken.json'), '{ not json');
    const jobs = readCodingJobs(dir);
    expect(jobs.map((entry) => entry.job_id)).toEqual(['broken', 'one']);
    const one = jobs.find((entry) => entry.job_id === 'one');
    expect(one).toMatchObject({
      kind: 'generate',
      status: 'succeeded',
      usage_calls: 7,
      version: 1,
      model_observed: 'muse-wonder-1.0',
    });
    const broken = jobs.find((entry) => entry.job_id === 'broken');
    expect(broken?.status).toBe('unreadable');
    expect(
      codingJobIssues(jobs, {
        expectedKinds: ['generate', 'modify'],
        maxCallsPerJob: 15,
      }),
    ).toEqual([
      'the coding jobs this run expected (generate, modify) are not the kinds recorded (generate, unreadable)',
      'no coding job of kind modify was recorded',
      'job broken (unreadable) ended unreadable',
      'job broken (unreadable) reports no usable usage.calls',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});
