/**
 * Contact sheet: every frame of a packed atlas, laid out on grass and upscaled nearest.
 *
 *   node scratchpad/art-contact-sheet.mjs props out.png [zoom]
 *
 * docs/art-pipeline.md calls one contact-sheet review of the whole set per milestone "the one
 * human checkpoint this plan does not remove": mechanical gates catch a broken asset, but only
 * seeing the set together catches the set drifting apart. This draws that sheet from the packed
 * atlas the game actually loads, so what is reviewed is what ships. The ground is checkered so a
 * transparent margin and a soft ground shadow can be told apart, and frames sit on a common
 * baseline so heights compare.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , group, out, zoomArg] = process.argv;
const Z = Number(zoomArg ?? 2);
const atlas = PNG.sync.read(readFileSync(`public/assets/${group}.png`));
const meta = JSON.parse(readFileSync(`public/assets/${group}.json`, 'utf8')).frames;
const keys = Object.keys(meta).sort();

const COLS = 7;
const cw = Math.max(...keys.map((k) => meta[k].w)) + 14;
const ch = Math.max(...keys.map((k) => meta[k].h)) + 14;
const rows = Math.ceil(keys.length / COLS);
const W = COLS * cw * Z;
const H = rows * ch * Z;
const sheet = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const y = Math.floor(i / W);
  const x = i % W;
  // checker the ground so transparent margins and soft shadows both show
  const dark = (Math.floor(x / (8 * Z)) + Math.floor(y / (8 * Z))) % 2;
  sheet.data[o] = dark ? 112 : 122;
  sheet.data[o + 1] = dark ? 134 : 146;
  sheet.data[o + 2] = dark ? 70 : 76;
  sheet.data[o + 3] = 255;
}
keys.forEach((k, i) => {
  const f = meta[k];
  const ox = (i % COLS) * cw + Math.floor((cw - f.w) / 2);
  const oy = Math.floor(i / COLS) * ch + (ch - 7 - f.h);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const s = ((f.y + y) * atlas.width + (f.x + x)) * 4;
      const a = atlas.data[s + 3];
      if (!a) continue;
      for (let dy = 0; dy < Z; dy++)
        for (let dx = 0; dx < Z; dx++) {
          const d = (((oy + y) * Z + dy) * W + (ox + x) * Z + dx) * 4;
          for (let c = 0; c < 3; c++)
            sheet.data[d + c] = Math.round(
              (atlas.data[s + c] * a + sheet.data[d + c] * (255 - a)) / 255,
            );
        }
    }
});
writeFileSync(out, PNG.sync.write(sheet));
console.log(out, W + 'x' + H, keys.length, 'frames');
