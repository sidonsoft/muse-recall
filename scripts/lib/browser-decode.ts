/**
 * Decode a stored image with a real browser and hand the pixels back to Node.
 *
 * The live image model returns VP8X WebP, not PNG, so a PNG-only measurement
 * path cannot see what was actually stored. Rather than add a decoder
 * dependency, the run asks the same browser engine that renders the product to
 * decode the bytes, and reports the natural size it saw. That cross-check is
 * not decoration: the product's own WebP header parsing was wrong, and a stored
 * 1600x1600 frame was recorded as 1x1600. A decoder that agrees with the
 * manifest is what would have caught it.
 */
import type { Browser } from 'playwright-core';

export const MAX_MEASURE_SIDE = 1600;

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Natural (undecoded-scaling) size the browser saw. */
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly rgba: Uint8Array;
  /** 1 means the pixels are the image's own size. */
  readonly scale: number;
}

export interface DecodePayload {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly base64: string;
}

export function decodeRgbaPayload(payload: DecodePayload): DecodedImage {
  const rgba = new Uint8Array(Buffer.from(payload.base64, 'base64'));
  const expected = payload.width * payload.height * 4;
  if (rgba.byteLength !== expected) {
    throw new Error(
      `the decoded frame carried ${String(rgba.byteLength)} bytes for a ${String(payload.width)}x${String(payload.height)} canvas, expected ${String(expected)}`,
    );
  }
  return {
    width: payload.width,
    height: payload.height,
    naturalWidth: payload.naturalWidth,
    naturalHeight: payload.naturalHeight,
    rgba,
    scale: payload.scale,
  };
}

/**
 * Draw the bytes into a canvas and read them back. Large frames are scaled down
 * to `maxSide`, with the factor reported, so a huge image cannot turn the run
 * into an unbounded transfer.
 */
export async function decodeImageWithBrowser(
  browser: Browser,
  mime: string,
  bytes: Uint8Array,
  maxSide: number = MAX_MEASURE_SIDE,
): Promise<DecodedImage> {
  const page = await browser.newPage();
  try {
    const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    const payload = (await page.evaluate(
      `(async () => {
        const url = ${JSON.stringify(dataUrl)};
        const maxSide = ${String(maxSide)};
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('the browser could not decode the stored bytes'));
        });
        image.src = url;
        await loaded;
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        if (naturalWidth === 0 || naturalHeight === 0) {
          throw new Error('the browser decoded a zero-sized image');
        }
        const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2d context unavailable');
        context.drawImage(image, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        let binary = '';
        const chunk = 0x8000;
        for (let index = 0; index < frame.data.length; index += chunk) {
          binary += String.fromCharCode.apply(
            null,
            frame.data.subarray(index, Math.min(index + chunk, frame.data.length)),
          );
        }
        return {
          naturalWidth,
          naturalHeight,
          width,
          height,
          scale,
          base64: btoa(binary),
        };
      })()`,
    )) as DecodePayload;
    return decodeRgbaPayload(payload);
  } finally {
    await page.close();
  }
}
