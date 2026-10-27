/**
 * Capture quality checks.
 *
 * A WebGL canvas read at the wrong time yields a black frame that passes every
 * structural check. These helpers reject images with no luminance range or
 * colour variety before they are attached to a model request.
 */

export interface CaptureAnalysis {
  min: number;
  max: number;
  colourful: number;
  blank: boolean;
}

export function analysePixels(pixels: ArrayLike<number>): CaptureAnalysis {
  let min = 255;
  let max = 0;
  let colourful = 0;
  const total = Math.floor(pixels.length / 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) colourful += 1;
  }
  return {
    min,
    max,
    colourful,
    blank: max - min < 8 || (total > 0 && colourful / total < 0.005),
  };
}

export async function isBlankCapture(dataUrl: string): Promise<boolean> {
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return true;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return true;
  context.drawImage(image, 0, 0, 64, 64);
  return analysePixels(context.getImageData(0, 0, 64, 64).data).blank;
}
