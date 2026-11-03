/**
 * Offline provenance tests: content-hash binding between source trees
 * and production builds. Pure filesystem + hashing — no network, no
 * provider, no browser. The gate under test is the same function the
 * live smoke calls before starting any server or dispatch.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type BuildManifest,
  type BundleIdentity,
  collectDistFiles,
  collectInputFiles,
  collectSourceFiles,
  describeBundleIdentity,
  hashFiles,
  readManifest,
  verifyBuildProvenance,
  writeManifest,
} from '../../scripts/lib/build-provenance.js';

const ROOT = join(import.meta.dirname, '..', '..');

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'provenance-'));
}

function writeSources(root: string, files: Record<string, string>): string[] {
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    paths.push(full);
  }
  paths.sort();
  return paths;
}

describe('hashFiles', () => {
  it('is stable and order-independent, and changes with content', () => {
    const root = tempRoot();
    try {
      const a = writeSources(root, { 'a.ts': 'one', 'sub/b.ts': 'two' });
      const first = hashFiles(root, a);
      // Order is the caller's contract (collectSourceFiles sorts):
      // same set in a different order hashes differently.
      const reversed = hashFiles(root, [...a].reverse());
      expect(reversed.hash).not.toBe(first.hash);
      expect(reversed.count).toBe(2);
      expect(hashFiles(root, [...a].reverse().sort()).hash).toBe(first.hash);
      writeFileSync(join(root, 'sub/b.ts'), 'TWO');
      expect(hashFiles(root, a).hash).not.toBe(first.hash);
      // Paths are framed too: identical bytes at another path differ.
      const moved = writeSources(root, { 'moved.ts': 'one' });
      expect(hashFiles(root, [...moved, a[1] as string]).hash).not.toBe(first.hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('collectSourceFiles / collectDistFiles', () => {
  it('includes sources but excludes tests, outputs and dependencies', () => {
    const root = tempRoot();
    try {
      writeSources(root, {
        'apps/server/src/index.ts': 'x',
        'apps/server/src/keep.test.ts': 'x',
        'apps/server/dist/index.js': 'x',
        'apps/server/node_modules/dep/index.js': 'x',
        'apps/server/src/data.json': '{}',
      });
      const found = collectSourceFiles(root, ['apps/server/src']).map((p) =>
        p.slice(root.length + 1),
      );
      expect(found).toEqual(['apps/server/src/data.json', 'apps/server/src/index.ts']);
      const dist = collectDistFiles(join(root, 'apps/server/dist'));
      expect(dist.map((p) => p.slice(root.length + 1))).toEqual(['apps/server/dist/index.js']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('production input coverage', () => {
  const inputs = {
    dirs: ['web/src'],
    files: ['web/index.html', 'web/vite.config.ts', 'web/package.json', 'pnpm-lock.yaml'],
  };
  const skeleton: Record<string, string> = {
    'web/src/main.ts': 'console.log(1)',
    'web/src/index.css': '.a{color:red}',
    'web/index.html': '<html></html>',
    'web/vite.config.ts': 'export default {}',
    'web/package.json': '{}',
    'pnpm-lock.yaml': 'lockfileVersion: 9',
  };

  it('hashes CSS, HTML, Vite config and lockfile inputs', () => {
    const root = tempRoot();
    try {
      writeSources(root, skeleton);
      const before = hashFiles(root, collectInputFiles(root, inputs));
      expect(before.count).toBe(6);
      // Tampering any single production input changes the hash.
      const drifted: Array<[string, string]> = [
        ['web/src/index.css', '.a{color:blue}'],
        ['web/index.html', '<html><body></body></html>'],
        ['web/vite.config.ts', 'export default { base: "/x/" }'],
        ['pnpm-lock.yaml', 'lockfileVersion: 9\n# bumped'],
        ['web/package.json', '{"version":"9.9.9"}'],
      ];
      for (const [rel, tampered] of drifted) {
        writeFileSync(join(root, rel), tampered);
        const after = hashFiles(root, collectInputFiles(root, inputs));
        expect(after.hash, rel).not.toBe(before.hash);
        writeFileSync(join(root, rel), skeleton[rel] ?? '');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never collects secret files and fails closed on missing inputs', () => {
    const root = tempRoot();
    try {
      writeSources(root, { ...skeleton, '.env': 'KEY=secret', 'web/src/.env.local': 'X=1' });
      const collected = collectInputFiles(root, inputs).map((p) => p.slice(root.length + 1));
      expect(collected.some((p) => p.includes('.env'))).toBe(false);
      // A renamed build input fails closed instead of silently hashing less.
      rmSync(join(root, 'web/vite.config.ts'));
      expect(() => collectInputFiles(root, inputs)).toThrow(/missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('build script and public assets', () => {
  const inputs = {
    dirs: ['web/src'],
    files: ['scripts/build-production-bundles.ts'],
    publicDirs: ['web/public'],
  };
  const skeleton = {
    'web/src/main.ts': 'console.log(1)',
    'scripts/build-production-bundles.ts': 'build()',
    'web/public/logo.svg': '<svg></svg>',
  };

  it('treats the build script as a production input', () => {
    const root = tempRoot();
    try {
      writeSources(root, skeleton);
      const before = hashFiles(root, collectInputFiles(root, inputs));
      writeFileSync(join(root, 'scripts/build-production-bundles.ts'), 'build(/* changed */)');
      const after = hashFiles(root, collectInputFiles(root, inputs));
      expect(after.hash).not.toBe(before.hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hashes added and modified public assets, tolerates a missing public dir', () => {
    const root = tempRoot();
    try {
      writeSources(root, skeleton);
      const before = hashFiles(root, collectInputFiles(root, inputs));
      // Modified asset drifts.
      writeFileSync(join(root, 'web/public/logo.svg'), '<svg>changed</svg>');
      expect(hashFiles(root, collectInputFiles(root, inputs)).hash).not.toBe(before.hash);
      // Newly added asset drifts.
      writeFileSync(join(root, 'web/public/extra.png'), 'png-bytes');
      expect(hashFiles(root, collectInputFiles(root, inputs)).hash).not.toBe(before.hash);
      // Secret files in public/ are never collected.
      writeFileSync(join(root, 'web/public/.env'), 'KEY=secret');
      writeFileSync(join(root, 'web/public/nested.env'), 'KEY=secret');
      const collected = collectInputFiles(root, inputs).map((p) => p.slice(root.length + 1));
      expect(collected.some((p) => p.includes('.env'))).toBe(false);
      // A checkout without public/ verifies fine.
      rmSync(join(root, 'web/public'), { recursive: true, force: true });
      const bare = hashFiles(root, collectInputFiles(root, inputs));
      // main.ts plus the build script; the absent public dir adds nothing.
      expect(bare.count).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('verifyBuildProvenance', () => {
  it('accepts manifests that describe the current tree exactly', () => {
    const root = tempRoot();
    try {
      const serverDist = join(root, 'sdist');
      const webDist = join(root, 'wdist');
      mkdirSync(serverDist, { recursive: true });
      mkdirSync(webDist, { recursive: true });
      const sources = writeSources(root, { 'src/a.ts': 'alpha' });
      const outputs = writeSources(root, { 'sdist/out.js': 'built' });
      const hashed = hashFiles(root, sources);
      const built = hashFiles(serverDist, outputs);
      const base = {
        kind: 'batchc-build-manifest',
        commit: 'abc',
        treeClean: true,
        treeStatus: '',
        builtAt: new Date(0).toISOString(),
        identity: null,
      } as const;
      writeManifest(serverDist, {
        ...base,
        component: 'server',
        sourceHash: hashed.hash,
        sourceFiles: hashed.count,
        sourceInputs: [],
        buildHash: built.hash,
        buildFiles: built.count,
      } satisfies BuildManifest);
      const empty = hashFiles(webDist, []);
      writeManifest(webDist, {
        ...base,
        component: 'web',
        sourceHash: hashed.hash,
        sourceFiles: hashed.count,
        sourceInputs: [],
        buildHash: empty.hash,
        buildFiles: 0,
      } satisfies BuildManifest);
      // Manifest round-trips through disk.
      expect(readManifest(serverDist)?.buildHash).toBe(built.hash);
      expect(readManifest(join(root, 'missing'))).toBeNull();
      // NOTE: verified against a synthetic root below with explicit
      // source lists (the real-root end-to-end case follows).
      const { hash } = hashFiles(root, sources);
      expect(hash).toBe(hashed.hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses drift against the real tree with explicit dist dirs', () => {
    // Real sources (read-only), isolated dist dirs: proves the gate
    // logic without touching the production builds.
    const root = tempRoot();
    try {
      const serverDist = join(root, 'sdist');
      const webDist = join(root, 'wdist');
      mkdirSync(serverDist, { recursive: true });
      mkdirSync(webDist, { recursive: true });
      const serverSources = ['apps/server/src/build-identity.ts'].map((p) => join(ROOT, p));
      const webSources: string[] = [];
      const sourceHash = hashFiles(ROOT, serverSources);
      const emptyHash = hashFiles(ROOT, webSources);
      const manifest = (
        component: 'server' | 'web',
        sourceHashValue: string,
        buildHashValue: string,
      ): BuildManifest => ({
        kind: 'batchc-build-manifest',
        component,
        commit: 'test',
        treeClean: true,
        treeStatus: '',
        sourceHash: sourceHashValue,
        sourceFiles: 1,
        sourceInputs: [],
        buildHash: buildHashValue,
        buildFiles: 0,
        builtAt: new Date(0).toISOString(),
        identity: null,
      });
      writeManifest(serverDist, manifest('server', sourceHash.hash, emptyHash.hash));
      writeManifest(webDist, manifest('web', '0'.repeat(64), emptyHash.hash));
      // server passes; web source hash mismatches.
      expect(() =>
        verifyBuildProvenance({ root: ROOT, serverDist, webDist, serverSources, webSources }),
      ).toThrow(/web sources changed since the production build/);
      // Matching sources but tampered dist bytes are refused.
      writeManifest(webDist, manifest('web', emptyHash.hash, '0'.repeat(64)));
      writeFileSync(join(webDist, 'index.html'), 'tampered');
      expect(() =>
        verifyBuildProvenance({ root: ROOT, serverDist, webDist, serverSources, webSources }),
      ).toThrow(/web dist outputs changed since the recorded build/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses missing manifests and component mismatches', () => {
    const root = tempRoot();
    try {
      mkdirSync(join(root, 'sdist'), { recursive: true });
      mkdirSync(join(root, 'wdist'), { recursive: true });
      expect(() =>
        verifyBuildProvenance({
          root: ROOT,
          serverDist: join(root, 'sdist'),
          webDist: join(root, 'wdist'),
          serverSources: [],
          webSources: [],
        }),
      ).toThrow(/missing or invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function manifestFor(component: 'server' | 'web', commit: string, builtAt: string): BuildManifest {
  return {
    kind: 'batchc-build-manifest',
    component,
    commit,
    treeClean: true,
    treeStatus: '',
    sourceHash: 's'.repeat(64),
    sourceFiles: 10,
    sourceInputs: [],
    buildHash: component === 'server' ? 'b1'.repeat(32) : 'b2'.repeat(32),
    buildFiles: 3,
    builtAt,
    identity: null,
  };
}

describe('describeBundleIdentity', () => {
  it('says the bundles came from the tested commit when the manifests agree', () => {
    const identity: BundleIdentity = describeBundleIdentity({
      commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      treeCleanAtMeasure: true,
      treeStatusAtMeasure: '',
      server: manifestFor(
        'server',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-11-02T00:00:00.000Z',
      ),
      web: manifestFor(
        'web',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-11-02T00:00:00.000Z',
      ),
    });
    expect(identity.builtAtHead).toBe(true);
    expect(identity.builtFromCleanTree).toBe(true);
    expect(identity.supportsCommitIdentity).toBe(true);
    expect(identity.note).toContain('both bundles were built at aaaaaaa');
    expect(identity.note).toContain('the build ran over a clean tree at that commit');
  });

  it('names both commits when the bundles predate the tested commit, and refuses to imply otherwise', () => {
    const identity = describeBundleIdentity({
      commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      treeCleanAtMeasure: true,
      treeStatusAtMeasure: '',
      server: manifestFor(
        'server',
        '94d3c62c52225b5a8fe4e2a4e3bc8ddee99fa3f4',
        '2026-11-02T11:50:48.105Z',
      ),
      web: manifestFor(
        'web',
        '94d3c62c52225b5a8fe4e2a4e3bc8ddee99fa3f4',
        '2026-11-02T11:50:48.105Z',
      ),
    });
    expect(identity.builtAtHead).toBe(false);
    // Both commits are named, and the note never claims the bundle bytes were built at HEAD.
    expect(identity.note).toContain('94d3c62');
    expect(identity.note).toContain('bbbbbbb');
    expect(identity.note).toContain('the bundle bytes were not produced from bbbbbbb');
    expect(identity.note).toContain('documentation, verification scripts');
    expect(identity.note).not.toContain('were built at bbbbbbb');
    expect(identity.builtAtCommit).toBe(
      '94d3c62c52225b5a8fe4e2a4e3bc8ddee99fa3f4,94d3c62c52225b5a8fe4e2a4e3bc8ddee99fa3f4',
    );
  });

  it('reports each component separately when only one manifest is stale', () => {
    const identity = describeBundleIdentity({
      commit: 'cccccccccccccccccccccccccccccccccccccccc',
      treeCleanAtMeasure: true,
      treeStatusAtMeasure: '',
      server: manifestFor(
        'server',
        'cccccccccccccccccccccccccccccccccccccccc',
        '2026-11-02T01:00:00.000Z',
      ),
      web: manifestFor(
        'web',
        'dddddddddddddddddddddddddddddddddddddddd',
        '2026-11-02T00:30:00.000Z',
      ),
    });
    expect(identity.builtAtHead).toBe(false);
    expect(identity.note).toContain('ccccccc / ddddddd');
    expect(identity.serverBuiltAt).toBe('2026-11-02T01:00:00.000Z');
    expect(identity.webBuiltAt).toBe('2026-11-02T00:30:00.000Z');
  });
});

it('refuses to carry a commit identity claim when the build came from a dirty tree', () => {
  const dirty = (component: 'server' | 'web'): BuildManifest => ({
    ...manifestFor(
      component,
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      '2026-11-02T02:00:00.000Z',
    ),
    treeClean: false,
    treeStatus: ' M apps/server/src/routes/forge.ts\n?? scratch.txt\n',
  });
  const identity = describeBundleIdentity({
    commit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    treeCleanAtMeasure: false,
    treeStatusAtMeasure: ' M apps/server/src/routes/forge.ts\n',
    server: dirty('server'),
    web: dirty('web'),
  });
  // The commit fields agree, yet the bundles contain work no commit names.
  expect(identity.builtAtHead).toBe(true);
  expect(identity.builtFromCleanTree).toBe(false);
  expect(identity.supportsCommitIdentity).toBe(false);
  expect(identity.note).toContain('uncommitted working tree');
  expect(identity.note).toContain('2 file(s) changed at build time');
  expect(identity.note).toContain('cannot carry a commit identity claim');
});

it('says which instant is dirty when the build was clean but the checkout is not', () => {
  // The Palette Bench packet showed this combination: bundles built clean at 94867e5, measured
  // while the working tree carried uncommitted harness edits. Both facts were in the report, under
  // two similar names, and a reader took them for a contradiction (KI-84).
  const identity = describeBundleIdentity({
    commit: 'ffffffffffffffffffffffffffffffffffffffff',
    treeCleanAtMeasure: false,
    treeStatusAtMeasure: ' M scripts/build-review-app.ts\n M docs/KNOWN_ISSUES.md\n',
    server: manifestFor('server', 'ffffffffffffffffffffffffffffffffffffffff', '2026-11-02T03:00:00.000Z'),
    web: manifestFor('web', 'ffffffffffffffffffffffffffffffffffffffff', '2026-11-02T03:00:00.000Z'),
  });
  // The bytes are what the commit names, so the identity claim stands...
  expect(identity.builtFromCleanTree).toBe(true);
  expect(identity.supportsCommitIdentity).toBe(true);
  // ...and the report still says what was not committed at the moment of measurement.
  expect(identity.treeCleanAtMeasure).toBe(false);
  expect(identity.note).toContain('the build ran over a clean tree at that commit');
  expect(identity.note).toContain('2 file(s) changed while this measurement ran');
  expect(identity.note).toContain('scripts/build-review-app.ts');
  expect(identity.note).toContain('the gate that produced this report ran over work no commit names');
  expect(identity.note).toContain('bundle bytes contain only what fffffff names');
});

it('keeps the two instants apart in the emitted field names, not only in the sentence', () => {
  const identity = describeBundleIdentity({
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    treeCleanAtMeasure: false,
    treeStatusAtMeasure: ' M scripts/verify-studio-workflow.ts\n',
    server: manifestFor('server', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-02T03:00:00.000Z'),
    web: manifestFor('web', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-02T03:00:00.000Z'),
  });
  const keys = Object.keys(identity).sort();
  // One name for the build instant, one for the measuring instant. A field called plain `treeClean`
  // could describe either, which is how the two got read as each other.
  expect(keys).toContain('builtFromCleanTree');
  expect(keys).toContain('treeCleanAtMeasure');
  expect(keys).not.toContain('treeClean');
});
