/**
 * Build provenance for the Batch C acceptance harness.
 *
 * Content hashes — never timestamps or bundle keyword searches — bind
 * the production builds under test to the exact source tree they were
 * built from. `verifyBuildProvenance` fails closed (throws) when the
 * manifest is missing, the current sources differ from the recorded
 * source hash, or the dist outputs differ from the recorded build hash.
 * It performs only local filesystem reads and hashes: no network, no
 * provider dispatch is possible through this module.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface BuildManifest {
  kind: 'batchc-build-manifest';
  component: 'server' | 'web';
  /** Source commit the build was made from (`unknown` outside git). */
  commit: string;
  /** False when the working tree had uncommitted changes at build time. */
  treeClean: boolean;
  /** Bounded `git status --porcelain` output at build time. */
  treeStatus: string;
  /** Hex sha256 over the sorted source inputs. */
  sourceHash: string;
  sourceFiles: number;
  /** Hex sha256 over the sorted dist outputs (manifest excluded). */
  buildHash: string;
  buildFiles: number;
  builtAt: string;
  /** Identity baked into the bundle (server only; null when unbaked). */
  identity: { commit: string; source_hash: string; built_at: string } | null;
}

export interface ProvenanceReport {
  commit: string;
  treeClean: boolean;
  treeStatus: string;
  server: BuildManifest;
  web: BuildManifest;
}

const MANIFEST_NAME = '.build-manifest.json';
const MAX_TREE_STATUS_CHARS = 2_000;

function listFiles(root: string, include: (relativePath: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && include(relative(root, full).split(sep).join('/'))) {
        found.push(full);
      }
    }
  };
  walk(root);
  found.sort();
  return found;
}

function isSourceFile(relativePath: string): boolean {
  if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test-d.ts')) return false;
  return (
    relativePath.endsWith('.ts') ||
    relativePath.endsWith('.tsx') ||
    relativePath.endsWith('.mts') ||
    relativePath.endsWith('.cts') ||
    relativePath.endsWith('.json')
  );
}

/** Hex sha256 over sorted `path + NUL + bytes + NUL` frames. */
export function hashFiles(root: string, files: string[]): { hash: string; count: number } {
  const hash = createHash('sha256');
  for (const full of files) {
    const rel = relative(root, full).split(sep).join('/');
    hash.update(rel, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(readFileSync(full));
    hash.update('\0', 'utf8');
  }
  return { hash: hash.digest('hex'), count: files.length };
}

/** Source inputs that feed a production bundle (tests and outputs excluded). */
export function collectSourceFiles(root: string, dirs: string[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    found.push(...listFiles(join(root, dir), isSourceFile));
  }
  found.sort();
  return found;
}

/** Dist outputs that the harness serves (the manifest itself excluded). */
export function collectDistFiles(distDir: string): string[] {
  return listFiles(distDir, (rel) => rel !== MANIFEST_NAME && !rel.endsWith(`/${MANIFEST_NAME}`));
}

function gitInfo(root: string): { commit: string; treeClean: boolean; treeStatus: string } {
  let commit = 'unknown';
  let status = '';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('build provenance requires a git checkout (rev-parse HEAD failed)');
  }
  try {
    status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1_048_576,
    });
  } catch {
    throw new Error('build provenance requires git status to succeed');
  }
  return {
    commit,
    treeClean: status.trim().length === 0,
    treeStatus: status.slice(0, MAX_TREE_STATUS_CHARS),
  };
}

export function manifestPath(distDir: string): string {
  return join(distDir, MANIFEST_NAME);
}

export function readManifest(distDir: string): BuildManifest | null {
  let raw: string;
  try {
    raw = readFileSync(manifestPath(distDir), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind !== 'batchc-build-manifest' || typeof record.sourceHash !== 'string') {
      return null;
    }
    return parsed as BuildManifest;
  } catch {
    return null;
  }
}

export function writeManifest(distDir: string, manifest: BuildManifest): void {
  writeFileSync(manifestPath(distDir), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Server bundle inputs: app sources plus every aliased package. */
export const SERVER_SOURCE_DIRS = [
  'apps/server/src',
  'packages/shared/src',
  'packages/memory-engine/src',
  'packages/muse-provider/src',
  'packages/agent-core/src',
  'packages/tool-runtime/src',
  'packages/ui-protocol/src',
  'packages/decision-guard/src',
];

/** Web bundle inputs: app sources plus every vite-aliased package. */
export const WEB_SOURCE_DIRS = ['apps/web/src', 'packages/shared/src', 'packages/ui-protocol/src'];

function failProvenance(message: string): never {
  throw new Error(
    `${message} — rebuild both production bundles with scripts/build-production-bundles.ts`,
  );
}

/**
 * Fail-closed freshness gate: the recorded manifest must describe the
 * current tree exactly — same source content, same dist bytes. Any
 * drift (edited source, rebuilt-by-hand dist, missing manifest) throws
 * before the harness starts servers, browsers, or provider calls.
 */
export function verifyBuildProvenance(options: {
  root: string;
  serverDist?: string;
  webDist?: string;
  serverSources?: string[];
  webSources?: string[];
}): ProvenanceReport {
  const {
    root,
    serverDist = join(root, 'apps/server/dist'),
    webDist = join(root, 'apps/web/dist'),
  } = options;
  const check = (
    component: 'server' | 'web',
    distDir: string,
    sourceFiles: string[],
  ): BuildManifest => {
    const manifest = readManifest(distDir);
    if (manifest === null || manifest.component !== component) {
      failProvenance(
        `${component} build manifest is missing or invalid at ${manifestPath(distDir)}`,
      );
    }
    const current = hashFiles(root, sourceFiles);
    if (current.hash !== manifest.sourceHash) {
      failProvenance(
        `${component} sources changed since the production build ` +
          `(recorded ${manifest.sourceHash.slice(0, 12)} over ${manifest.sourceFiles} files, ` +
          `current ${current.hash.slice(0, 12)} over ${current.count} files)`,
      );
    }
    let distFiles: string[];
    try {
      distFiles = collectDistFiles(distDir);
    } catch {
      failProvenance(`${component} dist directory is unreadable at ${distDir}`);
    }
    const built = hashFiles(distDir, distFiles);
    if (built.hash !== manifest.buildHash) {
      failProvenance(
        `${component} dist outputs changed since the recorded build ` +
          `(recorded ${manifest.buildHash.slice(0, 12)}, current ${built.hash.slice(0, 12)})`,
      );
    }
    return manifest;
  };
  const serverSources = options.serverSources ?? collectSourceFiles(root, SERVER_SOURCE_DIRS);
  const webSources = options.webSources ?? collectSourceFiles(root, WEB_SOURCE_DIRS);
  const server = check('server', serverDist, serverSources);
  const web = check('web', webDist, webSources);
  const info = gitInfo(root);
  return {
    commit: info.commit,
    treeClean: info.treeClean,
    treeStatus: info.treeStatus,
    server,
    web,
  };
}

/** Describe the current tree for a fresh manifest (no verification). */
export function describeCurrentTree(root: string): {
  commit: string;
  treeClean: boolean;
  treeStatus: string;
} {
  return gitInfo(root);
}
