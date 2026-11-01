/** Audit raw provenance, selected bytes, references, measurements and review completeness. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(folder, name), 'utf8'));
const specifications = read('specifications.json');
const { attempts } = read('prompts.json');
const trees = read('trees.json');
const hashes = {};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const outstanding = {};
for (const spec of specifications) {
  const records = attempts
    .filter((a) => a.file === spec.file)
    .sort((a, b) => a.attempt - b.attempt);
  assert(records.length >= 1 && records.length <= 3, `${spec.file}: attempt limit`);
  assert.equal(records.filter((a) => a.selected).length, 1, `${spec.file}: one selection`);
  for (const [index, attempt] of records.entries()) {
    assert.equal(attempt.attempt, index + 1, `${spec.file}: sequential attempts`);
    if (index) assert(attempt.prompt.includes('\n\nCorrection:'), `${spec.file}: correction`);
    assert.deepEqual(
      attempt.references,
      [
        'docs/art-direction/images/02-nature-objects.png',
        spec.file.startsWith('tree-')
          ? 'assets/source/waterside-trees-2026-10-16/tree-willow-2.png'
          : 'assets/source/base-v1/props-flowers.png',
        'assets/source/cozy-v3/tree-oak-v2.png',
      ],
      `${spec.file}: reference order`,
    );
    const raw = `raw/${spec.file.slice(0, -4)}-attempt-${attempt.attempt}.png`;
    const bytes = readFileSync(join(folder, raw));
    const png = PNG.sync.read(bytes);
    assert.equal(png.colorType, 6, `${raw}: RGBA`);
    assert.deepEqual([png.width, png.height], attempt.measured.returned, `${raw}: returned size`);
    assert.equal(sha(bytes), attempt.originalOutputSha256, `${raw}: original output hash`);
    assert(attempt.measured.lookReview, `${raw}: visual review`);
    assert(Array.isArray(attempt.measured.failed), `${raw}: named failures`);
    readFileSync(join(folder, attempt.measured.look));
    hashes[raw] = sha(bytes);
  }
  const chosen = records.find((a) => a.selected);
  const bytes = readFileSync(join(folder, spec.file));
  assert(
    bytes.equals(
      readFileSync(join(folder, `raw/${spec.file.slice(0, -4)}-attempt-${chosen.attempt}.png`)),
    ),
    `${spec.file}: exact copy`,
  );
  const result = trees[spec.file];
  assert.equal(result.height, spec.height, `${spec.file}: intended height`);
  assert.equal(result.attempt, chosen.attempt, `${spec.file}: selected attempt`);
  for (const field of ['returned', 'box', 'foot', 'anchor', 'drawn'])
    assert.deepEqual(result[field], chosen.measured[field], `${spec.file}: ${field}`);
  const numeric = [];
  if (result.edgePixels) numeric.push('transparent margin');
  if (result.overCursorWhite) numeric.push('cursor white');
  if (result.amberStrength) numeric.push('selection amber');
  if (result.cyanWaterPct >= 0.5) numeric.push('cyan water');
  if (Math.abs(result.drawn.footFromCentre) > result.drawn.width * 0.15)
    numeric.push('foot centering');
  for (const failure of numeric)
    assert(chosen.measured.failed.includes(failure), `${spec.file}: unreported ${failure}`);
  outstanding[spec.file] = chosen.measured.failed;
  hashes[spec.file] = sha(bytes);
}
assert.equal(
  readdirSync(join(folder, 'raw')).filter((f) => f.endsWith('.png')).length,
  attempts.length,
);
assert.equal(Object.keys(trees).length, 30, '30 selected measurements');
writeFileSync(join(folder, 'sha256.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(
  JSON.stringify({
    pictures: 30,
    retainedAttempts: attempts.length,
    auditPassed: true,
    outstanding: Object.fromEntries(Object.entries(outstanding).filter(([, v]) => v.length)),
  }),
);
