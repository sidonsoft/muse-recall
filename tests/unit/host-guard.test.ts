import { describe, expect, it } from 'vitest';
import { isAllowedHostHeader, parseHostHeader } from '../../apps/server/src/host-guard.js';

const BASE = { port: 8787, corsOrigins: ['http://127.0.0.1:5173'] };

describe('parseHostHeader', () => {
  it('parses hostnames, ports and IPv6 literals', () => {
    expect(parseHostHeader('127.0.0.1:8787')).toEqual({ hostname: '127.0.0.1', port: 8787 });
    expect(parseHostHeader('localhost:5173')).toEqual({ hostname: 'localhost', port: 5173 });
    expect(parseHostHeader('[::1]:8787')).toEqual({ hostname: '[::1]', port: 8787 });
    expect(parseHostHeader('127.0.0.1')).toEqual({ hostname: '127.0.0.1', port: 80 });
  });

  it('rejects malformed or smuggled values', () => {
    for (const value of ['', ' ', 'not a host', 'evil.example/path', 'user:pass@127.0.0.1:8787']) {
      expect(parseHostHeader(value), value).toBeNull();
    }
  });
});

describe('isAllowedHostHeader', () => {
  it('accepts loopback hosts on the configured API port', () => {
    expect(isAllowedHostHeader('127.0.0.1:8787', BASE)).toBe(true);
    expect(isAllowedHostHeader('localhost:8787', BASE)).toBe(true);
    expect(isAllowedHostHeader('[::1]:8787', BASE)).toBe(true);
  });

  it('accepts the configured local web origin forwarded by the dev proxy', () => {
    expect(isAllowedHostHeader('127.0.0.1:5173', BASE)).toBe(true);
    expect(
      isAllowedHostHeader('localhost:5173', {
        port: 8787,
        corsOrigins: ['http://localhost:5173'],
      }),
    ).toBe(true);
  });

  it('rejects unexpected hostnames and ports', () => {
    expect(isAllowedHostHeader('evil.example:8787', BASE)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1.nip.io:8787', BASE)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1:9999', BASE)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1', BASE)).toBe(false);
    expect(isAllowedHostHeader(undefined, BASE)).toBe(false);
  });

  it('does not treat a remote web origin as local', () => {
    expect(
      isAllowedHostHeader('evil.example:8787', {
        port: 8787,
        corsOrigins: ['https://evil.example'],
      }),
    ).toBe(false);
  });

  it('validates hostname only when the API port is assigned at bind time', () => {
    const ephemeral = { port: 0, corsOrigins: [] };
    expect(isAllowedHostHeader('localhost:80', ephemeral)).toBe(true);
    expect(isAllowedHostHeader('127.0.0.1:49152', ephemeral)).toBe(true);
    expect(isAllowedHostHeader('evil.example:80', ephemeral)).toBe(false);
  });
});
