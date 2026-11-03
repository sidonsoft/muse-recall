import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  checkRegions,
  DISTINCT_COLOR_CAP,
  DOMINANCE_MARGIN,
  diffShare,
  IMAGE_PROMPTS,
  MIN_EDIT_DIFF_SHARE,
  measurePng,
} from '../../scripts/lib/image-live.js';

const SIZE = 200;

function frame(draw: (x: number, y: number) => [number, number, number]): PNG {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (SIZE * y + x) << 2;
      const [red, green, blue] = draw(x, y);
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = 255;
    }
  }
  return png;
}

const greenFieldWithRedSquare = (): PNG =>
  frame((x, y) => (x >= 75 && x < 125 && y >= 75 && y < 125 ? [220, 30, 30] : [30, 190, 60]));

describe('measuring a live image instead of trusting that it is fine', () => {
  it('sees both subjects the generate prompt asked for', () => {
    const png = greenFieldWithRedSquare();
    const measurement = measurePng(new Uint8Array(png.data), png.width, png.height);
    const verdict = checkRegions(measurement, IMAGE_PROMPTS.generate.expected);
    expect(verdict.missing).toEqual([]);
    // The red square is 25% on a side, so a quarter of the area's edge cases
    // aside, the shares must be plausibly in that region and not invented.
    expect(verdict.shares.red).toBeGreaterThan(0.05);
    expect(verdict.shares.green).toBeGreaterThan(0.7);
  });

  it('fails a frame that only carries one of the requested colours', () => {
    const allGreen = frame(() => [30, 190, 60]);
    const measurement = measurePng(new Uint8Array(allGreen.data), allGreen.width, allGreen.height);
    const verdict = checkRegions(measurement, IMAGE_PROMPTS.generate.expected);
    expect(verdict.missing).toHaveLength(1);
    // The message has to say what was expected and what was seen, because this
    // is the only evidence a reviewer gets about a paid image call.
    expect(verdict.missing[0]).toContain('red-dominant pixels were 0.0%');
    expect(verdict.missing[0]).toContain('expected at least 2.0%');
  });

  it('applies the same channel margin the measurement reports', () => {
    // A channel counts as dominant only when it leads by DOMINANCE_MARGIN, so a
    // near-grey frame must not be read as any colour at all.
    const grey = frame(() => [120, 118, 121]);
    const measurement = measurePng(new Uint8Array(grey.data), grey.width, grey.height);
    expect(measurement.dominant.red + measurement.dominant.green + measurement.dominant.blue).toBe(
      0,
    );
    expect(DOMINANCE_MARGIN).toBeGreaterThan(0);
  });

  it('counts distinct colours up to a cap, and reports the cap when it is hit', () => {
    const gradient = frame((x, y) => [x % 256, y % 256, (x * 3 + y) % 256]);
    const measurement = measurePng(new Uint8Array(gradient.data), gradient.width, gradient.height);
    expect(measurement.distinctColors).toBe(DISTINCT_COLOR_CAP);
  });

  it('reports mean channels so a washed-out or inverted frame is visible in the record', () => {
    const measurement = measurePng(new Uint8Array(greenFieldWithRedSquare().data), SIZE, SIZE);
    expect(measurement.mean.green).toBeGreaterThan(measurement.mean.red);
    expect(measurement.mean.blue).toBeLessThan(60);
    expect(measurement.pixels).toBe(SIZE * SIZE);
  });
});

describe('proving an edit actually moved pixels', () => {
  it('reads an identical return as no edit at all', () => {
    const png = greenFieldWithRedSquare();
    const share = diffShare(new Uint8Array(png.data), new Uint8Array(png.data), SIZE, SIZE);
    expect(share).toBe(0);
    expect(share).toBeLessThan(MIN_EDIT_DIFF_SHARE);
  });

  it('counts a one-pixel change honestly, and clears the floor for a real edit', () => {
    const base = greenFieldWithRedSquare();
    const edited = frame((x, y) => {
      if (x === 0 && y === 0) return [20, 60, 220];
      return x >= 75 && x < 125 && y >= 75 && y < 125 ? [220, 30, 30] : [30, 190, 60];
    });
    expect(
      diffShare(new Uint8Array(base.data), new Uint8Array(edited.data), SIZE, SIZE),
    ).toBeCloseTo(1 / (SIZE * SIZE), 10);

    // The edit prompt asks for a blue circle over the same scene while keeping
    // the red square and the green field. A plausible rendering clears the
    // change floor and still shows all three colours, which is what the live
    // run asserts on.
    const scene = (x: number, y: number, withBlue: boolean): [number, number, number] => {
      if (withBlue) {
        const dx = x - 145;
        const dy = y - 145;
        if (dx * dx + dy * dy < 900) return [40, 70, 230];
      }
      return x >= 20 && x < 70 && y >= 20 && y < 70 ? [220, 30, 30] : [30, 190, 60];
    };
    const before = frame((x, y) => scene(x, y, false));
    const withCircle = frame((x, y) => scene(x, y, true));
    const share = diffShare(
      new Uint8Array(before.data),
      new Uint8Array(withCircle.data),
      SIZE,
      SIZE,
    );
    expect(share).toBeGreaterThan(MIN_EDIT_DIFF_SHARE);
    const verdict = checkRegions(
      measurePng(new Uint8Array(withCircle.data), SIZE, SIZE),
      IMAGE_PROMPTS.edit.expected,
    );
    expect(verdict.missing).toEqual([]);
  });

  it('counts a half-changed frame as exactly half changed', () => {
    // The arithmetic is exact, so a reported share can be read against the
    // picture. Shape agreement is the caller's job: a differently sized return
    // is a contract change, and the live script refuses it before calling this.
    const halfDark = frame((x) => (x < SIZE / 2 ? [10, 10, 10] : [200, 200, 200]));
    const allLight = frame(() => [200, 200, 200]);
    expect(
      diffShare(new Uint8Array(halfDark.data), new Uint8Array(allLight.data), SIZE, SIZE),
    ).toBe(0.5);
  });
});
