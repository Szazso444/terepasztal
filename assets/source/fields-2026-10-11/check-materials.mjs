import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
const prompts = JSON.parse(readFileSync(join(root, 'prompts.json'), 'utf8'));
for (const entry of prompts) {
  const png = PNG.sync.read(readFileSync(join(root, entry.file)));
  entry.returned = [png.width, png.height];
}
const accepted = prompts.filter((entry) => /^wheat-[012]\.png$/.test(entry.file));
const hashes = new Set();
const measurements = [];
mkdirSync(join(root, 'review'), { recursive: true });
for (const entry of accepted) {
  const bytes = readFileSync(join(root, entry.file));
  const source = PNG.sync.read(bytes);
  if (bytes[25] !== 6) throw new Error(`${entry.file}: must be an RGBA PNG`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hashes.has(hash)) throw new Error('Repeated painting');
  hashes.add(hash);
  entry.returned = [source.width, source.height];
  let transparent = 0;
  let partial = 0;
  for (let i = 3; i < source.data.length; i += 4) {
    if (source.data[i] === 0) transparent++;
    else if (source.data[i] < 255) partial++;
  }
  // Review copies ONLY: area sampling to a canvas width of 128, hence a 64px tile.
  // Originals remain byte-for-byte untouched; no fitting, cutting or alpha correction.
  const width = 128;
  const height = Math.round((source.height / source.width) * width);
  const preview = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startX = (x * source.width) / width;
      const endX = ((x + 1) * source.width) / width;
      const startY = (y * source.height) / height;
      const endY = ((y + 1) * source.height) / height;
      let weight = 0;
      let alpha = 0;
      const rgb = [0, 0, 0];
      for (let sy = Math.floor(startY); sy < Math.ceil(endY); sy++) {
        for (let sx = Math.floor(startX); sx < Math.ceil(endX); sx++) {
          const w =
            (Math.min(sx + 1, endX) - Math.max(sx, startX)) *
            (Math.min(sy + 1, endY) - Math.max(sy, startY));
          const i = (sy * source.width + sx) * 4;
          const a = source.data[i + 3] / 255;
          weight += w;
          alpha += a * w;
          for (let c = 0; c < 3; c++) rgb[c] += source.data[i + c] * a * w;
        }
      }
      const i = (y * width + x) * 4;
      const background = [104, 140, 68];
      for (let c = 0; c < 3; c++) {
        preview.data[i + c] = Math.round((rgb[c] + background[c] * (weight - alpha)) / weight);
      }
      preview.data[i + 3] = 255;
    }
  }
  writeFileSync(join(root, 'review', entry.file), PNG.sync.write(preview));
  measurements.push({
    file: entry.file,
    returned: entry.returned,
    sha256: hash,
    transparentPixels: transparent,
    partialAlphaPixels: partial,
    previewCanvas: [width, height],
    previewTileWidth: 64,
  });
}
writeFileSync(join(root, 'prompts.json'), `${JSON.stringify(prompts, null, 2)}\n`);
writeFileSync(join(root, 'review/measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
console.log(JSON.stringify(measurements, null, 2));
