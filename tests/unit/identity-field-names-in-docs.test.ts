// KI-84: a release document quoted `treeClean: false` next to `supportsCommitIdentity: true`, and a
// reader reasonably called that a contradiction. Both values were correct — one is the working tree
// while the gate ran, the other is whether the build ran over a clean tree — but the names did not
// say which instant each described. These checks keep the documents and the emitted fields from
// drifting back into that shape.

import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeBundleIdentity, type BuildManifest, type ProvenanceReport } from '../../scripts/lib/build-provenance.js';

const RELEASE_DOCS = [
  'docs/MULTIMODAL_STUDIO_STATUS.md',
  'docs/Fresh-Install-Rehearsal.md',
  'docs/KNOWN_ISSUES.md',
];

const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function manifest(component: 'server' | 'web'): BuildManifest {
  return {
    kind: 'batchc-build-manifest',
    component,
    commit: COMMIT,
    treeClean: true,
    treeStatus: '',
    sourceHash: 's'.repeat(64),
    sourceFiles: 10,
    sourceInputs: [],
    buildHash: component === 'server' ? 'b1'.repeat(32) : 'b2'.repeat(32),
    buildFiles: 3,
    builtAt: '2026-11-03T00:00:00.000Z',
    identity: null,
  };
}

function report(): ProvenanceReport {
  return {
    commit: COMMIT,
    treeCleanAtMeasure: true,
    treeStatusAtMeasure: '',
    server: manifest('server'),
    web: manifest('web'),
  };
}

/** Field names the identity block actually emits — the only ones a document may quote as identity. */
const identityFields = Object.keys(describeBundleIdentity(report()));

describe('identity field names a release document may quote', () => {
  it('emits one name per instant, and none of them is the ambiguous `treeClean`', () => {
    expect(identityFields).toContain('builtFromCleanTree');
    expect(identityFields).toContain('treeCleanAtMeasure');
    expect(identityFields).not.toContain('treeClean');
  });

  it('lets no document put an unqualified `treeClean` beside a commit-identity claim unexplained', () => {
    // The pairing itself is not the sin: a retained report really did print `treeClean`, and quoting
    // it is honest. What is not honest is quoting it beside an identity claim without saying which
    // instant it described, which is how the Palette Bench packet read as self-contradictory.
    for (const doc of RELEASE_DOCS) {
      const text = readFileSync(doc, 'utf8');
      const window = 320;
      for (const match of text.matchAll(/supportsCommitIdentity/g)) {
        const around = text.slice(Math.max(0, (match.index ?? 0) - window), (match.index ?? 0) + window);
        if (!/\btreeClean\s*:/.test(around)) continue;
        expect(
          around.includes('treeCleanAtMeasure') || around.includes('KI-84'),
          `${doc} prints an unqualified \`treeClean\` next to supportsCommitIdentity without naming ` +
            'the instant it describes — say `treeCleanAtMeasure`, or cross-reference KI-84 when quoting ' +
            'a report that predates the rename',
        ).toBe(true);
      }
    }
  });

  it('refuses a document that quotes an identity field the code does not emit', () => {
    // The names a document may quote are the keys the gates actually print, taken from the source
    // that prints them rather than a hand-kept list that could go stale in the same way.
    const emitters = [
      'scripts/verify-batchd-playback-auth.ts',
      'scripts/build-review-app.ts',
      'scripts/verify-batchc-live-smoke.ts',
      'scripts/verify-batchc-resume-staged.ts',
    ];
    const emitted = new Set<string>(identityFields);
    for (const script of emitters) {
      const source = readFileSync(script, 'utf8');
      const start = source.indexOf('observations.buildProvenance = {');
      expect(start, `${script} no longer builds a buildProvenance block`).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf('};', start));
      for (const match of block.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):/gm)) {
        emitted.add(match[1] ?? '');
      }
    }
    expect(emitted.has('bundlesBuiltFromCleanTree'), 'the identity pair gate stopped printing it').toBe(true);
    expect(emitted.has('treeCleanAtMeasure'), 'the instantaneous field lost its name').toBe(true);
    const quoted = new Set<string>();
    for (const doc of RELEASE_DOCS) {
      const text = readFileSync(doc, 'utf8');
      for (const match of text.matchAll(/\b(bundles[A-Za-z]+|supportsCommitIdentity|treeClean[A-Za-z]*)\b/g)) {
        quoted.add(match[1] ?? '');
      }
    }
    // `treeClean` on its own is a manifest field and is allowed; everything identity-shaped that a
    // document quotes in backticks has to be something a report actually prints.
    const backticked = new Set<string>();
    for (const doc of RELEASE_DOCS) {
      for (const match of readFileSync(doc, 'utf8').matchAll(/`(bundles[A-Za-z]+|supportsCommitIdentity|treeClean[A-Za-z]+)`/g)) {
        backticked.add(match[1] ?? '');
      }
    }
    for (const name of backticked) {
      expect(emitted.has(name), `${name} is quoted as an identity field but no report emits it`).toBe(true);
    }
    expect(quoted.size).toBeGreaterThan(0);
  });
});

describe('the documents that carry these claims exist', () => {
  it('every release document named above is present and non-trivial', () => {
    for (const doc of RELEASE_DOCS) {
      expect(statSync(doc).isFile(), `${doc} is missing`).toBe(true);
      expect(readFileSync(doc, 'utf8').length, `${doc} is empty`).toBeGreaterThan(500);
    }
  });
});
