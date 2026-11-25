/** Verify the delivered set and its audit trail without changing any paintings. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = dirname(fileURLToPath(import.meta.url));
const { attempts } = JSON.parse(readFileSync(join(folder, 'prompts.json'), 'utf8'));
const trees = JSON.parse(readFileSync(join(folder, 'trees.json'), 'utf8'));
const specifications = [
  ['tree-mangrove-1.png', 30, 38, 48, 19, 29],
  ['tree-mangrove-2.png', 38, 48, 60, 24, 36],
  ['tree-mangrove-3.png', 46, 60, 74, 31, 46],
  ['tree-willow-1.png', 40, 48, 62],
  ['tree-willow-2.png', 48, 60, 74],
  ['tree-willow-3.png', 54, 70, 82],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {};
let retained = 0;
for (const [file, height, minWidth, maxWidth, minRoots, maxRoots] of specifications) {
  const records = attempts.filter((a) => a.file === file);
  assert(records.length >= 1 && records.length <= 3, `${file}: attempt limit`);
  const selected = records.filter((a) => a.selected);
  assert.equal(selected.length, 1, `${file}: exactly one selection`);
  for (const [index, attempt] of records.entries()) {
    assert.equal(attempt.attempt, index + 1, `${file}: sequential attempts`);
    assert(attempt.references.length <= 5, `${file}: reference limit`);
    if (index > 0) assert(attempt.prompt.includes('\n\nCorrection:'), `${file}: correction`);
    const rawName = `raw/${file.slice(0, -4)}-attempt-${attempt.attempt}.png`;
    const bytes = readFileSync(join(folder, rawName));
    const png = PNG.sync.read(bytes);
    assert.deepEqual([png.width, png.height], attempt.returned, `${rawName}: returned size`);
    assert.deepEqual(attempt.returned, attempt.measured.returned, `${rawName}: measured size`);
    assert.equal(png.colorType, 6, `${rawName}: real RGBA`);
    readFileSync(join(folder, attempt.measured.look));
    manifest[rawName] = sha256(bytes);
    retained++;
  }
  const chosen = selected[0];
  const rawName = `raw/${file.slice(0, -4)}-attempt-${chosen.attempt}.png`;
  const bytes = readFileSync(join(folder, file));
  assert(bytes.equals(readFileSync(join(folder, rawName))), `${file}: byte-for-byte selection`);
  manifest[file] = sha256(bytes);
  const result = trees[file];
  assert.equal(result.height, height);
  for (const field of ['returned', 'box', 'footAuto', 'foot', 'anchor', 'drawn'])
    assert.deepEqual(result[field], chosen.measured[field], `${file}: recorded ${field}`);
  assert.equal(result.edgePixels, 0, `${file}: transparent margin`);
  assert.equal(result.overCursorWhite, 0, `${file}: cursor white`);
  assert.equal(result.amberStrength, 0, `${file}: selection amber`);
  assert(result.cyanWaterPct < 0.5, `${file}: painted cyan water`);
  assert(result.drawn.width >= minWidth && result.drawn.width <= maxWidth, `${file}: width`);
  assert(Math.abs(result.drawn.footFromCentre) <= result.drawn.width * 0.15, `${file}: center`);
  if (minRoots !== undefined)
    assert(
      result.drawn.rootSpread >= minRoots && result.drawn.rootSpread <= maxRoots,
      `${file}: roots`,
    );
  else assert(result.drawn.belowFoot <= 6, `${file}: pixels below foot`);
  assert.deepEqual(chosen.measured.failed, [], `${file}: visual acceptance review`);
  readFileSync(join(folder, result.look));
}
assert.equal(readdirSync(join(folder, 'raw')).filter((f) => f.endsWith('.png')).length, retained);
writeFileSync(join(folder, 'sha256.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({ trees: specifications.length, retainedAttempts: retained, passed: true }),
);
