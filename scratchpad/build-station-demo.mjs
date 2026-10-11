import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

import { trimSource, resample } from '../tools/illustrated-sprites.mjs';
const dir = 'scratchpad/station-pipeline';
mkdirSync(dir, { recursive: true });
const read = (p) => PNG.sync.read(readFileSync(p));
const save = (name, p) => writeFileSync(`${dir}/${name}.png`, PNG.sync.write(p));
const source = read('assets/source/base-v1/station.png');
const originalTrimmed = trimSource(source);
const corrected = read(`${dir}/previous-sprite.png`);
save('trimmed', corrected);
save('corrected', corrected);
save('sprite', corrected);
const atlas = JSON.parse(readFileSync('public/assets/structures.json', 'utf8'));
const previousFrame = atlas.frames['structures/station_1'];
const f = { ...previousFrame };
const oldHeight = Math.round((originalTrimmed.height * f.w) / originalTrimmed.width);
save('uncorrected-sprite', resample(originalTrimmed, f.w, oldHeight));
writeFileSync(
  `${dir}/metadata.json`,
  JSON.stringify(
    {
      frame: f,
      previousFrame,
      resolution: atlas.resolution,
      uncorrectedHeight: oldHeight,
      source: { width: source.width, height: source.height },
      sourcePath: 'scratchpad/station-pipeline/previous-sprite.png',
      processing: 'Original contracted pixels; renderer width scale 1.2, height scale 1',
      projectionVerified: false,
      targetSlopes: [0.5, -0.5],
      projectionStatus: 'Wider-depth candidate from previous-sprite.png; visual review required',
      widthScale: 1.2,
      footprint: [1, 1],
    },
    null,
    2,
  ),
);
console.log('Station stages saved to ' + dir);
