/** Refresh measurements and provenance without altering any source PNG. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const read = (p) => JSON.parse(readFileSync(join(folder, p), 'utf8'));
const prompts = read('prompts.json'),
  specs = read('specifications.json'),
  reviews = read('reviews.json');
const trees = {};
for (const a of prompts.attempts) {
  const spec = specs.find((s) => s.file === a.file);
  const stem = a.file.slice(0, -4) + '-attempt-' + a.attempt;
  const raw = join(folder, 'raw', stem + '.png');
  const review = reviews[stem];
  if (!review) throw new Error('Missing visual review: ' + stem);
  const args = [
    join(folder, 'check-tree.mjs'),
    raw,
    '--kind',
    spec.kind,
    '--height',
    String(spec.height),
  ];
  if (review.foot) args.push('--foot', review.foot.join(','));
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  const measured = JSON.parse(run.stdout);
  Object.assign(measured, review);
  measured.footReadByEye = !!review.footReadByEye;
  measured.failed = [...review.failed];
  for (const [test, failed] of [
    ['transparent margin', measured.edgePixels > 0],
    ['cursor white', measured.overCursorWhite > 0],
    ['selection amber', measured.amberStrength > 0],
    ['cyan water', measured.cyanWaterPct >= 0.5],
    ['foot centering', Math.abs(measured.drawn.footFromCentre) > measured.drawn.width * 0.15],
  ])
    if (failed && !measured.failed.includes(test)) measured.failed.push(test);
  a.measured = measured;
  a.returned = measured.returned;
  if (existsSync(a.originalOutput))
    a.originalOutputSha256 = createHash('sha256')
      .update(readFileSync(a.originalOutput))
      .digest('hex');
  else if (!a.originalOutputSha256)
    throw new Error('Original tool output unavailable and no recorded hash: ' + stem);
  if (a.selected) {
    const selected = { ...measured, attempt: a.attempt, biome: spec.biome };
    selected.look = 'checks/' + a.file.slice(0, -4) + '-look.png';
    writeFileSync(join(folder, selected.look), readFileSync(join(folder, measured.look)));
    trees[a.file] = selected;
  }
}
writeFileSync(join(folder, 'trees.json'), JSON.stringify(trees, null, 2) + '\n');
writeFileSync(join(folder, 'prompts.json'), JSON.stringify(prompts, null, 2) + '\n');
console.log(
  JSON.stringify({ measured: prompts.attempts.length, selected: Object.keys(trees).length }),
);
