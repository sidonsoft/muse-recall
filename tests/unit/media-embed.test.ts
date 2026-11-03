import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  EMBED_HTML_MAX_BYTES,
  EMBED_IMAGE_MAX_BYTES,
  EMBED_IMAGE_MAX_DIMENSION,
  EMBED_IMAGE_MAX_PIXELS,
  type EmbedAssetStore,
  type EmbeddableImageVersion,
  EmbedError,
  embedAssetImages,
  parseAssetPlaceholder,
  verifyEmbeddedHtml,
} from '../../apps/server/src/media/embed.js';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes: Uint8Array): number {
  let table = CRC_TABLE;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    CRC_TABLE = table;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const entry = table[(crc ^ byte) & 0xff];
    if (entry === undefined) throw new Error('crc table miss');
    crc = entry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let CRC_TABLE: Uint32Array | undefined;

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.alloc(8 + data.length + 4);
  body.writeUInt32BE(data.length, 0);
  body.write(type, 4, 'ascii');
  Buffer.from(data).copy(body, 8);
  body.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])),
    8 + data.length,
  );
  return body;
}

/** Minimal valid truecolour PNG with the given intrinsic dimensions. */
function pngBytes(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 37 + y * 11) & 0xff;
      row[1 + x * 3 + 1] = (x * 17 + y * 53) & 0xff;
      row[1 + x * 3 + 2] = (x * 91 + y * 7) & 0xff;
    }
    rows.push(row);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Minimal JPEG (SOI + SOF0 + EOI) with the given intrinsic dimensions. */
function jpegBytes(width: number, height: number): Buffer {
  const sof = Buffer.alloc(2 + 11);
  sof.writeUInt16BE(11, 0); // segment length
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 1; // one component
  sof[8] = 1;
  sof[9] = 0x11;
  sof[10] = 0;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xc0]), // SOF0
    sof,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** Minimal lossy (VP8) WebP with the given intrinsic dimensions. */
function webpBytes(width: number, height: number): Buffer {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width - 1, 6);
  frame.writeUInt16LE(height - 1, 8);
  const body = Buffer.alloc(30);
  body.write('RIFF', 0, 'ascii');
  body.writeUInt32LE(22, 4);
  body.write('WEBP', 8, 'ascii');
  body.write('VP8 ', 12, 'ascii');
  body.writeUInt32LE(10, 16);
  frame.copy(body, 20);
  return body;
}

interface Fixture {
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

function recordFor(
  fixture: Fixture,
  overrides?: Partial<EmbeddableImageVersion>,
): EmbeddableImageVersion {
  return {
    assetId: 'sunset-beach',
    version: 3,
    projectId: 'harbour',
    status: 'approved',
    mimeType: fixture.mimeType,
    bytes: fixture.bytes,
    sha256Hex: sha256Hex(fixture.bytes),
    width: fixture.width,
    height: fixture.height,
    ...overrides,
  };
}

function storeFor(
  records: EmbeddableImageVersion[],
  projectId = 'harbour',
): EmbedAssetStore & { records: Map<string, EmbeddableImageVersion> } {
  const recordsByKey = new Map(
    records.map((record) => [`${record.assetId}/v${record.version}`, record]),
  );
  return {
    projectId,
    records: recordsByKey,
    lookup(assetId: string, version: number) {
      return recordsByKey.get(`${assetId}/v${version}`);
    },
  };
}

const HTML_DOC = (body: string): string =>
  `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

describe('parseAssetPlaceholder', () => {
  it('parses the exact grammar', () => {
    expect(parseAssetPlaceholder('muse-asset://sunset-beach/v3')).toEqual({
      assetId: 'sunset-beach',
      version: 3,
    });
  });

  it('rejects malformed placeholders with an explicit error', () => {
    for (const bad of [
      'muse-asset:///v1',
      'muse-asset://a b/v1',
      'muse-asset://asset/v0',
      'muse-asset://asset/v01',
      'muse-asset://asset/3',
      'https://example.com/x.png',
      'muse-asset://asset/v1/extra',
      '',
    ]) {
      let error: unknown;
      try {
        parseAssetPlaceholder(bad);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(EmbedError);
      expect((error as EmbedError).code).toBe('invalid_placeholder');
    }
  });
});

describe('embedAssetImages', () => {
  it('resolves an approved project-owned image to a data URL', () => {
    const fixture = { bytes: pngBytes(2, 2), width: 2, height: 2, mimeType: 'image/png' as const };
    const store = storeFor([recordFor(fixture)]);
    const result = embedAssetImages(
      HTML_DOC('<img src="muse-asset://sunset-beach/v3" alt="x">'),
      store,
    );
    expect(result.html).not.toContain('muse-asset://');
    expect(result.html).toContain('src="data:image/png;base64,');
    // Output must already satisfy the preview CSP `img-src data: blob:`.
    expect(result.html).not.toContain('http://');
    expect(result.html).not.toContain('https://');
    expect(result.embedded).toHaveLength(1);
    expect(result.embedded[0]).toMatchObject({
      assetId: 'sunset-beach',
      version: 3,
      mimeType: 'image/png',
      bytes: fixture.bytes.length,
      sha256Hex: sha256Hex(fixture.bytes),
    });
    expect(result.bytes).toBe(Buffer.byteLength(result.html, 'utf8'));
  });

  it('embeds JPEG and WebP payloads', () => {
    const jpeg = { bytes: jpegBytes(3, 2), width: 3, height: 2, mimeType: 'image/jpeg' as const };
    const webp = { bytes: webpBytes(4, 1), width: 4, height: 1, mimeType: 'image/webp' as const };
    const store = storeFor([
      recordFor(jpeg, { assetId: 'photo', version: 1 }),
      recordFor(webp, { assetId: 'clip', version: 2 }),
    ]);
    const result = embedAssetImages(
      HTML_DOC('<img src="muse-asset://photo/v1"><img src="muse-asset://clip/v2">'),
      store,
    );
    expect(result.html).toContain('data:image/jpeg;base64,');
    expect(result.html).toContain('data:image/webp;base64,');
    expect(result.html).not.toContain('muse-asset://');
    expect(result.embedded).toHaveLength(2);
  });

  it('resolves repeated references to the same version', () => {
    const fixture = { bytes: pngBytes(1, 1), width: 1, height: 1, mimeType: 'image/png' as const };
    const store = storeFor([recordFor(fixture)]);
    const result = embedAssetImages(
      HTML_DOC('<img src="muse-asset://sunset-beach/v3"><img src="muse-asset://sunset-beach/v3">'),
      store,
    );
    expect(result.html).not.toContain('muse-asset://');
    expect(result.embedded).toHaveLength(1);
  });

  it('round-trips bytes identically (resolved bytes hash == manifest hash)', () => {
    const fixture = { bytes: pngBytes(3, 2), width: 3, height: 2, mimeType: 'image/png' as const };
    const manifestHash = sha256Hex(fixture.bytes);
    const store = storeFor([recordFor(fixture)]);
    const result = embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
    const dataUrl = result.html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1];
    expect(dataUrl).toBeDefined();
    const resolved = Buffer.from(dataUrl ?? '', 'base64');
    expect(resolved.equals(fixture.bytes)).toBe(true);
    expect(sha256Hex(resolved)).toBe(manifestHash);
    expect(sha256Hex(resolved)).toBe(result.embedded[0]?.sha256Hex);
  });

  it('rejects unknown references', () => {
    const store = storeFor([]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://ghost/v9">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('unknown_asset_reference');
  });

  it('rejects cross-project references', () => {
    const fixture = { bytes: pngBytes(2, 2), width: 2, height: 2, mimeType: 'image/png' as const };
    const store = storeFor([recordFor(fixture, { projectId: 'other-project' })], 'harbour');
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('cross_project_reference');
  });

  it('rejects unapproved (candidate and rejected) versions', () => {
    const fixture = { bytes: pngBytes(2, 2), width: 2, height: 2, mimeType: 'image/png' as const };
    for (const status of ['candidate', 'rejected'] as const) {
      const store = storeFor([recordFor(fixture, { status })]);
      let error: unknown;
      try {
        embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(EmbedError);
      expect((error as EmbedError).code).toBe('unapproved_asset_reference');
    }
  });

  it('rejects malformed placeholders embedded in a document', () => {
    const store = storeFor([]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://bad asset/v1">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('invalid_placeholder');
  });

  it('never embeds SVG or HTML payloads', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    for (const mimeType of ['image/svg+xml', 'text/html']) {
      const store = storeFor([
        recordFor(
          { bytes: pngBytes(1, 1), width: 1, height: 1, mimeType: 'image/png' },
          { mimeType, bytes: svg, sha256Hex: sha256Hex(svg) },
        ),
      ]);
      let error: unknown;
      try {
        embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(EmbedError);
      expect((error as EmbedError).code).toBe('unsupported_asset_media_type');
    }
  });

  it('refuses payloads whose bytes disagree with the manifest', () => {
    const bytes = pngBytes(2, 2);
    const store = storeFor([
      recordFor({ bytes, width: 2, height: 2, mimeType: 'image/png' }, { width: 4, height: 4 }),
    ]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('asset_bytes_mismatch');
  });

  it('refuses payloads whose hash disagrees with the manifest', () => {
    const bytes = pngBytes(2, 2);
    const store = storeFor([
      recordFor(
        { bytes, width: 2, height: 2, mimeType: 'image/png' },
        { sha256Hex: '0'.repeat(64) },
      ),
    ]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('asset_hash_mismatch');
  });

  it('enforces the byte limit', () => {
    const bytes = Buffer.alloc(EMBED_IMAGE_MAX_BYTES + 1, 7);
    const store = storeFor([
      {
        assetId: 'huge',
        version: 1,
        projectId: 'harbour',
        status: 'approved',
        mimeType: 'image/png',
        bytes,
        sha256Hex: sha256Hex(bytes),
        width: 8,
        height: 8,
      },
    ]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://huge/v1">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('asset_too_large');
  });

  it('enforces the per-axis dimension limit', () => {
    // Header-only payload: enforce on declared dimensions without allocating
    // a gigapixel of pixel data.
    const oversized = EMBED_IMAGE_MAX_DIMENSION + 1;
    const bytes = pngBytes(2, 2);
    bytes.writeUInt32BE(oversized, 16);
    bytes.writeUInt32BE(oversized, 20);
    const store = storeFor([
      recordFor(
        { bytes, width: oversized, height: oversized, mimeType: 'image/png' },
        { assetId: 'wide', version: 1 },
      ),
    ]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://wide/v1">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('asset_dimensions_exceeded');
  });

  it('enforces the decoded-pixel limit within the axis limit', () => {
    const side = Math.floor(Math.sqrt(EMBED_IMAGE_MAX_PIXELS)) + 1;
    expect(side).toBeLessThanOrEqual(EMBED_IMAGE_MAX_DIMENSION);
    const bytes = pngBytes(2, 2);
    bytes.writeUInt32BE(side, 16);
    bytes.writeUInt32BE(side, 20);
    const store = storeFor([
      recordFor(
        { bytes, width: side, height: side, mimeType: 'image/png' },
        { assetId: 'big', version: 1 },
      ),
    ]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://big/v1">'), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('asset_pixels_exceeded');
  });

  it('refuses documents with too many distinct references', () => {
    const store = storeFor([]);
    const refs = Array.from({ length: 17 }, (_, index) => `muse-asset://a${index}/v1`).join(' ');
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC(refs), store);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('too_many_references');
  });

  it('enforces the HTML size cap', () => {
    const fixture = { bytes: pngBytes(2, 2), width: 2, height: 2, mimeType: 'image/png' as const };
    const store = storeFor([recordFor(fixture)]);
    let error: unknown;
    try {
      embedAssetImages(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'), store, {
        htmlMaxBytes: 10,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('embedded_html_too_large');
  });

  it('leaves documents without placeholders untouched', () => {
    const store = storeFor([]);
    const html = HTML_DOC('<p>no images here</p>');
    const result = embedAssetImages(html, store);
    expect(result.html).toBe(html);
    expect(result.embedded).toEqual([]);
  });
});

describe('verifyEmbeddedHtml', () => {
  it('accepts finished HTML and returns its byte length', () => {
    const html = HTML_DOC('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(verifyEmbeddedHtml(html)).toBe(Buffer.byteLength(html, 'utf8'));
  });

  it('rejects HTML with an unresolved placeholder', () => {
    let error: unknown;
    try {
      verifyEmbeddedHtml(HTML_DOC('<img src="muse-asset://sunset-beach/v3">'));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('unresolved_placeholder');
  });

  it('rejects HTML above the size cap', () => {
    const html = `x`.repeat(EMBED_HTML_MAX_BYTES + 1);
    let error: unknown;
    try {
      verifyEmbeddedHtml(html);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EmbedError);
    expect((error as EmbedError).code).toBe('embedded_html_too_large');
  });
});
