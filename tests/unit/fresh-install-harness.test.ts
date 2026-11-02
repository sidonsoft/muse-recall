import { describe, expect, it } from 'vitest';
import {
  cloneStateIssues,
  environmentManifest,
  installSummary,
  liveCredentialProblems,
  provenanceIssues,
  stepRecord,
} from '../../scripts/lib/fresh-install.js';

const MANIFEST = {
  kind: 'server',
  commit: 'a'.repeat(40),
  treeClean: true,
  sourceHash: 'b'.repeat(64),
  buildHash: 'c'.repeat(64),
};

describe('fresh-install rehearsal harness', () => {
  it('records a step by what it actually returned', () => {
    const ok = stepRecord({
      name: 'pnpm install',
      argv: ['pnpm', 'install', '--frozen-lockfile'],
      cwd: '/clone',
      exitCode: 0,
      durationMs: 4200,
      output: 'one\ntwo\n',
      logFile: '/e/console/install.log',
    });
    expect(ok.ok).toBe(true);
    expect(ok.exitCode).toBe(0);
    expect(ok.command).toBe('pnpm install --frozen-lockfile');

    const refused = stepRecord({
      name: 'live smoke refuses',
      argv: ['pnpm', 'exec', 'tsx', 'scripts/verify-batchc-live-smoke.ts'],
      cwd: '/clone',
      exitCode: 2,
      durationMs: 100,
      output: 'unconfigured',
      logFile: '/e/console/live.log',
      expectExit: 2,
    });
    expect(refused.ok).toBe(true);

    const never = stepRecord({
      name: 'missing tool',
      argv: ['nope'],
      cwd: '/clone',
      exitCode: null,
      durationMs: 5,
      output: '',
      logFile: '/e/console/missing.log',
    });
    expect(never.ok).toBe(false);

    const timedOut = stepRecord({
      name: 'slow gate',
      argv: ['pnpm', 'verify:studio-workflow'],
      cwd: '/clone',
      exitCode: null,
      durationMs: 900_000,
      output: '',
      timedOut: true,
      logFile: '/e/console/slow.log',
    });
    expect(timedOut.ok).toBe(false);
  });

  it('keeps only a bounded, redacted tail of a failing step', () => {
    const noisy = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const record = stepRecord({
      name: 'noisy',
      argv: ['pnpm', 'run', 'verify'],
      cwd: '/clone',
      exitCode: 1,
      durationMs: 1000,
      output: `${noisy}\nFORGE_MUSE_API_KEY=sk-live-DO-NOT-PERSIST`,
      logFile: '/e/console/noisy.log',
    });
    expect(record.tail.length).toBeLessThanOrEqual(40);
    // The tail keeps the end of the output, not the beginning: the point is to
    // explain a failure, and the reason is at the end.
    expect(record.tail.join('\n')).toContain('line 499');
    expect(record.tail.join('\n')).not.toContain('line 400');
    expect(record.tail.join('\n')).not.toContain('sk-live-DO-NOT-PERSIST');
    expect(record.tail.join('\n')).toContain('[REDACTED');
  });

  it('refuses to rehearse next to a live credential', () => {
    expect(liveCredentialProblems({ PATH: '/usr/bin' })).toEqual([]);
    expect(liveCredentialProblems({ FORGE_MUSE_API_KEY: '  ' })).toEqual([]);
    expect(
      liveCredentialProblems({ FORGE_MUSE_API_KEY: 'sk-live-x', META_API_KEY: 'sk-other' }),
    ).toEqual(['FORGE_MUSE_API_KEY', 'META_API_KEY']);
  });

  it('records which credentials existed without ever recording them', () => {
    const manifest = environmentManifest({
      platform: 'darwin',
      release: '25.1.0',
      arch: 'arm64',
      node: 'v26.8.1',
      versions: {
        node: 'v26.8.1',
        pnpm: '10.32.1',
        git: 'git version 2.49',
        ffmpeg: 'ffmpeg version 7',
      },
      env: { FORGE_MUSE_API_KEY: 'sk-live-SECRET-PROMPT', PATH: '/usr/bin' },
      browserPolicy: 'managed',
    });
    expect(manifest.credentialsPresent.FORGE_MUSE_API_KEY).toBe(true);
    expect(manifest.credentialsPresent.META_API_KEY).toBe(false);
    expect(manifest.tools.ffmpeg).toBe('ffmpeg version 7');
    expect(manifest.pnpm).toBe('10.32.1');
    expect(JSON.stringify(manifest)).not.toContain('SECRET-PROMPT');
    expect(manifest.cloneIsolation).toContain('no remote was contacted');
  });

  it('insists the clone is the commit under test', () => {
    const commit = 'd'.repeat(40);
    expect(cloneStateIssues({ commit, clean: true, branch: null }, commit)).toEqual([]);
    expect(
      cloneStateIssues({ commit: 'e'.repeat(40), clean: true, branch: null }, commit),
    ).toHaveLength(1);
    const issues = cloneStateIssues({ commit, clean: false, branch: null }, commit);
    expect(issues.join(' ')).toContain('not clean');
  });

  it('rejects a build manifest that cannot say what it contains', () => {
    const commit = 'a'.repeat(40);
    const web = { ...MANIFEST, kind: 'web' };
    expect(provenanceIssues([MANIFEST, web], commit)).toEqual([]);
    expect(provenanceIssues([], commit)).toEqual(['no build manifest was written by the clone']);
    expect(provenanceIssues([MANIFEST], commit).join(' ')).toContain('built no web bundle');
    expect(provenanceIssues([{ ...MANIFEST, treeClean: false }, web], commit).join(' ')).toContain(
      'built from a dirty tree',
    );
    expect(provenanceIssues([{ ...MANIFEST, buildHash: '' }, web], commit).join(' ')).toContain(
      'no usable build hash',
    );
    expect(
      provenanceIssues([{ ...MANIFEST, commit: 'f'.repeat(40) }, web], commit).join(' '),
    ).toContain('names commit');
  });

  it('only claims offline install when the package manager said so', () => {
    const offline = installSummary(
      'Packages: +1200\nProgress: resolved 1200, reused 1200, downloaded 0, added 1200',
    );
    expect(offline).toEqual({ downloaded: 0, reused: 1200 });
    const networked = installSummary(
      'Progress: resolved 1200, reused 1100, downloaded 100, added 1200',
    );
    expect(networked.downloaded).toBe(100);
    expect(installSummary('no summary here at all').downloaded).toBeNull();
  });
});
