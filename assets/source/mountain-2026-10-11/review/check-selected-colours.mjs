// Read-only inspection of source pixels; records results, never alters PNGs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const promptsPath = path.join(dir, 'prompts.json');
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
const reports = [];
for (const p of prompts.filter((p) => p.selected && p.centred)) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, p.file)));
  const s = png.width / 1024;
  const result = {
    aboveCursor: 0,
    poolAboveFoamCap: 0,
    poolPixels: 0,
    maxPaintedLuma: 0,
    maxPoolLuma: 0,
  };
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 3] <= 128) continue;
      const luma = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      result.maxPaintedLuma = Math.max(result.maxPaintedLuma, luma);
      // Rec.709 ceilings: cursor #ECE4D0, pool/foam #E0DDD2.
      if (luma > 228.2568) result.aboveCursor++;
      const radius = Math.hypot(((x + 0.5) / s - 512) / 724, ((y + 0.5) / s - 512) / 362);
      if (radius > 0.15) continue;
      result.poolPixels++;
      result.maxPoolLuma = Math.max(result.maxPoolLuma, luma);
      if (luma > 220.8436) result.poolAboveFoamCap++;
    }
  p.measured.brightness = result;
  reports.push({ id: p.id, ...result });
}
fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2) + '\n');
fs.writeFileSync(
  path.join(dir, 'review/selected-colours.json'),
  JSON.stringify(reports, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(dir, 'review/selected-measurements.json'),
  JSON.stringify(
    prompts
      .filter((p) => p.selected && p.centred)
      .map(({ id, file, returned, measured }) => ({ id, file, returned, measured })),
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(reports));
