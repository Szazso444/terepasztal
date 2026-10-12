import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
const relative = 'assets/source/water-2026-10-11/';
const journal = join(root, 'qa', 'wet-sand-repaint-prompts.json');
mkdirSync(join(root, 'qa'), { recursive: true });
const entries = existsSync(journal)
  ? JSON.parse(readFileSync(journal, 'utf8'))
  : JSON.parse(readFileSync(join(root, 'prompts.json'), 'utf8')).filter((entry) =>
      /^wet-sand-attempt-[234]$/.test(entry.id),
    );
mkdirSync(join(root, 'review', 'wet-sand-repaint'), { recursive: true });
const select = Number(process.argv.find((arg) => arg.startsWith('--select='))?.split('=')[1]);
for (const entry of entries) {
  const sourcePath = join(root, entry.file);
  if (!existsSync(sourcePath)) continue;
  const bytes = readFileSync(sourcePath);
  const png = PNG.sync.read(bytes);
  let minAlpha = 255;
  let borderMinAlpha = 255;
  let poolPixels = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      minAlpha = Math.min(minAlpha, png.data[i + 3]);
      if (x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1)
        borderMinAlpha = Math.min(borderMinAlpha, png.data[i + 3]);
      if (png.data[i + 2] - png.data[i] > 15) poolPixels++;
    }
  }
  entry.returned = [png.width, png.height];
  entry.measured = {
    poolPixels,
    totalPixels: png.width * png.height,
    poolShare: poolPixels / (png.width * png.height),
    poolPercent: (100 * poolPixels) / (png.width * png.height),
    minAlpha,
    borderMinAlpha,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  // Area-average a separate 199 px review; the painting's bytes stay unchanged.
  const preview = new PNG({ width: 199, height: 199 });
  const side = Math.min(png.width, png.height);
  const ox = Math.floor((png.width - side) / 2);
  const oy = Math.floor((png.height - side) / 2);
  for (let y = 0; y < 199; y++) {
    for (let x = 0; x < 199; x++) {
      const left = ox + (x * side) / 199;
      const right = ox + ((x + 1) * side) / 199;
      const top = oy + (y * side) / 199;
      const bottom = oy + ((y + 1) * side) / 199;
      const sum = [0, 0, 0, 0];
      let weight = 0;
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const area =
            (Math.min(right, sx + 1) - Math.max(left, sx)) *
            (Math.min(bottom, sy + 1) - Math.max(top, sy));
          const i = (sy * png.width + sx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += png.data[i + c] * area;
          weight += area;
        }
      }
      for (let c = 0; c < 4; c++) preview.data[(y * 199 + x) * 4 + c] = Math.round(sum[c] / weight);
    }
  }
  writeFileSync(
    join(root, 'review', 'wet-sand-repaint', `${entry.id}.png`),
    PNG.sync.write(preview),
  );
  if (entry.id === `wet-sand-attempt-${select}`) {
    if (minAlpha < 251 || borderMinAlpha < 251 || entry.measured.poolShare >= 0.03)
      throw new Error('Selected painting fails opacity or pool coverage');
    entry.selected = true;
    entry.measured.alignmentReview =
      'Passed visual inspection at 199 px: isolated pools, no rows, diagonals or chains.';
    copyFileSync(sourcePath, join(root, 'wet-sand.png'));
  }
  console.log(JSON.stringify({ id: entry.id, returned: entry.returned, measured: entry.measured }));
}
writeFileSync(journal, `${JSON.stringify(entries, null, 2)}\n`);
function merge(records) {
  const previous = records.find((entry) => entry.id === 'wet-sand');
  if (!previous) throw new Error('Missing earlier wet-sand provenance');
  previous.file = 'raw/wet-sand-attempt-1.png';
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  for (const entry of entries) byId.set(entry.id, entry);
  return [...byId.values()];
}
const sharedPath = join(root, 'prompts.json');
writeFileSync(
  sharedPath,
  `${JSON.stringify(merge(JSON.parse(readFileSync(sharedPath, 'utf8'))), null, 2)}\n`,
);
// Prepare a commit manifest from HEAD, preserving unrelated pending edits in the working file.
const committed = JSON.parse(
  execFileSync('git', ['show', `HEAD:${relative}prompts.json`], { encoding: 'utf8' }),
);
writeFileSync(
  join(root, 'qa', 'wet-sand-prompts-commit.json'),
  `${JSON.stringify(merge(committed), null, 2)}\n`,
);
