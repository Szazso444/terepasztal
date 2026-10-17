import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase, fitPicture, cameraOff } from '../../../tools/building-fit.mjs';
import { checkFile } from '../../../tools/building-check.mjs';

const [view, number, metadata] = process.argv.slice(2);
if (!/^r[123]$/.test(view) || !Number.isInteger(Number(number)) || !metadata) {
  throw new Error('Usage: node record-attempt.mjs <view> <attempt> <metadata.json>');
}
const root = 'assets/source/fuel-2026-10-11';
const file = `raw/fuel_pump-a1-${view}-attempt-${number}.png`;
const png = PNG.sync.read(readFileSync(`${root}/${file}`));
const base = measureBase(png);
const left = base.s[0] - base.w[0],
  right = base.e[0] - base.s[0];
const info = JSON.parse(readFileSync(metadata, 'utf8'));
const used = info.corners ?? { w: base.w, s: base.s, e: base.e };
const usedLeft = used.s[0] - used.w[0];
const usedRight = used.e[0] - used.s[0];
const ratio = view === 'r2' ? usedLeft / usedRight : usedRight / usedLeft;
const records = JSON.parse(readFileSync(`${root}/prompts.json`, 'utf8'));
if (records.attempts.some((x) => x.view === view && x.attempt === Number(number))) {
  throw new Error('Attempt already recorded');
}
const measured = {
  w: base.w,
  s: base.s,
  e: base.e,
  sure: base.sure,
  slopes: base.slopes,
  lowerLeftSpan: left,
  lowerRightSpan: right,
  difference: Math.max(left, right) / Math.min(left, right) - 1,
  plan: {
    measured: { w: base.w, s: base.s, e: base.e },
    used,
    readByEye: Boolean(info.corners),
    reason: info.cornerReason ?? 'Measured points lie on the house base corners.',
    lowerLeftSpan: usedLeft,
    lowerRightSpan: usedRight,
    longToShort: ratio,
    required: [2, 2.8],
  },
  planPass: ratio >= 2 && ratio <= 2.8,
  camera: cameraOff(fitPicture(png, 't1', Number(view[1]))),
  check: checkFile(`${root}/${file}`, 't1', Number(view[1])),
  observation: info.observation,
  grassReview: info.grassReview,
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
  reason: 'Repainting on the corrected 2.4:1 master plan.',
};
writeFileSync(`${root}/prompts.json`, JSON.stringify(records, null, 2) + '\n');
console.log(
  JSON.stringify(
    { view, attempt: Number(number), returned: [png.width, png.height], measured },
    null,
    2,
  ),
);
