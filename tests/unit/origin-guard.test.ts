import { describe, expect, it } from 'vitest';
import {
  evaluateRequestOrigin,
  isStateChangingMethod,
  normalizeOrigin,
} from '../../apps/server/src/origin-guard.js';

const BASE = {
  method: 'POST',
  origin: undefined as string | undefined,
  host: '127.0.0.1:8787',
  corsOrigins: ['http://localhost:5173'],
};

describe('normalizeOrigin', () => {
  it('accepts canonical HTTP(S) origins, including IPv6 and non-default ports', () => {
    expect(normalizeOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeOrigin('https://app.example')).toBe('https://app.example');
    expect(normalizeOrigin('http://[::1]:5173')).toBe('http://[::1]:5173');
  });

  it('rejects null, empty, non-HTTP and non-canonical values', () => {
    for (const value of [
      '',
      ' ',
      'null',
      'NULL',
      'file:///tmp/index.html',
      'data:text/html,hi',
      'http://localhost:5173/',
      'http://localhost:80',
      'http://localhost:5173?x=1',
      'http://localhost:5173#frag',
      'http://user:pass@localhost:5173',
      'http://localhost:5173.evil.example',
      'http://localhost.:5173',
    ]) {
      expect(normalizeOrigin(value), value).toBeNull();
    }
  });

  it('rejects multiple or whitespace-separated origins', () => {
    expect(normalizeOrigin('http://localhost:5173,http://evil.example')).toBeNull();
    expect(normalizeOrigin('http://localhost:5173 http://evil.example')).toBeNull();
  });

  it('rejects deceptive ports and schemes', () => {
    expect(normalizeOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
    expect(evaluateRequestOrigin({ ...BASE, origin: 'http://127.0.0.1:8788' })).toEqual({
      allowed: false,
      reason: 'untrusted-origin',
    });
    expect(evaluateRequestOrigin({ ...BASE, origin: 'https://127.0.0.1:8787' })).toEqual({
      allowed: false,
      reason: 'untrusted-origin',
    });
  });
});

describe('isStateChangingMethod', () => {
  it('treats only GET, HEAD and OPTIONS as safe', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(isStateChangingMethod(method), method).toBe(false);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isStateChangingMethod(method), method).toBe(true);
    }
  });
});

describe('evaluateRequestOrigin', () => {
  it('allows safe methods even from a foreign origin (no state to change)', () => {
    expect(
      evaluateRequestOrigin({ ...BASE, method: 'GET', origin: 'https://evil.example' }),
    ).toEqual({ allowed: true, reason: 'safe-method' });
  });

  it('allows a same-origin mutation derived from the validated Host header', () => {
    expect(evaluateRequestOrigin({ ...BASE, origin: 'http://127.0.0.1:8787' })).toEqual({
      allowed: true,
      reason: 'same-origin',
    });
    expect(
      evaluateRequestOrigin({
        ...BASE,
        host: '[::1]:8787',
        origin: 'http://[::1]:8787',
      }),
    ).toEqual({ allowed: true, reason: 'same-origin' });
  });

  it('allows a configured development origin', () => {
    expect(evaluateRequestOrigin({ ...BASE, origin: 'http://localhost:5173' })).toEqual({
      allowed: true,
      reason: 'trusted-origin',
    });
  });

  it('rejects a foreign HTTPS origin', () => {
    expect(evaluateRequestOrigin({ ...BASE, origin: 'https://evil.example' })).toEqual({
      allowed: false,
      reason: 'untrusted-origin',
    });
  });

  it('rejects Origin: null', () => {
    expect(evaluateRequestOrigin({ ...BASE, origin: 'null' })).toEqual({
      allowed: false,
      reason: 'null-origin',
    });
  });

  it('rejects malformed and ambiguous origins', () => {
    for (const origin of ['', 'http://', 'http://localhost:5173/', 'not-an-origin', 'http://a,b']) {
      expect(evaluateRequestOrigin({ ...BASE, origin }), origin).toEqual({
        allowed: false,
        reason: 'malformed-origin',
      });
    }
  });

  it('rejects a deceptive hostname that merely contains the trusted host', () => {
    expect(
      evaluateRequestOrigin({ ...BASE, origin: 'http://127.0.0.1.evil.example:8787' }),
    ).toEqual({ allowed: false, reason: 'untrusted-origin' });
    expect(
      evaluateRequestOrigin({ ...BASE, origin: 'http://localhost.evil.example:5173' }),
    ).toEqual({ allowed: false, reason: 'untrusted-origin' });
  });

  it('rejects a deceptive port on the trusted hostname', () => {
    expect(evaluateRequestOrigin({ ...BASE, origin: 'http://localhost:5174' })).toEqual({
      allowed: false,
      reason: 'untrusted-origin',
    });
  });

  it('allows a missing Origin for non-browser clients', () => {
    expect(evaluateRequestOrigin(BASE)).toEqual({ allowed: true, reason: 'non-browser' });
  });

  it('rejects a missing Origin when the browser says it is cross-site', () => {
    expect(evaluateRequestOrigin({ ...BASE, secFetchSite: 'cross-site' })).toEqual({
      allowed: false,
      reason: 'cross-site-fetch',
    });
    expect(evaluateRequestOrigin({ ...BASE, secFetchSite: 'same-site' })).toEqual({
      allowed: false,
      reason: 'cross-site-fetch',
    });
  });

  it('allows a missing Origin with same-origin or none Sec-Fetch-Site', () => {
    expect(evaluateRequestOrigin({ ...BASE, secFetchSite: 'same-origin' })).toEqual({
      allowed: true,
      reason: 'non-browser',
    });
    expect(evaluateRequestOrigin({ ...BASE, secFetchSite: 'none' })).toEqual({
      allowed: true,
      reason: 'non-browser',
    });
  });

  it('ignores malformed configured origins instead of trusting them', () => {
    expect(
      evaluateRequestOrigin({
        ...BASE,
        corsOrigins: ['not-an-origin', 'http://localhost:5173/'],
        origin: 'http://localhost:5173',
      }),
    ).toEqual({ allowed: false, reason: 'untrusted-origin' });
  });

  it('derives same-origin only from a loopback Host, never a forwarded public host', () => {
    const host = 'judge-demo-x7q9-5173.app.github.dev';
    for (const origin of [`http://${host}`, `https://${host}`]) {
      expect(evaluateRequestOrigin({ ...BASE, host, origin }), origin).toEqual({
        allowed: false,
        reason: 'untrusted-origin',
      });
    }
    expect(
      evaluateRequestOrigin({
        ...BASE,
        host,
        origin: `https://${host}`,
        corsOrigins: [`https://${host}`],
      }),
    ).toEqual({ allowed: true, reason: 'trusted-origin' });
  });
});
