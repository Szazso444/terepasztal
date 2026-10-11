import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Review copies only. Never crop, resize, recolour or rewrite the source paintings.
const root = dirname(fileURLToPath(import.meta.url));
const names = [
  'fall-sheet-lit',
  'fall-sheet-shade',
  'cliff-rock-lit',
  'cliff-rock-shade',
  'plunge-foam-sw',
  'plunge-foam-se',
];
const promptsPath = join(root, 'prompts.json');
// Keep a waterfall-only journal so simultaneous water-material jobs cannot lose these prompts.
const fallPromptsPath = join(root, 'fall-prompts.json');
const prompts = JSON.parse(readFileSync(fallPromptsPath, 'utf8'));
for (const entry of prompts) {
  if (!existsSync(join(root, entry.file))) continue;
  const png = PNG.sync.read(readFileSync(join(root, entry.file)));
  entry.returned = [png.width, png.height];
}
if (process.argv.includes('--complete')) {
  for (const name of names) {
    if (!existsSync(join(root, `${name}.png`))) throw new Error(`Missing ${name}.png`);
  }
}
mkdirSync(join(root, 'review'), { recursive: true });
const report = [];
function reduce(source, width, height) {
  const target = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const accum = [0, 0, 0, 0];
      let weight = 0;
      const left = (x * source.width) / width;
      const right = ((x + 1) * source.width) / width;
      const top = (y * source.height) / height;
      const bottom = ((y + 1) * source.height) / height;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const area =
            (Math.min(right, sx + 1) - Math.max(left, sx)) *
            (Math.min(bottom, sy + 1) - Math.max(top, sy));
          const offset = (sy * source.width + sx) * 4;
          const alpha = source.data[offset + 3] / 255;
          for (let c = 0; c < 3; c++) accum[c] += source.data[offset + c] * alpha * area;
          accum[3] += alpha * area;
          weight += area;
        }
      }
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        target.data[offset + c] = accum[3] ? Math.round(accum[c] / accum[3]) : 0;
      target.data[offset + 3] = Math.round((accum[3] / weight) * 255);
    }
  }
  return target;
}
for (const name of names) {
  const file = `${name}.png`;
  if (!existsSync(join(root, file))) continue;
  const bytes = readFileSync(join(root, file));
  const source = PNG.sync.read(bytes);
  const face = !name.startsWith('plunge');
  let minAlpha = 255;
  let transparentPixels = 0;
  let partialPixels = 0;
  let aboveWhiteCap = 0;
  for (let i = 0; i < source.data.length; i += 4) {
    const a = source.data[i + 3];
    minAlpha = Math.min(minAlpha, a);
    if (a === 0) transparentPixels++;
    if (a > 0 && a < 255) partialPixels++;
    if (a && source.data[i] > 224 && source.data[i + 1] > 221 && source.data[i + 2] > 210)
      aboveWhiteCap++;
  }
  if (face && minAlpha !== 255) throw new Error(`${file}: FACE must be fully opaque`);
  const dimensions = face ? [36, 39] : [128, Math.round((128 * source.height) / source.width)];
  const preview = reduce(source, ...dimensions);
  writeFileSync(join(root, 'review', file), PNG.sync.write(preview));
  // Magnified review remains a separate copy, showing precisely the reduced pixels.
  const magnified = new PNG({ width: preview.width * 4, height: preview.height * 4 });
  for (let y = 0; y < magnified.height; y++) {
    for (let x = 0; x < magnified.width; x++) {
      const from = (Math.floor(y / 4) * preview.width + Math.floor(x / 4)) * 4;
      magnified.data.set(preview.data.subarray(from, from + 4), (y * magnified.width + x) * 4);
    }
  }
  writeFileSync(join(root, 'review', `${name}-4x.png`), PNG.sync.write(magnified));
  for (const prompt of prompts.filter((entry) => entry.file === file))
    prompt.returned = [source.width, source.height];
  report.push({
    file,
    returned: [source.width, source.height],
    preview: dimensions,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    minAlpha,
    transparentPixels,
    partialPixels,
    aboveWhiteCap,
    aboveWhiteCapFraction: aboveWhiteCap / (source.width * source.height),
  });
}
writeFileSync(fallPromptsPath, `${JSON.stringify(prompts, null, 2)}\n`);
const sharedPrompts = existsSync(promptsPath) ? JSON.parse(readFileSync(promptsPath, 'utf8')) : [];
const byId = new Map(sharedPrompts.map((entry) => [entry.id, entry]));
for (const entry of prompts) byId.set(entry.id, entry);
writeFileSync(promptsPath, `${JSON.stringify([...byId.values()], null, 2)}\n`);
writeFileSync(
  join(root, 'review', 'waterfall-checks.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
