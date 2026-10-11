// Demo only: renders of reconstructed 3D models in the one-tile station's place, beside the painted
// pictures they were made from. A render is already on the footprint's canvas at the game's
// camera, so it is only halved and cut out: nothing is measured, fitted or stretched.
//   node scratchpad/buildings/pack-3d.mjs <buildings-v2 folder> <renders folder> <slot>=<family>-a<age>:<render prefix> ...
// e.g. 2=station-a2:station-a2p  puts that model's four renders under structures/station_a2_r<n>
// and the painted station-a2 pictures, placed as drawn, under structures/station_a2_r<n>_raw.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../../tools/building-kit.mjs';
import { fitGroup, normalisePicture } from '../../tools/building-fit.mjs';

const [from, renders, ...slots] = process.argv.slice(2);
const DENSITY = 4;
const fpId = 't1';
const fp = FOOTPRINTS[fpId];
const shrink = fp.scale / DENSITY;
const frames = [];

/** Halve a picture, colours weighted by how solid they are. */
function halve(src) {
  const out = new PNG({ width: src.width >> 1, height: src.height >> 1 });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const o = ((y * 2 + j) * src.width + x * 2 + i) * 4;
          const al = src.data[o + 3];
          r += src.data[o] * al;
          g += src.data[o + 1] * al;
          b += src.data[o + 2] * al;
          a += al;
        }
      const o = (y * out.width + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
        out.data[o + 3] = Math.round(a / 4);
      }
    }
  return out;
}

function cut(full, key) {
  let x0 = full.width,
    y0 = full.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < full.height; y++)
    for (let x = 0; x < full.width; x++)
      if (full.data[(y * full.width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return;
  x0 = Math.max(0, x0 - 2);
  y0 = Math.max(0, y0 - 2);
  x1 = Math.min(full.width - 1, x1 + 2);
  y1 = Math.min(full.height - 1, y1 + 2);
  const png = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
  PNG.bitblt(full, png, x0, y0, png.width, png.height, 0, 0);
  frames.push({ key, png, ax: fp.centre[0] / shrink - x0, ay: fp.centre[1] / shrink - y0 });
}

for (const slot of slots) {
  const [age, rest] = slot.split('=');
  const [picture, prefix] = rest.split(':');
  const family = picture.split('-')[0];
  const painted = [0, 1, 2, 3].map((rot) => {
    const file = `${from}/${family}/${picture}-r${rot}.png`;
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
  });
  const fits = fitGroup(painted, fpId, { rectify: false });
  for (let rot = 0; rot < 4; rot++) {
    const file = `${renders}/${prefix}-r${rot}.png`;
    if (existsSync(file)) cut(halve(PNG.sync.read(readFileSync(file))), `structures/station_a${age}_r${rot}`);
    if (fits[rot]) cut(normalisePicture(painted[rot], fits[rot], fpId, shrink), `structures/station_a${age}_r${rot}_raw`);
  }
}
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
writeFileSync('public/assets/buildings2.json', JSON.stringify({ resolution: DENSITY, partial: true, frames: defs }, null, 2) + '\n');
console.log(`${frames.length} frames, ${W}x${H} px, in public/assets/buildings2.*`);
