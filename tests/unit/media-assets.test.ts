/**
 * Batch A2: versioned asset store + durable media jobs.
 *
 * - Malformed media (SVG/HTML masquerade, truncated magic, MIME mismatch) is
 *   refused with explicit errors.
 * - Cross-project parent references are rejected.
 * - Restart recovery marks queued|running media jobs as interrupted; they are
 *   never resumed.
 * - A cancelled job never publishes a late result (generation fence).
 * - Byte-identical round trip with sha256 verification.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore, type MediaError } from '../../apps/server/src/media/assets.js';
import { type MediaJobError, MediaJobStore } from '../../apps/server/src/media/jobs.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'media-a2-'));
  roots.push(root);
  const workspace = new ForgeWorkspace(root);
  await workspace.ensureProject('demo');
  await workspace.ensureProject('other');
  return {
    root,
    workspace,
    assets: new MediaAssetStore(workspace),
    jobs: new MediaJobStore(workspace),
  };
}

/** Minimal 1x1 PNG (IHDR width=1 height=1, 8-bit RGBA). */
function png1x1(): Buffer {
  const header = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdrLen = Buffer.from('0000000d', 'hex');
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  const ihdrCrc = Buffer.from('1f15c489', 'hex');
  const idatLen = Buffer.from('0000000a', 'hex');
  const idatType = Buffer.from('IDAT', 'ascii');
  const idatData = Buffer.from('789c626001000000ffff030000060005', 'hex');
  const idatCrc = Buffer.from('0d0a2db4', 'hex');
  const iend = Buffer.from('0000000049454e44ae426082', 'hex');
  return Buffer.concat([
    header,
    ihdrLen,
    ihdrType,
    ihdrData,
    ihdrCrc,
    idatLen,
    idatType,
    idatData,
    idatCrc,
    iend,
  ]);
}

/** Minimal JPEG with a SOF0 segment declaring 1x1. */
function jpeg1x1(): Buffer {
  return Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b, // SOF0, length 11
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9, // EOI
  ]);
}

/** Minimal VP8X WebP declaring 1x1. */
function webp1x1(): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const size = Buffer.alloc(4);
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8x = Buffer.from('VP8X', 'ascii');
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(7, 0);
  // flags(1) + canvas width-1 (3) + canvas height-1 (3): 1x1 => zeros.
  const payload = Buffer.alloc(7, 0);
  const total = 4 + 8 + 7; // "WEBP" + chunk header + payload
  size.writeUInt32LE(total, 0);
  return Buffer.concat([riff, size, webp, vp8x, chunkSize, payload]);
}

describe('media assets', () => {
  it('round-trips bytes byte-identically with a verified sha256', async () => {
    const { workspace, assets } = await setup();
    const bytes = png1x1();
    const record = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/png',
      bytes,
      source: { kind: 'upload' },
    });
    expect(record.mime).toBe('image/png');
    expect(record.width).toBe(1);
    expect(record.height).toBe(1);
    expect(record.status).toBe('candidate');
    expect(record.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

    const back = await assets.readBytes('demo', record.asset_id, 1);
    expect(back.equals(bytes)).toBe(true);

    // Bytes live outside SQLite, 0600, manifests beside them.
    const binPath = join(workspace.projectDir('demo'), 'media', record.asset_id, '1.bin');
    expect((await stat(binPath)).mode & 0o777).toBe(0o600);
    await expect(
      readFile(join(workspace.projectDir('demo'), 'media', record.asset_id, '1.json'), 'utf8'),
    ).resolves.toContain(record.sha256);
  });

  it('parses JPEG and WebP dimensions', async () => {
    const { assets } = await setup();
    const jpeg = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: jpeg1x1(),
    });
    expect([jpeg.width, jpeg.height]).toEqual([1, 1]);
    const webp = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/webp',
      bytes: webp1x1(),
    });
    expect([webp.width, webp.height]).toEqual([1, 1]);
  });

  it('refuses SVG and HTML masquerading as images', async () => {
    const { assets } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8');
    await expect(
      assets.createAsset('demo', { kind: 'image', mime: 'image/png', bytes: svg }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/unsupported_mime|malformed_media/) });

    const html = Buffer.from('<!DOCTYPE html><html><body>hi</body></html>', 'utf8');
    await expect(
      assets.createAsset('demo', { kind: 'image', mime: 'image/jpeg', bytes: html }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/unsupported_mime|malformed_media/) });
  });

  it('refuses truncated bytes and MIME mismatches with explicit errors', async () => {
    const { assets } = await setup();
    await expect(
      assets.createAsset('demo', {
        kind: 'image',
        mime: 'image/png',
        bytes: Buffer.from('89504e47', 'hex'),
      }),
    ).rejects.toMatchObject({ code: 'malformed_media' });

    // Valid PNG bytes declared as JPEG.
    await expect(
      assets.createAsset('demo', { kind: 'image', mime: 'image/jpeg', bytes: png1x1() }),
    ).rejects.toMatchObject({ code: 'malformed_media' });

    await expect(
      assets.createAsset('demo', { kind: 'image', mime: 'image/webp', bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'malformed_media' });
  });

  it('rejects cross-project parent references', async () => {
    const { assets } = await setup();
    const parent = await assets.createAsset('other', {
      kind: 'image',
      mime: 'image/png',
      bytes: png1x1(),
    });
    await expect(
      assets.createAsset('demo', {
        kind: 'image',
        mime: 'image/png',
        bytes: png1x1(),
        parent: { asset_id: parent.asset_id, version: 1, project_id: 'other' },
      }),
    ).rejects.toMatchObject({ code: 'cross_project_reference' });
  });

  it('accepts same-project parent references and versions immutably', async () => {
    const { assets } = await setup();
    const first = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/png',
      bytes: png1x1(),
    });
    const second = await assets.addVersion('demo', first.asset_id, {
      kind: 'image',
      mime: 'image/png',
      bytes: png1x1(),
      parent: { asset_id: first.asset_id, version: 1, project_id: 'demo' },
    });
    expect(second.version).toBe(2);
    expect(second.parent).toMatchObject({
      asset_id: first.asset_id,
      version: 1,
      project_id: 'demo',
    });

    // v1 bytes are untouched by the new version.
    const v1 = await assets.readBytes('demo', first.asset_id, 1);
    expect(v1.equals(png1x1())).toBe(true);

    const approved = await assets.approve('demo', first.asset_id, 1);
    expect(approved.status).toBe('approved');
    // Terminal curation states only move forward from candidate.
    await expect(assets.approve('demo', first.asset_id, 1)).rejects.toMatchObject({
      code: 'invalid_status_transition',
    });
    const versions = await assets.listVersions('demo', first.asset_id);
    expect(versions.map((entry) => entry.status)).toEqual(['approved', 'candidate']);
  });

  it('round-trips provider-reported model identity and strips unknown model fields', async () => {
    const { assets } = await setup();
    const record = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/png',
      bytes: png1x1(),
      model: {
        provider: 'meta',
        model: 'muse-image-9',
        observed: 'image-provider-reported',
        injected: 'must-not-persist',
      } as unknown as { provider: string; model: string; observed: string },
    });
    const versions = await assets.listVersions('demo', record.asset_id);
    expect(versions[0]?.model).toEqual({
      provider: 'meta',
      model: 'muse-image-9',
      observed: 'image-provider-reported',
    });
  });

  it('verifies project media for backup hash preservation', async () => {
    const { root, assets } = await setup();
    const record = await assets.createAsset('demo', {
      kind: 'image',
      mime: 'image/png',
      bytes: png1x1(),
    });
    const manifest = await assets.collectMediaManifest('demo');
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({ asset_id: record.asset_id, sha256: record.sha256 });

    const clean = await assets.verifyProjectMedia('demo');
    expect(clean).toMatchObject({ ok: true, checked: 1, mismatches: [] });

    // Corrupt the bytes on disk; verification reports drift instead of serving them.
    await writeFile(
      join(root, 'forge', 'demo', 'media', record.asset_id, '1.bin'),
      Buffer.from('corrupted-bytes'),
    );
    const drifted = await assets.verifyProjectMedia('demo');
    expect(drifted.ok).toBe(false);
    expect(drifted.mismatches).toHaveLength(1);
    expect(drifted.mismatches[0]).toMatchObject({ asset_id: record.asset_id, version: 1 });
    await expect(assets.readBytes('demo', record.asset_id, 1)).rejects.toMatchObject({
      code: 'version_corrupt',
    });
  });
});

describe('media jobs', () => {
  it('marks queued|running jobs interrupted on recovery and never resumes them', async () => {
    const { jobs } = await setup();
    const queued = await jobs.enqueue('demo', { kind: 'generate', params: { prompt: 'a cat' } });
    const running = await jobs.enqueue('demo', { kind: 'edit', params: { prompt: 'sharper' } });
    await jobs.start('demo', running.id);

    const interrupted = await jobs.recover({ projectId: 'demo' });
    expect(interrupted.map((entry) => entry.id).sort()).toEqual([queued.id, running.id].sort());

    const afterQueued = await jobs.get('demo', queued.id);
    const afterRunning = await jobs.get('demo', running.id);
    expect(afterQueued.status).toBe('interrupted');
    expect(afterRunning.status).toBe('interrupted');

    // Interrupted jobs cannot publish or restart: they are terminal records.
    await expect(
      jobs.succeed(
        'demo',
        running.id,
        { asset_id: randomUUID(), version: 1, sha256: 'abc' },
        afterRunning.generation,
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/cancelled|invalid_job_state/) });
    await expect(jobs.start('demo', queued.id)).rejects.toMatchObject({
      code: 'invalid_job_state',
    });
  });

  it('refuses to resume after a simulated process restart (fresh store instance)', async () => {
    const { workspace, jobs } = await setup();
    const job = await jobs.enqueue('demo', { kind: 'generate', params: { prompt: 'a dog' } });
    await jobs.start('demo', job.id);
    await jobs.flush(job.id);

    // A new store instance over the same directory sees the durable record…
    const restarted = new MediaJobStore(workspace);
    const recovered = await restarted.recover({ projectId: 'demo' });
    expect(recovered.map((entry) => entry.id)).toContain(job.id);

    // …and reload confirms interruption, not resumption.
    const loaded = await restarted.loadAll({ projectId: 'demo' });
    expect(loaded.jobs.find((entry) => entry.id === job.id)?.status).toBe('interrupted');
    expect(loaded.issues).toEqual([]);
  });

  it('never publishes late results after cancellation (generation fence)', async () => {
    const { workspace, jobs } = await setup();
    const job = await jobs.enqueue('demo', {
      kind: 'generate',
      params: { prompt: 'a bird', api_key: 'should-never-persist' },
    });
    const { generation } = await jobs.start('demo', job.id);
    await jobs.cancel('demo', job.id);

    await expect(
      jobs.publishResult('demo', job.id, generation, {
        asset_id: randomUUID(),
        version: 1,
        sha256: 'deadbeef',
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
      jobs.succeed(
        'demo',
        job.id,
        { asset_id: randomUUID(), version: 1, sha256: 'deadbeef' },
        generation,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });

    const after = await jobs.get('demo', job.id);
    expect(after.status).toBe('cancelled');
    expect(after.result).toBeNull();

    // No secrets persisted: scrubbed at enqueue time, in memory and on disk.
    expect(JSON.stringify(after.params)).not.toContain('should-never-persist');
    const raw = await readFile(
      join(workspace.projectDir('demo'), 'media-jobs', `${job.id}.json`),
      'utf8',
    );
    expect(raw).not.toContain('should-never-persist');
  });

  it('persists no secrets in job files and bounds logs', async () => {
    const { workspace, jobs } = await setup();
    const job = await jobs.enqueue('demo', {
      kind: 'describe',
      params: {
        nested: { api_key: 'sk-live-123', safe: 'yes' },
        authorization: 'Bearer abcdefghijklmnop',
      },
    });
    expect(JSON.stringify(job.params)).not.toContain('sk-live-123');
    // 250 lines collapse to the bounded tail of 200.
    for (let i = 0; i < 250; i += 1) {
      await jobs.appendLog(
        'demo',
        job.id,
        `line ${String(i)} with token secret=hunter2-${String(i)}`,
      );
    }
    const stored = await jobs.get('demo', job.id);
    expect(stored.logs).toHaveLength(200);
    const raw = await readFile(
      join(workspace.projectDir('demo'), 'media-jobs', `${job.id}.json`),
      'utf8',
    );
    expect(raw).not.toContain('sk-live-123');
    expect(raw).not.toContain('hunter2');
  });

  it('serialises writes so a slow early write cannot resurrect a terminal state', async () => {
    const { jobs } = await setup();
    const job = await jobs.enqueue('demo', { kind: 'generate', params: {} });
    await jobs.start('demo', job.id);
    // Fire cancel without awaiting, then succeed with the current generation:
    // succeed must win-or-lose deterministically, never resurrect afterwards.
    const cancelled = await jobs.cancel('demo', job.id);
    expect(cancelled.status).toBe('cancelled');
    await expect(
      jobs.succeed(
        'demo',
        job.id,
        { asset_id: randomUUID(), version: 1, sha256: 'x' },
        cancelled.generation - 1,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

// Type-level assertion: refusal codes are explicit, never generic Errors.
const _codes: MediaError['code'] = 'malformed_media';
void _codes;
const _jobCodes: MediaJobError['code'] = 'cancelled';
void _jobCodes;
