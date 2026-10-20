import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../../../tools/building-fit.mjs';
import { checkLight } from './light-check.mjs';

const [view, number, metadata] = process.argv.slice(2);
if (!/^r[123]$/.test(view) || !Number.isInteger(Number(number)) || !metadata) {
  throw new Error('Usage: node record-attempt.mjs <view> <attempt> <metadata.json>');
}
const root = 'assets/source/fuel-2026-10-11';
const file = `raw/fuel_pump-a1-${view}-attempt-${number}.png`;
const png = PNG.sync.read(readFileSync(`${root}/${file}`));
const info = JSON.parse(readFileSync(metadata, 'utf8'));
const records = JSON.parse(readFileSync(`${root}/prompts.json`, 'utf8'));
if (records.attempts.some((x) => x.view === view && x.attempt === Number(number))) {
  throw new Error('Attempt already recorded');
}
const base = measureBase(png);
const used = info.corners ?? { w: base.w, s: base.s, e: base.e };
const width = used.e[0] - used.w[0];
const heldWidth = (412 * png.width) / 1024;
const light = checkLight(png, info.lightBoxes);
light.pass =
  light.pass &&
  light.walls[0].median >= 100 &&
  light.walls[0].median <= 150 &&
  light.walls[1].median >= 60 &&
  light.walls[1].median <= 85;
const height = {
  ...info.height,
  houseWidth: width,
  ratio: (info.height.foot[1] - info.height.top[1]) / width,
};
height.pass =
  height.ratio >= 0.43 && Math.abs(height.ratio / height.scaffoldReference.ratio - 1) <= 0.15;
const measured = {
  silhouette: info.silhouette,
  baseMeasured: { w: base.w, s: base.s, e: base.e, slopes: base.slopes, sure: base.sure },
  used,
  readByEye: Boolean(info.corners),
  cornerReason: info.cornerReason,
  width,
  heldWidth,
  k: heldWidth / width,
  slopes: [
    (used.s[1] - used.w[1]) / (used.s[0] - used.w[0]),
    (used.e[1] - used.s[1]) / (used.e[0] - used.s[0]),
  ],
  longToShort:
    view === 'r2'
      ? (used.s[0] - used.w[0]) / (used.e[0] - used.s[0])
      : (used.e[0] - used.s[0]) / (used.s[0] - used.w[0]),
  height,
  light,
  crane: info.crane,
  observation: info.observation,
  grassReview: info.grassReview ?? null,
  pass: info.silhouette.pass && height.pass && light.pass && info.crane.pass && info.visualPass,
};
records.attempts.push({
  view,
  attempt: Number(number),
  selected: false,
  file,
  prompt: info.prompt,
  references: info.references,
  returned: [png.width, png.height],
  measured,
});
records.qa.repaint = {
  outcome: 'in progress',
  reason:
    'Scaffold silhouette decides camera and plan; width and slopes are reported only. No separate camera, plan or footprint tests.',
};
writeFileSync(`${root}/prompts.json`, JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify({ view, attempt: Number(number), measured }, null, 2));
