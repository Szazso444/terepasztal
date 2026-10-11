import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { resample } from '../../../tools/illustrated-sprites.mjs';
const files = process.argv.slice(2);
if (!files.length) throw new Error('Supply QA preview files');
const cell = 512,
  cols = 2;
const out = new PNG({ width: cols * cell, height: Math.ceil(files.length / cols) * cell });
files.forEach((file, index) => {
  const p = resample(PNG.sync.read(readFileSync(file)), cell, cell);
  for (let y = 0; y < cell; y++)
    p.data.copy(
      out.data,
      ((Math.floor(index / cols) * cell + y) * out.width + (index % cols) * cell) * 4,
      y * cell * 4,
      (y + 1) * cell * 4,
    );
});
writeFileSync('assets/source/bridges-v2/qa/review-grid.png', PNG.sync.write(out));
console.log(
  JSON.stringify({ order: files, preview: 'assets/source/bridges-v2/qa/review-grid.png' }),
);
