import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const folder = dirname(fileURLToPath(import.meta.url));
export function measure(file) {
  const p = PNG.sync.read(readFileSync(file));
  const s = p.width / 1024;
  const corners = [0, p.width - 1, (p.height - 1) * p.width, p.width * p.height - 1].map(
    (i) => p.data[i * 4 + 3],
  );
  if (p.width !== p.height || corners.every((a) => a > 128))
    return {
      returned: [p.width, p.height],
      boxPass: false,
      failure: 'Non-square or opaque background; not measured',
    };
  const g = PNG.sync.read(readFileSync(resolve(folder, 'guides/stone-deck-x-narrow-centred.png')));
  let left = p.width,
    right = -1,
    top = p.height,
    bottom = -1,
    count = 0,
    intersection = 0,
    union = 0,
    transparent = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const a = p.data[(y * p.width + x) * 4 + 3];
      if (a === 0) transparent++;
      const painted = a > 128;
      const guide =
        g.data[
          (Math.min(1023, Math.floor(y / s)) * 1024 + Math.min(1023, Math.floor(x / s))) * 4 + 3
        ] > 128;
      if (painted) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        count++;
      }
      if (painted && guide) intersection++;
      if (painted || guide) union++;
    }
  if (!count)
    return { returned: [p.width, p.height], boxPass: false, failure: 'Empty painted box' };
  let sum = 0,
    n = 0;
  for (let x = left; x <= right; x++)
    if (p.data[(bottom * p.width + x) * 4 + 3] > 128) {
      sum += x;
      n++;
    }
  const low = sum / n,
    ratio = (right - low) / (low - left),
    width = right - left,
    height = bottom - top;
  const centre = [(left + right) / 2, (top + bottom) / 2],
    centreDistance = Math.hypot(centre[0] - 512 * s, centre[1] - 512 * s);
  const boxPass =
    Math.abs(width - 768 * s) <= 768 * s * 0.05 &&
    Math.abs(height - 534 * s) <= 534 * s * 0.05 &&
    centreDistance <= 38 * s;
  return {
    returned: [p.width, p.height],
    scale: s,
    threshold: 'alpha > 128',
    box: { left, right, top, bottom, width, height, centre },
    expected: {
      left: 128 * s,
      right: 896 * s,
      top: 245 * s,
      bottom: 779 * s,
      width: 768 * s,
      height: 534 * s,
    },
    centreDistance,
    lowestRowMeanX: low,
    sideSpan: low - left,
    cutEndSpan: right - low,
    widthTiles: ratio,
    iou: intersection / union,
    transparentPixels: transparent,
    cornerAlpha: corners,
    boxPass,
    widthPass: ratio >= 0.58 && ratio <= 0.62,
    overlapPass: intersection / union >= 0.9,
    joints: 'Requires visual three-copy review',
    numericPass: boxPass && ratio >= 0.58 && ratio <= 0.62 && intersection / union >= 0.9,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  for (const file of process.argv.slice(2))
    console.log(JSON.stringify({ file, ...measure(resolve(file)) }, null, 2));
