// The raised wheat guide: the flat guide's patch (guides/wheat.png, geometry.json) as a low slab
// the rows stand on, for the illustrated version PROMPT.md asks for. Same canvas, same tile
// centre, same footprint; the top face is lifted RAISE game px and the two fronts that face the
// viewer are drawn under it. pngjs only; draws analytically, no painting is processed.
//   node assets/source/fields-2026-10-11/make-raised-guide.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
/** The stalks' height over the ground, in game px, and in canvas px at 8 per game px. */
export const RAISE = 3;
const RAISE_CANVAS = RAISE * 8;
const HALF = 0.42;
const SIZE = 1024;
const ANCHOR = [512, 832];

/** Tile-space point under a canvas pixel centre, taken as a ground point. */
const ground = (px, py) => {
  const sx = (px + 0.5 - ANCHOR[0]) / 256;
  const sy = (py + 0.5 - ANCHOR[1]) / 128;
  return [(sx + sy) / 2, (sy - sx) / 2];
};
const inside = ([x, y]) => Math.abs(x) <= HALF && Math.abs(y) <= HALF;

const png = new PNG({ width: SIZE, height: SIZE });
for (let py = 0; py < SIZE; py++)
  for (let px = 0; px < SIZE; px++) {
    const i = (py * SIZE + px) * 4;
    let grey = null;
    const top = ground(px, py + RAISE_CANVAS);
    if (inside(top)) {
      grey = 216;
      // the rows, as in the flat guide: 6 game px apart along tile x
      const phase = (((64 * top[0] + 3) % 6) + 6) % 6;
      if (Math.min(phase, 6 - phase) < 0.16) grey = 132;
    } else {
      // the front under the top face: the first ground point met going down from here
      for (let k = 1; k < RAISE_CANVAS && grey === null; k++) {
        const g = ground(px, py + k);
        if (inside(g)) grey = g[0] > g[1] ? 120 : 170; // lower-right front dark, lower-left mid
      }
    }
    // the tile's own outline on the ground, as the flat guide has it, behind the slab
    const [gx, gy] = ground(px, py);
    if (grey === null && Math.abs(Math.max(Math.abs(gx), Math.abs(gy)) - 0.5) < 0.0045) grey = 100;
    if (grey !== null) png.data.set([grey, grey, grey, 255], i);
  }
mkdirSync(join(root, 'guides'), { recursive: true });
writeFileSync(join(root, 'guides/wheat-raised.png'), PNG.sync.write(png));
console.log('Wrote guides/wheat-raised.png (1024x1024 RGBA)');
