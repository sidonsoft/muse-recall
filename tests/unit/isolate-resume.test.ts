/**
 * Offline isolate-validation tests: tmp fixtures mirroring the preserved
 * store layout. No servers, browsers, or provider calls.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type IsolateExpectations, verifyStagedIsolate } from '../../scripts/lib/isolate-resume.js';

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function makeIsolate(
  overrides: {
    job?: Record<string, unknown>;
    cutoutBytes?: Buffer;
    staged?: Buffer;
    refBytes?: Buffer;
  } = {},
): { root: string; project: string; job: string; expected: IsolateExpectations } {
  const root = mkdtempSync(join(tmpdir(), 'isolate-resume-'));
  const project = 'proj-1';
  const job = 'job-1';
  const projectDir = join(root, 'workspaces', 'forge', project);
  mkdirSync(join(projectDir, 'versions', '1'), { recursive: true });
  mkdirSync(join(projectDir, 'jobs'), { recursive: true });
  mkdirSync(join(projectDir, 'media', 'cutout-asset'), { recursive: true });
  mkdirSync(join(projectDir, 'media', 'ref-asset'), { recursive: true });
  mkdirSync(join(projectDir, 'staging', job), { recursive: true });
  const v1 = Buffer.from('v1-bytes');
  writeFileSync(join(projectDir, 'versions', '1', 'index.html'), v1);
  writeFileSync(
    join(projectDir, 'state.json'),
    JSON.stringify({ current_version: 1, versions: [{ version: 1, sha256: sha(v1) }] }),
  );
  const jobRecord = overrides.job ?? {
    id: job,
    status: 'succeeded',
    finished_at: '2026-11-01T07:55:50.982Z',
    model_observed: 'muse-wonder-1.0',
    usage: { calls: 6 },
    logs: ['done'],
  };
  writeFileSync(join(projectDir, 'jobs', `${job}.json`), JSON.stringify(jobRecord));
  // Expectations always describe the pristine store; overrides tamper
  // the files afterwards so mismatches are actually exercised.
  const cutout = Buffer.from('cutcontent');
  writeFileSync(
    join(projectDir, 'media', 'cutout-asset', '1.bin'),
    overrides.cutoutBytes ?? cutout,
  );
  const ref = Buffer.from('refcontent');
  writeFileSync(join(projectDir, 'media', 'ref-asset', '1.bin'), overrides.refBytes ?? ref);
  const staged = Buffer.from('staged-html');
  writeFileSync(join(projectDir, 'staging', job, 'index.html'), overrides.staged ?? staged);
  writeFileSync(join(root, 'memory.db'), Buffer.from('sqlite-stub'));
  return {
    root,
    project,
    job,
    expected: {
      baselineSha256: sha(v1),
      stagedSha256: sha(staged),
      cutoutSha256: sha(cutout),
      cutoutBytes: cutout.length,
      referenceSha256: sha(ref),
      jobStatus: 'succeeded',
    },
  };
}

describe('verifyStagedIsolate', () => {
  it('accepts a well-formed isolate and returns job evidence', () => {
    const { root, project, job, expected } = makeIsolate();
    try {
      const verified = verifyStagedIsolate(root, project, job, expected);
      expect(verified.job.status).toBe('succeeded');
      expect(verified.job.usageCalls).toBe(6);
      expect(verified.job.modelObserved).toBe('muse-wonder-1.0');
      expect(verified.stagedSha256).toBe(expected.stagedSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing isolate directory', () => {
    const { root, expected } = makeIsolate();
    try {
      expect(() =>
        verifyStagedIsolate(join(tmpdir(), 'no-such-isolate'), 'p', 'j', expected),
      ).toThrow(/isolate directory is missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a job that did not succeed', () => {
    const built = makeIsolate({ job: { status: 'failed' } as never });
    try {
      expect(() =>
        verifyStagedIsolate(built.root, built.project, built.job, built.expected),
      ).toThrow(/job status/);
    } finally {
      rmSync(built.root, { recursive: true, force: true });
    }
  });

  it('rejects fallback markers in job logs', () => {
    const built = makeIsolate({
      job: { status: 'succeeded', finished_at: 't', logs: ['quota FALLBACK used'] } as never,
    });
    try {
      expect(() =>
        verifyStagedIsolate(built.root, built.project, built.job, built.expected),
      ).toThrow(/fallback/);
    } finally {
      rmSync(built.root, { recursive: true, force: true });
    }
  });

  it('rejects staged and cutout mismatches', () => {
    const staged = makeIsolate({ staged: Buffer.from('different') });
    try {
      expect(() =>
        verifyStagedIsolate(staged.root, staged.project, staged.job, staged.expected),
      ).toThrow(/staged sha/);
    } finally {
      rmSync(staged.root, { recursive: true, force: true });
    }
    const cut = makeIsolate({ cutoutBytes: Buffer.from('different') });
    try {
      expect(() => verifyStagedIsolate(cut.root, cut.project, cut.job, cut.expected)).toThrow(
        /cutout bytes matching/,
      );
    } finally {
      rmSync(cut.root, { recursive: true, force: true });
    }
  });
});
