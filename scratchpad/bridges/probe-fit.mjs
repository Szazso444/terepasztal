// node scratchpad/bridges/probe-fit.mjs <src> <top|bot> <x0> <x1>   line fit of the silhouette top/bottom over a column range
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [src, side, x0, x1] = process.argv.slice(2);
const p = PNG.sync.read(readFileSync(`assets/source/bridges-v1/${src}.png`));
const pts = [];
for (let x = +x0; x <= +x1; x++) {
  let top = -1, bot = -1;
  for (let y = 0; y < p.height; y++) if (p.data[(y * p.width + x) * 4 + 3] > 150) { if (top < 0) top = y; bot = y; }
  if (top >= 0) pts.push([x, side === 'top' ? top : bot]);
}
const n = pts.length, mx = pts.reduce((a, q) => a + q[0], 0) / n, my = pts.reduce((a, q) => a + q[1], 0) / n;
let sxx = 0, sxy = 0;
for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
const m = sxy / sxx, b = my - m * mx;
const rms = Math.sqrt(pts.reduce((a, [x, y]) => a + (y - m * x - b) ** 2, 0) / n);
console.log(src, side, x0, x1, 'slope', m.toFixed(4), 'y@x0', (m * x0 + b).toFixed(1), 'y@x1', (m * x1 + b).toFixed(1), 'rms', rms.toFixed(2));
