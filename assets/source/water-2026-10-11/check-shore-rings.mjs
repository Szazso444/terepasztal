// Inspect originals without modifying them. Only QA previews are area-reduced.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.join(folder, 'prompts.json');
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
const qa = path.join(folder, 'qa');
fs.mkdirSync(qa, { recursive: true });
const report = [];
for (const file of ['lake-ring.png', 'beach-ring.png']) {
  const bytes = fs.readFileSync(path.join(folder, file));
  const source = PNG.sync.read(bytes);
  const entry = prompts.findLast((item) => item.file === file);
  entry.returned = [source.width, source.height];
  const preview = new PNG({ width: 128, height: 128 });
  const alpha = { transparent: 0, partial: 0, opaque: 0 };
  for (let i = 3; i < source.data.length; i += 4) {
    alpha[source.data[i] === 0 ? 'transparent' : source.data[i] === 255 ? 'opaque' : 'partial']++;
  }
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const sums = [0, 0, 0];
      let totalAlpha = 0;
      let area = 0;
      const x0 = (x * source.width) / 128;
      const x1 = ((x + 1) * source.width) / 128;
      const y0 = (y * source.height) / 128;
      const y1 = ((y + 1) * source.height) / 128;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight =
            (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
          const index = (sy * source.width + sx) * 4;
          const a = source.data[index + 3] / 255;
          area += weight;
          totalAlpha += a * weight;
          for (let c = 0; c < 3; c++) sums[c] += source.data[index + c] * a * weight;
        }
      }
      const p = (y * 128 + x) * 4;
      for (let c = 0; c < 3; c++)
        preview.data[p + c] = totalAlpha ? Math.round(sums[c] / totalAlpha) : 0;
      preview.data[p + 3] = Math.round((totalAlpha / area) * 255);
    }
  }
  const previewFile = file.replace('.png', '-128.png');
  fs.writeFileSync(path.join(qa, previewFile), PNG.sync.write(preview, { colorType: 6 }));
  report.push({
    file,
    returned: entry.returned,
    pngColorType: bytes[25],
    alpha,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    preview: `qa/${previewFile}`,
  });
}
fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2) + '\n');
fs.writeFileSync(path.join(qa, 'shore-png-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
