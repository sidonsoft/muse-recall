import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { FORGE_PROJECT_ID_PATTERN } from '@mml/shared';
import type { ForgeWorkspace } from '../forge/workspace.js';
import { MediaAssetStore } from './assets.js';

/**
 * Batch B — complete media backup and restore.
 *
 * A media bundle mirrors the media-owned parts of a Forge workspace:
 *
 *   <bundle>/manifest.json
 *   <bundle>/forge/<project>/media/<asset>/<version>.bin|.json|asset.json
 *   <bundle>/forge/<project>/media-jobs/<job>.json
 *
 * Nothing is copied before the SOURCE store re-hashes every version (drifted
 * bytes are refused, not backed up as if healthy), and nothing is restored
 * before every bundle file re-matches the manifest hash. Restore copies to a
 * temp directory beside each target subtree, re-verifies the copy, parks the
 * existing subtree, swaps atomically, and undoes earlier subtrees if a later
 * one fails. Only `media` and `media-jobs` are touched; approved HTML versions
 * and state.json are never overwritten by a media restore.
 */

export const MEDIA_BACKUP_MANIFEST_VERSION = 1;

export interface MediaBackupFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface MediaBackupManifest {
  version: typeof MEDIA_BACKUP_MANIFEST_VERSION;
  created_at: string;
  projects: string[];
  files: MediaBackupFile[];
  totals: { files: number; bytes: number };
}

export interface MediaBackupSummary extends MediaBackupManifest {
  source: string;
  destination: string;
}

export interface MediaRestoreSummary {
  source: string;
  target: string;
  projects: string[];
  files: number;
  bytes: number;
  /**
   * Non-fatal problems after every subtree was committed, currently only a
   * parked original that could not be deleted. Restoration itself succeeded.
   */
  warnings: string[];
}

/**
 * Filesystem seam for restore tests, so a failure can be injected at each
 * step (partial copy, park, swap) without mocking `node:fs` wholesale.
 */
export interface MediaRestoreFs {
  cpSync?: typeof cpSync;
  renameSync?: typeof renameSync;
  rmSync?: typeof rmSync;
  mkdirSync?: typeof mkdirSync;
}

const FILE_PATH = /^forge\/([a-z0-9][a-z0-9-]{1,63})\/(media|media-jobs)(\/[A-Za-z0-9._-]+)*$/;

function timestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-');
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Media backup refused: ${path} is a symlink.`);
      }
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        out.push(path);
      } else {
        throw new Error(`Media backup refused: ${path} is not a regular file.`);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

function projectDirs(workspace: ForgeWorkspace): string[] {
  const dir = workspace.getRoot();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && FORGE_PROJECT_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function inside(base: string, path: string): void {
  const rel = relative(base, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes the bundle: ${path}`);
  }
}

function templateManifest(files: MediaBackupFile[], projects: string[]): MediaBackupManifest {
  return {
    version: MEDIA_BACKUP_MANIFEST_VERSION,
    created_at: new Date().toISOString(),
    projects,
    files,
    totals: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
    },
  };
}

export async function backupMedia(
  workspace: ForgeWorkspace,
  destination: string,
  options: { now?: Date } = {},
): Promise<MediaBackupSummary> {
  const target = resolve(destination);
  if (existsSync(target)) {
    throw new Error(`Media backup destination already exists: ${target}`);
  }
  const sourceRoot = workspace.getRoot();
  const store = new MediaAssetStore(workspace);
  const projects = projectDirs(workspace);
  const tag = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const temp = `${target}.tmp-${tag}`;
  const files: MediaBackupFile[] = [];
  try {
    mkdirSync(temp, { mode: 0o700, recursive: true });
    for (const project of projects) {
      const verified = await store.verifyProjectMedia(project);
      if (!verified.ok) {
        throw new Error(
          `Media backup refused: project ${project} has ${verified.mismatches.length} corrupt version(s): ` +
            verified.mismatches
              .map((mismatch) => `v${String(mismatch.version)} (${mismatch.reason})`)
              .join('; '),
        );
      }
      for (const sub of ['media', 'media-jobs'] as const) {
        const from = join(sourceRoot, project, sub);
        if (!existsSync(from)) continue;
        const to = join(temp, 'forge', project, sub);
        mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
        cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
        for (const path of listFiles(to)) {
          const bytes = statSync(path).size;
          files.push({
            path: `forge/${project}/${sub}${path.slice(to.length).replaceAll(sep, '/')}`,
            bytes,
            sha256: hashFile(path),
          });
        }
      }
    }
    const manifest = {
      ...templateManifest(files, projects),
      created_at: (options.now ?? new Date()).toISOString(),
    };
    writeFileSync(join(temp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    // Re-hash the bundle exactly as it will be read; a copy that drifted is
    // never published as a valid backup.
    verifyBundle(temp, manifest);
    renameSync(temp, target);
    return { ...manifest, source: sourceRoot, destination: target };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function verifyBundle(root: string, manifest: MediaBackupManifest): void {
  if (manifest.version !== MEDIA_BACKUP_MANIFEST_VERSION) {
    throw new Error(`Unsupported media backup version: ${String(manifest.version)}`);
  }
  for (const file of manifest.files) {
    const match = FILE_PATH.exec(file.path);
    if (!match) throw new Error(`Media backup manifest contains an invalid path: ${file.path}`);
    const path = resolve(root, file.path);
    inside(root, path);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Media backup is missing ${file.path}.`);
    }
    if (statSync(path).size !== file.bytes || hashFile(path) !== file.sha256) {
      throw new Error(`Media backup file no longer matches its manifest hash: ${file.path}`);
    }
  }
}

function readManifest(root: string): MediaBackupManifest {
  const raw = readFileSync(join(root, 'manifest.json'), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Media backup manifest is not valid JSON.');
  }
  const manifest = parsed as MediaBackupManifest;
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.projects)
  ) {
    throw new Error('Media backup manifest is not a recognisable bundle.');
  }
  return manifest;
}

interface Subtree {
  project: string;
  sub: 'media' | 'media-jobs';
}

export async function restoreMedia(
  bundle: string,
  workspace: ForgeWorkspace,
  options: { force?: boolean; fs?: MediaRestoreFs } = {},
): Promise<MediaRestoreSummary> {
  const source = resolve(bundle);
  if (!existsSync(join(source, 'manifest.json'))) {
    throw new Error(`Media backup not found: ${source}`);
  }
  const manifest = readManifest(source);
  verifyBundle(source, manifest);

  const subtrees: Subtree[] = [];
  const seen = new Set<string>();
  for (const file of manifest.files) {
    const match = FILE_PATH.exec(file.path);
    if (!match || match[1] === undefined || match[2] === undefined) {
      throw new Error(`Media backup manifest contains an invalid path: ${file.path}`);
    }
    const key = `${match[1]}/${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    subtrees.push({ project: match[1], sub: match[2] as Subtree['sub'] });
  }

  const targetForge = workspace.getRoot();
  for (const subtree of subtrees) {
    const target = join(targetForge, subtree.project, subtree.sub);
    if (existsSync(target) && options.force !== true) {
      throw new Error(
        `Media restore target already exists: ${target}. Restore into an isolated workspace, or pass force to replace the media subtrees.`,
      );
    }
  }

  const tag = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const cp = options.fs?.cpSync ?? cpSync;
  const move = options.fs?.renameSync ?? renameSync;
  const remove = options.fs?.rmSync ?? rmSync;
  const makeDir = options.fs?.mkdirSync ?? mkdirSync;
  // Committed swaps, newest last. A parked original is deleted only after ALL
  // swaps commit (see below); until then every entry here can be rolled back.
  const done: Array<{ target: string; parked: string | null }> = [];
  const createdDirs: string[] = [];
  // The in-progress subtree. It is tracked BEFORE the first filesystem move
  // so a failure at any stage — partial copy, park, or swap — undoes this
  // subtree as well as the earlier committed ones. `parked` is null until the
  // original has been moved aside; while it is null the target still holds
  // the user's bytes and rollback must not touch it.
  let current: { target: string; parked: string | null; temp: string } | null = null;
  const recoveryProblems: string[] = [];
  const undoEntry = (entry: { target: string; parked: string | null }): void => {
    let removed = true;
    try {
      remove(entry.target, { recursive: true, force: true });
    } catch {
      // The target may never have been created; the parked restore below is
      // what matters. A failure there is recorded with its recovery path.
      removed = false;
    }
    if (entry.parked !== null && !existsSync(entry.target)) {
      try {
        move(entry.parked, entry.target);
      } catch {
        recoveryProblems.push(
          `could not restore the parked original for ${entry.target}; recover it manually from ${entry.parked}`,
        );
      }
    } else if (entry.parked !== null && existsSync(entry.target) && !removed) {
      recoveryProblems.push(
        `could not remove the failed restore at ${entry.target}; the parked original remains at ${entry.parked}`,
      );
    }
  };
  const undo = (): void => {
    // Undo the failed in-progress swap first: its target path is the one the
    // caller is most likely to inspect, and its temp copy must not leak.
    if (current !== null) {
      try {
        remove(current.temp, { recursive: true, force: true });
      } catch {
        recoveryProblems.push(
          `could not remove the temporary restore copy at ${current.temp}; delete it manually`,
        );
      }
      if (current.parked !== null) {
        undoEntry({ target: current.target, parked: current.parked });
      }
      // When nothing was parked the target still holds the user's original
      // bytes (copy, hash, or park failed first); it is left untouched.
      current = null;
    }
    for (const entry of [...done].reverse()) undoEntry(entry);
    for (const dir of [...createdDirs].reverse()) {
      try {
        remove(dir, { recursive: true, force: true });
      } catch {
        recoveryProblems.push(`could not remove the created directory at ${dir}`);
      }
    }
  };

  try {
    for (const subtree of subtrees) {
      const from = join(source, 'forge', subtree.project, subtree.sub);
      const projectDir = join(targetForge, subtree.project);
      if (!existsSync(projectDir)) {
        makeDir(projectDir, { mode: 0o700, recursive: true });
        createdDirs.push(projectDir);
      }
      const target = join(projectDir, subtree.sub);
      const temp = join(projectDir, `.restore-media-${tag}-${subtree.sub}`);
      current = { target, parked: null, temp };
      cp(from, temp, { recursive: true, errorOnExist: true, force: false });
      // Re-hash the copy, not the source.
      const prefix = `forge/${subtree.project}/${subtree.sub}/`;
      for (const file of manifest.files) {
        if (!file.path.startsWith(prefix)) continue;
        const path = resolve(temp, file.path.slice(prefix.length));
        inside(temp, path);
        if (hashFile(path) !== file.sha256) {
          throw new Error(`Media restore copy failed its hash check: ${file.path}`);
        }
      }
      if (existsSync(target)) {
        const parked = join(projectDir, `.restore-previous-${tag}-${subtree.sub}`);
        move(target, parked);
        if (current !== null) current.parked = parked;
      }
      move(temp, target);
      done.push({ target, parked: current?.parked ?? null });
      current = null;
    }
  } catch (error) {
    undo();
    const detail = recoveryProblems.length > 0 ? ` ${recoveryProblems.join(' ')}` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}.${detail}`);
  }

  // Commit boundary: every subtree is in place, so rollback is no longer
  // attempted from here on. Parked originals are cleanup, not recovery
  // material — a cleanup failure is a warning, never a restore failure.
  const warnings: string[] = [];
  for (const entry of done) {
    if (entry.parked === null) continue;
    try {
      remove(entry.parked, { recursive: true, force: true });
    } catch {
      warnings.push(
        `Restored ${entry.target}, but its parked original could not be deleted: ${entry.parked}`,
      );
    }
  }
  return {
    source,
    target: targetForge,
    projects: manifest.projects,
    files: manifest.files.length,
    bytes: manifest.totals.bytes,
    warnings,
  };
}

/** Default bundle path beside the workspace root. */
export function defaultMediaBackupPath(workspace: ForgeWorkspace, now: Date = new Date()): string {
  return `${resolve(workspace.getRoot(), '..')}/media-backup-${timestamp(now)}`;
}
