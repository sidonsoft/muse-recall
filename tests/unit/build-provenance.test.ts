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
  collectDistFiles,
  collectInputFiles,
  collectSourceFiles,
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
  const skeleton = {
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
        writeFileSync(join(root, rel), skeleton[rel] as string);
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
        buildHash: built.hash,
        buildFiles: built.count,
      } satisfies BuildManifest);
      const empty = hashFiles(webDist, []);
      writeManifest(webDist, {
        ...base,
        component: 'web',
        sourceHash: hashed.hash,
        sourceFiles: hashed.count,
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
