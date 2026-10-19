import { readFileSync, writeFileSync } from 'node:fs';
import { measure } from './measure-oil.mjs';
const [v, k, options = '{}'] = process.argv.slice(2),
  root = 'assets/source/rotations-535/oil_derrick';
const data = JSON.parse(readFileSync(root + '/prompts.json'));
const opts = JSON.parse(options);
const file = root + '/raw/oil_derrick-r' + v + '-attempt-' + k + '.png';
const measured = measure(file, Number(v), { ...opts, reference: data.r0Reference });
const refs = [
  '../guides-535/oil_derrick-r' + v + '.png',
  'docs/art-direction/images/03-theme-town-growth.png',
  'assets/source/base-v1/works-full-oil-derrick.png',
];
const prompt =
  JSON.parse(readFileSync('../guides-535/oil-prompts.json'))[v] +
  '\n\nRequested output: 1024 x 1024 pixels.' +
  (opts.correction ? '\n\n' + opts.correction : '');
const entry = {
  view: 'r' + v,
  attempt: Number(k),
  file,
  prompt,
  references: refs,
  returned: measured.returned,
  measured,
  kept: false,
};
data.attempts.push(entry);
writeFileSync(root + '/prompts.json', JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(measured, null, 2));
