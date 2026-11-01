import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { resample } from '../../../tools/illustrated-sprites.mjs';

const read = (p) => PNG.sync.read(readFileSync(p));
const alpha = (p, x, y) => p.data[(y * p.width + x) * 4 + 3] > 128;
function measure(p) {
  let bottom = -1;
  for (let y = p.height - 1; y >= 0 && bottom < 0; y--)
    for (let x = 0; x < p.width; x++)
      if (alpha(p, x, y)) {
        bottom = y;
        break;
      }
  if (bottom < 5) throw new Error('Empty or too short');
  const row = (y) => Array.from({ length: p.width }, (_, x) => x).filter((x) => alpha(p, x, y));
  const foot = row(bottom - 5);
  const centre = (foot[0] + foot.at(-1)) / 2;
  let top = -1;
  for (let y = 0; y <= bottom && top < 0; y++)
    for (let x = Math.ceil(centre - 60); x <= Math.floor(centre + 60); x++)
      if (x >= 0 && x < p.width && alpha(p, x, y)) {
        top = y;
        break;
      }
  const runY = Math.round(top + 0.9 * (bottom - top));
  let best = [0, -1],
    start = -1;
  for (let x = 0; x <= p.width; x++) {
    if (x < p.width && alpha(p, x, runY)) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - 1 - start > best[1] - best[0]) best = [start, x - 1];
      start = -1;
    }
  }
  return {
    bottom,
    footCentre: centre,
    top,
    runY,
    run: best,
    runLength: best[1] - best[0],
    runCentre: (best[0] + best[1]) / 2,
  };
}
const input = process.argv[2];
if (!input) throw new Error('Usage: node register-body.mjs <picture>');
const src = read(input),
  m = measure(src);
const sv = 807 / (m.bottom - m.top),
  sh = 426 / m.runLength;
const scaled = resample(src, Math.round(src.width * sv), Math.round(src.height * sv));
const sm = measure(scaled);
const shift = [Math.round(772 - sm.runCentre), 1003 - sm.bottom];
const out = new PNG({ width: 1498, height: 1050 });
for (let y = 0; y < scaled.height; y++)
  for (let x = 0; x < scaled.width; x++) {
    const xx = x + shift[0],
      yy = y + shift[1];
    if (xx >= 0 && xx < out.width && yy >= 0 && yy < out.height)
      scaled.data.copy(
        out.data,
        (yy * out.width + xx) * 4,
        (y * scaled.width + x) * 4,
        (y * scaled.width + x + 1) * 4,
      );
  }
const master = read('assets/source/base-v1/windmill.png');
let intersection = 0,
  union = 0;
for (let y = 905; y <= 1003; y++)
  for (let x = 0; x < out.width; x++) {
    const a = alpha(out, x, y),
      b = alpha(master, x, y);
    if (a && b) intersection++;
    if (a || b) union++;
  }
const overlap = intersection / union,
  finialTop = measure(out).top;
const attempt = /windmill-a0-r0-attempt-(\d+)\.png$/.exec(input)?.[1] ?? 'test';
const folder = new URL(`registered/${attempt}/`, import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('windmill-a0-r0.png', folder), PNG.sync.write(out));
const failures = [];
if (Math.abs(sv / sh - 1) > 0.02)
  failures.push('vertical and horizontal scales disagree by more than 2%');
if (overlap < 0.9) failures.push('lower silhouette overlap below 0.90');
if (Math.abs(finialTop - 196) > 3) failures.push('finial top outside 196 ± 3');
console.log(
  JSON.stringify(
    { returned: [src.width, src.height], source: m, sv, sh, shift, overlap, finialTop, failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
