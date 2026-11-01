import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaAdapter } from '../../apps/server/src/media/adapter.js';
import {
  decodeImage,
  downscaleRgba,
  MediaSegmentation,
  MediaUnderstand,
  mapBoxToSource,
  type ParsedSegmentMatch,
  parseSegmentLane,
  type RgbaImage,
  renderCutout,
  renderCutoutBounded,
  renderMatchPreview,
} from '../../apps/server/src/media/segment.js';

/**
 * Batch C: SAM lane parsing, cutout compositing, and suggestion parsing.
 *
 * The two-match lane uses real `sam-3.1` grammar and payloads (Meta's
 * documented example): they decode through the official parser to 1620 and
 * 1296 raster bytes with zero diagnostics.
 */
const LANE_TWO_MATCHES =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

function adapter(fetchImpl: unknown): MediaAdapter {
  return new MediaAdapter({
    apiKey: 'test-key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxRetries: 0,
  });
}

/** SSE success envelope: geometry deltas through a terminal completed event. */
function sseResponse(deltas: string[], terminal: unknown): Response {
  const blocks = deltas.map(
    (delta) => `event: response.output_text.delta\ndata: ${JSON.stringify({ delta })}`,
  );
  blocks.push(`event: response.completed\ndata: ${JSON.stringify({ response: terminal })}`);
  return new Response(`${blocks.join('\n\n')}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function completedTerminal(output: unknown[]): Record<string, unknown> {
  return { status: 'completed', model: 'sam-3.1-actual', output };
}

function laneOutput(lane: string): unknown[] {
  return [{ type: 'message', content: [{ type: 'output_text', text: lane }] }];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** 8x8 source: left half red, right half blue, full alpha. */
function twoTone(): RgbaImage {
  const width = 8;
  const height = 8;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x < 4) {
        data[offset] = 255;
      } else {
        data[offset + 2] = 255;
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function checkerMatch(): ParsedSegmentMatch {
  return {
    objectId: '7',
    box: { x1: 0, y1: 0, x2: 8, y2: 8 },
    maskWidth: 2,
    maskHeight: 2,
    raster: Uint8Array.from([1, 0, 0, 1]),
  };
}

describe('parseSegmentLane (Batch C)', () => {
  it('parses two real-grammar matches with boxes and rasters', () => {
    const parsed = parseSegmentLane(LANE_TWO_MATCHES);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.skipped).toBe(0);
    expect(parsed.matches).toHaveLength(2);
    expect(parsed.matches[0]).toMatchObject({
      objectId: '0',
      box: { x1: 211, y1: 228, x2: 271, y2: 255 },
      maskWidth: 60,
      maskHeight: 27,
    });
    expect(parsed.matches[0]?.raster).toHaveLength(1620);
    expect(parsed.matches[1]).toMatchObject({
      objectId: '1',
      box: { x1: 155, y1: 228, x2: 203, y2: 255 },
    });
    expect(parsed.matches[1]?.raster).toHaveLength(1296);
  });

  it('treats an empty lane as zero matches, not an error', () => {
    for (const lane of ['', '   ', '\n  \n']) {
      const parsed = parseSegmentLane(lane);
      expect(parsed.matches).toEqual([]);
      expect(parsed.skipped).toBe(0);
    }
  });

  it('rejects out-of-grammar coordinates instead of guessing', () => {
    const lane =
      '<0f>9<|box;x1=-50;y1=5;x2=5;y2=9;w=320;h=334|>' +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
    const parsed = parseSegmentLane(lane);
    expect(parsed.matches).toEqual([]);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('caps matches at sixteen with real payloads', () => {
    const one = (index: number): string =>
      `${index}<|box;x1=1;y1=1;x2=10;y2=10;w=320;h=334|>` +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
    const many = `<0f>${Array.from({ length: 20 }, (_, index) => one(index)).join(',')}\n`;
    const parsed = parseSegmentLane(many);
    expect(parsed.matches).toHaveLength(16);
    expect(parsed.matches[0]?.objectId).toBe('0');
    expect(parsed.matches[15]?.objectId).toBe('15');
  });

  it('reports garbage lanes without matches', () => {
    const parsed = parseSegmentLane('hello, not geometry');
    expect(parsed.matches).toEqual([]);
  });
});

describe('renderCutout (Batch C)', () => {
  it('keeps masked RGB with full alpha and clears everything else', () => {
    const png = renderCutout(twoTone(), checkerMatch());
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    const at = (x: number, y: number): number[] => {
      const offset = (y * 8 + x) * 4;
      return [
        decoded.data[offset] ?? -1,
        decoded.data[offset + 1] ?? -1,
        decoded.data[offset + 2] ?? -1,
        decoded.data[offset + 3] ?? -1,
      ];
    };
    // Mask 1 cells preserve RGB; mask 0 cells are transparent.
    expect(at(1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(6, 6)).toEqual([0, 0, 255, 255]);
    expect(at(6, 1)[3]).toBe(0);
    expect(at(1, 6)[3]).toBe(0);
  });

  it('trims the cutout to the match box', () => {
    const png = renderCutout(twoTone(), {
      ...checkerMatch(),
      box: { x1: 2, y1: 2, x2: 6, y2: 6 },
    });
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
  });

  it('refuses a box outside the image', () => {
    expect(() =>
      renderCutout(twoTone(), {
        ...checkerMatch(),
        box: { x1: 40, y1: 40, x2: 60, y2: 60 },
      }),
    ).toThrow(/outside the image/);
  });
});

describe('renderMatchPreview (Batch C)', () => {
  it('returns a bounded PNG data URL of the source dims or smaller', () => {
    const url = renderMatchPreview(twoTone(), checkerMatch());
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeLessThan(2_000_000);
    const decoded = PNG.sync.read(Buffer.from(url.split(',')[1] ?? '', 'base64'));
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(512);
  });
});

describe('decodeImage (Batch C)', () => {
  it('round-trips PNG bytes', async () => {
    const src = twoTone();
    const bytes = PNG.sync.write({ width: src.width, height: src.height, data: src.data });
    const decoded = await decodeImage(bytes, 'image/png');
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    expect(decoded.data.equals(src.data)).toBe(true);
  });

  it('round-trips JPEG dimensions', async () => {
    // Server-only deps resolve from the server package, not the repo root.
    const { createRequire } = await import('node:module');
    const require = createRequire(`${process.cwd()}/apps/server/package.json`);
    const codec = require('jpeg-js') as {
      encode: (
        image: { width: number; height: number; data: Buffer },
        quality: number,
      ) => { data: Buffer };
    };
    const src = twoTone();
    const encoded = codec.encode({ width: src.width, height: src.height, data: src.data }, 90);
    const decoded = await decodeImage(encoded.data, 'image/jpeg');
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    expect(decoded.data.length).toBe(8 * 8 * 4);
  });

  it('round-trips WebP dimensions', async () => {
    const { createRequire } = await import('node:module');
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const require = createRequire(`${process.cwd()}/apps/server/package.json`);
    const pkgDir = dirname(require.resolve('@jsquash/webp/package.json'));
    const encodeModule = (await import(
      pathToFileURL(join(pkgDir, 'encode.js')).href
    )) as unknown as {
      init: (module: WebAssembly.Module) => Promise<unknown>;
      default: (image: {
        data: Uint8ClampedArray;
        width: number;
        height: number;
      }) => Promise<Uint8Array>;
    };
    await encodeModule.init(
      await WebAssembly.compile(readFileSync(join(pkgDir, 'codec/enc/webp_enc_simd.wasm'))),
    );
    const bytes = await encodeModule.default({
      data: new Uint8ClampedArray(twoTone().data),
      width: 8,
      height: 8,
    });
    const decoded = await decodeImage(Buffer.from(bytes as ArrayBuffer), 'image/webp');
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
  });

  it('refuses undecodable bytes per MIME', async () => {
    await expect(decodeImage(Buffer.from('nope'), 'image/png')).rejects.toThrow(/PNG/);
    await expect(decodeImage(Buffer.from('nope'), 'image/jpeg')).rejects.toThrow(/JPEG/);
    await expect(decodeImage(Buffer.from('nope'), 'image/webp')).rejects.toThrow(/WebP/);
  });
});

describe('MediaSegmentation (Batch C)', () => {
  it('sends the SAM model explicitly and maps boxes back to source pixels', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      calls.push({ url: 'x', body: String(init?.body) });
      return sseResponse(
        [LANE_TWO_MATCHES.slice(0, 100), LANE_TWO_MATCHES.slice(100)],
        completedTerminal(laneOutput(LANE_TWO_MATCHES)),
      );
    });
    const segmentation = new MediaSegmentation(adapter(fetchImpl), { model: 'sam-test' });
    // Same dims as the lane's frame, so sent boxes map back unchanged.
    const src: RgbaImage = { width: 320, height: 334, data: Buffer.alloc(320 * 334 * 4, 200) };
    const result = await segmentation.segment(src, 'dot');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ model: 'sam-test', stream: true });
    expect(result.model).toBe('sam-test');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.box).toEqual({ x1: 211, y1: 228, x2: 271, y2: 255 });
    expect(result.observedModel).toBe('sam-3.1-actual');
  });

  it('maps fitted boxes back to source pixels and clips them', () => {
    expect(mapBoxToSource({ x1: 105, y1: 114, x2: 135, y2: 127 }, 160, 167, 320, 334)).toEqual({
      x1: 210,
      y1: 228,
      x2: 270,
      y2: 254,
    });
    expect(mapBoxToSource({ x1: -4, y1: 0, x2: 400, y2: 500 }, 320, 334, 320, 334)).toEqual({
      x1: 0,
      y1: 0,
      x2: 320,
      y2: 334,
    });
  });

  it('reports zero matches without an error', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([], completedTerminal(laneOutput(''))));
    const result = await new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'nothing');
    expect(result.matches).toEqual([]);
    expect(result.model).toBe('sam-3.1');
  });

  it('rejects endpoint errors and refusals', async () => {
    const failing = vi.fn(async () =>
      sseResponse([], {
        status: 'failed',
        output: [],
        error: { message: 'busy' },
      }),
    );
    await expect(new MediaSegmentation(adapter(failing)).segment(twoTone(), 'dot')).rejects.toThrow(
      /terminal status "failed"/,
    );
    const refusing = vi.fn(async () =>
      sseResponse(
        [],
        completedTerminal([{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }]),
      ),
    );
    await expect(
      new MediaSegmentation(adapter(refusing)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/refused/);
  });
});

describe('MediaUnderstand (Batch C)', () => {
  const suggestions = {
    suggestions: [
      { type: 'preference', content: 'Use rounded cards.', confidence: 0.9 },
      { type: 'constraint', content: 'Keep contrast high.', confidence: 0.7 },
      { type: 'bogus', content: 'Ignored.', confidence: 1 },
      { type: 'preference', content: '', confidence: 1 },
    ],
  };

  it('parses fenced suggestion JSON and filters invalid entries', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: `Here you go:\n\`\`\`json\n${JSON.stringify(suggestions)}\n\`\`\``,
              },
            ],
          },
        ],
      }),
    );
    const understand = new MediaUnderstand(adapter(fetchImpl));
    const result = await understand.suggest({
      bytes: PNG.sync.write({ width: 1, height: 1, data: Buffer.alloc(4) }),
      mime: 'image/png',
    });
    expect(understand.targetedModel).toBe('muse-spark-1.3');
    expect(result.suggestions).toEqual([
      { type: 'preference', content: 'Use rounded cards.', confidence: 0.9 },
      { type: 'constraint', content: 'Keep contrast high.', confidence: 0.7 },
    ]);
  });

  it('defaults missing confidence and caps the count', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  suggestions: [
                    { type: 'preference', content: 'One.' },
                    { type: 'preference', content: 'Two.' },
                    { type: 'preference', content: 'Three.' },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    );
    const result = await new MediaUnderstand(adapter(fetchImpl)).suggest(
      { bytes: Buffer.alloc(10), mime: 'image/png' },
      { count: 2 },
    );
    expect(result.suggestions).toEqual([
      { type: 'preference', content: 'One.', confidence: 0.5 },
      { type: 'preference', content: 'Two.', confidence: 0.5 },
    ]);
  });

  it('rejects prose and empty text', async () => {
    const prose = vi.fn(async () =>
      jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A lovely image!' }] }],
      }),
    );
    await expect(
      new MediaUnderstand(adapter(prose)).suggest({ bytes: Buffer.alloc(10), mime: 'image/png' }),
    ).rejects.toThrow(/suggestion JSON/);
    const empty = vi.fn(async () =>
      jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
      }),
    );
    await expect(
      new MediaUnderstand(adapter(empty)).suggest({ bytes: Buffer.alloc(10), mime: 'image/png' }),
    ).rejects.toThrow(/no text/);
  });
});

describe('downscaleRgba (Batch C P1)', () => {
  function gradient4(): RgbaImage {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = x * 10 + y;
        data[offset + 1] = x;
        data[offset + 2] = y;
        data[offset + 3] = 255;
      }
    }
    return { width, height, data };
  }

  it('copies source pixels exactly and leaves the source untouched', () => {
    const src = gradient4();
    const before = Buffer.from(src.data);
    const small = downscaleRgba(src, 0.5);
    expect([small.width, small.height]).toEqual([2, 2]);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const source = (y * 2 * 4 + x * 2) * 4;
        const dest = (y * 2 + x) * 4;
        expect([small.data[dest], small.data[dest + 1], small.data[dest + 2]]).toEqual([
          src.data[source],
          src.data[source + 1],
          src.data[source + 2],
        ]);
      }
    }
    expect(src.data.equals(before)).toBe(true);
  });

  it('bounds previews above 512px', () => {
    const width = 1024;
    const height = 768;
    const src: RgbaImage = { width, height, data: Buffer.alloc(width * height * 4, 200) };
    const url = renderMatchPreview(src, {
      objectId: '0',
      box: { x1: 0, y1: 0, x2: width, y2: height },
      maskWidth: 1,
      maskHeight: 1,
      raster: Uint8Array.from([1]),
    });
    const decoded = PNG.sync.read(Buffer.from(url.split(',')[1] ?? '', 'base64'));
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(512);
  });
});

describe('cutout transparency (Batch C P2)', () => {
  /** 2x2: opaque red, translucent green, fully transparent blue, opaque white. */
  function alphaCase(): RgbaImage {
    const data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]);
    return { width: 2, height: 2, data };
  }

  function fullMask(): ParsedSegmentMatch {
    return {
      objectId: '0',
      box: { x1: 0, y1: 0, x2: 2, y2: 2 },
      maskWidth: 2,
      maskHeight: 2,
      raster: Uint8Array.from([1, 1, 1, 1]),
    };
  }

  function alphaOf(png: Buffer, x: number, y: number, width: number): number {
    const decoded = PNG.sync.read(png);
    return decoded.data[(y * width + x) * 4 + 3] ?? -1;
  }

  it('preserves source alpha for selected pixels in renderCutout', () => {
    const png = renderCutout(alphaCase(), fullMask());
    expect(alphaOf(png, 0, 0, 2)).toBe(255);
    expect(alphaOf(png, 1, 0, 2)).toBe(128);
    expect(alphaOf(png, 0, 1, 2)).toBe(0);
  });

  it('clears excluded pixels in renderCutout', () => {
    const png = renderCutout(alphaCase(), {
      ...fullMask(),
      raster: Uint8Array.from([0, 0, 0, 0]),
    });
    expect(alphaOf(png, 0, 0, 2)).toBe(0);
    expect(alphaOf(png, 1, 1, 2)).toBe(0);
  });

  it('preserves source alpha in renderCutoutBounded, including the byte-cap fallback', () => {
    const bounded = renderCutoutBounded(alphaCase(), fullMask(), 10 * 1024 * 1024);
    expect(bounded.scaled).toBe(false);
    expect(alphaOf(bounded.bytes, 1, 0, bounded.width)).toBe(128);
    expect(alphaOf(bounded.bytes, 0, 1, bounded.width)).toBe(0);

    const full = renderCutout(alphaCase(), fullMask());
    const forced = renderCutoutBounded(alphaCase(), fullMask(), full.length - 1);
    expect(forced.scaled).toBe(true);
    const decoded = PNG.sync.read(forced.bytes);
    expect(decoded.width).toBeGreaterThanOrEqual(1);
  });
});

describe('MediaSegmentation lane validation (Batch C P2)', () => {
  // Streaming lanes: geometry arrives as deltas; the terminal object
  // carries the same lane text so the contract-mismatch guard stays quiet.
  const textLane = (text: string): Response =>
    sseResponse(
      text.length > 0 ? [text] : [],
      completedTerminal([{ type: 'message', content: [{ type: 'output_text', text }] }]),
    );

  it('accepts an explicitly empty lane as zero matches', async () => {
    const fetchImpl = vi.fn(async () => textLane(''));
    const result = await new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'nothing');
    expect(result.matches).toEqual([]);
  });

  it('rejects terminal objects without explicit empty text output', async () => {
    // No delta channel and no explicit empty text: malformed terminals
    // are never zero matches, even on a completed status.
    const malformed = [
      { status: 'completed', output: [] },
      { status: 'completed', output: [{ type: 'message', content: [] }] },
      { status: 'completed' },
    ];
    for (const terminal of malformed) {
      const fetchImpl = vi.fn(async () => sseResponse([], terminal));
      await expect(
        new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'dot'),
      ).rejects.toThrow(/terminal response (has no text output|without output\[\])/);
    }
  });

  it('rejects prose without geometry', async () => {
    const fetchImpl = vi.fn(async () => textLane('hello, not geometry'));
    await expect(
      new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/no usable matches/);
  });

  it('rejects malformed geometry', async () => {
    const fetchImpl = vi.fn(async () =>
      textLane(
        '<0f>9<|box;x1=-50;y1=5;x2=5;y2=9;w=320;h=334|>' +
          "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>",
      ),
    );
    await expect(
      new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/no usable matches/);
  });

  it('rejects undecodable masks', async () => {
    const fetchImpl = vi.fn(async () =>
      textLane('<0f>0<|box;x1=1;y1=2;x2=10;y2=12;w=16;h=16|>' + '<|mask;x=0;y=0;data=4,4,~!!!|>'),
    );
    await expect(
      new MediaSegmentation(adapter(fetchImpl)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/no usable matches/);
  });

  it('fits images above 2048px before inference and maps boxes back', async () => {
    const width = 3000;
    const height = 2000;
    const src: RgbaImage = { width, height, data: Buffer.alloc(width * height * 4, 128) };
    let sent: { width: number; height: number } | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: { body?: unknown }) => {
      const body = JSON.parse(String((init as { body: string }).body)) as {
        input: Array<{ content: Array<{ image_url?: string }> }>;
      };
      const imageUrl = body.input[0]?.content[1]?.image_url ?? '';
      const decoded = PNG.sync.read(Buffer.from(imageUrl.split(',')[1] ?? '', 'base64'));
      sent = { width: decoded.width, height: decoded.height };
      const box = { x1: 100, y1: 100, x2: 500, y2: 400 };
      return textLane(
        `<0f>0<|box;x1=${box.x1};y1=${box.y1};x2=${box.x2};y2=${box.y2};w=${decoded.width};h=${decoded.height}|>` +
          "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>",
      );
    });
    const result = await new MediaSegmentation(adapter(fetchImpl)).segment(src, 'dot');
    expect(sent).not.toBeNull();
    const sentDims = sent as { width: number; height: number };
    expect(Math.max(sentDims.width, sentDims.height)).toBeLessThanOrEqual(2048);
    expect(result.matches).toHaveLength(1);
    // The parser exposes half-open bounds; mapping must carry them back to
    // the original pixels through the fitted image actually sent.
    const laneBox = parseSegmentLane(
      `<0f>0<|box;x1=100;y1=100;x2=500;y2=400;w=${sentDims.width};h=${sentDims.height}|>` +
        "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>",
    ).matches[0]?.box;
    expect(laneBox).toBeDefined();
    expect(result.matches[0]?.box).toEqual(
      mapBoxToSource(
        laneBox as { x1: number; y1: number; x2: number; y2: number },
        sentDims.width,
        sentDims.height,
        width,
        height,
      ),
    );
  });
});
