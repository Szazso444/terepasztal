import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

// QA thumbnails only. Original source paintings are never modified.
const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'review');
mkdirSync(out, { recursive: true });
const names = [
  'glacier-strip-x',
  'glacier-strip-y',
  'glacier-lobe',
  'ice-cliff-lit',
  'ice-cliff-shade',
  'ice-portal-lit',
  'ice-portal-shade',
];
const prompts = JSON.parse(readFileSync(join(root, 'prompts.json'), 'utf8').replace(/^\uFEFF/, ''));
const report = [];
const sheet = new PNG({ width: 640, height: 160 });
for (let y = 0; y < sheet.height; y++)
  for (let x = 0; x < sheet.width; x++) {
    const i = (y * sheet.width + x) * 4,
      v = ((x >> 3) + (y >> 3)) % 2 ? 91 : 104;
    sheet.data.set([v, v, v, 255], i);
  }
function reduce(source, w, h) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = (x * source.width) / w,
        x1 = ((x + 1) * source.width) / w;
      const y0 = (y * source.height) / h,
        y1 = ((y + 1) * source.height) / h;
      let total = 0,
        alpha = 0;
      const rgb = [0, 0, 0];
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const area =
            (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          const i = (sy * source.width + sx) * 4,
            a = source.data[i + 3] / 255;
          total += area;
          alpha += a * area;
          for (let c = 0; c < 3; c++) rgb[c] += source.data[i + c] * a * area;
        }
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) p.data[i + c] = alpha ? Math.round(rgb[c] / alpha) : 0;
      p.data[i + 3] = Math.round((alpha / total) * 255);
    }
  return p;
}
for (let k = 0; k < names.length; k++) {
  const name = names[k],
    file = name + '.png',
    bytes = readFileSync(join(root, file));
  const p = PNG.sync.read(bytes);
  let zero = 0,
    partial = 0,
    opaque = 0;
  for (let i = 3; i < p.data.length; i += 4) {
    if (p.data[i] === 0) zero++;
    else if (p.data[i] === 255) opaque++;
    else partial++;
  }
  if (name.startsWith('ice-cliff') && opaque !== p.width * p.height)
    throw new Error(file + ' must be fully opaque');
  const job = prompts.findLast((j) => j.file === file);
  if (!job) throw new Error('Missing provenance for ' + file);
  job.returned = [p.width, p.height];
  const size = k < 3 ? [128, 128] : [36, 39],
    thumb = reduce(p, ...size);
  writeFileSync(join(out, name + '-game-scale.png'), PNG.sync.write(thumb));
  const ox = k < 3 ? k * 144 + 8 : 440 + (k - 3) * 48,
    oy = k < 3 ? 16 : 60;
  for (let y = 0; y < thumb.height; y++)
    for (let x = 0; x < thumb.width; x++) {
      const si = (y * thumb.width + x) * 4,
        di = ((oy + y) * sheet.width + ox + x) * 4,
        a = thumb.data[si + 3] / 255;
      for (let c = 0; c < 3; c++)
        sheet.data[di + c] = Math.round(thumb.data[si + c] * a + sheet.data[di + c] * (1 - a));
    }
  report.push({
    file,
    returned: job.returned,
    alpha: { zero, partial, opaque },
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reviewSize: size,
  });
}
writeFileSync(join(root, 'prompts.json'), JSON.stringify(prompts, null, 2) + '\n');
writeFileSync(join(out, 'game-scale-sheet.png'), PNG.sync.write(sheet));
writeFileSync(join(out, 'png-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.map(({ file, returned, alpha }) => ({ file, returned, alpha }))));
