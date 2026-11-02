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
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  /** Repo-relative source inputs hashed, for audit. */
  sourceInputs: string[];
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

/**
 * The report's `commit` is the tested checkout, and the gate proves the bundles' hashed
 * inputs match it. That is not the same fact as which commit the bundles were built at:
 * documentation and verification-script commits move HEAD without moving anything the
 * production build hashes, so a gate can legitimately pass against bundles whose manifest
 * names an older commit. A run that hides that difference invites a reader to believe the
 * bundle bytes were produced from the newest commit. This names both.
 */
export interface BundleIdentity {
  testedCommit: string;
  builtAtCommit: string;
  builtAtHead: boolean;
  builtFromCleanTree: boolean;
  supportsCommitIdentity: boolean;
  serverBuiltAt: string;
  webBuiltAt: string;
  serverBuildHash: string;
  webBuildHash: string;
  note: string;
}

const shortCommit = (commit: string): string => commit.slice(0, 7);

export function describeBundleIdentity(report: ProvenanceReport): BundleIdentity {
  const built = [report.server.commit, report.web.commit];
  const atHead = built.every((commit) => commit === report.commit);
  // A manifest also records whether the working tree was clean when the build ran. A bundle
  // built from a dirty tree contains work that no commit names, so it cannot anchor a commit
  // identity claim even when the commit fields agree.
  const cleanBuild = report.server.treeClean && report.web.treeClean;
  const parts: string[] = [];
  if (atHead) {
    parts.push(`both bundles were built at ${shortCommit(report.commit)}`);
  } else {
    parts.push(
      `the bundles were built at ${built.map(shortCommit).join(' / ')} while the tested commit is ` +
        `${shortCommit(report.commit)}: the build gate accepted them because every file the production ` +
        `build hashes is identical between those commits, so the difference is confined to files it does ` +
        `not hash (documentation, verification scripts) — the bundle bytes were not produced from ${shortCommit(report.commit)}`,
    );
  }
  if (!cleanBuild) {
    const files = report.server.treeStatus
      .trim()
      .split('\n')
      .filter((line) => line !== '').length;
    parts.push(
      `the build recorded an uncommitted working tree (${String(files)} file(s) changed at build ` +
        `time), so these bundle bytes include work no commit names and cannot carry a commit identity claim`,
    );
  } else if (atHead) {
    parts.push('the build ran over a clean tree at that commit');
  }
  return {
    testedCommit: report.commit,
    builtAtCommit: atHead ? report.commit : built.join(','),
    builtAtHead: atHead,
    builtFromCleanTree: cleanBuild,
    supportsCommitIdentity: atHead && cleanBuild,
    serverBuiltAt: report.server.builtAt,
    webBuiltAt: report.web.builtAt,
    serverBuildHash: report.server.buildHash,
    webBuildHash: report.web.buildHash,
    note: parts.join('; '),
  };
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
  // Bundled/loaded sources plus web assets. Deliberately narrow: secret
  // files (.env), editor artifacts, and generated outputs never match.
  return (
    relativePath.endsWith('.ts') ||
    relativePath.endsWith('.tsx') ||
    relativePath.endsWith('.mts') ||
    relativePath.endsWith('.cts') ||
    relativePath.endsWith('.json') ||
    relativePath.endsWith('.css') ||
    relativePath.endsWith('.svg') ||
    relativePath.endsWith('.png') ||
    relativePath.endsWith('.ico') ||
    relativePath.endsWith('.webmanifest')
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

/**
 * Exact production inputs for one bundle: source directories plus the
 * individual build/dependency files that change what a fresh build
 * produces (entry HTML, bundler and compiler config, package manifests,
 * the lockfile). Paths are explicit so a renamed or moved input fails
 * closed (missing expected file) instead of silently dropping out of
 * the hash.
 *
 * Secrets are never inputs: no `.env*` file appears here and the
 * directory filter has no secret extension. Generated outputs (dist,
 * node_modules, .git) are skipped by the walker.
 */
export interface ComponentInputs {
  dirs: string[];
  files: string[];
  /**
   * Optional asset roots (e.g. Vite `public/`): hashed when present,
   * skipped when absent, so a future assets directory is covered
   * without failing checkouts that predate it. Secret files are
   * never collected (see `isPublicAsset`).
   */
  publicDirs?: string[];
}

/** Packages whose sources the server bundle aliases (never bundled externals). */
const SERVER_PACKAGES = [
  'packages/shared',
  'packages/memory-engine',
  'packages/muse-provider',
  'packages/agent-core',
  'packages/tool-runtime',
  'packages/ui-protocol',
  'packages/decision-guard',
];

const ROOT_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  // Declared dependency versions: the server bundle marks packages
  // external, so node_modules drift changes the running code without
  // touching the bundle hash. The lockfile closes that gap.
  'pnpm-lock.yaml',
  'tsconfig.base.json',
];

/**
 * Server production inputs: app sources, every aliased package source,
 * compiler/packaging manifests, the dependency/configuration files
 * that determine the built and running output, the build script
 * itself (it controls esbuild flags and the baked identity), and the
 * hashing library (it defines verification semantics) — editing any of
 * them must invalidate the hash even when sources are untouched).
 */
export const SERVER_INPUTS: ComponentInputs = {
  dirs: ['apps/server/src', ...SERVER_PACKAGES.map((pkg) => `${pkg}/src`)],
  files: [
    'apps/server/package.json',
    'apps/server/tsconfig.json',
    ...SERVER_PACKAGES.flatMap((pkg) => [`${pkg}/package.json`, `${pkg}/tsconfig.json`]),
    ...ROOT_FILES,
    'scripts/build-production-bundles.ts',
    'scripts/lib/build-provenance.ts',
  ],
};

/**
 * Web production inputs: app sources (including styles), the entry HTML,
 * bundler/compiler config, packaging manifests, the dependency tree,
 * the build script and hashing library (same rationale as server), and
 * the optional public asset root (hashed when present, skipped when
 * absent — Vite copies it verbatim into the production output).
 */
export const WEB_INPUTS: ComponentInputs = {
  dirs: ['apps/web/src', 'packages/shared/src', 'packages/ui-protocol/src'],
  files: [
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'apps/web/tsconfig.json',
    'apps/web/package.json',
    'packages/shared/package.json',
    'packages/shared/tsconfig.json',
    'packages/ui-protocol/package.json',
    'packages/ui-protocol/tsconfig.json',
    ...ROOT_FILES,
    'scripts/build-production-bundles.ts',
    'scripts/lib/build-provenance.ts',
  ],
  publicDirs: ['apps/web/public'],
};

/** All files of a component input set, sorted; missing files fail closed. */
export function collectInputFiles(root: string, inputs: ComponentInputs): string[] {
  const found = collectSourceFiles(root, inputs.dirs);
  for (const file of inputs.files) {
    const full = join(root, file);
    try {
      if (!statSync(full).isFile()) {
        throw new Error(`expected build input is not a file: ${file}`);
      }
    } catch (error) {
      throw new Error(
        `expected build input is missing: ${file} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    found.push(full);
  }
  for (const dir of inputs.publicDirs ?? []) {
    const full = join(root, dir);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    // Absent today (no public/ in the checkout) means nothing to hash;
    // present means every servable asset is hashed. Either way the rule
    // is explicit, not timestamped.
    if (isDir) {
      found.push(...listFiles(full, (rel) => isPublicAsset(`${dir}/${rel}`)));
    }
  }
  found.sort();
  return found;
}

/**
 * Public asset filter: everything a static host would serve, minus
 * anything secret. Dotfiles/dot-directories, `.env` files, and private
 * key material are never production inputs for provenance purposes.
 */
function isPublicAsset(relativePath: string): boolean {
  const segments = relativePath.split('/');
  if (segments.some((part) => part.startsWith('.'))) return false;
  const base = segments[segments.length - 1] ?? '';
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return false;
  if (/\.(pem|key|p12|pfx|kdbx)$/i.test(base)) return false;
  return true;
}

/** Repo-relative paths of an input set, for manifest audit trails. */
export function inputRelPaths(root: string, files: string[]): string[] {
  return files.map((full) => relative(root, full).split(sep).join('/'));
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
 * Explicit source lists (tests) bypass tree discovery; production
 * callers use the component input sets.
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
  const serverSources = options.serverSources ?? collectInputFiles(root, SERVER_INPUTS);
  const webSources = options.webSources ?? collectInputFiles(root, WEB_INPUTS);
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
