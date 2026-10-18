// Contact sheets of the wheat field frames on plains grass, as the game would show them at zoom 1
// and zoom 2: the generator's frames (src/art/props.ts, headless) against the finished pictures
// (public/assets/props.{png,json}). No browser needed.
//   node scratchpad/wheat-sheet.mjs [outDir]       default scratchpad/shots/wheat-321
// Writes singles-z1.png, singles-z2.png, field-z1.png, field-z2.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { generatorFrames } from './wheat-gen-frames.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = process.argv[2] ?? `${root}scratchpad/shots/wheat-321`;
mkdirSync(outDir, { recursive: true });

const DENSITY = 4;
const BG = [86, 94, 78];

function atlas(group) {
  const sheet = PNG.sync.read(readFileSync(`${root}public/assets/${group}.png`));
  const json = JSON.parse(readFileSync(`${root}public/assets/${group}.json`, 'utf8'));
  const take = (key) => {
    const f = json.frames[key];
    if (!f) throw new Error(`no ${key} in ${group}.json`);
    const data = new Uint8ClampedArray(f.w * f.h * 4);
    for (let y = 0; y < f.h; y++) {
      const from = ((f.y + y) * sheet.width + f.x) * 4;
      data.set(sheet.data.subarray(from, from + f.w * 4), y * f.w * 4);
    }
    return { w: f.w, h: f.h, ax: f.ax, ay: f.ay, data };
  };
  return { take };
}

/** A scene at 4 texels per world px: float premultiplied RGBA. */
class Scene {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * h * 4);
  }
  /** Source-over blit of a frame, `nearest` blocks of n x n per source pixel. */
  blit(f, x, y, n = 1) {
    for (let sy = 0; sy < f.h; sy++)
      for (let sx = 0; sx < f.w; sx++) {
        const i = (sy * f.w + sx) * 4;
        const a = f.data[i + 3] / 255;
        if (!a) continue;
        for (let dy = 0; dy < n; dy++)
          for (let dx = 0; dx < n; dx++) {
            const X = x + sx * n + dx;
            const Y = y + sy * n + dy;
            if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
            const o = (Y * this.w + X) * 4;
            const k = 1 - a;
            for (let c = 0; c < 3; c++) this.px[o + c] = f.data[i + c] * a + this.px[o + c] * k;
            this.px[o + 3] = a + this.px[o + 3] * k;
          }
      }
  }
  /** Area average down by `factor` over the background, to an opaque PNG; `crop` is [x, y, w, h] in texels. */
  toPng(factor, crop = [0, 0, this.w, this.h]) {
    const [cx, cy, cw, ch] = crop;
    const w = Math.floor(cw / factor);
    const h = Math.floor(ch / factor);
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const acc = [0, 0, 0, 0];
        for (let dy = 0; dy < factor; dy++)
          for (let dx = 0; dx < factor; dx++) {
            const o = ((cy + y * factor + dy) * this.w + cx + x * factor + dx) * 4;
            for (let c = 0; c < 4; c++) acc[c] += this.px[o + c];
          }
        const n = factor * factor;
        const a = acc[3] / n;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) png.data[o + c] = Math.round(acc[c] / n + BG[c] * (1 - a));
        png.data[o + 3] = 255;
      }
    return png;
  }
}

const terrain = atlas('terrain');
const finished = atlas('props');
const generated = await generatorFrames('props/wheat');

const PLAINS = [0, 1, 2, 3].map((v) => terrain.take(`terrain/plains_${v}`));
/** Tile (tx, ty) centre in world px. */
const centre = (tx, ty) => [(tx - ty) * 32, (tx + ty) * 16];

/**
 * A block of plains with wheat standing on `wheat` ([tx, ty, variant]) tiles; `source` picks the
 * generator's frames (res 1) or the finished ones (res 4). Returns the scene, 4 texels per world px.
 */
function field(size, wheat, source) {
  const pad = 40;
  const wpx = size * 64 + 2 * pad;
  const hpx = size * 32 + 2 * pad + 20;
  const s = new Scene(wpx * DENSITY, hpx * DENSITY);
  const ox = (size * 32 + pad) * DENSITY;
  const oy = (pad + 16 + 10) * DENSITY;
  const at = (tx, ty) => {
    const [x, y] = centre(tx, ty);
    return [ox + x * DENSITY, oy + y * DENSITY];
  };
  const order = [];
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) order.push([tx, ty]);
  order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [tx, ty] of order) {
    const f = PLAINS[(tx * 3 + ty * 5) % 4];
    const [x, y] = at(tx, ty);
    s.blit(f, Math.round(x - f.ax), Math.round(y - f.ay));
  }
  s.at = at;
  const props = wheat
    .map(([tx, ty, v]) => ({ tx, ty, v }))
    .sort((a, b) => a.tx + a.ty - (b.tx + b.ty));
  for (const { tx, ty, v } of props) {
    const [x, y] = at(tx, ty);
    if (source === 'gen') {
      const f = generated[`props/wheat_${v}`];
      s.blit(f, Math.round(x - f.ax * DENSITY), Math.round(y - f.ay * DENSITY), DENSITY);
    } else {
      const f = finished.take(`props/wheat_${v}`);
      s.blit(f, Math.round(x - f.ax), Math.round(y - f.ay));
    }
  }
  return s;
}

/** PNGs side by side with `gap` px between. */
function row(pngs, gap = 6) {
  const w = pngs.reduce((n, p) => n + p.width, 0) + gap * (pngs.length + 1);
  const h = Math.max(...pngs.map((p) => p.height)) + 2 * gap;
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([30, 34, 28, 255], i);
  let x = gap;
  for (const p of pngs) {
    PNG.bitblt(p, out, 0, 0, p.width, p.height, x, gap);
    x += p.width + gap;
  }
  return out;
}
function stack(pngs, gap = 6) {
  const w = Math.max(...pngs.map((p) => p.width));
  const h = pngs.reduce((n, p) => n + p.height + gap, gap);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([30, 34, 28, 255], i);
  let y = gap;
  for (const p of pngs) {
    PNG.bitblt(p, out, 0, 0, p.width, p.height, 0, y);
    y += p.height + gap;
  }
  return out;
}

for (const zoom of [1, 2]) {
  const factor = DENSITY / zoom;
  // one wheat tile, centred in a 3x3 block of plains, per variant: generator row, finished row
  const singles = (source) =>
    row(
      [0, 1, 2].map((v) => {
        const s = field(3, [[1, 1, v]], source);
        const [x, y] = s.at(1, 1);
        return s.toPng(factor, [x - 70 * DENSITY, y - 36 * DENSITY, 140 * DENSITY, 76 * DENSITY]);
      }),
    );
  writeFileSync(
    `${outDir}/singles-z${zoom}.png`,
    PNG.sync.write(stack([singles('gen'), singles('fin')])),
  );
  // a small field of wheat tiles with the variants mixed, in a 5x5 block
  const tiles = [
    [1, 1, 0],
    [2, 1, 1],
    [3, 1, 2],
    [1, 2, 2],
    [2, 2, 0],
    [3, 2, 1],
    [2, 3, 2],
    [3, 3, 0],
  ];
  const scene = (source) => field(5, tiles, source).toPng(factor);
  writeFileSync(`${outDir}/field-z${zoom}.png`, PNG.sync.write(row([scene('gen'), scene('fin')])));
}
console.log('wrote', outDir);
