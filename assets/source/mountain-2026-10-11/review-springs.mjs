// Review copies only: source paintings are never changed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(dir, 'review'), { recursive: true });
const prompts = JSON.parse(fs.readFileSync(path.join(dir, 'prompts.json'), 'utf8'));
// prompts.json also lists the swatches and the glacier; this script reviews the C13 springs.
const springs = prompts.filter((p) => /^(raw\/)?spring-(ne|se|sw|nw)\b/.test(p.file));
const report = [];
for (const entry of springs) {
  if (entry.generationError && !fs.existsSync(path.join(dir, entry.file))) continue;
  const bytes = fs.readFileSync(path.join(dir, entry.file));
  const png = PNG.sync.read(bytes);
  if (bytes[25] !== 6) throw new Error(`${entry.file} is not an RGBA PNG`);
  entry.returned = [png.width, png.height];
  let transparent = 0,
    partial = 0,
    opaque = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] === 0) transparent++;
    else if (png.data[i] === 255) opaque++;
    else partial++;
  }
  if (!transparent || !opaque)
    throw new Error(`${entry.file}: missing transparent background or painted pixels`);
  report.push({
    file: entry.file,
    returned: entry.returned,
    rgba: true,
    alphaPixels: { transparent, partial, opaque },
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  if (entry.file.startsWith('raw/') && !entry.selected) continue;
  const size = entry.centred ? 64 : 128;
  const outputFile = entry.selected
    ? entry.id.match(/^spring-(ne|se|sw|nw)/)[0] + '.png'
    : entry.file;
  const dst = new PNG({ width: size, height: size });
  // Area-average in premultiplied alpha, preserving the full canvas without cropping.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const x0 = (x * png.width) / size,
        x1 = ((x + 1) * png.width) / size;
      const y0 = (y * png.height) / size,
        y1 = ((y + 1) * png.height) / size;
      let area = 0,
        a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w =
            (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          const i = (sy * png.width + sx) * 4,
            wa = (w * png.data[i + 3]) / 255;
          area += w;
          a += wa;
          r += wa * png.data[i];
          g += wa * png.data[i + 1];
          b += wa * png.data[i + 2];
        }
      const i = (y * size + x) * 4;
      dst.data.set(
        [
          a ? Math.round(r / a) : 0,
          a ? Math.round(g / a) : 0,
          a ? Math.round(b / a) : 0,
          Math.round((a / area) * 255),
        ],
        i,
      );
    }
  fs.writeFileSync(path.join(dir, 'review', outputFile), PNG.sync.write(dst));
}
fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify(prompts, null, 2) + '\n');
fs.writeFileSync(
  path.join(dir, 'review/verification.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(report.map(({ file, returned }) => ({ file, returned })));
