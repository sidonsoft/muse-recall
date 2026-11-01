import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { inspectSourceBytes, MediaSourceError } from '../../apps/server/src/media/source-format.js';
import { MediaSourceStore } from '../../apps/server/src/media/sources.js';
import { mp4Bytes, wavBytes } from '../helpers/media-fixtures.js';

const PROJECT = 'voice-video-test';
const OTHER = 'other-project';

const roots: string[] = [];
const stores: Array<{ store: MediaSourceStore; root: string }> = [];
afterEach(async () => {
  for (const entry of stores.splice(0)) {
    await rm(entry.root, { recursive: true, force: true });
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function store(): Promise<{
  store: MediaSourceStore;
  root: string;
  workspace: ForgeWorkspace;
}> {
  const root = await mkdtemp(join(tmpdir(), 'media-sources-'));
  roots.push(root);
  const workspace = new ForgeWorkspace(root);
  const instance = new MediaSourceStore(workspace);
  stores.push({ store: instance, root });
  return { store: instance, root, workspace };
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof MediaSourceError ? error.code : 'unexpected';
  }
}

describe('source format validation', () => {
  it('measures a mono 16-bit 24 kHz WAV from its data chunk', () => {
    const inspected = inspectSourceBytes(wavBytes({ durationMs: 1_500 }), 'audio/wav');
    expect(inspected).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationMs: 1_500 });
  });

  it('measures an MP4 from mvhd, not from the client', () => {
    const inspected = inspectSourceBytes(mp4Bytes({ durationMs: 12_000 }), 'video/mp4');
    expect(inspected).toMatchObject({ kind: 'video', mime: 'video/mp4', durationMs: 12_000 });
  });

  it('refuses non-contract WAV variants with actionable codes', () => {
    expect(codeOf(() => inspectSourceBytes(wavBytes({ channels: 2 }), 'audio/wav'))).toBe(
      'unsupported_format',
    );
    expect(codeOf(() => inspectSourceBytes(wavBytes({ bitsPerSample: 24 }), 'audio/wav'))).toBe(
      'unsupported_format',
    );
    expect(codeOf(() => inspectSourceBytes(wavBytes({ sampleRate: 8_000 }), 'audio/wav'))).toBe(
      'unsupported_format',
    );
    expect(codeOf(() => inspectSourceBytes(wavBytes({ audioFormat: 3 }), 'audio/wav'))).toBe(
      'unsupported_format',
    );
  });

  it('refuses product duration and container violations', () => {
    expect(codeOf(() => inspectSourceBytes(wavBytes({ durationMs: 180_001 }), 'audio/wav'))).toBe(
      'duration_exceeded',
    );
    expect(codeOf(() => inspectSourceBytes(mp4Bytes({ durationMs: 30_001 }), 'video/mp4'))).toBe(
      'duration_exceeded',
    );
    expect(codeOf(() => inspectSourceBytes(mp4Bytes({ zeroDuration: true }), 'video/mp4'))).toBe(
      'malformed_media',
    );
    expect(codeOf(() => inspectSourceBytes(mp4Bytes({ omitMoov: true }), 'video/mp4'))).toBe(
      'malformed_media',
    );
    expect(codeOf(() => inspectSourceBytes(mp4Bytes({ brand: 'M4A ' }), 'video/mp4'))).toBe(
      'unsupported_format',
    );
  });

  it('refuses MIME/container disagreement and non-media payloads', () => {
    expect(codeOf(() => inspectSourceBytes(wavBytes(), 'video/mp4'))).toBe('malformed_media');
    expect(codeOf(() => inspectSourceBytes(mp4Bytes(), 'audio/wav'))).toBe('malformed_media');
    expect(
      codeOf(() =>
        inspectSourceBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'video/mp4'),
      ),
    ).toBe('unsupported_format');
    expect(
      codeOf(() => inspectSourceBytes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/mp4')),
    ).toBe('unsupported_format');
  });

  it('refuses a truncated WAV data chunk instead of guessing duration', () => {
    const bytes = wavBytes();
    bytes.writeUInt32LE(bytes.length, 40);
    expect(codeOf(() => inspectSourceBytes(bytes, 'audio/wav'))).toBe('malformed_media');
  });
});

describe('MediaSourceStore', () => {
  it('stores write-once sources with hash-verified reads', async () => {
    const { store: sources, workspace } = await store();
    const bytes = wavBytes({ durationMs: 2_000 });
    const record = await sources.create(PROJECT, {
      mime: 'audio/wav',
      bytes,
      origin: 'recording',
      original_name: ' note.wav ',
    });
    expect(record).toMatchObject({
      project_id: PROJECT,
      kind: 'audio',
      mime: 'audio/wav',
      duration_ms: 2_000,
      byte_size: bytes.length,
      origin: 'recording',
      original_name: 'note.wav',
    });
    expect(record.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

    const listed = await sources.list(PROJECT);
    expect(listed.map((item) => item.source_id)).toEqual([record.source_id]);
    expect((await sources.get(PROJECT, record.source_id)).sha256).toBe(record.sha256);
    expect(await sources.readBytes(PROJECT, record.source_id)).toEqual(bytes);

    const dir = join(workspace.projectDir(PROJECT), 'media-sources', record.source_id);
    const manifest = JSON.parse(await readFile(join(dir, 'source.json'), 'utf8')) as unknown;
    expect(manifest).toMatchObject({ source_id: record.source_id });
    expect((await sources.verifyProjectSources(PROJECT)).ok).toBe(true);
  });

  it('keeps sources project-isolated and absent across projects', async () => {
    const { store: sources } = await store();
    const record = await sources.create(PROJECT, { mime: 'audio/wav', bytes: wavBytes() });
    await expect(sources.get(OTHER, record.source_id)).rejects.toMatchObject({
      code: 'source_not_found',
    });
    await expect(sources.readBytes(OTHER, record.source_id)).rejects.toMatchObject({
      code: 'source_not_found',
    });
    expect(await sources.list(OTHER)).toEqual([]);
  });

  it('detects drifted bytes and refuses symlinked source files', async () => {
    const { store: sources, workspace } = await store();
    const record = await sources.create(PROJECT, { mime: 'audio/wav', bytes: wavBytes() });
    const bytesPath = join(
      workspace.projectDir(PROJECT),
      'media-sources',
      record.source_id,
      'source.bin',
    );
    await chmod(bytesPath, 0o600);
    await writeFile(bytesPath, Buffer.from('tampered'));
    await expect(sources.readBytes(PROJECT, record.source_id)).rejects.toMatchObject({
      code: 'source_corrupt',
    });
    const verified = await sources.verifyProjectSources(PROJECT);
    expect(verified.ok).toBe(false);
    expect(verified.mismatches[0]?.source_id).toBe(record.source_id);
  });

  it('reports a malformed manifest during verification instead of hiding it', async () => {
    const { store: sources, workspace } = await store();
    const record = await sources.create(PROJECT, { mime: 'audio/wav', bytes: wavBytes() });
    const manifest = join(
      workspace.projectDir(PROJECT),
      'media-sources',
      record.source_id,
      'source.json',
    );
    await writeFile(manifest, '{not json');
    const verified = await sources.verifyProjectSources(PROJECT);
    expect(verified.checked).toBe(1);
    expect(verified.ok).toBe(false);
    expect(verified.mismatches[0]).toMatchObject({ source_id: record.source_id });
  });

  it('refuses a symlink even when the target has the right bytes', async () => {
    const { store: sources, workspace } = await store();
    const bytes = wavBytes();
    const record = await sources.create(PROJECT, { mime: 'audio/wav', bytes });
    const dir = join(workspace.projectDir(PROJECT), 'media-sources', record.source_id);
    const real = join(dir, 'real.bin');
    const link = join(dir, 'source.bin');
    await writeFile(real, bytes, { mode: 0o600 });
    await rm(link);
    await symlink(real, link);
    await expect(sources.readBytes(PROJECT, record.source_id)).rejects.toMatchObject({
      code: 'source_corrupt',
    });
  });

  it('removes a half-written source directory when persistence fails', async () => {
    const { store: sources, workspace } = await store();
    const projectDir = workspace.projectDir(PROJECT);
    await mkdir(join(projectDir, 'media-sources'), { recursive: true, mode: 0o700 });
    // Occupy the fixed bytes name in a way create() cannot replace, then
    // assert no source directory survives the failure.
    const bad = Buffer.alloc(0);
    await expect(sources.create(PROJECT, { mime: 'audio/wav', bytes: bad })).rejects.toMatchObject({
      code: 'malformed_media',
    });
    expect(await sources.list(PROJECT)).toEqual([]);
  });

  it('rejects ids that would escape the project tree', async () => {
    const { store: sources } = await store();
    await expect(sources.get(PROJECT, '../escape')).rejects.toMatchObject({
      code: 'invalid_source_id',
    });
    await expect(
      sources.get('../escape', '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'invalid_project_id' });
  });
});
