import { describe, expect, it } from 'vitest';
import { remoteLoadFailure } from '../../apps/server/src/forge/runtime-check.js';

/**
 * The runtime verifier lets exactly one remote host through. When that load
 * fails, the report has to say which host and must not repeat the URL: a
 * generated page can build a query string out of its own data, and the path can
 * be long enough to push the report past its schema bound.
 */
describe('naming a permitted load that failed', () => {
  it('names the allowed origin and the browser reason', () => {
    const line = remoteLoadFailure('https://cdn.jsdelivr.net', 'net::ERR_CONNECTION_RESET');
    expect(line).toContain('https://cdn.jsdelivr.net');
    expect(line).toContain('net::ERR_CONNECTION_RESET');
    expect(line).toContain('approved CDN');
  });

  it('keeps the origin, not the path or query', () => {
    const line = remoteLoadFailure(
      'https://cdn.jsdelivr.net',
      'net::ERR_CONNECTION_RESET https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js?token=abc123',
    );
    expect(line).toContain('https://cdn.jsdelivr.net');
    expect(line).not.toContain('phaser.min.js');
    expect(line).not.toContain('token=abc123');
  });

  it('stays inside the schema bound for one error', () => {
    const line = remoteLoadFailure('https://cdn.jsdelivr.net', `x ${'y'.repeat(2_000)}`);
    expect(line.length).toBeLessThanOrEqual(300);
  });

  it('redacts a credential that appears in the failure text', () => {
    const line = remoteLoadFailure(
      'https://cdn.jsdelivr.net',
      'Authorization: Bearer supersecretvalue1234567890',
    );
    expect(line).not.toContain('supersecretvalue1234567890');
    expect(line).toContain('[REDACTED');
  });

  it('still says something when the browser reports no reason', () => {
    const line = remoteLoadFailure('https://cdn.jsdelivr.net', '   ');
    expect(line).toContain('the connection failed');
    expect(line.length).toBeLessThanOrEqual(300);
  });
});
