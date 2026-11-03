import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedRuntimeRequest } from '../../apps/server/src/forge/runtime-check.js';
import { previewContentSecurityPolicy } from '../../apps/server/src/routes/forge.js';

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
  const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
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

  /*
   * Behaviour, not a grep of the source. The policy now depends on what the
   * served document references (KI-53): an artifact that carries its own engine
   * is granted no remote origin at all, and one that still asks the approved CDN
   * for it keeps the older grant. Grepping the old literal would have failed for
   * the right reason in the wrong place — and would have said nothing about
   * whether a document that needs nothing is still being given a remote origin.
   */
  it('keeps the preview CSP closed', () => {
    const closed = previewContentSecurityPolicy(
      '<script data-forge-vendor="phaser@3.80.1"></script><img src="data:image/png;base64,AA">',
    );
    const legacy = previewContentSecurityPolicy(
      '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>',
    );
    for (const policy of [closed, legacy]) {
      for (const directive of [
        'sandbox allow-scripts',
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        'img-src data: blob:',
        "frame-ancestors 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ]) {
        expect(policy).toContain(directive);
      }
      expect(policy).not.toContain('allow-forms');
      expect(policy).not.toContain('allow-top-navigation');
      expect(policy).not.toContain('allow-same-origin');
    }
    // The self-contained document gets no remote origin in any directive.
    expect(closed).toContain("connect-src 'none'");
    expect(closed).not.toContain('cdn.jsdelivr.net');
    // The document that still needs the approved CDN is granted that origin and
    // nothing wider.
    expect(legacy).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net");
    expect(legacy).toContain('connect-src https://cdn.jsdelivr.net');
    // A document that reaches for some other host is not granted it, and is not
    // granted the approved CDN either: the grant follows what the bytes reference,
    // so an artifact that asks a host this product does not allow get nothing.
    // It used to be handed the CDN origin anyway, which meant the preview policy
    // was wider than the document it served.
    const hostile = previewContentSecurityPolicy(
      '<script src="https://exfiltration.example/x.js">',
    );
    expect(hostile).not.toContain('exfiltration.example');
    expect(hostile).not.toContain('cdn.jsdelivr.net');
    expect(hostile).toContain("connect-src 'none'");
    // And an unquoted reference is read as a reference, the way the browser reads
    // it: the same bytes must not be a gap in one surface and invisible in another.
    const unquoted = previewContentSecurityPolicy(`<script src=${PHASER_URL}></script>`);
    expect(unquoted).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net");
    // The directive that names a granted origin follows what carries it, but the
    // grant itself is per origin, not per directive: an image reference to the
    // approved CDN opens img-src, and the same origin remains reachable by fetch
    // — exactly as the verification browser allows it for those bytes. Narrowing
    // this per directive would be a second policy, and the failure mode of two
    // policies is the one this test exists to prevent.
    const imageOnly = previewContentSecurityPolicy(
      '<img src="https://cdn.jsdelivr.net/npm/fontawesome/icons/flag.svg">',
    );
    expect(imageOnly).toContain('img-src data: blob: https://cdn.jsdelivr.net');
    expect(imageOnly).toContain('connect-src https://cdn.jsdelivr.net');
    expect(imageOnly).not.toContain('fontawesome');
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
