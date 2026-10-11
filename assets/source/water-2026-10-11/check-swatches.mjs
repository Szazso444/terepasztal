import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const root = new URL('./', import.meta.url);
const manifest = new URL('prompts.json', root);
const prompts = JSON.parse(readFileSync(manifest, 'utf8'));
mkdirSync(new URL('review/', root), { recursive: true });
const checks = [];
for (const entry of prompts.filter((entry) =>
  ['lake-water', 'river-water', 'beach-sand', 'wet-sand', 'river-bank'].includes(entry.id),
)) {
  const bytes = readFileSync(new URL(entry.file, root));
  const png = PNG.sync.read(bytes);
  entry.returned = [png.width, png.height];
  let opaque = true;
  for (let i = 3; i < png.data.length; i += 4) opaque &&= png.data[i] === 255;
  if (!opaque) throw new Error(`${entry.file}: non-opaque painting`);
  // Review copies only: whole-image area reduction, no changes to source paintings.
  const width = 199;
  const height = Math.round((width * png.height) / png.width);
  const preview = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0];
      let total = 0;
      const x0 = (x * png.width) / width;
      const x1 = ((x + 1) * png.width) / width;
      const y0 = (y * png.height) / height;
      const y1 = ((y + 1) * png.height) / height;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight =
            (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          const offset = (sy * png.width + sx) * 4;
          for (let c = 0; c < 3; c++) sums[c] += png.data[offset + c] * weight;
          total += weight;
        }
      }
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) preview.data[offset + c] = Math.round(sums[c] / total);
      preview.data[offset + 3] = 255;
    }
  }
  writeFileSync(new URL(`review/${entry.file}`, root), PNG.sync.write(preview));
  checks.push({
    file: entry.file,
    returned: entry.returned,
    opaque,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    review: [width, height],
  });
}
writeFileSync(manifest, `${JSON.stringify(prompts, null, 2)}\n`);
writeFileSync(new URL('review/checks.json', root), `${JSON.stringify(checks, null, 2)}\n`);
console.log(
  JSON.stringify(checks.map(({ file, returned, opaque }) => ({ file, returned, opaque }))),
);
