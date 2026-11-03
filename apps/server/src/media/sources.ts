/**
 * Batch D — project-scoped, immutable audio/video source store.
 *
 * Sources are inputs, not embeddable app assets: they live outside the image
 * asset tree (`<project>/media-sources/<sourceId>/`) so the existing image
 * approval, placeholder resolution, embedding and rollback paths are
 * untouched. Each source is write-once:
 *
 *   <project>/media-sources/<sourceId>/source.bin    raw bytes, mode 0600
 *   <project>/media-sources/<sourceId>/source.json   immutable manifest
 *
 * Guarantees:
 * - format, container and duration are validated before anything is written;
 * - every read re-verifies sha256 and byte size against the manifest;
 * - reads refuse symlinks and paths outside the project workspace;
 * - a record can only be read from its own project (cross-project is absent,
 *   never served);
 * - failed writes leave no half-registered source.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  FORGE_PROJECT_ID_PATTERN,
  type MediaSourceKindName,
  type MediaSourceMime,
  type MediaSourceOriginName,
} from '@mml/shared';
import type { ForgeWorkspace } from '../forge/workspace.js';
import { inspectSourceBytes, MediaSourceError } from './source-format.js';

export { MediaSourceError } from './source-format.js';

export interface MediaSourceRecord {
  source_id: string;
  project_id: string;
  kind: MediaSourceKindName;
  mime: MediaSourceMime;
  duration_ms: number;
  byte_size: number;
  sha256: string;
  origin: MediaSourceOriginName;
  original_name: string | null;
  created_at: string;
}

export interface CreateSourceInput {
  mime: MediaSourceMime;
  bytes: Buffer | Uint8Array;
  origin?: MediaSourceOriginName;
  original_name?: string;
}

export interface MediaSourceManifestEntry {
  source_id: string;
  sha256: string;
  byte_size: number;
  bytes_path: string;
  manifest_path: string;
}

export interface MediaSourceVerifyResult {
  project_id: string;
  checked: number;
  ok: boolean;
  mismatches: { source_id: string; reason: string }[];
}

const SOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ORIGINAL_NAME = 120;

function assertProjectId(projectId: string): void {
  if (!FORGE_PROJECT_ID_PATTERN.test(projectId)) {
    throw new MediaSourceError('invalid_project_id', 'Invalid media source project id.');
  }
}

function assertSourceId(sourceId: string): void {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new MediaSourceError('invalid_source_id', 'Invalid media source id.');
  }
}

function within(base: string, ...parts: string[]): string {
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new MediaSourceError(
      'invalid_source',
      'Resolved source path escapes the project workspace.',
    );
  }
  return target;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is best-effort; the file sync above still holds.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeAtomic(dir: string, fileName: string, data: string | Buffer): Promise<void> {
  await ensurePrivateDir(dir);
  const target = within(dir, fileName);
  const temp = within(dir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600);
    await syncFile(temp);
    await rename(temp, target);
    await syncDirectory(dir);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (error instanceof MediaSourceError) throw error;
    throw new MediaSourceError(
      'persistence_failed',
      `Could not persist media source ${fileName}: ${(error as Error).message}`,
    );
  }
}

async function readContainedBuffer(projectDir: string, file: string): Promise<Buffer> {
  const stat = await lstat(file).catch(() => null);
  if (stat === null) {
    throw new MediaSourceError('source_not_found', 'Media source file does not exist.');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new MediaSourceError(
      'source_corrupt',
      'Refusing to read a symlink or non-regular media source file.',
    );
  }
  const [realFile, realProject] = await Promise.all([realpath(file), realpath(projectDir)]);
  if (!realFile.startsWith(realProject + sep)) {
    throw new MediaSourceError('invalid_source', 'Resolved media source file escapes the project.');
  }
  return readFile(file);
}

function cleanOriginalName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new MediaSourceError('invalid_source', 'original_name must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_ORIGINAL_NAME);
}

function validateRecord(raw: unknown, projectId: string, sourceId: string): MediaSourceRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MediaSourceError(
      'source_corrupt',
      `Media source ${sourceId} has a malformed manifest.`,
    );
  }
  const record = raw as Partial<MediaSourceRecord>;
  if (
    record.source_id !== sourceId ||
    record.project_id !== projectId ||
    (record.kind !== 'audio' && record.kind !== 'video') ||
    (record.mime !== 'audio/wav' && record.mime !== 'video/mp4') ||
    !Number.isSafeInteger(record.duration_ms) ||
    (record.duration_ms as number) < 1 ||
    !Number.isSafeInteger(record.byte_size) ||
    (record.byte_size as number) < 1 ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    (record.origin !== 'upload' && record.origin !== 'recording') ||
    (record.original_name !== null && typeof record.original_name !== 'string') ||
    typeof record.created_at !== 'string'
  ) {
    throw new MediaSourceError(
      'source_corrupt',
      `Media source ${sourceId} has a malformed manifest.`,
    );
  }
  return record as MediaSourceRecord;
}

export class MediaSourceStore {
  constructor(private readonly workspace: ForgeWorkspace) {}

  private sourcesDir(projectId: string): string {
    assertProjectId(projectId);
    return within(this.workspace.projectDir(projectId), 'media-sources');
  }

  private sourceDir(projectId: string, sourceId: string): string {
    assertSourceId(sourceId);
    return within(this.sourcesDir(projectId), sourceId);
  }

  private bytesFile(projectId: string, sourceId: string): string {
    return within(this.sourceDir(projectId, sourceId), 'source.bin');
  }

  private manifestFile(projectId: string, sourceId: string): string {
    return within(this.sourceDir(projectId, sourceId), 'source.json');
  }

  async create(projectId: string, input: CreateSourceInput): Promise<MediaSourceRecord> {
    assertProjectId(projectId);
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    const inspected = inspectSourceBytes(bytes, input.mime);
    const sourceId = randomUUID();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const now = new Date().toISOString();
    const record: MediaSourceRecord = {
      source_id: sourceId,
      project_id: projectId,
      kind: inspected.kind,
      mime: inspected.mime,
      duration_ms: inspected.durationMs,
      byte_size: bytes.length,
      sha256,
      origin: input.origin ?? 'upload',
      original_name: cleanOriginalName(input.original_name),
      created_at: now,
    };
    const dir = this.sourceDir(projectId, sourceId);
    await ensurePrivateDir(dir);
    try {
      await writeAtomic(dir, 'source.bin', bytes);
      await writeAtomic(dir, 'source.json', `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return record;
  }

  async get(projectId: string, sourceId: string): Promise<MediaSourceRecord> {
    assertProjectId(projectId);
    assertSourceId(sourceId);
    let raw: string;
    try {
      raw = (
        await readContainedBuffer(
          this.workspace.projectDir(projectId),
          this.manifestFile(projectId, sourceId),
        )
      ).toString('utf8');
    } catch (error) {
      if (error instanceof MediaSourceError && error.code === 'source_corrupt') throw error;
      throw new MediaSourceError(
        'source_not_found',
        `Media source ${sourceId} does not exist in project ${projectId}.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new MediaSourceError('source_corrupt', `Media source ${sourceId} is not valid JSON.`);
    }
    return validateRecord(parsed, projectId, sourceId);
  }

  async list(projectId: string): Promise<MediaSourceRecord[]> {
    assertProjectId(projectId);
    let entries: string[];
    try {
      entries = await readdir(this.sourcesDir(projectId));
    } catch {
      return [];
    }
    const records: MediaSourceRecord[] = [];
    for (const name of entries.sort()) {
      if (name.startsWith('.') || !SOURCE_ID_PATTERN.test(name)) continue;
      try {
        records.push(await this.get(projectId, name));
      } catch {
        // Damaged sources are reported by verifyProjectSources, not hidden as valid.
      }
    }
    return records;
  }

  async readBytes(projectId: string, sourceId: string): Promise<Buffer> {
    const record = await this.get(projectId, sourceId);
    const bytes = await readContainedBuffer(
      this.workspace.projectDir(projectId),
      this.bytesFile(projectId, sourceId),
    );
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== record.sha256) {
      throw new MediaSourceError(
        'source_corrupt',
        `Media source ${sourceId} no longer matches its recorded hash.`,
      );
    }
    if (bytes.length !== record.byte_size) {
      throw new MediaSourceError(
        'source_corrupt',
        `Media source ${sourceId} no longer matches its recorded byte size.`,
      );
    }
    return bytes;
  }

  async collectManifest(projectId: string): Promise<MediaSourceManifestEntry[]> {
    assertProjectId(projectId);
    const entries: MediaSourceManifestEntry[] = [];
    for (const record of await this.list(projectId)) {
      entries.push({
        source_id: record.source_id,
        sha256: record.sha256,
        byte_size: record.byte_size,
        bytes_path: this.bytesFile(projectId, record.source_id),
        manifest_path: this.manifestFile(projectId, record.source_id),
      });
    }
    return entries;
  }

  async verifyProjectSources(projectId: string): Promise<MediaSourceVerifyResult> {
    assertProjectId(projectId);
    const mismatches: { source_id: string; reason: string }[] = [];
    let checked = 0;
    let entries: string[];
    try {
      entries = await readdir(this.sourcesDir(projectId));
    } catch {
      return { project_id: projectId, checked, ok: true, mismatches };
    }
    for (const name of entries) {
      if (name.startsWith('.') || !SOURCE_ID_PATTERN.test(name)) continue;
      checked += 1;
      try {
        await this.readBytes(projectId, name);
      } catch (error) {
        // Enumerate directories instead of list(): a malformed manifest must
        // fail verification rather than disappear from the result.
        mismatches.push({
          source_id: name,
          reason: error instanceof Error ? error.message : 'Unreadable media source.',
        });
      }
    }
    return { project_id: projectId, checked, ok: mismatches.length === 0, mismatches };
  }
}
