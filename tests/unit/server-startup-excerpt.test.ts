import { describe, expect, it } from 'vitest';
import { startupFailureExcerpt } from '../../scripts/lib/server-startup.js';

const REAL_STARTUP_LOG = [
  'Fatal startup error: Invalid environment configuration — FORGE_MUSE_API_KEY: Too small: expected string to have >=10 characters',
  'Error: Invalid environment configuration — FORGE_MUSE_API_KEY: Too small: expected string to have >=10 characters',
  '    at loadConfig (file:///repo/apps/server/dist/index.js:7488:11)',
  '    at main (file:///repo/apps/server/dist/index.js:20312:18)',
  '    at file:///repo/apps/server/dist/index.js:20376:1',
  '    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)',
  '',
].join('\n');

describe('startupFailureExcerpt', () => {
  it("names the server's own cause line instead of the stack tail", () => {
    const excerpt = startupFailureExcerpt(REAL_STARTUP_LOG);
    expect(excerpt).toContain('Fatal startup error: Invalid environment configuration');
    expect(excerpt).toContain('FORGE_MUSE_API_KEY');
    // The old message quoted the last characters of the log, which was a stack frame.
    expect(excerpt).not.toContain('ModuleJob.run');
    expect(excerpt).not.toContain('7488:11');
  });

  it('falls back to the first line when the server wrote no recognisable error line', () => {
    expect(startupFailureExcerpt('port 8787 is already in use\nsecond line\n')).toBe(
      'port 8787 is already in use',
    );
  });

  it('collapses a multi-line cause onto one line', () => {
    const excerpt = startupFailureExcerpt('Error: bad config\n  FORGE_MUSE_API_KEY: too small\n');
    expect(excerpt).toBe('Error: bad config');
    expect(startupFailureExcerpt('Fatal startup error:\n  key missing\n')).toBe(
      'Fatal startup error: key missing',
    );
  });

  it('bounds the excerpt and marks the cut', () => {
    const long = `Fatal startup error: ${'x'.repeat(400)}`;
    const excerpt = startupFailureExcerpt(long, 120);
    expect(excerpt.length).toBeLessThanOrEqual(120);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('never returns an empty string, because a message ending in nothing reads as nothing to report', () => {
    expect(startupFailureExcerpt('')).toBe('(the server wrote nothing to its log)');
    expect(startupFailureExcerpt('\n\n   \n')).toBe('(the server wrote nothing to its log)');
  });

  it('prefers a fatal line over an earlier generic one', () => {
    expect(
      startupFailureExcerpt('warning: something minor\nFATAL cannot bind 0.0.0.0:443\n'),
    ).toContain('FATAL cannot bind');
  });
});
