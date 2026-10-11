// A family's pictures laid onto the footprint as the game will show them (the four views of an age
// brought to one size), cut to the building, for looking at them side by side.
//   node .cache/fitted_views.mjs <buildings-v2 folder> <family> <footprint> <out folder>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../tools/building-kit.mjs';
import { fitGroup, normalisePicture } from '../tools/building-fit.mjs';

const [root, family, fpId, out] = process.argv.slice(2);
const fp = FOOTPRINTS[fpId];
mkdirSync(out, { recursive: true });
// one window for every view: the footprint's canvas, cut to where a building can stand
// (a one-tile building: the tile is 64 game px wide, its near corner 16 below its centre)
const half = Math.round(fp.scale * 40);
const w = half * 2,
  h = Math.round(fp.scale * 82);
const x0 = Math.round(fp.centre[0] - half),
  y0 = Math.round(fp.centre[1] + fp.scale * 19 - h);
for (let age = 0; age < 6; age++) {
  const pngs = [0, 1, 2, 3].map((rot) => {
    const file = `${root}/${family}/${family}-a${age}-r${rot}.png`;
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
  });
  fitGroup(pngs, fpId).forEach((fit, rot) => {
    if (!fit) return;
    const full = normalisePicture(pngs[rot], fit, fpId, 1);
    const cut = new PNG({ width: w, height: h });
    PNG.bitblt(full, cut, Math.max(0, x0), Math.max(0, y0), Math.min(w, full.width - x0), Math.min(h, full.height - y0), 0, 0);
    writeFileSync(`${out}/a${age}-r${rot}.png`, PNG.sync.write(cut));
  });
}
console.log(`canvas ${fp.canvas}, scale ${fp.scale}, centre ${fp.centre}, window ${w}x${h} at ${x0},${y0}`);
