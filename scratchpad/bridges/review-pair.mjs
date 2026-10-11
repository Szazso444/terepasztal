// Review helper: put PNGs side by side (each optionally cropped and box-downscaled) into one PNG.
//   node review-pair.mjs <out.png> <scale> <a.png[:x,y,w,h]> <b.png[:x,y,w,h]> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [out, scaleArg, ...items] = process.argv.slice(2);
const k = +scaleArg; // integer downscale factor (1 = none)
const tiles = items.map((it) => {
  const m = /^(.*?)(?::(\d+),(\d+),(\d+),(\d+))?$/.exec(it);
  const src = PNG.sync.read(readFileSync(m[1]));
  const x0 = +(m[2] ?? 0), y0 = +(m[3] ?? 0), w = +(m[4] ?? src.width), h = +(m[5] ?? src.height);
  const W = Math.floor(w / k), H = Math.floor(h / k), d = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) {
          const sx = Math.min(src.width - 1, x0 + x * k + dx), sy = Math.min(src.height - 1, y0 + y * k + dy), i = (sy * src.width + sx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
        }
      const o = (y * W + x) * 4;
      d.data[o] = r / n; d.data[o + 1] = g / n; d.data[o + 2] = b / n; d.data[o + 3] = 255;
    }
  return d;
});
const gap = 6, W = tiles.reduce((a, t) => a + t.width, 0) + gap * (tiles.length - 1), H = Math.max(...tiles.map((t) => t.height));
const dst = new PNG({ width: W, height: H });
dst.data.fill(40);
for (let i = 3; i < dst.data.length; i += 4) dst.data[i] = 255;
let ox = 0;
for (const t of tiles) {
  for (let y = 0; y < t.height; y++) t.data.copy(dst.data, (y * W + ox) * 4, y * t.width * 4, (y + 1) * t.width * 4);
  ox += t.width + gap;
}
writeFileSync(out, PNG.sync.write(dst));
console.log(out, W, H);
