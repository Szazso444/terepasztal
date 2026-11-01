import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.join(dir, 'prompts.json');
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
// prompts.json also lists the glacier and spring paintings; this script reviews the C11 swatches.
const swatchFiles = [
  'snow.png',
  'mountain-rock-high.png',
  'alpine-ground.png',
  'glacier-ice.png',
  'moraine.png',
];
const swatches = prompts.filter((p) => swatchFiles.includes(p.file));
const size = 199;
const sheet = new PNG({ width: size * swatchFiles.length, height: size });
const report = [];
fs.mkdirSync(path.join(dir, 'review'), { recursive: true });
for (const [index, entry] of swatches.entries()) {
  const bytes = fs.readFileSync(path.join(dir, entry.file));
  const src = PNG.sync.read(bytes);
  entry.returned = [src.width, src.height];
  let transparentPixels = 0;
  let cursorOrBrighterPixels = 0;
  const cursorLuma = 0.2126 * 236 + 0.7152 * 228 + 0.0722 * 208;
  let maximumLuma = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] !== 255) transparentPixels++;
    const luma = 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
    maximumLuma = Math.max(maximumLuma, luma);
    if (luma >= cursorLuma) cursorOrBrighterPixels++;
  }
  const preview = new PNG({ width: size, height: size });
  // Area-average review copies only; originals are never modified.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0];
      let weight = 0;
      const x0 = (x * src.width) / size;
      const x1 = ((x + 1) * src.width) / size;
      const y0 = (y * src.height) / size;
      const y1 = ((y + 1) * src.height) / size;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w =
            (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          const offset = (sy * src.width + sx) * 4;
          for (let c = 0; c < 4; c++) totals[c] += src.data[offset + c] * w;
          weight += w;
        }
      }
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        preview.data[offset + c] = Math.round(totals[c] / weight);
        sheet.data[(y * sheet.width + index * size + x) * 4 + c] = preview.data[offset + c];
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'review', entry.file), PNG.sync.write(preview));
  report.push({
    file: entry.file,
    returned: entry.returned,
    transparentPixels,
    cursorOrBrighterPixels,
    maximumLuma,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}
fs.writeFileSync(promptsPath, `${JSON.stringify(prompts, null, 2)}\n`);
fs.writeFileSync(path.join(dir, 'review/materials-sheet.png'), PNG.sync.write(sheet));
fs.writeFileSync(
  path.join(dir, 'review/validation.json'),
  `${JSON.stringify(
    {
      reviewWidth: size,
      approximateGameTileWidth: 64,
      order: swatches.map((p) => p.file),
      images: report,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(report));
