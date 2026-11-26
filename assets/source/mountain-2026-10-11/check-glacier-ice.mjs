import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!/^raw\/glacier-ice-attempt-\d+\.png$/.test(file ?? ''))
  throw new Error('Expected raw attempt path');
const p = PNG.sync.read(readFileSync(join(root, file)));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const threshold = luma(142, 158, 167);
const mask = new Uint8Array(p.width * p.height);
let minAlpha = 255,
  minBorderAlpha = 255,
  dark = 0;
for (let y = 0; y < p.height; y++)
  for (let x = 0; x < p.width; x++) {
    const n = y * p.width + x,
      i = n * 4,
      a = p.data[i + 3];
    minAlpha = Math.min(minAlpha, a);
    if (x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1)
      minBorderAlpha = Math.min(minBorderAlpha, a);
    if (luma(...p.data.subarray(i, i + 3)) < threshold) {
      mask[n] = 1;
      dark++;
    }
  }
// Dark-component boxes assist the full-size visual crack review; they are not a skeleton length test.
const components = [];
for (let n = 0; n < mask.length; n++) {
  if (!mask[n]) continue;
  mask[n] = 0;
  const queue = [n];
  let minX = p.width,
    minY = p.height,
    maxX = 0,
    maxY = 0;
  for (let head = 0; head < queue.length; head++) {
    const q = queue[head],
      x = q % p.width,
      y = Math.floor(q / p.width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy,
          next = ny * p.width + nx;
        if (nx >= 0 && nx < p.width && ny >= 0 && ny < p.height && mask[next]) {
          mask[next] = 0;
          queue.push(next);
        }
      }
  }
  if (queue.length >= 8)
    components.push({
      pixels: queue.length,
      box: [minX, minY, maxX, maxY],
      diagonal: Math.hypot(maxX - minX + 1, maxY - minY + 1),
    });
}
components.sort((a, b) => b.diagonal - a.diagonal);
const measured = {
  darkerThanShadeShare: dark / (p.width * p.height),
  darkerThanShadeDefinition: 'Rec.709 encoded RGB luma < luma(#8E9EA7)',
  shadeLuma: threshold,
  minAlpha,
  minBorderAlpha,
  opacityPass: minAlpha >= 251 && minBorderAlpha >= 251,
  darkComponentsAtLeast8Pixels: components.length,
  largestDarkComponentDiagonalAt1024: ((components[0]?.diagonal ?? 0) * 1024) / p.width,
  longestDarkComponents: components.slice(0, 8),
};
const thumb = new PNG({ width: 199, height: 199 });
for (let y = 0; y < 199; y++)
  for (let x = 0; x < 199; x++) {
    const x0 = (x * p.width) / 199,
      x1 = ((x + 1) * p.width) / 199;
    const y0 = (y * p.height) / 199,
      y1 = ((y + 1) * p.height) / 199;
    const sum = [0, 0, 0, 0];
    let weight = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
      for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const w =
          (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
        const i = (sy * p.width + sx) * 4;
        weight += w;
        for (let c = 0; c < 4; c++) sum[c] += p.data[i + c] * w;
      }
    const i = (y * 199 + x) * 4;
    for (let c = 0; c < 4; c++) thumb.data[i + c] = Math.round(sum[c] / weight);
  }
const name = file.slice(4, -4);
writeFileSync(join(root, 'review', name + '-199.png'), PNG.sync.write(thumb));
writeFileSync(
  join(root, 'review', name + '-checks.json'),
  JSON.stringify(measured, null, 2) + '\n',
);
const path = join(root, 'prompts.json');
const jobs = JSON.parse(readFileSync(path, 'utf8'));
const job = jobs.find((j) => j.file === file);
if (!job) throw new Error('No prompt for ' + file);
job.returned = [p.width, p.height];
job.measured = measured;
writeFileSync(path, JSON.stringify(jobs, null, 2) + '\n');
console.log(JSON.stringify({ file, returned: job.returned, ...measured }));
