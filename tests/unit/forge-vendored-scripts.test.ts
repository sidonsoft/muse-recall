import { describe, expect, it } from 'vitest';
import {
  isAllowedRuntimeRequest,
  runtimeNetworkPolicy,
} from '../../apps/server/src/forge/runtime-check.js';
import {
  externalReferences,
  unvendorScripts,
  VENDOR_MARKER_ATTRIBUTE,
  VENDORED_SCRIPTS,
  vendoredLibrariesIn,
  vendoredScriptIntegrityIssues,
  vendorGapUrls,
  vendorScripts,
} from '../../apps/server/src/forge/vendored-scripts.js';

const phaser = VENDORED_SCRIPTS.find((entry) => entry.name === 'phaser');
if (!phaser) throw new Error('the build vendors no Phaser, so these tests cannot mean anything');

const PHASER_URL = phaser.url;
const OTHER_PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.55.0/dist/phaser.min.js';
const PIN = {
  sha256: '62081f6a1b51d040473f919ffedef9009953c20833518e146da5a8d1c9405ea8',
  bytes: 1_181_917,
};

function gameDocument(scriptTag = `<script src="${PHASER_URL}"></script>`): string {
  return [
    '<!doctype html><html><head><title>Game</title></head><body>',
    '<div id="game"></div>',
    scriptTag,
    '<script>new Phaser.Game({ type: Phaser.AUTO, parent: "game" });</script>',
    '</body></html>',
  ].join('');
}

describe('the engine Forge vendors into generated games', () => {
  it('pins one Phaser version and names the reference it replaces', () => {
    expect(phaser.version).toBe('3.80.1');
    expect(PHASER_URL).toBe('https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js');
  });

  it('replaces the CDN reference with the library the product carries', () => {
    const outcome = vendorScripts(gameDocument());
    expect(outcome.applied).toEqual([
      {
        name: 'phaser',
        version: '3.80.1',
        sha256: PIN.sha256,
        bytes: PIN.bytes,
        replaced_url: PHASER_URL,
      },
    ]);
    expect(outcome.gaps).toEqual([]);
    expect(outcome.html).not.toContain('cdn.jsdelivr.net');
    expect(outcome.external_urls).toEqual([]);
    expect(outcome.html).toContain(`${VENDOR_MARKER_ATTRIBUTE}="phaser@3.80.1"`);
    expect(outcome.html.length).toBeGreaterThan(gameDocument().length + PIN.bytes);
  });

  it('ships the license notice with the copy it inlines', () => {
    const outcome = vendorScripts(gameDocument());
    expect(outcome.html).toContain('MIT License');
    expect(outcome.html).toContain('Richard Davey');
  });

  it('the engine it inlines hashes to the pin, and a marked engine verifies', () => {
    const outcome = vendorScripts(gameDocument());
    expect(vendoredLibrariesIn(outcome.html)).toEqual([
      {
        name: 'phaser',
        version: '3.80.1',
        sha256: PIN.sha256,
        bytes: PIN.bytes,
        replaced_url: PHASER_URL,
      },
    ]);
    expect(vendoredScriptIntegrityIssues(outcome.html)).toEqual([]);
  });

  it('runs twice without inlining twice', () => {
    const once = vendorScripts(gameDocument());
    const twice = vendorScripts(once.html);
    expect(twice.applied).toEqual([]);
    expect(twice.gaps).toEqual([]);
    expect(twice.html).toBe(once.html);
    expect((twice.html.match(new RegExp(VENDOR_MARKER_ATTRIBUTE, 'g')) ?? []).length).toBe(1);
  });

  it('refuses to substitute a different Phaser version, and says which one', () => {
    const outcome = vendorScripts(gameDocument(`<script src="${OTHER_PHASER_URL}"></script>`));
    expect(outcome.applied).toEqual([]);
    expect(outcome.gaps).toHaveLength(1);
    expect(outcome.gaps[0]?.url).toBe(OTHER_PHASER_URL);
    expect(outcome.gaps[0]?.reason).toContain('3.55.0');
    expect(outcome.gaps[0]?.reason).toContain('3.80.1');
    // The reference is left exactly as written: a reviewer must still see it.
    expect(outcome.html).toContain(OTHER_PHASER_URL);
    expect(outcome.external_urls).toEqual([OTHER_PHASER_URL]);
  });

  it('leaves a script tag whose semantics inlining would change', () => {
    const outcome = vendorScripts(gameDocument(`<script defer src="${PHASER_URL}"></script>`));
    expect(outcome.applied).toEqual([]);
    expect(outcome.gaps[0]?.reason).toContain('attributes');
    expect(outcome.html).toContain(PHASER_URL);
  });

  it('leaves a script tag that has both a src and a body', () => {
    const outcome = vendorScripts(
      gameDocument(`<script src="${PHASER_URL}">console.log("extra")</script>`),
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.gaps[0]?.reason).toContain('body alongside its src');
  });

  it('reports a document that carries the engine and still asks for it over the network', () => {
    const vendored = vendorScripts(gameDocument());
    const tampered = vendored.html.replace(
      '</body>',
      `<script src="${PHASER_URL}"></script></body>`,
    );
    const outcome = vendorScripts(tampered);
    expect(outcome.applied).toEqual([]);
    expect(outcome.gaps[0]?.reason).toContain('already carries a vendored phaser@3.80.1');
  });

  it('does not touch another package it does not vendor', () => {
    const lodash = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js';
    const outcome = vendorScripts(gameDocument(`<script src="${lodash}"></script>`));
    expect(outcome.applied).toEqual([]);
    expect(outcome.gaps).toEqual([]);
    expect(outcome.html).toContain(lodash);
    expect(outcome.external_urls).toEqual([lodash]);
  });

  it('a forged vendor marker does not buy an exemption', () => {
    const forged = gameDocument(
      `<script ${VENDOR_MARKER_ATTRIBUTE}="phaser@3.80.1">document.write("not phaser")</script>`,
    );
    const issues = vendoredScriptIntegrityIssues(forged);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('not the pinned library');
    expect(vendoredLibrariesIn(forged)).toEqual([]);

    const unknown = gameDocument(
      `<script ${VENDOR_MARKER_ATTRIBUTE}="somethingelse@9">console.log(1)</script>`,
    );
    expect(vendoredScriptIntegrityIssues(unknown)[0]).toContain('this build does not vendor');
  });

  it('the source view goes back to the shipped bytes byte for byte', () => {
    const shipped = vendorScripts(gameDocument()).html;
    const source = unvendorScripts(shipped);
    expect(source).toContain(PHASER_URL);
    expect(source).not.toContain(VENDOR_MARKER_ATTRIBUTE);
    // A model editing that view can only produce the same shipped bytes.
    expect(vendorScripts(source).html).toBe(shipped);
    // And a model that edits it still round-trips.
    const edited = source.replace('<div id="game"></div>', '<div id="game"></div><p>score</p>');
    const reshipped = vendorScripts(edited).html;
    expect(vendoredLibrariesIn(reshipped)).toEqual(vendoredLibrariesIn(shipped));
    expect(unvendorScripts(reshipped)).toBe(edited);
  });

  it('will not reduce a source view from a block that fails its hash', () => {
    const forged = gameDocument(
      `<script ${VENDOR_MARKER_ATTRIBUTE}="phaser@3.80.1">console.log(1)</script>`,
    );
    // Unverified bytes stay visible: hiding them from the source view would hide
    // them from review too.
    expect(unvendorScripts(forged)).toBe(forged);
  });

  it('names the remote engine references a document still depends on', () => {
    expect(vendorGapUrls(vendorScripts(gameDocument()).html)).toEqual([]);
    expect(vendorGapUrls(gameDocument(`<script src="${OTHER_PHASER_URL}"></script>`))).toEqual([
      OTHER_PHASER_URL,
    ]);
    // A remote image is an external reference, but not an engine gap.
    expect(vendorGapUrls('<img src="https://cdn.jsdelivr.net/gh/x/y.png">')).toEqual([]);
  });

  it('external references count absolute http(s) only', () => {
    expect(
      externalReferences(
        '<img src="data:image/png;base64,AA"><a href="/x"><script src="y.js"></script>',
      ),
    ).toEqual([]);
    expect(externalReferences('<script src="https://a.test/x.js"></script>')).toEqual([
      'https://a.test/x.js',
    ]);
  });
});

describe('the network a runtime check grants, chosen by the document', () => {
  it('grants a self-contained game no remote origin at all', () => {
    const html = vendorScripts(gameDocument()).html;
    expect(runtimeNetworkPolicy(html)).toBe('vendored');
    expect(isAllowedRuntimeRequest(PHASER_URL, 'vendored')).toBe(false);
    expect(isAllowedRuntimeRequest('https://example.test/x.js', 'vendored')).toBe(false);
    expect(isAllowedRuntimeRequest('data:text/javascript,1', 'vendored')).toBe(true);
  });

  it('grants a document that still asks the CDN for its engine the old allowlist', () => {
    expect(runtimeNetworkPolicy(gameDocument())).toBe('cdn-allowlist');
    expect(isAllowedRuntimeRequest(PHASER_URL, 'cdn-allowlist')).toBe(true);
    expect(runtimeNetworkPolicy(vendorScripts(gameDocument()).html)).toBe('vendored');
  });

  it('keeps the allowlist when a vendored game reaches for anything else remote', () => {
    const html = vendorScripts(gameDocument()).html.replace(
      '</body>',
      '<img src="https://cdn.jsdelivr.net/gh/a/b.png"></body>',
    );
    expect(runtimeNetworkPolicy(html)).toBe('cdn-allowlist');
  });
});
