import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedRuntimeRequest } from '../../apps/server/src/forge/runtime-check.js';

/**
 * A focused guard on the shipped preview/runtime policy.
 *
 * P1 form compatibility was fixed in the generation prompt. It must never be
 * "fixed" by adding `allow-forms`, `allow-top-navigation`, a wider network
 * allowlist, or by dropping CSP. These assertions fail loudly if a future
 * change relaxes either the iframe sandbox, the preview CSP, or the runtime
 * network allowlist.
 */
describe('preview sandbox policy', () => {
  const route = readFileSync(join(process.cwd(), 'apps/server/src/routes/forge.ts'), 'utf8');
  const studio = readFileSync(
    join(process.cwd(), 'apps/web/src/components/studio/StudioView.tsx'),
    'utf8',
  );

  it('serves previews inside a scripts-only sandbox', () => {
    expect(route).toContain("'sandbox allow-scripts'");
    expect(studio).toContain('sandbox="allow-scripts"');
    for (const source of [route, studio]) {
      expect(source).not.toContain('allow-forms');
      expect(source).not.toContain('allow-top-navigation');
      expect(source).not.toContain('allow-same-origin');
    }
  });

  it('keeps the preview CSP closed', () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'unsafe-inline'",
      'img-src data: blob:',
      'connect-src https://cdn.jsdelivr.net',
      "frame-ancestors 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ]) {
      expect(route).toContain(directive);
    }
  });
});

describe('runtime network allowlist', () => {
  it.each([
    'about:blank',
    'data:text/html,<p>ok</p>',
    'blob:https://cdn.jsdelivr.net/1234',
    'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js',
  ])('allows %s', (url) => {
    expect(isAllowedRuntimeRequest(url)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:8787/api/meta',
    'http://localhost:8787/',
    'https://exfiltration.example/collect',
    'https://cdn.jsdelivr.net.evil.example/phaser.js',
    'http://cdn.jsdelivr.net/npm/phaser.min.js',
    'ws://127.0.0.1:8787/socket',
    'wss://exfiltration.example/socket',
    'file:///etc/passwd',
  ])('rejects %s', (url) => {
    expect(isAllowedRuntimeRequest(url)).toBe(false);
  });
});
