// Draw what the fit takes for a picture's foot: the lowest pixel of every column (white), the two
// base lines (red: lower left, blue: lower right) and the corners w, s, e (yellow squares), on
// the picture over grey. For seeing why a camera was read as it was.
//   node .cache/foot_probe.mjs <picture.png> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../tools/building-fit.mjs';

const [file, out] = process.argv.slice(2);
const png = PNG.sync.read(readFileSync(file));
const m = measureBase(png);
const img = new PNG({ width: png.width, height: png.height });
for (let i = 0; i < png.data.length; i += 4) {
  const a = png.data[i + 3] / 255;
  for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(png.data[i + c] * a + 120 * (1 - a));
  img.data[i + 3] = 255;
}
const dot = (x, y, [r, g, b], size = 1) => {
  for (let dy = -size; dy <= size; dy++)
    for (let dx = -size; dx <= size; dx++) {
      const X = Math.round(x) + dx,
        Y = Math.round(y) + dy;
      if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue;
      const i = (Y * img.width + X) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
    }
};
for (let x = m.minX; x <= m.maxX; x++) if (m.low[x] >= 0) dot(x, m.low[x] + 3, [255, 255, 255]);
const line = (a, p, from, to, colour) => {
  for (let x = from; x <= to; x++) dot(x, p[1] + a * (x - p[0]) + 12, colour);
};
line(m.slopes[0], m.s, m.w[0], m.s[0], [255, 40, 40]);
line(m.slopes[1], m.s, m.s[0], m.e[0], [60, 120, 255]);
for (const p of [m.w, m.s, m.e]) dot(p[0], p[1], [255, 230, 0], 6);
writeFileSync(out, PNG.sync.write(img));
console.log(JSON.stringify({ sure: m.sure, slopes: m.slopes.map((s) => +s.toFixed(3)), w: m.w.map(Math.round), s: m.s.map(Math.round), e: m.e.map(Math.round), minX: m.minX, maxX: m.maxX }));
