// Demo only: pack the depot's 24 pictures (six ages, four views) into an atlas the game can load,
// each twice: with its camera corrected (`structures/depot_a<age>_r<n>`) and as the generator
// drew it, scale and place only (`..._raw`). The four views of an age are brought to one size.
//   node scratchpad/buildings/pack-depot-demo.mjs [folder with depot-a<age>-r<n>.png]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../../tools/building-kit.mjs';
import { fitGroup, normalisePicture } from '../../tools/building-fit.mjs';

const from = process.argv[2] ?? 'C:/Users/Zso/terepasztal/assets/source/buildings-v2/depot';
const fp = FOOTPRINTS.t2x2;
/** the atlas holds 4 px per game px; the footprint's canvas has 6 */
const DENSITY = 4;
const shrink = fp.scale / DENSITY;
const frames = [];
for (let age = 0; age < 6; age++) {
  const pngs = [0, 1, 2, 3].map((rot) => {
    const file = `${from}/depot-a${age}-r${rot}.png`;
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
  });
  for (const [suffix, rectify] of [
    ['', true],
    ['_raw', false],
  ]) {
    const fits = fitGroup(pngs, 't2x2', { rectify });
    fits.forEach((fit, rot) => {
      if (!fit) return;
      const full = normalisePicture(pngs[rot], fit, 't2x2', shrink);
      const x0 = Math.max(0, Math.floor(fit.box.left / shrink) - 2),
        y0 = Math.max(0, Math.floor(fit.box.top / shrink) - 2);
      const x1 = Math.min(full.width, Math.ceil(fit.box.right / shrink) + 3),
        y1 = Math.min(full.height, Math.ceil(fit.box.bottom / shrink) + 3);
      const cut = new PNG({ width: x1 - x0, height: y1 - y0 });
      PNG.bitblt(full, cut, x0, y0, cut.width, cut.height, 0, 0);
      frames.push({
        key: `structures/depot_a${age}_r${rot}${suffix}`,
        png: cut,
        ax: fp.centre[0] / shrink - x0,
        ay: fp.centre[1] / shrink - y0,
      });
      if (rectify)
        console.log(
          `depot-a${age}-r${rot}`,
          `lines ${fit.measured.join(' / ')}`,
          fit.camera ? `camera ${fit.camera.elevation} deg, turned ${fit.camera.turn} deg` : 'outline',
          `stretched x${fit.vertical}`,
        );
    });
  }
}
// rows of seven: under 4096 px either way
const pad = 4,
  perRow = 7;
let W = 0,
  H = pad;
const placed = [];
for (let i = 0; i < frames.length; i += perRow) {
  const row = frames.slice(i, i + perRow);
  let x = pad;
  for (const f of row) {
    placed.push({ f, x, y: H });
    x += f.png.width + pad;
  }
  W = Math.max(W, x);
  H += Math.max(...row.map((f) => f.png.height)) + pad;
}
const sheet = new PNG({ width: W, height: H });
const defs = {};
for (const { f, x, y } of placed) {
  PNG.bitblt(f.png, sheet, 0, 0, f.png.width, f.png.height, x, y);
  defs[f.key] = { x, y, w: f.png.width, h: f.png.height, ax: f.ax, ay: f.ay };
}
writeFileSync('public/assets/buildings2.png', PNG.sync.write(sheet));
writeFileSync(
  'public/assets/buildings2.json',
  JSON.stringify({ resolution: DENSITY, partial: true, frames: defs }, null, 2) + '\n',
);
console.log(`${frames.length} frames, ${W}x${H} px, in public/assets/buildings2.*`);
