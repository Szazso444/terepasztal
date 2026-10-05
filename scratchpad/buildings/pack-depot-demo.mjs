// Demo only: pack the depot pilot's four pictures into an atlas the game can load, each twice:
// laid onto its footprint with its camera corrected (`structures/depot_a0_r<n>`) and with scale
// and place only, the camera as the generator drew it (`structures/depot_a0_r<n>_raw`).
//   node scratchpad/buildings/pack-depot-demo.mjs [folder with depot-a0-r0..3.png]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../../tools/building-kit.mjs';
import { fitPicture, normalisePicture } from '../../tools/building-fit.mjs';

const from = process.argv[2] ?? 'C:/Users/Zso/terepasztal/assets/source/buildings-v2/depot';
const fp = FOOTPRINTS.t2x2;
const frames = [];
for (let rot = 0; rot < 4; rot++) {
  const file = `${from}/depot-a0-r${rot}.png`;
  if (!existsSync(file)) {
    console.log(`missing ${file}`);
    continue;
  }
  const png = PNG.sync.read(readFileSync(file));
  for (const [suffix, rectify] of [
    ['', true],
    ['_raw', false],
  ]) {
    const fit = fitPicture(png, 't2x2', rot, { rectify });
    const full = normalisePicture(png, fit, 't2x2');
    // crop to the building, keeping the footprint centre as the anchor
    const x0 = Math.max(0, Math.floor(fit.box.left) - 2),
      y0 = Math.max(0, Math.floor(fit.box.top) - 2);
    const x1 = Math.min(full.width, Math.ceil(fit.box.right) + 3),
      y1 = Math.min(full.height, Math.ceil(fit.box.bottom) + 3);
    const cut = new PNG({ width: x1 - x0, height: y1 - y0 });
    PNG.bitblt(full, cut, x0, y0, cut.width, cut.height, 0, 0);
    frames.push({
      key: `structures/depot_a0_r${rot}${suffix}`,
      png: cut,
      ax: fp.centre[0] - x0,
      ay: fp.centre[1] - y0,
    });
    console.log(
      `depot-a0-r${rot}${suffix || '    '}`.padEnd(18),
      `lines ${fit.measured.join(' / ')}`,
      fit.camera ? `camera ${fit.camera.elevation} deg, turned ${fit.camera.turn} deg` : '',
      rectify ? `stretched x${fit.vertical}` : 'as drawn',
    );
  }
}
// one row per rotation: corrected, then as drawn
const pad = 4;
let W = 0,
  H = pad;
const rows = [];
for (let i = 0; i < frames.length; i += 2) {
  const row = frames.slice(i, i + 2);
  const w = row.reduce((a, f) => a + f.png.width + pad, pad);
  const h = Math.max(...row.map((f) => f.png.height));
  rows.push({ row, y: H });
  W = Math.max(W, w);
  H += h + pad;
}
const sheet = new PNG({ width: W, height: H });
const defs = {};
for (const { row, y } of rows) {
  let x = pad;
  for (const f of row) {
    PNG.bitblt(f.png, sheet, 0, 0, f.png.width, f.png.height, x, y);
    defs[f.key] = { x, y, w: f.png.width, h: f.png.height, ax: f.ax, ay: f.ay };
    x += f.png.width + pad;
  }
}
writeFileSync('public/assets/buildings2.png', PNG.sync.write(sheet));
writeFileSync(
  'public/assets/buildings2.json',
  JSON.stringify({ resolution: fp.scale, partial: true, frames: defs }, null, 2) + '\n',
);
console.log(`${frames.length} frames, ${W}x${H} px, in public/assets/buildings2.*`);
