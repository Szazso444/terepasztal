// Preview only: the terrain sheet with its pixel-art sources smoothed into painted contours.
// Same layout as tools/terrain-surfaces.mjs; served in place of the production sheet by capture.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { resample } from '../../tools/illustrated-sprites.mjs';
import { smoothPixelArt } from './pixelfilters.js';
const names = ['grass', 'forest', 'desert', 'taiga', 'swamp', 'water', 'sand', 'rock', 'city', 'mountain'];
const WINDOW = [0.25, 0.3, 0.75, 0.7];
const CELL = 512;
function axis(src, length, lines, stride, step, from, to, size) {
  const out = new Float32Array(size * lines * 4),
    scale = (to - from) / size;
  for (let line = 0; line < lines; line++)
    for (let i = 0; i < size; i++)
      for (let c = 0; c < 4; c++) {
        let value = 0;
        if (scale > 1) {
          const a = from + i * scale,
            b = a + scale;
          for (let p = Math.floor(a); p < Math.ceil(b); p++)
            value +=
              src[(line * stride + Math.min(p, length - 1) * step) * 4 + c] *
              (Math.min(p + 1, b) - Math.max(p, a));
          value /= scale;
        } else {
          const t = from + (i + 0.5) * scale - 0.5,
            p = Math.max(0, Math.floor(t)),
            u = t - p,
            q = Math.min(p + 1, length - 1);
          value =
            src[(line * stride + p * step) * 4 + c] * (1 - u) +
            src[(line * stride + q * step) * 4 + c] * u;
        }
        out[(line * size + i) * 4 + c] = value;
      }
  return out;
}
function crop(src, [x0, y0, x1, y1]) {
  const rows = axis(
    src.data,
    src.width,
    src.height,
    src.width,
    1,
    x0 * src.width,
    x1 * src.width,
    CELL,
  );
  // `rows` is height lines of CELL pixels; resample each column across those lines.
  const columns = axis(rows, src.height, CELL, 1, CELL, y0 * src.height, y1 * src.height, CELL);
  const out = new PNG({ width: CELL, height: CELL });
  for (let x = 0; x < CELL; x++)
    for (let y = 0; y < CELL; y++)
      for (let c = 0; c < 4; c++)
        out.data[(y * CELL + x) * 4 + c] = Math.round(columns[(x * CELL + y) * 4 + c]);
  return out;
}

const sheet = new PNG({ width: CELL, height: CELL * names.length });
for (const [i, name] of names.entries()) {
  const rock = ['rock', 'mountain'].includes(name);
  const source = rock
    ? 'assets/source/terrain-production/rock-surface.png'
    : name === 'city'
      ? 'assets/source/base-v1/people-road-stone.png'
      : `assets/source/base-v1/terrain-${name}.png`;
  const png = PNG.sync.read(readFileSync(source));
  if (!rock) {
    // Art pixels are about four source pixels; a radius of three rounds their steps.
    png.data = Buffer.from(smoothPixelArt(png.data, png.width, png.height, 3));
  }
  const p = rock ? resample(png, CELL, CELL) : crop(png, WINDOW);
  p.data.copy(sheet.data, i * CELL * CELL * 4);
  console.log('smoothed', name);
}
writeFileSync('scratchpad/style-options/terrain-surfaces-smooth.png', PNG.sync.write(sheet));
