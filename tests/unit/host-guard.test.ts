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

describe('isAllowedHostHeader with forwarded origins', () => {
  const CODESPACE = 'https://judge-demo-x7q9-5173.app.github.dev';
  const FORWARDED = { ...BASE, forwardedOrigins: [CODESPACE] };

  it('rejects a forwarded public host by default', () => {
    expect(isAllowedHostHeader('judge-demo-x7q9-5173.app.github.dev', BASE)).toBe(false);
    expect(
      isAllowedHostHeader('judge-demo-x7q9-5173.app.github.dev', { ...BASE, forwardedOrigins: [] }),
    ).toBe(false);
  });

  it('accepts exactly the configured forwarded host, with or without its default port', () => {
    expect(isAllowedHostHeader('judge-demo-x7q9-5173.app.github.dev', FORWARDED)).toBe(true);
    expect(isAllowedHostHeader('JUDGE-DEMO-X7Q9-5173.app.github.dev', FORWARDED)).toBe(true);
    expect(isAllowedHostHeader('judge-demo-x7q9-5173.app.github.dev:443', FORWARDED)).toBe(true);
  });

  it('rejects other hosts, ports and suffix tricks even when forwarding is configured', () => {
    for (const host of [
      'someone-else-5173.app.github.dev',
      'judge-demo-x7q9-8787.app.github.dev',
      'judge-demo-x7q9-5173.app.github.dev:8443',
      'judge-demo-x7q9-5173.app.github.dev.evil.example',
      'evil.example',
      'user@judge-demo-x7q9-5173.app.github.dev',
    ]) {
      expect(isAllowedHostHeader(host, FORWARDED), host).toBe(false);
    }
  });

  it('keeps loopback rules unchanged when forwarding is configured', () => {
    expect(isAllowedHostHeader('127.0.0.1:8787', FORWARDED)).toBe(true);
    expect(isAllowedHostHeader('127.0.0.1:9999', FORWARDED)).toBe(false);
  });

  it('ignores a malformed configured forwarded origin', () => {
    expect(isAllowedHostHeader('evil.example', { ...BASE, forwardedOrigins: ['not a url'] })).toBe(
      false,
    );
  });
});
