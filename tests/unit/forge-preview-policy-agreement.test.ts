/*
 * Three surfaces decide what a document may reach: the verification browser, the
 * preview CSP that serves it in Studio, and the dependency record a person
 * approves against. They used to derive that answer independently — a quoted-only
 * scan for the policy and the preview, a script-aware scan for the disclosure —
 * and disagreed in ways a reviewer could not see: a tag written without quotes was
 * disclosed as a dependency that is loaded while the preview refused to fetch it,
 * and an allowlisted image was reported as fetched while `img-src` blocked it.
 *
 * This pins that all three read the same document (KI-74, review finding 4/5).
 */
import { describe, expect, it } from 'vitest';
import { dependencyDisclosure } from '../../apps/server/src/forge/dependencies.js';
import {
  documentNetworkPolicy,
  previewRemoteGrant,
  referencedRemoteOrigins,
} from '../../apps/server/src/forge/network-policy.js';
import { vendorGapUrls, vendorScripts } from '../../apps/server/src/forge/vendored-scripts.js';
import { previewContentSecurityPolicy } from '../../apps/server/src/routes/forge.js';

const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
const LODASH_URL = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js';
const IMAGE_URL = 'https://cdn.jsdelivr.net/npm/fontawesome/icons/flag.svg';

function grants(csp: string): string[] {
  return [...csp.matchAll(/https:\/\/[a-z0-9.:-]+/gi)].map((match) => match[0]);
}

describe('the preview policy, the verification policy and the disclosure agree', () => {
  it('grants an unquoted script reference the disclosure calls fetched', () => {
    const html = `<!doctype html><html><body><script defer src=${LODASH_URL}></script><button type="button">go</button></body></html>`;
    const view = dependencyDisclosure(html);
    expect(view.dependencies[0]?.status).toBe('fetched');
    expect(previewRemoteGrant(html)).toEqual(['https://cdn.jsdelivr.net']);
    const csp = previewContentSecurityPolicy(html);
    expect(csp).toContain('script-src');
    // The host the reviewer was told will be fetched is a host the preview lets
    // through; otherwise the disclosure described a document nobody could load.
    expect(grants(csp)).toContain('https://cdn.jsdelivr.net');
  });

  it('grants an allowlisted image the disclosure calls fetched', () => {
    const html = `<!doctype html><html><body><img src="${IMAGE_URL}"><button type="button">go</button></body></html>`;
    const view = dependencyDisclosure(html);
    expect(view.dependencies.map((row) => row.status)).toEqual(['fetched']);
    const csp = previewContentSecurityPolicy(html);
    const imgSrc = csp.split('; ').find((part) => part.startsWith('img-src')) ?? '';
    expect(imgSrc).toContain('https://cdn.jsdelivr.net');
  });

  it('grants nothing to a document that carries its engine, and says so', () => {
    const source = `<!doctype html><html><body><canvas id="c"></canvas><script src="${PHASER_URL}"></script><script>new Phaser.Game();</script></body></html>`;
    const shipped = vendorScripts(source).html;
    expect(documentNetworkPolicy(shipped)).toBe('vendored');
    expect(previewRemoteGrant(shipped)).toEqual([]);
    const csp = previewContentSecurityPolicy(shipped);
    expect(grants(csp)).toEqual([]);
    expect(csp).toContain("connect-src 'none'");
    const view = dependencyDisclosure(shipped);
    expect(view.self_contained).toBe(true);
    expect(view.dependencies.map((row) => row.status)).toEqual(['bundled']);
    expect(vendorGapUrls(shipped)).toEqual([]);
  });

  it('refuses a reach the document only mentions in code, in every surface', () => {
    const source = `<!doctype html><html><body><canvas id="c"></canvas><script src="${PHASER_URL}"></script><script>fetch("https://example.org/collect");new Phaser.Game();</script></body></html>`;
    const shipped = vendorScripts(source).html;
    const view = dependencyDisclosure(shipped);
    expect(
      view.dependencies.find((row) => row.reason === 'requested_by_application_code')?.status,
    ).toBe('blocked');
    expect(previewRemoteGrant(shipped)).toEqual([]);
    expect(previewContentSecurityPolicy(shipped)).toContain("connect-src 'none'");
    // A code-literal URL is not a document reference, so it never widens a grant.
    expect(referencedRemoteOrigins(shipped)).toEqual([]);
  });

  it('vendors an unquoted pinned reference, so all three surfaces agree on it', () => {
    // The point of parsing attributes the way a browser does is not to refuse more
    // documents: it is that a reference written without quotes is no longer
    // invisible to the policy, the preview and the disclosure at once.
    const html = `<!doctype html><html><body><canvas id="c"></canvas><script src=${PHASER_URL}></script><script>new Phaser.Game();</script></body></html>`;
    const outcome = vendorScripts(html);
    expect(outcome.applied.map((entry) => entry.name)).toEqual(['phaser']);
    expect(outcome.gaps).toEqual([]);
    expect(vendorGapUrls(outcome.html)).toEqual([]);
    const view = dependencyDisclosure(outcome.html);
    expect(view.dependencies.map((row) => row.status)).toEqual(['bundled']);
    expect(view.self_contained).toBe(true);
    expect(grants(previewContentSecurityPolicy(outcome.html))).toEqual([]);
  });

  it('keeps a refused pinned reference visible as a gap, however the tag was written', () => {
    for (const tag of [
      `<script defer src="${PHASER_URL}"></script>`,
      `<script src="${PHASER_URL}" onload="takeItAll()"></script>`,
      `<script src="${PHASER_URL}">console.log("body")</script>`,
    ]) {
      const html = `<!doctype html><html><body><canvas id="c"></canvas>${tag}<script>new Phaser.Game();</script></body></html>`;
      const outcome = vendorScripts(html);
      expect(outcome.applied, tag).toEqual([]);
      expect(outcome.gaps.length, tag).toBe(1);
      expect(vendorGapUrls(outcome.html), tag).toEqual([PHASER_URL]);
      const view = dependencyDisclosure(outcome.html);
      expect(view.dependencies[0]?.status, tag).toBe('fetched');
      expect(grants(previewContentSecurityPolicy(outcome.html)), tag).toContain(
        'https://cdn.jsdelivr.net',
      );
    }
  });
});
