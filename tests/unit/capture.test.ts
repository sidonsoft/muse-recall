import { describe, expect, it } from 'vitest';
import { analysePixels } from '../../apps/web/src/lib/capture.ts';

function pixels(fn: (index: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let index = 0; index < 64 * 64; index += 1) {
    const [r, g, b] = fn(index);
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = 255;
  }
  return data;
}

describe('capture analysis', () => {
  it('rejects an all-black frame (the WebGL capture failure)', () => {
    expect(analysePixels(pixels(() => [0, 0, 0])).blank).toBe(true);
  });

  it('rejects a single-colour frame', () => {
    expect(analysePixels(pixels(() => [240, 220, 160])).blank).toBe(true);
  });

  it('accepts a rendered scene with shapes', () => {
    const result = analysePixels(
      pixels((index) => {
        const x = index % 64;
        const y = Math.floor(index / 64);
        if (x < 24 && y < 24) return [255, 90, 90];
        if (x > 40 && y < 32) return [70, 160, 255];
        if (y > 44) return [60, 170, 80];
        return [250, 230, 190];
      }),
    );
    expect(result.blank).toBe(false);
    expect(result.max - result.min).toBeGreaterThan(50);
    expect(result.colourful).toBeGreaterThan(500);
  });
});
