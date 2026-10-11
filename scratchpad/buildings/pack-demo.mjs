// Demo only: pack the new pictures of the depot and of one-tile families (six ages, four views)
// into an atlas the game can load, each twice: with its camera corrected
// (`structures/<family>_a<age>_r<n>`) and as the generator drew it, scale and place only
// (`..._raw`). The four views of an age are brought to one size.
//   node scratchpad/buildings/pack-demo.mjs <buildings-v2 folder> [family:footprint ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../../tools/building-kit.mjs';
import { fitGroup, normalisePicture } from '../../tools/building-fit.mjs';

const from = process.argv[2] ?? 'C:/Users/Zso/terepasztal/assets/source/buildings-v2';
const families = (process.argv.length > 3 ? process.argv.slice(3) : ['depot:t2x2', 'station:t1']).map(
  (a) => a.split(':'),
);
/** the atlas holds 4 px per game px */
const DENSITY = 4;
const frames = [];
// `family:footprint:as` packs a family's pictures under another family's frame names, so that the
// demo's one-tile station shows them in the game (`lumber:t1:station`)
for (const [family, fpId, as = family] of families) {
  const fp = FOOTPRINTS[fpId];
  const shrink = fp.scale / DENSITY;
  for (let age = 0; age < 6; age++) {
    const pngs = [0, 1, 2, 3].map((rot) => {
      const file = `${from}/${family}/${family}-a${age}-r${rot}.png`;
      return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
    });
    for (const [suffix, rectify] of [
      ['', true],
      ['_raw', false],
    ]) {
      const fits = fitGroup(pngs, fpId, { rectify });
      fits.forEach((fit, rot) => {
        if (!fit) return;
        const full = normalisePicture(pngs[rot], fit, fpId, shrink);
        const x0 = Math.max(0, Math.floor(fit.box.left / shrink) - 2),
          y0 = Math.max(0, Math.floor(fit.box.top / shrink) - 2);
        const x1 = Math.min(full.width, Math.ceil(fit.box.right / shrink) + 3),
          y1 = Math.min(full.height, Math.ceil(fit.box.bottom / shrink) + 3);
        const cut = new PNG({ width: x1 - x0, height: y1 - y0 });
        PNG.bitblt(full, cut, x0, y0, cut.width, cut.height, 0, 0);
        frames.push({
          key: `structures/${as}_a${age}_r${rot}${suffix}`,
          png: cut,
          ax: fp.centre[0] / shrink - x0,
          ay: fp.centre[1] / shrink - y0,
        });
      });
    }
  }
}
// shelves, each at most 4080 px wide
const pad = 4,
  LIMIT = 4080;
let W = 0,
  H = pad,
  x = pad,
  shelf = 0;
const placed = [];
for (const f of frames) {
  if (x + f.png.width + pad > LIMIT) {
    H += shelf + pad;
    x = pad;
    shelf = 0;
  }
  placed.push({ f, x, y: H });
  x += f.png.width + pad;
  W = Math.max(W, x);
  shelf = Math.max(shelf, f.png.height);
}
H += shelf + pad;
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
const count = (family) => frames.filter((f) => f.key.startsWith(`structures/${family}_`)).length;
console.log(
  `${frames.length} frames (${families.map(([f, , as = f]) => `${f}${as === f ? '' : ` as ${as}`} ${count(as)}`).join(', ')}), ${W}x${H} px, in public/assets/buildings2.*`,
);
