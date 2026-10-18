import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
export const root = path.dirname(fileURLToPath(import.meta.url));
export const read = (relative) => PNG.sync.read(fs.readFileSync(path.resolve(root, relative)));
export function write(relative, png) {
  const target = path.resolve(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, PNG.sync.write(png));
}
export function json(relative) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relative), 'utf8'));
}
export function saveJson(relative, value) {
  fs.mkdirSync(path.dirname(path.resolve(root, relative)), { recursive: true });
  fs.writeFileSync(path.resolve(root, relative), JSON.stringify(value, null, 2) + '\n');
}
export function box(png, threshold = 128) {
  let x = png.width,
    y = png.height,
    x1 = -1,
    y1 = -1;
  for (let j = 0; j < png.height; j++)
    for (let i = 0; i < png.width; i++)
      if (png.data[(j * png.width + i) * 4 + 3] > threshold) {
        x = Math.min(x, i);
        y = Math.min(y, j);
        x1 = Math.max(x1, i);
        y1 = Math.max(y1, j);
      }
  if (x1 < 0) throw Error('Empty foreground');
  return { x, y, width: x1 - x + 1, height: y1 - y + 1 };
}
// Exact area integration in premultiplied alpha. One uniform scale, with no silhouette recentering.
export function resample(
  source,
  width,
  height,
  scale,
  sourceAnchor,
  targetAnchor,
  { cleanAlpha = true } = {},
) {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = (x - targetAnchor[0]) / scale + sourceAnchor[0],
        x1 = x0 + 1 / scale;
      const y0 = (y - targetAnchor[1]) / scale + sourceAnchor[1],
        y1 = y0 + 1 / scale;
      if (x1 <= 0 || y1 <= 0 || x0 >= source.width || y0 >= source.height) continue;
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (
        let sy = Math.max(0, Math.floor(y0));
        sy < Math.min(source.height, Math.ceil(y1));
        sy++
      ) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (
          let sx = Math.max(0, Math.floor(x0));
          sx < Math.min(source.width, Math.ceil(x1));
          sx++
        ) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx)),
            p = (sy * source.width + sx) * 4;
          let alpha = source.data[p + 3] / 255;
          if (cleanAlpha) {
            if (source.data[p + 3] < 16) alpha = 0;
            else if (source.data[p + 3] >= 200) alpha = 1;
          }
          const weight = w * alpha;
          a += weight;
          r += source.data[p] * weight;
          g += source.data[p + 1] * weight;
          b += source.data[p + 2] * weight;
        }
      }
      const p = (y * width + x) * 4,
        alpha = Math.round(a * scale * scale * 255);
      if (alpha) {
        out.data[p] = Math.round(r / a);
        out.data[p + 1] = Math.round(g / a);
        out.data[p + 2] = Math.round(b / a);
        out.data[p + 3] = alpha;
      }
    }
  return out;
}
export function place(target, source, left, top) {
  for (let y = 0; y < source.height; y++)
    source.data.copy(
      target.data,
      ((y + top) * target.width + left) * 4,
      y * source.width * 4,
      (y + 1) * source.width * 4,
    );
}
export { PNG };
